---
name: db
description: >-
  Use when a query must run on the project's database or a table be described: row counts,
  "quante righe", "descrivi la tabella". Runs in db-analyst.
argument-hint: "\"<sql>\" | <table|schema> [--db <name>] [--env <target>]"
context: fork
agent: db-analyst
background: false
---

# db — one read-only query or table description, rows kept out of the main thread

**Contract.** Your agent's `/db` output · never writes, never echoes a credential · prose in the chat language;
SQL, object names and values verbatim.

Arguments: `$ARGUMENTS`

You start with no conversation history: this text, the project's files and your agent instructions
are everything you have.

## When

Not for: plan or index analysis on a slow query (your analysis mode, spawned by the caller, not
`/db`); writing T-SQL (`sql-server`); schema changes (`ef-core`).

## Decide

### Argument grammar — order free, every part optional

| Token | Meaning |
| --- | --- |
| `"<sql>"` (quoted, reads as SQL) | run it |
| a bare identifier | table → columns (type, nullability), primary key, foreign keys in and out, indexes, row count; schema → its tables with row counts |
| empty | list schemas and tables with row counts |
| `--db <name>` | override the database resolved from the project's config |
| `--env <env> [--engine <e>]` | an environment of the project in the local `db-targets.json` → `db-ro.ps1 -Env <env> [-Engine <e>]` (`--engine` `sql`, `postgres` or `redis` when the environment holds several); absent → the project's dev connection |

### Engine and connection — first match wins

| Evidence in the project | Engine |
| --- | --- |
| `Server=` / `Data Source=` with `Initial Catalog` / `Database` in `appsettings*.json` | SQL Server (integrated security → `-E`) |
| `Host=` / `Port=5432`, or `Npgsql` in a `.csproj` | Postgres |
| `<host>:6379`, `abortConnect=` and the question is about a key | Redis |
| an Aspire AppHost | resource names from the AppHost, the real port from `docker ps` |

### What runs

| Statement | Action |
| --- | --- |
| `SELECT`, `WITH … SELECT`, catalog views, `sp_help*`, `EXPLAIN` without `ANALYZE`, Redis read commands | run |
| DML, DDL, `EXEC` of a procedure not proven read-only, `;`-chained statements, Redis writes | refuse: print the statement, the target and the rows it would touch (`COUNT(*)` on the same predicate); a write is the user's to type |
| a read on a table of unknown size | `COUNT(*)` first, then `TOP 50` / `LIMIT 50`, projected to the columns that answer |

Head the report with one line: engine · host · database. An empty result: `0 rows` (at chat `it`:
`0 righe`) and what that rules out.

## Do

Describe: `sqlcmd … -Q "EXEC sp_help '<schema>.<table>'"` · `psql … --no-psqlrc -c "\d+ <schema>.<table>"`;
the client per host is your agent's Method table.

## Traps

1. `0 rows` on a guessed table or column → the name was wrong, not the data → describe first.
2. A dev connection string pointing at a shared server → it is non-dev → `db-ro.ps1`, or stop.
3. A row count from `sys.partitions` read as exact → it is an estimate → say so, or `COUNT(*)`.

## References

- `references/cause-and-quoting.md` — the `db-analyst` agent names the § it needs (clients when the client is not installed, quoting); not opened from here.
