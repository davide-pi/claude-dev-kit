# Loop extras — rounds read, the cleanup pass, scope-guard exit 1, `/retro`

Read when the owner asked a cleanup pass, `scope-guard.js` exited 1, a run is relaunched, or you need to know who
reads which round.

## Who reads which round

Round 1 is read by the whole panel; a later round by the reviewers that raised the open findings plus one Sonnet at
medium (at S that Sonnet is the panel). The first round that would end `OK` after a review fix ran (never at S) is a
final full read: the whole panel, once, on the cumulative fix diff, unless every panel reviewer already read every fix
delta (M with one fix round: the finder read it, so none runs; L where only A found it: B never read it, so it runs).
It runs only when the review fixes changed more than 30 lines in all (a fix with no churn reported counts as over).

## The cleanup pass before OK (M, L)

Runs only with `cleanup: true` (the owner asks for it); by default the P3s stay in `minor` for the closing table. A round that would end `OK` with P3 findings inside the perimeter (not a `scope` hunk, not a `clean-code` split proposal, not one the
change does not cause in a file it did not touch) first runs one fix pass on them, then one review of that delta (one
Sonnet at medium); a second cleanup never runs. The result lists what the pass fixed under `cleaned` once the delta
review has read it; `minor` keeps the rest, and `outOfScope` the P3s outside the perimeter: all for the closing table.

## Scope check, exit 1

The files printed are outside. To revert them: back to step 3 with them as the brief, relaunched as in "A red test after OK" (`references/stall.md`). To keep one the user wants: `perimeter.ps1 -Files` with all entries, then a NEW run with the updated `perimeter.files` (no resolution: there is no stalled round).

## `/retro`

When the owner settles a `/retro`, append `{"retro":"<date>"}` to `findings.jsonl` (`references/loop.md`, the findings log).
