---
name: docker-dev-env
description: >-
  Use when a local stack (Aspire, compose) must run, or a local database, Redis or broker won't
  start, a port collides, a volume needs reset.
paths: "**/docker-compose*.y*ml,**/compose*.y*ml,**/*AppHost*/**,**/Dockerfile*"
---

# docker-dev-env — the local stack: Aspire for the backend, compose for the rest

**Contract.** A local stack that starts, is ready, and keeps its data · never `down -v` or a volume
removal without naming the volume and what it holds first · explanations in Italian, container
output verbatim.

## When

- A local service will not start, restarts in a loop, or the app cannot connect to it.
- A compose service is added, renamed, re-ported or given a healthcheck; a port is already taken.
- Local data must survive a rebuild, be reset, or be thrown away; a client is needed that is not
  installed (`psql`, `redis-cli`, `rabbitmqctl`).

Not for: what to type into a client (`sql-server`, `rabbitmq`, `dotnet-backend` for Redis);
containers a test suite owns (`dotnet-testing`); build-agent containers (`pipeline`).

Local-stack facts (healthcheck = readiness, named volumes, tags from `.env`, clients inside the
container, Aspire over the backend's old compose file) are in `rules/docker.md`.

## Decide

### Aspire or compose — one orchestrator per solution, never both at once

| Situation | Instrument |
| --- | --- |
| the large backend (an app host under `src/orchestration`) | Aspire, the smallest profile containing the changed service |
| the solution has an app host project | Aspire — it owns the topology |
| only backing services wanted; the app runs from the IDE | compose |
| a non-.NET consumer needs the stack (web dev server, script) | compose |
| the layout must match a server or a build agent | compose |

### Up is not ready

| Observation | Means |
| --- | --- |
| `running`, the app gets connection refused | the process started; the listener is not accepting yet |
| `running (healthy)` | the probe's own command succeeded — nothing more; a port check proves nothing |
| `running (unhealthy)` after a while | the probe is wrong, or the service really is broken |
| engine accepts connections, the database is missing | schema readiness is a separate gate — migrations have not run |

### A volume: keep, reset, or throw away

| Situation | Decision |
| --- | --- |
| "it does not work", cause unknown | **keep** — diagnose first (Do) |
| a seed or init script changed (it runs only on an empty data directory); schema drifted past what migrations reach | **reset**: name the volume and what it holds, back it up if anyone cares (`references/volumes-and-reset.md`) |
| the engine refuses to start after an image bump; data corrupt | **reset**, backup first |
| disposable test data | **throw away**: anonymous volume or tmpfs from the start |
| a volume you did not create | never touched |

### Where the client runs

| Target | Shape |
| --- | --- |
| a compose service that is up | `docker compose exec -T <svc> <client> …` (`-it` only to type into it) |
| a bare container, or one that is down | `docker exec <container> …`, or a throwaway `docker run --rm -i --network <net> <image> <client>` with the image from `docker compose config` |
| a host tool or .NET app | `localhost` and the published port (`docker compose port`) |
| `psql` / `redis-cli` without a stack | native if installed, else `wsl <client>`, else a throwaway `postgres` / `redis` image |
| anything not a dev host | `/db` — never a raw client (`sql-server`) |

## Do

```powershell
# Why is this service not coming up — read-only, in this order
docker compose ps --all                              # state + health, exited containers included
docker compose logs --no-log-prefix --tail 80 <svc>  # the failure is nearly always in the first lines
docker inspect --format '{{.State.Status}} {{.State.ExitCode}} {{.State.OOMKilled}}' <container>
docker compose config                                # resolved: variables substituted, .env applied
docker compose port <svc> <container-port>           # what the port was published as
Get-NetTCPConnection -LocalPort <port> -State Listen | ForEach-Object { Get-Process -Id $_.OwningProcess }

# Lifecycle
$env:ASPIRE_PROFILE = '<profile>'; dotnet run --project <AppHost project>   # the large backend
docker compose up -d --wait                  # start, and block until every healthcheck passes
docker compose up -d --force-recreate <svc>  # new container, same volumes
docker compose down                          # containers go; volumes survive
```

## Traps

1. Output mangled, or a script call hangs → `exec` allocated a TTY → `-T` for anything non-interactive.
2. A container cannot reach another at `localhost` → that is itself → service name + **container** port.
3. A SQL Server container exits at once → licence variable or password complexity → the first log lines.
4. A port taken after an unclean stop → an orphan container or another project → `ps --all`, port owner.
5. Two repositories collide on service or volume names → the project name is the folder → `name:` or `-p`.
6. Broker UI answers, the app cannot connect → management and messaging are separate listeners.
7. Local mail never arrives → the mail catcher keeps it by design → its web UI; real SMTP locally is a bug.
8. Aspire and a hand-started compose stack both up → two servers on one port → stop one.
9. A password on a command line → it lands in `docker inspect` → `-e VAR` from the host; compose
   files reference `${VAR}` with no default (`references/env-and-secrets.md`).

## References

- `references/aspire.md` — app host, profiles, dashboard, service discovery, connection handover.
- `references/compose-stack.md` — the annotated stack file: services, networks, profiles, overrides.
- `references/healthchecks.md` — a real probe per service, `--wait`, `service_healthy`, start periods.
- `references/clients-in-containers.md` — exec, throwaway, wsl; piping files; exit codes; per-client recipes.
- `references/volumes-and-reset.md` — what each volume holds, a safe reset per engine, backup first.
- `references/env-and-secrets.md` — `.env` resolution, `${VAR}` with no default, user secrets, gitignore.
