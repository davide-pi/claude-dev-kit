# Cache-aside from .NET — keys, expiry, and the stampede

## The shape

Read the cache; on a miss, compute from the source of truth, write it back with a TTL, return it.
Three properties make it correct rather than merely working:

1. A miss and a Redis failure take the **same** path — the fallback. A cache outage degrades
   latency, never availability.
2. Every write carries an expiry. A key with no TTL is a memory leak with a schedule set by the
   eviction policy.
3. Concurrent misses on the same key do the work **once**.

```csharp
public async Task<Order?> GetAsync(int id, CancellationToken ct)
{
    var key = $"{Prefix}:order:{id}";                 // Prefix carries app, env and payload version
    try
    {
        var hit = await _db.StringGetAsync(key);
        if (hit.HasValue) return Deserialize(hit!);
    }
    catch (RedisException ex) { _log.LogWarning(ex, "cache read failed for {Key}", key); }

    // Single-flight per key, per process: N concurrent misses become one database call.
    var gate = _gates.GetOrAdd(key, _ => new SemaphoreSlim(1, 1));
    await gate.WaitAsync(ct);
    try
    {
        var second = await _db.StringGetAsync(key);    // someone may have filled it while we waited
        if (second.HasValue) return Deserialize(second!);

        var order = await _repo.LoadAsync(id, ct);
        var ttl = Jitter(TimeSpan.FromMinutes(10));
        await _db.StringSetAsync(key, Serialize(order), ttl);   // negative result cached too, briefly
        return order;
    }
    finally { gate.Release(); _gates.TryRemove(key, out _); }
}

static TimeSpan Jitter(TimeSpan ttl) =>
    ttl + TimeSpan.FromMilliseconds(Random.Shared.Next(0, (int)(ttl.TotalMilliseconds * 0.2)));
```

Where the framework offers a hybrid cache abstraction, prefer it: it does the two-level lookup and
the single-flight for you. Check whether the package is available in the project's package
management before writing the plumbing by hand.

## Stampede protection, by blast radius

| Scope                                   | Mechanism                                                            | Cost                       |
| --------------------------------------- | -------------------------------------------------------------------- | -------------------------- |
| One process, one key                    | `SemaphoreSlim` per key (above), or a `Lazy<Task<T>>` cache of in-flight work | none worth mentioning |
| All instances, one key                  | a short Redis lock around the recompute — see `batching-and-locks.md` | a round trip, and a lock to get wrong |
| Predictable expiry of many keys at once | jittered TTL                                                          | none                       |
| A very hot, very expensive key          | soft/hard TTL: serve the stale value past the soft TTL while one caller refreshes in the background | slightly stale reads |
| A key that must never miss              | write-through or a scheduled refresher, TTL well above the refresh interval | a background job to own  |

The soft/hard pattern is the one that actually saves an incident: store `{ value, refreshAfter }`
with the Redis TTL set well beyond `refreshAfter`. A reader past `refreshAfter` returns the stale
value immediately and kicks off one refresh. No reader ever waits on the database.

## Expiry

| Decision                          | Guidance                                                                |
| --------------------------------- | ----------------------------------------------------------------------- |
| TTL length                        | as long as the business tolerates staleness, not as long as it is "safe" |
| Sliding expiry                    | Redis has no sliding TTL: re-issue `KeyExpire` on each read, and accept the extra round trip |
| No TTL at all                     | only for a key an operator explicitly manages, never for derived data    |
| Very short TTLs (a few seconds)   | fine, and often the right answer for a hot aggregate                     |
| Per-field expiry inside a hash    | availability depends on the server release — verify with `INFO server`, and otherwise use one key per field |
| Eviction policy                   | a server setting, not the client's business; assume keys can vanish early |

Assume **any key can disappear at any moment** — eviction, a restart, a failover. Code that breaks
when a key is missing is not a cache client.

## Keys, from the caller's side

Naming conventions themselves belong to the `redis-development` plugin. What matters on this side is
the **prefix contract**:

```text
<app>:<env>:<entity>:<id>:v<payloadVersion>
orders:prod:order:42:v3
```

| Segment          | Why the client cares                                                        |
| ---------------- | --------------------------------------------------------------------------- |
| `app`            | one instance is shared by more than one service; a prefix is the only isolation that survives |
| `env`            | a local run pointed at a shared instance must not read production keys       |
| `entity` / `id`  | makes a key readable during triage, and greppable in the slow log            |
| `v<version>`     | **the invalidation mechanism**: bump it and every old key becomes unreachable and expires on its own |

Build the prefix in **one** place — a single key-builder type — and never concatenate keys inline.
Two spellings of the same key is a bug no test catches.

**Invalidation:** targeted `KeyDelete` when the write path knows the key; a version bump when it does
not. Never `KEYS pattern` — it is O(keyspace) and blocks the server for everyone. `SCAN` exists, but
if invalidation needs a scan, the key design is wrong.

## Serialisation

| Choice                                  | Consequence                                                       |
| --------------------------------------- | ----------------------------------------------------------------- |
| JSON, contract-first DTO, no type names | portable, debuggable in the CLI, safe across deploys — the default |
| JSON with type information embedded     | a renamed or moved type breaks every cached value at once          |
| A binary contract-based serialiser      | smaller and faster; worth it for large or very hot payloads         |
| The framework's binary formatter        | never                                                             |
| Compression                             | only above a few tens of kilobytes; measure before adding it        |

Cache a **DTO**, never a domain entity with lazy-loaded navigation properties or an ORM proxy. And
treat the payload shape as a versioned contract: change the shape, bump the key version — a
deserialisation exception on every read is the alternative.

## What not to cache

- Anything that must be correct at the instant it is read (a balance before a transfer, a lock).
- A per-user value read once per session — the miss is the whole cost.
- Data the caller can hold in process for the length of one request; use a request-scoped dictionary.
- A result cheaper to recompute than to round-trip: Redis is a network hop, not free memory.
- Secrets, tokens, or personal data beyond what the feature needs — the instance is shared and its
  contents are visible to anyone with the CLI.
