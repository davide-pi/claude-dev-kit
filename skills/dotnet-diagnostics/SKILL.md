---
name: dotnet-diagnostics
description: >-
  Use whenever evidence is needed from a running .NET service — production logs, metrics or CPU
  profiles in Grafana, local logs, counters, a trace or a dump — or when deciding what to log or
  instrument so the next incident is diagnosable.
---

# dotnet-diagnostics — the instruments, production first

`debug-systematic` decides *what* a symptom needs; this skill is how to *get* the evidence. In
production the services log through Serilog's OpenTelemetry sink into **Loki**, export metrics to
**Prometheus**, and are profiled into **Pyroscope** — all reachable through the Grafana MCP servers
(one per environment). Locally, `/logs` and the Aspire dashboard come first; the `dotnet-*` global
tools are the fallback for what neither shows.

## When

- A production or staging service is slow, erroring, leaking or hung and evidence is needed.
- Reading logs for one service, one request, one time window — in any environment.
- A local process needs counters, a CPU trace, a gcdump, a stack report or a dump.
- Deciding what to log, at which level, with which correlation — before an incident, not during.
- Adding or fixing OpenTelemetry instrumentation, or reading a span tree.

Not for: choosing the hypothesis for a symptom (`debug-systematic`), query plans (`sql-server`, the
`db-analyst` agent), what SQL EF emits (`ef-core`), broker state (`rabbitmq`), browser-side
performance (the `chrome-devtools-mcp` plugin).

## Decide

### Which instrument — production first

| Where | Need | Instrument |
| --- | --- | --- |
| deployed | logs for a service and window | Grafana MCP → Loki: `{service_name="<svc>", deployment_environment="<env>"}`, then a line filter |
| deployed | "is it everyone or one instance, since when" | Grafana MCP → Prometheus: request rate, error rate, latency histogram, process CPU and memory |
| deployed | where the CPU or the allocations go | Grafana MCP → Pyroscope: CPU and allocation profiles for the service over the bad window |
| deployed | one request across services | its trace id from the log line, then the trace (Tempo where the datasource exists) |
| local | logs | `/logs <service>`, or the Aspire dashboard's structured log view |
| local | a span tree for one request | the Aspire dashboard |
| local, or a host you can reach | counters, CPU trace, gcdump, stack report, dump | the `dotnet-*` global tools (`references/tools.md`) |

**Why the MCP and not a CLI here:** there is no Loki, Prometheus or Pyroscope CLI on this machine,
so the Grafana MCP *is* the instrument — still query it the CLI way: narrow by labels first, a
short window, then widen. Start with `list_loki_label_values` / `list_prometheus_metric_names`
instead of guessing names, and `query_loki_stats` before pulling a large window.

Deployed services run as systemd units on Linux hosts, not containers: a dump or a `dotnet-trace`
in production is an operator action on that host, requested, never improvised.

### The span tree, once you have it

```
which span dominates?
  database span  -> get the SQL, then the plan          (ef-core, sql-server)
  an RPC hop     -> the responder's own trace; a 120 s gap is a missing responder (rabbitmq)
  HTTP span      -> the dependency, or a Polly retry multiplying the wait
  no child span  -> in-process work: profile it (Pyroscope deployed, dotnet-trace local)
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

A deployed service's levels come from its `serilog.json`, merged at deploy time — change the level
there for one namespace, briefly, rather than turning Debug on globally.

## Do

```text
# Grafana MCP (pick the server for the environment) — LogQL shapes that work on these labels
{service_name="<svc>", deployment_environment="<env>"} |= "<CouponId or trace id>"
{service_name="<svc>"} | json | level="Error"
sum by (service_name) (count_over_time({deployment_environment="<env>"} |= "Exception" [5m]))
```

```powershell
# Local fallback — the tools are NOT installed by default
dotnet tool install -g dotnet-counters; dotnet tool install -g dotnet-trace
dotnet tool install -g dotnet-dump;     dotnet tool install -g dotnet-gcdump; dotnet tool install -g dotnet-stack
dotnet-counters ps
dotnet-counters monitor -p <pid> --counters System.Runtime,Microsoft.AspNetCore.Hosting
dotnet-trace collect -p <pid> --profile cpu-sampling -o trace.nettrace      # 30 s under load
dotnet-stack report -p <pid> > stacks.txt                                     # a hang: every thread
dotnet-dump collect -p <pid> -o .\proc.dmp; dotnet-dump analyze .\proc.dmp
```

Collect **while it is bad**: a trace or profile from after the incident describes a healthy process.

## Traps

1. A wide Loki query over hours with no label filter → slow, truncated, useless → labels first, then
   a line filter, then widen the window.
2. A metric or label name guessed → an empty result read as "nothing happened" → list names first.
3. Logs read without the trace id → three services' lines cannot be joined → filter on the trace id.
4. Profiling after the symptom passed → the profile shows a healthy process → pick the bad window.
5. High CPU blamed on the code → it is GC → check allocation rate and GC pause before the profile.
6. Latency rising with load, CPU flat → thread-pool starvation from sync-over-async (`dotnet-backend`).
7. A slow span blamed on the database → it includes waiting for a pooled connection.
8. String interpolation in a log call → the properties are gone and nothing is queryable → message
   templates with named placeholders, always.
9. Debug turned on in production "to see more" → volume and cost bury the useful lines.
10. Credentials, tokens, connection strings or personal identifiers in a log → a compliance
    incident plus a rotation → never log them, nor whole request bodies.

## References

- `references/tools.md` — the `dotnet-*` global tools: installing, targeting a process, containers,
  and which tool answers which question.
- `references/dumps.md` — reading a dump: threads and stacks, the heap, roots, locks.
- `references/logging.md` — Serilog structured logging: templates, enrichment, correlation across
  services, level policy, sinks, and the never-log list.
- `references/telemetry.md` — OpenTelemetry traces and metrics: what to instrument, propagation,
  exporters, the Aspire dashboard, reading a span tree.
