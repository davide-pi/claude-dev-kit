# Delegation — when to fan out, the contract every agent returns, what never leaves

## Independence test — all four must be "no"

| Question | If yes |
| --- | --- |
| Do two tasks write the same file? | serialise them, or one worktree per agent (`branch-flow`) |
| Does one task's output decide another's approach? | sequential |
| Must they agree on an interface not yet written? | write the interface first, then fan out |
| Does a task need the conversation's history to be judged correct? | keep it — a fresh agent starts blind |

**Size by merge capacity, not spawn capacity**: 2-4 agents for distinct judgement, up to 6-8 for one
mechanical job over many targets, then waves. Unread reports are where fabricated success survives.
Spawn a wave in **one message**. Multi-lens review is already owned by `/code-review` and
`pr-review`; locating code by `investigator`; tests by `test-writer`.

## Output contract — pasted verbatim into every prompt

```text
Return exactly these sections, nothing else — no narrative, no restatement of the task.
Prose in Italian: your report is merged into one the user reads. Headings, file paths, commands,
quoted output, test names, category slugs and verdict values (CONFIRMED, PLAUSIBLE) stay verbatim.

## Scope
The one sentence of what you were asked, as you understood it.

## Files
One line per file: absolute path, (new|edited|unchanged), and what changed in it.

## Evidence
Per claim: the command you ran and the line of output that settles it, quoted.
Anything you did not run goes under Not verified, never here.

## Not verified
What you could not check, why, and the command that would check it. "none" is valid.

## Open questions
Decisions you had to guess: the guess and the alternative. "none" is valid.

## Out of scope
What you deliberately did not touch, and anything you noticed that another task owns.
```

Also in every prompt — the five things an agent cannot infer: the absolute paths it owns and must
not touch; the conventions skill by name; the verify command and what its output must show; the
forbidden operations (commit, push, migration, deploy); and that "zero findings" is acceptable.

## Never delegate

| Never | Because |
| --- | --- |
| integration and wiring | it needs every piece at once — the caller's job |
| the final review of merged output | reviewing N reports is what the caller exists for |
| `done-check` on the whole change | the gate does not delegate to the reviewed |
| anything needing the conversation's history | a fresh agent guesses, then reports the guess confidently |
| irreversible commands: migrations applied, deploys, pushes, deletes, cache flushes | blast radius, times N |
| deciding **what** to build | scope is the caller's; agents execute a decided scope |

## When a report is wrong — one correction round, never five

| Symptom | Move |
| --- | --- |
| misread scope | re-message once with the corrected scope in one sentence |
| right scope, small defect | fix it yourself |
| no quoted output ("tests pass") | re-run the command; unverified until you see output |
| evidence that does not match the repo | distrust the whole report, redo the task |
| two agents edited the same file | resolve it yourself; never a third agent to merge |
