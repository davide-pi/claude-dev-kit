# Execution plans, statistics and parameter sniffing

## Getting a plan

| Want                                  | How                                                                |
| ------------------------------------- | ------------------------------------------------------------------ |
| Estimated plan, nothing executed      | `SET SHOWPLAN_XML ON` (then the batch, un-executed)                 |
| Actual plan with real row counts      | `SET STATISTICS XML ON` before the query                            |
| Reads and CPU per statement           | `SET STATISTICS IO, TIME ON`                                        |
| The plan the app is really using      | `sys.dm_exec_query_plan` joined to `sys.dm_exec_requests` (live) or `sys.dm_exec_query_stats` (cached) |
| Plans over time, before and after     | Query Store: `sys.query_store_query_text`, `sys.query_store_plan`, `sys.query_store_runtime_stats` |
| A plan for a query that never finishes | `sys.dm_exec_query_statistics_xml` for the running session id       |

Save the XML to a file and open it in a plan viewer for anything non-trivial; read it in text only
to check operators and row counts.

## Read it in this order

1. **Actual vs estimated rows**, on every operator. A 10x gap is the root cause more often than the
   operator itself. Work outwards from the deepest operator where the gap first appears.
2. **The fat arrow** — the operator moving the most rows, not the one with the highest cost
   percentage. Cost percentages are estimates, and a wrong estimate is exactly what you are hunting.
3. **Warnings** — implicit conversion, spill to tempdb, no join predicate, excessive grant.
4. **Seek vs scan on the tables you expected to seek.**

## Operators and attributes that signal trouble

| Seen                                            | Usually means                                                      |
| ----------------------------------------------- | ------------------------------------------------------------------ |
| Key Lookup / RID Lookup with many executions    | non-covering index → `INCLUDE` the returned columns                 |
| Clustered Index Scan on a large table + selective filter | missing index, or a non-SARGable predicate                 |
| Index Scan where a Seek was expected            | predicate not SARGable, or the wrong key order                      |
| Sort with a **spill** warning                   | under-estimated rows, or a missing index that could supply the order |
| Hash Match spilling to tempdb                   | under-estimate on the build side                                    |
| Nested Loops with a large outer input           | under-estimate; the optimiser thought it was a handful of rows      |
| Table Spool / Lazy Spool                        | the query re-reads the same set; often a shape problem or a scalar UDF |
| Eager Index Spool                               | the optimiser built a temporary index — create the real one         |
| `CONVERT_IMPLICIT` on a column                  | type mismatch between parameter and column                          |
| Parallelism with `CXPACKET`/`CXCONSUMER` waits  | a plan expensive enough to go parallel; fix the plan, not the DOP    |
| Filter operator high in the plan                | the predicate is applied after the read instead of during it        |
| Compute Scalar feeding a Filter on a UDF        | a per-row function call                                             |
| "No Join Predicate" warning                     | a missing join condition — a cross join by accident                 |

## Statistics

The optimiser guesses row counts from statistics. Wrong statistics produce a wrong plan no index
will fix.

```sql
-- Age and modification counter for every statistic on a table
SELECT s.name, sp.last_updated, sp.rows, sp.rows_sampled, sp.modification_counter
FROM sys.stats s CROSS APPLY sys.dm_db_stats_properties(s.object_id, s.stats_id) sp
WHERE s.object_id = OBJECT_ID('dbo.Orders');
```

```sql
DBCC SHOW_STATISTICS ('dbo.Orders', IX_Orders_CustomerId_CreatedAt);  -- the histogram itself
```

| Symptom                                                  | Fix                                                        |
| -------------------------------------------------------- | ---------------------------------------------------------- |
| `modification_counter` large relative to `rows`          | auto-update has not fired yet → `UPDATE STATISTICS` (a write: announce it) |
| `rows_sampled` far below `rows` on a skewed column       | `UPDATE STATISTICS ... WITH FULLSCAN`                       |
| Ever-increasing key, queries always ask for the newest rows | the histogram has no bucket for them → refresh stats more often, or filter by a bounded range |
| Estimates wrong only after a bulk load                   | update statistics as the last step of the load              |

## Parameter sniffing

The engine compiles the plan for the **first** parameter values it sees and reuses it. When the data
is skewed — one customer with a million rows, the rest with ten — one of the two gets a terrible
plan.

**Diagnosis:** the same procedure is fast for some inputs and slow for others; the cached plan's
compiled parameter values (in the plan XML, `ParameterCompiledValue`) differ from the runtime ones;
clearing the plan for that object makes the slow case fast and eventually breaks the other one.

| Remedy                                                        | Cost                                        | Use when                                       |
| ------------------------------------------------------------- | ------------------------------------------- | ---------------------------------------------- |
| `OPTION (RECOMPILE)` on the statement                         | a compile per execution                     | low call rate, high variance                   |
| `OPTIMIZE FOR (@p = <typical value>)`                         | the atypical case stays slow                | one dominant shape                             |
| `OPTIMIZE FOR UNKNOWN`                                        | average plan for everyone                   | no shape dominates                             |
| Copy parameters into local variables                          | same as UNKNOWN, but implicit and invisible | avoid — it hides the intent                    |
| Split into two procedures by input shape                      | duplicated code                             | two genuinely different shapes                 |
| Force a plan in Query Store (`sp_query_store_force_plan`)     | frozen plan, silently stale after a schema change | an incident, with a follow-up to remove it |

`DBCC FREEPROCCACHE` clears plans server-wide and is not a fix; scoping it to one plan handle is
acceptable during a diagnosis, and it is still a change worth announcing.

## Query Store

When it is enabled (`SELECT actual_state_desc FROM sys.database_query_store_options`), it answers
"what changed" without reproducing anything: which plan a query used yesterday, how many plans it
has, and which regressed. It is the first place to look after "it was fast last week".
