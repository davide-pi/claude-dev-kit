---
name: docker-dev-env
description: >-
  Use whenever a service has to run locally — an Aspire profile, a compose stack — or a local
  database, Redis or broker will not start or connect, a port collides, a volume needs a reset, or a
  client like psql, redis-cli or rabbitmqctl is needed but not installed.
---

# docker-dev-env — the local stack: compose, Aspire, and clients that live only in containers

**Aspire first for the large backend** — its app host starts the .NET services by profile, while
the databases and the broker come from configuration, not from containers it owns. Every other
repository drives `docker compose` directly. `psql` and `redis-cli` are **not installed on this
machine**: run them inside the service's own image — the canonical recipes are in `references/clients-in-containers.md`.

## When

- A local service will not start, restarts in a loop, or the application cannot connect to it.
- A compose service has to be added, renamed, re-ported, or given a healthcheck.
- A one-off query or a broker inspection needs a client the machine does not have.
- Local data has to survive a rebuild, be reset, or be deliberately thrown away.
- Choosing how a solution runs locally: an Aspire app host, or compose by hand.
- A published port is already taken, or two stacks fight over the same one.

Not for: engine-specific syntax and inspection queries (`sql-server`, `redis-dotnet`,
`rabbitmq`), containers a test suite starts and owns (`dotnet-testing`), Kubernetes or production
deployment, build-agent service containers (`pipeline`). Image tags, engine releases and package
versions come from the compose file, the `.env` beside it, or the app host project — never assumed.

## Decide

**Aspire or compose by hand?** One orchestrator per solution, never both at once.

| Situation                                                              | Instrument                    |
| ---------------------------------------------------------------------- | ----------------------------- |
| The large backend (an app host under `src/orchestration`)              | Aspire, smallest profile containing the changed service; its old compose file is stale |
| The solution already contains an app host project                      | Aspire — it owns the topology |
| The .NET services should start, wire up and be observable in one command | Aspire, with its dashboard  |
| Only backing services are wanted; the app runs from the IDE            | compose                       |
| A non-.NET consumer needs the same stack (a web dev server, a script)  | compose                       |
| The local layout must match what a server or a build agent runs        | compose                       |

**Where does the client run?** The client shipped in the service image always matches the server.

| Need                                                      | Shape                                                                  |
| --------------------------------------------------------- | ---------------------------------------------------------------------- |
| Service is up and named in the compose file, one command  | `docker compose exec -T <svc> <client> ...`                            |
| Interactive exploration                                   | `docker compose exec -it <svc> <client>`                               |
| A local `.sql` or script file                             | pipe it from the host into `exec -T` — do not copy it in               |
| Target outside compose (bare container, remote instance)  | throwaway: `docker run --rm --network <net> <image> <client> -h <host>` |
| A host-side tool or a .NET app has to connect             | the published port on `localhost`, as `docker compose port` reports it  |

**Data: keep it or destroy it.**

| Storage               | Holds                                              | Survives                         |
| --------------------- | -------------------------------------------------- | -------------------------------- |
| named volume          | database and broker data directories               | `down`, rebuild, host reboot     |
| bind mount            | init scripts, seed SQL, config the container reads  | everything — it is a host folder |
| anonymous / no volume | data nobody wants back                              | nothing after `down`             |
| tmpfs                 | fast disposable test data                           | nothing after stop               |

Destroy a volume **on purpose** when the schema drifted past what the migrations can reach, when a
seed script changed and only runs against an empty data directory, when the engine refuses to start
after an image bump, or when the local data is corrupt. Never as the first move for "it does not
work", never on a volume you did not create, never without naming it and what it holds first.

**Up is not ready.**

| Observation                                            | What it actually means                                        |
| ------------------------------------------------------ | ------------------------------------------------------------- |
| `running`, and the app gets connection refused         | the process started; the listener is not accepting yet         |
| `running (healthy)`                                    | the healthcheck's own command succeeded — nothing more         |
| `running (unhealthy)` after a while                    | the probe is wrong, or the service really is broken            |
| `depends_on` with no `condition: service_healthy`      | start order only; it waits for nothing                         |
| Engine accepts connections but the database is missing | schema readiness is a separate gate — migrations have not run  |

A healthcheck is worth only as much as its command: it must make the service do its real job — run a
query, answer a `PING`, reply on the management API — not merely prove that a port is open.

**Secrets and environment.** A committed compose file carries no credential, not even a "local only"
one: it references `${VAR}` with no default, the values live in an ignored `.env` beside it, and the
app reads them from user secrets or the environment, never from a committed settings file. A password
reaches a container through its environment, never on a command line — that lands in `docker inspect`.

## Do

Why is this service not coming up — read-only, in this order:

```powershell
docker compose config --services                     # the names this file really defines
docker compose ps --all                              # state + health, exited containers included
docker compose logs --no-log-prefix --tail 80 <svc>  # the failure is nearly always in the first lines
docker inspect --format '{{.State.Status}} {{.State.ExitCode}} {{.State.OOMKilled}}' <container>
docker compose config                                # resolved: variables substituted, .env applied
docker compose port <svc> <container-port>           # what the port was actually published as
Get-NetTCPConnection -LocalPort <port> -State Listen |
  ForEach-Object { Get-Process -Id $_.OwningProcess }  # who already holds the port
```

Clients that are not on the machine: the per-client table in `references/clients-in-containers.md`.
Driving the lifecycle:

```powershell
$env:ASPIRE_PROFILE = '<profile>'; dotnet run --project <AppHost project>   # the large backend
docker compose up -d --wait                  # start, and block until every healthcheck passes
docker compose up -d --force-recreate <svc>  # new container, same volumes
docker compose down                          # removes containers; volumes survive
docker compose down -v                       # DESTROYS the volumes — name them out loud first
```

## Traps

1. Output is mangled or a call hangs in a script → `exec` allocated a TTY → `-T` for anything
   non-interactive, `-it` only for a shell you will actually type into.
2. A container cannot reach another at `localhost:<port>` → `localhost` is that container itself →
   use the service name and the **container** port; published ports exist for the host only.
3. `depends_on` looks like it waits and does not → without `condition: service_healthy` it only
   orders startup → add the condition, and give the dependency a probe that queries something.
4. A SQL Server container exits at once → the licence variable was not accepted, or the password
   fails the engine's complexity policy → the first log lines name which; both are otherwise silent.
5. A Postgres init or seed script is ignored → that directory runs only on an empty data directory →
   destroy the volume deliberately, or ship the change as a migration instead.
6. A port is taken after a stack was stopped uncleanly → an orphan container or another compose
   project still holds it → check `ps --all` and the port owner before editing the port.
7. Two repositories collide on service or volume names → the project name defaults to the folder →
   set an explicit project name per stack (`name:` in the file, or `-p`).
8. The broker UI answers but the app cannot connect → management and messaging are separate
   listeners on separate ports → test the one the client actually uses.
9. Local mail never arrives → the mail catcher swallows it by design → read it in the catcher's web
   UI; a real SMTP host in local configuration is a bug, not a fallback.
10. The backend's compose file used to run the stack → it lists services that no longer exist → use
    the app host; its profiles are the live topology (`references/aspire.md`).
11. Aspire and a hand-started compose stack are both up → two servers on one port, and the app talks
    to whichever won → pick one orchestrator and stop the other.

## References

- `references/compose-stack.md` — the annotated stack file: services, networks, profiles, overrides.
- `references/healthchecks.md` — a real probe per service, `--wait`, `service_healthy`, start periods.
- `references/clients-in-containers.md` — exec versus throwaway in full: networks, piping, capturing.
- `references/volumes-and-reset.md` — what each volume holds, a safe reset per engine, backup first.
- `references/env-and-secrets.md` — `.env` resolution, `${VAR}` with no default, user secrets, gitignore.
- `references/aspire.md` — the app host, dashboard, service discovery, connection handover, or compose.
