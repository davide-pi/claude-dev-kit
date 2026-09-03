# Volumes: what they hold, and how to throw one away on purpose

A named volume is the only reason local data survives anything. Containers are disposable; the
volume is not. Every reset decision is really the question "which volume am I destroying, and what
was in it".

| Volume        | Mount point inside the container | Holds                                                   |
| ------------- | -------------------------------- | ------------------------------------------------------- |
| SQL Server    | `/var/opt/mssql`                 | data and log files, `master`, every user database        |
| Postgres      | `/var/lib/postgresql/data`       | the whole cluster: databases, roles, WAL, configuration  |
| Redis         | `/data`                          | the append-only file or snapshot, if persistence is on   |
| RabbitMQ      | `/var/lib/rabbitmq`              | the node's definitions, queues, and persisted messages   |
| mail catcher  | none                             | nothing — local mail is disposable by design             |

Redis is worth a second look: with no volume and no persistence configured, a restart is already a
flush, which is usually what is wanted locally. If a volume **is** mounted, an old append-only file
will be replayed on start, and stale keys come back from the dead.

## What destroys what

| Command                              | Containers | Volumes            | Images |
| ------------------------------------ | ---------- | ------------------ | ------ |
| `docker compose stop`                | stopped    | kept               | kept   |
| `docker compose restart <svc>`       | restarted  | kept               | kept   |
| `docker compose up -d --force-recreate` | replaced | kept               | kept   |
| `docker compose down`                | removed    | **kept**           | kept   |
| `docker compose down -v`             | removed    | **DESTROYED**      | kept   |
| `docker volume rm <vol>`             | —          | that one destroyed | kept   |
| `docker system prune --volumes`      | removed    | every unused one   | dangling |

`down -v` is scoped to the compose project, so the project name decides which volumes die. Run it in
the wrong folder and it removes a different stack's data. `docker system prune --volumes` reaches
across every project on the machine and is never the right tool for a targeted reset.

## Escalate, do not jump

A reset is the last step, not the first. In order:

1. `restart <svc>` — enough for a hung listener or a stuck connection pool.
2. `up -d --force-recreate <svc>` — a fresh container on the same data; fixes anything that was
   wrong with the container's own state, environment or command.
3. Fix it in place — a migration, a `DROP DATABASE` on one local database, a `FLUSHDB` on one Redis
   database. Narrow, and reversible by re-running the setup.
4. `down -v` — only after the three above have been ruled out, and only with the volume named.

The reason for the order is diagnostic, not sentimental: a reset erases the evidence. A service that
comes back after a wipe has taught you nothing, and it will do it again.

## Announce, and take a copy first

Before destroying anything, state the compose project, the volume names, and what is in them:

```powershell
docker compose ls                       # projects on this machine, and their compose files
docker volume ls --filter label=com.docker.compose.project=<project>
docker volume inspect <vol>             # driver, mount point, creation time
```

If the data is not trivially reproducible, take a copy while the service is still healthy:

```powershell
# Postgres and SQL Server: a logical backup through the client already in the image
docker compose exec -T postgres pg_dump -U app -d appdb -Fc | Set-Content .\appdb.dump -AsByteStream
docker compose exec -T sqlserver /opt/mssql-tools/bin/sqlcmd -S localhost -U sa -b `
  -Q "BACKUP DATABASE [App] TO DISK='/var/opt/mssql/backup/app.bak' WITH INIT"

# RabbitMQ: the definitions (exchanges, queues, bindings, policies) — not the messages
docker compose exec -T rabbitmq rabbitmqctl export_definitions /tmp/defs.json
docker compose cp rabbitmq:/tmp/defs.json .\defs.json
```

A logical dump is portable across image versions; a raw copy of the volume directory is not, and
restoring a data directory into a different engine release is how a "backup" turns out to be
unusable exactly when it is needed.

## Reset per engine, and what has to be re-run afterwards

```powershell
docker compose down -v                       # or: docker compose rm -sfv <svc>; docker volume rm <vol>
docker compose up -d --wait
```

| Engine      | What a wipe erases                    | What has to run again                            |
| ----------- | ------------------------------------- | ------------------------------------------------ |
| SQL Server  | every database, logins, jobs           | migrations, then the seed                        |
| Postgres    | the cluster, roles, extensions         | the `initdb` scripts run automatically; then migrations and seed |
| Redis       | the persisted keyspace                 | nothing — it refills, or the app warms it        |
| RabbitMQ    | topology and persisted messages        | whatever declares exchanges and queues at startup |

Postgres is the useful special case: the `docker-entrypoint-initdb.d` scripts run **only** when the
data directory is empty, so a deliberate wipe is the *supported* way to pick up a changed init or
seed script. That is the one situation where destroying the volume is the correct first move rather
than the last — and it is also why an init script must never be the place a schema change lives, or
the change silently applies for new developers and never for anyone else.

## Reclaiming disk without losing data

```powershell
docker system df                        # where the space actually went: images, containers, volumes, cache
docker system df -v                     # per-volume and per-image detail
docker builder prune                    # build cache only — safe, and usually the biggest win
docker image prune                      # dangling images only
```

Reach for `builder prune` and `image prune` first. Both leave every volume intact, and on a machine
that builds regularly the layer cache is almost always the largest consumer. A database volume that
is genuinely growing is a database problem, not a docker one — see `postgres` for bloat and
`sql-server` for log-file growth.
