# Database tests against a real engine

## Why the in-memory provider lies

The EF in-memory provider is not a database. It is a dictionary with LINQ over it, and the LINQ runs
in the .NET process rather than being translated to SQL. Everything below is a real failure it will
happily let through:

| The in-memory provider | A real database |
|---|---|
| Ignores relational constraints — no unique index, no foreign key, no check | rejects the row |
| Ignores column length, precision and non-nullability | truncates or rejects |
| Executes any expression client-side, so an untranslatable query passes | throws, or silently pulls the whole table |
| Has no concept of a raw SQL fragment, a view, a function or a stored procedure | runs them |
| String comparison follows .NET ordinal rules | follows the column collation, so case sensitivity differs |
| Sorts and compares dates, decimals and text with .NET semantics | uses engine semantics — different results |
| Has no transaction isolation and no deadlocks | has both |
| Never runs your migrations | the schema is exactly what the migrations built |
| Identity, sequence and default values are fake | are the engine's |

The consequence is worse than "less coverage": tests that pass against a query the production
provider cannot translate, and a green suite in front of a broken feature. The provider is
documented as a fake for code that does not care about the database — which describes almost no
repository. Use a real engine.

The SQLite-in-memory middle ground is relational and catches translation and constraint problems, but
its types, functions and collations differ from SQL Server enough to produce its own false results.
It is acceptable only when a container is genuinely impossible.

## Testcontainers

Testcontainers starts a real engine in Docker, per test run, and disposes it. Docker is present on
this machine, which makes this the default.

Shape:

1. A fixture that starts the container once for the whole collection, exposes its connection string,
   and stops it on dispose. **Never** per test.
2. On start: apply the migrations against the container, so the schema under test is the real one and
   a broken migration fails the suite. Do not use the "ensure created" shortcut — it bypasses
   migrations and hides exactly the bugs you want.
3. Per test: reset the data (below), then arrange through the context or through the API.
4. Each test resolves its own scope and its own context. Sharing a context across tests shares a
   change tracker, and stale tracked entities produce results that make no sense.

Provider notes:
- SQL Server is the norm here; the container image needs a couple of gigabytes of memory and takes
  the longest to become healthy, so wait on the readiness check rather than a delay.
- Postgres appears as the secondary provider. Its container starts in seconds, which makes it
  tempting to test against it — do not, unless production runs it. Provider differences are real;
  see `ef-core`, `providers.md`.
- Note that `psql` and `redis-cli` are **not** installed on this machine. Run a client inside the
  container (`docker exec`) when you need to inspect a test database by hand.

```powershell
docker ps                       # first check when a database test suddenly fails
docker exec -it <container> psql -U <user> -d <db>          # a Postgres shell, without psql locally
sqlcmd -S localhost,<port> -U sa -P "<pwd>" -Q "SELECT name FROM sys.tables"   # SQL Server is local
```

## Resetting state between tests

Ranked by speed and reliability:

| Strategy | Cost | Caveat |
|---|---|---|
| A transaction per test, rolled back at the end | cheapest | breaks any test whose code manages its own transaction, or uses a second connection |
| A reset library that truncates the tables | fast, reliable | must be told which tables to keep (migration history, lookup data) |
| Recreate the schema per test | very slow | only for a handful of tests |
| A unique tenant or key prefix per test | fast, no reset at all | only works if every query filters by it |

Whatever you choose, do not rely on tests cleaning up after themselves: one failing test then poisons
every test after it, and the real failure is buried under twenty unrelated ones.

## Seeding

Reference data (lookup tables, currencies, statuses) is seeded once with the schema. Test-specific
data is created by the test, through builders, so the test reads as its own precondition. A shared
"seed everything" step is a hidden dependency: a test starts passing because of data another test
needed, and you cannot tell which.

## What to test here

- Every non-trivial query: does it translate, does it return the right rows, does it hit the index.
- Every projection whose shape a client depends on.
- Constraints and concurrency tokens: assert the violation actually throws.
- Every migration, implicitly, by applying them all on start.
- Raw SQL, views, functions and stored procedures — untestable any other way.
- The Dapper side, where one solution uses Dapper next to EF: hand-written SQL has no compiler.

## What not to test here

Business rules that happen to live behind a repository. Move the rule out of the query, unit-test it,
and let the database test cover the query only. A suite that drives business logic through the
database is slow, and its failures do not point at the cause.

## When a database test fails on the agent but not locally

Check, in order: Docker availability and memory on the agent; collation and case sensitivity, since a
container's default may differ from the local server; time zone, for anything comparing dates; and
migrations, because the agent applied all of them to an empty database while your local database has
accumulated hand edits. That last one is a finding, not an inconvenience — the agent is right.
