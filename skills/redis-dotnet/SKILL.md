---
name: redis-dotnet
description: >-
  The .NET client side of Redis: the connection multiplexer as a long-lived singleton, connection
  and timeout configuration, sync-over-async and the thread-pool starvation it causes, cache-aside
  with stampede protection, key prefixes and expiry from the caller's point of view, the SignalR
  backplane, batching, transactions and Lua from .NET, distributed locks and their limits, and
  inspecting a live instance through docker because no Redis CLI is installed on this machine. Use
  when writing or reviewing .NET code that talks to Redis, when a Redis timeout or a cache-related
  latency spike appears, or when configuring caching or the backplane in a service. Data modelling,
  clustering, search, security and observability belong to the redis-development plugin.
---

# redis-dotnet — the client half: connection lifetime, timeouts, cache-aside, locks

> **The `redis-development` plugin owns everything that is not the .NET client** — data structures
> and key naming (`redis-core`), clustering and hash tags (`redis-clustering`), search and vectors
> (`redis-search`), authentication and ACLs (`redis-security`), metrics and incident triage
> (`redis-observability`), semantic caching (`redis-semantic-cache`) and the language-agnostic
> connection fundamentals (`redis-connections`) — so route there for those and never restate them
> here.

Redis has a real .NET client in exactly **one** platform, serving three jobs: application caching,
the SignalR backplane, and a metrics exporter. Elsewhere a Redis-compatible server sits in compose as
infrastructure with no client — check `INFO server` before assuming a command or module exists.

## When

- Writing or reviewing .NET code that reads from or writes to Redis.
- A `RedisTimeoutException`, a `RedisConnectionException`, or a latency spike that correlates with
  cache traffic.
- Registering the client in DI, or reviewing how and where the connection is created.
- Designing a cache-aside path: what to cache, under which key, for how long, and what happens when
  it expires under load. Configuring the SignalR backplane. Reaching for a distributed lock.
- Needing to look at a live instance — the CLI is **not installed**; go through docker.

Not for: Redis data modelling, clustering, search, security, observability or semantic caching (the
`redis-development` plugin); the compose service (`docker-dev-env`); response-cache policy
(`dotnet-backend`); general .NET latency work (`dotnet-diagnostics`).

## Decide

**Should this be in Redis at all?**

| Signal                                                        | Answer                                         |
| ------------------------------------------------------------- | ---------------------------------------------- |
| Expensive to compute, read far more often than it changes     | cache it                                       |
| Read once per user per session                                | do not cache — the miss cost is the whole cost |
| Must be correct at the instant it is read                     | do not cache, or accept the staleness explicitly |
| Shared state across instances (a backplane, a rate limit)     | Redis, and it is not a cache                    |
| Per-instance memoisation, small and cheap                     | in-process memory cache — no network hop        |
| Hot in memory *and* shared across instances                   | two-level cache — `references/cache-aside.md`   |
| It is the source of truth                                     | no — Redis here is derived, always rebuildable  |

**A Redis timeout — read the exception message before changing anything.** It carries counters, and
they name the cause.

| In the message                                             | Cause                                                            |
| ---------------------------------------------------------- | ---------------------------------------------------------------- |
| `WORKER: (Busy=…, Free=…, Min=…)` with `Busy` above `Min`  | thread-pool starvation, almost always from sync-over-async        |
| `qs=` large (queued to the server)                         | head-of-line blocking: a big value or a slow command ahead of yours |
| `in=` / `in-pipe=` large                                   | a large response is still arriving — payload size is the problem   |
| `mgr=` not `Inactive`                                      | the connection is reconnecting                                     |
| `sync-ops` climbing, `async-ops` flat                      | the code path is synchronous — fix that first                       |
| Only on one endpoint, `mgr` fine, counters small           | genuine server-side latency → `references/inspect-via-docker.md`   |

**Distributed lock, or something else?**

| Need                                                     | Use                                                        |
| -------------------------------------------------------- | ---------------------------------------------------------- |
| Avoid two instances doing the same expensive work        | a Redis lock — a best-effort optimisation, and that is fine |
| Guarantee an operation happens exactly once              | **not** a Redis lock: a unique constraint or a conditional `UPDATE` in the database |
| Serialise access to a single key's value                 | an atomic Redis command or a Lua script, not a lock         |
| A counter, a rate limit, a one-shot flag                 | `StringIncrement`, or `StringSet` with `When.NotExists`     |
| Leader election, a job that must not run twice           | the database, or a real coordination service                |

**Never** in application code: `KEYS`, `FLUSHDB`/`FLUSHALL`, `CONFIG SET`, `MONITOR`, or anything
needing `AllowAdmin` — which stays off in the application's configuration.

## Do

```csharp
// ONE multiplexer for the process lifetime: thread-safe, and it multiplexes every caller over a
// couple of physical connections. Creating one per request is the classic disaster.
builder.Services.AddSingleton<IConnectionMultiplexer>(_ =>
{
    var o = ConfigurationOptions.Parse(cfg.GetConnectionString("Redis")!);
    o.AbortOnConnectFail = false;   // the container may start after the app: retry, do not throw
    o.ConnectRetry       = 3;
    o.ConnectTimeout     = 5_000;
    o.SyncTimeout        = 5_000;
    o.AllowAdmin         = false;   // no FLUSHDB, no CONFIG, ever, from the app
    o.ClientName         = "orders-api";  // shows up in CLIENT LIST during triage
    o.ChannelPrefix      = RedisChannel.Literal("orders:");  // isolate a shared instance
    return ConnectionMultiplexer.Connect(o);
});

// GetDatabase() is a cheap handle, not a connection — take it per operation.
var db = mux.GetDatabase();
await db.StringSetAsync(key, payload, TimeSpan.FromMinutes(10));  // always with an expiry
```

```powershell
# The Redis CLI is NOT installed. Use the client inside the running container.
docker compose exec -T redis redis-cli INFO clients
docker compose exec -T redis redis-cli --stat            # live ops/sec, clients, memory
docker compose exec -T redis redis-cli SLOWLOG GET 10    # the commands that actually took time
docker compose exec -T redis redis-cli --bigkeys         # payloads causing head-of-line blocking
# Authenticated instance: pass the secret through the environment, never on the command line.
docker compose exec -T -e REDISCLI_AUTH=$env:REDIS_PASSWORD redis redis-cli INFO memory
```

## Traps

1. A multiplexer created per request or inside a `using` → connection storm, then timeouts under
   load → one singleton for the process; register `IConnectionMultiplexer`, not a connection.
2. `.Result` / `.Wait()` on a Redis call → the thread pool starves and every call times out at once
   → async all the way; raising the minimum thread count is a stopgap, not the fix.
3. A value written with no expiry → memory grows until eviction drops keys you needed → every cache
   write carries a TTL.
4. A thousand keys expiring in the same second after a deploy → a stampede on the database → add
   jitter to the TTL.
5. A miss handled by "compute and store" with no coordination → N instances compute the same thing
   at once → single-flight in process plus a short lock across instances.
6. Invalidation via `KEYS prefix:*` → an O(n) command that blocks the server → version the prefix
   and let the old keys expire.
7. A lock taken with `LockTake` and released with `KeyDelete` → releases somebody else's lock after
   a timeout → release with the same token, so the check and the delete are atomic.
8. Lock TTL shorter than the work it protects → two workers believe they hold it → size the TTL
   above the worst case, and extend it for long work.
9. A cached object graph serialised with type information → a deploy changes the type and every read
   throws → version the key when the payload shape changes.
10. Two SignalR servers on different hub protocols, or a shared instance with no channel prefix →
    messages silently lost or crossing applications → pin the protocol, set `ChannelPrefix`.
11. `FireAndForget` used for a value the next line reads → the read races the write → that flag is
    for metrics and counters only.
12. `AbortOnConnectFail` left on → one cold start becomes a crash loop → off, and let it reconnect.

## References

- `references/multiplexer.md` — DI registration, the options that matter, reconnection, and reading a
  timeout's counters.
- `references/cache-aside.md` — read-through with stampede protection, TTL and jitter, negative and
  two-level caching, serialisation, key prefixes and versioned invalidation.
- `references/signalr-backplane.md` — wiring it, what it does and does not guarantee, channel
  prefixes, and what the metrics exporter watches.
- `references/batching-and-locks.md` — pipelining, batches, conditional transactions, Lua from .NET,
  and distributed locks with their failure modes written down.
- `references/inspect-via-docker.md` — read-only triage with no local CLI: clients, memory, slow log,
  big keys, key inspection, and what never to run.
