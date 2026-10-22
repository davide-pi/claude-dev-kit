---
name: deliver
description: >-
  Use when any code change is asked, before the first edit: bug fix, performance, refactor,
  migration, feature or feasibility probe.
---

# deliver — every code change: triage, perimeter, loop, tests, verdict

**Contract.** A change inside a written perimeter, reviewed in a loop, tested by level and closed by
a verdict block and a table of everything left outside · never edits outside the perimeter, commits or
pushes unasked, or lets a subagent ask the user · chat and verdict Italian, plan file English.

## When

- Any request that ends in an edit to code, a query, a script or a schema: bug, slowness, restructure,
  migration, feature, "can we…" probe.

Not for: reading or explaining code (`investigator`); reviewing an existing diff (`/code-review`);
writing item text (`user-story-standard`); a bug with no proven cause yet (`debug-systematic` runs
inside the bug scenario).

## Decide

### 1. Triage — one pass, written to the plan file before any edit

| Field | Values |
| --- | --- |
| scenario | `bug` · `perf` · `refactor` · `migration` · `feature` · `spike` |
| size | **S** a few lines in one file · **M** one feature, 2–4 files · **L** a subsystem, a new interface or 5+ files |
| PERIMETER | the files (paths, `dir/`, globs), the behaviour in scope, what is excluded |
| test matrix | which levels apply (unit · integration · e2e · perf) and the command for each |

The plan file is the one `plan-work` writes (`docs/plans/<yyyy-MM-dd>-<slug>.md`). The perimeter goes in
it as a fenced block, because `scope-guard.js` reads it:

````text
```perimeter
status: active
- src/Orders/OrdersQuery.cs
- src/Orders/Dto/
- tests/**/Orders*.cs
```
````

Tests of the change belong to the perimeter. Widening it is an edit to this block first, with the
user's yes, then to the code.

### 2. Analysis and review by size

| | S | M | L |
| --- | --- | --- | --- |
| analysis | none | the approach in one line | `plan-work`; `grill-me` if the design is argued |
| shared contract (API, event, schema) | ask the user | ask the user | ask the user, interface agreed first |
| implementation | `implementer`, short brief | `implementer` | `implementer`, in steps |
| review | 1 `code-reviewer`, Sonnet medium | 1 Sonnet high | A Sonnet high + B Opus high, + `review-security` / `review-performance` when touched |

Implementation always goes through `implementer` (effort `medium`; `high` when the brief asks).
Preparation comes before the loop: `references/scenarios.md`.

### 3. Who asks the user

Only this session. The workflow and every subagent return their state and stop; a decision they
cannot make comes back as an open question. Batch the questions, each with a recommendation.

### 4. Tests by level — run here, not delegated

| Scenario | The proof |
| --- | --- |
| bug | the repro test seen red before the loop, green after |
| perf | the baseline command re-run the same way, compared (`references/perf-baseline.md`) |
| refactor | the same tests green, the public signature unchanged |
| migration, feature, spike | `references/scenarios.md` |

A level that cannot run (no staging, no data, no UI) is never skipped silently: run the cheapest proxy,
name it a proxy, then ask once: **accept the proxy · prepare the environment · defer**. The answer
goes in the verdict. A red test or a worse measurement restarts the loop.

## Do

1. Triage, then the plan file and its perimeter block; scenario preparation.
2. Analysis by size; ask only what the table says.
3. Launch the workflow, `Workflow` with `name: impl-review-loop` and
   `args: { brief, perimeter: { files, behaviour, exclusions }, size, verify, stackSkill, touches }`.
   `status: OK` → step 4. `status: STALL` → show the stalled finding and ask: **accept the risk and note
   it · one more round · change the approach**; relaunch with `resumeFromRunId` and
   `resolutions: [{ round, accept?, guidance? }]` (the stalled round and the user's answer).
4. Run the matrix from the plan; every failure goes back to step 3 with the failing output as the brief.
5. Verdict block, perimeter block to `status: closed`, then `/commit`, `pr-create` when asked.

The verdict, a table the `done-claim` hook accepts as evidence:

```text
| Livello | Comando | Riga che decide | Stato |
| --- | --- | --- | --- |
| unit | dotnet test Orders.Tests | Passed: 48, Failed: 0 | fatto |
| e2e | - | - | non verificato: serve staging |
Review: giro 2, 0 P1/P2 aperti. Rischi residui: <elenco, o nessuno>.
```

States: `fatto`, `non verificato: <motivo>`, `failed`. S gets two or three lines of it. Close with
the table of everything outside the perimeter (the workflow's `outOfScope`, `minor`, the implementer's
open questions); the user picks row by row:

| Proposta | Motivo | Rischio |
| --- | --- | --- |

## Traps

1. The change keeps growing → the perimeter was a guess → stop, widen the block with the user's yes,
   never let an edit land first (`scope-guard.js` says "out of perimeter").
2. A bug test written after the fix → it was never seen failing → revert the fix, run it red, restore.
3. A spike drifts into the feature → it is throwaway → answer, delete the probe, stop; the feature is a
   new triage.

## References

- `references/scenarios.md` — before the loop: what each scenario prepares, and the proof it ends on.
- `references/perf-baseline.md` — scenario `perf`, or any claim of "faster": the baseline, the runs,
  BenchmarkDotNet and HTTP timing, the result as ratio and spread.
