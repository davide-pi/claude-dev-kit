# Scenarios — what to prepare before the loop, and what ends it

One section per scenario of `deliver` triage; read only the one you chose. The preparation runs in the
main session and is written in the plan file, so it survives compaction.

## bug

| Step | Rule |
| --- | --- |
| cause | not proven → `debug-systematic` first; a fix with a known cause starts here |
| repro test | write the **failing test** that names the symptom (`dotnet-testing` / the stack's test skill), run it, keep the red output line |
| perimeter | the faulty unit and its test; the cause's neighbours are proposals, not edits |
| loop brief | the test name, the red line, the causal sentence |
| proof | `SKILL.md` step 4, then the suite of the touched project |

A repro test written after the fix was never seen failing: revert the fix, run it red, restore. A repro
that cannot be automated (timing, environment) is a proxy: say so, and ask the user to accept it or
prepare the environment.

## perf

| Step | Rule |
| --- | --- |
| baseline | before any edit, saved in the plan file (`perf-baseline.md`: runs, ratio, spread) |
| perimeter | the hot path named by the measurement, not a guess |
| loop brief | the baseline numbers and the target; "faster" with no number is not a brief |

## refactor

| Step | Rule |
| --- | --- |
| characterization | the tests that pin today's behaviour exist and are green; none → write them first, still green on the untouched code |
| public surface | note every public signature, route and serialized shape in the plan file |
| perimeter | the files being restructured and their tests; behaviour changes are excluded by definition |
| proof | `SKILL.md` step 4; no test edited to fit, `git diff` on the noted signatures empty |

A needed test edit means the behaviour changed: stop and ask the user.

## migration

| Step | Rule |
| --- | --- |
| before | row counts of every touched table, a sample read of the columns changing, saved in the plan file |
| script | the idempotent script read end to end before it runs (`evidence-by-stack.md`, SQL Server and EF Core) |
| apply | local database only, by this session. A non-local target is the user's call, asked before, every time |
| proof | counts after against counts before; the new shape read back; the old rows still readable |

The migration is created, never applied by the loop or a subagent.

## feature

| Step | Rule |
| --- | --- |
| preparation | none beyond the triage; the acceptance points in the plan file as the test matrix |
| proof | one test per acceptance point, named in the run; the stack's done row in `evidence-by-stack.md` |

## spike

| Step | Rule |
| --- | --- |
| claim | one testable line, a timebox said aloud |
| work | `plan-work` § Spike: scratch code outside the repo, read-only, never promoted |
| end | the verdict (yes, no, unknown and why), the probe deleted, `git status` unchanged. **Stop**: building the feature is a new triage |

A spike has no loop and no review. The perimeter is the probe itself.
