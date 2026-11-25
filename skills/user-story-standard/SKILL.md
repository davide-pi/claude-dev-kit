---
name: user-story-standard
description: >-
  Use when writing, splitting or reviewing a user story, PBI, bug, impediment or TECH item, or its
  acceptance criteria, or describing a feature or malfunction ("non so se è un bug"); not translation.
---

# user-story-standard — the fixed shapes a work item's text must have

**Contract.** Item text in one of four shapes, acceptance criteria only after an explicit yes ·
never writes to the board, never fills a gap with an assumption · item text in the items language, chat in the chat language.

## When

Not for: putting items on the board, or which type fills a role (`azdo-cli`).

## Decide

### 1. Classify first — exactly one of four

| The request is | Role | Body | Criteria |
| --- | --- | --- | --- |
| an enhancement or new feature (*evolutiva*) | **User Story** | `Come … / voglio … / così da …`, nothing else | yes — only after asking |
| a malfunction with a clear expected behaviour | **Bug** | `Comportamento attuale` / `Comportamento atteso` | yes — only after asking |
| a doubtful situation to analyse or explain | **Impediment** | free Description ending on a `Da analizzare:` line | **never** |
| internal technical work, invisible to the end user (debt, refactoring, upgrade, infra, config) | **TECH** | free Description: what and why | **never** |

Unclear between two → **ask**; the role decides the shape, and a wrong shape is rewritten from
scratch. Full shapes, titles, what each must not contain, worked examples: `references/item-formats.md`.

### 2. Non-negotiables

| Rule | Detail |
| --- | --- |
| Criteria never ship with the story | story first, delivered; criteria in a later message, after a yes |
| Criteria format | section title `Criteri di accettazione`; `Dato che / Quando / E / Allora` (never Given/When/Then); labelled `AC01…` or `Scenario N`, never bullets or `1.` |
| No automatic refinement | a gap or a contradiction with known context (document, offer, decision) is a question, asked **before** writing |
| Clean block | nothing before or after the pasted criteria block; a note goes in the chat message |
| Fixed vocabulary | prose in the items language; `Criteri di accettazione`, `Dato che / Quando / E / Allora`, `Comportamento attuale / atteso`, `Come utente`, `Da analizzare:` verbatim; role names and CSV headers English |

### 3. Platform coverage — a project datum

Desktop, mobile or both, and whether behaviour differs, is settled once **per project**: use it if
known (memory, docs), else ask once and record it. It shapes a User Story's criteria and an
Impediment's or TECH's Description where there is a UI — never a Bug, already observed on one platform.

### 4. Criteria — User Story and Bug only

- What looks like one story often holds several: propose the split before any criteria.
- Distinct cases → `Scenario 1 – [titolo]`; otherwise `AC01`, `AC02`; optional `E` lines for an extra
  condition or outcome. Size: 3 to 5 for a simple case, precise enough to develop against, no duplication.
- Coverage grid, run silently, never printed: (1) happy path, (2) negative and error cases, (3) boundary
  (empty list, wrapping text, min/max, zero or many), (4) cross-cutting: device matrix per the platform
  datum, interface states (disabled, empty, error, hover/focus), conformance to the mock — cite the frame,
  use testable attributes (colour, shape, casing, spacing, order), never "il più X possibile" — and no
  regression nearby. Families 2-4 are the ones that come back as bugs in test.
- Uncovered pertinent family, or doubt it is pertinent: **one** chat note on the first proposal only,
  outside the block (*"Non ho previsto AC per i casi limite: è voluto o li integriamo?"*). The
  reviewer's removal of a family is final: never re-flag it, never re-insert it.
- Desktop and mobile differing (User Story only): same item, never one item per platform; label right
  after the title, `AC02 (Desktop)`, `Scenario 2 – [titolo] (Mobile)`; unlabelled holds for both.

## Do

1. Classify (§1); unclear → ask. Write title and body in the role's shape
   (`references/item-formats.md`), plain functional prose in the items language.
2. Deliver and stop: Story or Bug → ask whether to write the criteria; Impediment or TECH → ask
   for confirmation, offering nothing more.
3. On a yes: the `Criteri di accettazione` block (§4).
4. Hand it over paste-ready. To create the item: ask the owner to confirm the item table, call
   `azdo-cli`, assign the item to the owner, read it back. Write a bulk file only on a genuine
   request (`references/csv-import.md`).

## Traps

1. The item is created as `Product Backlog Item` and fails, or lands as the wrong type → the role was
   taken for the type name → roles map to types per project template; resolve through `azdo-cli`.
2. A Bug's criteria restate `Comportamento atteso` in one line → the grid was skipped → run families
   2-4 on the fix too: the neighbouring case is where the regression hides.

## References

- `references/item-formats.md` — before writing any body: the four roles in full, title rules, what
  each must not contain, the Impediment signal, a worked example each, a full criteria block.
- `references/csv-import.md` — only for a requested bulk-import file: headers per role, the Bug
  column mapping, quoting.
