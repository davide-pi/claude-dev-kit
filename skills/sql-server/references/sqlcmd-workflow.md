# The sqlcmd workflow — inspect first, change on purpose

## Which route, per host

| Host | SQL Server | Postgres | Redis |
| --- | --- | --- | --- |
| local dev (`localhost`, a compose service) | `sqlcmd` (installed) | `psql` native, else `docker compose exec -T <svc> psql`, else `wsl psql` | `docker compose exec -T <svc> redis-cli`, or `wsl redis-cli` |
| anything else (staging, production, a shared instance) | `/db` → `db-ro.ps1` | `/db` → `db-ro.ps1` | `/db` → `db-ro.ps1` |

`db-ro.ps1` runs inside the `db-analyst` agent: it probes the login's grants first and refuses (exit
3) on any write permission, picks the client form that exists (native, then wsl, then docker), and
keeps the secret out of argv. The shell hook denies a raw `sqlcmd`, `psql` or `redis-cli` aimed at
a non-dev host, also inside `docker run|exec` or `wsl` — do not retry around a denial. On a dev host,
or with no host given (the client's own local default), a client runs freely; the destructive-action
guard still asks before a `DROP`, a `TRUNCATE` or a `FLUSHALL` / `FLUSHDB`.

## Read-only by default

The default posture is: **nothing changes**. Before any statement, decide which bucket it is in.

| Bucket                                    | Rule                                                              |
| ----------------------------------------- | ----------------------------------------------------------------- |
| `SELECT`, catalog views, DMVs, `SHOWPLAN` | run freely                                                        |
| `SET STATISTICS` / `SET SHOWPLAN`         | session-scoped, harmless                                          |
| `UPDATE STATISTICS`, `CREATE INDEX`, `ALTER`, DML | announce it, wrap it, verify it, keep the rollback ready   |
| `DROP`, `TRUNCATE`, `DELETE`/`UPDATE` without a predicate, `DBCC` with a repair option | do not run; ask |

Prove the row set with a `SELECT` (same FROM, same WHERE), then run the change inside a transaction
with `SELECT @@ROWCOUNT` and the `ROLLBACK TRANSACTION` left uncommented in the file you hand to a
reviewer (`COMMIT` only after the count matches). An open transaction blocks other sessions: do not
walk away from it.

## Connecting

```powershell
$s = 'localhost,1433'; $db = 'AppDb'
$env:SQLCMDPASSWORD = $env:MSSQL_SA_PASSWORD   # a container instance; never -P on the command line
# A Windows instance with integrated auth: -E instead of -U.
# A connection string in a config file may name a different server: read it, do not guess.

sqlcmd -S $s -d $db -U sa -C -Q 'SELECT DB_NAME() AS db, SUSER_SNAME() AS login'
```

| Flag                | Effect                                                            |
| ------------------- | ----------------------------------------------------------------- |
| `-C`                | trust the server certificate (a dev container has a self-signed one) |
| `-b`                | exit with a non-zero code on error — required in any script        |
| `-W -s '\|' -h -1`  | trimmed, pipe-separated, no headers: parseable output              |

Never put a password literal in a file that gets committed.

## Inspection recipes

`sys.sql_modules` is the search engine of a T-SQL-only codebase: it finds callers, dead objects and
copy-pasted logic that no file search in the repository can see.

```sql
-- Find the code: every procedure, view, function or trigger mentioning a name
SELECT o.type_desc, s.name + '.' + o.name AS obj
FROM sys.sql_modules m
     JOIN sys.objects o ON o.object_id = m.object_id
     JOIN sys.schemas s ON s.schema_id = o.schema_id
WHERE m.definition LIKE '%' + 'CancelledBy' + '%' ORDER BY o.type_desc, obj;

-- What would break if this object changed, and what it depends on
SELECT * FROM sys.dm_sql_referencing_entities('dbo.Orders', 'OBJECT');
SELECT * FROM sys.dm_sql_referenced_entities('dbo.Order_Cancel', 'OBJECT');

-- Procedure hot list: total cost since the cache was last cleared
SELECT TOP 20 OBJECT_NAME(ps.object_id) AS proc_name, ps.execution_count,
       ps.total_worker_time / ps.execution_count AS avg_cpu,
       ps.total_elapsed_time / ps.execution_count AS avg_elapsed,
       ps.total_logical_reads / ps.execution_count AS avg_reads, ps.last_execution_time
FROM sys.dm_exec_procedure_stats ps
WHERE ps.database_id = DB_ID() ORDER BY ps.total_worker_time DESC;
```

`sqlcmd` cannot script objects: for a full schema dump use the SQL Server editor extension or
`SqlPackage` (schema-only artefact); for one object, compare `OBJECT_DEFINITION` between environments.

## Where the connection details live

Read them, do not invent them: the compose file for the container, `appsettings*.json` / user secrets
for the application, and the design-time factory for EF projects. When a `Server=` value disagrees
between two of these, the application's configuration wins for reproducing a bug, and the compose file
wins for local experiments.
