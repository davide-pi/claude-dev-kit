# Inspecting a live instance with no local CLI

`redis-cli` is **not installed on this machine**. Use the one inside the running container, so the
client always matches the server.

```powershell
docker compose ps                                    # find the service name
docker compose exec -T redis redis-cli PING          # PONG, or nothing is listening
docker compose exec -it redis redis-cli              # interactive shell for exploration
```

`-T` for anything scripted or captured; `-it` only for the interactive shell.

**Authentication.** Pass the secret through the environment, never as an argument — an argument
lands in the shell history and in `docker inspect`:

```powershell
docker compose exec -T -e REDISCLI_AUTH=$env:REDIS_PASSWORD redis redis-cli INFO memory
```

No compose service (a standalone container, or a managed endpoint)? Run a throwaway client from the
**same image the compose file already names**, attached to the same network — never invent a tag:

```powershell
docker network ls
docker run --rm -it --network <net> <that-image> redis-cli -h <host> -p <port>
```

The server may be a **Redis-compatible** implementation rather than Redis itself. `INFO server`
names it; when a command or a module below is missing, that is why, and it is not worth working
around.

## Triage, in order

```powershell
$r = @('compose','exec','-T','redis','redis-cli')

docker @r INFO server        # which implementation and release this actually is
docker @r INFO clients       # connected_clients, blocked_clients, maxclients
docker @r INFO memory        # used_memory_human, maxmemory, maxmemory_policy, evicted keys
docker @r INFO stats         # keyspace hits/misses, expired_keys, evicted_keys, rejected connections
docker @r INFO keyspace      # keys per database, and how many have a TTL
docker @r DBSIZE             # keys in the current database
docker @r --stat             # a live one-line-per-second view: ops/sec, clients, memory
docker @r --latency          # round-trip latency sampled continuously
docker @r SLOWLOG GET 20     # the commands that actually took time, with their arguments
docker @r CLIENT LIST        # who is connected — this is why ClientName is set in the app
```

| Reading                                                    | Means                                                          |
| ---------------------------------------------------------- | -------------------------------------------------------------- |
| `evicted_keys` climbing                                    | at the memory limit: keys vanish before their TTL               |
| `expired_keys` climbing, `evicted_keys` flat               | healthy — TTLs are doing their job                              |
| Keyspace hits far below misses                             | the TTL is too short, the key is wrong, or the data is not cacheable |
| `blocked_clients` non-zero                                 | someone is using a blocking command                              |
| `rejected_connections` non-zero                            | past `maxclients` — look for a multiplexer created per request   |
| `connected_clients` far above the number of services       | the same, or an exporter and a backplane nobody counted           |
| A `SLOWLOG` entry for `KEYS`, `SMEMBERS`, `HGETALL`, `FLUSHDB` | an O(n) command blocking the single command thread          |
| `INFO keyspace` shows many keys and few with a TTL          | writes without an expiry                                         |

## Looking at keys

```powershell
docker @r --scan --pattern 'orders:prod:order:*' --count 100   # SCAN based: safe on a live server
docker @r TYPE orders:prod:order:42
docker @r TTL orders:prod:order:42            # -1 = no expiry (a bug), -2 = the key is gone
docker @r OBJECT ENCODING orders:prod:order:42
docker @r MEMORY USAGE orders:prod:order:42
docker @r GET orders:prod:order:42            # readable when the payload is JSON — a reason to use JSON
docker @r --bigkeys                           # the largest key per type: head-of-line blocking suspects
docker @r --hotkeys                           # requires the LFU eviction policy to be configured
docker @r --memkeys                           # memory distribution across the keyspace
```

`--scan` is the only safe way to enumerate. `KEYS` walks the whole keyspace in one blocking command
and will freeze a production instance.

## Pub/sub, for the backplane

```powershell
docker @r PUBSUB CHANNELS 'orders-hub:*'      # are the servers subscribed at all?
docker @r PUBSUB NUMSUB 'orders-hub:all'      # how many servers are listening on this channel
docker @r --timeout 10 PSUBSCRIBE 'orders-hub:*'   # watch traffic for ten seconds, then stop
```

`PSUBSCRIBE` blocks the CLI (not the server) until interrupted, so bound it with `--timeout`.

## What never to run against a shared instance

| Command                        | Why not                                                             |
| ------------------------------ | ------------------------------------------------------------------- |
| `FLUSHALL` / `FLUSHDB`         | deletes everything. Announce and confirm before it is even typed     |
| `KEYS <pattern>`               | O(keyspace), blocking. Use `--scan`                                  |
| `MONITOR`                      | streams every command; a measurable throughput hit while it is open. Use `SLOWLOG` |
| `CONFIG SET`                   | changes the server for every client, and is not persisted             |
| `DEBUG SLEEP`, `DEBUG SEGFAULT` | exactly what they say                                                |
| `SHUTDOWN`                     | with a save, it also blocks; without one, it loses data              |
| `CLIENT KILL`                  | disconnects someone else's application                               |
| `SCRIPT FLUSH`                 | every cached script hash re-uploads on next use                       |

**Read-only by default.** `INFO`, `SLOWLOG`, `CLIENT LIST`, `TYPE`, `TTL`, `MEMORY USAGE`, `--scan`,
`GET`-family reads and `PUBSUB` are safe. Anything that writes or deletes is announced first, and
never run against an instance shared with someone else's work — even a local container may be the
one the rest of the stack depends on.

Deleting a specific key during a diagnosis is acceptable when the value is derived and rebuildable:
`docker @r DEL <key>` on one named key, never on a pattern.

## Configuration this stack cares about

```powershell
docker @r CONFIG GET maxmemory
docker @r CONFIG GET maxmemory-policy    # for a pure cache, an LRU/LFU policy over volatile keys
docker @r CONFIG GET appendonly          # a cache does not need persistence; a backplane never does
docker @r CONFIG GET timeout             # server-side idle disconnect, versus the client's KeepAlive
docker @r CONFIG GET maxclients
```

Read these; changing them belongs to whoever owns the compose file. Alerting thresholds and metric
choice belong to the `redis-development` plugin's observability skill, not here.
