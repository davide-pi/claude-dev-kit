# The query cost model, and seeing what EF really emits

## See the SQL first

Every question in this file is answered faster by reading the SQL than by reasoning about the LINQ.
Four ways, cheapest first:

| Want | Do |
|---|---|
| One query's SQL, right now, no run | call the query-string method on the queryable and log or inspect it |
| Every query a request emits | enable the database-command log category at Information; each command is logged with its parameters' shapes |
| Parameter **values** too | enable sensitive-data logging — **development only**, it writes real data into logs |
| Which query in the app produced this SQL in the database | tag the query, so the tag appears as a comment in the SQL |

Query tags are the underrated one: a tagged query is findable from a slow-query report or an
execution-plan cache, which closes the loop between "the database says this statement is slow" and
"this is the code that wrote it".

For the server side of the same question — plans, waits, index usage — go to `sql-server`.

## N+1, in the four shapes it actually takes

| Shape | How it looks in code | Fix |
|---|---|---|
| The loop | iterate parents, query children inside the loop | one query with an include, or a projection |
| The lazy navigation | a property access inside a loop or a mapper | keep lazy loading off; load or project explicitly |
| The mapper | a mapping library walking navigations that are not loaded | project into the DTO in the query |
| The per-item await | an async call per item in a fan-out | one set-based query with a `contains` over the ids |

Detection is mechanical: turn on command logging, exercise the endpoint once, count the statements. A
list endpoint that emits one statement per row is the diagnosis; no profiling needed.

Beware the opposite over-correction: an include chain loaded "so it is there" pulls entire graphs for
a screen that shows three fields. Both extremes are the same mistake — not deciding what the query
needs.

## Tracking

The change tracker exists so `SaveChanges` knows what changed. A read that will never be saved pays
for it in memory, in identity-resolution work per row, and in the risk that a stale tracked entity is
reused later in the same scope.

| Read | Tracking |
|---|---|
| A list, a report, a lookup, anything projected to a DTO | no tracking |
| An entity you are about to modify and save | tracked |
| A large read where duplicate references should be unified | no tracking with identity resolution |

Projecting into a DTO is not tracked anyway, so a projection plus no-tracking is redundant but
harmless. Setting no-tracking as the context-wide default is defensible for a read-heavy service, but
then every write path must opt back in explicitly — decide once, per context, and document it.

## Split versus single query

One include is a join. Several collection includes multiply the rows: parents times children times
grandchildren, with the parent columns repeated in every row. That is the cartesian explosion, and it
shows up as a query that returns tens of thousands of rows for ten entities.

| Situation | Choose |
|---|---|
| One collection include, or only reference includes | single query (the default) |
| Two or more collection includes | split query, or project |
| A collection include plus paging | **project** — paging over a joined collection pages the joined rows, not the parents |
| A high-latency link to the database | single query, and accept the width, since split means several round trips |

Split query costs extra round trips and loses transactional consistency between them unless you are
inside a transaction. Know that trade before enabling it globally.

## Project instead of loading

The single highest-value habit: `select` into a DTO inside the query. The provider then reads only
those columns, no entity is materialized, nothing is tracked, and the navigations you project are
joined once rather than included as a graph.

Rules that keep projections working:

- project into a flat DTO or an anonymous type; a constructor with logic inside it is untranslatable;
- project collections as sub-selects into DTOs — that is the correct way to get a parent plus its
  children in one shaped result;
- do not call a method of your own inside the projection. Any method the provider cannot translate
  either throws or drags the evaluation client-side;
- filter and order **before** projecting, on indexed columns.

## Client-side evaluation traps

The provider translates what it recognizes and refuses the rest. What refusal looks like:

| Cause | Symptom |
|---|---|
| A local method, a custom extension, or a constructor with logic | a translation exception naming the expression |
| A string or date function without a mapping for this provider | translation exception, or a different result than expected |
| An enumerable operation over an in-memory collection joined to the query | works, but the whole table may be read first |
| `where` after a call that materializes (a to-list in the middle of a chain) | the filter runs in memory over everything fetched |
| A null-propagating expression the provider cannot express | translation exception |

The rule: know where the query ends. Everything before materialization is SQL; everything after is
memory. When you genuinely need in-memory work, make the boundary explicit — materialize the minimum
projection, then compute — rather than letting a fallback decide for you.

## Bulk operations

Loading ten thousand rows to change one column is a round trip, ten thousand tracked entities, and one
enormous `SaveChanges`. Use the bulk update and delete APIs, which emit a single statement — with two
consequences to accept: they bypass the change tracker (tracked entities become stale) and they run
outside `SaveChanges`, so they are not part of its implicit transaction. Open an explicit transaction
when a bulk operation must be atomic with other writes.

For large inserts, the batching of `SaveChanges` is usually enough; a genuine bulk-copy path is a raw
SQL or provider-specific concern.

## Paging

Order by something unique and stable, then skip and take. An unordered page is undefined and will
return duplicates or omissions across pages. For deep paging, keyset paging — "where key greater than
the last seen key" — stays fast where skip degrades linearly.

Count and page in the same request means two queries; that is normal and correct. Do not compute the
total by materializing the list.

## Transactions and the unit of work

One `SaveChanges` is already atomic. An explicit transaction is needed only to span several
`SaveChanges` calls, a bulk operation, or raw SQL. Do not open a transaction per repository method:
the transaction boundary belongs to the use case (`dotnet-backend`, `architecture.md`).

Never hold a transaction across an outbound HTTP call or a broker publish. That is how a database
lock ends up waiting on a network timeout, and how you get the deadlocks in `sql-server`.

## When to leave EF

| Situation | Reach for |
|---|---|
| A read whose shape fights the model, or a hand-tuned statement | raw SQL against the context, or Dapper — one solution here already pairs them |
| A set-based operation over many rows | the bulk APIs, or raw SQL |
| A stored procedure, a view, a table-valued function | map it, or call it directly |
| Recursive or window-function work | raw SQL; the provider will not translate it |

Dropping to SQL is a legitimate engineering choice, not a defeat. The one non-negotiable: parameterize
everything. String-concatenated SQL is an injection, and the interpolated-SQL helpers exist precisely
so the interpolation becomes parameters — using the raw, non-interpolated overload with a built string
does not.
