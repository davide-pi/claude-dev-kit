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

A Postgres connection is a forked **process**: keep the pool small and deliberate. Size
`Maximum Pool Size` against the server's budget (`SHOW max_connections;` ÷ instances), not the request
rate. `Timeout` is the **connect** timeout, `Command Timeout` the per-command one: raise it on the one
slow report, not globally.

**Prepared statements are the performance switch.** `Max Auto Prepare` (with `Auto Prepare Min Usages`)
prepares repeated statements per physical connection; a transaction-pooling proxy in front of the
server breaks this and every other piece of session state — disable auto-prepare there.

## Type mapping traps

- `DateTime` with `Kind=Utc` → `timestamptz` (the client enforces the `Kind`; write UTC everywhere);
  `Unspecified` → `timestamp`, rarely what you want. `DateTimeOffset` stores the instant, not the offset.
- `decimal` → `numeric`; never `double` for money or odds.
- Arrays are first class: `= ANY(@ids)` instead of a split table.
- Enum: store the name as `text`, which survives a reorder.
- A POCO → `jsonb`: serialise explicitly; the casing of the JSON keys is part of the contract.

## Dapper rules

- A list parameter becomes an array.
- `QueryAsync<T>` buffers the whole set: a large stream wants `QueryUnbufferedAsync` and a
  `CommandDefinition` carrying the `CancellationToken`.
- Alias snake_case in the SQL rather than renaming database columns to please a POCO.
- Bulk load is `COPY` through the binary importer, not a loop of `INSERT`s.
- An upsert's optional `WHERE … IS DISTINCT FROM excluded.…` skips no-op writes.

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
