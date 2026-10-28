---
name: user-story-standard
description: >-
  Use when writing, splitting or reviewing item text or criteria, or describing a feature or
  malfunction ("non so se è un bug"); not translation.
---

# user-story-standard — the fixed shapes a work item's text must have

**Contract.** Item text in one of four shapes, acceptance criteria only after an explicit yes ·
never writes to the board, never fills a gap with an assumption · item text in the items language, chat in the chat language.

## When

Not for: putting items on the board (`azdo-cli`, after the owner confirms the item table), which type
fills a role (`azdo-cli`).

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
| Criteria never ship with the story | story first, delivered; criteria in a later message, after a yes |
| Criteria format | section title `Criteri di accettazione`; `Dato che / Quando / E / Allora` (never Given/When/Then); labelled `AC01…` or `Scenario N`, never bullets or `1.` |
| Clean block | nothing before or after the pasted criteria block; a note goes in the chat message |
| Size | 3 to 5 criteria for a simple case, precise enough to develop against, no duplication |
| No automatic refinement | a gap or a contradiction with known context (document, offer, decision) is a question, asked **before** writing |

Language: prose is in the items language; the shape labels and keywords above (`Criteri di accettazione`, `Dato che / Quando / E / Allora`,
`Comportamento attuale / atteso`, `Come utente`, `Da analizzare:`) are fixed kit vocabulary, verbatim. Role
names, resolved type names and CSV headers stay English.

### 3. Interaction

- What looks like one story often holds several: propose the split **before** any criteria.
- The reviewer's removal of a family of criteria is final: never re-flag it, never re-insert it.
- An uncovered pertinent family gets **one** note in chat, on the first proposal only.

### 4. Platform coverage — a project datum

Desktop, mobile or both, and whether behaviour differs, is settled once **per project**: use it if
known (memory, docs), else ask once and record it. It shapes a User Story's criteria and an
Impediment's or TECH's Description where there is a UI — never a Bug. Why the two are never assumed
identical: `references/acceptance-criteria.md`.

## Do

1. Classify (§1); unclear → ask. Write title and body in the role's shape (`references/item-formats.md`), plain functional prose in the items language.
2. Deliver and stop: Story or Bug → ask whether to write the criteria; Impediment or TECH → ask
   for confirmation, offering nothing more.
3. On a yes: the `Criteri di accettazione` block (`references/acceptance-criteria.md`), the four
   coverage families as the grid, per-platform labels where behaviour differs.
4. Hand it over paste-ready; creation is `azdo-cli`, after the owner confirms the item table,
   assigned to the owner and read back after create. A bulk file only on a genuine
   request (`references/csv-import.md`).

```powershell
Set-Clipboard -Value (Get-Content .\item-body.txt -Raw)    # paste-ready handover
```

## Traps

1. An Impediment gets criteria → it read like a bug → it states what was observed, what does not
   add up and the question; a criterion presumes an expected behaviour nobody agreed.
2. Desktop and mobile share one generic criterion → the platform datum was never set → ask once per
   project, then label per platform inside the same item.

## References

- `references/item-formats.md` — before writing any body: the four roles in full, title rules, what
  each must not contain, the Impediment signal, a worked example each.
- `references/acceptance-criteria.md` — once criteria are confirmed: coverage families, one-shot
  signalling, `Scenario N` / `AC01`, per-platform labels, format and examples.
- `references/csv-import.md` — only for a requested bulk-import file: headers per role, the Bug
  column mapping, quoting.
