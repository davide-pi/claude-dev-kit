# Structured logging that makes production debuggable

Serilog is the logger across this estate; every line must be a **queryable record**.

## Message templates

Named placeholders become properties; interpolating the values destroys them. Property names are
stable across the codebase (the same concept, the same name, or cross-service correlation breaks);
log identifiers and scalars, never a whole entity; the message text is constant; prefix custom
properties so they are distinguishable from framework ones.

## Levels

Test: **would a human have to do something?** Yes and now = Error; yes and eventually = Warning; no =
Information or below. Configure **per namespace**: framework at Warning, application at Information,
one namespace temporarily at Debug when investigating. Never raise the global level in production.

| Level | Means |
| --- | --- |
| Debug / Trace | developer detail, off in production |
| Information | a business event happened: a bet placed, a settlement done, a message consumed |
| Warning | degraded but handled: a retry fired, a fallback used, input rejected |
| Error | a human should look: a unit of work failed unhandled |
| Critical | the process or a dependency is unusable |

## Correlation across services

The feature most often missing.

1. Accept an incoming correlation or trace id from the headers; generate one if absent. With
   OpenTelemetry the trace context already carries it: reuse it (`telemetry.md`).
2. Push it into a **log context scope** for the request, so every line below, library code included,
   carries it.
3. Propagate it outbound: a delegating handler on the typed HTTP client (once for all clients) and a
   header on every published message, restored by the consumer into its own scope.
4. Return it in a response header and in the error payload, so a user's screenshot holds the key to the
   trace.

Add a scope for business identifiers (order id, tenant, user id) where they become known; enrichers
cover machine or pod, environment, application name and version. Without steps 3 and 4 each service's
logs are an island: add them before the next incident, not during it.

## Sinks

| Sink | Use |
|---|---|
| Console, structured (JSON) | anything containerized |
| Console, human-readable | local development only |
| Rolling file | services on a machine, with a size cap **and** a retention limit |
| A log platform (over the network) | the aggregate view; always keep a local fallback sink |

Bound everything (file size, retained files, in-memory queue), and make the network sink asynchronous
and non-blocking, or a slow platform becomes service latency. Read configuration from settings, and
check what is configured before concluding a line is missing:

```powershell
Get-ChildItem -Recurse -Filter appsettings*.json | Select-String -Pattern 'Serilog|MinimumLevel|WriteTo'
Select-String -Path (Get-ChildItem -Recurse -Filter Program.cs).FullName -Pattern 'UseSerilog|CreateLogger|Enrich'
```

## Never log

- Passwords, tokens, keys, authorization headers (a log store is not a secret store: a rotation event).
- Full connection strings.
- Card numbers, national identifiers, health data.
- Whole request or response bodies; whole entities.
- A stack trace sent to an end user (the correlation id is what they need).

If one already reached the logs: rotate the credential first, then remove the statement, then
find out the retention and who can read it. Do not quietly delete the line.

## Logging that helps during an incident

- Log at the **boundaries** of a unit of work (received, decided, completed or failed) with identifiers
  and duration: four lines per request beat forty. Log the duration of every outbound call.
- Log the **decision**, not the code path: "rejected: insufficient stock, requested 5, available 2".
- Log an exception once, where handled, passing the exception object as the exception argument.
- On a retry, log attempt number and reason at Warning; never log inside a tight loop (summary with
  counts after it).
- Guard an expensive message with a level check, keep Debug out of production, sample high-frequency
  Information events rather than lowering the level for everything.
