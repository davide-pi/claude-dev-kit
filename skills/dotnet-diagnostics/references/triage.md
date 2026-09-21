# Triage playbooks: CPU, memory, hangs, latency, crashes

Rule for all of them: **counters first**. They cost nothing, they run live, and they tell you which
playbook you are in. Guessing which playbook to open is how an afternoon disappears.

```powershell
dotnet-counters monitor -p <pid> --counters System.Runtime,Microsoft.AspNetCore.Hosting
```

## High CPU

1. Confirm it is this process, not a neighbour: the runtime's CPU counter, not the machine's.
2. Read the **GC pause time percentage** before anything else. Above a few percent, this is an
   allocation problem wearing a CPU costume; go to the memory playbook and fix allocation.
3. Otherwise collect a CPU profile under the load, thirty seconds, then stop:
   `dotnet-trace collect -p <pid> --profile cpu-sampling -o trace.nettrace`
4. Convert and read as a flame graph: `dotnet-trace convert --format speedscope trace.nettrace`.
5. Read **inclusive** time to find the guilty subtree, then **exclusive** time to find the guilty
   method. A wide flat profile with no dominant frame usually means serialization, regular
   expressions, logging, or reflection — all of which look innocuous per call.
6. Check the exception counter. Exceptions thrown on a normal path are expensive and invisible in the
   logs when they are caught.

Frequent real causes, in order: allocation churn; a regular expression compiled or backtracking per
call; JSON serialization of far more data than the response needs; logging at Debug in production; a
loop doing work per item that should be done once; and `Parallel` over I/O.

## High memory

First distinguish three different problems:

| Reading | Problem |
|---|---|
| Managed heap grows and never returns | a managed leak — something is rooted |
| Heap flat, working set grows | native memory: an unmanaged handle, a client library, or fragmentation |
| Both high but stable | it is a working set, not a leak — check the container limit and move on |
| Heap saw-tooths high with heavy gen 2 collections | allocation rate, not a leak: reduce garbage |

For a managed leak:

1. Two gcdumps a few minutes apart, under steady load:
   `dotnet-gcdump collect -p <pid> -o t1.gcdump` then `t2.gcdump`.
2. Diff them in the IDE's heap viewer. The type whose count grows linearly is the leak.
3. Find who holds it — the retention path is what you actually fix.

The recurring causes here are all "something long-lived holds something short-lived": a static
collection or cache with no eviction; an event handler subscribed and never unsubscribed; a captured
scoped service inside a singleton (`dotnet-backend`, `di-lifetimes.md`); a `DbContext` kept alive
tracking thousands of entities; a `Timer` or a task retaining its closure; and an ever-growing
in-memory buffer of log or telemetry items whose exporter is failing silently.

For large-object pressure: look for byte arrays and strings over the large-object threshold — usually
a whole file, a whole result set, or a base64 payload read into memory. Stream instead.

## A hang, or "nothing is responding"

1. CPU near zero plus no throughput equals blocked threads, not a busy loop.
2. `dotnet-stack report -p <pid> > stacks.txt`, and read it: group identical stacks. Twenty threads
   on the same frame is the answer.
3. What to look for in the stacks, in order:
   - a blocking wait on a task (`.Result`, `.Wait()`, `GetAwaiter().GetResult()`) — sync over async;
   - a monitor or semaphore wait held across I/O;
   - many threads inside the connection pool waiting for a connection — pool exhaustion, which
     usually means a connection or a context that is never disposed;
   - a distributed lock or a database lock — cross-check with the engine (`sql-server`).
4. Thread-pool thread count climbing one thread every half second is the runtime's injection rate: a
   textbook starvation signature.
5. If the stacks are not enough, take a full dump and look at lock ownership (`dumps.md`).

## Latency, without CPU or memory pressure

| Observation | Cause to test |
|---|---|
| Latency grows with concurrency, CPU flat | thread-pool starvation, or a pool limit (connections, HTTP handlers) |
| Latency is a fixed step, e.g. always a few seconds | a timeout plus a retry: the policy is multiplying the wait |
| First call slow, rest fast | cold start, JIT, pool warm-up, cache miss |
| One tenant or one input slow | data volume, a missing index, or a query whose plan changed |
| Spiky, correlated with GC pause | allocation |
| Latency at the gateway but not in the service's own metrics | queueing before the handler, or the network |

Then follow the narrowing ladder in the skill body. The single most useful measurement is the span
tree for one slow request (`telemetry.md`): it splits total time into database, outbound HTTP, and
in-process, which decides which of the other playbooks applies.

Watch for the **gap between spans**. Time inside no span is queueing — thread pool, connection pool,
or a lock — and it is invisible to anyone reading only span durations.

## Crashes and unhandled exceptions

1. The log first: the exception type, the message, and the correlation id. Most crashes need nothing
   else.
2. For a crash with no useful log, configure a dump on crash through the runtime's dump environment
   variables so the next occurrence leaves evidence, then wait for it.
3. Process disappearing with no exception at all is not a managed crash: check the container's exit
   code (an out-of-memory kill is the usual answer), the host's event log, and stack-overflow or
   out-of-memory conditions, which cannot be caught.
4. `async void` and unawaited tasks lose their exceptions and can take the process down without a
   trace. Grep for both before spending an hour in a dump.

## Before you close the incident

Write down: the symptom, how it was confirmed (which counter, which value), the cause, the fix, and —
the part that pays for itself — **what instrumentation would have shortened this**. Then add it. Most
incidents in an under-instrumented service are re-runs of an earlier one with the same blind spot.
