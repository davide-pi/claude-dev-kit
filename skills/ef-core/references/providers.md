# SQL Server and Npgsql: the differences that bite

SQL Server is the norm across this estate; the Npgsql provider appears as a secondary or alternative
provider. Code that must run on both cannot rely on the provider's defaults. The list below is what
actually causes bugs, not a feature comparison.

## Identifiers and casing

| | SQL Server | Postgres |
|---|---|---|
| Unquoted identifier | case-insensitive | folded to lower case |
| The provider's generated SQL | as configured | quoted, so `Orders` and `orders` are different tables |
| Practical rule | any convention works | pick one naming convention (snake case is the least surprising) and apply it as a model convention |

A model that works on SQL Server and fails on Postgres with "relation does not exist" is almost always
this. Decide the naming convention at the model level, once, not per entity.

## String comparison and collation

This is the most dangerous difference, because it changes **results** rather than throwing.

- SQL Server databases here are typically case-insensitive by collation, so an equality comparison
  matches regardless of case and a unique index treats two casings as one value.
- Postgres compares strings case-sensitively by default.

So a login lookup, a code lookup or a uniqueness rule that is correct on SQL Server silently
misbehaves on Postgres. Do not paper over it with a lower-case function on both sides: that is
untranslatable to an index and turns a seek into a scan. Normalize on write — store a canonical
lower-case column and compare against that — or set the column's collation explicitly in the model.

Sorting differs too, for accents, punctuation and digits. An ordered page can differ between the two
engines even with the same data.

## Dates and times

| | SQL Server | Postgres |
|---|---|---|
| A timestamp with an offset | maps to a datetime-with-offset type | maps to a timestamptz, which normalizes to UTC |
| A plain timestamp | no time zone semantics at all | timestamp without time zone; the provider is strict about the kind |
| The classic failure | none | a local-kind value written to a timestamptz column throws |

Rule that works on both: store UTC, always; use date-only and time-only types where the value is not
an instant; never let a local-kind timestamp reach the database. Set the kind explicitly with a
convention rather than trusting whatever produced the value.

## Keys and generated values

SQL Server uses identity columns; Postgres uses identity or sequences with different semantics around
batching and gaps. Two practical consequences: a sequence-backed key may be allocated in blocks, so
gaps are normal and must not be treated as missing rows; and sequential-GUID strategies that reduce
index fragmentation on SQL Server do not have the same effect elsewhere.

If a key value must be known before insert, generate it in the application (a sequential GUID) rather
than relying on database generation — it is the only approach that behaves identically on both.

## Types worth pinning explicitly

| Concept | Pin it because |
|---|---|
| Money and decimals | precision and scale defaults differ, and rounding differs with them |
| Booleans | a bit column and a real boolean behave differently in raw SQL |
| Large text and binary | the type names and length semantics have nothing in common |
| GUIDs | stored and sorted differently; index behaviour differs |
| JSON | both support it, with entirely different query surfaces (see below) |
| Arrays | Postgres has real arrays; SQL Server does not — an array column is not portable |

## JSON

Both providers can map a JSON column, and both can query into it — with provider-specific operators.
A query that filters inside JSON is therefore not portable, and on either engine it usually cannot use
an index unless one is created specifically for that path.

Rule: JSON is for data you store and read whole. The moment you filter or join on a value inside it,
promote that value to a real column. Postgres-specific JSONB work belongs to `postgres`.

## Raw SQL and functions

Every hand-written statement is provider-specific: paging syntax, string concatenation, date
arithmetic, upsert (merge versus on-conflict), and the availability of every function. A solution that
supports both providers cannot share raw SQL — isolate it behind an interface with one implementation
per provider, and keep the count of such statements deliberately low.

The same applies to migrations: a migration containing raw SQL only runs on the provider it was
written for. Two providers means two migration assemblies, which is a real cost to weigh before
promising portability.

## Concurrency tokens

SQL Server has a row-version column that the provider maintains automatically. Postgres has a system
column serving the same purpose, configured differently. The model configuration differs, so a shared
model needs a provider check when it is built (`modelling.md`).

## Errors

A unique-constraint violation, a foreign-key violation and a deadlock all surface as different
exception types with different codes per provider. Never match on the exception message — it is
localized and it changes. Match on the provider's error number, in one place, and map it to a domain
result there (`dotnet-backend`, `errors-and-config.md`).

## Connections and pooling

Both pool connections, and both fail the same way when a context or a connection is not disposed:
requests queue waiting for the pool, latency climbs, and the symptom looks like a slow database. The
pool size and timeout are connection-string settings; the fix is almost never raising them.

## Supporting both providers deliberately

If a solution genuinely must run on both:

- keep provider-specific configuration behind a check on the active provider, in the model
  configuration, not scattered;
- one migrations assembly per provider;
- no raw SQL in shared code;
- run the test suite against **both** engines in containers, or the second provider is unverified
  (`dotnet-testing`, `real-database.md`);
- decide whether it is worth it. Two verified providers is a permanent tax on every data change.

## Tooling on this machine

`sqlcmd` is installed, so SQL Server is directly reachable from the shell. `psql` is **not**, and
neither is `jq` — run the Postgres client inside a container instead:

```powershell
docker exec -it <container> psql -U <user> -d <db> -c "\d+ <table>"
sqlcmd -S <server> -d <db> -Q "SELECT TOP 10 * FROM <table>"
```

Container recipes for both engines belong to `docker-dev-env`.
