# Loop — launching `impl-review-loop`, and what to do with its answer

## Before the loop: the doubts pass (M and L)

Between the analysis and the loop, this session lists what the request leaves implicit: requirements, edge cases
(empty, first run, concurrent, failing dependency) and ambiguities. Only a doubt whose answer changes behaviour is a
question to the user: batched in one message, each with a recommendation. The rest the brief states as a decision, so
the implementer never guesses. On L, `grill-me` runs on the plan by default, not only when the design is argued.
S has no pass.

## The start point (before the first edit of the change, yours or the implementer's)

```powershell
git rev-parse HEAD                    # start.head
git rev-parse --show-toplevel         # repoRoot
git ls-files -m -o --exclude-standard # start.dirty: modified and untracked files, plain paths
git diff --name-only --cached         # start.dirty too: the staged ones
```

`start.dirty` is the union of the two lists, plain paths (not `git status --porcelain`, whose `XY` prefix,
quotes and rename arrows are not paths; the workflow strips them if they come anyway).

A file dirty here is the user's work. The workflow reviews only the files the change touched since this
point and never reverts a dirty file: an edit of the change in one, outside the perimeter, comes back as
"found elsewhere". A perimeter file that is already dirty → ask the user (continue on top of their edit,
or change the perimeter); on a yes, relaunch with `dirtyConfirmed: true`.

## Args

`Workflow` with `name: impl-review-loop` and

`{ brief, perimeter: { files, behaviour, exclusions }, repoRoot, start: { head, dirty }, size, implementerEffort, verify, stackSkill, touches }`

| Arg | Rule |
| --- | --- |
| `perimeter.files` | repo-relative paths, `dir/` or globs: the same entries as the perimeter file |
| `size` | `S`, `M` or `L` from the triage: it picks the reviewers (M one Opus high); re-derived upward every round from the files changed (2–4 M, 5+ L), never down; past 8 changed files reviewer A splits into one per group of 8 |
| `implementerEffort` | `high` only when the brief asks; default `medium` |
| `touches` | `security`, `performance`: M and L, adds the specialist reviewers |

## Size S: the session edits, the loop reviews

Edit inline (a few lines in one file; larger → `implementer`), then launch with
`inline: true, changed: [the files you edited]`. No implementer runs first; a finding is fixed by
`implementer` inside the loop, and the verdict stays short.

## STALL

`status: STALL` carries `stall.round`, `stall.why` (or the `why` of each finding), `stall.findings` (or
`stall.reason` when an agent returned nothing), `stall.history` (per finding: when it appeared, the fixes it went to,
when it closed or came back) and `resume`. Show the finding with its history, ask: **accept the risk and note it ·
one more round · change the approach**. Relaunch with `resumeFromRunId`, the same args, and **every** resolution so
far, one per stalled round:

`resolutions: [{ round, accept?: [ids], guidance?: "...", retry?: true, continue?: true, widen?: ["path/or/dir/"] }]`

`accept` takes the risk (it goes in the verdict), `retry: true` is one more round with no direction,
`guidance` is one more round with the user's direction. `continue: true` grants 3 more fix cycles, only on a
`cap` stall, and restarts the churn count on a `churn` stall; `widen` adds perimeter entries (below).

| `stall.why` | Meaning, and the question |
| --- | --- |
| `cap` | 3 fix cycles run (RECHECK and coverage reruns do not count): `continue` for 3 more, `accept`, or `guidance` |
| `churn` | the last 3 fixes each changed more lines: not converging. `continue` restarts the count; `accept` closes the ids the reviewers already read |
| `verify-failed` | the fixer could not make the verify command pass: `guidance` with a direction for the fixer, or relaunch without `verify`; `retry` alone replays the cached fixer report and stalls again, and `accept` is not offered |
| `green-to-red` | the verify passed, then a fix broke it: same question and answers as `verify-failed` |
| `verify-not-run` | `verify` was given and the run did not execute it: same question and answers as `verify-failed`; at `stall.round` 0 (the implementer did not run it) a resume replays the cached implementer report: relaunch WITHOUT `resumeFromRunId` |
| `still-open` | a finding is still open after its fix: `accept` the risk, `guidance` with a direction for the fixer, or `retry` for one more round |
| `reappeared` | a finding closed earlier is open again (also under a new id, a shifted line or a reworded title): same question and answers as `still-open` |
| `gap` | no reviewer read `stall.files`, or a specialist returned nothing: relaunch with the same resolutions (that reviewer runs again), or name the gap in the verdict |
| `widen` | a P1/P2 outside the perimeter in a file the change touched or causes: add the file (below) or `accept` it as out of scope |
| `disputed` | the fixer rejected the finding twice and the reviewer kept it |
| `not-reproduced` | the fixer could not reproduce it and the reviewer kept it with steps; never goes back to the fixer |

A red implementer verify at round 0 is not a stall: it becomes a synthetic P1 `V<n>` that heads the fixer's list; only `verify-not-run` can stall at round 0, and a round-0 stall replays the cached implementer report, so relaunch WITHOUT `resumeFromRunId`.

A `widen` is answered only on the user's yes: write the widened list (all entries, old and new) with
`perimeter.ps1 -Files`, then resume with `{ round, widen: [the new entries] }`; it applies from that round on. Without
the yes, `accept` it. Out-of-scope items the loop returns in `outOfScope` (`noticed` by the implementer or fixer, and
`scope-revert`: a hunk the brief did not require, reverted) go to the closing table as proposals.

A missing reviewer verdict is not a stall at first: the workflow asks again, only that id, and lists the gap under
`gaps`; two rounds in a row without a verdict on the same id is a stall (`why: "no-verdict"`), handled like any other.

Every reviewer and fixer prompt carries a tool-call budget. An agent that still stops without its structured
result (turn cap) counts as no answer: a reviewer is a `gaps` line, no reviewer at all or the implementer or fixer
is a `STALL` with `stall.reason`. So is a group reviewer that returned nothing while no whole-change reviewer
answered (size S/M, or L without B): the reason names the unreviewed files, never `OK`. Such files stay unread
across rounds: the next round asks that group's reviewer, and any whole-change reviewer, for them in full, not only
the delta of the fix.

If a resume replays a cached null implementer result (`stall.reason` says the implementer returned nothing),
relaunch WITHOUT `resumeFromRunId`.

## A red test after OK

The loop returned `OK`, then a matrix test fails. A resume does not apply (no stall to resume), and a
re-`start` taken now would count the change's own edits as the user's dirty files and skip them in review.
Relaunch WITHOUT `resumeFromRunId`, not inline (the implementer must run to fix it; size S too: `inline`
stays false), with:

- the original `start` (head and dirty from before the first edit) and `dirtyConfirmed: true`;
- `brief` = the failing output, then one line per finding already accepted: its id, `path`, title. The
  run starts with empty state and ids restart at `F1`, so the brief is the only memory; reviewers and the
  fixer read it as `Intent`, which stops an accepted finding from being reopened. No old `resolutions`.

## After OK: the mechanical scope check

The loop's `OK` is a verdict of the reviewers; this step checks the files themselves. Run, in the repo root, with the
start point's head and dirty files:

```powershell
node ~/.claude/hooks/scope-guard.js --check <start.head> --dirty 'a.cs,b.cs'   # --dirty only when start.dirty is not empty
```

Write `~` literally: the allow rules in `settings.json` match the command text, as for `perimeter.ps1` and
`snapshot.ps1` (the script every implementer and fixer run ends with; never run it yourself). Exit codes:

| Exit | Meaning |
| --- | --- |
| 0 | every changed file is inside the perimeter: go on to the matrix |
| 1 | the files printed are outside. To revert them: back to step 3 with them as the brief, relaunched as in "A red test after OK" (the original `start`, `dirtyConfirmed: true`, no `resumeFromRunId`). To keep one the user wants: `perimeter.ps1 -Files` with all entries, old and new, then a NEW run with the updated `perimeter.files` (no resolution: there is no stalled round) |
| 2 | usage error, git failure, or no active perimeter: nothing was checked, never read it as clean. Fix the cause (write the perimeter file) and run again |
