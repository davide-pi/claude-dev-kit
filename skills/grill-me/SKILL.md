---
name: grill-me
description: >-
  Use when the user wants a plan or design scrutinized rather than executed — "grill me", "poke
  holes in this", "red-team my design", "play devil's advocate", "what am I missing?" — interviewing
  round by round until a Decision Summary.
---

# grill-me — interrogate the plan until every branch is decided

**Language.** The interview — questions, options, recommendations, pushback — and the Decision
Summary are **Italian**. Code, identifiers, paths and commands stay as they are.

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
| An answer shows an earlier round was asked on a wrong premise | reopen that branch in the next round, saying why |
| A new question appears while resolving | add it to the tree; nothing is closed until it is walked |
| The user defers a point | record it as open, with what it blocks |
| The user asked for one question at a time | one question per call, same tool |

A recommendation answers one question; it is never a redesign of the plan.

## Do

1. Restate the plan as a decision tree (one line per branch) and confirm it.
2. Ask the **whole frontier in one round** through the **`AskUserQuestion` tool** — never as text
   printed in chat, which the user has to answer by retyping. One call holds up to 4 questions;
   a bigger frontier is several calls in a row, all in the same round.

   | Field | Content |
   | --- | --- |
   | `header` | `D<n> <topic>`, ≤ 12 characters — the number survives into the summary |
   | `question` | the full question, ending in `?`, with the context needed to decide |
   | `options` | 2–4 real alternatives; **the recommended one first**, its label ending in `(Consigliata)`, its `description` giving the reason in one line; each other option's trade-off in its `description` |
   | `multiSelect` | `true` only when the choices genuinely combine |
   | `preview` | only to compare concrete artefacts: code shapes, layouts, configs |

   The tool always adds a free-text "Other": never add one yourself. A genuinely open question
   (a number, a name) still gets 2–4 plausible values, the recommended one first.
3. Read the answers, recompute the frontier, ask the next round. Repeat until the frontier is
   empty: every branch visited, nothing left silently assumed.
4. Output the **Decision Summary** (Italian):
   - each decision point (`D<n>`) and its resolution;
   - dependencies between decisions;
   - risks and trade-offs explicitly accepted;
   - open items deferred, and what each blocks.
5. Act on nothing until the user confirms the summary is the shared understanding — an empty
   frontier is not that confirmation.

**Tool unavailable** (a subagent, a non-interactive run, a denied call) → fall back to printed
rounds, worded so "sì" accepts the recommendation:

```markdown
❓ **D1 — <titolo>**: <la domanda, con le alternative se servono>

➡️ <risposta consigliata, e perché in una riga>

---

❓ **D2 — <titolo>**: ...
```

## Traps

1. Questions printed in chat while the tool is available → the user retypes every answer → every
   round goes through `AskUserQuestion`.
2. A redesign offered instead of an attack → the instinct to help → recommend per question, never
   rewrite the plan.
3. A dependent question in the same round as its prerequisite → the user answers it on a guess →
   it waits for the next round.
4. Asking what the code already says → wasted turn and credibility → read first, or send a subagent.
5. No option marked `(Consigliata)` → the user has to think every question through from scratch →
   every question carries one, listed first.
6. A recommendation that argues against its own question → agreeing means answering "no" → phrase
   the question so the recommended option is the affirmative one.
7. Stopping when the user tires → the summary hides open branches → list them as deferred.
8. Building as soon as the frontier empties → the confirmation gate skipped → wait for the "ok" on
   the summary.

## References

None — the skill is self-contained.
