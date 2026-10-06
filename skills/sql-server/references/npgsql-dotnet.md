# Npgsql and the Postgres read cache — what differs from SqlClient

## The read cache, as it is built here

Postgres is a **derived** store: services that serve heavy reads keep a denormalised copy of
system-of-record data in it, written by a cache-updater and read by query services. Recognise it by a
`*.Infrastructure.PostgreSql` project next to the EF data project.

| Fact | Consequence |
| --- | --- |
| Accessed with Dapper over `NpgsqlConnection`; no EF model, no migrations | the SQL **is** the contract — a column rename is a change to the DDL *and* every query string, by hand |
| A singleton service holds the connection string and opens `new NpgsqlConnection(...)` per call, `Pooling=true` | the pool is per connection string — one stray character creates a second pool |
| Writes are `INSERT … ON CONFLICT (key) DO UPDATE` upserts | the conflict target needs a unique index; a missing one is an error, not a slow query |
| Payload columns are `jsonb` | read whole, queried by one or two keys; a field filtered constantly belongs in a column |
| Each deployed service appends `Application Name=<service>` to the connection string | `pg_stat_activity.application_name` tells you which service holds a connection |
| It is rebuildable from SQL Server | a wrong cache is repaired by re-running the updater, never by hand-editing rows |

## The connection is a server process

| Concern | SqlClient | Npgsql |
| --- | --- | --- |
| Server cost per connection | a thread | a forked **process** — keep the pool small and deliberate |
| Plan caching | server-side, automatic | client-side, prepared statements only |
| Many app instances | a pool each is fine | total backends is the budget: `SHOW max_connections;` ÷ instances |
| Cancellation | best effort | a real cancel request on a second connection |

Size `Maximum Pool Size` against that budget, not against the request rate. `Connection Idle
Lifetime` returns idle backends; `Timeout` is the **connect** timeout, `Command Timeout` the per-command
one — raise it on the one slow report, not globally.

**Prepared statements are the performance switch.** An ad-hoc parameterised statement is re-planned
every time. `Max Auto Prepare` (with `Auto Prepare Min Usages`) prepares the repeated ones per
physical connection; a transaction-pooling proxy in front of the server breaks this and every other
piece of session state — disable auto-prepare there.

## Type mapping traps

| .NET | Postgres | Note |
| --- | --- | --- |
| `DateTime` (`Kind=Utc`) | `timestamptz` | the client enforces the `Kind`; write UTC everywhere |
| `DateTime` (`Unspecified`) | `timestamp` | wall clock, no zone — rarely what you want |
| `DateTimeOffset` | `timestamptz` | the instant is stored, the offset is not |
| `decimal` | `numeric` | exact; never `double` for money or odds |
| `string[]`, `int[]` | `text[]`, `integer[]` | arrays are first class — `= ANY(@ids)` instead of a split table |
| `enum` | `text` or a Postgres enum | storing the name as `text` survives a reorder |
| a POCO | `jsonb` | serialise explicitly; the casing of the JSON keys is part of the contract |

## Dapper rules

- Parameterise everything (`@p`); Dapper maps by property name. A list parameter becomes an array.
- `QueryAsync<T>` buffers the whole set — a large stream wants `QueryUnbufferedAsync` and a
  `CommandDefinition` carrying the `CancellationToken`.
- Column names come back as the database spells them: alias snake_case in the SQL rather than
  renaming database columns to please a POCO.
- Bulk load is `COPY` through the binary importer, not a loop of `INSERT`s.
- An upsert's optional `WHERE … IS DISTINCT FROM excluded.…` skips no-op writes — on a hot cache
  table that is most of the dead-tuple and vacuum load gone.

## psql through docker

`psql` is not installed. Use the client inside the compose service, or a throwaway container from the
same image the compose file names, on the same network:

```powershell
docker compose exec -T <pg-svc> psql -U <user> -d <db> -v ON_ERROR_STOP=1 -At -c "select 1"
Get-Content .\inspect.sql | docker compose exec -T <pg-svc> psql -U <user> -d <db> -v ON_ERROR_STOP=1
docker run --rm -it --network <net> <image-from-compose> psql -h <host> -U <user> -d <db>
```

Who is connected, from which service, doing what:

```sql
SELECT application_name, state, wait_event_type, wait_event, now() - query_start AS running, left(query, 80)
FROM pg_stat_activity WHERE datname = current_database() ORDER BY running DESC NULLS LAST;
```

The full exec-versus-throwaway rules are in the `docker-dev-env` skill's clients-in-containers
reference. Pass the password through `PGPASSWORD` in the container environment, never on the command
line.
