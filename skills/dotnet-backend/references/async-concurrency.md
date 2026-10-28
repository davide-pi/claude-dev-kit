# Async and concurrency discipline

## Sync-over-async

`.Result`, `.Wait()`, `.GetAwaiter().GetResult()` on an incomplete task:

- Modern ASP.NET has no synchronization context: no deadlock, but **thread-pool starvation**. Latency
  climbs with concurrency while CPU stays low, and it looks nothing like the cause.
- The legacy .NET Framework tool (and any UI context) **has** a context: a hard, permanent deadlock.

Fix: make the caller async up to a boundary the framework can await. Where it genuinely cannot be (a
synchronous plugin contract, a legacy interface you do not own), isolate the blocking call in one named
method, document why, and never let it spread inward.

An interface method any implementation could back with I/O returns a task from the start; retrofitting
async through a deep interface later is a large, risky diff.

## Cancellation tokens

- Pass the token down the whole chain: endpoint → service → repository → query / HTTP call. A token
  accepted and ignored is worse than none.
- The request-abort token fires on client disconnect: use it for reads. **Not** for a write that must
  complete once started — a cancelled transaction mid-commit is a support call. Use a separate token,
  or none, for the commit path.
- `OperationCanceledException` is not an error: no error-level log, no 500.
- Background services honour the stopping token, or shutdown hangs until the host kills them and
  in-flight work is lost.

## `ConfigureAwait` reality here

| Code | Do |
|---|---|
| application code in a modern ASP.NET service | nothing — no context to capture |
| a shared library that the legacy .NET Framework tool or a UI could consume | `ConfigureAwait(false)` on every await |
| the legacy .NET Framework tool's non-UI layers | `ConfigureAwait(false)` |

Do not add it across a modern service to look thorough, and do not remove it from a library that has
it. An analyzer enforcing a convention wins.

## Bounded fan-out and the DbContext

- An await over a combined set of tasks is fine for a handful of calls; over an unbounded collection it
  trips connection pools, throttles and circuit breakers. Use the async parallel-loop API with an
  explicit max degree, or a semaphore-gated loop. Take the limit from the downstream pool size, not the
  core count.
- A combined await surfaces only the first exception: inspect the aggregate when you need all.
- **One `DbContext` cannot serve a fan-out.** Each branch gets its own scope and context, or do the
  database work sequentially and parallelize only external calls.
- Genuine parallelism (CPU-bound) in a web service steals pool threads from other requests: push it to
  a background worker.
- An async stream from a repository must finish enumerating inside the scope that owns the context, and
  take the token. Do not expose it across a layer whose lifetime you do not control.

## Thread-pool starvation, recognised

Latency rising with concurrency, low CPU, growing thread count, timeouts on healthy dependencies.
Causes by frequency: blocking on async, synchronous file/database calls on hot paths, a lock held across
an await, `Task.Run` used to "make it async". Confirm with the thread-pool queue length and thread count
counters (`dotnet-diagnostics`), do not guess.

## Locks, fire-and-forget, value tasks

- Never hold a plain lock across an await; use an async-aware semaphore with a tiny critical section,
  or remove the shared mutable state.
- No safe fire-and-forget in a hosted process: the exception is lost and shutdown loses the work. Hand
  it to a queued background service, a Quartz job or a broker message — something the host knows about,
  with a retry story.
- A value task only on a hot path that usually completes synchronously; await once, never block, never
  store it.
