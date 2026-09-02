# Async and concurrency discipline

## Async all the way, or not at all

Async is a property of a call chain, not of a method. One synchronous link forces the caller to block
and undoes the benefit for everything above it.

| Must be async | Should stay synchronous |
|---|---|
| Anything doing network, disk, database or broker I/O | Pure computation, mapping, validation of in-memory data |
| Any method whose implementation might later do I/O across an interface boundary | Property getters, constructors, `Equals`, comparers |
| Endpoint actions and handlers that call the above | Anything a synchronous framework contract forces |

An interface method that any implementation could implement with I/O should return a task from the
start. Retrofitting async through a deep interface later is a large, risky diff.

## The sync-over-async deadlock

`.Result`, `.Wait()`, `.GetAwaiter().GetResult()` and `Task.Run(...).Result` on a task that has not
completed block the calling thread until it does.

- In modern ASP.NET there is no synchronization context, so it does not deadlock — it starves the
  thread pool instead. Under load, requests queue behind blocked threads; the symptom is latency that
  climbs with concurrency while CPU stays low, and it looks nothing like the cause.
- In the legacy .NET Framework tool (and in any UI context) there **is** a context, so the
  continuation needs the very thread that is blocked: a hard, permanent deadlock.

The fix is always the same: make the caller async up to a boundary the framework can await. Where the
boundary genuinely cannot be async — a synchronous plugin contract, a legacy interface you do not own
— isolate the blocking call in one clearly named method, document why, and never let that pattern
spread inward.

## Cancellation tokens

- Accept a token in every async method that does I/O or loops, and pass it down: endpoint token →
  application service → repository → query and HTTP call.
- A token accepted and ignored is worse than no token: it implies cancellation works.
- The request-abort token cancels when the client disconnects. Use it for reads. Do **not** use it
  for a write that must complete once started — a cancelled transaction mid-commit is a support call.
  Use a separate token, or none, for the commit path.
- Combine tokens (request plus a timeout) with a linked source, and dispose it.
- `OperationCanceledException` is not an error. Do not log it at error level and do not map it to 500;
  it is the expected outcome of a cancelled request.
- Background services get a stopping token; a loop that ignores it makes shutdown hang until the host
  kills it, which loses in-flight work.

## `ConfigureAwait` reality here

| Code | Do |
|---|---|
| Application code in a modern ASP.NET service | nothing — there is no context to capture, so it changes nothing but noise |
| A shared library that could be consumed by the legacy .NET Framework tool or a UI | `ConfigureAwait(false)` on every await |
| The legacy .NET Framework tool itself | `ConfigureAwait(false)` in its non-UI layers |

Do not add it to a whole modern service to look thorough, and do not remove it from a library that
has it. If a repository has an analyzer enforcing one convention, follow the analyzer.

## Concurrency versus parallelism

| | Concurrency | Parallelism |
|---|---|---|
| Problem | many I/O waits at once | one CPU-bound job split across cores |
| Tool | `await` with a task-combining fan-out | the parallel loop APIs |
| Threads used | few — they are released while waiting | one per core, all busy |
| Wrong tool symptom | parallel loop over I/O: threads block, throughput drops | tasks over CPU work: no gain, extra allocation |

Web request handling is concurrency, almost always. Genuine parallelism in a web service is rare and
suspicious: it steals thread-pool threads from other requests. Push it to a background worker.

## Bounded fan-out

Awaiting a combined set of tasks over a collection is right for a handful of independent calls. Over
an unbounded collection it is a self-inflicted denial of service: hundreds of simultaneous database
or HTTP calls will trip connection pools, throttles and circuit breakers.

- For I/O: the async parallel-loop API with an explicit maximum degree of parallelism, or a
  semaphore-gated loop. Choose the limit from the downstream pool size, not from the core count.
- Exceptions: a combined await throws only the first exception; inspect the resulting aggregate (or
  each task) when you need all of them.
- One `DbContext` cannot serve a fan-out. Give each parallel branch its own scope and context, or do
  the database work sequentially and parallelize only the external calls.

## Streaming instead of buffering

Returning an async stream from a repository lets the caller process rows as they arrive instead of
materializing a large list. Two constraints: the enumeration must finish inside the scope that owns
the context, and the token must be passed to the enumerator. Do not expose an async stream across a
layer whose lifetime you do not control.

## Thread-pool starvation, recognized

Symptoms together: request latency rising with concurrency, low CPU, a growing thread count, timeouts
on healthy dependencies. Causes, in order of frequency: blocking on async, synchronous file or
database calls on hot paths, a lock held across an await, and `Task.Run` used to "make it async".

Confirm it rather than guessing — the thread-pool queue length and thread count counters say so
directly. See `dotnet-diagnostics`, `triage.md`.

## Locks and async

Never hold a plain lock across an await: it is a compile error with the language lock statement and a
correctness disaster when hand-rolled, because the continuation may run on another thread. Use an
async-aware semaphore for mutual exclusion around async work, and keep the critical section tiny.
Better still, remove the shared mutable state instead of guarding it.

## Fire and forget

There is no safe fire-and-forget in a hosted process: an unawaited task loses its exception, and a
shutdown loses the work. If the caller must not wait, hand the work to a queued background service, a
Quartz job, or a broker message — something with a lifetime the host knows about and a retry story.

## Value tasks

Return a value task only on a hot path that usually completes synchronously, and then respect its
rules: await it exactly once, never block on it, never store it. Elsewhere, a plain task is correct
and cheaper to reason about.
