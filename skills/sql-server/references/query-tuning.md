# Query tuning — set-based rewrites and SARGability

## SARGable in practice

A predicate is SARGable when the engine can turn it into a **seek** on an index: the column stands
alone on one side, compared with a constant, a parameter or another column.

| Not SARGable                              | SARGable rewrite                                        |
| ----------------------------------------- | ------------------------------------------------------- |
| `YEAR(CreatedAt) = 2024`                  | `CreatedAt >= @from AND CreatedAt < @to`                 |
| `CAST(CreatedAt AS date) = @d`            | `CreatedAt >= @d AND CreatedAt < DATEADD(day, 1, @d)`    |
| `ISNULL(Status, 0) = @s`                  | `(Status = @s OR (Status IS NULL AND @s = 0))`, or fix the column to `NOT NULL` |
| `UPPER(Email) = @e`                       | rely on the case-insensitive collation, or store a normalised column |
| `Code LIKE '%' + @c + '%'`                | `Code LIKE @c + '%'` (leading wildcard cannot seek)      |
| `Total * 1.22 > @limit`                   | `Total > @limit / 1.22`                                  |
| `DATEDIFF(day, CreatedAt, GETDATE()) < 7` | `CreatedAt > DATEADD(day, -7, GETDATE())`                |
| `WHERE @p IS NULL OR ColumnA = @p`        | see **Optional parameters** below                        |
| `nvarchar` parameter on a `varchar` column | declare the parameter as the column's type              |

An implicit conversion is only harmless when it lands on the **parameter**. When the plan shows
`CONVERT_IMPLICIT` around the column, the seek is gone — that is the single most common cause of a
scan on a well-indexed table.

## Optional parameters (the "search screen" query)

`WHERE (@name IS NULL OR Name = @name) AND (@city IS NULL OR City = @city)` compiles **one** plan
for every combination of supplied filters, so it is wrong for all of them.

| Option                       | When                                                   | Cost                                |
| ---------------------------- | ------------------------------------------------------ | ----------------------------------- |
| `OPTION (RECOMPILE)`         | few executions per minute, many filter combinations    | a compile per execution             |
| Dynamic SQL via `sp_executesql` with only the supplied predicates | high call rate, hot search screen | one cached plan per shape; must be parameterised |
| Separate procedures per shape | two or three real shapes only                          | duplicated code                     |

Never build the predicate by string concatenation of user input — always parameters.

## Set-based instead of row-by-row

| Row-by-row shape                      | Replacement                                                        |
| ------------------------------------- | ------------------------------------------------------------------ |
| Cursor / `WHILE` over a keyset        | one `UPDATE ... FROM` / `INSERT ... SELECT` / `DELETE ... FROM`     |
| Scalar UDF called per row             | inline expression, or an inline table-valued function with `CROSS APPLY` |
| Loop to build a string                | `STRING_AGG`                                                       |
| Self-join to get the previous row     | `LAG` / `LEAD`                                                     |
| Self-join to get a running total      | `SUM(...) OVER (PARTITION BY ... ORDER BY ...)`                     |
| Query per row from the application    | one query with a table-valued parameter, or `WHERE Id IN (...)` batched |
| `INSERT` then `SELECT` to get the ids | `OUTPUT inserted.Id`                                               |
| "Delete a million rows" in one shot   | a `WHILE` loop with `DELETE TOP (n)` — the one place a loop wins, because it keeps the log and the locks small |

**Scalar UDFs** are the hidden killer in a procedure-heavy codebase: the plan may or may not inline
them depending on the engine release, and when it does not, the plan shows no cost at all for a
per-row call. Check by looking for a separate `UserDefinedFunction` node in the plan, or by
comparing `sys.dm_exec_function_stats` before and after.

## Rewrites that change the plan shape

| Pattern                                   | Better                                                        |
| ----------------------------------------- | ------------------------------------------------------------- |
| `OR` across two different columns         | `UNION ALL` of two seekable queries (deduplicate if needed)    |
| `NOT IN (subquery)` over a nullable column | `NOT EXISTS` — `NOT IN` returns nothing when any value is NULL |
| `COUNT(*) > 0` in a condition             | `EXISTS`                                                       |
| `DISTINCT` to hide a fan-out join         | fix the join, or use `EXISTS` for the semi-join                |
| `SELECT *` in a view consumed by a join   | project the columns actually used                              |
| `TOP` without `ORDER BY`                  | add the order, or accept that the result is non-deterministic  |
| `MERGE` for an upsert                     | explicit `UPDATE` then `INSERT` (guarded); `MERGE` has a long history of concurrency and trigger surprises |
| Pagination with `ROW_NUMBER` in a CTE     | `ORDER BY ... OFFSET @skip ROWS FETCH NEXT @take ROWS ONLY`, plus an index matching the order |
| Deep `OFFSET` pagination                  | keyset pagination: `WHERE (SortKey, Id) > (@lastSortKey, @lastId)` |

## Temp table or table variable

| Want                                        | Use                                                      |
| ------------------------------------------- | -------------------------------------------------------- |
| More than a few hundred rows, joined later  | `#temp` — it has statistics and can be indexed           |
| A handful of rows, passed to a function     | table variable, or a table-valued parameter              |
| Reuse in the same statement only            | CTE — remember a CTE is not materialised and can be evaluated more than once |
| Materialise an expensive CTE                | `SELECT INTO #temp` first                                |

## Measure, do not guess

```sql
SET STATISTICS IO, TIME ON;   -- logical reads and CPU/elapsed per statement
SET STATISTICS XML ON;        -- the actual plan, with real row counts
```

Compare **logical reads** before and after a change: it is the only number that does not move with
cache state or machine load. Wall-clock time on a warm second run proves nothing.

Aggregate cost across the whole workload rather than one query:

```sql
SELECT TOP 20 qs.total_worker_time / qs.execution_count AS avg_cpu,
       qs.execution_count, qs.total_logical_reads / qs.execution_count AS avg_reads,
       SUBSTRING(t.text, (qs.statement_start_offset / 2) + 1, 200) AS stmt
FROM sys.dm_exec_query_stats qs CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) t
ORDER BY qs.total_worker_time DESC;
```

A query costing 2 ms called 100,000 times a minute beats a 2-second report nobody runs. Fix by total
cost, not by worst single duration.
