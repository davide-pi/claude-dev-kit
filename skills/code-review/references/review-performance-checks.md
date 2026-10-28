# review-performance — rare branches

Rare branches of `review-performance`: which generated files are skipped, and effort above `medium`.

## Input (files to skip)

Generated files to skip: `*.g.cs`, `*ModelSnapshot.cs`, `*.Designer.cs`, `__snapshots__/`, `dist/`, `*.min.*`, lockfiles — never the migration `.cs` itself.

## Effort

| Effort | Steps |
| --- | --- |
| `high` | + changed calls one hop out, schema and indexes of touched tables, how the caller sizes the input |
| `xhigh` | + retries and timeouts, batch sizes, worst-case cardinality, concurrency, 100× today's data |
| `max` | + falsify each candidate (bounded input, framework batching, existing index); quantify the survivors |
