# OpenTelemetry: traces, metrics, and reading a span tree

OpenTelemetry is in the newer solutions here, and Aspire orchestrates two of them — which means those
two already have a dashboard showing traces, metrics and logs with no extra work. Use it before
reaching for any tool.

## The three signals, and what each is for

| Signal | Answers | Cost |
|---|---|---|
| Traces (spans) | where the time went in **this** request, across services | per request; sample it |
| Metrics | is the system healthy, and is it getting worse | cheap, aggregated |
| Logs | what happened and why, with the details | volume-dependent |

The division of labour: a metric tells you there is a problem, a trace tells you where, a log tells
you why. A service with only logs forces every question through text search; a service with only
metrics can tell you latency rose but never which call caused it.

## What to instrument

Automatic instrumentation covers the boundaries, and the boundaries are most of the answer:

| Instrumentation | Gives you |
|---|---|
| ASP.NET request | one span per inbound request, with route, status and duration |
| HTTP client | a child span per outbound call, with host, method and status |
| The database client | a span per command, usually with the SQL text |
| The broker client | producer and consumer spans, linked across the hop |
| The runtime and host meters | GC, thread pool, request rate and duration as metrics |

Add **manual** spans only where a boundary span hides something expensive: a long in-process
computation, a cache lookup you suspect always misses, a batch loop. Name them for the operation, and
attach the identifiers that make the span filterable — tenant, entity id, batch size. A span per
method is noise that costs money and hides the signal.

Custom metrics worth having: a counter for the business event that matters (orders placed, messages
consumed), a histogram for its duration, and a gauge for anything queued. Three well-chosen metrics
beat thirty.

## Propagation

Context propagation is what makes a trace cross a service boundary. The HTTP instrumentation does it
for you on both ends. Two places it silently breaks:

1. **Messages through a broker.** The trace context must be written into the message headers by the
   publisher and restored by the consumer, then the consumer span linked to the producer's. Without
   it, the consumer's work appears as an unrelated trace and an end-to-end latency question becomes
   unanswerable.
2. **Background and scheduled work.** A Quartz job or a queued background task starts its own trace.
   That is correct — but if it was triggered by a request, carry the original trace id as an attribute
   so the two can be joined.

Enrich logs with the current trace and span ids, so a log line links to its trace and a trace links
to its logs. That link is the single highest-value piece of observability wiring there is.

## Exporters

| Destination | Note |
|---|---|
| The Aspire dashboard | free with the app host; the default for local work in those two solutions |
| An OTLP collector | the portable choice; the service knows one endpoint, the collector fans out |
| A vendor backend | usually via OTLP too; avoid a vendor-specific exporter in application code |
| Console | debugging the instrumentation itself, never production |

Export through OTLP to a collector rather than wiring a vendor into the service: changing backend
then means changing collector configuration, not redeploying every service.

## Sampling

Tracing every request at volume is expensive and mostly redundant. Sample a percentage, but keep two
rules: sample **per trace, at the head**, consistently, so a sampled trace is complete rather than a
tree with holes; and always keep errors and slow requests, which are the only traces anyone reads. A
uniformly sampled trace set will not contain the one incident you are investigating.

## Reading a span tree to find the guilty call

```
Open the slow request's trace (dashboard, or the backend).
Sort children by duration, then read top-down:

  one database span dominates            -> get its SQL; then the plan          (ef-core, sql-server)
  many small database spans              -> N+1; fix the query, not the database (ef-core)
  one outbound HTTP span dominates       -> the dependency; check its own trace
  several identical HTTP spans           -> a retry policy firing; look at the attempts, not the call
  the parent is long, children are short -> in-process work: profile it          (triage.md)
  a gap with no span at all              -> queueing: thread pool, connection pool, or a lock
  the child span sum is far below the
    parent duration                      -> the same gap, stated differently
```

The gap case is the one people miss. Span durations only account for instrumented work; time spent
waiting for a thread-pool thread or a pooled connection belongs to no span and is invisible unless you
subtract. When the arithmetic does not add up, stop looking at the spans and look at the counters.

## When there is no instrumentation at all

The largest platform here has almost none. In that situation:

1. Do not instrument the whole estate as a prerequisite for fixing one incident.
2. Add the automatic boundary instrumentation to the **one** service under suspicion — it is a package
   reference and a few registration lines, and it can ship in the same fix.
3. Meanwhile use `dotnet-trace` with the diagnostic-source provider, which surfaces the same
   activities into a trace file without any code change. That is the bridge between an
   uninstrumented service and a span tree.
4. Add correlation id propagation to the logs first if you must choose one thing — it is cheaper than
   full tracing and answers the cross-service question (`logging.md`).

## Verify it is actually on

```powershell
Select-String -Path (Get-ChildItem -Recurse -Filter *.csproj).FullName -Pattern 'OpenTelemetry'
Select-String -Path (Get-ChildItem -Recurse -Filter *.cs).FullName -Pattern 'AddOpenTelemetry|WithTracing|WithMetrics|AddSource|AddMeter'
Get-ChildItem Env: | Where-Object Name -like 'OTEL_*'
```

An instrumentation that is registered but has no exporter configured produces nothing and costs CPU —
check the exporter and the endpoint environment variable before concluding that a span is missing.
