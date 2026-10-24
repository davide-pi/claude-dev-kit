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

**Start point**, before step 3: HEAD, the repo root and the files already dirty (`references/loop.md`).

### 2. Analysis and review by size

| | S | M | L |
| --- | --- | --- | --- |
| analysis, criteria + proof | the approach and the criterion in one line | the approach, 3–5 criteria each with its proof, owner ok, then the doubts pass | `plan-work`, criteria + proof + questions, owner ok, the doubts pass, `grill-me` on the plan |
| shared contract (API, event, schema) | ask the user | ask the user | ask the user, interface agreed first |
| implementation | this session, inline (a few lines; more → `implementer`) | `implementer` | `implementer`, every plan task of the request in one run (P-run, `references/loop.md`) |
| review | 1 `code-reviewer`, Sonnet medium | 1 Opus high, + specialists when touched | A Sonnet high + B Opus high, + `review-security` / `review-performance` when touched |

`implementer` runs at `medium` (`implementerEffort` for `high`). Before the loop: `references/scenarios.md`, and the doubts pass (M, L) in `references/loop.md`.

### 3. Who asks the user

Only this session. The workflow and every subagent return their state and stop; a decision they cannot make
comes back as an open question. Batch the questions, each with a recommendation, only the weighty ones (P-weight, `references/loop.md`).

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
2. Analysis by size, the criteria with their proof (`references/loop.md`); ask only what the table says. S: edit inline now.
3. Launch `impl-review-loop` once per coherent request (`references/loop.md`: args, size S inline, `STALL` and resume, the findings log).
   `OK` → append `result.findingsLog`, then `scope-guard.js --check <head>`: files outside → step 3; exit 0 → step 4; exit 2 = not checked, never clean. `STALL` (a `question` one too) → ask the user, relaunch with every resolution so far.
4. Run the matrix on the final code; every failure goes back to step 3 with the failing output as the brief (a red test after `OK`: `references/loop.md`). M, L: the proof check (assertion lines of each criterion's test).
5. Verdict, `perimeter.ps1 -Close`, then `/commit`, `pr-create` when asked.

The verdict, a table `done-claim` accepts as evidence (third cell looks like output: a digit, ok, verde, green, passed, failed, exit, succeeded), emitted as a plain markdown table, never inside a code fence. Example:

| Livello | Comando | Riga che decide | Stato |
| --- | --- | --- | --- |
| unit | dotnet test Orders.Tests | Passed: 48, Failed: 0 | fatto |
| e2e | - | - | non verificato: serve staging |

Review: giro 2, 0 P1/P2 aperti. Gap: <gaps, o nessuno>. Rischi residui: <elenco, o nessuno>. Default scelti: <defaults, o nessuno>. Test locale: proposta <chi/cosa>.

States: `fatto`, `non verificato: <motivo>`, `failed`; S gets two or three lines. Close with everything outside
the perimeter (`outOfScope`, with its `noticed` and `scope-revert` items, `minor`, open questions), `#` fixed for the conversation; the user picks:

| # | Proposta | Motivo | Rischio |
| --- | --- | --- | --- |

## Traps

1. The change keeps growing → the perimeter was a guess → stop, widen the file with the user's yes,
   never let an edit land first (`scope-guard.js` says "out of perimeter").
2. A bug test written after the fix → it was never seen failing → revert the fix, run it red, restore.
3. A spike drifts into the feature → it is throwaway → answer, delete the probe; the feature is a new triage.

## References

- `references/loop.md` — the doubts pass, the start point, the workflow's args, size S inline, each `STALL` and the
  resume, the cleanup pass, the scope check after `OK`, the findings log.
- `references/scenarios.md` — before the loop: what each scenario prepares, and the proof it ends on.
- `references/perf-baseline.md` — scenario `perf`, or any claim of "faster": the baseline, the runs,
  BenchmarkDotNet and HTTP timing, the result as ratio and spread.
