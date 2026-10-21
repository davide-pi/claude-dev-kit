---
name: user-story-standard
description: >-
  Use when a user story, PBI, bug, impediment or TECH item or its criteria are written, split or
  reviewed, also from a bare feature description.
---

# user-story-standard — the fixed shapes a work item's text must have

**Contract.** Item text in one of four shapes, acceptance criteria only after an explicit yes ·
never writes to the board, never fills a gap with an assumption · item text and chat Italian.

## When

- A User Story, PBI, Bug, Impediment or TECH item is written, reworded, split or reviewed.
- Acceptance criteria are written or reviewed, new or already on the board.
- The user describes a feature, a malfunction or something to analyse, without naming an item.

Not for: putting items on the board (`workitem-create`), which type fills a role (`azdo-cli`),
testing a built item (`items-qa`).

## Decide

### 1. Classify first — exactly one of four

| The request is | Role | Body | Criteria |
| --- | --- | --- | --- |
| an enhancement or new feature (*evolutiva*) | **User Story** | `Come … / voglio … / così da …`, nothing else | yes — only after asking |
| a malfunction with a clear expected behaviour | **Bug** | `Comportamento attuale` / `Comportamento atteso` | yes — only after asking |
| a doubtful situation to analyse or explain | **Impediment** | free Description ending on a `Da analizzare:` line | **never** |
| internal technical work, invisible to the end user | **TECH** | free Description: what and why | **never** |

Unclear between two → **ask**; the role decides the shape, and a wrong shape is rewritten from
scratch. These are **roles**, not type names: the type per project comes from `azdo-cli` (a PBI *is*
the User Story role; `Issue` is backlog on one template, analysis on another). Full shapes, titles,
what each must not contain, worked examples: `references/item-formats.md`.

### 2. Non-negotiables

| Rule | Detail |
| --- | --- |
| User Story = three lines | title plus `Come / voglio / così da`; no criteria, notes or alternatives in the body |
| Bug is problem-oriented | `Comportamento attuale`, `Comportamento atteso`; never "Come utente" |
| Impediment and TECH | one free Description, no criteria offered |
| Criteria never ship with the story | story first, delivered; criteria in a later message, after a yes |
| Criteria format | section title `Criteri di accettazione`; `Dato che / Quando / E / Allora` (never Given/When/Then); labelled `AC01…` or `Scenario N`, never bullets or `1.` |
| Clean block | nothing before or after the pasted criteria block; a note goes in the chat message |
| Size | 3 to 5 criteria for a simple case, precise enough to develop against, no duplication |
| No automatic refinement | a gap or a contradiction with known context (document, offer, decision) is a question, asked **before** writing |

Language: item content is Italian — shapes, labels, keywords, examples — by company standard. Role
names, resolved type names and CSV headers stay English.

### 3. Interaction

- What looks like one story often holds several: propose the split **before** any criteria.
- The reviewer's removal of a family of criteria is final: never re-flag it, never re-insert it.
- An uncovered pertinent family gets **one** note in chat, on the first proposal only.
- Impediment and TECH end on a confirmation request, offering nothing more.

### 4. Platform coverage — a project datum

Desktop, mobile or both, and whether behaviour differs, is settled once **per project**: use it if
known (memory, docs), else ask once and record it. It shapes a User Story's criteria and an
Impediment's or TECH's Description where there is a UI — never a Bug. Why the two are never assumed
identical: `references/acceptance-criteria.md`.

## Do

1. Classify (§1); unclear → ask.
2. Write title and body in the role's shape (`references/item-formats.md`), plain functional Italian.
3. Deliver and stop: Story or Bug → ask whether to write the criteria; Impediment or TECH → ask
   for confirmation.
4. On a yes: the `Criteri di accettazione` block (`references/acceptance-criteria.md`), the four
   coverage families as the grid, per-platform labels where behaviour differs.
5. Hand it over paste-ready; the board is `workitem-create`'s job. A bulk file only on a genuine
   request (`references/csv-import.md`).

```powershell
Set-Clipboard -Value (Get-Content .\item-body.txt -Raw)    # paste-ready handover
```

## Traps

1. An Impediment gets criteria → it read like a bug → it states what was observed, what does not
   add up and the question; a criterion presumes an expected behaviour nobody agreed.
2. A TECH gets the Impediment structure → "no criteria" was read as "same shape" → a TECH is what
   has to be done and why.
3. Desktop and mobile share one generic criterion → the platform datum was never set → ask once per
   project, then label per platform inside the same item.
4. A criteria set grows past what was agreed → an "obvious" gap was filled → it is a question.

## References

- `references/item-formats.md` — before writing any body: the four roles in full, title rules, what
  each must not contain, the Impediment signal, a worked example each.
- `references/acceptance-criteria.md` — once criteria are confirmed: coverage families, one-shot
  signalling, `Scenario N` / `AC01`, per-platform labels, format and examples.
- `references/csv-import.md` — only for a requested bulk-import file: headers per role, the Bug
  column mapping, quoting.
