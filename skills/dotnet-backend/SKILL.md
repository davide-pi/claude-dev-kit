---
name: dotnet-backend
description: >-
  Use when backend C# changes: responder, subscriber, hosted service, DI wiring, Polly retry,
  options, Redis cache or stream; lifetime bugs, thread-pool starvation, RedisTimeoutException; "codice backend".
paths: "**/*.cs"
---

# dotnet-backend — the stack as it is: singleton handlers, RPC, async all the way

**Contract.** Code that matches the neighbouring layout and idioms · never adds a library or a
second idiom the codebase lacks · explanations in the chat language, code in English.

## When

Not for: EF modelling and queries (`ef-core`), message semantics (`rabbitmq`), evidence from a
running process (`dotnet-diagnostics`).

House facts: rule `csharp`.

## Decide

### The libraries decide the idiom — read them first

| Present in the large backend | Absent — never introduce for one feature |
| --- | --- |
| EasyNetQ (service calls), Polly with jittered backoff, Serilog, Scrutor (assembly scanning) | MediatR, AutoMapper, FluentValidation: hand-write it the way the neighbours do |
| Quartz in one service only | elsewhere scheduled work is a hosted service |

### Where the code goes — match the layout, never redesign it

| Project suffix | Holds |
| --- | --- |
| `*.ServiceContract` | request, response and event types shared with callers — additive changes only |
| `*.Business` / `*.Application` | subscribers (`ISubscriber`): one class per RPC responder or event handler, plus domain logic |
| `*.Data` / `*.Infrastructure` | EF contexts and DAOs; `*.Infrastructure.PostgreSql` is the Dapper read cache |
| `*.Service` / `*.WebApi` | the host: `Program.cs`, DI composition, the bootstrap hosted service, `/health` |

Which project owns a behaviour → the `investigator` agent (`locate`; `trace` across services), never a sweep by hand.

### DI lifetime — the house shape

Scrutor registers subscribers, DAOs and `DbContext` factories as **singletons** (the lifetime rule is in `rules/csharp.md`).

| The dependency | Lifetime | Rule |
| --- | --- | --- |
| subscriber / responder | singleton (scanned) | no per-message state in fields |
| `IBus` | one per process (or a named bus collection) | never created per call |
| hosted service doing scoped work | singleton | a scope per unit of work from `IServiceScopeFactory` |

A shorter lifetime injected into a longer one is captive (scoped repository in a singleton: one
`DbContext` for the process). `ValidateScopes` is on by default in Development only: enable it with
`ValidateOnBuild` in every environment; it misses a singleton resolving from an injected
`IServiceProvider` at call time. Open a scope per unit of work and let nothing resolved escape the
`using`. A disposable transient is tracked by the resolving scope: a loop in a long-lived scope leaks.
Register the interface once, not interface and class as two scoped entries (two instances). Inject the
bound options value; never `IServiceProvider`, `HttpContext` below the endpoint, or a `DbContext` into
an entity. Typed `HttpClient` through the factory; its total timeout sits outside the retry.

### Failure: exception or data

| The failure is | Model it as |
| --- | --- |
| a business outcome the caller branches on (refused, not found, not allowed) | **data**: `IsSuccess` or an error status in the response; a responder's exception crosses the bus as a bare string |
| a bug or an impossible state | an exception, logged once with context, never swallowed into a success |
| a transient dependency failure | an exception, retried by Polly on idempotent work only |
| invalid input at an HTTP edge | 400 with field-level problem details, validated once at the edge |

Edge checks shape; the service checks existence, uniqueness and state; the database constraint is the
truth: check for the message, constrain for integrity; a unique violation maps to a conflict result (409). Rethrow with bare `throw`.

### Polly — retry only what is safe to repeat

| Wrapping | Verdict |
| --- | --- |
| a read, a subscribe at startup, an idempotent upsert | jittered backoff, bounded attempts, a log line per retry |
| a non-idempotent write, a publish, an RPC request with side effects | no retry until it is idempotent |
| a policy around an RPC whose responder also retries | one layer only — attempts multiply |

## Do

- The idioms available: Grep `Package(Reference|Version) Include="[^"]+"` in `*.csproj` and `Directory.Packages.props`.
- Lifetimes as registered: Grep `With(Singleton|Scoped|Transient)Lifetime|Add(Singleton|Scoped|Transient)<` in `*.cs`.

## Traps

1. Mutable state in a subscriber's fields → two messages race on it → keep state local to the call.
2. `async void` or an unawaited `Task` → the exception vanishes → the bootstrap service does it; never copy it.
3. `Parallel.ForEach` over I/O → threads park on the network → bounded async fan-out: limit from the
   downstream pool, one scope and `DbContext` per branch, never a lock held across an await.
4. An options value silently null → the section name does not match, or the deploy-time config merge
   did not set it (precedence: base file, environment file, user secrets, environment variables,
   command line; `__` separates sections, and a stray machine variable beats appsettings) → bind with
   `ValidateOnStart` and a validated options class.
5. Redis cache or stream code, a `RedisTimeoutException`, a stuck stream → `references/redis.md`.
6. `.Result`, `.Wait()` or `GetResult()` → thread-pool starvation (latency up with low CPU), a hard
   deadlock in the legacy .NET Framework tool → async up to the framework boundary; confirm with
   `dotnet-diagnostics`. `ConfigureAwait(false)` only in shared libraries the legacy tool consumes.
7. A token accepted and ignored, or the request-abort token on a commit → pass it down for reads, a
   separate token or none for the write; `OperationCanceledException` is no error; hosted services
   honour the stopping token. No safe fire-and-forget: hand work to a background service or a message.
8. A secret reached the repo → rotate first, then remove it from the tree, and only then discuss
   history; tell its owner. Secrets live in user-secrets locally, env or a store when deployed.

## References

- `references/redis.md` — the cache SDK wiring, Streams consumer groups and their traps, reading a
  `RedisTimeoutException`, inspecting a local instance.
