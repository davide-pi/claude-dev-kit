---
paths: "**/*.cs"
---
# C# — house facts

- Match the file: file-scoped `namespace X;` in new files, nullable reference types on; no `!` to
  silence a warning without a comment saying why it cannot be null.
- `async` all the way down; every async public method takes a `CancellationToken` and passes it on.
- Never `.Result`, `.Wait()` or `.GetAwaiter().GetResult()` on a task: sync-over-async starves the
  thread pool under load.
- Lifetimes: a singleton (every subscriber/responder is one) never holds a scoped service or a
  `DbContext`; open a context per handler call from the factory.
- `HttpClient` only through `AddHttpClient<T>`, never `new HttpClient()` per call. Retries (Polly) only around operations safe to repeat.
- Serilog message templates, never interpolation: `Log.Information("Order {OrderId} placed", id)`,
  not `$"Order {id} placed"` — interpolation loses the structured property.
- No secret, password-bearing connection string or token in `appsettings*.json`: user secrets
  locally, the pipeline's secret store elsewhere.
- Read the libraries first (`*.csproj`): EasyNetQ, Polly, Serilog, Scrutor present; never add MediatR,
  AutoMapper or FluentValidation for one feature. One subscriber class per responder or handler, no
  per-message state in its fields; a hosted service doing scoped work opens a scope per unit of work.
- Enable `ValidateScopes`+`ValidateOnBuild` everywhere. Business outcomes the caller branches on are data (`IsSuccess`, a status), not exceptions: a
  responder's exception crosses the bus as a bare string. Rethrow with bare `throw`; a unique violation maps to 409.
- EF queries: project into the DTO inside the query, no-tracking for reads, `Any`/`Count` in the
  query, order on a unique key before paging, split query for several collections, bulk update for
  predicates, lazy loading off. Fluent `IEntityTypeConfiguration<T>` per entity, not attributes.
