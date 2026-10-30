# Loop extras — rounds read, the cleanup pass, scope-guard exit 1, `/retro`

Read when the owner asked a cleanup pass, `scope-guard.js` exited 1, a run is relaunched, or you need to know who
reads which round.

## Who reads which round

Round 1 is read by the whole panel; a later round by the reviewers that raised the open findings plus the watcher (Haiku at
low; at S that reviewer is the panel's own Sonnet, at high). The first round that would end `OK` after a review fix ran (the cleanup
pass does not count; never at S) is a final full read, always: reviewer A alone, once, on the WHOLE change since the start head (the
scope of round 1), every live finding id asked again. Its model and effort follow the summed review-fix churn: up to 30 lines Sonnet at medium, 31-50 Sonnet at high, over 50 (or a fix with no churn number) Opus at medium. Its findings loop back to fix and delta review.

Coverage: the watcher never counts as a whole reviewer (a Haiku read certifies no file and is never given the never-reviewed list); when files no whole reviewer read are left at that point, the final read goes FIRST and the coverage rerun is skipped (the
final read covers every file); only a file still unread after it gets the rerun (then a `gap` stall). With no final read due (S, or no review fix) the coverage rerun runs as soon as the round would end `OK`.

## The cleanup pass before OK (M, L)

Runs only with `cleanup: true` (the owner asks for it); by default the P3s stay in `minor` for the closing table. A round that would end `OK` with P3 findings inside the perimeter (not a `scope` hunk, not a `clean-code` split proposal, not one the
change does not cause in a file it did not touch) first runs one fix pass on them, then one review of that delta (the
watcher, Haiku at low); a second cleanup never runs. The result lists what the pass fixed under `cleaned` once the delta
review has read it; `minor` keeps the rest, and `outOfScope` the P3s outside the perimeter: all for the closing table.

## Scope check, exit 1

The files printed are outside. To revert them: back to step 3 with them as the brief, relaunched as in "A red test after OK" (`references/stall.md`). To keep one the user wants: `perimeter.ps1 -Files` with all entries, then a NEW run with the updated `perimeter.files` (no resolution: there is no stalled round).

## `/retro`

When the owner settles a `/retro`, append `{"retro":"<date>"}` to `findings.jsonl` (`references/loop.md`, the findings log).
