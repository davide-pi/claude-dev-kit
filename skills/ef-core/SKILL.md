---
name: ef-core
description: >-
  Use this skill whenever an EF Core migration has to be created, applied, reverted or inspected —
  even if the user never says "migration" but changes an entity, adds a column or a DbContext — and
  whenever a LINQ query is slow, wrong, or will not translate.
---

# ef-core — modelling, querying, and migrating without breaking a database

## When

- Adding or changing an entity, a relationship, a key, a constraint or a converter.
- Writing a query, or fixing one that is slow, returns the wrong rows, or throws on translation.
- Adding, removing, scripting or applying a migration; a model and a database that have diverged.
- Design-time commands failing, several contexts in one solution, or a design-time factory.
- Deciding whether a piece of data access should be EF, raw SQL, or Dapper.
- Moving between the SQL Server and Npgsql providers, or supporting both.

Not for: index design, execution plans and deadlocks (`sql-server`, or the `db-analyst` agent for a
plan or a schema review before a migration), the Postgres read cache, which has no EF model
(`sql-server`), spinning up a database container (`docker-dev-env`), test setup against a real database
(`dotnet-testing`), or provider APIs that changed between releases — route those to the
`microsoft-docs` plugin.

**Never hand-write a migration class or hand-edit a model snapshot** — the full procedure and its
guardrails are owned by `references/migrations.md`; follow it step by step, including the stop that
shows the SQL before any database sees it. The one edit allowed in a generated migration is the
data-loss fix below: a drop-then-add `Up()` rewritten as a rename.

## Decide

### Where configuration belongs

| Configuration | Put it | Why |
|---|---|---|
| Keys, relationships, lengths, precision, indexes | an `IEntityTypeConfiguration<T>` class per entity | one file per entity, discovered from the assembly, no thousand-line context |
| Anything the model needs to be correct | fluent configuration, not attributes | attributes drag persistence concerns into the domain and cannot express most of it |
| A convention for every entity (decimal precision, string default, `DateTime` kind) | a configuration convention on the model builder | one rule instead of N repetitions |
| Query filters (soft delete, tenant) | global query filter on the entity | impossible to forget; remember it applies to every query |
| Seed reference data | migration data insert, or an explicit seeding step | model-level seed data becomes migration churn |
| A view or a function-backed read model | keyless entity mapped to the view | the view is the contract |

### Query shape by cost

| You need | Do | Never |
|---|---|---|
| A DTO or a few columns | project into the DTO **inside** the query | load the entity then map |
| A read that will not be modified | no-tracking read | track it and rely on the context being short-lived |
| A parent with one collection | include, or project the collection into the DTO | loop the parents and query per parent |
| A parent with several collections | split query, or project | one include of three collections: rows multiply |
| Existence | an `any` predicate | count and compare, or fetch and check the list |
| A count | count in the query | materialize then count in memory |
| A page | order, then skip and take, on a stable, unique ordering | page an unordered query |
| An update of many rows by predicate | the bulk update API, or raw SQL | load them all and save |
| A query EF cannot translate | project the translatable part, then compute in memory **deliberately** | leave it to fall back silently |

Lazy loading is off in this estate and should stay off: it turns every property access into a query
and produces N+1 that is invisible in the code.

### Migration decision tree

```
Is the migration already applied anywhere shared (a colleague's DB, an environment)?
  no  -> `dotnet ef migrations remove`, fix the model, add it again
  yes -> NEVER remove. Add a new corrective migration on top.

Does the change drop or rename a column or a table?
  -> read the generated Up(): a rename usually generates DROP + ADD, which loses data.
     Rewrite it as a rename operation, or add + copy + drop across two deployments.

Is the target a shared or production database?
  -> do not run `database update`. Generate an idempotent script, review it, hand it to the pipeline.

Do several DbContexts live in the solution?
  -> every command needs `--context`, and each context has its own migrations folder.
```

## Do

```powershell
dotnet tool restore                     # first, if dotnet-ef is pinned in a tool manifest
dotnet ef --version                     # proves the tool resolves at all

# Add / review / apply: the seven-step procedure in references/migrations.md — not ad hoc.
dotnet ef migrations list                # what exists, and which are applied
dotnet ef migrations has-pending-model-changes   # is there anything to migrate at all
dotnet ef dbcontext info                 # which provider and connection string is really resolved
dotnet ef dbcontext optimize             # precompiled model, for a large model's startup cost
dotnet ef dbcontext scaffold "<conn>" <Provider> --output-dir Models --context <Ctx>   # DB-first

# Design-time factories often rewrite the connection string from the environment.
# Supply the context's own key for the invocation when a command fails on a null connection string:
$env:ConnectionStrings__<Ctx>Database = 'Data Source=.;Initial Catalog=<Db>;Trusted_Connection=True;Encrypt=False'
Get-ChildItem Env: | Where-Object Name -match 'ConnectionStrings__'   # what is overriding you
```

`--project` holds the `DbContext`, `--startup-project` holds the host that builds configuration. Where
a design-time factory exists in the data project, both are that same project.

## Traps

1. `Value cannot be null. (Parameter 'input')` from any `dotnet ef` command → a design-time factory
   rewrites the connection string from an environment variable with no null guard → set that context's
   `ConnectionStrings__<Ctx>` for the invocation, or clear the offending variable; the real fix is a
   null guard in the factory.
2. `Unable to create a DbContext` → no design-time factory and the startup project cannot be built or
   configured → add a design-time factory, or point `--startup-project` at the real host.
3. A rename generated as drop-then-add → the column's data is gone on deploy → rewrite it as a rename
   operation in the generated `Up`, and check `Down` too.
4. A migration applied to the wrong database → `database update` used whatever the factory resolved →
   run `dotnet ef dbcontext info` first, every time; it prints the connection it will use.
5. A migration removed after being applied elsewhere → that database now has a history row for a
   migration that no longer exists, and nothing works → never remove an applied migration; correct it
   with a new one.
6. `The model backing the context has changed` → someone edited the snapshot, or a migration was
   committed without its snapshot change → regenerate, never hand-fix the snapshot.
7. A query works locally and throws on translation in production → an untranslatable expression was
   evaluated client-side by a provider that once tolerated it → check the provider and the emitted SQL.
8. A list endpoint slows down as data grows → N+1 from a loop, a lazy-loaded property, or a mapping
   library touching navigations → read the SQL log and count the statements.
9. One `include` of several collections returns far too many rows → cartesian explosion → split query,
   or project.
10. `Sequence contains no elements`, or a change saved twice → the same `DbContext` used concurrently
    or across messages → it is not thread-safe: create one per handler call from the context
    factory (`dotnet-backend`).
11. An in-memory-provider test passes and the real database rejects the query → that provider is not
    relational → test against the real engine (`dotnet-testing`, `untested-legacy.md`).
12. Ordering, casing or paging results differ between environments → collation, or a non-deterministic
    order → order by a unique column, and check the provider differences (`providers.md`).

Where a repository keeps its own data playbook, follow it wherever it disagrees with the above.

## References

- `modelling.md` — entity and relationship configuration, keys, owned types, converters, concurrency
  tokens, conventions, inheritance, and keyless read models.
- `querying.md` — the cost model in detail, N+1 shapes, tracking, split queries, projections,
  client-side evaluation, bulk operations, and how to see the SQL EF really emits.
- `migrations.md` — the full workflow with guardrails: reviewing the script, never dropping, repairing
  an applied migration, multiple contexts, design-time factories, and the pipeline hand-off.
- `providers.md` — SQL Server versus Npgsql differences that actually bite, and when to drop to raw
  SQL or Dapper alongside EF.
