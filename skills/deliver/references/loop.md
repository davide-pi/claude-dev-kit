# Loop — launching `dev-loop`, and what to do with its answer

Before the loop (M, L): facts first, doubts pass, criteria and challenger: `references/analysis.md`.

## The start point (before the first edit of the change, yours or the implementer's)

```powershell
git rev-parse HEAD                    # start.head
git rev-parse --show-toplevel         # repoRoot
git ls-files -m -o --exclude-standard # start.dirty: modified and untracked files, plain paths
git diff --name-only --cached         # start.dirty too: the staged ones
```

`start.dirty` is the union of the two lists, plain paths. A dirty file is the user's work: the workflow never reverts
it (an edit of the change in one, outside the perimeter, comes back as "found elsewhere"). A perimeter file already
dirty → ask the user (continue on top of their edit, or change the perimeter); on a yes, relaunch with `dirtyConfirmed: true`.

## Args

`Workflow` with `name: dev-loop` and
`{ brief, request, decisions, perimeter: { files, behaviour, exclusions }, repoRoot, start: { head, dirty }, plan, unit, testSkill, stuckMinutes, size, risk, mechanical, implementerEffort, implementerModel, cleanup, verify, stackSkill, preview, lanes }`

| Arg | Rule |
| --- | --- |
| `request` | the owner's messages for this change, verbatim, beside `brief`: the readers judge the change against both; a brief that departs from it comes back as a reviewer `question`, never a fix |
| `plan` | `{ tasks: [{ id, title, files, dependsOn, tdd, criteria }] }` (`references/analysis.md`). Absent: one block holding one task named after the brief. A cycle or an unknown id refuses the plan |
| `unit` | the unit-test command; without it no block is test-first. A `'` in it or in `verify` is refused (both go to the gate in single quotes) |
| `testSkill` | the test skill the test-first call reads (`dotnet-testing`) |
| `stuckMinutes` | default 5, passed to the gate; 0 turns the stuck check off for a command known to be quiet |
| `decisions` | the owner's decisions that touch the perimeter, one line each, in their words: every agent gets them; an edit that contradicts one is a `question` |
| `preview` | M, L with an owner-visible output: what to show (page, endpoint, report). The run stops after the implementer with a `question` stall; show a screenshot or sample and ask: "ok" goes on, anything else is a direction for one more implementer pass. The verdict carries a final screenshot of the same surface |
| `perimeter.files` | repo-relative paths, `dir/` or globs: the same entries as the perimeter file |
| `size` | `S` from the triage, or omit. M and L are computed from the blocks (no plan: one block, M); a passed `M` or `L` that disagrees is one `gaps` line. The file count never changes it, and every reader reads the whole change (never a split); more files than S implies (2+) is one `gaps` line. Mechanical batches (rename, move, config, generated) with tests are S |
| `risk` | the axes the change touches, from `logic`, `data`, `money`, `concurrency`, `contract`, `security`, `performance`. Data, money, concurrency, contract or security lift S to M; reader B runs on Opus with `security` or `data`, and with three or more axes besides `logic` (never a bigger size). An axis is one the change alters: a guard that keeps something unchanged ("the numbers stay identical") is a test, not an axis. `security` and `performance` also add their specialist at M and L |
| `mechanical` | `true` for an S batch with no judgment in it (rename, move, split, config, generated, label updates) the tests fully cover: implementer on `haiku` at `low`, reviewer at `low`. Needs `size: 'S'` (a missing size is M) and never goes with `inline`; a risk axis that lifts the size drops it |
| `implementerEffort` | `high` only when the brief asks; default `medium` (`low` with `mechanical`) |
| `implementerModel` | only to override, on the implementer and every fix run; default: the agent's own model (`haiku` with `mechanical`) |
| `lanes` | `true` to run independent task groups (no shared file or dependency, from `plan`) in parallel git worktrees: needs `verify`, 2+ lanes and 2+ tasks outside the largest, else serial (one `gaps` line without `verify`, or when a task shares a file with `start.dirty`: a lane is cut from `start.head` and would not see that edit). Each lane runs its own blocks (gate `--no-scope`, reader A per block); then `gate.mjs --merge` merges the lane branches and runs tests and scope. The merge is refused (exit 2) on a start tree with staged changes or uncommitted edits in a file a lane changes. A conflict is aborted and stalls with `why: merge-conflict` and the files; a failed worktree set-up stalls with `why: lane-setup`; a stall inside a lane keeps its `why` and names the lane worktrees. Lanes left after a stall are removed with `gate.mjs --lane-remove` (see `stall.md`). Lanes buy time, not money |
| `cleanup` | `true` only when the owner asks for the P3 cleanup pass (M, L); default: the P3s go to the closing table |

Who reads what, and the cleanup pass: `references/loop-extras.md`. Phases: Implement, Block review, Final verification, Fix.

**Size S**: above ~120k of context (the statusline shows it) launch without `inline` and the implementer makes it; else edit inline, then launch with `inline: true, changed: [the files you edited]`; a mechanical batch is never
edited inline: launch with `mechanical: true` and the implementer makes it. Inline, no implementer runs first; a finding is fixed by `implementer` inside the loop. S has no block review, no cleanup pass, no preview
stop, no proof check.

## Verify pre-check

Before the launch, run `verify` once on the start tree, through the gate with `--force`:
```powershell
node ~/.claude/scripts/gate.mjs --root <repoRoot> --head <start.head> --test "<verify>" --force
```
Exit 2 or an environment failure (command, tool or config not found, restore or build infrastructure error) → stop:
fix the command or ask the user; never launch with a verify that cannot run. An expected red (the bug scenario's repro
test) is fine: note it. The suite must print a line per test: the stuck check kills a quiet command. A fixer meeting an
environment failure of the verify changes no code for it.

## One run per coherent request

A run has a large fixed cost whatever its size: launch once per coherent request, the whole plan in `plan`. The loop
cuts it into blocks of up to 4 tasks, as even as possible (5 → 3+2), in dependency order; per block one implementer
(two with `tdd` tasks: the tests and the `--red` gate first, then the code), the gate, then reader A. The cut is by count only:
the analysis orders tasks so those on the same files are adjacent (a second agent pays the fixed context again). Parallel runs only for areas that share no file and no
test, each in its own worktree (`branch-flow`). Each implementer call has a turn budget (`min(35, 10 + 6 × tasks)`)
and runs the gate before it reports; a fresh one continues from its edits, up to four times (`stall.why: incomplete`
after that: split the plan). A `'` in `verify` or `unit` is refused, so the gate runs by hand; `"` is fine (`dotnet test --logger "console;verbosity=normal"` per test works through the loop). Test files proven red by `--red` are frozen for the code call.

## Weight, criteria, proof

P-weight: a doubt or a choice reaches the owner only when it changes what the owner sees or uses, touches a contract
(API, event, schema) or data, costs or risks something, or goes against an owner decision. The rest the agents decide
and do not report; non-trivial choices the brief did not state come back as `defaults`, from reviewers too.

Criteria with proof (step 2): per criterion, the proof and what it asserts: an automated test; else run the thing
(browser screenshot, HTTP call, read-only query, CLI output; UI or legacy code with no tests, never "it compiles"); else "the owner tests". The matrix runs on the final
code, after the review: a fix can change what a proof proved. Proof check (M, L, before the verdict): read only the
assertion lines of each criterion's test (and the hunks behind `defaults` and any ledger contradiction); a proof that
cannot fail on the old code is `not verified`. The verdict carries a Problems item "Local test: proposal <who/what>" (chat `it`: "Test locale: proposta <chi/cosa>"); the owner decides.

## After OK: the final gate, then the sweep

The loop's `OK` is the readers' verdict; this step runs the tests and checks the files, in the repo root:

```powershell
node ~/.claude/scripts/gate.mjs --root <repoRoot> --head <start.head> --test "<verify>" --dirty 'a.cs,b.cs'   # --dirty only when start.dirty is not empty
```

`snapshot.ps1` is the script every implementer and fixer run ends with; never run it yourself. The last stdout line is
one JSON object; `gate` says:

| `gate` | Meaning |
| --- | --- |
| `green` | tests passed, nothing outside the perimeter: go on to the matrix |
| `skipped: tree unchanged` | the last green stands for this tree, command and scope check: same as `green` |
| `red`, `red: timeout` | the tests failed, or stalled twice: relaunch with the gate line as the brief (`references/stall.md`) |
| `red: tests changed` | a test file proven red was edited after the proof: in a loop run, `STALL tests-changed` at once; the user accepts it (rerun with `--force`, which drops the stored proof) or reverts it |
| `red: scope` | `outside` lists the files: `references/loop-extras.md` |
| exit 2 | not checked (bad arguments, no repository, no active perimeter): never read it as clean. Write the perimeter file and run again |
| exit 3, `running` | output still growing: run it again with `--root <repoRoot> --wait` |

After the final gate, close what the run left behind (a rule decides, no model):

```powershell
node ~/.claude/scripts/sweep.mjs --root <repoRoot> --since <ISO time of the launch> --close
```

It closes only the process trees the gate recorded (pid and start time both match), plus the orphaned children of a gate shell that exited (ppid = the recorded pid, started after it); it exits 2 when it can't read the process table (nothing checked, never clean). It lists the other processes that
started during the run and name the work folder in their path or command line. Show that list to the owner and close
nothing on it. A process that doesn't name the folder is out of its reach.

## The result

`status` (`OK` or `STALL`) and the findings as before, plus `blocks: [{ id, tasks, gate, readerA: { raised, fixed,
carried } }]`, `carried: [{ block, id, priority, title, file, why }]`, `defaultsApplied: [{ block, question,
default }]` and `gaps`; a line such as `block <id>: red not proven` means the red proof of a test-first block failed
twice and its code went ahead. Put `defaultsApplied` in the verdict beside `defaults`.

## The findings log and the defaults

Every result carries `findingsLog` = `{ size, rounds, findings: [{ category, priority, path, title, closed }] }` (`title` cut to 80 chars), cumulative over
every finding the run saw. The log is written by `perimeter.ps1`, once per run, never by hand:

```powershell
pwsh -NoProfile -File ~/.claude/scripts/perimeter.ps1 -LogRun '<findingsLog as JSON>' -Run '<run id>' -Tokens <n>
pwsh -NoProfile -File ~/.claude/scripts/perimeter.ps1 -Close -FindingsLog '<findingsLog as JSON>' -Run '<run id>' -Tokens <n>
```

`-LogRun` appends the line and keeps the perimeter active (a run that is not the last of the change); `-Close
-FindingsLog` logs and closes in one call. The JSON goes in single quotes (inside them PowerShell doubles a single
quote). The line is appended to `$(git rev-parse --git-dir)/deliver/findings.jsonl` (never committed): the object plus
`at`, `run`, `minutes` (since the previous logged run's `at`, or `opened:` for the first) and `tokens` when given.
`-Tokens`: the `usage` / subagent tokens of the workflow's completion notification when it shows them, else omit it.
A bare `-Close` needs a run already logged since `opened:`; a change that never ran the loop closes with `-NoFindings`;
else exit 2 and the perimeter stays active (`done-claim` also sends back a verdict written while it is). Log once per
run, on an `OK` or a `STALL` the owner gives up on: never on a resume (the resumed run's last result holds its
findings). Before a relaunch WITHOUT `resumeFromRunId` (a red test after `OK`, gate `red: scope`: a new run with empty
state) `-LogRun` the previous run; the perimeter stays active. The last run of the change closes it. `/retro`: `references/loop-extras.md`.

`defaults` ([{ choice, alternative, path }]) go in the verdict as Decisions items tagged `— default` (below); read the hunks behind them in the
proof check. A file that grew past 600 lines (or 200+ and grew 30%) comes back in `outOfScope` as a `growth` split
proposal (P3 `clean-code`), from the snapshot's line counts: it is no finding and no reviewer is asked for it.

## The verdict

The verdict is the standing evidence table, emitted as a bold title line (`**Verification**`, chat `it`: `Verifica`) and a plain table, never quoted nor inside a code fence; `done-claim`
proves a `fatto` / `failed` row only when its deciding line is found in what the turn's tools printed. So that cell holds
output only, copied (`# pass 760`, or `` `True` / `True` `` for several), never a comment: counts and remarks ("6 files",
"all equal") go in the command cell. S gets two or three lines. Then:

Review: round 2, 0 open P1/P2. (chat `it`: `giro`, `P1/P2 aperti`.) Then sections by type, only the non-empty, each after `---`
with the title `**<Section> · <n>**` (one item alone: no title, no `---`), never inside `> ` or a code fence; ids stable:

| Section (chat `it`) | Id | Holds |
| --- | --- | --- |
| Decisions (`Decisioni`) | #D | each default chosen, head `**#D1 · <choice> (alternative <alt>)** — default`; open questions the owner must answer, blocking first |
| Problems (`Problemi`) | #I | gaps (a level or reviewer not run, with the reason), residual risks, the local-test proposal (who/what); by Severity |
| Proposals (`Proposte`) | #P | everything outside the perimeter (`outOfScope` with `noticed`, `scope-revert` and growth proposals, `minor`); by Risk; the user picks |

Item: head `**#I1 · <title>** — file:line` (file:line in code font), then one-line bullets (Context, Advice, axes); a decision or P1 item one axis per line
(`Severity **P1** — why`), any other all axes on one line (`Severity P2: why · Risk low: why · Effort S: why`); `none` → omit the section.
With 3+ items close with `| # | Item | Severity · Risk · Effort | For you |` (`Voce`, `Gravità`, `Rischio`, `Da te`), then `Reply …` and
`Questions pending: #D2` lines (`Rispondi …`, `Domande in attesa: #D2`).
