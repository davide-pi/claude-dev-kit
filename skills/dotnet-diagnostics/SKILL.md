---
name: dotnet-diagnostics
description: >-
  Use when evidence is needed from a running .NET service: metrics, profiles, counters,
  traces, dumps; or deciding what to log or instrument.
---

# dotnet-diagnostics — the instruments, production first

**Contract.** The instrument and the exact collection for the evidence needed · never pulls Grafana
data into the main thread, never dumps or traces a production host unrequested · readings in
Italian, log lines and counter names verbatim.

## When

- A deployed or local service is slow, erroring, leaking or hung, and evidence is needed.
- A local process needs counters, a CPU trace, a gcdump, a stack report or a dump.
- Deciding what to log, at which level, with which correlation — before the incident.
- Adding or fixing OpenTelemetry instrumentation, or reading a span tree.

Not for: choosing the hypothesis (`debug-systematic`), query plans (`sql-server`, `db-analyst`),
browser-side performance.

## Decide

### Which instrument — production first

Deployed services log through Serilog's OpenTelemetry sink into Loki, export metrics to Prometheus
and are profiled into Pyroscope, all behind Grafana. **Grafana exists only inside the `ops-analyst`
agent**: the main thread spawns it (or runs `/logs`) and receives lines plus a reading, never the
raw result set.

| Where | Need | Instrument |
| --- | --- | --- |
| deployed | logs for a service and a window | `ops-analyst` → Loki (labels `service_name`, `deployment_environment`) |
| deployed | everyone or one instance, since when | `ops-analyst` → Prometheus: rate, errors, latency histogram, CPU, memory |
| deployed | where CPU or allocations go | `ops-analyst` → Pyroscope over the bad window |
| deployed | one request across services | the trace id from a log line, then the trace (Tempo where it exists) |
| local | logs, a span tree | `/logs <service>`, or the Aspire dashboard |
| local, or a host you can reach | counters, CPU trace, gcdump, stacks, dump | the `dotnet-*` global tools (`references/tools.md`) |

Deployed services run as systemd units on Linux hosts, not containers: a dump or a `dotnet-trace`
there is an operator action on that host, requested, never improvised.

### The span tree, once you have it

```text
which span dominates?
  database span     -> the SQL, then the plan                      (ef-core, sql-server)
  an RPC hop        -> the responder's own trace; a 120 s gap is a missing responder (rabbitmq)
  HTTP span         -> the dependency, or a Polly retry multiplying the wait
  no child span     -> in-process work: profile it (Pyroscope deployed, dotnet-trace local)
  gap between spans -> queueing: thread pool, connection pool, or a lock
```

### Log level, decided once

| Level | Means |
| --- | --- |
| Debug / Trace | developer detail, off in production |
| Information | a business event happened: a bet placed, a settlement done, a message consumed |
| Warning | degraded but handled: a retry fired, a fallback used, input rejected |
| Error | a human should look: a unit of work failed unhandled |
| Critical | the process or a dependency is unusable |

A deployed service's levels come from its `serilog.json`, merged at deploy time: raise one namespace
briefly there, never Debug globally — volume and cost bury the useful lines.

## Do

```powershell
# Local — the tools are NOT installed by default (install lines: references/tools.md)
dotnet-counters ps
dotnet-counters monitor -p <pid> --counters System.Runtime,Microsoft.AspNetCore.Hosting
dotnet-trace collect -p <pid> --profile cpu-sampling -o trace.nettrace     # 30 s, under load
dotnet-stack report -p <pid> > stacks.txt                                    # a hang: every thread
dotnet-dump collect -p <pid> -o .\proc.dmp; dotnet-dump analyze .\proc.dmp
```

Collect **while it is bad**: a trace from after the incident describes a healthy process.

## Traps

1. Logs read without the trace id → three services' lines cannot be joined → filter on the trace id.
2. High CPU blamed on the code → it is GC → allocation rate and GC pause before the profile.
3. Latency rising with load, CPU flat → thread-pool starvation from sync-over-async (`dotnet-backend`).
4. A slow span blamed on the database → it includes the wait for a pooled connection.
5. A credential, token, connection string, personal identifier or whole request body in a log →
   a compliance incident plus a rotation → never logged (`references/logging.md`, the never-log list).
6. A dump attached to a work item or a PR → it holds secrets and customer data in plain bytes.

## References

- `references/tools.md` — installing the `dotnet-*` tools, targeting a process, containers, which
  tool answers which question.
- `references/dumps.md` — reading a dump: threads and stacks, the heap, roots, locks.
- `references/logging.md` — Serilog: templates, enrichment, correlation, level policy, never-log list.
- `references/telemetry.md` — OpenTelemetry traces and metrics, propagation, the Aspire dashboard.
