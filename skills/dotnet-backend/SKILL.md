---
name: dotnet-backend
description: >-
  Use whenever backend C# is added or restructured in these services — a new responder or
  subscriber, DI wiring, a Polly retry, a background job, options or secrets — or a lifetime bug, a
  captive dependency, a sync-over-async hang or thread-pool starvation is suspected.
---

# dotnet-backend — the stack as it is: singletons, RPC handlers, async all the way

Read the real package list before reaching for an idiom. In the large backend the libraries that
shape the code are **EasyNetQ** (the service-to-service call), **Polly** with its contrib jitter
backoff (retries), **Serilog** (logging) and **Scrutor** (assembly scanning). **MediatR, AutoMapper
and FluentValidation are absent** — do not introduce them as a side effect of a feature. **Quartz**
appears in one service only; elsewhere scheduled work is a hosted service.

## When

- Adding a responder, subscriber, hosted service, typed HTTP client or options class.
- Wiring DI, or debugging a lifetime, captive-dependency or thread-safety bug.
- Writing or fixing async code: cancellation, blocking, fan-out, a hang that only shows under load.
- Adding or reviewing a Polly policy, or deciding what failure becomes an exception and what is data.
- Binding configuration, and keeping connection strings and tokens out of the repository.

Not for: EF Core modelling and queries (`ef-core`), RabbitMQ semantics (`rabbitmq`), test mechanics
(`dotnet-testing`), a running process (`dotnet-diagnostics`), T-SQL (`sql-server`), exact API
signatures across releases (the `microsoft-docs` plugin).

## Decide

### Where does this code go — match the layout, do not redesign it

| Project suffix | Holds |
| --- | --- |
| `*.ServiceContract` | request, response and event types shared with callers — additive changes only |
| `*.Business` / `*.Application` | the subscribers (`ISubscriber`): one class per RPC responder or event handler, plus domain logic |
| `*.Data` / `*.Infrastructure` | EF contexts and DAOs; `*.Infrastructure.PostgreSql` is the Dapper read cache |
| `*.Service` / `*.WebApi` | the host: `Program.cs`, DI composition, the bootstrap hosted service, `/health` |

Not sure which project owns a behaviour across hundreds of them? The `investigator` agent locates it
(entry file plus handler); its trace mode follows the call across services. Do not sweep by hand.

### DI lifetime — the house shape

Subscribers are registered by Scrutor scan as **singletons**, and so are the DAOs and the custom
`DbContext` factories they inject. Everything a subscriber touches must therefore be singleton-safe.

| The dependency | Lifetime | Rule |
| --- | --- | --- |
| a subscriber / responder | singleton (scanned) | no per-request state in fields; inject only singleton-safe services |
| data access | singleton factory; `await using var db = factory.Create()` **per handler call** | never inject a `DbContext` or any scoped service into a subscriber |
| `IBus` | singleton, one per process (or a named bus collection) | never created per call |
| an HTTP dependency | typed client through `AddHttpClient<T>` | never `new HttpClient`, never a hand-rolled singleton |
| a hosted service needing scoped work | singleton | open a scope per unit of work through the scope factory |

A shorter lifetime injected into a longer one is a captive dependency: it silently takes on the outer
lifetime. Details and scope validation: `references/di-lifetimes.md`.

### Failure: exception or data

| The failure is | Model it as |
| --- | --- |
| a business outcome an RPC caller can branch on (refused, not found, not allowed) | **data**: the response's outcome fields (`IsSuccess`, an error status) — the house contract |
| a bug or an impossible state | an exception, logged with context; never swallowed into a success response |
| a transient dependency failure (timeout, deadlock, broker blip) | an exception, retried by a Polly policy — **only around idempotent work** |
| invalid input at an HTTP edge | a 400 with field-level problem details, validated once at the edge |

An exception thrown by a responder crosses the bus as a bare message string, so for RPC the data
model is not a style choice. Detail: `references/errors-and-config.md`.

### Polly — retry only what is safe to repeat

| Wrapping | Verdict |
| --- | --- |
| a read, a subscribe at startup, an idempotent upsert | retry with jittered backoff, bounded attempts, logged on each retry |
| a non-idempotent write, a publish, an RPC request with side effects | no retry until it is made idempotent |
| a retry inside a retry (policy around an RPC whose responder also retries) | collapse to one layer — attempts multiply |

## Do

```powershell
# What is actually referenced — this decides the idioms before any code is written
Select-String -Path (Get-ChildItem -Recurse -Filter *.csproj).FullName -Pattern 'PackageReference' |
  ForEach-Object { ($_ -split 'Include="')[1] -split '"' | Select-Object -First 1 } | Group-Object | Sort-Object Count -Descending
Get-ChildItem -Recurse -Filter Directory.*.props                    # central versions and shared settings

# Lifetimes as registered
Get-ChildItem -Recurse -Filter *.cs | Select-String -Pattern 'With(Singleton|Scoped|Transient)Lifetime|Add(Singleton|Scoped|Transient)<'

# Secrets: nothing in the tree
Get-ChildItem -Recurse -Filter appsettings*.json | Select-String -Pattern 'Password=|Pwd=|AccountKey=|Secret'
dotnet user-secrets set --project .\src\<Host> "ConnectionStrings:<Name>" "<value>"
```

## Traps

1. `.Result`, `.Wait()`, `GetAwaiter().GetResult()` → thread-pool starvation; RPC calls and Redis
   time out together under load → async all the way up (`references/async-concurrency.md`).
2. A scoped service or a `DbContext` injected into a scanned singleton subscriber → shared across
   concurrent messages → inject the factory, create per call.
3. Mutable state in a subscriber's fields → two messages race on it → keep state local to the call.
4. `async void`, or a `Task` never awaited (fire-and-forget) → the exception vanishes; the bootstrap
   service already does this with subscriptions, do not copy it.
5. A Polly retry around a non-idempotent write → duplicate rows or messages.
6. A `CancellationToken` accepted and dropped → work continues after the caller is gone.
7. `Parallel.ForEach` over I/O → threads park on the network → bounded async fan-out.
8. A configuration value silently null → names do not match, or the deployed config merge did not set
   it → bind options and validate at startup.
9. A responder that throws for a business rule → the caller receives only a message string.
10. A new mapping, validation or mediator library introduced for one feature → a second idiom in a
    codebase that has none → hand-write it the way the neighbours do.

## References

- `references/di-lifetimes.md` — lifetimes, captive dependencies, scopes inside singletons and hosted
  services, typed HTTP clients with resilience, registration hygiene and scope validation.
- `references/async-concurrency.md` — async all the way, cancellation, sync-over-async deadlocks,
  concurrency against parallelism, bounded fan-out.
- `references/errors-and-config.md` — exceptions against results in code, validation placement, the
  options pattern, configuration precedence, secret handling and remediation.
