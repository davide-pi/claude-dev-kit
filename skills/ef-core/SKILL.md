---
name: ef-core
description: >-
  Use when an EF Core entity, DbContext, configuration or migration changes or is applied, a
  column added, or a LINQ query is slow, wrong, untranslatable.
paths: "**/Migrations/**,**/*DbContext*.cs,**/*Configuration.cs"
---

# ef-core — model, query and migrate without breaking a database

**Contract.** Model, query and migration changes that keep the data (a repository's own data
playbook wins over this skill) · never hand-writes a migration class or edits the model snapshot,
never `database update` on a shared database · Italian prose, SQL and tool output verbatim.

## When

- Adding or changing an entity, relationship, key, constraint, converter or `DbContext`.
- A query is slow, returns the wrong rows, or throws on translation.
- Adding, removing, scripting or applying a migration; design-time commands failing.

Not for: plans, indexes, deadlocks and the Postgres read cache, which has no EF model (`sql-server`,
`db-analyst`); test setup against a real database (`dotnet-testing`).

Migration facts (no hand edits, idempotent script before any update, rename not drop-then-add, fix
forward once shared) are in `rules/ef-migrations.md`. The procedure that owns them:
`references/migrations.md` — follow it step by step, including the stop that shows the SQL.

## Decide

### Where configuration belongs

| Configuration | Put it | Why |
| --- | --- | --- |
| keys, relationships, lengths, precision, indexes | one `IEntityTypeConfiguration<T>` per entity | discovered from the assembly; no thousand-line context |
| anything the model needs to be correct | fluent configuration, not attributes | attributes cannot express most of it |
| a convention for every entity (decimal precision, string default, `DateTime` kind) | a model-builder convention | one rule instead of N repetitions |
| soft delete, tenant | a global query filter | impossible to forget — and it applies to every query |
| seed reference data | a migration data insert or an explicit seeding step | model seed data becomes migration churn |
| a view or function-backed read model | a keyless entity mapped to the view | the view is the contract |

### Query shape by cost

| You need | Do | Never |
| --- | --- | --- |
| a DTO or a few columns | project into the DTO **inside** the query | load the entity, then map |
| a read that will not be modified | no-tracking | track it and rely on a short-lived context |
| a parent with one collection | include, or project the collection | query per parent in a loop |
| a parent with several collections | split query, or project | one include of three collections: rows multiply |
| existence / a count | `Any` / `Count` in the query | materialize, then check in memory |
| a page | order on a stable, unique key, then skip and take | page an unordered query |
| many rows updated by predicate | the bulk update API, or raw SQL | load them all and save |
| a part EF cannot translate | project the translatable part, compute the rest in memory **deliberately** | rely on a silent fallback |

Lazy loading stays off: it turns property access into invisible N+1.

### Migration decision tree

```text
applied anywhere shared (a colleague's DB, an environment)?
  no  -> dotnet ef migrations remove, fix the model, add it again
  yes -> a new corrective migration on top
the Up() drops a column and adds a similar one?
  -> EF read a rename as drop + add: replace it with a rename in Up() and Down() before it is applied
target is shared or production?
  -> no `database update`: the idempotent script goes to the pipeline as `migration.sql`
several DbContexts?
  -> --context on every command; each context has its own Migrations folder
```

## Do

```powershell
dotnet tool restore                                 # if dotnet-ef is pinned in a tool manifest
dotnet ef migrations list                           # what exists, which are applied
dotnet ef migrations has-pending-model-changes      # anything to migrate at all
dotnet ef dbcontext info                            # provider and connection really resolved — every time

# A design-time factory that rewrites the connection from the environment: supply its key
$env:ConnectionStrings__<Ctx>Database = 'Data Source=.;Initial Catalog=<Db>;Trusted_Connection=True;Encrypt=False'
Get-ChildItem Env: | Where-Object Name -match 'ConnectionStrings__'   # what is overriding you
```

## Traps

1. `Value cannot be null. (Parameter 'input')` from `dotnet ef` → the factory rewrites the connection
   from an unset variable → set `ConnectionStrings__<Ctx>` for the call; real fix: a null guard.
2. `Unable to create a DbContext` → no design-time factory and the startup project cannot build its
   configuration → add a factory, or point `--startup-project` at the real host.
3. A migration applied to the wrong database → `database update` used what the factory resolved →
   `dotnet ef dbcontext info` first.
4. Works locally, throws on translation elsewhere → a provider that once evaluated client-side →
   check the provider and the emitted SQL (`references/querying.md`).
5. A list endpoint slows as data grows → N+1 from a loop or a mapping that touches navigations →
   log the SQL and count the statements.
6. `Sequence contains no elements`, or a change saved twice → one `DbContext` shared across
   messages → one per handler call from the factory (`dotnet-backend`).
7. Ordering, casing or paging differ between environments → collation or a non-unique order →
   order by a unique column (`references/providers.md`).

## References

- `references/migrations.md` — the procedure and its guardrails: review the script, never drop,
  repair an applied migration, several contexts, design-time factories, the pipeline hand-off.
- `references/querying.md` — the cost model, N+1 shapes, tracking, split queries, client
  evaluation, bulk operations, seeing the SQL EF emits.
- `references/modelling.md` — keys, owned types, converters, concurrency tokens, conventions,
  inheritance, keyless read models.
- `references/providers.md` — SQL Server against Npgsql differences that bite; when to drop to raw
  SQL or Dapper beside EF.
