# The migration workflow, with guardrails

Two rules that override everything else in this file:

1. **Generate with `dotnet ef`.** Never hand-write a migration class, and never edit a model snapshot.
   Edit only the body of a generated migration's `Up`/`Down`.
2. **Read the SQL before a database does.** Every migration is reviewed as SQL, not as C#.

## Setup

```powershell
dotnet tool restore            # required when dotnet-ef is pinned in a tool manifest, once per session
dotnet ef --version
dotnet ef dbcontext list       # every context the startup project can build
dotnet ef dbcontext info       # provider, and the connection string that will actually be used
```

`--project` is the project holding the `DbContext` and its `Migrations` folder; `--startup-project` is
the project that builds configuration. Where the data project has its own design-time factory, both
arguments are that same project. With more than one context in a solution, `--context` is mandatory on
every command and each context keeps its own migrations folder.

Projects that manage their schema outside EF — a read cache, or the Dapper-based projects here — have
no migrations at all. Do not add a context to them to get one.

## The normal cycle

```powershell
# 1. Add, named for the intent, not for the mechanism
dotnet ef migrations add AddCustomerEmail --project .\src\<Data> --startup-project .\src\<Data> --context <Ctx>

# 2. Review as SQL. This is the guardrail, not an optional step.
dotnet ef migrations script --idempotent --output .\migration.sql --project .\src\<Data> --startup-project .\src\<Data>
Select-String -Path .\migration.sql -Pattern 'DROP TABLE|DROP COLUMN|DROP CONSTRAINT|DROP INDEX|TRUNCATE|ALTER COLUMN'

# 3. Apply to a local development database only
dotnet ef database update --project .\src\<Data> --startup-project .\src\<Data> --context <Ctx>

# 4. Commit the migration, its designer file AND the snapshot change together
```

Naming: `AddCustomerEmail`, `RemoveObsoleteUserColumn`, `IndexOrdersByStatus`. The migration list is
read as a history — `Migration1`, `Fix`, `Update2` make it unreadable and make a targeted rollback
guesswork.

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
