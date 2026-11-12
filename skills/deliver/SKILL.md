---
name: deliver
description: >-
  Use when any code change is asked, before the first edit: bug fix, performance, refactor,
  migration, feature, feasibility probe; "implementa", "correggi".
---

# deliver — every code change: triage, perimeter, loop, tests, verdict

**Contract.** A change inside a written perimeter, reviewed in a loop, tested by level and closed by
a verdict block and a table of everything left outside · never edits outside the perimeter, reverts the
user's own uncommitted work, commits or pushes unasked, or lets a subagent ask the user · chat and verdict
in the chat language, notes English.

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
| size | **S** you decide: logic only, a few lines, or a mechanical batch (rename, move, config, generated) with tests · **M** the plan fits one block (up to 4 tasks) · **L** more than one block. M and L come from the plan's tasks, never from file count |
| risk | axes the change alters: data, money, concurrency, contract, security lift S to M and raise the reader tiers (`references/loop.md` § Args) |
| PERIMETER | files (paths, `dir/`, globs), behaviour in scope, exclusions |
| test matrix | which levels apply (unit · integration · e2e · perf) and the command for each |

The perimeter lives per worktree in `$(git rev-parse --git-dir)/deliver/perimeter.md`, never committed. Write
it at every triage (it overwrites, records the branch), close it before the verdict, with the kit script only:
```powershell
pwsh -NoProfile -File ~/.claude/scripts/perimeter.ps1 -Files 'src/Orders/OrdersQuery.cs,src/Orders/Dto/,tests/**/Orders*.cs'
pwsh -NoProfile -File ~/.claude/scripts/perimeter.ps1 -Close -FindingsLog '<result.findingsLog>' [-Run <id>] [-Tokens <n>]
```
Write the path exactly so, literal `~` (allow rules match it); entries in single quotes. Other flags: `references/loop.md`.

`scope-guard.js` reads that file only, ignoring it on another branch. Tests of the change belong to it;
widening it is an edit to this file first, with the user's yes.

**Start point**, before step 3: HEAD, repo root, dirty files (`references/loop.md`).

### 2. Analysis and review by size

| | S | M | L |
| --- | --- | --- | --- |
| analysis, criteria + proof | the approach and the criterion in one line | the approach, 3–5 criteria each with its proof (the error path too), tasks, owner ok, doubts pass, challenger `Plan` (Sonnet high; Opus with a data, money, contract or security axis) | `plan-work`, the same, challenger `Plan` (Opus high) |
| shared contract (API, event, schema) | ask the user | ask the user | ask the user, interface agreed first |
| implementation | this session, inline (up to ~3 files) while the context is small, else `implementer`; a mechanical batch → `mechanical: true`, `implementer` on Haiku | `implementer`, one block (up to 4 tasks), closed by the gate | as M, block after block |
| review | 1 `code-reviewer`, Sonnet high (mechanical: low) | reader A per block (Sonnet high); reader B once on the whole diff (Sonnet high; Opus with a security or data axis, over 10 files or 600 lines, or 3+ axes besides `logic`); + specialists when risk names them | reader A per block; B Opus high + a second reader Sonnet high; + specialists |

**Docs only** (README, `docs/`, code comments; never a skill, agent, rule or hook): no perimeter, no loop.
Edit inline, then one `code-reviewer` (Haiku, `medium`) on the diff; fix its P1/P2 inline, run the doc or lint check (this kit: `node tools/validate.mjs`).

Loop args: `references/loop.md`; the brief: `file:line` + the change + the challenger's `read:`. Before the loop: the chosen scenario's section of `references/scenarios.md`; tasks, doubts pass, challenger: `references/analysis.md`.

### 3. Who asks the user

Every closed question is asked before the launch, in rounds, the recommendation first; weighty ones only (P-weight, `references/loop.md`). A reversible open one takes its default in the run; the verdict says so.

### 4. Tests by level

The gate (`scripts/gate.mjs`) runs the tests: at the end of each block, and once here after the loop. The proof per scenario:

| Scenario | The proof |
| --- | --- |
| bug | the repro test seen red before the loop, green after |
| perf | the baseline command re-run the same way, compared (`references/perf-baseline.md`) |
| refactor | the same tests green, the public signature unchanged |
| migration, feature, spike | `references/scenarios.md` |

A level that cannot run (no staging, no data, no UI) is never skipped silently: run the cheapest proxy,
name it, then ask once: **accept the proxy · prepare the environment · defer**; the answer goes in the verdict.

## Do

1. Triage, then the perimeter file and the start point; scenario preparation. Docs only (§2): triage, edit inline, one reviewer, that check, the verdict; no perimeter, start point, loop or `-Close`.
2. Analysis by size, criteria with proof (`references/analysis.md`); ask what §3 says. S: edit inline now.
3. Verify pre-check (`references/loop.md`), launch `impl-review-loop` once per coherent request with the plan (`references/loop.md`: args, size S inline, `STALL` and resume, the findings log).
   `OK` → the final gate, then the sweep (`references/loop.md` § After OK): `green` or `skipped: tree unchanged` → step 4; red → relaunch with the gate line as the brief; exit 2 = not checked, never clean. `STALL` → `references/stall.md`.
4. Run the matrix levels the gate doesn't cover; a failure goes back to step 3 with its output as the brief. M, L: the proof check (assertion lines of each criterion's test).
5. `perimeter.ps1 -Close -FindingsLog`, then the verdict, then `/commit`, `pr-create` when asked.

The verdict and the closing table of everything outside the perimeter: `references/loop.md`.

## Traps

1. The change keeps growing → the perimeter was a guess → stop, widen the file with the user's yes first.

## References

- `references/analysis.md` — M, L before the loop: doubts, criteria, challenger.
- `references/loop.md` — when launching the loop, after `OK`, writing the verdict.
- `references/loop-extras.md` — the owner asked a cleanup pass, the gate said `red: scope`, or a relaunch; who reads what.
- `references/stall.md` — a run returns `STALL`, or a test is red after `OK`.
- `references/scenarios.md` — before the loop: the section of the chosen scenario only.
- `references/perf-baseline.md` — scenario `perf`, or any claim of "faster".
- `references/implementer-craft.md` — the `implementer` agent names the § it needs; not opened from here.
