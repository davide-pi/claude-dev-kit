# review-performance — rare branches

Rare branches of `review-performance`: which generated files are skipped, and effort above `medium`.

## Generated files

The pathspec in `SKILL.md` § Do already drops them; a migration `.cs` is hand-kept and always read.

## Effort

| Effort | Steps |
| --- | --- |
| `high` | + changed calls one hop out, schema and indexes of touched tables, how the caller sizes the input |
| `xhigh` | + retries and timeouts, batch sizes, worst-case cardinality, concurrency, 100× today's data |
| `max` | + falsify each candidate (bounded input, framework batching, existing index); quantify the survivors |
