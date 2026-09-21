# Index design — from one real query to one index

## The recipe

Take the query, not the table. Read the plan, then build the key in this order:

1. **Equality predicates** — every column compared with `=` goes into the key first.
2. **Range / inequality predicates** — `>`, `<`, `BETWEEN`, `LIKE 'x%'`: exactly one of them earns a
   key position, and it goes **after** all the equality columns.
3. **`ORDER BY` / `GROUP BY` columns** — next, in the same order and direction, so the sort
   disappears from the plan.
4. **Everything else the query returns** — into `INCLUDE`, not the key. Included columns live only
   in the leaf level: they make the index covering without widening every level of the tree.

```sql
-- SELECT OrderId, Total, Status FROM dbo.Orders
-- WHERE CustomerId = @c AND CreatedAt >= @from ORDER BY CreatedAt DESC;
CREATE INDEX IX_Orders_CustomerId_CreatedAt
    ON dbo.Orders (CustomerId, CreatedAt DESC) INCLUDE (Total, Status);
```

The index is **covering** when the plan shows a seek with no Key Lookup. That is the goal for a hot
query, not for every query — a covering index for a wide `SELECT` is a second copy of the table.

## Key order rules

| Rule                                                        | Why                                                            |
| ----------------------------------------------------------- | -------------------------------------------------------------- |
| Equality before range                                       | after a range column, later key columns can no longer seek      |
| Most selective first *among the equality columns*            | it narrows the range scanned; it is a tiebreak, not the rule     |
| An index on `(A, B)` also serves a query filtering `A` alone | so do not create `(A)` as well                                  |
| An index on `(A, B)` does **not** serve a query filtering `B` alone | that needs `(B, ...)`                                   |
| The clustering key is appended to every non-clustered index  | a wide or random clustering key inflates every index            |

## Clustered index

One per table, and it is the table. Pick a key that is narrow, ever-increasing and used in range
queries — an identity or a sequence-backed key in most cases. A random `uniqueidentifier` as the
clustering key causes page splits and fragmentation on every insert; if the entity needs a GUID as
its public identifier, keep it as a non-clustered unique key and cluster on the surrogate.

A table with **no** clustered index is a heap: the plan shows `RID Lookup` instead of `Key Lookup`,
and deletes leave forwarded rows behind. In this codebase, give every table a clustered index.

## Filtered and unique indexes

| Case                                                | Index                                                      |
| --------------------------------------------------- | ---------------------------------------------------------- |
| Queries always filter `WHERE IsDeleted = 0`         | filtered index with the same predicate — smaller and cheaper |
| A sparse column queried only when non-null          | `WHERE Col IS NOT NULL`                                     |
| A business rule of uniqueness                       | `CREATE UNIQUE INDEX` — it is a constraint the optimiser also uses |
| Uniqueness only among active rows                   | unique filtered index                                       |

A filtered index is only used when the query's predicate provably implies the filter — a
parameterised `WHERE IsDeleted = @flag` will **not** use it.

## What already exists

```sql
-- Every index on a table, with its key order and includes
SELECT i.name, i.type_desc, i.is_unique, i.filter_definition,
       STUFF((SELECT ', ' + c.name + CASE WHEN ic.is_descending_key = 1 THEN ' DESC' ELSE '' END
              FROM sys.index_columns ic JOIN sys.columns c
                   ON c.object_id = ic.object_id AND c.column_id = ic.column_id
              WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id
                AND ic.is_included_column = 0
              ORDER BY ic.key_ordinal FOR XML PATH('')), 1, 2, '') AS keys,
       STUFF((SELECT ', ' + c.name
              FROM sys.index_columns ic JOIN sys.columns c
                   ON c.object_id = ic.object_id AND c.column_id = ic.column_id
              WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id
                AND ic.is_included_column = 1 FOR XML PATH('')), 1, 2, '') AS includes
FROM sys.indexes i
WHERE i.object_id = OBJECT_ID('dbo.Orders') AND i.type > 0;
```

```sql
-- Usage since the last restart: seeks/scans versus writes. High updates + zero reads = dead weight.
SELECT OBJECT_NAME(s.object_id) AS tbl, i.name, s.user_seeks, s.user_scans, s.user_lookups,
       s.user_updates, s.last_user_seek
FROM sys.dm_db_index_usage_stats s JOIN sys.indexes i
     ON i.object_id = s.object_id AND i.index_id = s.index_id
WHERE s.database_id = DB_ID() ORDER BY s.user_updates DESC;
```

`sys.dm_db_missing_index_details` (joined to the group and group-stats views) suggests indexes the
optimiser wanted. Read them as **evidence of a workload**, never as a script: they ignore key order,
they ignore existing indexes, and they will happily propose five overlapping indexes on one table.

## Before creating anything

| Question                                              | If the answer is no                                  |
| ----------------------------------------------------- | ---------------------------------------------------- |
| Does an existing index already lead with these columns? | extend that index instead of adding a new one       |
| Is the query SARGable?                                 | rewrite first — the index cannot help                |
| Is the filter selective enough to beat a scan?          | no index; consider pre-aggregation                   |
| How many writes per second hit this table?              | each index is paid on every insert, update, delete   |
| Is this a hot path or a monthly report?                 | a report can afford a scan                           |

Creating an index takes locks. Online creation and resumable rebuilds depend on the edition, so
check `SELECT SERVERPROPERTY('EditionID')` and run it in a maintenance window otherwise.

## Fragmentation and statistics

Fragmentation matters far less than a missing or wrong index; chase it last. Check with
`sys.dm_db_index_physical_stats` (`LIMITED` mode is enough), then `ALTER INDEX ... REORGANIZE` for
moderate fragmentation and `REBUILD` above it. A rebuild refreshes statistics; a reorganise does
not — see `execution-plans.md`.
