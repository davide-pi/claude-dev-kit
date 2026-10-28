# SQL Server and Npgsql: the differences that bite

SQL Server is the norm across this estate; the Npgsql provider appears as a secondary or alternative
provider. Code that must run on both cannot rely on the provider's defaults.

## Identifiers and casing

Postgres folds unquoted identifiers to lower case and the provider's generated SQL is quoted, so
`Orders` and `orders` are different tables. "relation does not exist" on Postgres is almost always
this: pick one naming convention (snake case is the least surprising) and apply it as a model-level
convention, once.

## String comparison and collation

The most dangerous difference, because it changes **results** rather than throwing. SQL Server
databases here are typically case-insensitive by collation; Postgres compares case-sensitively. A login
lookup, a code lookup or a uniqueness rule correct on SQL Server silently misbehaves on Postgres. Do
not paper over it with a lower-case function on both sides (untranslatable to an index, a seek becomes
a scan): normalize on write into a canonical lower-case column, or set the collation explicitly.
Sorting differs too (accents, punctuation, digits), so an ordered page can differ between engines.

## Dates and times

A local-kind value written to a Postgres `timestamptz` column throws. Rule that works on both: store
UTC, always; date-only and time-only types where the value is not an instant; set the kind explicitly
with a convention.

## Keys and generated values

A sequence-backed key may be allocated in blocks, so gaps are normal. If a key must be known before
insert, generate it in the application (a sequential GUID): the only approach that behaves identically
on both.

## Types worth pinning explicitly

Money and decimals (precision and scale defaults differ), booleans, large text and binary, GUIDs, JSON.
Arrays: Postgres has real arrays, SQL Server does not — an array column is not portable.

JSON is for data stored and read whole; a query filtering inside it is provider-specific and usually
unindexed. The moment you filter or join on a value inside it, promote it to a real column. Postgres
porting and Npgsql specifics live in `sql-server`.

## Raw SQL, migrations, concurrency, errors

- Every hand-written statement is provider-specific (paging, concatenation, date arithmetic, upsert,
  functions). A solution supporting both cannot share raw SQL: isolate it behind an interface with one
  implementation per provider. A migration with raw SQL runs only on its provider, so two providers
  means two migration assemblies.
- Concurrency tokens are configured differently (SQL Server row-version column; Postgres system
  column), so a shared model needs a provider check when built (`modelling.md`).
- Unique-constraint, foreign-key and deadlock errors have different codes per provider. Never match on
  the message (localized, unstable): match the provider's error number in one place and map it to a
  domain result (`dotnet-backend`, `errors-and-config.md`).
- Pool exhaustion from an undisposed context looks like a slow database; the fix is almost never
  raising the pool size.

## Supporting both providers deliberately

- provider-specific configuration behind a check on the active provider, in the model configuration;
- one migrations assembly per provider; no raw SQL in shared code;
- run the test suite against **both** engines in containers, or the second provider is unverified
  (`dotnet-testing`, `untested-legacy.md`);
- decide whether it is worth it: two verified providers is a permanent tax on every data change.

## Tooling on this machine

`sqlcmd` is installed, so SQL Server is directly reachable from the shell. `psql` is **not**, and
neither is `jq` — run the Postgres client inside a container instead:

```powershell
docker exec -it <container> psql -U <user> -d <db> -c "\d+ <table>"
sqlcmd -S <server> -d <db> -Q "SELECT TOP 10 * FROM <table>"
```

Container recipes for both engines belong to `docker-dev-env`.
