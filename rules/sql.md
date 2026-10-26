---
paths: "**/*.sql"
---
# SQL — house facts

- SARGable predicates: no function or cast around a filtered column (`CONVERT_IMPLICIT`,
  `lower(col)`, `col::text`) — rewrite before indexing.
- No `SELECT *` in code or views; name the columns.
- Exploratory reads carry `TOP`/`LIMIT`.
- Before proposing an index: `SET STATISTICS IO ON` (or `EXPLAIN (ANALYZE, BUFFERS)`) and the plan
  read; the index is a recommendation with its DDL, never run on a shared host.
- A T-SQL script that writes (DML, DDL) declares `DECLARE @DryRun bit = 1;` at the top and runs in one
  `BEGIN TRANSACTION`: with `@DryRun = 1` it shows before/after and ends in `ROLLBACK`, only `@DryRun = 0`
  reaches `COMMIT`. `SET XACT_ABORT ON`. A read-only script has none of this.
- Non-dev hosts only through the read-only route (`/db`); raw clients are denied there.
- WIQL is not SQL but lives here too: `[System.TeamProject] = '<project>'` in every `WHERE`.

Procedure: skill `sql-server`.
