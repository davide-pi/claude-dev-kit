---
description: Create an EF Core migration with guardrails — confirm context and project, generate it, show the SQL and stop for review, apply only on confirmation.
argument-hint: "<MigrationName> [-c <DbContext>] [-p <project>] [-s <startup-project>] [--apply]"
---

Add an EF Core migration and get it reviewed before anything reaches a database. The modelling and
cost knowledge is in **`ef-core`**; this command is the safe sequence around `dotnet ef`. The stop
in step 5 is the point of the command: **the generated SQL is read by a human before it runs.**

**Language** — everything the user reads is **Italian**: the destructive-statement warnings, the
one-line confirmation of step 5 and the report of step 7. Two things are not translated: the
migration name, which becomes a C# class and stays **English** PascalCase, and every value echoed
from the tooling — SQL statements, table and column names, `dotnet ef` output, the database name.

## Argument grammar

- **`<MigrationName>`** — PascalCase, describing the schema change (`AddOrderShippedAt`). Missing →
  derive one from the model diff and confirm it.
- **`-c` / `-p` / `-s`** — passed straight through to `dotnet ef`; resolved in step 1 if absent.
- **`--apply`** — the user pre-authorises step 6. It still shows the SQL first.

## Steps (run in order)

1. **Resolve the projects.** The migrations project holds the `DbContext`; the startup project holds
   the host and the connection string. They are often different — never assume one project.
   ```powershell
   Get-ChildItem -Recurse -Filter *.csproj | Select-Object -ExpandProperty FullName
   dotnet ef dbcontext list --project <migrations-proj> --startup-project <startup-proj> --json
   ```
   More than one context → **ask which**, and pass `-c` on every later call. Never rely on the
   implicit single-context default once a second one exists.

2. **Establish the baseline** — what exists and what is already applied:
   ```powershell
   dotnet ef migrations list -c <Ctx> -p <proj> -s <startup>
   ```
   A migration listed as **pending** means the database is behind. Report it and let the user decide
   whether to apply the backlog before adding on top; do not stack silently.

3. **Confirm there is something to migrate**:
   ```powershell
   dotnet ef migrations has-pending-model-changes -c <Ctx> -p <proj> -s <startup>
   ```
   No pending model changes → stop. An empty migration is noise, not a change.

4. **Generate**:
   ```powershell
   dotnet ef migrations add <MigrationName> -c <Ctx> -p <proj> -s <startup>
   ```
   Then read the generated `Up` and `Down`. Flag, before anything else: `DropColumn`, `DropTable`,
   `DropForeignKey`, a column type narrowed, a nullable column made `NOT NULL` with no default, a
   rename EF has modelled as drop-then-add (data loss disguised as a rename), and a `Down` that
   cannot restore what `Up` removed.

5. **Show the SQL and STOP.** No database is touched in this step:
   ```powershell
   dotnet ef migrations script <PreviousMigration> <MigrationName> -c <Ctx> -p <proj> -s <startup> --idempotent -o migration.sql
   ```
   Print the script, or the destructive statements plus a summary if it is long, and state: the
   tables touched, the destructive statements, whether the `Down` is a true inverse, and — for a
   table with rows — whether the change needs a data backfill the migration does not contain.
   Then **ask for confirmation in one Italian line.** Wait. `--apply` skips the asking, not the
   showing.

6. **Apply, on an explicit yes only**:
   ```powershell
   dotnet ef database update <MigrationName> -c <Ctx> -p <proj> -s <startup>
   ```
   Name the target database from the resolved connection before running it, so the user sees *which*
   database is about to change. Then re-run step 2's `migrations list` and report the new state.

7. **Report**, in Italian — context, migration name and file path, tables touched, destructive
   statements found, the SQL script path, and whether it was applied and to which database.

## Guardrails

- **Never apply before showing the SQL.** Step 5 has no fast path, `--apply` included.
- **Never `dotnet ef database drop`** and never `dotnet ef database update 0` — both destroy data
  and neither is what "migrate" means.
- **Never `dotnet ef migrations remove` on a migration already applied** to any database: removing
  it desynchronises the history. Applied and wrong → a new corrective migration.
- Never edit a migration that has been pushed or applied; append instead.
- Never pass `--connection` to point at another environment, and never apply against anything but
  the local development database resolved in step 6. Staging and production are the pipeline's job.
- Never hand-edit `__EFMigrationsHistory`.
- A destructive statement is reported even when the user asked for exactly that change.
- Do not commit or push the migration — that is `/commit` or `/ship`.
