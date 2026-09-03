---
description: Inspect the current project's database — discover the engine and connection, then run a query or describe a schema. Read-only unless the invocation says --write.
argument-hint: "\"<query>\" | <table|schema> [--write] [--db <name>]"
---

Query or describe the database this project actually uses. Engine discovery happens here; the SQL
itself belongs to **`sql-server`** or **`postgres`**, and the container plumbing to
**`docker-dev-env`**. **Read-only by default** — a statement that writes runs only when the
invocation carries `--write`.

## Argument grammar

- **`"<sql>"`** (quoted, looks like SQL) → run it.
- **`<name>`** (a bare identifier) → describe it: columns with types and nullability, primary key,
  foreign keys in and out, indexes, row count. A schema name → list its tables with row counts.
- *(empty)* → list schemas and tables with row counts, so the user can pick.
- **`--write`** → authorises one write for this invocation only, and only the statement given.
- **`--db <name>`** → override the database resolved in step 2.

## Steps

1. **Find the engine.** Read, in this order, and stop at the first answer:
   ```powershell
   Get-ChildItem -Path . -Recurse -Depth 4 -Include appsettings*.json,docker-compose*.y*ml |
     Select-Object -ExpandProperty FullName
   Get-ChildItem -Path . -Recurse -Depth 4 -Filter appsettings*.json |
     Select-String -Pattern "ConnectionStrings" -Context 0,8
   ```
   `Server=`/`Data Source=` with `Initial Catalog`/`Database` → SQL Server. `Host=`/`Port=5432` or
   `Npgsql` in the csproj → Postgres. An Aspire AppHost → the connection is generated at run time:
   read the resource names from the AppHost and get the real port from `docker ps`.

2. **Resolve the connection** — server, database, and auth. Integrated security → `-E`. A password
   in the string is **never** echoed, never pasted into a report, never written to a file.
   Ambiguity between several connection strings → ask which, do not pick.

3. **Run it — SQL Server** (`sqlcmd` is installed):
   ```powershell
   sqlcmd -S <server> -d <db> -E -W -Q "SELECT TOP 50 ..."
   sqlcmd -S <server> -d <db> -U <user> -C -W -Q "..."     # -C only for a local dev container cert
   ```

4. **Run it — Postgres.** `psql` is **not installed**: it runs inside the container.
   ```powershell
   docker compose ps
   docker exec -i <container> psql -U <user> -d <db> -c "SELECT ... LIMIT 50;"
   ```
   No container for it (a remote or hosted Postgres) → say so and stop; do not improvise a client.

5. **Bound every read.** `TOP 50` / `LIMIT 50` unless the user asked for more, and a `COUNT(*)`
   first when the table's size is unknown. `SELECT *` on a wide table is projected down to the
   columns that answer the question. A query that scans a large table is described before it is run.

6. **Describe** — one query against the catalog, per the engine's skill: `INFORMATION_SCHEMA` plus
   `sys.indexes` on SQL Server, `information_schema` plus `pg_indexes` on Postgres.

7. **Report in Italian** — the prose, the reading and the answer to the question. Everything that
   is a machine value is pasted **verbatim and untranslated**: the SQL statement, schema, table,
   column and constraint names, the returned values, and any engine message. Layout: the engine,
   server and database on one line (never credentials) · the exact statement run · the rows as a
   markdown table keeping the real column names as headers, truncated with the count stated · one
   line of reading where the result is not self-explanatory. Empty result set → "0 righe", plus
   what that rules out.

## Writes

`INSERT`, `UPDATE`, `DELETE`, `MERGE`, DDL and anything calling a procedure that writes require
`--write` **in this invocation**. With it: show the statement, state the target database, state the
rows it will affect (`SELECT COUNT(*)` on the same predicate first), ask in Italian and get an
explicit yes — the statement inside the question stays verbatim — then run it inside an explicit
transaction. Without it: refuse, print the statement, and say `--write` is
needed. A previous `--write` never carries over to the next invocation.

## Guardrails

- **`DROP`, `TRUNCATE`, `ALTER … DROP`, `sp_detach_db`, `DROP DATABASE`: never**, `--write` or not.
  Schema change is `/migrate`; a real drop is a deliberate, hand-typed act.
- **No `DELETE`/`UPDATE` without a `WHERE`** — refuse it as a typo, always.
- **Development databases only.** A connection string that names a staging or production host stops
  the command: say which host and stop.
- Never print, log or write a password, token or full connection string. Server and database name
  only.
- Do not create, restore or seed a database, and do not install a client: `docker-dev-env` owns the
  stack.
- Do not run migrations from here, in either direction.
