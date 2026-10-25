# Stall — a run that returned `STALL`: what each one means and how to resume

Read only when `impl-review-loop` returns `status: STALL` (a `question` one included), or after a red test that follows an `OK`.

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
cached implementer report: relaunch WITHOUT `resumeFromRunId`. An implementer with no report but changed files in the
perimeter is no stall: those files go to review, with a gap and a note that the work may be partial. A red implementer verify at round 0 is no stall: it
becomes a synthetic P1 `V<n>` that heads the fixer's list. A reviewer or a fixer that stops without its structured
result (turn cap) counts as no answer: a reviewer is a `gaps` line, no reviewer at all or the fixer is a `STALL`. A group
reviewer that returned nothing while no whole-change reviewer answered stalls naming the unreviewed files, never `OK`.
`outOfScope` (`noticed` by the implementer or fixer, `scope-revert`: a hunk the brief did not require, reverted) goes
to the closing table as proposals.

## A red test after OK

The loop returned `OK`, then a matrix test fails. There is no stall to resume, and a re-`start` taken now would count the
change's own edits as the user's dirty files. Log the previous run first with `perimeter.ps1 -LogRun` (`references/loop.md`, the findings log), then relaunch WITHOUT `resumeFromRunId`, not inline (size S too: `inline` stays
false), with the original `start` (head and dirty from before the first edit), `dirtyConfirmed: true`, and `brief` = the
failing output, then one line per finding already accepted (id, `path`, title): ids restart at `F1`, so the brief is the
only memory that stops an accepted finding from being reopened. No old `resolutions`.
