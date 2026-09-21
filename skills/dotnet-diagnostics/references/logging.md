# Structured logging that makes production debuggable

Serilog is the logger across this estate. The point of structured logging is not prettier output: it
is that every log line becomes a **queryable record**, so an incident is a filter instead of a search
through text.

## Message templates, not interpolation

The named placeholders in a message template become properties on the event. Interpolating the values
into the string destroys them — the line still reads fine to a human and is useless to a query. That
single distinction is the difference between "find every failure for this order" and "grep".

Rules:

- Placeholders are named for the property, in a stable name across the codebase: the same concept must
  be the same property name everywhere, or correlation across services breaks.
- Log identifiers and scalars. Serializing a whole entity produces enormous events, drags secrets in,
  and changes shape whenever the model changes.
- The message text is constant. A template built at runtime defeats grouping.
- Prefix custom properties consistently so they are distinguishable from framework ones.

## Levels

The policy in the skill body, restated as a decision: **would a human have to do something?** Yes and
now equals Error. Yes and eventually equals Warning. No equals Information or below. Applying that
one test consistently is worth more than any amount of tuning, because an Error level that means
"something a human must handle" is what makes alerting possible at all.

Configure levels **per namespace**, not globally: the framework's own namespaces at Warning, your
application namespaces at Information, and one namespace temporarily at Debug when investigating.
Raising the global level in production is expensive and buries the useful lines.

## Correlation across services

This is the feature that turns logs into an investigation tool, and the one most often missing.

1. Accept an incoming correlation or trace identifier from the request headers; generate one if
   absent. With OpenTelemetry in place, the trace context already carries it — reuse it rather than
   inventing a second id (`telemetry.md`).
2. Push it into a **log context scope** for the duration of the request, so every log line written
   anywhere below — including inside libraries that only see the logger — carries it automatically.
3. Propagate it outbound: on every HTTP call (a delegating handler on the typed client does this once
   for all clients) and on every message published (a header on the envelope, read by the consumer
   and pushed into its own scope).
4. Return it to the caller in a response header, and include it in the error payload, so a user's
   screenshot contains the key to the whole trace.

Add a scope for the business identifiers too — order id, tenant, user id — at the point where they
become known, and every line under it inherits them. Enrichers cover the ambient facts: machine or
pod name, environment, application name, application version.

Without steps 3 and 4, each service's logs are an island and a cross-service incident cannot be
reconstructed. Add them before the next incident, not during it.

## Sinks

| Sink | Use |
|---|---|
| Console, structured (JSON) | anything containerized — the platform collects stdout |
| Console, human-readable | local development only |
| Rolling file | services on a machine, with a size cap **and** a retention limit |
| A log platform (over the network) | the aggregate view; always keep a local fallback sink |

Two operational rules: bound everything (file size, retained files, in-memory queue), because an
unbounded sink turns a logging problem into an out-of-disk or out-of-memory incident; and make the
network sink asynchronous and non-blocking, or a slow log platform becomes your service's latency.

Read the configuration from settings so a level or a sink can change without a rebuild — and check
what is actually configured before concluding that a log line is missing:

```powershell
Get-ChildItem -Recurse -Filter appsettings*.json | Select-String -Pattern 'Serilog|MinimumLevel|WriteTo'
Select-String -Path (Get-ChildItem -Recurse -Filter Program.cs).FullName -Pattern 'UseSerilog|CreateLogger|Enrich'
```

## Never log

| Never | Why |
|---|---|
| Passwords, tokens, keys, secrets, authorization headers | a log store is not a secret store; this is a rotation event |
| Full connection strings | they usually carry credentials |
| Card numbers, national identifiers, health data | regulated; a log breach becomes a reportable one |
| Whole request or response bodies | they contain all of the above sooner or later |
| Whole entities, "for convenience" | volume, secrets, and a shape that changes silently |
| A stack trace sent to an end user | information disclosure; the correlation id is what they need |

If something in the list already reached the logs: rotate the credential first, then remove the log
statement, then find out how long the retention is and who can read it. Do not quietly delete the
line and move on.

## Logging that helps during an incident

- Log at the **boundaries** of a unit of work: received, decided, completed or failed, with the
  identifiers and the duration. Four lines per request beat forty.
- Log the duration of anything that calls out — database, HTTP, broker — so a slow dependency shows
  up in the logs even without traces.
- Log the **decision**, not the code path: "rejected: insufficient stock, requested 5, available 2"
  is diagnosable; "entering ValidateOrder" is not.
- Log an exception once, where it is handled, with the exception object passed as the exception
  argument rather than folded into the message, so the sink keeps the type and the stack separately.
- On a retry, log the attempt number and the reason at Warning. Silent retries make a latency
  investigation impossible.
- Never log inside a tight loop. Log a summary after it, with counts.

## Cost

Logging is not free: it allocates, it serializes, and at high volume it dominates both CPU and the
observability bill. Guard an expensive message with a level check so its arguments are not evaluated
when the level is off, keep Debug out of production, and sample high-frequency Information events
rather than dropping the level for everything.
