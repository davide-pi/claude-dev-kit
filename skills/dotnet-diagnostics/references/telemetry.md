# OpenTelemetry: traces, metrics, and reading a span tree

OpenTelemetry is in the newer solutions here, and Aspire orchestrates two of them: those two already
have a dashboard with traces, metrics and logs. Use it before reaching for any tool.

A metric says there is a problem, a trace says where, a log says why.

## What to instrument

Automatic instrumentation (ASP.NET request, HTTP client, database client, broker client, runtime and
host meters) covers the boundaries, which are most of the answer. Add **manual** spans only where a
boundary span hides something expensive (a long in-process computation, a cache lookup suspected to
always miss, a batch loop), named for the operation with filterable identifiers (tenant, entity id,
batch size). A span per method is noise. Custom metrics: a counter for the business event, a histogram
for its duration, a gauge for anything queued.

## Propagation

HTTP instrumentation propagates on both ends. It silently breaks in two places:

1. **Messages through a broker.** The publisher writes the trace context into the message headers, the
   consumer restores it and links its span to the producer's; otherwise the consumer's work is an
   unrelated trace.
2. **Background and scheduled work** (a Quartz job, a queued task) starts its own trace, correctly; if a
   request triggered it, carry the original trace id as an attribute so they can be joined.

Enrich logs with the current trace and span ids: the highest-value observability wiring there is.

## Exporters and sampling

| Destination | Note |
|---|---|
| The Aspire dashboard | free with the app host; the default for local work in those two solutions |
| An OTLP collector | the portable choice: switching backend means collector config, not redeploying services |
| A vendor backend | via OTLP too; no vendor-specific exporter in application code |
| Console | debugging the instrumentation itself, never production |

Sample **per trace, at the head**, so a sampled trace is complete, and always keep errors and slow
requests: a uniformly sampled set will not contain the incident you are investigating.

## Reading a span tree to find the guilty call

```
Open the slow request's trace (dashboard, or the backend).
Sort children by duration, then read top-down:

  one database span dominates            -> get its SQL; then the plan          (ef-core, sql-server)
  many small database spans              -> N+1; fix the query, not the database (ef-core)
  one outbound HTTP span dominates       -> the dependency; check its own trace
  several identical HTTP spans           -> a retry policy firing; look at the attempts, not the call
  the parent is long, children are short -> in-process work: profile it          (tools.md)
  a gap with no span at all              -> queueing: thread pool, connection pool, or a lock
  the child span sum is far below the
    parent duration                      -> the same gap, stated differently
```

Span durations only cover instrumented work: time waiting for a pool thread or a pooled connection
belongs to no span. When the arithmetic does not add up, look at the counters, not the spans.

## When there is no instrumentation at all

The largest platform here has almost none.

1. Do not instrument the whole estate to fix one incident.
2. Add automatic boundary instrumentation to the **one** service under suspicion (a package reference
   and a few registration lines; it can ship in the same fix).
3. Meanwhile `dotnet-trace` with the diagnostic-source provider surfaces the same activities into a
   trace file with no code change.
4. If you must pick one thing, correlation id propagation in the logs comes first (`logging.md`).

## Verify it is actually on

```powershell
Select-String -Path (Get-ChildItem -Recurse -Filter *.csproj).FullName -Pattern 'OpenTelemetry'
Select-String -Path (Get-ChildItem -Recurse -Filter *.cs).FullName -Pattern 'AddOpenTelemetry|WithTracing|WithMetrics|AddSource|AddMeter'
Get-ChildItem Env: | Where-Object Name -like 'OTEL_*'
```

Instrumentation registered with no exporter configured produces nothing and costs CPU: check the
exporter and the endpoint variable before concluding a span is missing.
