# Redis from .NET — the house facts

Generic Redis (data structures, key design, connections, clustering, security, observability) is
the `redis-development` plugin's. It is **off by default** because its descriptions weigh on every
turn: when the question is generic, say so and enable it
(`claude plugin enable redis-development@claude-plugins-official`). Everything below is what the
plugin cannot know.

## How the client is wired

The shared cache SDK's options builder registers singletons from `StackExchange.Redis.Extensions`
(pool manager, `IRedisClient`, Newtonsoft serializer) plus its own `ICacheAdapter`,
`ICacheContainer` and `IStreamManager`. Connection options are fixed in code:
`AbortOnConnectFail=false`, `ConnectRetry=5`, connect and sync timeouts 5000 ms, `KeepAlive=60`,
exponential reconnect 1–10 s.

| Want | Do | Never |
| --- | --- | --- |
| a cache read or write | inject the SDK's `ICacheAdapter` / `IRedisClient` | a new `ConnectionMultiplexer` in a service — a second, unmanaged pool |
| a cache entry | always a TTL | a key with no expiry: memory pressure then evicts keys that mattered |
| a call | `await` it | `.Result` on an SDK call — every call times out together under load |

## Streams as a work queue

| Side | What the code does |
| --- | --- |
| producer | `StreamAddAsync` with an **approximate** `maxLength` (default 100), sometimes a key TTL |
| consumer | creates the group from the beginning with `createStream: true`, reads `StreamReadGroupAsync(">")`, `noAck: false`, acks after the handler |
| trigger | a RabbitMQ event wakes the drain loop; a lock key makes one instance drain at a time |

Consequences, each a real incident shape:

| Symptom | Cause | Fix |
| --- | --- | --- |
| entries pile up in `XPENDING`, never retried | the handler threw: caught, logged, never acked, never claimed | a claim-and-retry path (`XAUTOCLAIM`) with an attempt limit, or ack and dead-letter explicitly |
| unread entries vanish | approximate trimming at a small `maxLength`, or the stream key's TTL | raise `maxLength`; no TTL on a stream that carries work |
| the whole stream and its group state are gone | the stream key had a TTL and expired | never a TTL on a consumer-group stream |
| the stream stalls after a crash | the drainer died holding the lock key | wait for the lock's expiry, or shorten it to the drain's real duration |

## A `RedisTimeoutException` — read the counters in the message first

| Counter in the message | Means | Go to |
| --- | --- | --- |
| `WORKER` busy above min | thread-pool starvation from sync-over-async | `async-concurrency.md` |
| large `qs=` | head-of-line blocking behind a big value | split or shrink the value |
| large `in=` | payload size on the way back | narrower reads |
| `mgr=` not `Inactive` | the multiplexer is reconnecting | the network or the server, not the code |

## Inspecting a local instance

```powershell
$r = @('compose','exec','-T','redis','redis-cli')   # or: docker exec <container> redis-cli
docker @r XINFO GROUPS <stream>                     # per group: consumers, pending, last-delivered-id
docker @r XPENDING <stream> <group> - + 20          # stuck entries, idle time, delivery count
docker @r XLEN <stream>; docker @r TTL <stream>; docker @r SLOWLOG GET 10
```

- The password travels as `-e REDISCLI_AUTH=…`, never on the command line.
- A shared or non-dev instance: `/db` with the redis target, never a raw `redis-cli` (the shell hook
  denies it). `KEYS`, `MONITOR`, `CONFIG` ask; `FLUSHALL`, `FLUSHDB` and writes are denied.
- `XACK` and `XDEL` only when the user asks for exactly that.
- Exec and throwaway-container mechanics: the `docker-dev-env` skill.
