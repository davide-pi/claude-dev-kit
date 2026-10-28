# Porting from SQL Server — the differences that bite

## Identifiers and casing

The number-one source of "it worked in the other database". Postgres folds unquoted identifiers to
**lower case**; `"Name"` is case-**sensitive**. EF-generated SQL quotes `"Orders"."CustomerId"`, so
hand-written SQL must quote identically. Schema resolution follows `search_path` (`public`, not `dbo`);
catalogs are `pg_catalog.*` and `information_schema.*`.

Pick one convention per database and enforce it: **all snake_case unquoted** (what hand-written SQL and
psql expect) or **all quoted PascalCase** (what EF produces by default). Mixing means every query must
know which table it touches.

## Types

| SQL Server               | Postgres                          | Note                                                    |
| ------------------------ | --------------------------------- | ------------------------------------------------------- |
| `nvarchar(n)` / `nvarchar(max)` | `text` or `varchar(n)`     | `text` has no penalty; a length is a constraint, not an optimisation |
| `datetime2` / `datetimeoffset` | `timestamp` / `timestamptz` | `timestamptz` stores the instant, the offset is not preserved |
| `bit`                    | `boolean`                         | `true`/`false`, not `1`/`0`                              |
| `money`                  | `numeric(19,4)`                   | avoid `money` in both                                    |
| `tinyint`                | `smallint`                        | there is no 1-byte integer                               |
| `rowversion`             | the system column `xmin`          | used as an EF concurrency token                          |
| table type / TVP         | array type, or `unnest(...)`      |                                                          |

`timestamptz` is the default for any point in time. Store UTC, and let the client enforce the
`DateTime.Kind` — see `npgsql-dotnet.md`.

## Strings, comparison and collation

| Behaviour                       | SQL Server                                | Postgres                                            |
| ------------------------------- | ----------------------------------------- | --------------------------------------------------- |
| Default comparison              | case-**insensitive** collation, usually    | case-**sensitive**                                   |
| Case-insensitive equality       | free                                      | `lower(col) = lower($1)` + expression index, `citext`, or a non-deterministic ICU collation |
| Trailing spaces in comparison   | `varchar` ignores them                     | significant — `'a' <> 'a '`                          |
| Concatenation                   | `+` (NULL yields NULL)                     | `\|\|` — `+` on strings is an error                  |
| Sort order for pagination       | collation-dependent                        | collation-dependent, and **different** — a keyset paginator ported verbatim can skip or repeat rows |

Changing a collation later rewrites indexes: decide the case-sensitivity story when the table is created.

## Syntax translation (only the non-obvious)

| SQL Server                            | Postgres                                                       |
| ------------------------------------- | -------------------------------------------------------------- |
| `CROSS APPLY` / `OUTER APPLY`         | `CROSS JOIN LATERAL` / `LEFT JOIN LATERAL ... ON true`          |
| `SCOPE_IDENTITY()`                    | `INSERT ... RETURNING id`                                       |
| `MERGE`                               | `INSERT ... ON CONFLICT (key) DO UPDATE SET ...` — see below     |
| `#temp` / `##global`                  | `CREATE TEMP TABLE t AS ...` (session-scoped, no global form)     |
| `WITH (NOLOCK)`                       | nothing — readers never block under MVCC                         |
| `WITH (UPDLOCK)`                      | `SELECT ... FOR UPDATE`                                          |
| `sp_executesql` with parameters       | `EXECUTE format('...%I...', ident) USING value` inside PL/pgSQL   |
| `TRY_CONVERT`                         | no direct equivalent — a function with an exception block          |
| Stored procedure returning a result set | a function returning `TABLE(...)`/`SETOF`, or a cursor          |

## Upsert

```sql
INSERT INTO cache_entry (key, payload, updated_at)
VALUES ($1, $2, now())
ON CONFLICT (key) DO UPDATE
   SET payload = excluded.payload, updated_at = excluded.updated_at
 WHERE cache_entry.payload IS DISTINCT FROM excluded.payload;   -- skip a no-op write
```

`ON CONFLICT` requires a unique index or constraint on the conflict target. The optional `WHERE`
avoids writing a new row version (a dead tuple) when nothing changed; on a hot cache table that alone
can remove most of the vacuum load. `DO NOTHING` is the idempotent-insert form.

## Sequences

- A restored dump can leave a sequence behind its table's maximum id: `setval` it after a data load
  that inserted explicit ids.
- `nextval` is **not** rolled back, so gaps are normal.
- `GENERATED ALWAYS AS IDENTITY` rejects an explicit value (`OVERRIDING SYSTEM VALUE` forces one);
  `GENERATED BY DEFAULT` allows it, which a data migration needs.

## Transactions and DDL

**DDL is transactional here** (even `TRUNCATE`): a half-applied schema change can be rolled back. The
exceptions are `CREATE INDEX CONCURRENTLY` / `REINDEX CONCURRENTLY`, which cannot run in a transaction
and need their own migration step.

- An error **aborts the whole transaction** until a rollback; `SAVEPOINT` is the tool for partial rollback.
- `REPEATABLE READ` behaves like SQL Server's `SNAPSHOT`, including serialisation failures the caller
  must retry.
- `SERIALIZABLE` raises a serialisation error instead of blocking, so **every** write path needs a
  retry policy for error class 40001.

## Reading a Postgres plan with SQL Server eyes

The slow-query ladder in `SKILL.md` applies unchanged; only the evidence is spelled differently.

| You would look for (SQL Server)        | Read instead (`EXPLAIN (ANALYZE, BUFFERS)`)                                  |
| -------------------------------------- | ---------------------------------------------------------------------------- |
| estimated vs actual rows               | `rows=` estimate vs `actual … rows=` — and actual time is **per loop**: multiply by `loops` |
| Key Lookup under Nested Loops          | `Index Scan` plus heap access; `Heap Fetches` high on an Index Only Scan means vacuum is behind |
| Scan of a big table                    | `Seq Scan` with a large `Rows Removed by Filter`                              |
| A sort or hash spilling to tempdb      | `Sort Method: external merge  Disk:` or `Batches` above 1 — `work_mem` too small for this query |
| Logical vs physical reads              | `Buffers: shared hit` vs `shared read`                                        |
