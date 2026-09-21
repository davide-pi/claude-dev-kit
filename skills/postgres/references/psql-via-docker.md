# The Postgres client without a local binary

`psql`, `pg_dump` and `pg_restore` are **not installed on this machine**. Every recipe below runs the
client that already ships inside the Postgres image, so client and server always match.

## Find the service first

```powershell
docker compose ps                      # which services are up, and their names
docker compose config --services       # the names the compose file defines
docker compose exec -T postgres psql -U postgres -c "select version()"
```

Read the user, password and database from the compose file's environment section — do not guess
`postgres`/`postgres`. If the credentials come from an `.env` file, `docker compose config` prints
the resolved values.

## The three shapes of invocation

```powershell
$svc = 'postgres'; $u = 'app'; $db = 'appcache'

# 1. One statement, machine-readable: no headers, no alignment, explicit separator, stop on error
docker compose exec -T $svc psql -U $u -d $db -v ON_ERROR_STOP=1 -At -F "`t" -c "select 1"

# 2. Interactive, for exploration
docker compose exec -it $svc psql -U $u -d $db

# 3. A local script file, piped in (no copy into the container, no volume mount)
Get-Content .\script.sql | docker compose exec -T $svc psql -U $u -d $db -v ON_ERROR_STOP=1
```

`-T` disables TTY allocation and is **required** whenever the command is not interactive — without
it, piping and output capture in PowerShell misbehave. Use `-it` only for the interactive shell.

No compose file (a standalone container or a remote instance): run a throwaway client from the image
the project already uses, on the same network.

```powershell
docker network ls                       # find the network the server is on
docker run --rm -it --network <net> <the-image-the-compose-file-names> `
  psql -h <server-host> -U $u -d $db    # it will prompt for the password
```

Pass a password non-interactively with `-e PGPASSWORD=$env:PGPASSWORD` on `docker run`, never as a
command-line argument (it lands in the shell history and in `docker inspect`).

## psql flags worth knowing

| Flag                  | Effect                                                          |
| --------------------- | --------------------------------------------------------------- |
| `-c "sql"`            | run one statement and exit                                      |
| `-f file`             | run a file (inside the container; prefer piping from the host)   |
| `-v ON_ERROR_STOP=1`  | exit non-zero on the first error — mandatory in scripts          |
| `-A`                  | unaligned output                                                 |
| `-t`                  | tuples only, no header and no row count                          |
| `-F sep`              | field separator                                                  |
| `--csv`               | proper CSV, quoting included                                     |
| `-1`                  | wrap the whole file in a single transaction                      |
| `-E`                  | echo the SQL that a backslash command runs — how to learn the catalog queries |
| `-P pager=off`        | never page; important when the output is captured                |

## Meta-commands (the interactive vocabulary)

| Command        | Shows                                                        |
| -------------- | ------------------------------------------------------------ |
| `\l`           | databases, with owner, encoding and collation                 |
| `\dn`          | schemas                                                       |
| `\dt`, `\dt+`  | tables; `+` adds size and description                         |
| `\d name`      | one table: columns, indexes, constraints, triggers            |
| `\d+ name`     | the same plus storage, statistics target and comments         |
| `\di`, `\di+`  | indexes and their sizes                                       |
| `\df`, `\sf f` | functions; `\sf` prints one function's source                 |
| `\dv`, `\dm`   | views and materialised views                                  |
| `\du`          | roles and their attributes                                    |
| `\dp`          | table privileges                                              |
| `\x auto`      | expanded output — essential for wide rows and plans           |
| `\timing on`   | wall-clock per statement                                      |
| `\watch 2`     | re-run the last query every 2 seconds (a live monitor)        |
| `\copy`        | client-side COPY, reads and writes files on the client side    |

## Dump, restore and copy

```powershell
# Schema only, one table — the fastest way to see exactly how something is defined
docker compose exec -T $svc pg_dump -U $u -d $db --schema-only --table=public.orders

# Whole database, custom format, to a file on the host
docker compose exec -T $svc pg_dump -U $u -d $db -Fc | Set-Content -Path .\db.dump -AsByteStream

# Restore that file into a container, dropping and recreating objects it owns
Get-Content .\db.dump -AsByteStream | docker compose exec -T $svc pg_restore -U $u -d $db --clean --if-exists

# Data out as CSV, and back in
docker compose exec -T $svc psql -U $u -d $db -c "\copy (select * from orders) to stdout with csv header" > orders.csv
Get-Content .\orders.csv | docker compose exec -T $svc psql -U $u -d $db -c "\copy orders from stdin with csv header"
```

`-AsByteStream` matters: a dump in custom format is binary, and PowerShell will otherwise corrupt it
with text encoding. `pg_restore --clean` **drops objects** — announce it, and never point it at a
database you did not create.

## Read-only inspection queries

```sql
-- Sizes: where the disk went
select relname, pg_size_pretty(pg_total_relation_size(relid)) as total,
       pg_size_pretty(pg_relation_size(relid)) as heap, n_live_tup, n_dead_tup
from pg_stat_user_tables order by pg_total_relation_size(relid) desc limit 20;

-- Index usage: idx_scan = 0 with a non-trivial size is dead weight
select relname, indexrelname, idx_scan, pg_size_pretty(pg_relation_size(indexrelid)) as size
from pg_stat_user_indexes order by idx_scan, pg_relation_size(indexrelid) desc;

-- What is running, what is blocked, what is idle in a transaction
select pid, state, wait_event_type, wait_event, xact_start, query_start,
       left(query, 120) as query, pg_blocking_pids(pid) as blocked_by
from pg_stat_activity where pid <> pg_backend_pid() order by xact_start;

-- Slowest statements by total time, when the statement-statistics extension is installed
select calls, total_exec_time, mean_exec_time, rows, left(query, 120)
from pg_stat_statements order by total_exec_time desc limit 20;
```

`pg_stat_statements` needs the extension loaded at server start; if the query errors, it is not
enabled — say so rather than adding it to a database you do not own.
