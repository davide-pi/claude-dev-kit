---
name: project-wiki-standard
description: >-
  The company standard for an Azure DevOps project wiki: one canonical structure every client and
  project wiki follows, and exactly one place for every piece of information. Covers scaffolding a
  new wiki (the client root, Glossario, then the full canonical tree under each project page) and
  maintaining an existing one — a structure and duplication audit before anything is changed,
  closing an open question by migrating its answer into the page that owns it, adding a feature
  subpage with its Casi limite section, and filling Chiusura progetto. Enforces zero duplication,
  the deliberate split between Vincoli (facts imposed from outside) and Architettura (the decisions
  taken in response), the table-of-contents rule, Italian page content under canonical page names,
  and organization and project resolved from the working directory instead of the CLI defaults.
  Explicit trigger: only when the user types /project-wiki-standard.
disable-model-invocation: true
---

# project-wiki-standard — one shape for every project wiki, one place for every fact

Why it exists: every project wiki is navigable the same way, so anyone — or any later session — can
use it as a source of truth without guessing where something lives or disambiguating two copies of
it. A client will have more than one product over time, so the structure has to hold several
projects under the same client.

**Language.** This skill's instructions are English; the wiki content it writes is **Italian**, and
the canonical page names (`Requisiti`, `Vincoli`, `Architettura`, `Domande aperte`,
`Domande cliente`, `Domande terze parti`, `Chiusura progetto`, `Glossario`, `Casi limite`) stay
exactly as they are — they are the structure itself, not prose to translate. Do not "fix" them.

## When

- The user types `/project-wiki-standard`.
- A new client or a new project needs its wiki created from nothing.
- An open question got an answer and it has to land where it belongs.
- A new feature or development has to be documented under `Requisiti`.
- An existing wiki has drifted: pages missing, content in the wrong page, the same fact twice.
- The project is closing and `Chiusura progetto` has been explicitly asked for.

Not for: a repository's own documentation tree — that belongs to `doc-keeper`, and neither touches
the other's territory: this skill writes only to the Azure DevOps project wiki and never to files in
a repository, while `doc-keeper` writes only inside a repository's docs tree and never to the wiki.
Also not for: `az devops` verbs, auth and REST mechanics (`azdo-cli`), work items
(`workitem-create`, `workitem-analyze`), or wiki-wide full-text search. Never fires unasked.

## Decide

### 1. Non-negotiables

| Rule | Detail |
| --- | --- |
| Zero duplication | one fact, one owning page; never a second "answers" page copying content |
| An answered question migrates | the answer moves to its owning page and the question is **deleted**, not struck through — the wiki's git history already records how it was reached |
| The root **is** the client page | who they are, sector and context, contacts including external technical third parties, written directly on `/`; never a separate "Cliente" page |
| `Vincoli` is not `Architettura` | given facts against the decisions taken in response; mixing them makes it impossible, months later, to tell what was imposed from what was chosen |
| Edge cases belong to their feature | `## Casi limite` as the last section of that feature's page, never a cross-cutting catalogue |
| Italian content, canonical names | see the Language note above |
| Org and project from the working directory | resolved through the workspace mapping in the user's `CLAUDE.md` and passed explicitly — never the `az devops configure` default, which may still point at a previous session's client. Path not mapped → ask |
| Accented content is never written with the plain CLI | this wiki is Italian, so **every** write goes through the REST PUT with `charset=utf-8` that `azdo-cli` owns, and the page is read back afterwards to confirm the accents survived |
| eTag discipline | an update carries the eTag from the **last** read or write; on a mismatch re-read, take the current eTag and retry — never force a stale one |
| A reorganisation is confirmed page by page | it touches content other people are already using |

### 2. Which path

| State of the target project | Path |
| --- | --- |
| no wiki, or a wiki that is empty or just created | **A — scaffolding**, `references/scaffolding.md` |
| a wiki that already has content | **B — maintenance**, `references/maintenance.md` |

Resolve org, project and wiki first, then read the page tree once: both paths start from it.

### 3. Which page owns the information

| The information | Its one owning page |
| --- | --- |
| the client: who, sector, context, contacts and external technical third parties | the wiki root `/` |
| a domain term, shared across all of that client's projects | `/Glossario` |
| Scopo and Perimetro of a project | `<Progetto>/Requisiti`, written directly on it |
| what one feature must do | `<Progetto>/Requisiti/<Funzionalità>` |
| an edge case of that feature | `## Casi limite`, last section of that feature's page |
| a fact imposed from outside (the client's infrastructure, a mandatory integration, the kind of devices in the field) | `<Progetto>/Vincoli` |
| a choice made in response, its rejected alternatives and why | `<Progetto>/Architettura`, decision-record style |
| a question still open, per interlocutor | `Domande aperte/Domande cliente` or `.../Domande terze parti` |
| a question that has been answered | its owning page above; the question itself is deleted |
| delivered scope against planned, deviations, known debt, link to the final architecture | `<Progetto>/Chiusura progetto`, only on explicit request |

Full tree, page-by-page content and the Italian page skeletons: `references/canonical-structure.md`.

### 4. Table of contents

More than about four sections on a page → `[[_TOC_]]` on a line of its own, right after the
introduction and before the first `##`. Short pages (one or two sections, as most feature subpages
are) go without: there, an index is clutter rather than help.

## Do

```powershell
# 1. Resolve the target from the working directory, never from the CLI default.
$cwd = (Get-Location).Path            # match its root against the workspace mapping in CLAUDE.md
az devops configure --list            # informative only: what it reports is NOT the target
$org = 'https://dev.azure.com/<org>'; $project = '<project>'   # from the mapping, or ask
```

The wiki calls themselves belong to `azdo-cli`: listing a project's wikis, reading the page tree
with `recursionLevel=full` (there is no `az devops wiki page list` verb), and creating or updating a
page through the REST PUT with `charset=utf-8`. Take the exact syntax from `azdo-cli`, and pass the
organization and project explicitly on every call.

```powershell
# 2. After every write, read the page back and prove the accents survived.
$canaries = @('più', 'città', 'perché')   # accented words actually present in what you wrote
$canaries | Where-Object { $content -notlike "*$_*" }   # empty output = the write is clean
if ($content -match [char]0xFFFD) { throw 'encoding corrupted: rewrite through the REST PUT' }
```

Nothing is complete until its **Completo quando:** gate in the path reference is satisfied.

## Traps

1. Accents come back mangled → the plain `az devops wiki page create`/`update` re-reads the content
   in the system codepage instead of UTF-8 → write through the REST PUT with `charset=utf-8`
   (`azdo-cli`), and read the page back before calling the step done.
2. A page looks childless → `az devops wiki page` has no `list` verb, and `show` returns a
   `subPages` field without the subpages → read the tree with `recursionLevel=full` (`azdo-cli`).
3. An update fails on `If-Match` → the eTag is stale because the page changed meanwhile → re-read,
   take the current eTag, retry; never force.
4. Content lands in the previous client's wiki → the `az devops configure` default was trusted →
   resolve org and project from the working directory and pass them explicitly.
5. An answered question is left in place, struck through → it feels like keeping the record → the
   record is in the wiki's git history; delete the question once the answer is in its owning page.
6. The same rule ends up described twice, then the copies diverge → an edge case was filed in a
   cross-cutting page → edge cases live in `## Casi limite` on the feature's own page.
7. `Vincoli` fills up with decisions → constraint and choice were written in one pass → what was
   imposed goes to `Vincoli`, what was chosen to `Architettura`, with the alternatives rejected.
8. A reorganisation lands before anyone agreed to it → the audit turned into edits in the same pass
   → present the map first, then confirm page by page.
9. `Chiusura progetto` gets filled early → it looked like a gap in the structure → it stays empty by
   design and is filled only when explicitly asked for.

## References

- `references/canonical-structure.md` — the full canonical tree, what each page owns, why `Vincoli`
  and `Architettura` are separate, the TOC rule and the Italian page skeletons. Read it before
  writing any page.
- `references/scaffolding.md` — Path A: the client root, `Glossario`, then the whole structure under
  the project page, with the gate for each step.
- `references/maintenance.md` — Path B: the structure and duplication audit, closing an open
  question, adding a feature subpage, filling `Chiusura progetto`, with the gate for each step.
- `references/wiki-write-rules.md` — resolving org, project and wiki name; what `azdo-cli` owns and
  what this skill never does; the read-back and eTag discipline. Read it on the first write.
