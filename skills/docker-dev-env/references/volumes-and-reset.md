# Volumes: what they hold, and how to throw one away on purpose

Every reset decision is the question "which volume am I destroying, and what was in it".

| Volume        | Mount point inside the container | Holds                                                   |
| ------------- | -------------------------------- | ------------------------------------------------------- |
| SQL Server    | `/var/opt/mssql`                 | data and log files, `master`, every user database        |
| Postgres      | `/var/lib/postgresql/data`       | the whole cluster: databases, roles, WAL, configuration  |
| Redis         | `/data`                          | the append-only file or snapshot, if persistence is on   |
| RabbitMQ      | `/var/lib/rabbitmq`              | the node's definitions, queues, and persisted messages   |
| mail catcher  | none                             | nothing — local mail is disposable by design             |

Redis: with no volume a restart is already a flush; if a volume **is** mounted, an old append-only
file is replayed on start and stale keys come back.

## What destroys what

| Command                              | Containers | Volumes            |
| ------------------------------------ | ---------- | ------------------ |
| `docker compose stop` / `restart` / `up -d --force-recreate` | stopped / replaced | kept |
| `docker compose down`                | removed    | **kept**           |
| `docker compose down -v`             | removed    | **DESTROYED**      |
| `docker volume rm <vol>`             | —          | that one destroyed |
| `docker system prune --volumes`      | removed    | every unused one   |

`down -v` is scoped to the compose project, so the project name decides which volumes die: in the
wrong folder it removes a different stack's data. `docker system prune --volumes` reaches across every
project and is never the right tool for a targeted reset.

## Escalate, do not jump

A reset erases the evidence, so it is the last step:

1. `restart <svc>` — a hung listener or stuck pool.
2. `up -d --force-recreate <svc>` — a fresh container on the same data.
3. Fix in place — a migration, a `DROP DATABASE` on one local database, a `FLUSHDB`.
4. `down -v` — only after the three above are ruled out, and only with the volume named.

## Announce, and take a copy first

Before destroying anything, state the compose project, the volume names, and what is in them
(`docker compose ls`, `docker volume ls --filter label=com.docker.compose.project=<project>`,
`docker volume inspect <vol>`).

If the data is not trivially reproducible, take a logical copy while the service is healthy:

```powershell
docker compose exec -T postgres pg_dump -U app -d appdb -Fc | Set-Content .\appdb.dump -AsByteStream
docker compose exec -T sqlserver /opt/mssql-tools/bin/sqlcmd -S localhost -U sa -b `
  -Q "BACKUP DATABASE [App] TO DISK='/var/opt/mssql/backup/app.bak' WITH INIT"
# RabbitMQ: definitions only, not messages
docker compose exec -T rabbitmq rabbitmqctl export_definitions /tmp/defs.json
docker compose cp rabbitmq:/tmp/defs.json .\defs.json
```

A raw copy of the volume directory is not portable across engine releases; a logical dump is.

## Reset per engine, and what has to be re-run afterwards

`docker compose down -v` (or `docker compose rm -sfv <svc>; docker volume rm <vol>`), then
`docker compose up -d --wait`.

| Engine      | What a wipe erases                    | What has to run again                            |
| ----------- | ------------------------------------- | ------------------------------------------------ |
| SQL Server  | every database, logins, jobs           | migrations, then the seed                        |
| Postgres    | the cluster, roles, extensions         | the `initdb` scripts run automatically; then migrations and seed |
| Redis       | the persisted keyspace                 | nothing — it refills, or the app warms it        |
| RabbitMQ    | topology and persisted messages        | whatever declares exchanges and queues at startup |

Postgres: the `docker-entrypoint-initdb.d` scripts run **only** when the data directory is empty, so a
deliberate wipe is the supported way to pick up a changed init or seed script (the one case where
destroying the volume is the first move). It is also why an init script must never carry a schema
change: it would apply for new developers and never for anyone else.

## Reclaiming disk without losing data

`docker system df [-v]` shows where the space went; `docker builder prune` (build cache, usually the
biggest win) and `docker image prune` leave every volume intact. A growing database volume is a
database problem (Postgres bloat, SQL Server log-file growth: `sql-server`).
