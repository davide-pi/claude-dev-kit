# Batching, transactions, Lua, and locks that will disappoint you

## Pipelining is already happening

The multiplexer pipelines automatically: commands issued from different threads share the connection
and are written back to back. So the first tool for "many commands" is simply **not awaiting each
one in sequence**:

```csharp
// Wrong: N sequential round trips, latency = N × RTT
foreach (var id in ids) result.Add(await db.StringGetAsync(Key(id)));

// Right: fire them all, then await. One RTT for the batch, in practice.
var tasks = ids.Select(id => db.StringGetAsync(Key(id))).ToArray();
var values = await Task.WhenAll(tasks);
```

For a multi-key read of the same type, one command beats N: `StringGetAsync(RedisKey[])` maps to a
single multi-get. In a **cluster** the keys must hash to the same slot for that to work — hash tags
are the plugin's `redis-clustering` territory.

## `IBatch` versus `ITransaction`

| Tool                        | Guarantee                                                       | Use for                                             |
| --------------------------- | --------------------------------------------------------------- | --------------------------------------------------- |
| `Task.WhenAll` over commands | none beyond each command being atomic                           | independent reads and writes — the default          |
| `CreateBatch()` + `Execute()` | the commands are sent together, not interleaved with others from this multiplexer; **not** atomic | a burst issued from one place, latency-sensitive |
| `CreateTransaction()`       | queued and executed atomically, with optional preconditions      | "write these two keys, but only if X still holds"   |
| A Lua script                 | atomic, and it can *read and decide* server-side                 | read-modify-write, conditional logic, custom atomics |

```csharp
var tran = db.CreateTransaction();
tran.AddCondition(Condition.StringEqual(versionKey, expectedVersion));  // fails the whole thing
_ = tran.StringSetAsync(dataKey, payload, ttl);
_ = tran.StringIncrementAsync(counterKey);
bool committed = await tran.ExecuteAsync();   // false = a condition failed; nothing was applied
```

Two rules that catch people out: never `await` the inner command tasks **before** `ExecuteAsync` (it
deadlocks — they only complete after execution), and a transaction here is not a rollback mechanism.
Conditions are checked, then everything runs; there is no failure in the middle to undo.

## Lua when the logic must be server-side

```csharp
// Release a lock only if we still own it — the check and the delete in one atomic step.
static readonly LuaScript Release = LuaScript.Prepare(
    "if redis.call('get', @key) == @token then return redis.call('del', @key) else return 0 end");

var released = (int)await db.ScriptEvaluateAsync(Release, new { key = (RedisKey)lockKey, token });
```

`LuaScript.Prepare` uses `@name` parameters and caches the script hash, so subsequent calls send the
hash rather than the body. Keep scripts small and deterministic: Redis is single-threaded, so a slow
script blocks every other client. Never loop over an unbounded keyspace inside one.

## Fire-and-forget

`CommandFlags.FireAndForget` returns immediately and discards the reply. It is correct for counters,
metrics, and best-effort touches; it is wrong for anything a later line reads, because there is no
ordering guarantee against your own subsequent read on a different connection and no error if it
failed.

## Distributed locks — read this before using one

```csharp
var token = Guid.NewGuid().ToString("N");         // proves ownership
var ttl   = TimeSpan.FromSeconds(30);             // MUST exceed the worst-case work time

if (!await db.LockTakeAsync(lockKey, token, ttl)) return false;   // someone else has it
try
{
    await DoWorkAsync();                          // shorter than ttl, or extend it periodically
}
finally
{
    await db.LockReleaseAsync(lockKey, token);    // token-checked; never KeyDelete
}
```

`LockTake` is `SET key token NX PX ttl`; `LockRelease` is the compare-and-delete above. Both are
correct implementations of what they claim. The problem is what people believe they claim.

| Belief                                             | Reality                                                                 |
| -------------------------------------------------- | ----------------------------------------------------------------------- |
| "Only one worker can be inside the critical section" | False. The TTL expires on wall-clock time, not on your progress. A long GC pause, a slow database call or a paused container and a second worker enters legitimately |
| "The lock protects the data"                        | It does not. Nothing stops the first worker's write from landing after the second worker took the lock — there is no fencing token in Redis |
| "It survives a failover"                            | A single-node lock does not: the replica may not have the key yet. Multi-node lock algorithms trade that for clock assumptions that are also not free |
| "Releasing is safe"                                 | Only with the token check. `KeyDelete` on the lock key will happily release a lock another worker now holds |
| "It is a mutex"                                     | It is an **optimisation**: it usually prevents duplicate work. Treat every outcome as "the work may have run twice" |

**Therefore:** use a Redis lock to avoid *wasted* work — one cache rebuild instead of ten, one
report generation instead of five. Never use it to protect correctness. Correctness lives where
there is a real guarantee:

| Requirement                          | Where it belongs                                                    |
| ------------------------------------ | ------------------------------------------------------------------- |
| Exactly one row inserted             | a unique constraint in the database                                 |
| A state transition happening once    | a conditional `UPDATE ... WHERE Status = @expected` and check the row count |
| A monetary operation                 | a database transaction, with an idempotency key on the request       |
| A job that must not run twice        | a durable claim row, or the scheduler's own guarantee                |
| Serialising updates to one Redis key | an atomic command or a Lua script, not a lock around a get-then-set  |

If a lock is genuinely needed: size the TTL above the worst case (not the average), extend it with
`LockExtendAsync` for long work rather than picking a huge TTL, keep the critical section short and
free of external calls, and make the protected work **idempotent** so a double execution is harmless.
Idempotent work plus a best-effort lock is a design that holds; a lock trusted as a mutex is not.

## Counters and rate limits

These are the cases where Redis gives a real guarantee, because the command itself is atomic:

```csharp
var count = await db.StringIncrementAsync(key);
if (count == 1) await db.KeyExpireAsync(key, window);   // first hit in the window starts the clock
if (count > limit) return TooManyRequests();
```

The `KeyExpire` after the increment is a two-step race — under contention both callers can see
`count == 1`. A Lua script that increments and sets the expiry together removes it, and is the
correct form for anything user-facing.
