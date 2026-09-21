# The sqlcmd workflow — inspect first, change on purpose

## Read-only by default

The default posture is: **nothing changes**. Before any statement, decide which bucket it is in.

| Bucket                                    | Rule                                                              |
| ----------------------------------------- | ----------------------------------------------------------------- |
| `SELECT`, catalog views, DMVs, `SHOWPLAN` | run freely                                                        |
| `SET STATISTICS` / `SET SHOWPLAN`         | session-scoped, harmless                                          |
| `UPDATE STATISTICS`, `CREATE INDEX`, `ALTER`, DML | announce it, wrap it, verify it, keep the rollback ready   |
| `DROP`, `TRUNCATE`, `DELETE`/`UPDATE` without a predicate, `DBCC` with a repair option | do not run; ask |

Two habits that make a mistake survivable:

```sql
-- 1. Prove the row set before touching it: same FROM, same WHERE, as a SELECT.
SELECT * FROM dbo.Orders WHERE Status = 'Draft' AND CreatedAt < '2024-01-01';

-- 2. Then run the change inside a transaction you can throw away.
BEGIN TRANSACTION;
    UPDATE dbo.Orders SET Status = 'Expired'
     WHERE Status = 'Draft' AND CreatedAt < '2024-01-01';
    SELECT @@ROWCOUNT AS affected;          -- does it match the SELECT above?
-- ROLLBACK TRANSACTION;   -- default
-- COMMIT TRANSACTION;     -- only after the count matches
```

Leave the `ROLLBACK` uncommented in the file you hand to a reviewer. An open transaction blocks
other sessions, so do not walk away from step 2.

## Connecting

```powershell
$s = 'localhost,1433'; $db = 'AppDb'
$cred = @('-U', 'sa', '-P', $env:MSSQL_SA_PASSWORD)   # a container instance
# A Windows instance with integrated auth: -E instead of $cred.
# A connection string in a config file may name a different server: read it, do not guess.

sqlcmd -S $s -d $db @cred -C -Q 'SELECT DB_NAME() AS db, SUSER_SNAME() AS login'
```

| Flag                | Effect                                                            |
| ------------------- | ----------------------------------------------------------------- |
| `-C`                | trust the server certificate (a dev container has a self-signed one) |
| `-b`                | exit with a non-zero code on error — required in any script        |
| `-W -s '\|' -h -1`  | trimmed, pipe-separated, no headers: parseable output              |
| `-Q` / `-q`         | run and exit / run and stay in the interactive shell               |
| `-i file -o out`    | run a script file, write the output                                |
| `-v Name=Value`     | pass a variable, used in the script as `$(Name)`                   |
| `-l` / `-t`         | login timeout / query timeout, in seconds                          |

Never put a password literal in a file that gets committed. Read it from the environment, or from
the compose file's own environment section at run time.

## Schema inspection recipes

```sql
-- Tables by row count and size: where the data actually is
SELECT s.name + '.' + t.name AS tbl, SUM(p.rows) AS rows,
       SUM(a.total_pages) * 8 / 1024 AS mb
FROM sys.tables t
     JOIN sys.schemas s ON s.schema_id = t.schema_id
     JOIN sys.partitions p ON p.object_id = t.object_id AND p.index_id IN (0, 1)
     JOIN sys.allocation_units a ON a.container_id = p.partition_id
GROUP BY s.name, t.name ORDER BY rows DESC;
```

```sql
-- Columns of one table, with types, nullability and defaults
SELECT c.name, TYPE_NAME(c.user_type_id) AS type, c.max_length, c.precision, c.scale,
       c.is_nullable, c.is_identity, dc.definition AS default_definition
FROM sys.columns c
     LEFT JOIN sys.default_constraints dc ON dc.parent_object_id = c.object_id
                                        AND dc.parent_column_id = c.column_id
WHERE c.object_id = OBJECT_ID('dbo.Orders') ORDER BY c.column_id;
```

```sql
-- Foreign keys in and out: how this table is wired
SELECT fk.name, OBJECT_NAME(fk.parent_object_id) AS from_tbl,
       OBJECT_NAME(fk.referenced_object_id) AS to_tbl, fk.delete_referential_action_desc
FROM sys.foreign_keys fk
WHERE fk.parent_object_id = OBJECT_ID('dbo.Orders')
   OR fk.referenced_object_id = OBJECT_ID('dbo.Orders');
```

```sql
-- What would break if this object changed, and what it depends on
SELECT * FROM sys.dm_sql_referencing_entities('dbo.Orders', 'OBJECT');
SELECT * FROM sys.dm_sql_referenced_entities('dbo.Order_Cancel', 'OBJECT');
```

```sql
-- Find the code: every procedure, view, function or trigger mentioning a name
SELECT o.type_desc, s.name + '.' + o.name AS obj
FROM sys.sql_modules m
     JOIN sys.objects o ON o.object_id = m.object_id
     JOIN sys.schemas s ON s.schema_id = o.schema_id
WHERE m.definition LIKE '%' + 'CancelledBy' + '%' ORDER BY o.type_desc, obj;
```

`sys.sql_modules` is the search engine of a T-SQL-only codebase: it finds callers, dead objects and
copy-pasted logic that no file search in the repository can see.

```sql
-- Procedure hot list: total cost since the cache was last cleared
SELECT TOP 20 OBJECT_NAME(ps.object_id) AS proc_name, ps.execution_count,
       ps.total_worker_time / ps.execution_count AS avg_cpu,
       ps.total_elapsed_time / ps.execution_count AS avg_elapsed,
       ps.total_logical_reads / ps.execution_count AS avg_reads, ps.last_execution_time
FROM sys.dm_exec_procedure_stats ps
WHERE ps.database_id = DB_ID() ORDER BY ps.total_worker_time DESC;
```

## Scripting a whole schema

For a full schema dump, the SQL Server extension for the editor or the `SqlPackage` tool exports a
schema-only artefact; `sqlcmd` alone cannot script objects. For a quick diff of one object, compare
`OBJECT_DEFINITION` output between two environments.

## Where the connection details live

Read them, do not invent them: the compose file for the container, `appsettings*.json` /
user secrets for the application, and the design-time factory for EF projects. When a `Server=` value
disagrees between two of these, the application's configuration wins for reproducing a bug, and the
compose file wins for local experiments.
