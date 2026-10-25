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
- `HttpClient` only through `AddHttpClient<T>`, never `new HttpClient()` per call.
- Serilog message templates, never interpolation: `Log.Information("Order {OrderId} placed", id)`,
  not `$"Order {id} placed"` — interpolation loses the structured property.
- Retries (Polly) only around operations safe to repeat.
- No secret, password-bearing connection string or token in `appsettings*.json`: user secrets
  locally, the pipeline's secret store elsewhere.
- `*.ServiceContract` types are shared with callers: additive changes only.

Procedure: skill `dotnet-backend`.
