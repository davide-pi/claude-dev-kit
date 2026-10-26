# Loop — launching `impl-review-loop`, and what to do with its answer

## Before the loop: the doubts pass (M and L)

Between the analysis and the loop, list what the request leaves implicit: requirements, edge cases (empty, first run,
concurrent, failing dependency), ambiguities. Only a doubt whose answer changes behaviour is a question to the user,
batched in one message, each with a recommendation; the brief states the rest as a decision. S has no pass.

**Criteria** (M, L) cover the error path wherever the change has one: a rejection, an empty result, back to the form,
a concurrent run, a dependency down. UI or legacy code with no tests: the proof is a browser run (screenshot) or an
HTTP call, never "it compiles". `preview` is the default at M whenever the change has an owner-visible output.

**The challenger**, after the owner's ok and before the loop: one `Plan` agent. At M only when `risk` includes data,
money, contract or security (`model: sonnet`); at L always, `model: opus` (it replaces `grill-me`, which runs only when the owner asks). Input: the request, the approach, the
criteria, the perimeter. Output, at most 10 lines: a verdict `tenere` | `cambiare` | `scartare`, why, and the
alternative if any. Read-only, it never asks the user. Show it to the owner only when the verdict is `cambiare` or
`scartare`; `tenere` goes on silently.

## The start point (before the first edit of the change, yours or the implementer's)

```powershell
git rev-parse HEAD                    # start.head
git rev-parse --show-toplevel         # repoRoot
git ls-files -m -o --exclude-standard # start.dirty: modified and untracked files, plain paths
git diff --name-only --cached         # start.dirty too: the staged ones
```

`start.dirty` is the union of the two lists, plain paths (the workflow strips a `git status --porcelain` prefix if it
comes anyway). A dirty file is the user's work: the workflow reviews only the files the change touched since this
point and never reverts a dirty file (an edit of the change in one, outside the perimeter, comes back as "found
elsewhere"). A perimeter file already dirty → ask the user (continue on top of their edit, or change the perimeter);
on a yes, relaunch with `dirtyConfirmed: true`.

## Args

`Workflow` with `name: impl-review-loop` and
`{ brief, request, decisions, perimeter: { files, behaviour, exclusions }, repoRoot, start: { head, dirty }, size, risk, implementerEffort, verify, stackSkill, preview }`

| Arg | Rule |
| --- | --- |
| `request` | the owner's messages for this change, verbatim, beside `brief`: the round-1 reviewers and the final full read judge the change against both; a brief that departs from it comes back as a reviewer `question`, never a fix |
| `decisions` | the owner's decisions that touch the perimeter, one line each, in their words: every agent gets them; an edit that contradicts one is a `question` |
| `preview` | M, L with an owner-visible output: what to show (page, endpoint, report). The run stops after the implementer with a `question` stall; show a screenshot or sample and ask: "ok" goes on, anything else is a direction for one more implementer pass. The verdict carries a final screenshot of the same surface |
| `perimeter.files` | repo-relative paths, `dir/` or globs: the same entries as the perimeter file |
| `size` | `S`, `M` or `L` from the triage (panel: `SKILL.md` step 2). The file count never changes it: past 8 changed files reviewer A splits into one per group of 8, and more files than the size implies (S: 2+, M: 7+) is one `gaps` line. Mechanical batches (rename, move, config, generated) with tests are S |
| `risk` | the axes the change touches, from `logic`, `data`, `money`, `concurrency`, `contract`, `security`, `performance`. They raise the size floor, never lower it: data, money, concurrency, contract or security → at least M; three or more axes → L. `security` and `performance` also add their specialist at M and L. `touches` (the old name) is still read as the same axes |
| `implementerEffort` | `high` only when the brief asks; default `medium` |

Round 1 is read by the whole panel; a later round by the reviewers that raised the open findings plus one Sonnet at
medium (at S that Sonnet is the panel). The first round that would end `OK` after a review fix ran (never at S) is a
final full read: the whole panel, once, on the cumulative fix diff, unless every panel reviewer already read every fix
delta (M with one fix round: the finder read it, so none runs; L where only A found it: B never read it, so it runs).

**Size S**: edit inline (a few lines in one file; larger → `implementer`), then launch with
`inline: true, changed: [the files you edited]`. No implementer runs first; a finding is fixed by `implementer` inside
the loop. S has no final full read, no cleanup pass, no preview stop, no proof check.

## Verify pre-check

Before the launch, run `verify` once on the start tree. An environment failure (command, tool or config not found, restore or
build infrastructure error) → stop: fix the command or ask the user; never launch with a verify that cannot run. An expected
red (the bug scenario's repro test) is fine: note it. A fixer meeting an environment failure of the verify changes no code for it.

## One run per coherent request (P-run)

A run has a large fixed cost whatever its size: launch once per coherent request. The cost is not measured yet; the
findings log, with its `tokens`, will measure it. One implementer works through the plan tasks in order, testing after each; the
reviewers read the whole diff once. Split into sequential runs (phases) past 3-4 plan tasks or ~600 changed lines expected, or
for areas that share nothing (other reviewers, other verify): same worktree, `/commit` between them, each with its own `start`.
The implementer aims at 30 turns and stops itself at 50 tool calls, reporting what's left; a fresh one continues from its edits with a
clean context, up to four times (`stall.why: incomplete` after that: split the plan). It runs only the tests the change touches while it
works, and `verify` once at the end.

## Weight, criteria, proof

P-weight: a doubt or a choice reaches the owner only when it changes what the owner sees or uses, touches a contract
(API, event, schema) or data, costs or risks something, or goes against an owner decision. The rest the agents decide
and do not report; non-trivial choices the brief did not state come back as `defaults`, from reviewers too.

Criteria with proof (step 2): per criterion, the proof and what it asserts: an automated test; else run the thing
(browser screenshot, HTTP call, read-only query, CLI output); else "the owner tests". The matrix runs on the final
code, after the review: a fix can change what a proof proved. Proof check (M, L, before the verdict): read only the
assertion lines of each criterion's test (and the hunks behind `defaults` and any ledger contradiction); a proof that
cannot fail on the old code is `non verificato`. The verdict ends with "Test locale: proposta <chi/cosa>"; the owner decides.

## Questions and stalls

`status: STALL` (a `question` one too, `stall.why`) and a red test after `OK`: read `references/stall.md`; it holds each `why`, the `resolutions` and the resume.

## The cleanup pass before OK (M, L)

A round that would end `OK` with P3 findings inside the perimeter (not a `scope` hunk, not a `clean-code` split proposal, not one the
change does not cause in a file it did not touch) first runs one fix pass on them, then one review of that delta (one
Sonnet at medium); a second cleanup never runs. The result lists what the pass fixed under `cleaned` once the delta
review has read it; `minor` keeps the rest, and `outOfScope` the P3s outside the perimeter: all for the closing table.

## After OK: the mechanical scope check

The loop's `OK` is the reviewers' verdict; this step checks the files. In the repo root, with the start point:

```powershell
node ~/.claude/hooks/scope-guard.js --check <start.head> --dirty 'a.cs,b.cs'   # --dirty only when start.dirty is not empty
```

Write `~` literally, as for `perimeter.ps1`. `snapshot.ps1` is the script every implementer and fixer run ends with; never run it yourself.

| Exit | Meaning |
| --- | --- |
| 0 | every changed file is inside the perimeter: go on to the matrix |
| 1 | the files printed are outside. To revert them: back to step 3 with them as the brief, relaunched as in "A red test after OK". To keep one the user wants: `perimeter.ps1 -Files` with all entries, then a NEW run with the updated `perimeter.files` (no resolution: there is no stalled round) |
| 2 | usage error, git failure, or no active perimeter: nothing was checked, never read it as clean. Write the perimeter file and run again |

## The findings log and the defaults

Every result carries `findingsLog` = `{ size, rounds, findings: [{ category, priority, path, closed }] }`, cumulative over
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
findings). Before a relaunch WITHOUT `resumeFromRunId` (a red test after `OK`, scope-guard exit 1: a new run with empty
state) `-LogRun` the previous run; the perimeter stays active. The last run of the change closes it. When the owner
settles a `/retro`, append `{"retro":"<date>"}` to the file.

`defaults` ([{ choice, alternative, path }]) go in the verdict under "Default scelti"; read the hunks behind them in the
proof check. A file that grew past 600 lines (or 200+ and grew 30%) comes back in `outOfScope` as a `growth` split
proposal (P3 `clean-code`), from the snapshot's line counts: it is no finding and no reviewer is asked for it.

## The verdict

The verdict, a table `done-claim` accepts as evidence (third cell looks like output: a digit, ok, verde, green, passed, failed, exit, succeeded), emitted as a plain markdown table, never inside a code fence. Example:

| Livello | Comando | Riga che decide | Stato |
| --- | --- | --- | --- |
| unit | dotnet test Orders.Tests | Passed: 48, Failed: 0 | fatto |
| e2e | - | - | non verificato: serve staging |

Review: giro 2, 0 P1/P2 aperti. Gap: <gaps, o nessuno>. Rischi residui: <elenco, o nessuno>. Default scelti: <defaults, o nessuno>. Test locale: proposta <chi/cosa>.

States: `fatto`, `non verificato: <motivo>`, `failed`; S gets two or three lines. Close with everything outside the
perimeter (`outOfScope` with `noticed`, `scope-revert` and growth proposals, `minor`, open questions), `#` stable; the user picks:

| # | Proposta | Motivo | Rischio |
| --- | --- | --- | --- |
