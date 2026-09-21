# .NET runtime diagnostics — a process misbehaving

Read this when the suspect is a running .NET process: slow, leaking, hanging, burning CPU, or
throwing where the code says it cannot.

## The tools, and the order to reach for them

| Order | Tool | Cost to the process | Answers |
|-------|------|--------------------|---------|
| 1 | `dotnet-counters` | negligible, live | Which resource is saturated |
| 2 | `dotnet-trace` | low, seconds of sampling | Which code path spends the time |
| 3 | `dotnet-dump` | freezes the process | What every thread and object was doing at one instant |
| — | `csharprepl` | none, out of process | Whether a suspect API behaves as assumed, in isolation |
| — | `ilspycmd` | none | What a dependency actually does |

Install what is missing: `dotnet tool install -g dotnet-counters` (same for `dotnet-trace`,
`dotnet-dump`). List live processes with `dotnet-counters ps`.

## Counters — what each number means

```powershell
dotnet-counters monitor -n <proc> --refresh-interval 1 `
  --counters System.Runtime,Microsoft.AspNetCore.Hosting,Microsoft.EntityFrameworkCore
```

| Counter | Reading | Verdict |
|---------|---------|---------|
| `cpu-usage` | pegged near a core multiple | CPU-bound: go to `dotnet-trace --profile cpu-sampling` |
| `gc-heap-size` | grows and never returns after gen-2 | A leak or a cache without eviction: dump and compare heaps |
| `gen-2-gc-count` | climbing steadily | Large or long-lived allocations; check `alloc-rate` and LOH |
| `time-in-gc` | above a few percent sustained | Allocation pressure is the bottleneck, not the algorithm |
| `threadpool-queue-length` | non-zero and rising | Thread-pool starvation: sync-over-async somewhere on a hot path |
| `threadpool-thread-count` | climbing slowly under steady load | Same diagnosis: the pool is injecting threads to cover blocked ones |
| `exception-count` | non-zero on a "working" path | Swallowed exceptions used as control flow; find them before anything else |
| `active-timer-count` | grows without bound | Timers or `CancellationTokenSource` never disposed |
| `current-requests` (Hosting) | high while CPU is idle | Waiting downstream: database, broker, HTTP dependency |
| `active-db-contexts` (EF) | grows without bound | A `DbContext` captured in a singleton or never disposed |

## Traces — where the time goes

```powershell
dotnet-trace collect -n <proc> --profile cpu-sampling --duration 00:00:30
dotnet-trace collect -n <proc> --providers Microsoft-Diagnostics-DiagnosticSource   # activity spans
dotnet-trace collect -n <proc> --profile gc-verbose                                  # allocation sites
```

Profiles: `cpu-sampling` for CPU-bound, `gc-verbose` for allocation pressure, `gc-collect` for GC
pauses only. The output is a trace file; open it in a viewer that reads it, or convert with
`dotnet-trace convert --format speedscope <file>`. Read it as: broadest inclusive frame first, then
descend to the first frame that is *your* code.

## Dumps — one instant, all threads

```powershell
dotnet-dump collect -p <pid> -o hang.dmp
dotnet-dump analyze hang.dmp
```

Inside `analyze`:

| Command | Use |
|---------|-----|
| `clrthreads` | Thread inventory; look for many threads in the same wait |
| `clrstack -all` | Every managed stack — the deadlock picture |
| `pstacks` | Stacks grouped and deduplicated: the fastest read of a hang |
| `dumpheap -stat` | Object counts and sizes by type: the leak candidate is the outlier |
| `dumpheap -mt <MT> -min 1000` | Instances of one suspicious type |
| `gcroot <addr>` | Who keeps that object alive — the actual answer to "why is it not collected" |
| `syncblk` | Monitor contention: which thread owns the lock everyone waits for |
| `dumpasync` | Pending async state machines — where an awaited task never completed |

## Failure signatures

| Signature | Cause | Fix direction |
|-----------|-------|---------------|
| Queue length rising, CPU idle, threads climbing | Thread-pool starvation from blocking on async (`.Result`, `.Wait()`, `GetAwaiter().GetResult()`) | Make the path async end to end; never block on a task in request handling |
| `pstacks` shows every thread inside one lock | Lock contention or a lock held across an await/IO | Shorten the critical section; never await under a lock |
| Heap grows, `gcroot` points at a static or a singleton | A cache or an event handler with no eviction or unsubscribe | Bound the cache, unsubscribe, scope the state |
| Many `HttpClient`-adjacent socket objects | A client created per call | One factory-managed client with a pooled handler |
| `active-db-contexts` climbing | A scoped context resolved from a singleton, or manual construction | Fix DI lifetimes (`dotnet-backend`) |
| High exception count, normal responses | Exceptions as control flow, often inside a `try` in a loop | Return results instead of throwing on expected paths |
| Steady memory, growing latency | A downstream dependency slowing, not this process | Follow the counters on the dependency, then `data-and-messaging.md` |

## When it is not the runtime

- Hosted in a container: check limits before internals. `docker stats <c>` and
  `kubectl top pod <pod>` — a throttled CPU quota looks exactly like slow code.
- Only one instance misbehaves: compare configuration, not code (`dotnet run --environment`,
  env-var overrides, feature flags).
- Numbers all normal and the bug is logical, not resource-shaped: go back to phase 2 of the skill
  and isolate by bisecting inputs, not by profiling.

Deeper .NET diagnostics practice — structured logging, OpenTelemetry, correlation across services —
lives in `dotnet-diagnostics`. For API shapes and signatures of any diagnostic type, query the
Microsoft docs plugin rather than guessing.
