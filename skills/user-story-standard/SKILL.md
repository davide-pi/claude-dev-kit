---
name: user-story-standard
description: >-
  The company standard for what an Azure DevOps work item says: classifying a request into one of
  four roles — User Story, Bug, Impediment, TECH activity — the exact body shape each one must have,
  and how to write acceptance criteria in the mandatory Italian "Dato che / Quando / Allora" form
  under a section titled "Criteri di accettazione". These four are roles, not type names: the type
  created for each is resolved per project. Use whenever a user story, backlog item, PBI, bug,
  impediment, TECH item, technical-debt or refactoring task, item description or acceptance
  criteria has to be written, reworded, split or reviewed — including when the user only describes
  a new feature, a malfunction, or something to be analysed before a fix can be defined, without
  naming a work item at all. Also covers the four coverage families behind good criteria, platform
  coverage as a project-level datum, and the optional CSV bulk-import file. Item text is Italian by
  company standard; the skill's own guidance is English.
---

# user-story-standard — the fixed shapes a work item's text must have

## When

- A User Story, PBI, Bug, Impediment or TECH item has to be written, reworded or split.
- Acceptance criteria have to be written or reviewed, for a new item or one already on the board.
- The user describes a new feature, a malfunction, or something to be analysed before a fix can be
  defined — even without naming a work item, a story or Azure DevOps.
- Text already on the board does not follow the standard and has to be brought back to it.
- A bulk-import file is genuinely wanted instead of creating the items one by one.

Not for: putting items on the board — `workitem-create` owns how an item gets there (discovery, the
confirmation tables, the CLI calls) and this skill never restates any of it; reading an item that
already exists in order to plan the work (`workitem-analyze`); Azure DevOps CLI mechanics, auth,
verbs and which real type fills each role (`azdo-cli`); testing a built item against its criteria
(`items-qa`); hours (`worklog`).

## Decide

### 1. Classify first — exactly one of four

| The request is | Role | Body shape | Acceptance criteria |
| --- | --- | --- | --- |
| an enhancement or new feature (*evolutiva*) | **User Story** | `Come … / voglio … / così da …`, nothing else | yes — but only after asking |
| a malfunction with a clear expected behaviour (*malfunzionamento*) | **Bug** | `Comportamento attuale` / `Comportamento atteso` | yes — but only after asking |
| a doubtful situation to be analysed or explained (*questione da analizzare*) | **Impediment** | free Description closing on a `Da analizzare:` line | **never** |
| internal technical work, invisible to the end user (*attività tecnica interna*) | **TECH** | free Description, no fixed structure | **never** |

If it is not clear which of the four applies, **ask**. Never pick the most likely one and proceed:
the role decides the body shape, and a wrong shape has to be rewritten from scratch.

**These four are roles — the company's standard for the content — not Azure DevOps type names.** The
work item **type** created for each is resolved per project through `azdo-cli`: it follows the
process template and the mapping is not one-to-one — a Product Backlog Item *is* the User Story
role, while `Issue` is the backlog item on one template and the analysis item on another. Resolve
the type before creating anything; never read a name found on a board as the role it looks like.

Full shapes, titling rules, what each role must **not** contain, and worked examples:
`item-formats.md`.

### 2. Non-negotiables

| Rule | Detail |
| --- | --- |
| Italian item text | every shape, field label and keyword below stays Italian — see *Language* |
| The three lines and nothing else | a User Story body is title plus `Come / voglio / così da`; no criteria, no notes, no alternatives, no explanation |
| A Bug is problem-oriented | `Comportamento attuale` and `Comportamento atteso`; never "Come utente" |
| Impediment and TECH have no criteria | a single free Description; do not offer criteria as an extra |
| Criteria never ship with the story | write the story, deliver it, then **ask** — see *Interaction* |
| `Criteri di accettazione` | the section title, exactly that, on its own |
| `Dato che / Quando / E / Allora` | never Given/When/Then; the `E` lines are optional |
| `AC01`, `AC02` or `Scenario N` | never plain bullets, never a `1.` `2.` numbered list |
| A clean block | no explanation before or after the criteria block that gets pasted |
| 3 to 5 criteria for a simple case | precise enough to develop against, with no duplication |
| No automatic refinement | a gap is a question, never an assumption |

### 3. Interaction

- **Never generate the acceptance criteria together with the User Story.** Write the story, hand it
  over, then ask whether to proceed. Not politeness: what looks like one story very often contains
  several, and criteria written before the split are thrown away with it.
- **When the request contradicts context already known** — a document, an offer, a decision taken —
  **ask before writing**, not after. No automatic refinement, no filling a gap with an assumption.
- **Respect the reviewer.** If the PM removes or declines a family of criteria, that is an explicit
  and final decision: take it and move on. Never re-flag it and never quietly re-insert it later.
- An Impediment or a TECH ends on a confirmation request, with nothing offered in addition.

### 4. Platform coverage is a project-level datum

Desktop only, mobile only, or both — and whether the behaviour differs between them — is settled
once **per project**, not asked per item. Use it if already known (project memory or documentation).
Ask **once** if the project has never defined it, record it, and from then on apply it silently.

It applies to a User Story's criteria and to an Impediment's or a TECH's Description where there is
a user interface, never to a Bug — the reason, and why desktop and mobile may never be assumed
identical, is in `acceptance-criteria.md`.

### 5. Language — deliberately mixed, do not "fix" it

The item content this skill produces is **Italian**, because that is the company standard: the
shapes, the field labels, the `Dato che / Quando / Allora` keywords, the section title
`Criteri di accettazione` and every example. The skill's own prose — headings, rules and
explanations addressed to the model — is **English**, and so is machine text: the four role names,
whatever type a project resolves them to, and the CSV headers in `csv-import.md`.

## Do

1. Classify (section 1). Unclear between two roles → ask, then classify.
2. Write the title and the body in the shape that role requires (`item-formats.md`). Simple,
   functional Italian; no jargon without a real need.
3. Deliver it and stop. For a User Story or a Bug, ask whether to proceed with the criteria; for an
   Impediment or a TECH, ask for confirmation and offer nothing more.
4. Only on confirmation, write the `Criteri di accettazione` block (`acceptance-criteria.md`), using
   the four coverage families as a grid and labelling per platform where behaviour differs. On the
   **first** proposal only, a pertinent family with no criteria gets one note in chat, outside it.
5. Hand the block over clean and paste-ready. Getting it onto the board is `workitem-create`'s job.

```powershell
# Normally pasted or handed to workitem-create; only a genuine bulk import needs csv-import.md.
Set-Clipboard -Value (Get-Content .\item-body.txt -Raw)
```

## Traps

1. Criteria arrive with the story → they were generated in the same pass → the story is one message,
   the criteria a later one, after an explicit yes.
2. A story is really three → the request was written as one sentence → propose the split before any
   criteria; criteria on an unsplit story are wasted work.
3. A Bug body opens with "Come utente" → the User Story shape was reused → a Bug is
   problem-oriented: `Comportamento attuale`, then `Comportamento atteso`.
4. An Impediment gets criteria → it read like a bug → an Impediment states what was observed, what
   does not add up and the question; a criterion presumes an expected behaviour nobody agreed yet.
5. A TECH gets the Impediment structure → "no criteria" was read as "same shape" → a TECH is a free
   Description: what has to be done and why it is needed.
6. The criteria block carries a preamble or a trailing comment → the note about an uncovered family
   was written inside it → the block stays clean; the note goes in the chat message.
7. A removed family comes back two messages later → it was treated as an oversight → the reviewer's
   removal is final, and the signalling is one-shot, on the first proposal only.
8. Desktop and mobile share one generic criterion → the platform datum was never established → ask
   once per project, then label per platform inside the **same** item (`acceptance-criteria.md`).
9. `Given/When/Then` or bullet points appear → an English or Gherkin habit took over → Italian
   keywords, `AC01` or `Scenario N` labels, nothing else.
10. Criteria are quietly "improved" past what was agreed → a gap looked obvious to fill → an
    unstated rule is a question, not an assumption.

## References

- `item-formats.md` — the four roles in full: required body, title rules, what each one must not
  contain, the Impediment signal, and a worked Italian example each. Open it before writing a body.
- `acceptance-criteria.md` — the criteria rules: the four coverage families, the one-shot signalling
  of an uncovered family, `Scenario N` and `AC01` structure, per-platform labelling and why it
  matters, the `Dato che / Quando / Allora` format and examples. Open it once criteria are confirmed.
- `csv-import.md` — the CSV bulk-import file, its exact headers per role, the Bug body-to-column
  mapping, and its quoting rules. Open it only on a genuine request for a file.
