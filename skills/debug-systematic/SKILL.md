---
name: debug-systematic
description: >-
  Use when a bug, exception, wrong result, hang, crash or failing test has no proven cause:
  "non funziona", "trova il bug", flaky or CI-only included.
---

# debug-systematic — evidence before the fix

**Contract.** Reproduce → isolate → explain → fix, each phase closed by evidence · no edit to
production code before the phase-3 sentence exists · hypotheses, mechanism and conclusion in
the chat language; commands, exceptions, counters and log lines verbatim (a translated log line is no longer
evidence).

## When

Not for: a fix whose cause is already proven; tuning code that works (`review-performance`); what the
behaviour *should* be (the `azdo-cli` item read, `plan-work`).

## Decide

### The four phases — no skipping forward

| # | Phase | Exit condition — do not proceed without it |
| --- | --- | --- |
| 1 | Reproduce | a command or click-path that fails on demand, its output captured verbatim |
| 2 | Isolate | the smallest input and narrowest layer that still fails; the rest ruled out by test, not opinion |
| 3 | Explain | one causal sentence in the chat language — "il valore è null **perché** la factory lo riscrive, **quindi** il mapper lancia `NullReferenceException`". Mechanism, not correlation |
| 4 | Fix and prove | the fix targets the mechanism; the phase-1 repro passes; a regression test locks it (`dotnet-testing`) |

A change during phases 1–2 is instrumentation only (a log line, a probe, a failing test), reverted or
kept deliberately — never left standing as the fix.

| Situation | Rule |
| --- | --- |
| the symptom is in a running environment, its evidence not yet gathered | `incident` first: logs, database and code in parallel, then phase 2 here |
| phase 1 fails | reproducing *is* the task: add correlation ids and timing, loop the scenario until the failure rate is measurable (`references/intermittent-and-ci.md`) |
| before the first probe of phase 2 | the 2–3 most probable causes first, ranked (a fourth or fifth only if those fail), each a falsifiable prediction ("se la causa è X, cambiando Y il bug sparisce"); show them to the user — they often re-rank at once — but do not wait for the answer |
| three wrong hypotheses in a row | the mental model is wrong, not the code: stop probing, re-read the whole path, list every assumption, verify each with an instrument |
| the only reachable seam is too shallow to replay the real call pattern | a test there is false confidence: report the missing seam as a finding instead |

### Symptom class to instrument

| Symptom | Instrument | Command shape | What it tells you |
| --- | --- | --- | --- |
| .NET process slow, leaking, hung, burning CPU | counters → trace → dump (`dotnet-diagnostics`) | `dotnet-counters monitor -n <proc>` | which resource saturates (GC, thread pool, exceptions, queue); for a hang, every stack at the freeze |
| behaviour inside a dependency with no source | `ilspycmd`, then `csharprepl` | `ilspycmd -p -o <outDir> <assembly>` | the real logic, then the API exercised outside the app |
| intermittent everywhere | a forced-repro loop plus correlation logging | `1..200 \| % { dotnet test --filter <Test> }` | a failure rate (no rate, no repro); the interleaving behind it |
| it used to work | `git bisect` | `git bisect start <bad> <good>`; `git bisect run <script>` | the single commit that introduced it |

Slow or wrong query, EF, missing or doubled message → `references/data-and-messaging.md`; browser, CI-only → `references/intermittent-and-ci.md`.

## Do

```powershell
# Phase 1 — capture the failure verbatim before touching anything, outside the repo (scratchpad or temp)
dotnet test --filter "FullyQualifiedName~<Test>" *> "$env:TEMP\debug-repro.txt"

# Phase 2 — which commit did it
git bisect start <badRef> <goodRef>
git bisect run pwsh -NoProfile -Command "dotnet test --filter '<Test>'; exit `$LASTEXITCODE"

# Phase 4 — the regression test first, on the unfixed code: it must fail for the reported reason
dotnet test --filter "FullyQualifiedName~<NewTest>"     # expect: failed, the phase-1 symptom
# ... apply the fix ...
dotnet test --filter "FullyQualifiedName~<NewTest>"     # expect: passed
```

## Traps

1. The symptom disappears but was never explained → the bug moves instead of dying → write the
   phase-3 sentence, or keep debugging.
2. A plan read for SQL the app never sends → take the statement from the command log, not from the
   repository method.
3. The consumer blamed for a missing message → it may never have been published, or the routing key
   misses the binding → queue depth first: an empty queue exonerates the consumer.
4. A flake "fixed" with a retry or a sleep → the race survives, now invisible → fix the ordering, or
   assert on the condition instead of elapsed time.
5. Chasing CI with blind pushes → minutes per round trip → reproduce CI conditions locally
   (container, locale, clean clone) and iterate there.
6. A dump of a process that must keep serving → collection freezes it → counters and a trace first.
7. A diagnostic log line committed → tag every probe with one prefix per session (`[DEBUG-a4f2]`),
   then `git grep -n "DEBUG-a4f2"` and remove it, or promote it to structured logging on purpose.

## References

- `references/data-and-messaging.md` — a query slow or wrong, a message missing or doubled: plans,
  statistics, broker triage, dead-letter handling.
- `references/intermittent-and-ci.md` — cannot reproduce, a browser symptom, or only CI fails: what to
  log to force a repro, the flake taxonomy, the local-against-CI environment diff.
