# VACUUM, dead tuples and bloat

## Why this exists at all

Postgres never updates a row in place: an `UPDATE` writes a **new** row version and marks the old
one dead; a `DELETE` only marks it dead. Dead versions stay on disk until `VACUUM` reclaims the space
for reuse. That is the price of readers never blocking writers — and it is the reason a table can
grow while its row count does not.

`VACUUM` marks space reusable inside the table. It does **not** return it to the operating system;
only a rewrite (`VACUUM FULL`, or an online repack tool) does that.

## Diagnose in one query

```sql
select relname,
       n_live_tup, n_dead_tup,
       round(100.0 * n_dead_tup / nullif(n_live_tup + n_dead_tup, 0), 1) as dead_pct,
       last_vacuum, last_autovacuum, last_analyze, last_autoanalyze,
       pg_size_pretty(pg_total_relation_size(relid)) as total
from pg_stat_user_tables
order by n_dead_tup desc
limit 20;
```

| Reading                                        | Meaning                                                    |
| ---------------------------------------------- | ---------------------------------------------------------- |
| `dead_pct` steady and low                      | autovacuum is keeping up — nothing to do                    |
| `dead_pct` climbing, `last_autovacuum` old     | autovacuum is not running, or is being blocked               |
| `last_autovacuum` recent but `dead_pct` high   | autovacuum runs and cannot reclaim: something holds the snapshot |
| `n_dead_tup` high on a small, hot table        | thresholds are proportional, so a hot small table starves — tune it per table |
| Size large, `n_live_tup` small                 | bloat already accumulated; vacuum will not shrink the file   |

## What blocks reclamation

`VACUUM` may only remove a row version older than the oldest snapshot that could still see it. Three
things hold that back, and all three are visible:

```sql
-- 1. Long-running or idle-in-transaction sessions
select pid, state, now() - xact_start as xact_age, now() - state_change as idle_for, left(query, 100)
from pg_stat_activity
where xact_start is not null and now() - xact_start > interval '5 minutes'
order by xact_age desc;

-- 2. Replication slots that nobody consumes
select slot_name, active, restart_lsn, pg_size_pretty(
       pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) as retained
from pg_replication_slots;

-- 3. Prepared (two-phase) transactions left behind
select gid, prepared, owner, database from pg_prepared_xacts;
```

An application that opens a transaction, does an HTTP call, then commits, is the usual culprit for
number one: it pins the snapshot for the duration of someone else's latency, and the whole database
stops reclaiming space. This is the single most common Postgres production problem in a .NET service,
and it looks like a disk problem rather than a code problem.

## Running it deliberately

| Command                             | Effect                                                    | Lock                          |
| ----------------------------------- | --------------------------------------------------------- | ----------------------------- |
| `VACUUM (VERBOSE) t`                | reclaim for reuse, print what it did                       | concurrent reads and writes OK |
| `VACUUM (ANALYZE) t`                | the same plus refreshed statistics                          | as above                       |
| `ANALYZE t`                         | statistics only — the cheap fix for a bad plan               | as above                       |
| `VACUUM FULL t`                     | rewrites the table, returns space to the OS, rebuilds indexes | **exclusive** — blocks everything |
| `REINDEX (CONCURRENTLY) i`          | rebuilds a bloated index                                    | concurrent form allows writes  |
| `VACUUM (FREEZE) t`                 | forces freezing now                                         | as plain vacuum                |

`VACUUM FULL` needs free disk space equal to the table plus its indexes, and it takes the table
offline for the duration. It is a maintenance-window operation; announce it before running it, and
prefer an online repack tool when the table cannot be locked.

## Tuning autovacuum where it matters

The defaults trigger a vacuum after roughly a fixed number of dead rows plus a percentage of the
table. On a large table that percentage is a huge number of dead rows; on a tiny hot table it is a
handful, so it thrashes. Both are fixed per table, not globally:

```sql
-- A large, heavily updated table: vacuum sooner, in proportion
ALTER TABLE orders SET (autovacuum_vacuum_scale_factor = 0.02,
                        autovacuum_analyze_scale_factor = 0.01);

-- A small, extremely hot queue table: absolute threshold instead of a percentage
ALTER TABLE job_queue SET (autovacuum_vacuum_threshold = 200,
                           autovacuum_vacuum_scale_factor = 0.0);

-- An append-only log where autovacuum only ever needs to freeze
ALTER TABLE audit_log SET (autovacuum_vacuum_scale_factor = 0.1, fillfactor = 100);
```

`fillfactor` below 100 leaves room on each page for updated versions of its own rows, which keeps
`HOT` updates in place and avoids touching every index. Lower it on tables whose non-indexed columns
change constantly; leave it at 100 on append-only tables.

The current per-table settings are in `pg_class.reloptions`; the server-wide values come from `SHOW
autovacuum_vacuum_scale_factor` and friends. Read them before changing anything.

## Transaction-id freezing

Every row version carries the transaction id that created it, and that counter is finite. `VACUUM`
also **freezes** old rows so their ids can be recycled; if it never gets the chance, the server
eventually refuses writes to protect itself.

```sql
select relname, age(relfrozenxid) as xid_age, pg_size_pretty(pg_total_relation_size(relid)) as total
from pg_class c join pg_stat_user_tables s on s.relid = c.oid
where c.relkind = 'r' order by age(relfrozenxid) desc limit 20;
```

A table whose `xid_age` keeps climbing towards the server's freeze limit is a genuine incident in
waiting, and the cause is always the same list as above: a transaction, a slot, or a prepared
transaction that never ended. Fix the holder; do not just run a manual vacuum and move on.

## Index bloat

Indexes bloat independently of the heap, especially under a random insert order or heavy updates.
Compare index size against the number of live rows over time, or use a bloat-estimation query from
the community; then `REINDEX CONCURRENTLY`. A B-tree that has doubled in size for the same row count
is worth rebuilding — see `explain-and-indexes.md` for the concurrency caveats.
