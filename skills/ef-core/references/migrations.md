# The migration workflow, with guardrails

Two rules that override everything else in this file:

1. **Generate with `dotnet ef`.** Never hand-write a migration class, and never edit a model snapshot.
   Edit only the body of a generated migration's `Up`/`Down`.
2. **Read the SQL before a database does.** Every migration is reviewed as SQL, not as C#.

## The procedure — add a migration and get it reviewed

Run in order. The stop in step 5 is the point: **the generated SQL is read by a human before any
database runs it.** Everything the user reads (warnings, the confirmation line, the report) is
**Italian**; the migration name stays English PascalCase, and tool output, SQL and names are quoted
verbatim.

```powershell
# 0. Once per session when dotnet-ef is pinned in a tool manifest
dotnet tool restore

# 1. Resolve the projects. --project holds the DbContext and Migrations/; --startup-project builds
#    configuration. A design-time factory in the data project makes them the same project.
dotnet ef dbcontext list --project <proj> --startup-project <startup> --json
#    More than one context -> ask which, and pass --context on EVERY later call.

# 2. Baseline: what exists and what is applied. Pending ones = the database is behind.
dotnet ef migrations list -c <Ctx> -p <proj> -s <startup>
#    Report a pending backlog and let the user decide; never stack on top of it silently.

# 3. Is there anything to migrate? No -> stop: an empty migration is noise.
dotnet ef migrations has-pending-model-changes -c <Ctx> -p <proj> -s <startup>

# 4. Generate, named for the intent (AddCustomerEmail, not Update2), then read Up AND Down.
dotnet ef migrations add <Name> -c <Ctx> -p <proj> -s <startup>

# 5. Show the SQL and STOP. No database is touched in this step.
dotnet ef migrations script <PreviousMigration> <Name> --idempotent -o .\migration.sql -c <Ctx> -p <proj> -s <startup>
Select-String -Path .\migration.sql -Pattern 'DROP TABLE|DROP COLUMN|DROP CONSTRAINT|DROP INDEX|TRUNCATE|ALTER COLUMN'
#    State: tables touched, destructive statements, whether Down truly inverts Up, and whether a
#    table with rows needs a backfill the migration lacks. Then ask for confirmation in one line.

# 6. Apply, on an explicit yes only, to the LOCAL development database — name it first.
dotnet ef dbcontext info -c <Ctx> -p <proj> -s <startup>        # the connection it will really use
dotnet ef database update <Name> -c <Ctx> -p <proj> -s <startup>
dotnet ef migrations list -c <Ctx> -p <proj> -s <startup>       # report the new state

# 7. Report: context, migration name and path, tables touched, destructive statements, script path,
#    applied or not and to which database. The migration file, its designer file and the snapshot
#    change are one commit — and committing is `/commit` (then `pr-create`), not this procedure.
```

Pre-authorisation ("apply it too") skips the *asking* in step 5, never the *showing*.

**Guardrails — single owner of these rules in the kit:**

- **Never hand-write a migration class, and never edit a model snapshot.** Generate with `dotnet ef`;
  edit only the body of a generated migration's `Up`/`Down` (custom SQL, backfills).
- Never `dotnet ef database drop`, never `database update 0` — both destroy data.
- Never `migrations remove` a migration applied to any database other than your own (see below).
- Never `--connection` to another environment; staging and production are the pipeline's job.
- Never hand-edit `__EFMigrationsHistory`.
- A destructive statement is reported even when the user asked for exactly that change.

Projects that manage their schema outside EF — the Postgres read cache, every Dapper-only project —
have no migrations at all. Do not add a context to them to get one.

**How the script reaches production here.** The build publishes the idempotent script as a
`migration.sql` inside a database-migration artifact; the deploy runs it with `sqlcmd -b` against the
target database before the services restart (`pipeline` skill, deploy reference). So the script you
review in step 5 is, shape for shape, what production will execute — which is why `--idempotent` is
not optional.

## What to look for in the generated SQL

| Pattern | Meaning | Action |
|---|---|---|
| `DROP COLUMN` / `DROP TABLE` | data loss on deploy | is it intended, and is the data already migrated? |
| A drop plus an add of a similar column | EF interpreted a **rename** as drop-and-recreate | rewrite as a rename operation |
| `ALTER COLUMN` narrowing a type or length | truncation, or a failure on existing rows | widen only, or migrate the data first |
| `ALTER COLUMN ... NOT NULL` with no default | fails on any existing row | add nullable, backfill, then tighten in a second migration |
| A new unique index | fails if duplicates exist | de-duplicate first, in the same migration's SQL |
| A new foreign key | fails on orphan rows | clean the orphans first |
| Table rebuilds or index drops on a large table | a long lock during deployment | plan the window, or do it online where the provider supports it |

A destructive statement is not automatically wrong — it is automatically a decision that needs a human
and a note in the pull request.

## Custom SQL and data migrations

Generate the migration, then add raw SQL to the generated `Up`. That is the supported way to seed, to
backfill, to create a view or a function, and to migrate data alongside a schema change. Two habits:
write the matching statement in `Down`, and keep the SQL idempotent where it may be re-run.

A view or a function used by a keyless entity belongs in a migration, so its definition is versioned
with the code that depends on it.

## Never-drop, expand and contract

Any change that removes or narrows something is split across two deployments:

1. **Expand** — add the new column, table or index. Backfill it. Write to both old and new.
2. Deploy the code that reads the new shape.
3. **Contract** — a later migration removes the old shape, once nothing reads it.

This is what makes a deployment reversible and a rolling deployment possible: at every moment, the
database works with both the old and the new code. A single migration that drops the old column the
moment the new one appears cannot be rolled back, and takes the previous version of the application
down with it.

## Repairing a bad migration

```
Not applied anywhere but your own machine?
  -> dotnet ef migrations remove          (deletes the file, rewinds the snapshot)
     Fix the model, add it again. If it is applied locally, revert the database first:
     dotnet ef database update <PreviousMigration>

Applied on a shared or deployed database?
  -> NEVER remove it, and never edit it. Its hash and name are recorded in the history table
     on every database that has it; deleting the file makes those databases unexplainable.
  -> Add a NEW corrective migration on top: fix the schema forwards.
  -> If it destroyed data, restore that data from a backup in the corrective migration's SQL.
     The schema can be fixed forwards; the data cannot.

Applied on some databases and not others?
  -> the idempotent script is the tool: it checks the history table per statement and applies
     only what is missing. Never hand-run a plain script against a partially migrated database.
```

The single unrecoverable mistake is removing an applied migration and re-adding a different one with
the same name: the history rows then refer to a migration that no longer matches, and the only exit is
manual reconciliation of every affected database.

## Shared and production databases

Never run `database update` against them. Generate a script, review it, hand it to the pipeline that
owns the deployment.

```powershell
dotnet ef migrations script --idempotent --output .\deploy.sql        # everything, safe to re-run
dotnet ef migrations script <From> <To> --idempotent --output .\delta.sql
dotnet ef migrations bundle --self-contained --output .\efbundle.exe  # an executable the pipeline runs
```

Always `--idempotent`: it wraps each operation in a check against the history table, so a re-run or a
partially applied state is safe. A non-idempotent script run twice fails halfway and leaves the
database in a state nobody planned for.

`database update 0` reverts every migration — that is a full teardown of the schema. It is a local
development tool and nothing else.

## Design-time gotchas

- **`Value cannot be null. (Parameter 'input')`** from any command: a design-time factory is rewriting
  the base connection string from an environment variable and does not guard against a null base
  value. Such variables are commonly set on machines running a database MCP server. Workaround: set
  the context's own key for the invocation, or clear the offending variable. Real fix: a null guard in
  the factory.

  ```powershell
  Get-ChildItem Env: | Where-Object Name -match 'ConnectionStrings__'
  $env:ConnectionStrings__<Ctx>Database = 'Data Source=.;Initial Catalog=<Db>;Trusted_Connection=True;Encrypt=False'
  ```

- **`Unable to create a DbContext`**: the startup project cannot be built, or its host builder does
  work at startup that fails without a real environment. Add a design-time factory in the data
  project — it is a few lines, it makes the commands independent of the host, and it is the reason the
  same project can serve as both `--project` and `--startup-project`.
- A factory that resolves a different connection string than the running application is how a
  migration reaches the wrong database. `dotnet ef dbcontext info` before every `database update`.
- The environment matters: the factory reads configuration, so `DOTNET_ENVIRONMENT` or
  `ASPNETCORE_ENVIRONMENT` can change which database you are about to modify.

## Commit hygiene

The migration file, its designer file and the snapshot change are one commit. A snapshot committed
without its migration, or the reverse, breaks the next person's `migrations add` with a spurious diff.
Two migrations added in parallel on two branches will conflict in the snapshot — resolve it by keeping
one, removing the other locally, and regenerating it on top. Never merge two snapshots by hand.
