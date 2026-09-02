# Npgsql from .NET — what differs from SqlClient

## The connection is a server process

SQL Server serves a connection with a thread; Postgres forks a **backend process** per connection.
The client-side pool looks the same, the server-side cost does not: a few hundred idle connections
that SQL Server shrugs off will exhaust memory here.

| Concern                          | SQL Server / SqlClient                   | Postgres / Npgsql                                               |
| -------------------------------- | ---------------------------------------- | --------------------------------------------------------------- |
| Server cost per connection       | a thread                                 | a process — keep the pool small and deliberate                   |
| Pool key                         | the exact connection string              | the exact connection string (same rule: one typo = a second pool) |
| Plan caching                     | server-side and automatic                 | **client-side**, only for prepared statements                    |
| Many app instances               | pool per instance is usually fine         | add a pooler in front; total backends is the budget              |
| Multiple result sets             | supported natively                        | supported, but a batch is the idiomatic form                     |
| Cancellation                     | best effort                               | sends a real cancel request on a second connection               |

Size the pool against the server's connection limit divided by the number of instances, not against
the request rate: `SHOW max_connections;` is the ceiling.

## Register a data source, not a connection

Create **one** data source for the lifetime of the process and let it own the pool; resolve
connections from it per unit of work. A connection object is cheap and disposable, the pool behind it
is not.

```csharp
// One singleton per database. Type mappings, enums and logging are configured here, once.
builder.Services.AddSingleton(_ =>
{
    var b = new NpgsqlDataSourceBuilder(cfg.GetConnectionString("Cache"));
    b.EnableParameterLogging(false);        // parameter values are data, keep them out of logs
    return b.Build();
});

// Per unit of work
await using var conn = await dataSource.OpenConnectionAsync(ct);
```

The data-source API is not present in every client release; when the project pins an older one,
register the connection string and open `NpgsqlConnection` per unit of work instead. Check the pinned
version in the project file or the central package-management file — never assume.

## Connection-string keys that matter

```text
Host=localhost;Port=5432;Database=appcache;Username=app;Password=<from-secret-store>;
Pooling=true;Minimum Pool Size=0;Maximum Pool Size=20;Connection Idle Lifetime=300;
Timeout=15;Command Timeout=30;Keepalive=30;Include Error Detail=true
```

| Key                            | Why it is here                                                          |
| ------------------------------ | ----------------------------------------------------------------------- |
| `Maximum Pool Size`            | the default is generous; set it against the server's budget              |
| `Connection Idle Lifetime`     | returns backends to the server instead of parking them                  |
| `Timeout`                      | **connect** timeout, in seconds — not the command timeout                |
| `Command Timeout`              | per-command; a long report needs it raised on that command, not globally |
| `Keepalive`                    | detects a dead connection behind a NAT or a load balancer               |
| `Max Auto Prepare`             | enables automatic prepared statements — see below                        |
| `Include Error Detail`         | puts the offending value in the error; development only                  |
| `Multiplexing`                 | many small commands over few connections; incompatible with some session state — measure before enabling |
| `Password`                     | never a literal in a committed file: user secrets, environment, or a vault |

## Prepared statements are the performance switch

Postgres does not cache a plan for an ad-hoc parameterised statement the way SQL Server does. Every
execution re-parses and re-plans unless the statement is prepared.

- `Max Auto Prepare=20` plus `Auto Prepare Min Usages=2` makes the client prepare the statements it
  sees repeatedly, per physical connection. This is usually the single largest win for a chatty
  service.
- Prepared statements are **per connection**, so they warm up again after the pool churns. A minimum
  pool size above zero keeps them warm.
- A **transaction-pooling** proxy in front of Postgres breaks prepared statements and every other
  piece of session state. If one is deployed, disable auto-prepare rather than debugging ghosts.

## Type mapping traps

| .NET                    | Postgres                | Note                                                              |
| ----------------------- | ----------------------- | ----------------------------------------------------------------- |
| `DateTime` (`Kind=Utc`) | `timestamptz`           | the client enforces the `Kind`; store UTC everywhere               |
| `DateTime` (`Unspecified`) | `timestamp`          | a wall-clock value with no zone — rarely what you want             |
| `DateTimeOffset`        | `timestamptz`           | the offset is not stored, only the instant                         |
| `TimeSpan`              | `interval`              | not a duration in milliseconds                                     |
| `Guid`                  | `uuid`                  | native, no string conversion                                       |
| `decimal`               | `numeric`               | exact; `double` is not                                             |
| `string[]`, `int[]`     | `text[]`, `integer[]`   | arrays are first class — no split table needed                     |
| `enum`                  | a Postgres `enum` type  | map it on the data-source builder, or store the name as `text`      |
| `byte[]`                | `bytea`                 | not `varbinary`                                                    |
| `JsonDocument` / POCO   | `jsonb`                 | enable JSON mapping on the data source for POCO round-tripping      |

## Dapper against the read-cache database

The cache database is read with Dapper and its schema lives outside EF, so there is no model to
consult: the SQL **is** the contract.

- Parameterise everything (`@p`); Dapper maps by property name.
- `QueryAsync<T>` materialises the whole set — use `QueryUnbufferedAsync` (or a reader) for a large
  stream, and pass the `CancellationToken` through a `CommandDefinition`.
- Column names come back as the database spells them; if the database is snake_case, either alias in
  the SQL or turn on a matching name convention — do not rename database columns to please a POCO.
- `COPY` beats a loop of `INSERT`s by an order of magnitude for bulk load: `NpgsqlConnection`
  exposes a binary importer for exactly this.

## The EF provider

`UseNpgsql` in the alternative-provider solution. What changes relative to the SQL Server provider:

| Area                | Difference                                                                   |
| ------------------- | ---------------------------------------------------------------------------- |
| Identity columns    | generated as identity/sequence, not `IDENTITY`; `HasIdentityByDefaultColumn`  |
| Migrations          | DDL is transactional here, so a failed migration rolls back cleanly           |
| Extensions          | declared in the model (`HasPostgresExtension`) so they land in the migration  |
| Case-insensitive compare | no default CI collation: model a `citext` column or a case-insensitive collation explicitly |
| Concurrency token   | the system column `xmin`, mapped with `UseXminAsConcurrencyToken`             |
| Provider-specific SQL | `EXCLUDE`, `ON CONFLICT`, JSONB operators need raw SQL or provider extensions |
| Generated migrations | never share migration files between providers — one migrations assembly each  |
