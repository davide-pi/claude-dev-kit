# Dependency injection: lifetimes, captive dependencies, registration

## The three lifetimes, precisely

| Lifetime | One instance per | Disposed when |
|---|---|---|
| Singleton | container (process) | the host shuts down |
| Scoped | scope — one per HTTP request, or one you open yourself | the scope ends |
| Transient | resolution — every injection gets its own | the owning scope ends, if disposable |

Two facts people get wrong: a transient that implements a disposable interface is **still tracked by
the scope that resolved it**, so resolving transients in a loop inside a long-lived scope leaks until
the scope ends; and a scoped service resolved from the root container behaves as a singleton, because
the root container is itself a scope that never ends.

## The captive-dependency trap

Injecting a shorter lifetime into a longer one promotes it to the longer lifetime.

| Registered | Injected into | Effective lifetime | Consequence |
|---|---|---|---|
| Scoped repository | Singleton cache | singleton | one `DbContext` for the process: stale data, disposed errors, cross-request bleed |
| Transient validator | Singleton handler | singleton | any per-call state is shared |
| Scoped anything | Hosted service (singleton) | singleton | the classic background-job crash after the first iteration |

The framework's scope validation catches the direct cases at startup. Enable it in **every**
environment — it is on by default in Development only, which is exactly where the problem does not
hurt. Also validate on build so an unresolvable graph fails at startup rather than on first request.

What it does not catch: a singleton that resolves a scoped service from an injected service provider
at call time. That is the same bug, hidden behind a service locator.

### The fix: a scope per unit of work

Inject the scope factory into the singleton, open a scope for each operation, resolve inside it, and
dispose the scope. In a background service that means one scope per loop iteration or per message, so
the `DbContext` lifetime matches the work, not the process. Anything resolved from that scope must not
escape it — do not cache an entity, a repository or a context beyond the `using`.

## Choosing a lifetime, mechanically

```
Does it hold state that must not be shared across requests?      -> Scoped
Does it wrap a DbContext, a unit of work, or a request identity?  -> Scoped
Is it stateless AND thread-safe AND cheap to keep alive?          -> Singleton
Is it stateless but you are not sure it is thread-safe?           -> Scoped (cheap, always correct)
Does it hold an expensive shared resource (connection multiplexer,
  memory cache, mapper configuration, HTTP message handler pool)? -> Singleton
Anything else                                                     -> Transient
```

Scoped is the right default for your own services. Singleton is an optimization you justify.

## Thread safety is a requirement, not a bonus

Every singleton is called concurrently. A dictionary field on a singleton needs the concurrent
variant or a lock; a `List` field is a data race that will corrupt state under load and look like a
random bug. `DbContext` is explicitly **not** thread-safe: two awaits on the same context in flight
throws, and worse, sometimes silently corrupts change tracking.

## HTTP clients

Never `new HttpClient()` per call (socket exhaustion) and never keep one static forever (stale DNS).
Register a typed client through the factory: the client class is transient, its handler pool is
managed for you, and the base address, headers and timeout are configured once at registration.

Resilience — this estate uses Polly and the resilience extensions — goes on the client's handler
pipeline, not around each call site, so every call gets the same retry, timeout and circuit breaker.
Two rules: a total timeout must sit **outside** the retry, or N retries multiply the wait; and the
policy must only retry idempotent operations, or a retried POST duplicates the write.

## Registration hygiene

| Want | Use |
|---|---|
| One registration per module | an extension method per project, called from startup |
| Not to overwrite an existing registration | the "try add" variants |
| Several implementations of one interface | register all, inject the enumerable, and pick by a property — not by index |
| To wrap an existing service (caching, logging, retry) | a decorator: register the inner as itself, the outer as the interface |
| A choice made at runtime | a factory delegate registration, not a service locator in the consumer |
| Named variants of the same interface | keyed registration if the container in use supports it — check the framework version through the `microsoft-docs` plugin before relying on it |

Register the concrete type as itself only when something resolves it directly. Registering both the
interface and the class as separate scoped entries yields **two instances** in one scope, which is a
subtle and expensive bug when the service holds state.

## Injecting an options object

Inject the bound options value where the service only needs the settings once, not the whole options
wrapper — it keeps the constructor honest and the test trivial. See `errors-and-config.md`.

## What not to inject

- The service provider itself (a service locator: hides the graph, defeats scope validation).
- The configuration root, when a bound options class would do.
- A logger factory, when the generic logger for the class is what you want.
- `HttpContext` or its accessor, below the endpoint layer. Pass the two values you actually need.
- A `DbContext` into a domain entity or a validator. Both are then untestable and wrongly scoped.

## Diagnosing a lifetime bug

```powershell
# Every registration in the solution, with its lifetime, in one list
Select-String -Path (Get-ChildItem -Recurse -Filter *.cs).FullName -Pattern 'AddSingleton|AddScoped|AddTransient|AddHostedService'

# Singletons that take a provider or a factory — the hidden service-locator cases
Select-String -Path (Get-ChildItem -Recurse -Filter *.cs).FullName -Pattern 'IServiceProvider|IServiceScopeFactory|CreateScope'
```

Then: does the failing type hold state? Is any dependency in its constructor chain scoped? Is it
resolved inside a hosted service? Those three questions cover nearly every real case.
