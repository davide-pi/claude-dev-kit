# The query cost model, and seeing what EF really emits

## See the SQL first

Every question here is answered faster by reading the SQL than by reasoning about the LINQ.

| Want | Do |
|---|---|
| One query's SQL, right now, no run | the query-string method on the queryable |
| Every query a request emits | the database-command log category at Information |
| Parameter **values** too | sensitive-data logging — **development only**, it writes real data into logs |
| Which code produced this SQL in the database | tag the query: the tag appears as a comment in the SQL, findable from a slow-query report or plan cache |

For the server side — plans, waits, index usage — go to `sql-server`.

## N+1, in the four shapes it takes

| Shape | Fix |
|---|---|
| The loop: parents iterated, children queried inside | one query with an include, or a projection |
| The lazy navigation inside a loop or a mapper | keep lazy loading off; load or project explicitly |
| A mapping library walking navigations that are not loaded | project into the DTO in the query |
| The per-item await in a fan-out | one set-based query with a `contains` over the ids |

Detection is mechanical: turn on command logging, exercise the endpoint once, count the statements.
The opposite over-correction (an include chain "so it is there") pulls entire graphs for a screen that
shows three fields.

## Tracking

| Read | Tracking |
|---|---|
| A list, a report, a lookup, anything projected to a DTO | no tracking |
| An entity you are about to modify and save | tracked |
| A large read where duplicate references should be unified | no tracking with identity resolution |

No-tracking as the context-wide default is defensible for a read-heavy service, but then every write
path must opt back in: decide once per context and document it.

## Split versus single query

| Situation | Choose |
|---|---|
| One collection include, or only reference includes | single query (the default) |
| Two or more collection includes | split query, or project |
| A collection include plus paging | **project** — paging over a joined collection pages the joined rows, not the parents |
| A high-latency link to the database | single query, accepting the width |

Split query costs extra round trips and loses consistency between them outside a transaction; know the
trade before enabling it globally.

## Project instead of loading

`select` into a DTO inside the query: only those columns are read, nothing is tracked. Rules:

- project into a flat DTO or anonymous type; a constructor with logic is untranslatable;
- project collections as sub-selects into DTOs;
- no method of your own inside the projection (throws or drags evaluation client-side);
- filter and order **before** projecting, on indexed columns.

## Client-side evaluation traps

Everything before materialization is SQL; everything after is memory. Traps: a local method or custom
extension (translation exception); a `where` after a mid-chain to-list (the filter runs in memory over
everything fetched); an in-memory collection joined to the query (the whole table may be read first);
a string or date function with no mapping for this provider (a translation exception, or a different
result than expected).
When in-memory work is genuinely needed, make the boundary explicit: materialize the minimum
projection, then compute.

## Bulk operations

Use the bulk update and delete APIs (a single statement) instead of loading rows to change one column.
They bypass the change tracker (tracked entities go stale) and run outside `SaveChanges`' implicit
transaction: open an explicit transaction when atomic with other writes.

## Paging

Order by something unique and stable, then skip and take; an unordered page returns duplicates or
omissions. Deep paging: keyset ("key greater than the last seen"). Count and page are two queries;
do not compute the total by materializing the list.

## Transactions and the unit of work

One `SaveChanges` is already atomic. An explicit transaction is needed only to span several
`SaveChanges`, a bulk operation, or raw SQL; its boundary belongs to the use case (the handler owning
the unit of work), not to each repository method. Never hold a transaction across an outbound HTTP call
or a broker publish: that is how locks wait on a network timeout and how the deadlocks in `sql-server`
happen.

## When to leave EF

| Situation | Reach for |
|---|---|
| A read whose shape fights the model, or a hand-tuned statement | raw SQL against the context, or Dapper — one solution here already pairs them |
| A set-based operation over many rows | the bulk APIs, or raw SQL |
| A stored procedure, a view, a table-valued function | map it, or call it directly |
| Recursive or window-function work | raw SQL |

Non-negotiable: parameterize everything. Use the interpolated-SQL helpers (the interpolation becomes
parameters); the raw non-interpolated overload with a built string is an injection.
