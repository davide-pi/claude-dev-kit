---
name: sql-server
description: >-
  SQL Server and T-SQL engineering: set-based queries that perform, SARGable predicates, designing
  an index from a real query, reading an execution plan, statistics and parameter sniffing, locking,
  blocking and deadlock diagnosis, isolation levels chosen deliberately, stored-procedure
  conventions for a database-only codebase, and the sqlcmd workflow for running a query, inspecting
  a schema or finding what is blocking right now. Use when writing or reviewing T-SQL, when a query
  or procedure is slow or times out, when a deadlock or blocking chain appears, when deciding which
  index to create, or when inspecting an unfamiliar database. Read-only by default.
---

# sql-server — T-SQL that performs, plans you can read, changes you can defend

## When

- Writing or reviewing T-SQL: a query, a view, a function, a stored procedure, a data script.
- Something is slow, times out, or got slower after a deploy.
- Deciding whether to add an index, and which one, from an actual query.
- Diagnosing blocking, a deadlock, or a lock-escalation problem.
- Inspecting an unfamiliar database: schema, row counts, what is running, what is blocked.
- Working in the pure T-SQL codebase, where stored procedures *are* the application.

Not for: EF Core modelling, LINQ translation and migration mechanics (`ef-core`),
Postgres (`postgres`), starting the container (`docker-dev-env`), client-side latency
(`dotnet-diagnostics`). For syntax or feature availability that depends on the engine release, read
`SELECT @@VERSION` and the database compatibility level in `sys.databases`, then confirm with the
`microsoft-docs` plugin.

## Decide

**Slow query — pull the levers in this order.** The index is the last step, not the first.

| # | Check                                                                     | Verdict                                                                   |
| - | ------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 1 | High duration, low CPU, and it waits?                                     | It is blocked, not slow → `references/locking-blocking.md`                 |
| 2 | Fast for one parameter value, slow for another?                           | Parameter sniffing → `references/execution-plans.md`                      |
| 3 | Estimated vs actual rows off by 10x or more?                              | Stale statistics, a non-SARGable predicate, or sniffing                   |
| 4 | Any function, `ISNULL`, concatenation or type mismatch wrapping a column? | Non-SARGable → rewrite first → `references/query-tuning.md`               |
| 5 | A cursor, `WHILE` loop, scalar UDF, or a per-row call from the app?       | Rewrite set-based → `references/query-tuning.md`                          |
| 6 | Plan dominated by Key or RID Lookups under a Nested Loops?                | Non-covering index → `INCLUDE` the columns → `references/index-design.md` |
| 7 | Scan of a large table for a selective predicate?                          | Missing or unusable index → `references/index-design.md`                  |
| 8 | Still slow with a good plan and a good index?                             | Too much data asked for: paginate, pre-aggregate, narrow the projection   |

**Rewrite or index?** A rewrite is free at runtime and always tried first; an index is a permanent
write-path and storage cost that has to be justified.

| Symptom                                     | Rewrite                               | Index                            |
| ------------------------------------------- | ------------------------------------- | -------------------------------- |
| Predicate not SARGable                      | yes — the index cannot be used anyway | no                               |
| `SELECT *` feeding a lookup-heavy plan      | project only the columns needed       | maybe, after narrowing           |
| Selective filter with no supporting index   | no                                    | yes                              |
| `ORDER BY` producing a spilling sort        | no                                    | yes — order the key to match     |
| Same table read three times in one query    | one pass with window functions        | no                               |
| Row-by-row loop                             | set-based, always                     | often unnecessary afterwards     |

**Isolation level — choose it, do not inherit it.**

| Need                                                  | Level                              | Price                                        |
| ----------------------------------------------------- | ---------------------------------- | -------------------------------------------- |
| Default transactional work                            | `READ COMMITTED`                   | readers block on writers                     |
| Reads that must not block writers                     | read-committed snapshot on the db  | tempdb version store, longer writes          |
| One consistent view across several statements         | `SNAPSHOT`                         | update-conflict errors the caller must retry |
| No phantom rows at all (a reservation, a number draw) | `SERIALIZABLE`                     | key-range locks, more deadlocks              |
| "Just make the report stop blocking"                  | **not** `NOLOCK`                   | dirty, missing and duplicated rows           |

**Write discipline.** Read-only unless the task is explicitly a change. Anything that writes —
`INSERT`/`UPDATE`/`DELETE`, `UPDATE STATISTICS`, `CREATE INDEX`, `DBCC`, `ALTER` — is announced
first, run inside an explicit transaction, and verified with a `SELECT` before the `COMMIT`. Never
run `DROP`, `TRUNCATE` or an unfiltered `UPDATE` against a database you did not create yourself.

## Do

```powershell
# Which sqlcmd is on PATH decides the flag set: `sqlcmd -?` shows it.
$s = 'localhost,1433'; $db = 'AppDb'
$cred = @('-U', 'sa', '-P', $env:MSSQL_SA_PASSWORD)   # from the environment, never a literal
# Against a Windows instance with integrated auth: use -E and drop $cred.

# One query, pipe-separated, no banner and no row count — parseable output
sqlcmd -S $s -d $db @cred -C -W -s '|' -h -1 -Q 'SELECT TOP 10 name FROM sys.tables ORDER BY name'

# A script file, stopping at the first error instead of ploughing on
sqlcmd -S $s -d $db @cred -C -b -i .\inspect.sql -o .\out.txt

# The estimated plan without executing anything (safe against production-shaped data)
sqlcmd -S $s -d $db @cred -C -Q 'SET SHOWPLAN_XML ON; GO
SELECT * FROM dbo.Orders WHERE CustomerId = 42;'

# The actual plan plus reads and timings, for a query you are willing to run
sqlcmd -S $s -d $db @cred -C -Q 'SET STATISTICS IO, TIME ON; SET STATISTICS XML ON; SELECT ...;'

# What is running and what is blocking, right now
$q = 'SELECT r.session_id, r.blocking_session_id, r.wait_type, r.wait_time, r.status,
      DB_NAME(r.database_id) AS db, SUBSTRING(t.text, 1, 120) AS stmt
      FROM sys.dm_exec_requests r CROSS APPLY sys.dm_exec_sql_text(r.sql_handle) t
      WHERE r.session_id <> @@SPID ORDER BY r.blocking_session_id DESC, r.wait_time DESC;'
sqlcmd -S $s -d master @cred -C -W -Q $q
```

From inside the container instead of the host: `docker compose exec <service> bash -lc 'sqlcmd ...'`
— the bundled tools live under a versioned path, so glob it rather than hardcoding it.

## Traps

1. Times out from the app but is instant in the client → different session `SET` options produce a
   different plan → compare `sys.dm_exec_plan_attributes`, then look at parameter sniffing rather
   than blaming the client.
2. An `nvarchar` parameter filtering a `varchar` column → `CONVERT_IMPLICIT` lands on the column and
   kills the seek → match the parameter type to the column type.
3. `WHERE CAST(CreatedAt AS date) = @d` scans → the function wraps the column → use
   `>= @d AND < DATEADD(day, 1, @d)`.
4. A cursor "because the logic is per row" → thousands of round trips inside the engine → one
   set-based statement, an `OUTPUT` clause, or a window function; a cursor needs a stated reason.
5. A table variable inside a large query picks a bad plan → its estimate is one row → use a `#temp`
   table, which carries statistics.
6. `NOLOCK` sprinkled around to stop blocking → dirty reads, skipped and duplicated rows in reports
   → enable read-committed snapshot on the database instead.
7. An `sp_`-prefixed procedure in a user database → the engine resolves it in `master` first →
   schema-qualify and never use that prefix.
8. A missing-index suggestion applied verbatim → it ignores key order and the indexes already there
   → treat it as a hint and design the key yourself.
9. `UPDATE` with a `JOIN` and no predicate on the target → a whole-table rewrite in one statement →
   run the equivalent `SELECT` first, then wrap the update in a transaction.
10. A deadlock "out of nowhere" → two code paths touching the same tables in a different order →
    read the deadlock graph before changing anything.

## References

- `references/query-tuning.md` — the query needs rewriting: set-based patterns, SARGability, the
  constructs that silently serialise execution.
- `references/index-design.md` — deciding what index to create from an actual query, and finding the
  duplicates and unused ones already there.
- `references/execution-plans.md` — reading a plan, the operators that signal trouble, statistics,
  parameter sniffing, Query Store.
- `references/locking-blocking.md` — blocking chains, lock escalation, and deadlock graphs from the
  system health session and the error log.
- `references/stored-procedures.md` — writing and reviewing procedures in a T-SQL-only codebase:
  header, transactions, error handling, dynamic SQL, permissions.
- `references/sqlcmd-workflow.md` — inspecting a database read-only: schema, sizes, dependencies,
  what is running, and change scripts that can be rolled back.
