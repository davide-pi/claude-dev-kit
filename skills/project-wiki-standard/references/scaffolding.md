# Path A — scaffolding a new wiki

Chosen when the project has no wiki at all, or a wiki that is empty or was just created. Order
matters: client root first, then the glossary, then the project structure. Placeholders are fine
everywhere — **the structure has to exist from the start**, the content accumulates with the
project. Content is Italian; page names are the canonical ones.

Every read and write goes through the calls `azdo-cli` owns, with the organization and project
resolved as `references/wiki-write-rules.md` describes and passed explicitly.

## Step A0 — Target and path

1. Resolve organization and project from the current working directory through the workspace mapping
   in the user's `CLAUDE.md`. Unmapped path, or no repository in sight → ask which Azure DevOps
   project this wiki belongs to. Never read the target from `az devops configure`.
2. List the project's wikis (`azdo-cli`). No wiki → the project wiki has to be created first; a wiki
   that exists but is empty → carry on here.
3. Read the page tree once (`recursionLevel=full`, `azdo-cli`) so that "empty" is a fact and not an
   assumption. Any real content → stop and switch to `references/maintenance.md`.

**Completo quando:** organization, project and wiki name are known and stated back to the user, the
tree has been read, and Path A is confirmed as the right path.

## Step A1 — Client page (the root)

Ask, in one round: the client's name; context and sector in a few lines; the main contacts inside
the client; the external technical third parties already known (for instance the vendor of a
management system the project must integrate with) and their contacts.

Write all of it **directly on the root `/`** — not on a separate "Cliente" page — using the root
skeleton in `references/canonical-structure.md`. Unknown contacts stay as an empty table row: the
list will grow over the life of the client.

**Completo quando:** the root `/` carries at least the client name, the context and the contacts
already known, the accents have been verified by reading the page back, and the page has a
`[[_TOC_]]` if it ended up with more than about four sections.

## Step A2 — Glossario

Create `/Glossario` as a child of the root, even with nothing but a placeholder row ("nessun termine
ancora raccolto"). It is created now regardless, because it is where every client-specific domain
term goes as soon as it appears, instead of being explained piecemeal inside other pages.

**Completo quando:** `/Glossario` exists and reads back correctly.

## Step A3 — Project page and the canonical structure

1. Ask for the name of the product or initiative. If the client already has other projects in the
   wiki, check the name does not collide with one of them.
2. Create `/<Nome progetto>` with a few lines saying what the product is.
3. Create, under it, the whole canonical structure — one call per page, in this order, so that each
   parent exists before its children:

| Order | Page | Initial content |
| --- | --- | --- |
| 1 | `Requisiti` | `## Scopo` and `## Perimetro`, sketched from what is already known |
| 2 | `Vincoli` | the constraint table, empty or with the constraints already known |
| 3 | `Architettura` | one line saying decisions are recorded here in decision-record form |
| 4 | `Domande aperte` | one line saying how the two subpages are used |
| 5 | `Domande aperte/Domande cliente` | the question table, empty |
| 6 | `Domande aperte/Domande terze parti` | the question table, empty, one section per interlocutor |
| 7 | `Chiusura progetto` | the four headings, empty — it is filled only on explicit request |

Feature subpages under `Requisiti` are **not** created blind: one is created when there is a feature
to describe, through Step B3 in `references/maintenance.md`.

**Completo quando:** every page in the canonical structure exists under `/<Nome progetto>` — even
mostly empty — each one has been read back with its accents intact, and the tree read with
`recursionLevel=full` shows the same shape as the canonical tree.

## Step A4 — Hand back

Print the tree that now exists, page by page, and say plainly what is a placeholder waiting for
content: the empty sections in `Requisiti`, the constraints not yet collected, the questions not yet
asked. That list is the first backlog of the wiki, and it is written in Italian like every other
report this skill hands over — page names excepted, which stay canonical.

**Completo quando:** the user has the tree and the list of placeholders in front of them.
