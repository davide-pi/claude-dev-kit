# Running a client that is not installed on this machine

`psql` and `redis-cli` do not exist on this machine, and no attempt should be made to install them:
every image already ships the matching client, and using it removes a whole class of problem — a
client older or newer than its server, a protocol mismatch, a flag that does not exist yet.

`sqlcmd` **is** installed locally, so SQL Server can be reached either way. Prefer the local one
when the server is reachable on a published port, because the output comes back to PowerShell
without a container in the middle.

## The decision, in one table

| The target is                                        | Route                                                             |
| ---------------------------------------------------- | ----------------------------------------------------------------- |
| a service in the compose file, currently up          | `docker compose exec` — no image to choose, no network to find    |
| a container not managed by this compose file         | `docker exec` on the container name                               |
| a container that is **down**, or none at all         | a throwaway `docker run --rm` on the same network                 |
| a remote or managed instance                         | a throwaway client, or the locally installed tool if there is one |
| a host tool (a GUI, a .NET app, `sqlcmd`)            | `localhost` and the **published** port                            |

## exec into the running service

```powershell
docker compose ps                     # confirm the service name and that it is up
docker compose exec -T <svc> <client> <args>     # one-shot, scriptable
docker compose exec -it <svc> <client>           # interactive session
docker compose exec -it <svc> sh                 # a shell, when the client needs one
```

`-T` disables TTY allocation and is **required** for anything non-interactive. Without it, output
arrives with control characters, piping breaks, and the call can hang waiting on a terminal that
PowerShell never gave it. `-it` only for a session you will type into.

Credentials go in through `-e`, read from the host environment, never as a command-line argument:

```powershell
docker compose exec -T -e PGPASSWORD=$env:POSTGRES_PASSWORD postgres psql -U app -d appdb -c "select 1"
docker compose exec -T -e REDISCLI_AUTH=$env:REDIS_PASSWORD redis redis-cli INFO memory
```

A password on the command line is visible in the shell history, in the process list inside the
container, and in `docker inspect`. The environment-variable form is what every one of these
clients documents for exactly this reason.

## A throwaway container for a one-off

Use it when the service is not up, is not in this compose file, or lives somewhere else entirely.
The container exists for the length of one command and leaves nothing behind.

```powershell
docker network ls                                   # find the network the server is on
docker compose ps --format json                     # or read it from the running stack

# same network, so the server is reachable by its service name
docker run --rm -i --network <net> <the image the compose file names> `
  psql -h postgres -U app -d appdb -c "select 1"

# reaching something on the host from inside the throwaway container
docker run --rm -i <image> psql -h host.docker.internal -p <published-port> -U app -d appdb
```

Three rules for the throwaway form:

1. **Take the image from the compose file**, never invent a tag. `docker compose config` prints the
   resolved image, tag included — that is the value to use, so client and server still match.
2. **`--rm` always.** Without it, stopped one-off containers accumulate and later hold onto names
   and ports.
3. **Name the network explicitly.** With no `--network`, the container lands on the default bridge,
   where compose service names do not resolve and every connection fails on DNS, not on the server.

`host.docker.internal` is how a container reaches a listener on the Windows host. It is the right
answer for "the container has to call something I am debugging in the IDE", and the wrong answer for
container-to-container traffic — inside a shared network, use the service name.

## Files in and output out

```powershell
# a local script into the client's stdin — nothing is copied into the container
Get-Content .\migrate.sql | docker compose exec -T postgres psql -U app -d appdb -v ON_ERROR_STOP=1

# output back to a host file: keep it text-safe, or byte-exact for binary
docker compose exec -T postgres psql -U app -d appdb -At -c "select id, name from customer" |
  Set-Content .\customers.tsv
docker compose exec -T postgres pg_dump -U app -d appdb -Fc |
  Set-Content .\appdb.dump -AsByteStream       # binary: without -AsByteStream PowerShell corrupts it

# a file the container has to see as a file (a restore that seeks, a bulk import)
docker compose cp .\bulk.csv <svc>:/tmp/bulk.csv
docker compose exec -T <svc> <client> ... /tmp/bulk.csv
```

Prefer stdin over `cp` — it needs no cleanup and cannot go stale. Use `cp` only when the client must
seek within the file, or when the file is large enough that streaming it twice would hurt.

Two Windows-specific traps in this area:

- PowerShell decodes the stream it captures. For anything binary — a dump, an archive, an image —
  `-AsByteStream` on both `Get-Content` and `Set-Content`, or the bytes are silently mangled.
- A path with `\` is fine on the host side of `cp`; the container side is always `/`-separated.

## Exit codes matter more than they look

`docker compose exec` returns the client's exit code, which is what makes these commands usable in a
script. But most clients exit 0 on a SQL error unless told not to:

| Client       | Flag that makes a failure a failure           |
| ------------ | --------------------------------------------- |
| `psql`       | `-v ON_ERROR_STOP=1`                          |
| `sqlcmd`     | `-b`                                          |
| `redis-cli`  | check the output; errors come back as text     |

Without them, a broken migration script reports success and the pipeline or the loop carries on.

## Where the engine-specific recipes live

This file covers *how to get a client running*. What to type into it belongs to the domain skills:
`postgres` for `psql`, catalog queries and dump/restore; `redis-dotnet` for read-only Redis triage;
`sql-server` for the `sqlcmd` workflow and plans; `rabbitmq` for `rabbitmqctl` and the management API.
