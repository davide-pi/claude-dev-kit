---
name: deliver
description: >-
  Use when any code change is asked, before the first edit: bug fix, performance, refactor,
  migration, feature or feasibility probe.
---

# deliver — every code change: triage, perimeter, loop, tests, verdict

**Contract.** A change inside a written perimeter, reviewed in a loop, tested by level and closed by
a verdict block and a table of everything left outside · never edits outside the perimeter, reverts the
user's own uncommitted work, commits or pushes unasked, or lets a subagent ask the user · chat and verdict
Italian, notes English.

## When

- Any request that ends in an edit to code, a query, a script or a schema: bug, slowness, restructure,
  migration, feature, "can we…" probe.

Not for: a question or an explanation with no code change (answer it; `investigator` to read); reviewing
an existing diff (`/code-review`); writing item text (`user-story-standard`); a bug with no proven cause
yet (`debug-systematic` runs inside the bug scenario).

## Decide

### 1. Triage — one pass, before any edit

| Field | Values |
| --- | --- |
| scenario | `bug` · `perf` · `refactor` · `migration` · `feature` · `spike` |
| size | **S** a few lines in one file · **M** one feature, 2–4 files · **L** a subsystem, a new interface or 5+ files |
| PERIMETER | the files (paths, `dir/`, globs, repo-relative), the behaviour in scope, what is excluded |
| test matrix | which levels apply (unit · integration · e2e · perf) and the command for each |

The perimeter lives per worktree in `$(git rev-parse --git-dir)/deliver/perimeter.md`, never committed. Write
it at every triage (it overwrites the previous one, records the branch, works in a linked worktree), close it at
the verdict, with the kit script, never an ad-hoc shell write:
```powershell
pwsh -NoProfile -File ~/.claude/scripts/perimeter.ps1 -Files 'src/Orders/OrdersQuery.cs,src/Orders/Dto/,tests/**/Orders*.cs'
pwsh -NoProfile -File ~/.claude/scripts/perimeter.ps1 -Close
```
Write the path exactly so, literal `~` in either shell: the allow rules in `settings.json` match the command text.
Entries go in single quotes (the hook asks on `$`, `(`, `@`, backtick outside them). The file holds `branch:`, `status: active|closed` and one `- <entry>` line per entry.

`scope-guard.js` reads that file only, and ignores it when the branch differs. Tests of the change belong
to the perimeter; widening it is an edit to this file first, with the user's yes. `plan-work`'s plan file
(`docs/plans/`) holds an L plan and the scenario's saved numbers, never the perimeter.

**Start point**, before step 3: HEAD, the repo root and the files already dirty (`references/loop.md`). A
perimeter file already dirty → ask the user first; any other dirty file is the user's, never reverted.

### 2. Analysis and review by size

| | S | M | L |
| --- | --- | --- | --- |
| analysis | none | the approach in one line | `plan-work`; `grill-me` if the design is argued |
| shared contract (API, event, schema) | ask the user | ask the user | ask the user, interface agreed first |
| implementation | this session, inline (a few lines; more → `implementer`) | `implementer` | `implementer`, in steps |
| review | 1 `code-reviewer`, Sonnet medium | 1 Sonnet high | A Sonnet high + B Opus high, + `review-security` / `review-performance` when touched |

`implementer` runs at `medium`; `high` when the brief asks (`implementerEffort`). Preparation comes
before the loop: `references/scenarios.md`.

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

1. Triage, then the perimeter file and the start point; scenario preparation.
2. Analysis by size; ask only what the table says. S: make the edit inline now.
3. Launch the `impl-review-loop` workflow (args, size S inline, `STALL` and resume: `references/loop.md`).
   `status: OK` → step 4. `status: STALL` → ask the user, relaunch with every resolution so far.
4. Run the matrix; every failure goes back to step 3 with the failing output as the brief.
5. Verdict, `perimeter.ps1 -Close`, then `/commit`, `pr-create` when asked.

The verdict, a table `done-claim` accepts as evidence (third cell looks like output: a digit, ok, verde, green, passed, failed, exit, succeeded):

```text
| Livello | Comando | Riga che decide | Stato |
| --- | --- | --- | --- |
| unit | dotnet test Orders.Tests | Passed: 48, Failed: 0 | fatto |
| e2e | - | - | non verificato: serve staging |
Review: giro 2, 0 P1/P2 aperti. Rischi residui: <elenco, o nessuno>.
```

States: `fatto`, `non verificato: <motivo>`, `failed`; S gets two or three lines. Close with everything outside
the perimeter (`outOfScope`, `minor`, open questions), `#` fixed for the conversation; the user picks:

| # | Proposta | Motivo | Rischio |
| --- | --- | --- | --- |

## Traps

1. The change keeps growing → the perimeter was a guess → stop, widen the file with the user's yes,
   never let an edit land first (`scope-guard.js` says "out of perimeter").
2. A bug test written after the fix → it was never seen failing → revert the fix, run it red, restore.
3. A spike drifts into the feature → it is throwaway → answer, delete the probe; the feature is a new triage.

## References

- `references/loop.md` — launching the workflow: its args, the start point, size S inline, a `STALL` and the
  resume with the user's answers.
- `references/scenarios.md` — before the loop: what each scenario prepares, and the proof it ends on.
- `references/perf-baseline.md` — scenario `perf`, or any claim of "faster": the baseline, the runs,
  BenchmarkDotNet and HTTP timing, the result as ratio and spread.
