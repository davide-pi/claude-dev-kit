# Path B — maintaining an existing wiki

Chosen when the wiki already has content. Four jobs, independent of one another: the structure
audit, closing an open question, adding a feature subpage, and filling `Chiusura progetto`. All of
them start from a full read of the page tree (`recursionLevel=full`, `azdo-cli`) with organization
and project resolved from the working directory — see `references/wiki-write-rules.md`.

Content is Italian; the canonical page names are never translated.

## Step B1 — Structure and duplication audit

Read the whole tree, then read the content of every page the audit needs to judge, and compare it
against the canonical structure in `references/canonical-structure.md`. **Report before changing
anything.** Present one map, three lists:

| List | What goes in it |
| --- | --- |
| Missing | pages the standard requires that do not exist |
| Out of place | content that exists but, by the standard, belongs to a different page — a decision written in `Vincoli`, an edge case in a cross-cutting page, client contacts on a separate page instead of the root |
| Duplicated | the same information present in more than one page, with both locations named |

Present it as a table, one row per intervention, and let the user decide row by row:

```markdown
| # | Page | Finding | Proposed intervention |
|---|------|---------|-----------------------|
| 1 | /Vincoli | contains the polling choice, which is a decision | move that section to /Architettura as a decision record |
| 2 | /<Progetto>/Casi limite | cross-cutting edge-case catalogue | split into the "Casi limite" section of each feature page |
```

A reorganisation touches content other people are already using, so it is **confirmed page by
page** — never executed in one block on a general "yes". For every move: write the content in the
destination page first, read it back, and only then remove it from the source, so no fact is ever
absent from the wiki in between.

**Completo quando:** the map (missing / out of place / duplicated) has been presented, the user has
said which rows to act on, and every approved row has been applied and read back.

## Step B2 — Closing an open question

When an entry in `Domande cliente` or `Domande terze parti` has been answered:

1. Decide which page owns the answer: `Requisiti` if it defines what has to be built, `Vincoli` if
   it is a fact imposed from outside, `Architettura` if it is a choice taken in response. An answer
   about one single feature belongs to that feature's subpage.
2. Write the answer there as content in its own right — not as "risposta alla domanda 3". Anyone
   reading the page must not need the question to understand the answer.
3. Read the destination page back and check the accents.
4. **Delete the question** from the `Domande aperte` subpage. It is not left in place struck
   through, marked "risposta" or copied anywhere else: how the answer was reached is already in the
   wiki's git history, and does not belong in the live content.

**Completo quando:** the question is gone from `Domande aperte`, its content is readable on the
owning page, and it exists in exactly one place in the wiki.

## Step B3 — Adding a feature or development

Create the subpage under `Requisiti` — never elsewhere, and never a second page for the same
feature. Include from the outset, as the **last** section, a `## Casi limite` paragraph, even empty:
that way edge cases get written where they belong as they emerge, instead of drifting into a
separate catalogue where the same rule would end up described twice.

Then add the feature's row to the `## Funzionalità` table on `Requisiti`, so the page stays a real
index of its subpages. A short subpage gets no `[[_TOC_]]`.

**Completo quando:** the subpage exists under `Requisiti` with the `Casi limite` section already
present in its structure, the `Requisiti` index lists it, and both pages read back correctly.

## Step B4 — Chiusura progetto

**Only on explicit request** — typically when the project is actually ending. Never proposed on this
skill's own initiative, and never filled in during a scaffolding or an audit.

Fill `Chiusura progetto` with four things, however briefly:

| Section | Content |
| --- | --- |
| Perimetro consegnato rispetto al pianificato | what was delivered, against the `Perimetro` on `Requisiti` |
| Scostamenti e perché | every deviation from the planned scope, with its reason |
| Debito tecnico e limitazioni note | what is knowingly left behind for whoever comes next |
| Architettura finale | a link to the `Architettura` page as it stands at closure |

Say plainly which of the four could not be filled and why, rather than writing a plausible summary.

**Completo quando:** `Chiusura progetto` contains all four sections, and any section left thin is
flagged to the user as such.
