---
paths: "**/Migrations/**/*.cs,**/*ModelSnapshot.cs"
---
# EF Core migrations — house facts

- Never hand-write a migration class or edit the model snapshot: change the model, remove the
  unapplied migration with the tool, regenerate. Editing `Up`/`Down` bodies (e.g. a rename) is fine.
- Before any `database update`: `dotnet ef migrations script --idempotent -o <file>`, read end to
  end; every `DROP`, `ALTER COLUMN`, `TRUNCATE` must be deliberate.
- A drop-then-add of a column with the same meaning is a lost rename: rename explicitly so the data
  survives.
- A migration applied anywhere shared is history: fix forward with a new migration.
- Deploys consume the idempotent script (the `migration.sql` artifact), not `database update`.
- Several `DbContext`s: `--context` on every command, each with its own Migrations folder. Run
  `dotnet ef dbcontext info` before `database update`: it applies what the design-time factory resolved.
- Never `database drop`, `database update 0`, `--connection` to another environment, or `migrations
  remove` on a migration applied beyond your own database. The script goes to a temp file, not the repo.
- `Value cannot be null (Parameter 'input')` from `dotnet ef`: the factory rewrites the connection from
  an unset `ConnectionStrings__<Ctx>`; set it for the call. `Unable to create a DbContext`: add a
  factory or pass `--startup-project`.
- Seed reference data in a migration insert, not model seed data. Soft delete or tenant: a global query filter.
