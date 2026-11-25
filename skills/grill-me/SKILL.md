---
name: grill-me
description: >-
  Use when a plan or design must be attacked, not built: "grill me", "fammi le pulci", "poke holes",
  "attack this design".
argument-hint: "[the plan or design, or nothing to use the one under discussion]"
---

# grill-me — interrogate the plan until every branch is decided

**Contract.** Question rounds until no decision is open, then a Decision Summary · builds nothing,
acts on nothing before the summary is confirmed · chat language; code and paths verbatim.

## When

Not for: designing the solution yourself, writing the plan (`plan-work`), a bug (`debug-systematic`).

## Decide

The plan is a **decision tree**. The **frontier** is every open decision whose prerequisites are
settled: what can be asked now without guessing at answers not yet heard. Each round asks the whole
frontier, then recomputes it from the answers.

| Situation | Move |
| --- | --- |
| a fact the environment can answer (code, config, board, logs) | find it yourself, an `Explore` agent for anything wider than one read; never ask the user |
| a fact still being looked up | only the questions downstream of it wait; ask the rest now |
| a decision | the user's: ask it with your recommended answer, worded so "yes" accepts it |
| B depends on A, both open | B goes to a later round |
| a vague answer ("it should be fast") | next round: the number, the owner, or the failure case |
| an answer breaks an earlier premise | reopen that branch next round, saying why |
| the user defers a point, or tires | record it as deferred, with what it blocks |

A recommendation answers one question; it is never a redesign of the plan.

Every round goes through `AskUserQuestion`: header `D<n> <topic>` (≤ 12 characters, the number
survives into the summary), 2-4 real alternatives, the recommended one first with its reason, each
other with its trade-off. Up to 4 questions per call, more calls for a wider frontier; one per call
if the user asks. No tool: numbered questions in chat, recommended answer first.

## Do

1. Restate the plan as a decision tree, one line per branch; confirm it.
2. Ask the frontier, read the answers, recompute; repeat until it is empty.
3. Output the **Decision Summary**: each `D<n>` and its resolution, dependencies between decisions,
   risks explicitly accepted, deferred items and what each blocks.
4. Act on nothing until the user confirms the summary: an empty frontier is not that confirmation.

## Traps

1. A redesign offered instead of an attack → the instinct to help → recommend per question.
2. Asking what the code already says → a wasted round → read first, or send an agent.

Idea: the design tree, frontier and rounds follow `grilling` in mattpocock/skills (MIT).
