---
name: dotnet-diagnostics
description: Find out what a running .NET process is actually doing — the counters, trace, dump, gcdump and stack global tools (which are not installed by default), what to collect for high CPU versus high memory versus a hang versus latency, how to read a dump, structured logging with Serilog that makes production debuggable (correlation across services, log levels that mean something, what must never be logged), OpenTelemetry traces and metrics, and how to get from "the endpoint is slow" to the actual guilty call. Use when a service is slow, hung, leaking, pegging the CPU, throwing in production, or behaving differently under load — and when deciding what to log or instrument so the next incident is diagnosable.
---

# dotnet-diagnostics — from a symptom in production to the guilty line

## When

- A service is slow, hangs, leaks memory, pegs a core, or times out under load.
- A failure only reproduces in a deployed environment, or only under concurrency.
- You have a dump or a trace and need to read it.
- You are deciding what to log, at which level, with which correlation, before an incident.
- Adding or fixing OpenTelemetry instrumentation, or reading a trace to find a slow span.
- Someone says "the endpoint is slow" and you need the guilty call, not a guess.

Not for: reproducible bugs with a stack trace in hand (fix them; use `debug-systematic` for method),
query plans and index tuning (`sql-server`), what SQL EF emits and why (`ef-core`), browser-side
performance (the Chrome DevTools plugin), or writing the tests that would have caught it
(`dotnet-testing`).

## Decide

### Symptom to first collection

| Symptom | Collect first | Then |
|---|---|---|
| High CPU, steady | `dotnet-counters` to confirm, then `dotnet-trace` with the CPU profile | read the hot stacks; check GC time percentage before blaming your code |
| High CPU in bursts, GC-shaped | `dotnet-counters` (gen collections, GC pause, allocation rate) | `dotnet-gcdump` to find what is being allocated |
| Memory growing, never returning | two `dotnet-gcdump` snapshots minutes apart | diff them; the growing type names the leak |
| Memory high but flat | `dotnet-counters` (working set versus heap size) | heap much smaller than working set means native or fragmentation, not your objects |
| Hang, no CPU | `dotnet-stack report`, or a full `dotnet-dump` | look for blocked threads and a thread-pool queue |
| Latency rising with load, low CPU | `dotnet-counters` (thread-pool queue length and thread count) | thread-pool starvation: hunt blocking calls |
| One endpoint slow, the rest fine | the trace for one slow request | the ladder below |
| Crash or unhandled exception in production | a dump on crash, plus the logs around it | `dumps.md` |
| Sporadic timeouts against a dependency | its own metrics plus the resilience-policy events | is it the dependency, the pool, or the retry |

### "The endpoint is slow" — the narrowing ladder

Run it in order and stop at the first step that answers. Each step is cheaper than the one below.

```
1  Is it slow for everyone, or one input?      -> one input means data volume or a missing index
2  Is it slow on the first call only?          -> cold start, cache warm-up, connection pool, JIT
3  What does the request's own trace say?      -> OpenTelemetry span tree, or the Aspire dashboard
4  Which span dominates?
     database  -> get the SQL, then the plan            (ef-core, sql-server)
     HTTP      -> the dependency, or the retry policy multiplying the wait
     no span   -> in-process work: profile it (dotnet-trace, CPU)
     the gap between spans -> queueing: thread pool, connection pool, or a lock
5  Still nothing?  Is latency load-dependent?  -> starvation or pool exhaustion, not per-call cost
6  Only then read the code.
```

Step 3 is the whole reason instrumentation exists. A service with no traces forces you to start at
step 6, which is guessing.

### Log level, decided once

| Level | Means | Example |
|---|---|---|
| Trace / Debug | developer detail, off in production | payload sizes, cache hit or miss |
| Information | a business event happened | order placed, job completed, message consumed |
| Warning | degraded but handled | a retry fired, a fallback was used, validation rejected input |
| Error | a human should look at this | unhandled failure of a unit of work |
| Critical | the process or a dependency is unusable | cannot reach the database at startup |

If everything is Information, nothing is. If an expected outcome logs Error, alerting becomes noise
and the real error is ignored.

## Do

```powershell
# These tools are NOT installed. Install once, globally.
dotnet tool install -g dotnet-counters
dotnet tool install -g dotnet-trace
dotnet tool install -g dotnet-dump
dotnet tool install -g dotnet-gcdump
dotnet tool install -g dotnet-stack
dotnet tool update  -g dotnet-counters      # same for each, when a new SDK complains

# Find the target
dotnet-counters ps
Get-Process -Name *YourService* | Select-Object Id, Name, WS, CPU

# Live vital signs — the first thing to run, always
dotnet-counters monitor -p <pid> --counters System.Runtime,Microsoft.AspNetCore.Hosting
dotnet-counters collect -p <pid> --format csv -o counters.csv       # for a graph or a report

# CPU profile: 30 seconds under the load, then stop with Enter
dotnet-trace collect -p <pid> --profile cpu-sampling -o trace.nettrace
dotnet-trace collect -p <pid> --providers Microsoft-Diagnostics-DiagnosticSource   # spans/activities

# Managed heap, twice, minutes apart
dotnet-gcdump collect -p <pid> -o before.gcdump
dotnet-gcdump collect -p <pid> -o after.gcdump

# Hang: what is every thread doing
dotnet-stack report -p <pid> > stacks.txt

# Full dump, then read it offline
dotnet-dump collect -p <pid> -o .\proc.dmp
dotnet-dump analyze .\proc.dmp

# In a container
kubectl exec <pod> -- dotnet-counters ps       # only if the tool is in the image
kubectl cp <pod>:/tmp/proc.dmp .\proc.dmp      # collect inside, analyze outside
docker stats <container>                       # working set from the outside, cheapest first look
```

Collect **while it is bad**. A trace taken after the incident describes a healthy process.

## Traps

1. Diagnosing from a trace taken after the symptom passed → it shows nothing → reproduce under load,
   collect during, keep the window short (thirty seconds is plenty).
2. High CPU blamed on application code → it is the GC → check GC pause and allocation-rate counters
   before profiling; the fix is allocation, not the algorithm.
3. Memory "leaking" but the managed heap is flat → native memory, fragmentation, or a container limit
   → compare working set against heap size before taking a gcdump.
4. Latency rises with concurrency, CPU flat → thread-pool starvation from sync-over-async → see
   `dotnet-backend`, `async-concurrency.md`.
5. A dump with no matching symbols → unreadable stacks → collect on the runtime's own platform, and
   keep the build's symbol files.
6. `dotnet-counters` shows nothing for a container process → the diagnostic socket is not shared →
   collect inside the container, or expose the diagnostics port deliberately.
7. Logs cannot be correlated across services → no trace id propagated → propagate the trace context
   and enrich every log with it (`logging.md`).
8. Structured logging used as string interpolation → the properties are gone and nothing is queryable
   → message templates with named placeholders, always.
9. Debug level turned on in production "to see more" → volume, cost, useful lines buried → raise it
   for one namespace, briefly, or collect a trace instead.
10. A slow endpoint blamed on the database because its span is long → that span includes waiting for
    a pooled connection → check pool exhaustion before the query plan.
11. Sensitive data in logs → a compliance incident plus a credential rotation → never log credentials,
    tokens, connection strings, personal identifiers, or whole request bodies.
12. Instrumentation everywhere → cost and noise → boundaries first, then the one step under suspicion.

## References

- `tools.md` — the diagnostic global tools: installing, targeting a process, containers, and which
  tool answers which question.
- `triage.md` — the playbooks per symptom: high CPU, high memory, hang, latency, crash — what to
  collect, in what order, and how to read the counters.
- `dumps.md` — reading a dump: the analyze session, threads and stacks, the heap, roots, locks, and
  what to extract before you close it.
- `logging.md` — Serilog structured logging: message templates, enrichment, correlation across
  services, level policy, sinks, and the never-log list.
- `telemetry.md` — OpenTelemetry traces and metrics: what to instrument, propagation, exporters, the
  Aspire dashboard, and reading a span tree to find the guilty call.
