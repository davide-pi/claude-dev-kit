# The Q&A pass

Gate 2 exists so the created items need no follow-up conversation. It ends when no **material**
doubt is left — not when the user runs out of patience, and not after a fixed number of questions.

## Two modes

| Mode | When | How |
| --- | --- | --- |
| **Targeted Q&A** (default) | the work is clear in shape, only details are missing | batch the questions: discrete choices as a structured question prompt, open ones in chat; few iterations |
| **Grilling** (escalation) | the work is complex or ambiguous, decisions depend on each other, or the user asks for it | the `grill-me` method: one question at a time, walk every branch, resolve dependencies before moving on |

Escalate mid-pass the moment an answer opens two new unknowns. De-escalating is fine too: once the
tree is walked, finish the details in one batch.

**Derive before asking.** Anything the images, the repository, the branch name or the conversation
already answer is not a question. Ask only what cannot be derived — and say what you derived, so a
wrong inference gets corrected instead of silently baked into an item.

## What every run must cover

| Area | The question behind it |
| --- | --- |
| Value | why this work exists, and for whom |
| Scope per item | exactly what each item does — the boundary between items, not just the sum |
| Out of scope | what must **not** be done, so the implementer does not expand the work |
| Acceptance criteria | how a reviewer proves it is done — their shape is `user-story-standard`'s |
| Technical constraints | files, APIs, patterns, versions to respect, data shapes, performance limits |
| Implementation hints | what the implementer would otherwise spend an hour discovering |
| Dependencies | order between the items, and blockers outside them |
| Edge cases | the empty, the concurrent, the failing and the very large case |
| References | related items, PRs, docs, designs |
| Images | which item each numbered image belongs to, and what it proves |

## Good choice questions

Ask as a discrete choice, not open prose, when the answer set is small and known:

- **How many items** — one, or a split (and if a split, the shape).
- **Role** — which of `user-story-standard`'s four the point is; the type comes later, at gate 4,
  and only from types discovery confirmed exist.
- **Hierarchy** — flat siblings under one parent, or a multi-level tree.
- **Priority / severity** — only if the board actually uses those fields.
- **State and assignment** — only when the user hints at something other than New and unassigned.

## Image handling

1. Number every image `IMAGE 1`, `IMAGE 2`, … at intake and give each a one-line caption of what it
   shows (a screen, an error, an expected layout, a schema).
2. Read them as **context**: they are usually the most precise part of the request.
3. Ask which item each belongs to only when it is genuinely ambiguous.
4. Every image ends up as a numbered placeholder in a body plus a row in the final attachment
   checklist — the user attaches them from the UI.

## Ending the pass

Before Table 1, state in one or two lines what was decided that the user did not say explicitly —
the derived split, a scope boundary, an assumed constraint. That line is the last cheap chance to
catch a wrong assumption; after it, the tables are the only gate left.

## Traps

1. Twelve questions in one message → the user answers four → batch by decision, not by field.
2. Asking what the image already answers → the images were skimmed → read them first, ask second.
3. Grilling a trivial one-item request → the escalation was applied by default → targeted Q&A is the
   default; grilling is earned by ambiguity.
4. A doubt deferred "to the implementer" → it resurfaces as a blocked item → an unresolved doubt is
   either a question now or an explicit open point written into the item.
5. The answers are never reflected back → the user cannot tell what was understood → the intake
   summary and the pre-Table-1 line exist for exactly that.
