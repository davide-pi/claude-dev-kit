---
paths: "**/Migrations/**/*.cs,**/*ModelSnapshot.cs"
---
# EF Core migrations — house facts

- Never hand-edit a generated migration or the model snapshot: change the model, remove the
  unapplied migration with the tool, regenerate.
- Before any `database update`: `dotnet ef migrations script --idempotent -o <file>`, read end to
  end; every `DROP`, `ALTER COLUMN`, `TRUNCATE` must be deliberate.
- A drop-then-add of a column with the same meaning is a lost rename: rename explicitly so the data
  survives.
- A migration applied anywhere shared is history: fix forward with a new migration.
- Deploys consume the idempotent script (the `migration.sql` artifact), not `database update`.

Procedure: skill `ef-core`.
