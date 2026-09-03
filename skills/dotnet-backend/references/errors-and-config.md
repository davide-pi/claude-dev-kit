# Errors, validation, options, secrets

## Exceptions or result objects

Exceptions are for the exceptional: a state your code did not expect and cannot continue from.
Results are for outcomes the caller was always going to have to handle.

| Test | Answer |
|---|---|
| Will the immediate caller almost always handle it? | result |
| Does it happen on a normal user path several times a day? | result |
| Would a stack trace tell you anything useful? | exception |
| Does continuing risk corrupting data? | exception |
| Is it thrown across a process boundary anyway (HTTP, broker)? | result at the edge, mapped from either |

Cost matters at volume: throwing on an expected path shows up as CPU and as noise that buries the real
errors. A validation failure per request is not an error condition; a null reference is.

### Doing results without a library

A small generic result type with a typed error code plus a message is enough. Two rules make it work:
the error is an **enum or a closed set of records**, never a bare string, so the endpoint can map it
to a status code exhaustively; and the type must be impossible to ignore — the caller either checks
success before reading the value, or the value access throws. A result nobody inspects is worse than
an exception, because the failure now travels silently.

### Doing exceptions well

- One custom exception per meaningful category (not per call site), each mapped in one middleware.
- Never `catch (Exception)` and continue as if nothing happened. Either handle a specific type, or
  let it go up to the handler that logs and maps it.
- Rethrowing must preserve the stack: bare `throw`, or wrap with the original as inner exception.
  `throw ex` discards the trace and hides the actual line.
- Never swallow to "keep the loop going" without logging the item id and the reason.
- Do not use exceptions for control flow between your own layers.

## Where validation lives

| Layer | Checks | On failure |
|---|---|---|
| Edge (endpoint filter, action filter, mediator behaviour) | shape: required, length, range, format, cross-field | 400, all fields at once |
| Application service | existence, uniqueness, authorization on the specific record, state preconditions | result error mapped to 404/409/422 |
| Domain entity | invariants that must hold no matter who calls | exception — reaching it is a bug in the layer above |
| Database | constraints as the last line of defence | unique-violation mapped to a conflict result |

Two checks in different layers are not duplication when they answer different questions. Two checks
answering the same question in two layers are, and they will drift.

Never rely on the database constraint alone for a user-facing rule, and never rely on the application
check alone for data integrity: concurrent requests defeat it. Check for the message, constrain for
the truth.

## The options pattern

Bind a configuration section to a plain class with settable properties, register it at startup, and
inject the bound value into consumers.

| Interface | Reads the value | Use when |
|---|---|---|
| Plain options | once, at first resolve | almost always |
| Snapshot | once per scope/request | a request must see a reload |
| Monitor | on every access, with a change callback | a singleton must react to a change |

Validate at startup: attribute-based rules plus a start-time validation call, so a missing or
malformed setting fails the host immediately instead of throwing on the first request that needs it.
That converts an intermittent production bug into a failed deployment, which is the trade you want.

Inject the bound value, not the wrapper, wherever reload does not matter — the test then passes a
plain object with no framework involved.

### Configuration precedence

Later sources override earlier ones. The default order — base file, environment-specific file, user
secrets in Development, environment variables, command line — is why an environment variable beats
everything in a file and why "my appsettings change did nothing" is almost always an environment
variable set on the machine or in the container.

Double underscore separates sections in an environment variable name. Confirm what is actually in
effect before debugging the code:

```powershell
Get-ChildItem Env: | Where-Object Name -match 'ConnectionStrings__|^ASPNETCORE_|^DOTNET_'
```

## Secrets

Rules, in order:

1. Nothing with a password, key, token or account secret is ever committed. Not in a committed
   settings file, not in a compose file, not in a test, not commented out, not "temporarily".
2. Local development uses the user-secrets store, per project — it lives outside the repository.
3. Deployed environments use environment variables or a managed secret store; the code just reads a
   named connection string and does not know the difference.
4. A committed settings file may contain a connection string only in a form that carries no
   credentials — integrated security against a local server, and nothing else.

```powershell
dotnet user-secrets init          --project .\src\<Api>
dotnet user-secrets set           --project .\src\<Api> "ConnectionStrings:Default" "<value>"
dotnet user-secrets list          --project .\src\<Api>

# Audit the tree before a commit
Get-ChildItem -Recurse -Include *.json,*.config,*.yml,*.yaml,*.ps1 |
  Select-String -Pattern 'Password\s*=|Pwd\s*=|AccountKey=|SharedAccessKey|ApiKey|Bearer\s+[A-Za-z0-9]'
```

### A secret already reached the repository

Treat it as compromised the moment it was pushed — history rewriting does not un-share it, and clones
and caches keep it.

1. Rotate the credential first. Everything else is secondary.
2. Remove it from the working tree, replace it with configuration, and commit that.
3. Only then discuss history: rewriting a shared branch is a coordinated action, not a quick fix, and
   it never substitutes for rotation.
4. Tell the person who owns the credential. Do not quietly patch it.

## Logging errors without making them useless

- Log an exception once, where it is handled, with the correlation id and the identifiers needed to
  reproduce it. Logging at every level produces five entries for one failure.
- Log the values as structured properties, not interpolated into the message, or you cannot filter.
- Never log: passwords, tokens, full connection strings, card or national-id numbers, request bodies
  that may contain any of those, or a whole entity because it was convenient.
- A caught-and-handled expected outcome is information or debug, not error. Reserve error for "a human
  should look at this", or alerting becomes noise nobody reads. See `dotnet-diagnostics`, `logging.md`.
