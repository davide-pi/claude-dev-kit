# Data and messaging — a wrong or slow query, a message that never arrives

Two symptom classes that look like application bugs and almost never are.

## Part 1 — the query

### Get the statement the application really sends

Never analyse the query as written in the repository method. Capture it:

| Source | How | Note |
|--------|-----|------|
| EF Core | log category `Microsoft.EntityFrameworkCore.Database.Command` at Information | Shows SQL plus parameter values; enable `EnableSensitiveDataLogging` only in development |
| Any client | `sqlcmd -S <server> -d <db> -E -Q "SELECT TOP 20 qt.text, qs.execution_count, qs.total_logical_reads, qs.total_elapsed_time FROM sys.dm_exec_query_stats qs CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) qt ORDER BY qs.total_logical_reads DESC"` | The expensive statements, whoever sent them |
| Live blocking | `sqlcmd -S <server> -E -Q "SELECT session_id, blocking_session_id, wait_type, wait_time, last_wait_type FROM sys.dm_exec_requests WHERE blocking_session_id <> 0"` | A "slow query" that is really a lock wait |

### Measure it, then look at the plan

```powershell
sqlcmd -S <server> -d <db> -E -Q "SET STATISTICS IO, TIME ON; <query>"
sqlcmd -S <server> -d <db> -E -Q "SET SHOWPLAN_XML ON; GO; <query>" -o plan.xml   # estimated plan, no execution
```

Read in this order:

1. **Logical reads per table** — the real cost. A table with reads far above its row count is being
   scanned or read repeatedly.
2. **Rows: estimated against actual** — an order-of-magnitude gap means stale statistics or a
   non-sargable predicate; the whole plan downstream is built on that wrong number.
3. **Operators** — clustered index scan on a large table where a seek was expected, a key lookup in
   a loop, a hash spill to disk, a missing-index hint.
4. **Elapsed against CPU time** — elapsed far above CPU means waiting: locks, IO, or the network.

### Cause to fix

| Evidence | Cause | Fix direction |
|----------|-------|---------------|
| Reads proportional to loop iterations | N+1 from lazy loading or a per-item call | Project once, `Include` deliberately, or split the query (`ef-core`) |
| Scan where a seek was expected | Predicate not sargable: a function on the column, a leading wildcard, an implicit type conversion | Fix the predicate first; add an index only after |
| Actual rows far above estimated | Stale statistics, or a parameter-sensitive plan | Update statistics; consider recompile or a plan guide, and confirm the shape changes |
| Wrong rows, right SQL | Filter applied client-side, or a translation the provider silently evaluates in memory | Read the generated SQL, not the LINQ; watch for a warning in the EF log |
| Deadlock reports | Two paths taking the same rows in a different order | One consistent access order; shorten the transaction |
| Elapsed high, CPU low, blocking session present | A long transaction holding locks | Shorten the unit of work; never hold a transaction across a remote call |

Index design, deadlock graphs and T-SQL specifics live in `sql-server`; Postgres differences and
`EXPLAIN (ANALYZE, BUFFERS)` live in `postgres`. Neither `psql` nor `redis-cli` is installed on this
machine — run them through a container (`docker-dev-env`).

## Part 2 — the message

### Triage in the order that eliminates the most

```powershell
docker exec <broker> rabbitmqctl list_queues name messages messages_unacknowledged consumers
docker exec <broker> rabbitmqctl list_exchanges name type
docker exec <broker> rabbitmqctl list_bindings source_name routing_key destination_name
docker compose logs --since 15m --tail 200 <consumer-service>
```

| Reading | Verdict | Next step |
|---------|---------|-----------|
| Queue does not exist | The consumer never declared it, or the name drifted between producer and consumer | Compare the declared names on both sides |
| Queue exists, `messages` = 0, nothing consumed | It was never published, or the routing key matches no binding | Check the publish call and `list_bindings`; a topic pattern that matches nothing fails silently |
| `messages` rising, `consumers` = 0 | No consumer is attached: the service is down, crashed at startup, or connected to another virtual host | Consumer logs at startup, and its connection settings |
| `messages_unacknowledged` high and stuck | A consumer took the message and never acked: it is blocked, or the handler throws before acking | The handler stack — usually a downstream call with no timeout |
| The dead-letter queue is filling | The handler rejects without requeue, or the retry budget is exhausted | Read one dead-lettered message: headers carry the reason and the death count |
| The same message handled twice | At-least-once delivery meeting a non-idempotent handler; or an ack lost on a redelivery | Deduplicate on a message id, make the write idempotent (`rabbitmq`) |
| Consumer stops after a while, no error | Prefetch filled with unacked messages, or the connection was closed by a heartbeat timeout | Bound the prefetch; log connection lifecycle events |

### Reading a dead-lettered message without draining the queue

Use the broker management API through the container rather than a consumer, so nothing is lost:
the `get` endpoint on a queue with `ackmode=reject_requeue_true` returns the payload and headers
and puts the message back. Then look at the death headers: reason (rejected, expired, maxlen), the
original exchange and routing key, and how many times it has died.

### Rules that prevent this class of bug

1. Every consumer is idempotent — a handler that cannot run twice is a bug, not a configuration.
2. Every queue has a dead-letter target, and its depth is a monitored signal, not a surprise.
3. Every handler has a bounded timeout on downstream calls, or one slow dependency stalls the queue.
4. Poison messages are dead-lettered after a fixed count, never retried in an endless loop.
5. Producer and consumer share the topology definition, so a renamed queue fails loudly at startup.
