---
name: dotnet-backend
description: C# and ASP.NET Core backend idioms for this stack — choosing between a layered service and Clean Architecture (or neither), controllers versus minimal APIs, dependency-injection lifetimes and the captive-dependency trap, async and concurrency discipline, modelling failure as exceptions or result objects, where validation belongs, options binding and keeping secrets out of the repo, and the shape of a service that is easy to test. Use when adding or restructuring backend code, deciding which layer a piece of logic belongs in, wiring DI, hunting a lifetime bug or a sync-over-async hang, designing an endpoint, or making untested legacy code testable. Mentions Serilog, FluentValidation, Polly, MediatR, AutoMapper and Quartz only where they change the decision.
---

# dotnet-backend — backend architecture and C# idioms that survive contact with legacy code

## When

- Adding a feature to a backend service, or deciding which layer a piece of logic belongs in.
- Starting a service or restructuring one: project layout, dependency direction, module boundaries.
- Wiring dependency injection, or debugging a lifetime, captive-dependency or thread-safety bug.
- Writing or fixing async code: cancellation, blocking, fan-out, a hang that only shows under load.
- Modelling failure — exception or result object — and placing validation.
- Binding configuration, and keeping connection strings and tokens out of the repository.

Not for: EF Core modelling and queries (`ef-core`), test mechanics (`dotnet-testing`), investigating
a running process (`dotnet-diagnostics`), T-SQL and indexes (`sql-server`), or exact API signatures
and behaviour that changed between releases — route those to the `microsoft-docs` plugin.

## Decide

### How much architecture does this change deserve

| Situation | Shape | Why |
|---|---|---|
| Bounded change inside an existing layered service | follow the layers already there | consistency beats purity; a lone Clean island is noise |
| New service, real domain rules, expected to outlive one sprint | Clean: Domain / Application / Infrastructure / Api | the rules stay testable without a database |
| New service that is mostly transport plus a database call | layered: Api then Services then Data | Clean here buys interfaces nobody substitutes |
| A job, a webhook receiver, an integration shim | no layers — one project, handler plus client | ceremony would exceed the logic |
| Cross-cutting rewrite of a legacy layered estate | do not | pick seams, add tests, change locally |

Reading the repo tells you which it is: a `Domain` plus `Application` pair and an `Endpoints` folder
mean Clean; a `Services` plus `Data` pair with controllers means layered. Match what you find.

### Controllers or minimal APIs

| Signal | Choose |
|---|---|
| The solution already has controllers | controllers — do not mix styles per feature |
| The solution has an `Endpoints` folder | minimal APIs, one file per endpoint group |
| Heavy filters, model binders, conventions, inherited base controllers | controllers |
| Few parameters, high throughput, no MVC machinery needed | minimal APIs |
| Must be unit-testable without a host | either — but the handler body must be a named method |

The rule that matters in both: the endpoint parses input, calls one application service or handler,
maps the outcome to a status code. No business rules, no `DbContext`, no `HttpContext` below it.

### Failure: exception or result

| The failure is | Model it as | Surfaces as |
|---|---|---|
| A bug or an impossible state | exception, uncaught | 500, logged with the correlation id |
| Invalid input | validation result collected before the handler runs | 400 with field-level ProblemDetails |
| A rule the caller can legitimately hit (duplicate, no stock) | result object with a typed error | 409/422, no stack trace, no log noise |
| A dependency failing (timeout, socket, deadlock) | exception, retried by a resilience policy | 502/503 once the policy gives up |
| Not found | result object, or a domain exception mapped in one place | 404 |

Do not mix both models in one call chain: pick per module and stay consistent, because a caller that
must both inspect a result and catch an exception will do neither.

### DI lifetime

| The dependency | Lifetime | Note |
|---|---|---|
| Stateless, cheap, no captured state | Singleton | must be thread-safe |
| Holds per-request state, or wraps a `DbContext` | Scoped | the default for repositories and application services |
| Wraps an unshareable, cheap-to-create resource | Transient | never inject it into a singleton |
| `HttpClient` | neither `new` nor a hand-rolled singleton | register a typed client through the factory |
| Background worker | Singleton (hosted service) | open a scope per unit of work inside it |

A shorter lifetime injected into a longer one is a captive dependency: it silently takes on the outer
lifetime. See `di-lifetimes.md`.

## Do

```powershell
# What is actually referenced — this decides the idioms before you write any code
Select-String -Path (Get-ChildItem -Recurse -Filter *.csproj).FullName -Pattern 'PackageReference'
Get-ChildItem -Recurse -Filter Directory.Packages.props    # central versions live here, if present

# Target framework, nullability and language settings, per project
Select-String -Path (Get-ChildItem -Recurse -Filter *.csproj).FullName -Pattern 'TargetFramework|Nullable|LangVersion'

# Prove the container is consistent at startup instead of at 3 in the morning
Get-ChildItem -Recurse -Filter Program.cs | Select-String -Pattern 'ValidateScopes|ValidateOnBuild'

# Secrets: keep them out of the tree, and check nothing leaked in
dotnet user-secrets init --project .\src\<Api>
dotnet user-secrets set  --project .\src\<Api> "ConnectionStrings:Default" "<value>"
Get-ChildItem -Recurse -Filter appsettings*.json | Select-String -Pattern 'Password=|Pwd=|AccountKey=|Secret'

csharprepl                                                  # try an idiom without a project
ilspycmd .\bin\Debug\<tfm>\<Assembly>.dll -t <Namespace>.<Type>   # see what a legacy assembly does
```

## Traps

1. Blocking on async (`.Result`, `.Wait()`, `GetAwaiter().GetResult()`) → thread-pool starvation, or
   a hard deadlock in the legacy .NET Framework tool → make the caller async all the way up.
2. A request keeps working after the client disconnects → the `CancellationToken` was accepted and
   dropped → thread it through every call, down to the query and the HTTP client.
3. `ObjectDisposedException`, or one request seeing another's data → a scoped service captured by a
   singleton or a hosted service → open a scope per operation through the scope factory.
4. `Cannot consume scoped service from singleton` appears only in tests → production never validated
   scopes → enable scope validation in every environment, not only Development.
5. A configuration value is silently null → the section or property name does not match, or the file
   is not deployed → bind the options and validate them at startup so the host fails loudly.
6. Options never see an edited file → the plain options interface is a snapshot taken at first
   resolve → use the snapshot or monitor variant when reload genuinely matters, and comment why.
7. `async void` in an event handler or a scheduled job → the exception vanishes and can kill the
   process → return `Task` and let the framework await it.
8. `Parallel.ForEach` over I/O → threads park on the network and throughput falls → use the async
   fan-out with a bounded degree of parallelism.
9. A retry policy wrapping a non-idempotent write → duplicate rows or duplicate messages → make the
   operation idempotent first, or retry reads only.
10. Validation in the controller, the service and the entity, each copy different → validate input
    once at the edge, keep invariants in the domain, delete the third copy.
11. A mapping library used for non-trivial mappings → a rename silently drops a field → hand-write
    any mapping that carries a rule; keep the library for flat, same-name DTOs.
12. Mediator handlers used as a synchronous call stack five levels deep → the flow is untraceable →
    route only real use cases through the mediator and call helpers directly.

## References

- `architecture.md` — laying out layered versus Clean, dependency direction, where each kind of logic
  goes, and when a mediator or a mapping library earns its place.
- `api-surface.md` — controllers and minimal APIs in detail: shape, filters, ProblemDetails,
  FluentValidation wiring, versioning, and keeping either style testable.
- `di-lifetimes.md` — lifetimes, captive dependencies, scopes inside singletons and background
  services, typed HTTP clients with resilience, and registration hygiene.
- `async-concurrency.md` — async all the way, cancellation, `ConfigureAwait` reality here,
  sync-over-async deadlocks, concurrency versus parallelism, bounded fan-out.
- `errors-and-config.md` — exceptions versus results in code, validation placement, the options
  pattern, configuration precedence, and secret handling and remediation.
