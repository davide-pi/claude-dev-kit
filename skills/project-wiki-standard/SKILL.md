---
name: project-wiki-standard
description: >-
  Use when the user types /project-wiki-standard to scaffold or maintain an Azure DevOps project
  wiki on the canonical structure.
disable-model-invocation: true
---

# project-wiki-standard — one shape for every project wiki, one place for every fact

**Contract.** A project wiki on the canonical tree, each fact on exactly one page, every write read
back · never writes to a repository, never reorganises without page-by-page confirmation · wiki
content and reports Italian; canonical page names verbatim.

Every wiki navigates the same way, so anyone — or a later session — finds a fact without guessing or
disambiguating two copies. One client holds several projects over time; the tree allows for it.

## When

- The user types `/project-wiki-standard`.
- A new client or project needs its wiki; a feature has to be documented under `Requisiti`.
- An open question got an answer and has to land where it belongs.
- A wiki has drifted: pages missing, content misplaced, a fact twice; or `Chiusura progetto` is asked for.

Not for: a repository's docs tree (`doc-keeper` — neither touches the other's territory), `az devops`
mechanics (`azdo-cli`), work items (`workitem-create`).

## Decide

### 1. Non-negotiables

| Rule | Detail |
| --- | --- |
| Zero duplication | one fact, one owning page; never a second "answers" page |
| An answered question migrates | the answer moves to its owning page and the question is **deleted**, not struck through — the wiki's git history keeps the record |
| The root **is** the client page | who, sector, context, contacts and external technical third parties, on `/`; never a separate "Cliente" page |
| `Vincoli` is not `Architettura` | imposed facts against the decisions taken in response; mixed, nobody can later tell imposed from chosen |
| Edge cases belong to their feature | `## Casi limite`, last section of the feature's page |
| Canonical names never change | `Requisiti`, `Vincoli`, `Architettura`, `Domande aperte`, `Domande cliente`, `Domande terze parti`, `Chiusura progetto`, `Glossario`, `Casi limite` |
| Target from the `ALM:` line | org and project passed explicitly on every call; no line or unmapped → ask; never the `az devops configure` default |
| Writes through REST | every write is the REST `PUT` with `charset=utf-8` (`azdo-cli`), then the page is read back to prove the accents survived |
| eTag discipline | an update carries the eTag of the **last** read or write; mismatch → re-read and retry, never force |
| Reorganisation | presented as a map first, then confirmed page by page |

### 2. Which path

| State of the target project | Path |
| --- | --- |
| no wiki, or empty or just created | **A — scaffolding**, `references/scaffolding.md` |
| a wiki with content | **B — maintenance**, `references/maintenance.md` |

Both start from org, project and wiki resolved, then the page tree read once.

### 3. Which page owns the information

| The information | Its one owning page |
| --- | --- |
| the client: who, sector, context, contacts, external technical third parties | the root `/` |
| a domain term shared across the client's projects | `/Glossario` |
| Scopo and Perimetro of a project | `<Progetto>/Requisiti`, on the page itself |
| what one feature must do | `<Progetto>/Requisiti/<Funzionalità>` |
| an edge case of that feature | `## Casi limite` on that feature's page |
| a fact imposed from outside (infrastructure, mandatory integration, field devices) | `<Progetto>/Vincoli` |
| a choice made in response, rejected alternatives and why | `<Progetto>/Architettura`, decision-record style |
| a question still open, per interlocutor | `Domande aperte/Domande cliente` or `.../Domande terze parti` |
| an answered question | its owning page above; the question is deleted |
| delivered against planned, deviations, debt, link to the final architecture | `<Progetto>/Chiusura progetto`, only on explicit request |

More than about four sections on a page → `[[_TOC_]]` on its own line after the introduction;
short pages go without. Full tree and Italian skeletons: `references/canonical-structure.md`.

## Do

```powershell
$org = 'https://dev.azure.com/<org>'; $project = '<project>'   # from the ALM: line, else ask
az devops wiki list --org $org -p $project -o table
# Tree: REST pages with recursionLevel=full (no `wiki page list` verb); writes: REST PUT, charset=utf-8 — azdo-cli references/wiki-rest.md
# After every write, read the page back into $content and prove the accents survived:
$canaries = @('più', 'città', 'perché')   # accented words actually present in what you wrote
$canaries | Where-Object { $content -notlike "*$_*" }   # empty output = clean
if ($content -match [char]0xFFFD) { throw 'encoding corrupted: rewrite through the REST PUT' }
```

Nothing is complete until its **Completo quando:** gate in the path reference holds.

## Traps

1. Accents come back mangled → the plain `wiki page create`/`update` re-read the content in the
   system codepage → REST `PUT` with `charset=utf-8`, read back.
2. A page looks childless → `show` returns `subPages` without the subpages → read the tree with
   `recursionLevel=full`.
3. The same rule described twice, then diverging → an edge case went to a cross-cutting page → it
   lives in `## Casi limite` on its feature's page.
4. `Vincoli` fills with decisions → constraint and choice written in one pass → imposed to
   `Vincoli`, chosen to `Architettura` with the rejected alternatives.
5. `Chiusura progetto` filled early → it looked like a gap → it stays empty until asked for.

## References

- `references/canonical-structure.md` — before writing any page: the full tree, what each page owns,
  `Vincoli` against `Architettura`, the TOC rule, the Italian skeletons.
- `references/scaffolding.md` — Path A: client root, `Glossario`, the project structure, each step's gate.
- `references/maintenance.md` — Path B: the structure and duplication audit, closing a question,
  adding a feature page, `Chiusura progetto`, each step's gate.
- `references/wiki-write-rules.md` — on the first write: resolving org, project and wiki; what
  `azdo-cli` owns; read-back and eTag discipline.
