---
name: dotnet-backend
description: >-
  Use when backend C# changes: responder, subscriber, hosted service, DI wiring, Polly retry,
  options, Redis cache or stream; lifetime bugs, thread-pool starvation, RedisTimeoutException.
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

A shorter lifetime injected into a longer one is captive; `ValidateScopes` + `ValidateOnBuild` in
Development catch it at startup (`references/di-lifetimes.md`).

### Failure: exception or data

A business outcome is data; a transient failure is a Polly retry on idempotent work only. A
responder's exception crosses the bus as a bare message string: for RPC, data is the contract. The
full table: `references/errors-and-config.md`.

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
3. `Parallel.ForEach` over I/O → threads park on the network → bounded async fan-out
   (`references/async-concurrency.md`).
4. An options value silently null → the section name does not match, or the deploy-time config merge
   did not set it → bind with `ValidateOnStart` and a validated options class.
5. Redis cache or stream code, a `RedisTimeoutException`, a stuck stream → `references/redis.md`.

## References

- `references/di-lifetimes.md` — captive dependencies, scopes in singletons and hosted services,
  typed clients with resilience, scope validation.
- `references/async-concurrency.md` — cancellation, sync-over-async deadlocks, bounded fan-out.
- `references/errors-and-config.md` — when a failure's shape is open (exception, data, retry, HTTP
  400): the failure table; also exceptions against results, validation placement, options,
  configuration precedence, secret remediation.
- `references/redis.md` — the cache SDK wiring, Streams consumer groups and their traps, reading a
  `RedisTimeoutException`, inspecting a local instance.
