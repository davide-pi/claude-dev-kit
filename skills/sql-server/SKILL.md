---
name: sql-server
description: >-
  Use when T-SQL or Postgres SQL is written or reviewed, a query or procedure is slow or
  deadlocks, an index proposed, or Npgsql read-cache changes.
paths: "**/*.sql"
---

# sql-server — T-SQL that performs, plus the Postgres read cache beside it

**Contract.** SQL that performs, and the evidence that says so · read-only by default; a non-dev host
only through `/db`, never DDL on a shared database · explanations in Italian, SQL, plan operators
and object names verbatim.

## When

Not for: EF modelling, LINQ translation, migrations (`ef-core`); starting a database container
(`docker-dev-env`); client-side latency (`dotnet-diagnostics`).

House facts: rule `sql`.

## Decide

SQL Server is the system of record. Postgres is only a **read cache** beside it — Dapper over
Npgsql, schema managed outside EF.

### Who does the work

| Need | Route |
| --- | --- |
| run one query or describe a table, on any host | `/db` — runs in `db-analyst`; non-dev hosts go through `db-ro.ps1`, the shell hook denies a raw client there |
| read a plan, judge an index, explain a deadlock, review a schema before a migration | `db-analyst` agent — returns the DDL, never runs it |
| a Postgres query, type or porting question | `references/from-sql-server.md` |
| Npgsql pooling, Dapper, read-cache conventions | `references/npgsql-dotnet.md` |
| a stored procedure is the application | `references/stored-procedures.md` |
| inspect or change a local database by hand | `references/sqlcmd-workflow.md` |

### Slow query — one ladder, both engines; the index is last

| # | Check | SQL Server evidence | Postgres evidence | Verdict |
| - | --- | --- | --- | --- |
| 1 | waiting, not working? | high duration, low CPU, a `blocking_session_id` | `pg_stat_activity.wait_event` set | blocked → the head blocker, not the query |
| 2 | fast for one value, slow for another? | plan compiled for a sniffed parameter | generic vs custom plan on a prepared statement | parameter-sensitive plan |
| 3 | estimate vs actual off by 10x? | actual plan, `STATISTICS XML` | `EXPLAIN (ANALYZE, BUFFERS)`, per-loop times | stale statistics or a non-SARGable predicate |
| 4 | row-by-row work? | cursor, `WHILE`, scalar UDF, a call per row from the app | a function per row, a statement loop | set-based rewrite |
| 5 | lookups or a large scan for a selective filter? | Key/RID Lookup, Index Scan | `Seq Scan`, `Rows Removed by Filter` | now an index — `db-analyst` designs it |
| 6 | good plan, good index, still slow? | — | — | too much data asked for: page, pre-aggregate, narrow |

### Isolation — choose it, never inherit it

`READ COMMITTED` by default; RCSI when readers must not block writers; `SNAPSHOT` for one consistent
view (callers retry conflicts); `SERIALIZABLE` only against phantoms. **Never `NOLOCK`**: dirty,
missing, duplicated rows. Postgres `SERIALIZABLE` raises 40001 instead of waiting: writes retry.

### Writes

| Statement | Rule |
| --- | --- |
| DML, `UPDATE STATISTICS`, `CREATE INDEX`, `ALTER` on a local database | announced; the `@DryRun` script of rule `sql`: rollback by default, commit only at `@DryRun = 0` |
| `DROP`, `TRUNCATE`, an unfiltered `UPDATE`/`DELETE` on a database you did not create | never — ask |
| Postgres `EXPLAIN ANALYZE` of a write | it **executes**: wrap it in `BEGIN; … ROLLBACK;` |
| a schema change for a shared database | an EF migration shipped as `migration.sql` (`pipeline`); hand-run DDL is drift |

## Do

```powershell
# Connection details come from appsettings / user secrets / the environment — never guessed.
# An environment variable naming the instance can silently override a config file's Server=.
Get-ChildItem Env: | Where-Object Name -match 'SQL|ConnectionStrings__'

$s = 'localhost,1433'; $db = '<Db>'; $env:SQLCMDPASSWORD = $env:MSSQL_PASSWORD   # or -E, integrated
sqlcmd -S $s -d $db -U <user> -C -W -s '|' -h -1 -Q 'SELECT TOP 10 name FROM sys.tables ORDER BY name'

# What is running and what is blocking, right now
sqlcmd -S $s -d master -U <user> -C -W -Q 'SELECT r.session_id, r.blocking_session_id, r.wait_type,
  r.wait_time, DB_NAME(r.database_id) AS db, SUBSTRING(t.text, 1, 120) AS stmt
  FROM sys.dm_exec_requests r CROSS APPLY sys.dm_exec_sql_text(r.sql_handle) t
  WHERE r.session_id <> @@SPID ORDER BY r.blocking_session_id DESC, r.wait_time DESC;'
```

## Traps

1. Times out from the app, instant in the client → different session `SET` options, different plan →
   compare `sys.dm_exec_plan_attributes` before blaming the client.
2. Dapper sends strings as `nvarchar` → against a `varchar` column, `CONVERT_IMPLICIT` kills the seek
   → declare the parameter type.
3. A table variable in a large query → estimated at one row → a `#temp` table carries statistics.
4. A missing-index suggestion applied verbatim → it ignores key order and existing indexes → a hint
   for `db-analyst`, not DDL.
5. A deadlock "out of nowhere" → two paths taking the same tables in opposite order → the deadlock
   graph (`db-analyst`) before any change.
6. An `sp_`-prefixed procedure → resolved in `master` first → schema-qualify, never that prefix.
7. A Postgres port misses rows → case-sensitive comparison, or an identifier folded to lower case.
8. The read cache drifts from the source → no EF migration fixes it → its DDL and upserts change together.

## References

- `references/sqlcmd-workflow.md` — read-only inspection: connecting, finding code, dependencies,
  the procedure hot list, change scripts that roll back, which route per host.
- `references/stored-procedures.md` — header, transactions, error handling, dynamic SQL, permissions.
- `references/from-sql-server.md` — porting to Postgres: identifiers, types, collation, upsert,
  sequences, transactional DDL, reading the Postgres plan.
- `references/npgsql-dotnet.md` — the read cache from .NET: pooling, Dapper, type mapping, prepared
  statements.
