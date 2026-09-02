---
name: postgres
description: >-
  PostgreSQL for a stack whose primary database is SQL Server: connecting from .NET with Npgsql and
  the pooling, prepared-statement and timestamp behaviour that differs from SqlClient, running the
  Postgres client through docker because psql is not installed on this machine, reading EXPLAIN
  (ANALYZE, BUFFERS), choosing between B-tree, GIN, GiST, BRIN, partial and expression indexes,
  JSONB modelling and when it is the wrong answer, VACUUM and table bloat, and the concrete
  differences that bite when porting a query or a migration from SQL Server. Use when working on the
  read-cache database, the alternative EF provider, or any Postgres query, index, migration or
  container. Read-only by default.
---

# postgres — the secondary database: what differs from SQL Server, and what bites

Postgres appears twice here: as a **read-cache database** alongside SQL Server in the large
platform (accessed with Dapper, its schema managed outside EF), and as an **alternative EF provider**
in one solution. Both run locally through docker compose.

## When

- Writing or reviewing a Postgres query, function, index or schema change.
- Porting a query, a stored procedure or a migration from SQL Server, or making one work on both.
- A Postgres query is slow, or an `EXPLAIN` plan needs reading.
- Connecting from .NET: pooling, timeouts, prepared statements, type mapping.
- Deciding whether something belongs in a JSONB column or in columns.
- Table or index bloat, autovacuum not keeping up, disk growing without rows growing.
- Needing a client at all — `psql` is **not** installed; every recipe goes through docker.

Not for: SQL Server itself (`sql-server`), EF modelling and migration mechanics (`ef-core`,
`ef-migration`), writing the compose stack (`docker-dev-env`), Redis as a cache (`redis-dotnet`).
Server-release-specific syntax: read `SELECT version()` first and confirm with the official docs.

## Decide

**Slow query — the order is the same as anywhere, the tools are not.**

| # | Check                                                        | Verdict                                                       |
| - | ------------------------------------------------------------ | ------------------------------------------------------------- |
| 1 | `EXPLAIN (ANALYZE, BUFFERS)` — estimated vs actual rows       | 10x off → run `ANALYZE`, or add extended statistics            |
| 2 | `loops` on the inner side of a Nested Loop                    | actual time is **per loop**; multiply before judging it        |
| 3 | `Rows Removed by Filter` large                                | the predicate is applied after the read → index it or rewrite  |
| 4 | `Seq Scan` on a large table with a selective predicate        | missing index → `references/explain-and-indexes.md`            |
| 5 | `Sort Method: external merge  Disk:` or `Hash Batches > 1`    | the sort or hash spilled — `work_mem` too small for this query |
| 6 | `Heap Fetches` high on an Index Only Scan                     | the visibility map is stale → vacuum the table                 |
| 7 | `Buffers: shared read` dominating `shared hit`                | reading from disk: too much data, or a cold cache              |
| 8 | Query fine, table growing without rows                        | bloat → `references/vacuum-and-bloat.md`                       |

**Which index type earns its keep.**

| Data and predicate                                        | Index                                                  |
| --------------------------------------------------------- | ------------------------------------------------------ |
| Equality and range on scalars, `ORDER BY`, uniqueness     | B-tree (the default; use it unless you can name why not) |
| `@>`, `?`, key existence inside JSONB; arrays; full text  | GIN                                                     |
| `LIKE '%mid%'` / fuzzy matching                           | GIN with the trigram extension                          |
| Ranges, geometry, nearest-neighbour ordering              | GiST                                                    |
| Huge append-only table, physically correlated column      | BRIN — tiny index, coarse filtering                     |
| Only a slice of the table is ever queried                 | partial index (`WHERE deleted_at IS NULL`)              |
| The predicate is an expression                            | expression index (`ON t (lower(email))`)                |
| Extra columns needed to make it index-only                | B-tree with `INCLUDE`                                   |

**JSONB or columns?**

| Signal                                                     | Answer                                     |
| ---------------------------------------------------------- | ------------------------------------------ |
| The shape is known and stable                              | columns                                    |
| Filtered, joined or aggregated on constantly               | columns                                    |
| Needs a foreign key, a check constraint or a `NOT NULL`    | columns                                    |
| Sparse, caller-defined, or a whole payload stored verbatim | JSONB                                      |
| Read as a blob, written whole, queried by one or two keys  | JSONB + an expression or GIN index          |
| Large document updated field-by-field, many times a second | neither — every update rewrites the row     |

**Read-only by default.** `SELECT`, `EXPLAIN` without `ANALYZE`, and the catalog views run freely.
`EXPLAIN ANALYZE` **executes** the statement, so for anything that writes, wrap it:
`BEGIN; EXPLAIN (ANALYZE, BUFFERS) UPDATE ...; ROLLBACK;`. `VACUUM FULL`, `REINDEX`, `DROP`,
`TRUNCATE` and unfiltered DML are announced before running, never on a database you did not create.

## Do

```powershell
# psql is NOT installed. Use the client inside the container the compose file already defines,
# so the client and server images match and no tag has to be invented.
$svc = 'postgres'; $u = 'postgres'; $db = 'appcache'

# One query, tab-separated, no headers, fail on the first error
docker compose exec -T $svc psql -U $u -d $db -v ON_ERROR_STOP=1 -At -F "`t" `
  -c "select relname, n_live_tup, n_dead_tup from pg_stat_user_tables order by n_dead_tup desc limit 10"

# Interactive session for exploration (\dt, \d+ orders, \di, \df, \x, \timing)
docker compose exec -it $svc psql -U $u -d $db

# A local .sql file, without copying it into the container
Get-Content .\inspect.sql | docker compose exec -T $svc psql -U $u -d $db -v ON_ERROR_STOP=1

# A plan, with buffers, as JSON for tooling
docker compose exec -T $svc psql -U $u -d $db `
  -c "explain (analyze, buffers, verbose, format json) select * from orders where customer_id = 42"

# Schema of one table, and a schema-only dump
docker compose exec -T $svc psql -U $u -d $db -c "\d+ public.orders"
docker compose exec -T $svc pg_dump -U $u -d $db --schema-only --table=public.orders
```

No compose service (a bare container, or a managed instance)? Run the client from the **same image
the compose file names** and attach it to the same network: `docker run --rm -it --network <net>
<that-image> psql -h <host> -U <user> -d <db>`. Never hardcode an image tag here.

## Traps

1. `DateTime` written to a `timestamptz` column throws or shifts → the client requires UTC `Kind` for
   `timestamptz` and local for `timestamp` → store UTC everywhere; a legacy-behaviour switch exists
   but check its exact name in the client's release notes before relying on it.
2. A query works in `psql` but not from EF, or vice versa → EF quotes identifiers, so `"CustomerId"`
   is case-sensitive while unquoted `customerid` folds to lower case → quote consistently.
3. `WHERE name = 'Rossi'` misses the row stored as `rossi`, which SQL Server would have matched →
   string comparison here is case-**sensitive** → `lower(name)` with an expression index, or `citext`.
4. Connection count explodes under load → each connection is a server process here, not a thread →
   cap `Max Pool Size` deliberately, and put a pooler in front for many app instances.
5. `SELECT ... FOR UPDATE` in a loop deadlocks → add `ORDER BY` to lock in a stable order, or use
   `FOR UPDATE SKIP LOCKED` for a queue table.
6. Migration works locally and fails in CI on the identifier case → an unquoted name created by hand
   is lower case, a quoted one is not → pick one convention per database and enforce it.
7. Disk grows, row count does not → dead tuples from updates; autovacuum blocked by a long-running
   transaction or a replication slot → `references/vacuum-and-bloat.md`.
8. `VACUUM FULL` "to reclaim space" during the day → it takes an exclusive lock and rewrites the
   table → schedule it, or use a rewrite tool that works online.
9. A `text` column "should be `varchar(n)` for performance" → it is not; there is no gain, only a
   constraint. Length limits belong where they are a business rule.
10. `count(*)` on a big table is slow → there is no maintained row count → use an estimate from
    `pg_class.reltuples`, or keep a counter, when an approximation is acceptable.

## References

- `references/npgsql-dotnet.md` — connecting from .NET: data sources, pooling, timeouts, prepared
  statements, type mapping, Dapper and the EF provider.
- `references/psql-via-docker.md` — every client recipe without a local binary: psql, dump/restore,
  copy in and out, meta-commands.
- `references/explain-and-indexes.md` — reading `EXPLAIN (ANALYZE, BUFFERS)` node by node, and
  designing the index it asks for.
- `references/jsonb.md` — modelling, operators, indexing, and the shapes where JSONB is the wrong
  answer.
- `references/vacuum-and-bloat.md` — MVCC, dead tuples, autovacuum tuning, measuring bloat,
  transaction-id freezing.
- `references/from-sql-server.md` — the porting table: identifiers, types, collation, sequences,
  upsert, `LIMIT` vs `TOP`, and what has no equivalent.
