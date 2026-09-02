---
name: debug-systematic
description: >-
  The debugging discipline: reproduce, isolate, explain, then fix — and never fix before the
  mechanism is written down. Use for any bug, exception, wrong result, hang, crash, test failure or
  intermittent behaviour whose cause is not yet proven, including "it works on my machine" and "it
  only fails in CI". Routes each symptom class to the instrument that produces evidence — .NET
  counters, traces and dumps, SQL execution plans and statistics, broker queues and dead-letter,
  pipeline logs, forced-repro loops — instead of guessing at the code.
---

# debug-systematic — evidence before the fix

## When

- A bug, exception, wrong result, hang or crash whose cause is not proven.
- A test that fails, locally or only in CI.
- Behaviour that changed and nobody knows which change did it.
- An intermittent failure that cannot be reproduced on demand.
- Something is slow and the reason is unknown.

Not for: implementing a fix whose cause is already proven; tuning code that works as intended
(that is `review-performance`); browser runtime inspection — console, network, paint, heap — which
the Chrome DevTools plugin owns end to end; reading acceptance criteria to decide what *should*
happen (`workitem-analyze`).

## Decide

### The four phases — no skipping forward

| # | Phase | Exit condition — do not proceed without it |
|---|-------|--------------------------------------------|
| 1 | Reproduce | A command or a click-path that fails on demand, and the failing output captured verbatim |
| 2 | Isolate | The smallest input and narrowest layer that still fails; everything else ruled out by test, not by opinion |
| 3 | Explain | One causal sentence — "the value is null **because** the factory rewrites it, **so** the mapper throws". Mechanism, not correlation |
| 4 | Fix and prove | The fix targets the mechanism; the phase-1 repro now passes; a regression test locks it (`test-strategy`) |

**The rule: no edit to production code before phase 3 exists in writing.** A change made during
phases 1-2 is instrumentation only — logging, a probe, a failing test — and it is reverted or kept
deliberately, never left standing as the fix.

**When phase 1 fails**, reproducing *is* the task: add correlation ids and timing, then loop the
scenario until the failure rate is measurable.

**Three wrong hypotheses in a row** means the mental model is wrong, not the code. Stop probing:
re-read the whole code path, list every assumption, verify each one with an instrument.

### Symptom class to instrument

| Symptom | Instrument | Command shape | What the output tells you |
|---------|-----------|---------------|---------------------------|
| .NET process slow, leaking, hanging, burning CPU | `dotnet-counters`, then `dotnet-trace`, then `dotnet-dump` | `dotnet-counters monitor -n <proc> --counters System.Runtime,Microsoft.AspNetCore.Hosting` | Which resource is saturated: GC pressure and heap growth, thread-pool queue depth (starvation), exception rate, request queue |
| A hang or a deadlock, no progress at all | `dotnet-dump` plus `clrstack` | `dotnet-dump collect -p <pid>`, then `dotnet-dump analyze <file>` | Every managed stack at the moment of the freeze: who waits on whom, sync-over-async, an exhausted pool |
| Behaviour inside a dependency with no source | `ilspycmd`, then `csharprepl` | `ilspycmd -p -o <outDir> <path-to-assembly>` | The real logic instead of the documented one; the REPL then exercises that API outside the app |
| A query slow, or returning the wrong rows | `sqlcmd` with statistics and the plan | `sqlcmd -S <server> -d <db> -E -Q "SET STATISTICS IO, TIME ON; <query>"` | Logical reads per table — the actual cost — plus plan shape: scan against seek, missing index, bad estimate (`sql-server`) |
| Right in a SQL window, wrong from the app | The EF Core command log | log category `Microsoft.EntityFrameworkCore.Database.Command` at Information | The SQL actually sent, with parameters: a filter lost in translation, N+1, client-side evaluation (`ef-core`) |
| A message never arrives, or arrives twice | Broker queues, dead-letter, consumer log | `docker exec <broker> rabbitmqctl list_queues name messages messages_unacknowledged consumers` | Whether it was ever published, sits unacked (consumer stuck) or landed in the dead-letter queue; duplicates mean no idempotency key (`rabbitmq`) |
| Anything inside the browser | The Chrome DevTools plugin | route there, do not re-derive it | Console, network, performance trace, heap snapshot: the plugin covers all of it. Come back with the failing request or stack |
| A test that fails only in CI | Pipeline logs, then an environment diff | `gh run view <id> --log-failed` · `az pipelines runs list --status failed --top 5` | The failing step verbatim; then compare locale, time zone, path case sensitivity, a missing service, restored dependencies |
| Intermittent, locally and in CI alike | A forced-repro loop plus correlation logging | `for ($i=1; $i -le 200; $i++) { dotnet test --filter <Test> }` | A failure rate — no rate means no repro; with ids and timestamps in the log, the interleaving behind it |
| It used to work | `git bisect` | `git bisect start <bad> <good>`, then `git bisect run <script>` | The single commit that introduced it, cheaper than reading the whole diff |

Azure DevOps log fetch is CLI-first; when `az pipelines` cannot reach the step text, the Azure
DevOps MCP build-log capability is the documented fallback — say which one was used.

## Do

```powershell
# Phase 1 — capture the failure verbatim before touching anything.
dotnet test --filter "FullyQualifiedName~<Test>" *> debug-repro.txt

# Phase 2 — .NET triage, in this order. Install the tools once, globally.
dotnet tool install -g dotnet-counters; dotnet tool install -g dotnet-trace; dotnet tool install -g dotnet-dump
Get-Process -Name <proc> | Select-Object Id, WorkingSet, CPU   # the pid, and whether it moves
dotnet-counters monitor -n <proc> --refresh-interval 1
dotnet-trace collect -n <proc> --profile cpu-sampling          # then open the trace in a viewer
dotnet-dump collect -p <pid> -o hang.dmp                       # last resort: a hang or a leak

# Phase 2 — the database side.
sqlcmd -S <server> -d <db> -E -Q "SET STATISTICS IO, TIME ON; <query>"

# Phase 2 — which commit did it.
git bisect start <badRef> <goodRef>
git bisect run pwsh -NoProfile -Command "dotnet test --filter '<Test>'"

# Phase 4 — prove it. The regression test must fail on the unfixed code first.
git stash; dotnet test --filter "FullyQualifiedName~<NewTest>"; git stash pop
```

## Traps

1. **The symptom disappears but was never explained** — the mechanism is untouched, so the bug
   moves instead of dying. Write the phase-3 sentence, or keep debugging.
2. **Debugging a stale build** — the running process predates the edit, and the "impossible"
   behaviour is yesterday binaries. Rebuild, restart, check the assembly timestamp.
3. **Reading a plan for SQL the app never sends** — hand-written SQL differs from the translated
   one. Take the statement from the command log, not from the repository method.
4. **Blaming the consumer for a missing message** — it may never have been published, or the
   routing key does not match the binding. Queue depth first: an empty queue exonerates the consumer.
5. **A flake "fixed" with a retry or a sleep** — the race survives and is now invisible. Fix the
   ordering, or assert on the condition instead of on elapsed time.
6. **Chasing CI with blind pushes** — every round trip costs minutes. Reproduce the CI conditions
   locally (container, locale, clean clone) and iterate there.
7. **Changing several things per run** — when it passes, nothing was learnt. One variable at a time.
8. **A dump taken from a process that must keep serving** — collection freezes it for seconds. Take
   counters and a trace first; dump only when a freeze is acceptable.
9. **A log line added to diagnose, then committed** — instrumentation is not the fix. Remove it, or
   promote it deliberately to structured logging with a stated reason.

## References

- `references/dotnet-runtime.md` — a .NET process misbehaving: what each counter means, trace
  profiles, dump analysis commands, leak and starvation signatures.
- `references/data-and-messaging.md` — a query that is slow or wrong, and a message that never
  arrives or arrives twice: plans, statistics, broker triage, dead-letter handling.
- `references/intermittent-and-ci.md` — it cannot be reproduced, or only CI fails: what to log to
  force a repro, the flake taxonomy, the local-against-CI environment diff.
