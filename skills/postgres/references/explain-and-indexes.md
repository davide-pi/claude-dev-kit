# EXPLAIN (ANALYZE, BUFFERS) and the index it asks for

## Getting the right plan

```sql
EXPLAIN (ANALYZE, BUFFERS)            SELECT ...;   -- the default working form
EXPLAIN (ANALYZE, BUFFERS, VERBOSE, SETTINGS) SELECT ...;  -- adds output columns and non-default GUCs
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT ...;        -- for a plan visualiser
EXPLAIN                               SELECT ...;   -- estimates only, executes nothing
```

`ANALYZE` **runs the statement**. For anything that writes:

```sql
BEGIN;
EXPLAIN (ANALYZE, BUFFERS) UPDATE orders SET status = 'x' WHERE id = 1;
ROLLBACK;
```

Run it twice and read the second one when comparing plans, so the buffer cache is warm in both; but
read the **first** one when the question is "why is it slow in production", because a cold cache is
part of the answer.

## Reading a node

```text
Nested Loop  (cost=0.42..8123.55 rows=1 width=48) (actual time=0.03..812.4 rows=9412 loops=1)
  Buffers: shared hit=1204 read=38210
  ->  Seq Scan on orders  (cost=... rows=1 ...) (actual time=... rows=9412 loops=1)
        Filter: ((status)::text = 'Open'::text)
        Rows Removed by Filter: 1204883
  ->  Index Scan using ix_lines_order on order_lines  (actual time=0.08..0.08 rows=3 loops=9412)
```

| Field                     | What it tells you                                                       |
| ------------------------- | ----------------------------------------------------------------------- |
| `rows=` estimated vs actual | the optimiser's error. 10x or more is the root cause, not the operator |
| `loops=`                  | `actual time` and `rows` are **per loop** — multiply by `loops`          |
| `Rows Removed by Filter`  | rows read and thrown away: exactly what an index would have avoided      |
| `Buffers: shared hit`     | pages served from cache                                                  |
| `Buffers: shared read`    | pages read from disk — the number to reduce                               |
| `Buffers: temp read/written` | a spill to temporary files: the sort or hash did not fit in memory     |
| `Heap Fetches`            | on an Index Only Scan: visibility map is stale, so the heap is visited anyway |
| `Sort Method`             | `quicksort  Memory:` is good; `external merge  Disk:` is a spill          |
| `Hash Batches`            | more than 1 means the hash spilled                                        |
| `Workers Launched`        | parallelism actually used, which can be lower than planned                |

Work **outward from the deepest node whose estimate is wrong**: everything above it inherits the
error, so fixing the top node fixes nothing.

## Node types and what they signal

| Node                            | Signal                                                                |
| ------------------------------- | --------------------------------------------------------------------- |
| `Seq Scan` on a small table     | fine — a scan of a few thousand rows beats an index                    |
| `Seq Scan` + large `Rows Removed by Filter` | missing index, or a predicate the index cannot use        |
| `Index Scan`                    | seek plus heap visit per row                                           |
| `Index Only Scan`               | the best case: the index covered the query                             |
| `Bitmap Heap Scan` + `Bitmap Index Scan` | many matches: the index found them, the heap is read in page order — usually correct |
| `Recheck Cond` with `lossy` heap blocks | the bitmap overflowed `work_mem`                              |
| `Nested Loop` with high `loops` | the outer side was under-estimated                                     |
| `Hash Join` with a huge build side | the wrong table was chosen to hash — check the estimates             |
| `Merge Join` with a `Sort` under it | an index in the join order would remove the sort                    |
| `Materialize` / `Memoize`       | the same inner set fetched repeatedly                                   |
| `SubPlan` executed per row      | a correlated subquery — rewrite as a join or `LATERAL`                  |
| `Gather` / `Gather Merge`       | parallel plan; the cost of collecting workers is real for small results  |

## Fixing the estimate before fixing the plan

```sql
ANALYZE public.orders;                                    -- refresh statistics now
ALTER TABLE orders ALTER COLUMN status SET STATISTICS 500; -- more histogram detail on a skewed column
CREATE STATISTICS orders_cust_status (dependencies, ndistinct)
    ON customer_id, status FROM orders;                    -- correlated columns
```

Postgres assumes columns are independent. When two predicates are correlated (`country` and
`region`, `tenant_id` and `status`), the estimate is the product of two selectivities and comes out
far too low — extended statistics is the fix, not an index.

`pg_stat_user_tables.last_autovacuum` / `last_autoanalyze` tell you whether statistics are simply
stale, which is the common case right after a bulk load or a migration.

## Designing the index

The key order rule is the same as anywhere: **equality columns first, then one range column, then
the `ORDER BY` columns**, then `INCLUDE` for the rest of the projection.

```sql
-- select id, total, status from orders where customer_id = $1 and created_at >= $2 order by created_at desc
CREATE INDEX ix_orders_customer_created ON orders (customer_id, created_at DESC) INCLUDE (total, status);

-- only non-deleted rows are ever queried: a partial index is smaller and stays hot
CREATE INDEX ix_orders_open ON orders (customer_id, created_at DESC) WHERE deleted_at IS NULL;

-- the predicate is an expression, so index the expression
CREATE INDEX ix_users_email_lower ON users (lower(email));

-- substring search: trigram index, not B-tree
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX ix_products_name_trgm ON products USING gin (name gin_trgm_ops);
```

| Type  | Use it for                                                            | Cost                                      |
| ----- | --------------------------------------------------------------------- | ----------------------------------------- |
| B-tree | equality, ranges, ordering, uniqueness — the default                  | ordinary write amplification              |
| GIN   | JSONB containment, arrays, full text, trigrams                        | slow to update; `fastupdate` defers it     |
| GiST  | ranges, geometry, exclusion constraints, nearest neighbour            | lossy: a recheck against the heap          |
| BRIN  | very large, naturally ordered columns (an append-only timestamp)       | coarse; useless if physical order is random |
| Hash  | equality only, on a very wide value                                   | no ordering, rarely worth it over B-tree    |

**Build without locking writes**: `CREATE INDEX CONCURRENTLY` — it cannot run inside a transaction,
it takes longer, and it can leave an `INVALID` index behind on failure (check `pg_index.indisvalid`,
then drop and retry). In a migration this means a separate, non-transactional step.

`REINDEX CONCURRENTLY` rebuilds a bloated index the same way. Plain `REINDEX` blocks writes.

## Unique and exclusion constraints

A unique index is the enforcement mechanism *and* an optimiser input. `NULL`s are distinct by
default, so a nullable unique column allows many rows with `NULL`; a partial unique index expresses
"unique among active rows". For "no two overlapping ranges", use an exclusion constraint over a GiST
index rather than application-side checking.
