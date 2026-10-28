# Healthchecks: up, healthy, and actually ready

| State       | Means                                                          | Who reports it                   |
| ----------- | -------------------------------------------------------------- | -------------------------------- |
| **up**      | the container's main process exists                            | `docker compose ps` → `running`  |
| **healthy** | the healthcheck command inside the container exited 0          | `ps` → `running (healthy)`       |
| **ready**   | the thing the application needs is present: listener, database, schema, seed data | nobody — you have to define it |

A container is up milliseconds after `up -d`; a database engine takes seconds to tens of seconds to
accept a login. That gap is the most common cause of "it works on the second run".

## A probe must make the service do its job

| Service     | Bad probe                             | Probe that proves something                                    |
| ----------- | ------------------------------------- | -------------------------------------------------------------- |
| SQL Server  | TCP connect to the port               | log in as the SA user and run `SELECT 1`                       |
| Postgres    | TCP connect to the port               | `pg_isready` with the real user and database                   |
| Redis       | TCP connect to the port               | `redis-cli ping`, authenticated, and grep for `PONG`           |
| RabbitMQ    | the port is open                      | `rabbitmq-diagnostics check_running check_port_connectivity`   |
| HTTP service| the root path returns anything        | a health endpoint that touches its dependencies                |

A TCP probe passes while the engine is still replaying its log and rejecting every login. Use a client
that already exists inside the image.

**`start_period` is the knob usually missing**: without it a database that needs forty seconds burns
through `retries` during startup and is declared `unhealthy`. Failures inside the window do not count.

## Making other things wait

`depends_on: <svc>: condition: service_healthy` (or `service_completed_successfully` for a one-shot).
The bare list form is `service_started`: it orders startup and waits for nothing.

`docker compose up -d --wait [--wait-timeout 120] [<svc>…]` blocks until every service with a probe is
healthy and returns non-zero if one ends up unhealthy: the right call before migrations or tests. A
service with no healthcheck silently opts out of `--wait`.

## Reading the health state

```powershell
docker inspect --format '{{json .State.Health}}' <container>   # last probe runs, with output and exit codes
docker inspect --format '{{json .Config.Healthcheck}}' <container>  # the probe actually configured
```

`.State.Health.Log` is the decisive one: an `unhealthy` service whose log says "password
authentication failed" has a wrong probe, not a broken engine, and the two look identical from `ps`.

## Readiness the container cannot see

| Gate                     | Symptom when skipped                                | Check                                             |
| ------------------------ | --------------------------------------------------- | ------------------------------------------------- |
| the database exists      | login succeeds, the app cannot open its database    | query the catalog for the database name            |
| the schema is migrated   | the app starts and throws on the first query        | run the migration tool and let it be the gate      |
| seed or reference data   | the app runs but every list is empty                | count rows in one reference table                  |

Local startup order: `up -d --wait`, then migrate, then seed — the migration step, not the
healthcheck, is the gate. Never fold migrations into a healthcheck: a probe runs repeatedly and must
be idempotent and cheap.

## Retry in the application anyway

A perfect probe buys a clean *start*, not survival of a broker restart or a failover. Connection code
needs bounded retry with backoff; where the .NET client has built-in resilience (the SQL Server
provider's retrying execution strategy, the Redis multiplexer's reconnect, the broker client's
recovery), turn it on; see `ef-core`, `dotnet-backend` (its Redis reference) and `rabbitmq`.
