# Loop — launching `impl-review-loop`, and what to do with its answer

## Before the loop: the doubts pass (M and L)

Between the analysis and the loop, list what the request leaves implicit: requirements, edge cases (empty, first run,
concurrent, failing dependency), ambiguities. Only a doubt whose answer changes behaviour is a question to the user,
batched in one message, each with a recommendation; the brief states the rest as a decision. On L, `grill-me` runs on
the plan by default. S has no pass.

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
`{ brief, request, decisions, perimeter: { files, behaviour, exclusions }, repoRoot, start: { head, dirty }, size, implementerEffort, verify, stackSkill, touches, preview }`

| Arg | Rule |
| --- | --- |
| `request` | the owner's messages for this change, verbatim, beside `brief`: the round-1 reviewers and the final full read judge the change against both; a brief that departs from it comes back as a reviewer `question`, never a fix |
| `decisions` | the owner's decisions that touch the perimeter, one line each, in their words: every agent gets them; an edit that contradicts one is a `question` |
| `preview` | M, L with an owner-visible output: what to show (page, endpoint, report). The run stops after the implementer with a `question` stall; show a screenshot or sample and ask: "ok" goes on, anything else is a direction for one more implementer pass. The verdict carries a final screenshot of the same surface |
| `perimeter.files` | repo-relative paths, `dir/` or globs: the same entries as the perimeter file |
| `size` | `S`, `M` or `L` from the triage (panel: `SKILL.md` step 2); re-derived upward every round from the files changed (2–4 M, 5+ L), never down; past 8 changed files reviewer A splits into one per group of 8 |
| `implementerEffort` | `high` only when the brief asks; default `medium` |
| `touches` | `security`, `performance`: M and L, adds the specialist reviewers |

Round 1 is read by the whole panel; a later round by the reviewers that raised the open findings plus one Sonnet at
medium (at S that Sonnet is the panel). The first round that would end `OK` after a review fix ran (never at S) is a
final full read: the whole panel, once, on the cumulative fix diff.

**Size S**: edit inline (a few lines in one file; larger → `implementer`), then launch with
`inline: true, changed: [the files you edited]`. No implementer runs first; a finding is fixed by `implementer` inside
the loop. S has no final full read, no cleanup pass, no preview stop, no proof check.

## One run per coherent request (P-run)

A run costs a fixed ~350k subagent tokens whatever its size (4 tasks in one run ~160k each, 1 task per run ~470k):
launch once per coherent request. One implementer works through every plan task in order, testing after each; the
reviewers read the whole diff once. Split only past ~15 files or for areas that share nothing (other reviewers, other
verify): sequential runs in the same worktree, `/commit` between them, each with its own `start`. The implementer has no
tool-call budget; it runs only the tests the change touches while it works, and `verify` once at the end.

## Weight, criteria, proof

P-weight: a doubt or a choice reaches the owner only when it changes what the owner sees or uses, touches a contract
(API, event, schema) or data, costs or risks something, or goes against an owner decision. The rest the agents decide
and do not report; non-trivial choices the brief did not state come back as `defaults`.

Criteria with proof (step 2): per criterion, the proof and what it asserts: an automated test; else run the thing
(browser screenshot, HTTP call, read-only query, CLI output); else "the owner tests". The matrix runs on the final
code, after the review: a fix can change what a proof proved. Proof check (M, L, before the verdict): read only the
assertion lines of each criterion's test (and the hunks behind `defaults` and any ledger contradiction); a proof that
cannot fail on the old code is `non verificato`. The verdict ends with "Test locale: proposta <chi/cosa>"; the owner decides.

## Questions: the `question` stall

The implementer, the fixer and the reviewers may return `questions: [{ text, default, why }]`: a behaviour choice the
owner would see (never an internal one); a reviewer's are a brief that departs from `request`, an edit that contradicts
a `decisions` line, a hunk the owner asked for that would be reverted as `scope`. Any question stops the run before the
fix or the review: `status: STALL`, `stall.why: "question"`, `stall.questions`, `stall.round` (0 for the implementer or
the preview, else the round of the fix or of the review). Ask every question in one message, each with its default as
the recommendation. When the user said not to be asked, apply every default and list each in the closing table as an
open decision: that covers `questions` only, never `accept` of a P1/P2 (the owner's alone) nor a scope revert of a hunk
the owner asked for. Relaunch with the `answers` entry of the STALL section below; the implementer or fixer runs once
more with the answers as guidance (a reviewer's answer also reaches the later reviewers). Questions it asks again come
back in `outOfScope` as open decisions (`source: "implementer"`), not as a second stall.

## STALL

`status: STALL` carries `stall.round`, `stall.why` (or the `why` of each finding), `stall.findings` (or `stall.reason`
when an agent returned nothing), `stall.history` (per finding: when it appeared, the fixes it went to, when it closed or
came back) and `resume`. Show the finding with its history, ask: **accept the risk and note it · one more round ·
change the approach**. Relaunch with `resumeFromRunId`, the same args, and **every** resolution so far, one per stalled round:

`resolutions: [{ round, accept?: [ids], guidance?: "...", retry?: true, answers?: [{ text, answer }], widen?: ["path/or/dir/"] }]`

`accept` takes the risk (it goes in the verdict), `retry: true` is one more round with no direction, `guidance` one more
round with the user's direction, `answers` answer a `question` stall (each `text` copied unchanged, in the same entry as
that round's other resolution; the stall comes back while a question has none), `widen` adds perimeter entries. There is
no cap on the rounds and no `continue` (an old one is ignored); `guidance` or `accept` on a `churn` or `not-converging`
round restarts its count, `retry` does not.

| `stall.why` | Meaning, and the question |
| --- | --- |
| `question` | the implementer, a fixer or the reviewers left a behaviour question, or the `preview` is waiting: ask it and resume with `answers` |
| `churn` | the last 3 fixes each changed more lines. `accept` closes the ids the reviewers already read; `guidance` or `retry` for another attempt |
| `not-converging` | after each of the last 3 fix rounds the open P1/P2 count (plus the open `V` finding) did not drop below its lowest of the rounds before: every fix closes one and the reviewers open another. Same answers as `churn` |
| `verify-failed` | the fixer could not make the verify command pass: `guidance` with a direction, or relaunch without `verify`; `retry` alone replays the cached fixer report and stalls again, `accept` is not offered |
| `green-to-red` | the verify passed, then a fix broke it: same as `verify-failed` |
| `verify-not-run` | `verify` was given and the run did not execute it: same as `verify-failed` |
| `still-open` | a finding is still open after its fix: `accept`, `guidance` with a direction, or `retry` |
| `reappeared` | a finding closed earlier is open again (also under a new id, a shifted line or a reworded title): same as `still-open` |
| `no-verdict` | two rounds in a row without a reviewer verdict on the same id (one round is not a stall: only that id is asked again, and listed under `gaps`): same as `still-open` |
| `gap` | no reviewer read `stall.files`, or a specialist returned nothing: relaunch with the same resolutions (that reviewer runs again), or name the gap in the verdict |
| `widen` | a P1/P2 outside the perimeter in a file the change touched or causes: on the user's yes write the widened list (old and new entries) with `perimeter.ps1 -Files` and resume with `{ round, widen: [the new entries] }` (it applies from that round on); else `accept` it as out of scope |
| `disputed` | the fixer rejected the finding twice and the reviewer kept it |
| `not-reproduced` | the fixer could not reproduce it and the reviewer kept it with steps; never goes back to the fixer |

A stall at round 0 (`verify-not-run` of the implementer, or `stall.reason` saying an agent returned nothing) replays the
cached implementer report: relaunch WITHOUT `resumeFromRunId`. A red implementer verify at round 0 is no stall: it
becomes a synthetic P1 `V<n>` that heads the fixer's list. A reviewer or a fixer that stops without its structured
result (turn cap) counts as no answer: a reviewer is a `gaps` line, no reviewer at all or the fixer is a `STALL`. A group
reviewer that returned nothing while no whole-change reviewer answered stalls naming the unreviewed files, never `OK`.
`outOfScope` (`noticed` by the implementer or fixer, `scope-revert`: a hunk the brief did not require, reverted) goes
to the closing table as proposals.

## The cleanup pass before OK (M, L)

A round that would end `OK` with P3 findings inside the perimeter (not a `scope` hunk, not a `clean-code` split proposal, not one the
change does not cause in a file it did not touch) first runs one fix pass on them, then one review of that delta (one
Sonnet at medium); a second cleanup never runs. The result lists what the pass fixed under `cleaned` once the delta
review has read it; `minor` keeps the rest, and `outOfScope` the P3s outside the perimeter: all for the closing table.

## A red test after OK

The loop returned `OK`, then a matrix test fails. There is no stall to resume, and a re-`start` taken now would count the
change's own edits as the user's dirty files. Relaunch WITHOUT `resumeFromRunId`, not inline (size S too: `inline` stays
false), with the original `start` (head and dirty from before the first edit), `dirtyConfirmed: true`, and `brief` = the
failing output, then one line per finding already accepted (id, `path`, title): ids restart at `F1`, so the brief is the
only memory that stops an accepted finding from being reopened. No old `resolutions`.

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
every finding the run saw. Append ONE line per run, when the run ends: an `OK`, or a `STALL` the owner gives up on. Never
on a resume (`resumeFromRunId`): the resumed run's last result holds its findings. A relaunch WITHOUT `resumeFromRunId`
(a red test after OK, scope-guard exit 1) is a new run with empty state: append the previous run's line first. The line
adds `at`, `run` (the run id) and `minutes`, as JSON in `$(git rev-parse --git-dir)/deliver/findings.jsonl` (never
committed). When the owner settles a `/retro`, append `{"retro":"<date>"}`. `defaults` ([{ choice, alternative, path }]) go in the
verdict under "Default scelti"; read the hunks behind them in the proof check.
