# Healthchecks: up, healthy, and actually ready

Three different states get confused constantly:

| State       | Means                                                          | Who reports it                   |
| ----------- | -------------------------------------------------------------- | -------------------------------- |
| **up**      | the container's main process exists                            | `docker compose ps` → `running`  |
| **healthy** | the healthcheck command inside the container exited 0          | `ps` → `running (healthy)`       |
| **ready**   | the thing the application needs is present: listener, database, schema, seed data | nobody — you have to define it |

A container is up milliseconds after `up -d`. A database engine takes seconds to tens of seconds to
accept a login, longer on a first start when it creates its data directory. Nothing about `running`
tells you which. That gap is the single most common cause of "it works on the second run".

## A probe must make the service do its job

| Service     | Bad probe                             | Probe that proves something                                    |
| ----------- | ------------------------------------- | -------------------------------------------------------------- |
| SQL Server  | TCP connect to the port               | log in as the SA user and run `SELECT 1`                       |
| Postgres    | TCP connect to the port               | `pg_isready` with the real user and database                   |
| Redis       | TCP connect to the port               | `redis-cli ping`, authenticated, and grep for `PONG`           |
| RabbitMQ    | the port is open                      | `rabbitmq-diagnostics check_running check_port_connectivity`   |
| HTTP service| the root path returns anything        | a health endpoint that touches its dependencies                |

A TCP probe passes while the engine is still replaying its log and rejecting every login. Every
probe above uses a client that already exists inside the image, so nothing has to be installed.

## The four knobs, and the one that is usually missing

| Field          | Effect                                                        | Getting it wrong                                  |
| -------------- | ------------------------------------------------------------- | ------------------------------------------------- |
| `interval`     | time between probes once running                               | too long → slow to notice; too short → noisy load |
| `timeout`      | how long one probe may take before counting as a failure       | too short → a busy engine looks unhealthy         |
| `retries`      | consecutive failures before the state flips to `unhealthy`     | 1 → a single hiccup marks it broken               |
| `start_period` | grace window during which failures do **not** count            | **omitted** → a slow-starting engine flaps        |

`start_period` is the one people forget. Without it, a database that needs forty seconds to come up
burns through `retries` during startup and is declared `unhealthy` before it has had a chance. With
it, failures inside the window are ignored, and the first success ends the window early.

## Making other things wait

```yaml
  api:
    depends_on:
      postgres:
        condition: service_healthy
      rabbitmq:
        condition: service_healthy
      seeder:
        condition: service_completed_successfully
```

| Condition                      | Waits for                                        |
| ------------------------------ | ------------------------------------------------ |
| `service_started` (the default)| the container to exist — effectively nothing      |
| `service_healthy`              | the healthcheck to pass at least once             |
| `service_completed_successfully`| a one-shot container to exit 0                   |

The bare list form (`depends_on: [postgres]`) is `service_started`. It orders startup and waits for
nothing, which is why it looks like it works and then does not under load.

From the shell, the equivalent is `--wait`:

```powershell
docker compose up -d --wait                       # blocks until every service with a probe is healthy
docker compose up -d --wait --wait-timeout 120    # and gives up instead of hanging forever
docker compose up -d --wait postgres rabbitmq     # only what is needed right now
```

`--wait` returns non-zero if a service ends up unhealthy, which makes it the right call in a script
that then runs migrations or tests. Without a probe on a service, `--wait` has nothing to wait for
and returns immediately — a service with no healthcheck silently opts out.

## Reading the health state and the probe's own output

```powershell
docker compose ps                                  # the STATUS column carries (healthy)/(unhealthy)
docker inspect --format '{{.State.Health.Status}}' <container>
docker inspect --format '{{json .State.Health}}' <container>   # the last probe runs, with output and exit codes
docker inspect --format '{{json .Config.Healthcheck}}' <container>  # the probe that is actually configured
docker compose events                              # health_status transitions as they happen
```

`.State.Health.Log` is the decisive one: it holds the last few probe invocations with their stderr.
An `unhealthy` service whose log says "password authentication failed" has a wrong probe, not a
broken engine — and the two look identical from `ps`.

## Readiness the container cannot see

A healthy engine is not a usable database. Three further gates, and each needs its own check:

| Gate                     | Symptom when skipped                                | Check                                             |
| ------------------------ | --------------------------------------------------- | ------------------------------------------------- |
| the database exists      | login succeeds, the app cannot open its database    | query the catalog for the database name            |
| the schema is migrated   | the app starts and throws on the first query        | run the migration tool and let it be the gate      |
| seed or reference data   | the app runs but every list is empty                | count rows in one reference table                  |

So the correct local startup order is: `up -d --wait`, then migrate, then seed — with the migration
step, not the healthcheck, as the gate the application waits on. Never fold migrations into a
healthcheck: a probe runs repeatedly and by design, and it must be idempotent and cheap.

## Retry in the application anyway

Even a perfect probe does not survive a broker restart mid-session, a failover, or a laptop waking
from sleep. The connection code needs a bounded retry with backoff regardless — the healthcheck
buys a clean *start*, not a guarantee for the rest of the process's life. Where the .NET client has
built-in resilience (the SQL Server provider's retrying execution strategy, the Redis multiplexer's
reconnect, the broker client's recovery), turn it on rather than writing a loop; see `ef-core`,
`redis-dotnet` and `rabbitmq`.
