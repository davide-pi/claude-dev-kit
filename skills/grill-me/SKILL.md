---
name: grill-me
description: >-
  Use when the user wants a plan or design scrutinized rather than executed — "grill me", "poke
  holes in this", "red-team my design", "play devil's advocate", "what am I missing?" — interviewing
  branch by branch until a Decision Summary.
---

# grill-me — interrogate the plan until every branch is decided

**Language.** The interview — questions, follow-ups, pushback — and the Decision Summary are
**Italian**. Code, identifiers, paths and commands stay as they are.

## When

- The user asks for scrutiny, not execution: "grill me", "poke holes", "red-team", "devil's advocate".
- A design is already on the table and the question is whether it holds (`dev-loop` routes here).
- `workitem-create` escalates its Q&A because the work is ambiguous and decisions depend on each other.

Not for: designing the solution yourself, writing the plan (`plan-work`), or a bug (`debug-systematic`).

## Decide

| Situation | Move |
| --- | --- |
| The codebase can answer it | explore and answer it yourself — never ask what a read settles |
| Two decisions depend on each other | resolve the upstream one first, then walk down |
| The answer is vague ("it should be fast") | push for the number, the owner, or the failure case |
| A branch is resolved | state the resolution in one line, move to the next |
| A new question appears while resolving | add it to the tree; nothing is closed until it is walked |
| The user defers a point | record it as open, with what it blocks |

One question at a time, relentless but specific: each question names the decision it settles.

## Do

1. Restate the plan as a decision tree (one line per branch) and confirm it.
2. Walk every branch, one question per turn, until each has a resolution.
3. Verify no new questions emerged, then output the **Decision Summary** (Italian):
   - each decision point and its resolution;
   - dependencies between decisions;
   - risks and trade-offs explicitly accepted;
   - open items deferred, and what each blocks.

## Traps

1. A redesign offered instead of an attack → the instinct to help → ask, do not propose.
2. Five questions in one message → one gets answered → one at a time.
3. Asking what the code already says → wasted turn and credibility → read first.
4. Stopping when the user tires → the summary hides open branches → list them as deferred.
