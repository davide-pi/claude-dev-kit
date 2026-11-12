# Stall — a run that returned `STALL`: what each one means and how to resume

Read only when `impl-review-loop` returns `status: STALL` (a `question` one included), or after a red test that follows an `OK`.

## Questions: the `question` stall

Every implementer call (tests-first, gate fix, reader-A fix, fix rounds), the fixer and the reviewers may return `questions: [{ text, default, why }]`: a behaviour choice the
owner would see (never an internal one); a reviewer's are a brief that departs from `request`, an edit that contradicts
a `decisions` line, a hunk the owner asked for that would be reverted as `scope`. Any question stops the run before the
fix or the review: `status: STALL`, `stall.why: "question"`, `stall.questions`, `stall.round` (0 for the implementer or
the preview, else the round of the fix or of the review). A question carries `reversible` and `axis`: reversible with a default, off the data, contract, money and security
axes, it never stalls: the run applies the default and reports it in `defaultsApplied`, which the verdict names. Only a
`stop` question reaches you. Ask every question in one message, each with its default as the recommendation. When the
user said not to be asked, apply every default and list each in the closing table as an open decision: that covers
`questions` only, never `accept` of a P1/P2 (the owner's alone) nor a scope revert of a hunk the owner asked for. Relaunch with the `answers` entry of the STALL section below; the implementer or fixer runs once
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
no cap on the rounds; `guidance` or `accept` on a `churn` or `not-converging`
round restarts its count, `retry` does not.

| `stall.why` | Meaning, and the question |
| --- | --- |
| `question` | see "Questions" above |
| `churn` | the last 3 fixes each changed more lines. `accept` closes the ids the reviewers already read; `guidance` or `retry` for another attempt |
| `not-converging` | after each of the last 3 fix rounds the open P1/P2 count (plus the open `V` finding) did not drop below its lowest of the rounds before: every fix closes one and the reviewers open another. Same answers as `churn` |
| `verify-failed` | the fixer could not make the verify command pass: `guidance` with a direction, or relaunch without `verify`; `retry` alone replays the cached fixer report and stalls again, `accept` is not offered |
| `green-to-red` | the verify passed, then a fix broke it: same as `verify-failed` |
| `verify-not-run` | `verify` was given and the implementer returned no parsable gate line: same as `verify-failed` |
| `gate-red` | a block's gate stayed red after its one fix call (`stall.reason` holds the gate line): relaunch as in "Gate stalls" below |
| `gate-timeout` | the gate said `red: timeout`: the run stalled twice on the test named in the line. Never green, never retried by the loop: relaunch as below with the direction in `brief` (fix or split the test, or a quieter command with `stuckMinutes: 0`) or without `verify` |
| `gate-running` | the gate still said `running` when the agent reported: run `node ~/.claude/scripts/gate.mjs --root <repoRoot> --wait` yourself, then relaunch as below with its line as the brief |
| `merge-conflict` | `lanes: true`: the lane branches conflict on merge. The gate aborted it (`stall.reason` says "untouched" only when the rollback worked, else the start branch may hold part of the merge: check `git status`); nothing was merged, each lane stays in its worktree and branch. Remove them with `gate.mjs --root <repoRoot> --lane-remove <branches>`, then relaunch WITHOUT `resumeFromRunId` with a brief that separates the lanes, or without `lanes` |
| `lane-setup` | `lanes: true`: a lane worktree was not created or the runner returned an unusable line (no path, or a branch outside `deliver-lane/`). The reason lists the worktrees already added: remove them with `--lane-remove`, then relaunch as for `gate-red` |
| `still-open` | a finding is still open after its fix: `accept`, `guidance` with a direction, or `retry` |
| `reappeared` | a finding closed earlier is open again (also under a new id, a shifted line or a reworded title): same as `still-open` |
| `no-verdict` | two rounds in a row without a reviewer verdict on the same id (one round is not a stall: only that id is asked again, and listed under `gaps`): same as `still-open` |
| `tests-changed` | the gate said `red: tests changed`: the implementer edited a test file proven red. Stops at once, no continuation: ask the user to accept the edit (run the gate once with `--force`) or revert it, then relaunch WITHOUT `resumeFromRunId` |
| `incomplete` | the implementer did not finish after 4 continuations (`stall.reason` names what is left and the files already changed): relaunch WITHOUT `resumeFromRunId`, with a smaller scope (split the plan into phases) or a higher `implementerEffort` |
| `gap` | no reviewer read `stall.files`, or a specialist returned nothing: relaunch with the same resolutions (that reviewer runs again), or name the gap in the verdict |
| `widen` | a P1/P2 outside the perimeter in a file the change touched or causes: on the user's yes write the widened list (old and new entries) with `perimeter.ps1 -Files` and resume with `{ round, widen: [the new entries] }` (it applies from that round on); else `accept` it as out of scope |
| `disputed` | the fixer rejected the finding twice and the reviewer kept it |
| `not-reproduced` | the fixer could not reproduce it and the reviewer kept it with steps; never goes back to the fixer |

**Lane stalls** (`lanes: true`): any stall raised while the lanes run (a lane's `gate-red`, `incomplete`, `question`, ...) keeps its own `why`, but its reason ends with the worktree path and branch of every lane, and `resume` says to ask the user: nothing is merged (no partial merge of the green lanes). Remove the lanes with `node ~/.claude/scripts/gate.mjs --root <repoRoot> --lane-remove deliver-lane/<name> ...` (force: unmerged work in them is lost), then relaunch WITHOUT `resumeFromRunId`. A merge that went through but could not remove a worktree or branch is no stall: the verdict has a `gaps` line naming them.

**Gate stalls** (`gate-red`, `gate-timeout`, `gate-running`, `tests-changed`, `incomplete`), from round 0 or a fix round: the block phase never reads `retry` or `guidance`, and a resume replays the cached reports. Relaunch WITHOUT `resumeFromRunId`, with the gate line or the user's guidance in `brief`.

A stall at round 0 (`verify-not-run` of the implementer, or `stall.reason` saying an agent returned nothing) replays the
cached implementer report: relaunch WITHOUT `resumeFromRunId`. An implementer with no report or a non-empty `remaining` is continued (twice at most), never reviewed partial. A red implementer verify at round 0 is no stall: it
becomes a synthetic P1 `V<n>` that heads the fixer's list. A reviewer or a fixer that stops without its structured
result (turn cap) counts as no answer: a reviewer is a `gaps` line, no reviewer at all or the fixer is a `STALL`.
`outOfScope` (`noticed` by the implementer or fixer, `scope-revert`: a hunk the brief did not require, reverted) goes
to the closing table as proposals.

## A red test after OK

The loop returned `OK`, then the final gate or a matrix test is red. There is no stall to resume, and a re-`start` taken now would count the
change's own edits as the user's dirty files. Log the previous run first with `perimeter.ps1 -LogRun` (`references/loop.md`, the findings log), then relaunch WITHOUT `resumeFromRunId`, not inline (size S too: `inline` stays
false), with the original `start` (head and dirty from before the first edit), `dirtyConfirmed: true`, and `brief` = the
failing output, then one line per finding already accepted (id, `path`, title): ids restart at `F1`, so the brief is the
only memory that stops an accepted finding from being reopened. No old `resolutions`.
