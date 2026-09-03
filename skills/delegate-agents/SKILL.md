---
name: delegate-agents
description: Decides whether work can be split across parallel subagents and how to spawn them so their reports merge. Covers the independence test, the output contract every agent must return, how many agents is too many, what must never be delegated (integration, the final review, the completion gate, anything needing the full conversation), and how to handle an agent that returns something wrong. Use when facing several pieces of work with no shared state or ordering, when closing a test gap over many files, when a search or an audit spans many areas, or when tempted to parallelise work that is actually sequential.
---

# delegate-agents — split work only where it is genuinely independent

## When

- Two or more pieces of work with no shared files, no shared decision, no ordering.
- The same mechanical job over many targets: tests for N classes, a pattern audited across N areas.
- A broad read-only sweep whose intermediate output would flood the main context.
- A review that wants distinct lenses at once (generalist, security, performance).

Not for: sequential work, wiring independent pieces together, the final review of merged output, the
completion gate, or anything whose correctness depends on the conversation so far. Parallelising
those costs more than it saves.

## Decide

### 1. The independence test — all four must be "no"

| Question | If yes |
| --- | --- |
| Do two tasks write the same file? | serialise them, or give each its own worktree |
| Does one task's output decide another's approach? | sequential — the second cannot start yet |
| Do they need to agree on a shared interface not yet written? | write the interface first, then fan out |
| Does the task need the conversation's history to be judged correct? | keep it; a fresh agent starts blind |

One "yes" and the work is not parallel. Splitting anyway produces reports that contradict each other
and cost more to reconcile than doing the work in order.

### 2. How many

| Shape | Agents | Why |
| --- | --- | --- |
| distinct areas, distinct judgement (review lenses, unrelated features) | 2-4 | each report is read in full |
| identical mechanical job, many targets (tests per class, docs per module) | up to 6-8 | reports are skimmed against one contract |
| more targets than that | batch: 6-8 per wave, next wave after merging | past that, merging is the bottleneck, not the work |

The limit is **merge capacity**, not spawn capacity. If N reports cannot be read carefully, N is too
high — and unread reports are exactly where a fabricated success claim survives.

### 3. The output contract — identical for every agent in a fan-out

Put it verbatim in each prompt. Same headings and same order in every one, so N reports collate
instead of needing N readings:

```text
Return exactly these sections, nothing else — no narrative, no restatement of the task:

Write the prose in Italian: your report is merged into one the user reads. The section headings
below, file paths, commands, quoted output, test names, category slugs and verdict values
(CONFIRMED, PLAUSIBLE) stay verbatim — they are the format, and translated evidence is not evidence.

## Scope
The one sentence of what you were asked, as you understood it.

## Files
One line per file: absolute path, (new|edited|unchanged), and what changed in it.

## Evidence
Per claim: the command you ran and the line of output that settles it. Quote the output.
Anything you did not run goes under Not verified, never here.

## Not verified
What you could not check, why, and the command that would check it. "none" is a valid answer.

## Open questions
Decisions you had to guess. Name the guess and the alternative. "none" is a valid answer.

## Out of scope
What you deliberately did not touch, and anything you noticed that another task owns.
```

Also give every agent: the exact file paths it owns, the paths it must not touch, the repo
conventions it must follow (or the skill that carries them, by name), and the definition of done for
its change type. An agent cannot see the conversation, the other agents, or their reports — anything
shared has to be in the prompt.

Spawn the whole wave in **one message** with several tool calls; sequential spawns are just slower
serial work. For write-heavy fan-outs on the same repo, give each agent its own worktree so their
edits cannot collide.

### 4. Never delegate

| Never | Because |
| --- | --- |
| integration and wiring | it needs every piece at once — that is the caller's job |
| the final review of merged output | reviewing N reports is what the caller exists for |
| `done-check` on the whole change | the gate is the review; it does not delegate to the reviewed |
| anything needing the conversation's history | a fresh agent guesses, then reports the guess confidently |
| irreversible commands: migrations applied, deploys, pushes, deletes, cache flushes | blast radius, times N agents |
| deciding **what** to build | scope belongs to the caller; agents execute a decided scope |

### 5. When an agent returns something wrong

One correction round, never five.

| Symptom | Move |
| --- | --- |
| misread the scope | re-message that agent with the corrected scope in one sentence; once |
| right scope, small defect | fix it yourself — cheaper than a round trip |
| evidence missing or vague ("tests pass") | re-run the command yourself; treat the claim as unverified until you see output |
| evidence that does not match the repo (a test file that is not there, a command that fails) | distrust the whole report and redo the task yourself |
| two agents edited the same file | you resolve it; never send a third agent to merge |
| second attempt also wrong | the task was under-specified: take it back, and fix the prompt before ever reusing it |

## Do

```powershell
# what a fan-out can safely own: files nobody else is touching
git status --short                                  # dirty files are shared state — settle them first
Get-ChildItem -Recurse -Filter *Service.cs .\src |
  Select-Object -ExpandProperty FullName            # the target list, one agent per batch

# isolate write-heavy agents
git worktree list
```

Then, in one message, spawn each agent with: its scope, its file list, the paths it must not touch,
the conventions skill by name, and the output contract above verbatim. On return: read every report,
re-run the evidence lines that matter, merge, then run `done-check` yourself over the merged result.

## Traps

1. "These are independent" without checking → the shared file is discovered at merge time → run all
   four questions of the independence test, explicitly.
2. Reports in N different shapes → the contract was paraphrased per agent → paste it verbatim,
   identically, or merging costs more than the fan-out saved.
3. A confident report with no output quoted → agents describe intent as achievement → no quoted
   output means not verified; re-run it.
4. Ten agents, two reports read → spawning felt cheap → cap at what can be read; unread reports are
   worse than serial work, because they look done.
5. An agent asked to also integrate its part → it seemed adjacent → it cannot see the other parts;
   integration stays with the caller.
6. A fix loop that never converges → each round adds context the agent lacks → one correction round,
   then take it over.
7. An agent commits or pushes → nobody told it not to → state the forbidden operations in the
   prompt; "read-only" and "do not commit" are cheap lines.
8. A report comes back in English → the contract was pasted without its language line → the prose is
   Italian and the machine fields verbatim; fix the prompt, not the report.

## References

- `references/fanout-patterns.md` — worked fan-outs (closing a test gap, auditing a pattern across
  a repo, multi-lens review, multi-repo sweep) with the prompt shape and the merge step; read it
  before the first fan-out of a given kind.
