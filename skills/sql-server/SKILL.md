---
name: sql-server
description: >-
  Use whenever T-SQL or a Postgres query is written or reviewed, a query or procedure is slow,
  times out or deadlocks, an index is being considered, a database must be inspected with sqlcmd or
  psql, or code touches the Postgres read cache through Npgsql and Dapper. Read-only by default.
---

# sql-server — T-SQL that performs, plus the Postgres read cache beside it

SQL Server is the system of record. Postgres appears only as a **read cache** next to it — Dapper
over Npgsql, schema managed outside EF — so its knowledge lives here as two references, not as a
skill of its own. Deep plan and index analysis is the `db-analyst` agent's job; the `/db` command
runs the query. This skill decides *what* to look at and what is allowed.

## When

- Writing or reviewing T-SQL: a query, a view, a function, a stored procedure, a data script.
- Something is slow, times out, deadlocks, or got slower after a deploy.
- Deciding whether an index is warranted for a real query.
- Inspecting an unfamiliar database: schema, row counts, what is running, what is blocked.
- Porting a query between SQL Server and Postgres, or touching the Npgsql/Dapper read cache.
- Needing a client — `sqlcmd` is installed locally; `psql` is **not** (run it through docker).

Not for: EF Core modelling, LINQ translation and migrations (`ef-core`), starting a container
(`docker-dev-env`), client-side latency (`dotnet-diagnostics`). Engine-release-dependent syntax:
read `SELECT @@VERSION` (or `SELECT version()`) and the compatibility level, then confirm with the
`microsoft-docs` plugin or the official Postgres docs.

## Decide

**Who does the work.**

| Need | Route |
| --- | --- |
| Run one query or describe a table, engine discovered for you | `/db` command |
| Read a plan, judge an index, explain a deadlock, review a schema before a migration | `db-analyst` agent — it returns the DDL, never runs it |
| A Postgres query, type or porting question | `references/from-sql-server.md` |
| Npgsql pooling, Dapper, the read-cache conventions | `references/npgsql-dotnet.md` |
| A stored procedure is the application | `references/stored-procedures.md` |
| Inspect or change a database by hand | `references/sqlcmd-workflow.md` |

**Slow query — the one ladder, both engines.** Pull the levers in order; the index is last.

| # | Check | SQL Server evidence | Postgres evidence | Verdict |
| - | --- | --- | --- | --- |
| 1 | Waiting, not working? | high duration, low CPU, a `blocking_session_id` | `pg_stat_activity.wait_event` set | blocked → find the head blocker, not the query |
| 2 | Fast for one value, slow for another? | plan compiled for a sniffed parameter | generic vs custom plan on a prepared statement | parameter-sensitive plan |
| 3 | Estimate vs actual off by 10x? | actual plan, `STATISTICS XML` | `EXPLAIN (ANALYZE, BUFFERS)`, per-loop times | stale statistics or a non-SARGable predicate |
| 4 | A function or type mismatch wrapping a column? | `CONVERT_IMPLICIT`, `CAST(col …)` | `lower(col)`, `col::text` | rewrite first — no index can help |
| 5 | Row-by-row work? | cursor, `WHILE`, scalar UDF, a call per row from the app | a function per row, a loop of statements | set-based rewrite |
| 6 | Lookups or a large scan for a selective filter? | Key/RID Lookup, Index Scan | `Seq Scan`, `Rows Removed by Filter` | now an index — hand it to `db-analyst` |
| 7 | Good plan, good index, still slow? | — | — | too much data asked for: page, pre-aggregate, narrow |

**Isolation — choose it, do not inherit it.** `READ COMMITTED` by default; read-committed snapshot
when readers must not block writers; `SNAPSHOT` for one consistent view (callers retry conflicts);
`SERIALIZABLE` only for no-phantom guarantees. **Never `NOLOCK`** to stop a report blocking — dirty,
missing and duplicated rows. Postgres never blocks readers, and its `SERIALIZABLE` raises 40001
instead of waiting: every write path there needs a retry.

**Write discipline.** Read-only unless the task is explicitly a change. Anything that writes —
DML, `UPDATE STATISTICS`, `CREATE INDEX`, `DBCC`, `ALTER` — is announced first, run inside an
explicit transaction, and verified with a `SELECT` before the `COMMIT`. Never `DROP`, `TRUNCATE` or
an unfiltered `UPDATE` against a database you did not create. In Postgres `EXPLAIN ANALYZE`
**executes** the statement: wrap a write in `BEGIN; … ROLLBACK;`.

**Where schema changes ship.** EF migrations become a `migration.sql` artifact in the build and run
through `sqlcmd` at deploy time (the `pipeline` skill's deploy reference). A hand-run DDL statement
on a shared database is drift the next migration will trip over.

## Do

```powershell
# Connection details: read them from appsettings / user secrets / the environment — never guess.
# An environment variable naming the instance can silently override the Server= of a config file.
Get-ChildItem Env: | Where-Object Name -match 'SQL|ConnectionStrings__'

$s = 'localhost,1433'; $db = '<Db>'
$cred = @('-U', '<user>', '-P', $env:MSSQL_PASSWORD)   # or -E for integrated auth
sqlcmd -S $s -d $db @cred -C -W -s '|' -h -1 -Q 'SELECT TOP 10 name FROM sys.tables ORDER BY name'
sqlcmd -S $s -d $db @cred -C -b -i .\inspect.sql -o .\out.txt      # -b: stop at the first error

# The estimated plan without executing anything
sqlcmd -S $s -d $db @cred -C -Q 'SET SHOWPLAN_XML ON; GO
SELECT * FROM dbo.<Table> WHERE <Col> = 42;'

# What is running and what is blocking, right now
$q = 'SELECT r.session_id, r.blocking_session_id, r.wait_type, r.wait_time, r.status,
      DB_NAME(r.database_id) AS db, SUBSTRING(t.text, 1, 120) AS stmt
      FROM sys.dm_exec_requests r CROSS APPLY sys.dm_exec_sql_text(r.sql_handle) t
      WHERE r.session_id <> @@SPID ORDER BY r.blocking_session_id DESC, r.wait_time DESC;'
sqlcmd -S $s -d master @cred -C -W -Q $q
```

No local `sqlcmd` or `psql`: run the client inside the service container or a throwaway one — the
recipes are in the `docker-dev-env` skill's clients-in-containers reference.

## Traps

1. Times out from the app but is instant in the client → different session `SET` options give a
   different plan → compare `sys.dm_exec_plan_attributes` before blaming the client.
2. An `nvarchar` parameter against a `varchar` column → `CONVERT_IMPLICIT` kills the seek → match
   the parameter type to the column (Dapper sends strings as `nvarchar` unless told otherwise).
3. `WHERE CAST(CreatedAt AS date) = @d` scans → use `>= @d AND < DATEADD(day, 1, @d)`.
4. A table variable in a large query → its estimate is one row → a `#temp` table carries statistics.
5. A missing-index suggestion applied verbatim → it ignores key order and existing indexes → treat
   it as a hint; `db-analyst` designs the key.
6. `UPDATE` with a `JOIN` and no predicate on the target → a whole-table rewrite → run the `SELECT`
   first, then the update inside a transaction.
7. A deadlock "out of nowhere" → two paths touching the same tables in opposite order → read the
   deadlock graph (`db-analyst`) before changing anything.
8. An `sp_`-prefixed procedure → resolved in `master` first → schema-qualify, never that prefix.
9. A Postgres query that worked on SQL Server misses rows → case-sensitive comparison, or an
   unquoted identifier folded to lower case → `references/from-sql-server.md`.
10. The read cache drifts from the source → its schema is not managed by EF, so no migration will
    ever fix it → change the cache DDL and its upserts together (`references/npgsql-dotnet.md`).

## References

- `references/sqlcmd-workflow.md` — inspecting a database read-only: connecting, schema, sizes,
  dependencies, what is running, and change scripts that can be rolled back.
- `references/stored-procedures.md` — writing and reviewing procedures: header, transactions, error
  handling, dynamic SQL, permissions.
- `references/from-sql-server.md` — porting to Postgres: identifiers, types, collation, syntax,
  upsert, sequences, transactional DDL, and what the Postgres plan says instead.
- `references/npgsql-dotnet.md` — the read cache from .NET: pooling against a process-per-connection
  server, Dapper conventions, type mapping, prepared statements, and `psql` through docker.
