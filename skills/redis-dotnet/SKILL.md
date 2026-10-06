---
name: redis-dotnet
description: >-
  Use whenever .NET code reads or writes Redis — a cache key, a TTL, a Stream consumer group — or a
  RedisTimeoutException, a stuck stream or a cache latency spike appears. House facts only; generic
  Redis goes to the redis-development plugin.
---

# redis-dotnet — the house facts; everything generic is the plugin's

Generic Redis — data structures, keys, connections, clustering, security, observability — is the
`redis-development` plugin's (`redis-core`, `redis-connections`, `redis-observability`, …).

## When

- Code through the shared cache SDK changes: a cache key, a TTL, a stream, a lock key.
- A `RedisTimeoutException`, a stalled stream or a growing pending list; `redis-cli` is not installed.

Not for: anything generic (the plugin), the compose service (`docker-dev-env`), RabbitMQ (`rabbitmq`).

## Decide

**How the client is wired.** The cache SDK's options builder registers singletons from
`StackExchange.Redis.Extensions` (pool manager, `IRedisClient`, Newtonsoft serializer) plus its own
`ICacheAdapter`, `ICacheContainer`, `IStreamManager`. Options are fixed in code:
`AbortOnConnectFail=false`, `ConnectRetry=5`, connect/sync timeouts 5000 ms, `KeepAlive=60`,
exponential reconnect 1–10 s. A new `ConnectionMultiplexer` in a service is a second, unmanaged pool.

**Streams as a work queue.** Producers `StreamAddAsync` with an *approximate* `maxLength` (default 100)
and sometimes a key TTL; consumers create the group from the beginning with `createStream: true`, read
with `StreamReadGroupAsync(">")`, `noAck: false`, and ack after the handler. A RabbitMQ event wakes the
drain loop, guarded by a lock key so one instance drains at a time.

Consequences: a failed entry stays **pending forever** (caught, logged, never acked, never claimed);
approximate trimming at a small `maxLength` or the key TTL can drop unread entries; a crashed drainer
stalls the stream until its lock key expires.

**A timeout** — read the counters in the exception first: `WORKER` Busy above Min = thread-pool
starvation from sync-over-async (`dotnet-backend`); large `qs=` = head-of-line blocking behind a big
value; large `in=` = payload size; `mgr=` not `Inactive` = reconnecting.

## Do

```powershell
$r = @('compose','exec','-T','redis','redis-cli')   # or docker exec <container> redis-cli
docker @r XINFO GROUPS <stream>                     # per group: consumers, pending, last-delivered-id
docker @r XPENDING <stream> <group> - + 20          # the stuck entries, their idle time and delivery count
docker @r XLEN <stream>; docker @r TTL <stream>; docker @r SLOWLOG GET 10
```

Secrets via `-e REDISCLI_AUTH=…`, never on the command line. Never `KEYS`, `FLUSHDB`, `CONFIG SET` or
`MONITOR` on a shared instance; `XACK`/`XDEL` only on request. Exec mechanics: `docker-dev-env`.

## Traps

1. A handler fails → the entry sits in `XPENDING` and is never retried → add a claim-and-retry path
   (`XAUTOCLAIM`) with an attempt limit, or ack and dead-letter it explicitly.
2. A stream key with a TTL → the whole stream, group state included, vanishes when it expires.
3. A cache write with no TTL, or `.Result` on an SDK call → eviction of keys that mattered, or every
   call timing out at once under load.
