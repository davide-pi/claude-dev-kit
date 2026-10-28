# Errors, validation, options, secrets

## Exceptions or result objects

| Test | Answer |
|---|---|
| the immediate caller almost always handles it, or it happens on a normal user path | result |
| a stack trace would tell you something; continuing risks corrupting data | exception |
| thrown across a process boundary anyway (HTTP, broker) | result at the edge, mapped from either |

- A result type: the error is an **enum or a closed set of records**, never a bare string, so the
  endpoint maps it exhaustively; and it must be impossible to ignore (check success before reading the
  value, or value access throws).
- One custom exception per category, each mapped in one middleware. Never `catch (Exception)` and carry
  on; rethrow with bare `throw` (`throw ex` discards the trace). Never swallow to "keep the loop going"
  without logging the item id and the reason.

## Where validation lives

| Layer | Checks | On failure |
|---|---|---|
| edge (filter, mediator behaviour) | shape: required, length, range, format, cross-field | 400, all fields at once |
| application service | existence, uniqueness, per-record authorization, state preconditions | result error → 404/409/422 |
| domain entity | invariants whatever the caller | exception — reaching it is a bug above |
| database | constraints, last line of defence | unique violation mapped to a conflict result |

Two checks answering the same question in two layers will drift; different questions are not
duplication. Never rely on the database constraint alone for a user-facing message, nor on the
application check alone for integrity (concurrency defeats it): check for the message, constrain for the
truth.

## Options

Validate at startup (attribute rules plus start-time validation) so a bad setting fails the deployment,
not the first request. Snapshot when a request must see a reload; monitor when a singleton must react;
plain options otherwise. Inject the bound value where reload does not matter, so tests pass a plain
object.

### Configuration precedence

Base file, environment file, user secrets (Development), environment variables, command line; later
wins. "My appsettings change did nothing" is almost always an environment variable on the machine or in
the container. Double underscore separates sections in a variable name:

```powershell
Get-ChildItem Env: | Where-Object Name -match 'ConnectionStrings__|^ASPNETCORE_|^DOTNET_'
```

## Secrets

1. Nothing with a password, key, token or account secret is ever committed: not in a settings file, a
   compose file, a test, a comment, "temporarily".
2. Local development: the per-project user-secrets store, outside the repository.
3. Deployed environments: environment variables or a managed secret store; the code reads a named
   connection string and does not know the difference.
4. A committed settings file may hold a connection string only without credentials (integrated security
   against a local server).

```powershell
dotnet user-secrets init          --project .\src\<Api>
dotnet user-secrets set           --project .\src\<Api> "ConnectionStrings:Default" "<value>"
dotnet user-secrets list          --project .\src\<Api>

# Audit the tree before a commit
Get-ChildItem -Recurse -Include *.json,*.config,*.yml,*.yaml,*.ps1 |
  Select-String -Pattern 'Password\s*=|Pwd\s*=|AccountKey=|SharedAccessKey|ApiKey|Bearer\s+[A-Za-z0-9]'
```

### A secret already reached the repository

Compromised the moment it was pushed; history rewriting does not un-share it.

1. Rotate the credential first.
2. Remove it from the working tree, replace with configuration, commit.
3. Only then discuss history: rewriting a shared branch is a coordinated action, never a substitute for
   rotation.
4. Tell the credential's owner; do not quietly patch it.

## Logging errors

Log an exception once, where it is handled, with the correlation id and reproducing identifiers; values
as structured properties. Never log passwords, tokens, full connection strings, card or national-id
numbers, request bodies that may hold them, or a whole entity. A handled expected outcome is
information or debug; reserve error for "a human should look". See `dotnet-diagnostics`, `logging.md`.

## Failure on the RPC bus: exception or data

| The failure is | Model it as |
| --- | --- |
| a business outcome the RPC caller branches on (refused, not found, not allowed) | **data**: the response's outcome fields (`IsSuccess`, an error status) |
| a bug or an impossible state | an exception, logged with context, never swallowed into a success |
| a transient dependency failure (timeout, deadlock, broker blip) | an exception, retried by Polly, only around idempotent work |
| invalid input at an HTTP edge | a 400 with field-level problem details, validated once at the edge |
