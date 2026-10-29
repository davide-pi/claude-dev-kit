---
name: grill-me
description: >-
  Use when a plan or design must be attacked, not built: "grill me", "fammi le pulci", "poke holes",
  "attack this design", /grill-me.
argument-hint: "[the plan or design, or nothing to use the one under discussion]"
---

# grill-me — interrogate the plan until every branch is decided

**Contract.** Question rounds until the decision frontier is empty, then a Decision Summary ·
builds nothing, acts on nothing before the summary is confirmed · chat language; code and paths verbatim.

## When

Not for: designing the solution yourself, writing the plan (`plan-work`), a bug (`debug-systematic`).

## Decide

The plan is a **decision tree**; the **frontier** is every open decision whose prerequisites are
settled — what can be asked now without guessing at answers not yet heard.

| Situation | Move |
| --- | --- |
| a fact the environment can answer (code, config, board, logs) | find it yourself — an `Explore` agent for anything wider than one read; never ask the user |
| a fact still being looked up | only the questions downstream of it wait; ask the rest of the frontier |
| a decision | the user's: put it with your recommended answer, and wait |
| B depends on A, both open | B goes to a later round |
| a vague answer ("it should be fast") | next round: the number, the owner, or the failure case |
| a round answered | recompute the frontier |
| an answer breaks an earlier premise | reopen that branch next round, saying why |
| the user defers a point | record it as open, with what it blocks |
| the user wants one question at a time | one question per call, same tool |

A recommendation answers one question; it is never a redesign of the plan.

### Asking — `AskUserQuestion`, the whole frontier per round

| Field | Content |
| --- | --- |
| `header` | `D<n> <topic>`, ≤ 12 characters — the number survives into the summary |
| `options` | 2–4 real alternatives; the recommended one **first**, label ending `(Recommended)` (at chat `it`: `(Consigliata)`), `description` = the reason in one line; the others' trade-offs in theirs |

Up to 4 questions per call; a bigger frontier is several calls in the same round. An open question (a number, a name) still gets 2–4 plausible values.
Phrase each question so the recommended option is the affirmative one. Tool unavailable → numbered
questions in chat, recommended answer first, so a "yes" (in the chat language) accepts it.

## Do

1. Restate the plan as a decision tree, one line per branch; confirm it.
2. Ask the frontier; read the answers; recompute; repeat until the frontier is empty.
3. Output the **Decision Summary**: each `D<n>` and its resolution; dependencies between decisions;
   risks and trade-offs explicitly accepted; deferred items and what each blocks.
4. Act on nothing until the user confirms the summary — an empty frontier is not that confirmation.

## Traps

1. Questions printed in chat while the tool is available → the user retypes every answer → every
   round goes through `AskUserQuestion`.
2. A redesign offered instead of an attack → the instinct to help → recommend per question.
3. Asking what the code already says → wasted turn and credibility → read first, or send an agent.
4. Stopping when the user tires → the summary hides open branches → list them as deferred.

## References

None — the skill is self-contained.
