# Locking, blocking and deadlocks

## Blocked or slow?

A blocked request burns wall-clock time and almost no CPU, and sits on a `LCK_M_*` wait. A slow
request burns CPU or does I/O. Establish which before tuning anything.

```sql
-- The blocking chain, root first. blocking_session_id = 0 means this one is the head blocker.
SELECT r.session_id, r.blocking_session_id, r.wait_type, r.wait_time / 1000.0 AS wait_s,
       r.status, r.command, DB_NAME(r.database_id) AS db,
       SUBSTRING(t.text, (r.statement_start_offset / 2) + 1, 300) AS stmt
FROM sys.dm_exec_requests r
     CROSS APPLY sys.dm_exec_sql_text(r.sql_handle) t
WHERE r.session_id <> @@SPID
ORDER BY r.blocking_session_id, r.wait_time DESC;
```

```sql
-- The head blocker may be idle (an open transaction nobody committed) and therefore absent above
SELECT s.session_id, s.login_name, s.host_name, s.program_name, s.status,
       s.last_request_end_time, t.open_transaction_count,
       SUBSTRING(txt.text, 1, 300) AS last_stmt
FROM sys.dm_exec_sessions s
     LEFT JOIN sys.dm_exec_connections c ON c.session_id = s.session_id
     OUTER APPLY sys.dm_exec_sql_text(c.most_recent_sql_handle) txt
     LEFT JOIN (SELECT session_id, COUNT(*) AS open_transaction_count
                FROM sys.dm_tran_session_transactions GROUP BY session_id) t
       ON t.session_id = s.session_id
WHERE t.open_transaction_count > 0;
```

```sql
-- What exactly is locked, and at which granularity (RID/KEY/PAGE/OBJECT)
SELECT l.request_session_id, l.resource_type, l.request_mode, l.request_status,
       OBJECT_NAME(p.object_id) AS tbl, p.index_id
FROM sys.dm_tran_locks l
     LEFT JOIN sys.partitions p ON p.hobt_id = l.resource_associated_entity_id
WHERE l.resource_database_id = DB_ID()
ORDER BY l.request_session_id;
```

Only kill a session when the owner is known and the work is disposable; on a shared database, ask
first. `KILL <spid>` rolls the transaction back, which can take as long as the work it undoes.

## Wait types worth recognising

| Wait                       | Meaning                                                             |
| -------------------------- | ------------------------------------------------------------------- |
| `LCK_M_S`, `LCK_M_X`, `LCK_M_U` | waiting for a shared / exclusive / update lock — real blocking  |
| `LCK_M_RS_*`, `LCK_M_RX_*` | key-range locks — a `SERIALIZABLE` transaction is involved           |
| `PAGEIOLATCH_*`            | reading pages from disk — usually too much data, i.e. a plan problem |
| `WRITELOG`                 | commit-heavy workload, or one transaction per row                    |
| `ASYNC_NETWORK_IO`         | the **client** is not consuming the result set fast enough           |
| `RESOURCE_SEMAPHORE`       | memory-grant starvation, from over-estimated sorts and hashes        |
| `SOS_SCHEDULER_YIELD`      | CPU pressure                                                         |
| `CXPACKET` / `CXCONSUMER`  | parallelism; a symptom of an expensive plan, not a cause             |

`ASYNC_NETWORK_IO` on a query the developer swears is slow is nearly always a client reading row by
row, or a huge result set nobody needed.

## Lock escalation

A statement touching enough rows escalates row and page locks to a **table** lock, and suddenly the
whole table is blocked. Symptoms: an `OBJECT`-granularity lock in `sys.dm_tran_locks` for a
statement that should have touched a few thousand rows.

Fixes, in order: touch fewer rows (batch the update), make the predicate use an index so fewer rows
are locked at all, and only then consider disabling escalation on that table
(`ALTER TABLE ... SET (LOCK_ESCALATION = DISABLE)`) — which trades a table lock for a very large
number of fine-grained locks and their memory.

## Deadlocks

A deadlock is not a bug in the engine: two transactions took the same locks in a different order,
and one is chosen as the victim (error 1205). The client must retry the victim; the code must stop
creating the cycle.

**Get the graph without reproducing anything** — the `system_health` extended event session keeps
recent deadlock reports in a ring buffer:

```sql
SELECT CAST(xed.value('@timestamp', 'datetime2') AS datetime2) AS occurred,
       CAST(xed.query('.') AS xml) AS deadlock_report
FROM (SELECT CAST(target_data AS xml) AS tdx
      FROM sys.dm_xe_session_targets st
           JOIN sys.dm_xe_sessions s ON s.address = st.event_session_address
      WHERE s.name = 'system_health' AND st.target_name = 'ring_buffer') AS rb
     CROSS APPLY tdx.nodes('RingBufferTarget/event[@name="xml_deadlock_report"]') AS x(xed)
ORDER BY occurred DESC;
```

The ring buffer is small and cleared on restart. For history, read the `system_health` event files
with `sys.fn_xe_file_target_read_file('system_health*.xel', NULL, NULL, NULL)`, or enable a
dedicated extended event session for `xml_deadlock_report`.

If trace flag 1222 is enabled, the graph is also in the error log: `EXEC sp_readerrorlog 0, 1,
'deadlock'`.

**Reading the graph:** for each `<process>` note `waitresource`, `lockMode`, the `isolationlevel`,
and the `inputbuf`/`executionStack` — that is the statement. The two statements plus the two
resources give you the ordering conflict.

| Pattern in the graph                                        | Fix                                                        |
| ----------------------------------------------------------- | ---------------------------------------------------------- |
| Two procedures touching tables A and B in opposite order    | impose one access order everywhere                          |
| `U` lock upgrading to `X` on the same key from both sides   | read with `UPDLOCK` in the transaction that will write it   |
| A key-range lock and a `SERIALIZABLE` level nobody asked for | drop the level to read committed unless phantoms matter    |
| Both processes on the same index but a **different** index in each `waitresource` | a non-covering index forcing a lookup — index it |
| Long transaction wrapping user think-time or an HTTP call   | shorten the transaction; never hold one across an external call |
| High-volume upsert deadlocking on itself                    | serialise on a single key with `UPDLOCK, HOLDLOCK` in the read that decides insert-or-update |

**Always retry.** A deadlock victim is a transient fault: the caller retries the whole transaction
(with a small backoff), it does not resume it. The same is true of snapshot update conflicts and
commit-time timeouts.

## Transaction hygiene

- Open the transaction as late as possible and commit as early as possible.
- Never hold a transaction across a network call, a message publish, or user input.
- One statement that does not need a transaction should not have one — it is already atomic.
- `SET XACT_ABORT ON` in every procedure that opens a transaction, so an error leaves nothing open.
- Check `@@TRANCOUNT` before rolling back in nested code — see `stored-procedures.md`.
