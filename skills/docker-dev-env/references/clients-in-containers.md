# Running a client that is not installed on this machine

Detect before choosing: `Get-Command psql, redis-cli, sqlcmd -ErrorAction SilentlyContinue` and
`wsl -e which psql redis-cli`. `sqlcmd` is usually native; `psql` and `redis-cli` often are not (a
native Windows `redis-cli` with TLS does not exist in a current release). First found wins:

| Order | Form | When |
| --- | --- | --- |
| 1 | native client | installed and reaching the published port |
| 2 | `wsl <client> …` | the WSL distribution has it (`apt install postgresql-client redis-tools`) |
| 3 | the service's own container (`docker compose exec -T`) | the server runs in compose — client and server always match |
| 4 | a throwaway container of the server's image | nothing else; `--rm`, explicit network |

These forms are for **dev hosts only**. Any other host goes through `/db` (the `db-analyst` agent
and `db-ro.ps1`, which makes the same native → wsl → docker choice); the shell hook recognises the
client inside `docker run|exec` and `wsl` too, and denies it at a non-dev host.

## The decision, in one table

| The target is                                        | Route                                                             |
| ---------------------------------------------------- | ----------------------------------------------------------------- |
| a service in the compose file, currently up          | `docker compose exec` — no image to choose, no network to find    |
| a container not managed by this compose file         | `docker exec` on the container name                               |
| a container that is **down**, or none at all         | a throwaway `docker run --rm` on the same network                 |
| a remote, managed or shared instance                 | not here: `/db` (read-only, through `db-ro.ps1`)                  |
| a host tool (a GUI, a .NET app, `sqlcmd`)            | `localhost` and the **published** port                            |

## exec and throwaway

`docker compose exec -T` for anything non-interactive (without it: control characters, broken pipes,
a hang on a terminal PowerShell never gave); `-it` only for a session you will type into. Credentials
go in through `-e`, read from the host environment, never as a command-line argument (visible in
history, the process list and `docker inspect`).

Throwaway form, when the service is not up or not in this compose file:

```powershell
docker run --rm -i --network <net> <the image the compose file names> `
  psql -h postgres -U app -d appdb -c "select 1"
```

1. **Take the image from the compose file** (`docker compose config` prints it, tag included), never
   invent a tag, so client and server match.
2. **`--rm` always.**
3. **Name the network explicitly.** On the default bridge compose service names do not resolve and
   every connection fails on DNS, not on the server.

`host.docker.internal` reaches a listener on the Windows host (something debugged in the IDE); for
container-to-container traffic use the service name.

## Files in and output out

Prefer stdin over `cp`: `Get-Content .\migrate.sql | docker compose exec -T postgres psql -U app -d appdb -v ON_ERROR_STOP=1`.
Use `docker compose cp` only when the client must seek within the file or the file is large.

Windows traps:

- PowerShell decodes the stream it captures. For anything binary (a dump, an archive) use
  `-AsByteStream` on both `Get-Content` and `Set-Content`, or the bytes are silently mangled.
- A path with `\` is fine on the host side of `cp`; the container side is always `/`-separated.

## Exit codes

`docker compose exec` returns the client's exit code, but most clients exit 0 on a SQL error unless
told not to; without these a broken migration script reports success:

| Client       | Flag that makes a failure a failure           |
| ------------ | --------------------------------------------- |
| `psql`       | `-v ON_ERROR_STOP=1`                          |
| `sqlcmd`     | `-b`                                          |
| `redis-cli`  | check the output; errors come back as text     |

## One recipe per client — the canonical copy

`<svc>` is the compose service; with no compose file use `docker exec <container>` instead of
`docker compose exec <svc>`. Secrets always arrive through `-e`, from the host environment.

| Client | One-shot, scriptable | Notes |
| --- | --- | --- |
| `sqlcmd` (local) | `$env:SQLCMDPASSWORD = $env:MSSQL_PASSWORD; sqlcmd -S localhost,<port> -d <db> -U <user> -C -b -W -Q "<sql>"` | `-C` trusts the dev container's self-signed certificate |
| `sqlcmd` (in the image) | `docker compose exec -T <svc> bash -lc 'ls -d /opt/mssql-tools*/bin'` then call that path with the same flags | the tools path is versioned — glob it, never hardcode it |
| `psql` | `docker compose exec -T -e PGPASSWORD=$env:PGPASSWORD <svc> psql -U <user> -d <db> -v ON_ERROR_STOP=1 -At -c "<sql>"` | `-At` gives unaligned, header-less output for parsing |
| `pg_dump` | `docker compose exec -T <svc> pg_dump -U <user> -d <db> --schema-only` | binary formats need `-AsByteStream` on the host side |
| `psql` (no stack) | `wsl psql -h localhost -p <port> -U <user> -d <db> -c "<sql>"` or `docker run --rm -i -e PGPASSWORD=$env:PGPASSWORD postgres:<tag> psql -h host.docker.internal -p <port> -U <user> -d <db> -c "<sql>"` | `<tag>` from the compose file or the server's `SELECT version()` |
| `redis-cli` | `docker compose exec -T -e REDISCLI_AUTH=$env:REDIS_PASSWORD <svc> redis-cli <command>` | any command on a local cache; `FLUSHALL` / `FLUSHDB` ask; `SCAN`, not `KEYS` |
| `redis-cli` (no stack) | `wsl redis-cli -h localhost -p <port> <command>` or `docker run --rm -i -e REDISCLI_AUTH=$env:REDIS_PASSWORD redis:<tag> redis-cli -h host.docker.internal -p <port> [--tls] <command>` | the image's client is the TLS-capable one |
| `rabbitmqctl` | `docker compose exec -T <svc> rabbitmqctl list_queues --vhost <vhost> name messages consumers` | node-local; needs no credentials inside the container |
| `rabbitmqadmin` | `docker compose exec -T <svc> rabbitmqadmin -V <vhost> get queue=<q> count=1 ackmode=reject_requeue_true` | the management plugin must be enabled; this ackmode is the only non-destructive one |

What to type into each client — queries, plans, stream and queue diagnosis — belongs to the domain
skills: `sql-server` (both SQL engines), `dotnet-backend` (its Redis reference), `rabbitmq`.
