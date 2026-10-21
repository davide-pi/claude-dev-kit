---
name: db
description: >-
  Use when a query must run on the project's database or a table be described: row counts, a
  value check, a schema. Runs in db-analyst.
argument-hint: "\"<sql>\" | <table|schema> [--db <name>] [--env <target>]"
context: fork
agent: db-analyst
background: false
---

# db — one read-only query or table description, rows kept out of the main thread

**Contract.** The statement as run, ≤ 50 rows as a table, one reading line · never writes, never
reaches a non-dev host except through `db-ro.ps1`, never echoes a credential · prose in Italian;
SQL, object names and values verbatim.

Arguments: `$ARGUMENTS`

You start with no conversation history: this text, the project's files and your agent instructions
are everything you have. You cannot ask the user — where a choice is needed, name the candidates and
stop; the caller asks.

## When

- `"<sql>"` → run it, read-only. `<table>` or `<schema>` → describe it. Empty → list schemas and
  tables with row counts.

Not for: plan or index analysis on a slow query (your analysis mode, spawned by the caller, not
`/db`); writing T-SQL (`sql-server`); schema changes (`ef-core`).

## Decide

### Argument grammar — order free, every part optional

| Token | Meaning |
| --- | --- |
| `"<sql>"` (quoted, reads as SQL) | run it |
| a bare identifier | table → columns (type, nullability), primary key, foreign keys in and out, indexes, row count; schema → its tables with row counts |
| `--db <name>` | override the database resolved from the project's config |
| `--env <target>` | a named target in the local `db-targets.json` → `db-ro.ps1 -Env <target>`; absent → the project's dev connection |
| `--write` | refused: print the statement, the target and the rows it would touch (`COUNT(*)` on the same predicate); a write is typed by hand in the main thread after the user's explicit yes |

### Engine and connection — first match wins

| Evidence in the project | Engine |
| --- | --- |
| `Server=` / `Data Source=` with `Initial Catalog` / `Database` in `appsettings*.json` | SQL Server |
| `Host=` / `Port=5432`, or `Npgsql` in a `.csproj` | Postgres |
| `<host>:6379`, `abortConnect=` and the question is about a key | Redis |
| an Aspire AppHost | resource names from the AppHost, the real port from `docker ps` |
| several candidate connections and no `--db` / `--env` | name them and stop |

Integrated security → `-E`. A password in a connection string is masked before anything is printed.

### What runs

| Statement | Action |
| --- | --- |
| `SELECT`, `WITH … SELECT`, catalog views, `sp_help*`, `EXPLAIN` without `ANALYZE`, Redis read commands | run |
| DML, DDL, `EXEC` of a procedure not proven read-only, `;`-chained statements | refuse as `--write` |
| a read on a table of unknown size | `COUNT(*)` first, then `TOP 50` / `LIMIT 50`, projected to the columns that answer |
| a non-dev host | only `db-ro.ps1`; exit `3` = a write grant was found → stop and report, no other route |

### Report — returned to the caller, ≤ 55 lines

1. One line: engine · host · database (never credentials).
2. The statement exactly as run, fenced `sql`.
3. The rows as a markdown table, real column names as headers; more than 50 → the count and the
   first 50.
4. One Italian reading line where the result is not self-explanatory. Empty → `0 righe` and what
   that rules out.

## Do

```powershell
# connection candidates, passwords masked
Get-ChildItem -Recurse -Depth 4 -Filter appsettings*.json |
  Select-String -Pattern 'Server=|Data Source=|Host=' |
  ForEach-Object { "{0}: {1}" -f $_.Filename, ($_.Line -replace '(?i)(Password|Pwd)=[^;"]*', '$1=***') }
docker compose ps     # a database running in the project's stack, and its service name

# describe — SQL Server, then Postgres
sqlcmd -S <host> -d <db> -E -W -s "|" -Q "EXEC sp_help '<schema>.<table>'"
psql -h <host> -U <user> -d <db> --no-psqlrc -c "\d+ <schema>.<table>"
```

The client per host (dev direct or inside the container, everything else `db-ro.ps1`) is your agent
table; follow it.

## Traps

1. `0 righe` on a guessed table or column → the name was wrong, not the data → describe first.
2. A dev connection string pointing at a shared server → it is non-dev → `db-ro.ps1`, or stop.
3. A refused command retried with another client → the hook denies by host, not by tool → report
   the refusal.
4. A row count from `sys.partitions` read as exact → it is an estimate → say so, or `COUNT(*)`.
