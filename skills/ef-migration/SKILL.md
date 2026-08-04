---
name: ef-migration
description: Create, update, remove, or apply Entity Framework Core migrations for the project's SQL Server DbContexts. Use whenever the EF model and the database have diverged or a schema change is needed — e.g. you added/removed/renamed an entity or property, changed a DbContext or entity configuration, need a new column/table/index, want to scaffold custom SQL or a data migration, or must sync/update the database after a model change — even if the user never says the word "migration". Never hand-edit migration or ModelSnapshot files; always go through dotnet ef.
---

ALWAYS use `dotnet ef` commands to manage EF Core migrations.
NEVER hand-create or edit migration files, and NEVER edit the `*ModelSnapshot.cs`.

## First, restore the tool

If `dotnet-ef` is pinned in a `dotnet-tools.json` manifest, run `dotnet tool restore`
once per session before any `dotnet ef` command.

## Gotcha: connection-string overrides can break design-time

Watch for design-time factories that load `.AddEnvironmentVariables()` and rewrite the base
connection string — e.g. an env var that regex-replaces the `Server=` part. If that rewrite runs
**even when the base connection string is null** (no null-guard), `dotnet ef` throws
**`Value cannot be null. (Parameter 'input')`** instead of falling back to the mock connection.

Such an env var is often set on dev machines that run a **SQL MCP** (`.mcp.json`). So before
`dotnet ef` on an affected context, supply that context's base connection string for the invocation
(key = `ConnectionStrings__<Context>Database`), e.g. in PowerShell:

```powershell
$env:ConnectionStrings__<Context>Database = 'Data Source=.;Initial Catalog=<Db>;Trusted_Connection=True;Encrypt=False'
# ...then run the migration command
```

Alternatively clear the offending env var for the session. Root-cause fix: add a null-guard to the
`GetConnectionStringForDb` (or equivalent) in the affected design-time factory.

## The SQL Server DbContexts

Each DbContext with a design-time `*DbContextFactory` uses the same project for both `--project` and
`--startup-project`. Map each one to its project:

| DbContext | Project (use for both `--project` / `--startup-project`) |
|---|---|
| `<Name>DbContext` | `src/<path/to/Data-or-Infrastructure-project>` |

Read-cache projects that use Dapper (or manage their schema outside EF) have **no EF migrations**.

## Add a migration

```
dotnet ef migrations add <DescriptiveName> --project <Proj> --startup-project <Proj>
```

Name it after its intent — `AddCustomerEmail`, `RemoveObsoleteColumnInUsersTable` — for a readable
history. The migration lands in that project's `Migrations/`.

## When a migration needs custom SQL / a data script

Create it with `dotnet ef migrations add`, then edit the generated **migration** file (never the
snapshot) to add `migrationBuilder.Sql(...)`.

## Remove or redo the last migration

```
dotnet ef migrations remove --project <Proj> --startup-project <Proj>
```

Only valid while the migration is **not applied** anywhere shared: it deletes the file and rewinds the
snapshot. If it is already applied on a database you do not own, add a new migration instead.

## Apply it to a database

```
dotnet ef database update --project <Proj> --startup-project <Proj>
```

Targets whatever connection string the design-time factory resolves — check which database that is
before running it, and read the null-connection-string gotcha above, because the same env var that
breaks `migrations add` also decides where `database update` writes. To move to a specific migration
(including rolling back), pass its name; `0` reverts everything. On shared or production databases the
deployment pipeline owns this step: generate a script instead
(`dotnet ef migrations script <from> <to> --idempotent --output <file>.sql`) and hand it over.

If this project keeps a deeper playbook (e.g. `docs/technical/playbooks.md`), follow it where it
disagrees with the defaults above.
