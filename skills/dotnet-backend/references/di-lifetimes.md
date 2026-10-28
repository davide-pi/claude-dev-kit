# Dependency injection: lifetimes, captive dependencies, registration

## Facts people get wrong

- A transient that is disposable is **still tracked by the scope that resolved it**: resolving
  transients in a loop inside a long-lived scope leaks until the scope ends.
- A scoped service resolved from the root container behaves as a singleton (the root is a scope that
  never ends).

## The captive-dependency trap

A shorter lifetime injected into a longer one is promoted to the longer one.

| Registered | Injected into | Consequence |
|---|---|---|
| scoped repository | singleton cache | one `DbContext` for the process: stale data, disposed errors, cross-request bleed |
| transient validator | singleton handler | per-call state is shared |
| scoped anything | hosted service | the classic background-job crash after the first iteration |

Scope validation catches the direct cases, but it is on by default in **Development only**, exactly
where the problem does not hurt: enable it (and validate on build) in every environment. It does not
catch a singleton resolving a scoped service from an injected service provider at call time — the same
bug behind a service locator.

**Fix: a scope per unit of work.** Inject the scope factory into the singleton, open a scope per
operation (per loop iteration or message in a background service), resolve inside, dispose. Nothing
resolved from it escapes the `using`: no cached entity, repository or context.

## Choosing a lifetime

```
Holds state that must not be shared across requests?               -> Scoped
Wraps a DbContext, a unit of work, or a request identity?          -> Scoped
Stateless AND thread-safe AND cheap to keep alive?                 -> Singleton
Stateless but not sure it is thread-safe?                          -> Scoped
Expensive shared resource (connection multiplexer, memory cache,
  mapper configuration, HTTP message handler pool)?                -> Singleton
Anything else                                                      -> Transient
```

Scoped is the default for your own services; singleton is an optimization you justify. Every singleton
is called concurrently: shared collections need the concurrent variant or a lock. `DbContext` is not
thread-safe — two awaits in flight on one context throw, or silently corrupt change tracking.

## HTTP clients

Typed client through the factory, never `new HttpClient()` per call (socket exhaustion) nor a forever
static (stale DNS). Resilience (Polly and the resilience extensions) goes on the client's handler
pipeline, not around call sites. Two rules: the total timeout sits **outside** the retry, or N retries
multiply the wait; retry only idempotent operations, or a retried POST duplicates the write.

## Registration

- Registering both the interface and the class as separate scoped entries yields **two instances** in
  one scope — expensive when the service holds state. Register the concrete type as itself only when
  something resolves it directly.
- Several implementations: inject the enumerable and pick by a property, not by index.
- Decorator: register the inner as itself, the outer as the interface.
- Runtime choice: a factory delegate, not a service locator in the consumer.
- Keyed registration only after checking the framework version via the `microsoft-docs` plugin.
- Inject the bound options value, not the wrapper (`errors-and-config.md`).

## What not to inject

The service provider itself; the configuration root when an options class would do; `HttpContext` or
its accessor below the endpoint layer (pass the two values you need); a `DbContext` into a domain
entity or validator.

## Diagnosing a lifetime bug

```powershell
Select-String -Path (Get-ChildItem -Recurse -Filter *.cs).FullName -Pattern 'AddSingleton|AddScoped|AddTransient|AddHostedService'
Select-String -Path (Get-ChildItem -Recurse -Filter *.cs).FullName -Pattern 'IServiceProvider|IServiceScopeFactory|CreateScope'
```

Then: does the failing type hold state? Is any dependency in its constructor chain scoped? Is it
resolved inside a hosted service?
