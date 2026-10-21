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
- Non-dev hosts only through the read-only route (`/db`); raw clients are denied there.
- WIQL is not SQL but lives here too: `[System.TeamProject] = '<project>'` in every `WHERE`.

Procedure: skill `sql-server`.
