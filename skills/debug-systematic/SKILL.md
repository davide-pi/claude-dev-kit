---
name: debug-systematic
description: >-
  Use for any bug, exception, wrong result, hang, crash, failing or flaky test whose cause is not
  yet proven — including "works on my machine" and "only fails in CI" — to reproduce, isolate and
  explain before any fix.
---

# debug-systematic — evidence before the fix

**Language.** The hypothesis, the phase-3 mechanism sentence and the conclusion are written in
**Italian** — the user reads them. Commands, counter names, plan operators, exception and type
names, and log lines are quoted **verbatim**: a translated log line is no longer evidence.

## When

- A bug, exception, wrong result, hang or crash whose cause is not proven.
- A test that fails, locally or only in CI.
- Behaviour that changed and nobody knows which change did it.
- An intermittent failure that cannot be reproduced on demand.
- Something is slow and the reason is unknown.

Not for: implementing a fix whose cause is already proven; tuning code that works as intended
(that is `review-performance`); browser runtime inspection — console, network, paint, heap — which
the Chrome DevTools plugin owns end to end; reading acceptance criteria to decide what *should*
happen (`/item`, `plan-work`); the .NET diagnostic tools themselves (`dotnet-diagnostics`).

## Decide

### The four phases — no skipping forward

| # | Phase | Exit condition — do not proceed without it |
|---|-------|--------------------------------------------|
| 1 | Reproduce | A command or a click-path that fails on demand, and the failing output captured verbatim |
| 2 | Isolate | The smallest input and narrowest layer that still fails; everything else ruled out by test, not by opinion |
| 3 | Explain | One causal sentence, in Italian — "il valore è null **perché** la factory lo riscrive, **quindi** il mapper lancia `NullReferenceException`". Mechanism, not correlation |
| 4 | Fix and prove | The fix targets the mechanism; the phase-1 repro now passes; a regression test locks it (`dotnet-testing`) |

**The rule: no edit to production code before phase 3 exists in writing.** A change made during
phases 1-2 is instrumentation only — logging, a probe, a failing test — and it is reverted or kept
deliberately, never left standing as the fix.

**When phase 1 fails**, reproducing *is* the task: add correlation ids and timing, then loop the
scenario until the failure rate is measurable.

**Before the first probe of phase 2, write 3–5 ranked, falsifiable hypotheses** — each one a
prediction: "se la causa è X, allora cambiando Y il bug sparisce". A hypothesis with no prediction is
a hunch: sharpen it or drop it. Show the ranked list to the user before testing — they often re-rank
it at once ("abbiamo appena rilasciato #3") — but do not block on the answer. One hypothesis alone
anchors on the first plausible idea.

**The regression test of phase 4 needs a seam that reproduces the real call pattern.** If the only
reachable seam is too shallow to exercise the bug as it happens at the call site, a test there is
false confidence: say so, and report the missing seam as a finding instead.

**Three wrong hypotheses in a row** means the mental model is wrong, not the code. Stop probing:
re-read the whole code path, list every assumption, verify each one with an instrument.

### Symptom class to instrument

| Symptom | Instrument | Command shape | What the output tells you |
|---------|-----------|---------------|---------------------------|
| .NET process slow, leaking, hung, deadlocked, burning CPU | counters, then trace, then dump — `dotnet-diagnostics` owns the tools and how to read them | `dotnet-counters monitor -n <proc>` | Which resource is saturated (GC, thread pool, exceptions, request queue); for a hang, every managed stack at the freeze |
| Behaviour inside a dependency with no source | `ilspycmd`, then `csharprepl` | `ilspycmd -p -o <outDir> <path-to-assembly>` | The real logic instead of the documented one; the REPL then exercises that API outside the app |
| A query slow, or returning the wrong rows | `sqlcmd` with statistics and the plan | `sqlcmd -S <server> -d <db> -E -Q "SET STATISTICS IO, TIME ON; <query>"` | Logical reads per table — the actual cost — plus plan shape: scan against seek, missing index, bad estimate (`sql-server`) |
| Right in a SQL window, wrong from the app | The EF Core command log | log category `Microsoft.EntityFrameworkCore.Database.Command` at Information | The SQL actually sent, with parameters: a filter lost in translation, N+1, client-side evaluation (`ef-core`) |
| A message never arrives, or arrives twice | Broker queues, dead-letter, consumer log | `docker exec <broker> rabbitmqctl list_queues name messages messages_unacknowledged consumers` | Whether it was ever published, sits unacked (consumer stuck) or landed in the dead-letter queue; duplicates mean no idempotency key (`rabbitmq`) |
| Anything inside the browser | The Chrome DevTools plugin | route there, do not re-derive it | Console, network, performance trace, heap snapshot: the plugin covers all of it. Come back with the failing request or stack |
| A test that fails only in CI | Pipeline logs, then an environment diff | `gh run view <id> --log-failed` · `az pipelines runs list --status failed --top 5` | The failing step verbatim; then compare locale, time zone, path case sensitivity, a missing service, restored dependencies |
| Intermittent, locally and in CI alike | A forced-repro loop plus correlation logging | `for ($i=1; $i -le 200; $i++) { dotnet test --filter <Test> }` | A failure rate — no rate means no repro; with ids and timestamps in the log, the interleaving behind it |
| It used to work | `git bisect` | `git bisect start <bad> <good>`, then `git bisect run <script>` | The single commit that introduced it, cheaper than reading the whole diff |

Azure DevOps step logs are reachable from the CLI (`azdo-cli`); a failing run end to end is `/fix-ci`.

## Do

```powershell
# Phase 1 — capture the failure verbatim before touching anything.
dotnet test --filter "FullyQualifiedName~<Test>" *> debug-repro.txt

# Phase 2 — a .NET process: counters first; trace and dump procedure in dotnet-diagnostics.
dotnet-counters monitor -n <proc> --refresh-interval 1

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
9. **A log line added to diagnose, then committed** — instrumentation is not the fix. Tag every
   probe with one prefix per session (`[DEBUG-a4f2]`), so the cleanup is a single
   `git grep -n "DEBUG-a4f2"`; then remove it, or promote it deliberately to structured logging
   with a stated reason.

## References

- A .NET process misbehaving — counters, traces, dumps, leak and starvation signatures → the
  `dotnet-diagnostics` skill.
- `references/data-and-messaging.md` — a query that is slow or wrong, and a message that never
  arrives or arrives twice: plans, statistics, broker triage, dead-letter handling.
- `references/intermittent-and-ci.md` — it cannot be reproduced, or only CI fails: what to log to
  force a repro, the flake taxonomy, the local-against-CI environment diff.
