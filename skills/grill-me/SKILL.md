---
name: grill-me
description: >-
  Use when the user wants a plan or design scrutinized rather than executed — "grill me", "poke
  holes in this", "red-team my design", "play devil's advocate", "what am I missing?" — interviewing
  round by round until a Decision Summary.
---

# grill-me — interrogate the plan until every branch is decided

**Language.** The interview — questions, recommendations, pushback — and the Decision Summary are
**Italian**. Code, identifiers, paths and commands stay as they are.

## When

- The user asks for scrutiny, not execution: "grill me", "poke holes", "red-team", "devil's advocate".
- A design is already on the table and the question is whether it holds (`dev-loop` routes here).
- `workitem-create` escalates its Q&A because the work is ambiguous and decisions depend on each other.

Not for: designing the solution yourself, writing the plan (`plan-work`), or a bug (`debug-systematic`).

## Decide

The plan is a **decision tree**: every decision branches into the decisions that hang off it. The
**frontier** is every open decision whose prerequisites are already settled — the questions you can
ask now without guessing at answers you have not heard yet.

| Situation | Move |
| --- | --- |
| A fact the environment can answer (code, config, board, logs) | find it yourself — dispatch an `Explore` subagent for anything wider than one read; never ask the user |
| A fact is still being looked up | only the questions downstream of it wait; ask the rest of the frontier now |
| A decision | it is the user's — put it to them with your recommended answer, and wait |
| Question B depends on question A, both open | B belongs to a later round, never the same one |
| The answer is vague ("it should be fast") | push for the number, the owner, or the failure case in the next round |
| A round is answered | recompute the frontier: settled decisions unblock the ones that hung off them |
| A new question appears while resolving | add it to the tree; nothing is closed until it is walked |
| The user defers a point | record it as open, with what it blocks |

A recommendation answers one question; it is never a redesign of the plan.

## Do

1. Restate the plan as a decision tree (one line per branch) and confirm it.
2. Ask the **whole frontier in one round**, numbered, each question with its recommended answer, so
   the user can reply "ok" to the ones they accept and correct only the rest:

   ```markdown
   ❓ **D1 — <titolo>**: <la domanda, con le alternative se servono>

   ➡️ <risposta consigliata, e perché in una riga>

   ---

   ❓ **D2 — <titolo>**: ...
   ```

3. Wait for the answers, recompute the frontier, ask the next round. Repeat until the frontier is
   empty: every branch visited, nothing left silently assumed.
4. Output the **Decision Summary** (Italian):
   - each decision point and its resolution;
   - dependencies between decisions;
   - risks and trade-offs explicitly accepted;
   - open items deferred, and what each blocks.
5. Act on nothing until the user confirms the summary is the shared understanding.

## Traps

1. A redesign offered instead of an attack → the instinct to help → recommend per question, never
   rewrite the plan.
2. A dependent question in the same round as its prerequisite → the user answers it on a guess →
   it waits for the next round.
3. Asking what the code already says → wasted turn and credibility → read first, or send a subagent.
4. A round with no recommendations → the user has to think through every question from scratch →
   every question carries one.
5. Stopping when the user tires → the summary hides open branches → list them as deferred.
