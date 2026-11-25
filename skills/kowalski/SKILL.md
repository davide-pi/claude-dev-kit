---
name: kowalski
description: >-
  Use when the user calls "kowalski", "kowalski, analisi!" or "analizza con kowalski" on a task, ticket or idea to
  analyse and plan it before any code: the name is the trigger.
argument-hint: "[analizza] [the request, or nothing to use the one under discussion]"
---
# kowalski — analysis: read, ask once, plan, hand over
**Contract.** An analysed task, every question answered in one round, atomic tasks the owner approved · never edits code · chat in the chat language, notes English.
## When
Not for: a plan without the name (`plan-work`), a code change (`deliver`), a bug (`rico`).
## Decide
- The request: the arguments, else the one under discussion; none → ask once.
- Asked to build, fix a bug or run tests → name the owner in one line, then call its skill: `skipper`, `rico`, `soldato`.
- Read the code through `investigator` or `Explore` subagents, so the main context stays small.
- Ask every open question in one `AskUserQuestion` round, a recommended answer on each.
- Draft the atomic tasks with `plan-work`. For an M or L change, one `Plan` subagent challenges the draft before the ok,
  as in `deliver` § 4 (at most 10 lines, each with `file:line` or the task id). An S change skips it.
- Fold the accepted points into the plan; the challenger's open questions join the one round. One challenger,
  one round: never a debate loop.
- Show the final plan and wait for the owner's ok.
- Ok given → hand the plan to `skipper`. No ok → revise, never start building.
## Do
1. Restate the request in one line, then fan out the reads.
2. Draft the plan, challenger (M, L), one question round, the final plan, the ok, then `skipper`.
## Traps
1. Questions trickled across turns → ask them all in the one round, the challenger's included.
## References
Name and idea borrowed from mikeleg/skills `kowalski` (MIT).
