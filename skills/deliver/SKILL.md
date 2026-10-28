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

Not for: a question or explanation with no code change; reviewing a diff (`/code-review`); item text
(`user-story-standard`).

## Decide

### 1. Triage — one pass, before any edit

| Field | Values |
| --- | --- |
| scenario | `bug` · `perf` · `refactor` · `migration` · `feature` · `spike` |
| size | by risk, never by file count: **S** logic only, a few lines, or a mechanical batch (rename, move, config, generated) with tests · **M** one feature, or data, money, concurrency, contract, security · **L** a subsystem, a new interface, 3+ non-`logic` risk axes |
| risk | the axes the change alters; they raise the size floor (`references/loop.md` § Args) |
| PERIMETER | files (paths, `dir/`, globs), behaviour in scope, exclusions |
| test matrix | which levels apply (unit · integration · e2e · perf) and the command for each |

The perimeter lives per worktree in `$(git rev-parse --git-dir)/deliver/perimeter.md`, never committed. Write
it at every triage (it overwrites, records the branch), close it before the verdict, with the kit script only:
```powershell
pwsh -NoProfile -File ~/.claude/scripts/perimeter.ps1 -Files 'src/Orders/OrdersQuery.cs,src/Orders/Dto/,tests/**/Orders*.cs'
pwsh -NoProfile -File ~/.claude/scripts/perimeter.ps1 -Close -FindingsLog '<result.findingsLog>' [-Run <id>] [-Tokens <n>]
```
Write the path exactly so, literal `~` (allow rules match it); entries in single quotes. `-Close`, `-LogRun`,
`-NoFindings`: `references/loop.md`.

`scope-guard.js` reads that file only, ignoring it on another branch. Tests of the change belong to the perimeter;
widening it is an edit to this file first, with the user's yes. `plan-work`'s plan file never holds it.

**Start point**, before step 3: HEAD, repo root, dirty files (`references/loop.md`).

### 2. Analysis and review by size

| | S | M | L |
| --- | --- | --- | --- |
| analysis, criteria + proof | the approach and the criterion in one line | the approach, 3–5 criteria each with its proof (the error path too), owner ok, doubts pass, challenger `Plan` (risk: data, money, contract, security) | `plan-work`, criteria + proof, questions, owner ok, doubts pass, challenger `Plan` (Opus) |
| shared contract (API, event, schema) | ask the user | ask the user | ask the user, interface agreed first |
| implementation | this session, inline (up to ~3 files) while the context is small, else `implementer` (`edit-nudge` says when); a mechanical batch → `mechanical: true`, `implementer` on Haiku | `implementer`, 3-4 tasks a run | as M, a run per phase (P-run, `references/loop.md`) |
| review | 1 `code-reviewer`, Sonnet medium (mechanical: low) | 1 Sonnet high, + specialists when risk names them | A Sonnet high + B Opus high, + `review-security` / `review-performance` when risk names them |

`implementer` args: `references/loop.md`; its brief: `file:line` + the change. Before the loop: the section of the chosen scenario in `references/scenarios.md` (read only that one); criteria, doubts pass and challenger: `references/loop.md`.

### 3. Who asks the user

Batch the questions, each with a recommendation, weighty ones only (P-weight, `references/loop.md`).

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
3. Verify pre-check (`references/loop.md`), launch `impl-review-loop` once per coherent request (`references/loop.md`: args, size S inline, `STALL` and resume, the findings log).
   `OK` → `scope-guard.js --check <head>`: files outside → step 3; exit 0 → step 4; exit 2 = not checked, never clean. `STALL` (`question` too) → `references/stall.md`.
4. Run the matrix on the final code; every failure goes back to step 3 with the failing output as the brief (a red test after `OK`: `references/loop.md`). M, L: the proof check (assertion lines of each criterion's test).
5. `perimeter.ps1 -Close -FindingsLog`, then the verdict (`done-claim` blocks one with the perimeter still active), then `/commit`, `pr-create` when asked.

The verdict and the closing table of everything outside the perimeter: `references/loop.md`.

## Traps

1. The change keeps growing → the perimeter was a guess → stop, widen the file with the user's yes,
   never let an edit land first (`scope-guard.js` says "out of perimeter").

## References

- `references/loop.md` — before and when launching the loop, after `OK`, writing the verdict.
- `references/loop-extras.md` — the owner asked a cleanup pass, scope-guard exited 1, or a relaunch; who reads which round.
- `references/stall.md` — a run returns `STALL`, or a test is red after `OK`.
- `references/scenarios.md` — before the loop: the section of the chosen scenario only.
- `references/perf-baseline.md` — scenario `perf`, or any claim of "faster".
- `references/implementer-craft.md` — the `implementer` agent names the § it needs; not opened from here.
