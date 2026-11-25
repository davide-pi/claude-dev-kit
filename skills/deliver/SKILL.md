---
name: deliver
description: >-
  Use when any code change is asked, before the first edit: bug fix, performance, refactor,
  migration, feature, feasibility probe; "implementa", "correggi".
---

# deliver — every code change: triage, questions once, build, tests, verdict

**Contract.** A change triaged by size and risk, every closed question asked once up front, built and
reviewed, tested by level and closed by a verdict · never reverts the user's own uncommitted work, commits
or pushes unasked, or lets a subagent ask the user · chat and verdict in the chat language, notes English.

## When

- Any request ending in an edit to code, a query, a script or a schema, a "can we…" probe included.

Not for: a question or explanation with no code change; reviewing a diff (`/code-review`); item text
(`user-story-standard`).

## Decide

### 1. Triage — before any edit

| Field | Values |
| --- | --- |
| scenario | `bug` · `perf` · `refactor` · `migration` · `feature` · `spike` |
| size | **S** you decide: logic only, a few lines, or a mechanical batch (rename, move, config, generated) · **M** a plan of up to 4 tasks · **L** more than 4 tasks. M and L come from the plan, never from file count |
| risk | axes the change alters: `data`, `money`, `contract`, `security`, `concurrency` (lift S to M); they pick the implementer's and reviewer's model in `build` |
| test matrix | the levels that apply (unit · integration · e2e · perf) with this repo's command for each |

Read the section of `references/scenarios.md` for the chosen scenario, and `references/perf-baseline.md` for `perf`.
Default branch: `branch-flow` first.

### 2. Questions — once, up front

Collect every closed question (a shared contract: API, event, schema; a data or deploy choice; a proxy for a
level that can't run) and ask them in **one** AskUserQuestion round, the recommendation first. A reversible open
question takes its default; the verdict says so. After this round the run asks nothing, except `stop` questions (§4).

### 3. Size S, and docs only

Edit inline (up to ~3 files) or with one `implementer`; one `code-reviewer`; fix only its P1/P2 findings, never its `Outside the change` lines; run the matrix.
**Docs only** (README, `docs/`, code comments; never a skill, agent, rule or hook): edit inline, one
`code-reviewer` (Haiku, `medium`), fix its P1/P2, run the doc check (this kit: `node tools/validate.mjs`).

### 4. Size M and L — plan, one ok, `build`

A plan the owner already approved (from `kowalski`) skips `plan-work`, the challenger and the ok: go straight to the launch.

1. `plan-work`: 3–5 criteria with their proof (the error path too), tasks shaped for `build`:
   `{ id, files, criteria (Given/When/Then), verify, dependsOn }` plus optional `size`, `risk`, `mechanical`, `tdd`;
   each task atomic per `plan-work` § 3; tasks sharing a file depend on each other.
2. Challenger: one `Plan` subagent (Opus high; Sonnet high when no risk axis is named) attacks the draft (assumptions,
   missing questions, non-atomic tasks, a `verify` that can't fail, error paths, a simpler design) in at most 10 lines
   with `file:line` or task id. Fold accepted points in; its open questions join the §2 round. One challenger, one round.
3. The owner's one ok on the plan (a plan-only request stops here).
4. Launch the `Workflow` tool with `name: build` and
   `{ tasks, testCmd, risk: [axes], repoRoot, request, done?: [ids], doneFiles?: [paths], baseline?: false }`. It runs `testCmd`
   first (red, not run or no test → `stop` with id `baseline`, nothing built), implements in waves, reruns each `verify`, runs
   `testCmd`, then up to 3 review rounds (a second opus reviewer on `data`, `money`, `contract`, `security`), a fix between rounds.
5. Read only its summary: `{ status: ok|stop|failed|error (bad args: errors[]), tasks[{id,state,red,line?,redLine?}], assumedDone[] (deps not in the call), suite, rounds, stops[{id,question}], openFindings[], outside[], filesChanged[] }`.
6. `stop` questions go to the owner in one AskUserQuestion round, then relaunch `build` with the stopped/failed tasks plus their skipped dependents, passing the ids already done in `done` (the only `dependsOn` ids allowed outside `tasks`).
   `failed` → the summary line as the brief, one relaunch with the failed tasks plus their skipped dependents; a second failure goes to the owner.
   The relaunch passes `red: true` and its `redLine` on each task whose summary had `red: true` (its tests are already written and proven red),
   the previous summary's `filesChanged` as `doneFiles`, and `baseline: false`. A `baseline` stop relaunches the same call once the suite is green (no test yet: `baseline: false`).
   A `stop` or `failed` run with every task done (a fixer's question, round cap, red suite) has no set to relaunch: it goes to the owner with the stops and the open findings.
   An open finding outside the declared files goes to the owner, never to a relaunch.

### 5. Tests by level

| Scenario | The proof |
| --- | --- |
| bug | the repro test seen red before the change, green after |
| perf | the baseline command re-run the same way, compared (`references/perf-baseline.md`) |
| refactor | the same tests green, the public signature unchanged |
| migration, feature, spike | `references/scenarios.md` |

Run the matrix levels `build` doesn't cover. A level that can't run (no staging, no data, no UI) is never
skipped silently: run the cheapest proxy, name it, and put it in the up-front round (accept it · prepare the environment · defer).

**Real tests** (live, e2e, anything touching shared systems) run only after one AskUserQuestion that
proposes the exact command; on a yes, run it with the `run` skill.

### 6. The verdict

The bold one-liner, then the `Verification` table per `CLAUDE.md` (Level | Command | Deciding line | Status,
one row per check, deciding lines verbatim), then the `stop` questions, `openFindings` and `outside[]` as `#P` items with
Risk and Effort; the outside items are never fixed in this change without the owner's yes. Then `/commit`, and `pr-create` when asked.

## Do

1. Triage (§1), then the one question round (§2).
2. S or docs only: §3. M, L: §4.
3. Tests by level (§5), then the verdict (§6).

## Traps

1. The plan grows during `build` → a new task is a new plan and a new ok, not an edit in flight.
2. A repro test written after the fix was never red → revert the fix, run it red, restore.

## References

- `references/scenarios.md` — before the change: the section of the chosen scenario only.
- `references/perf-baseline.md` — scenario `perf`, or any claim of "faster".
