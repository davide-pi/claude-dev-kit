# PR title and description

The title and body are written in **Italian**, whatever language the conversation is in: they are
read by the team, by the platform's search, and by whoever looks this change up in a year. So are
commit messages — which is what makes a squash merge coherent, since the platform turns the PR
title into the commit subject.

## The title

One imperative line, specific to this change, no trailing period.

| Bad | Why | Better |
| --- | --- | --- |
| `Correzioni` | says nothing | `Correggi l'arrotondamento del totale fattura su ordini multivaluta` |
| `Aggiorna file` | describes the mechanics | `Sposta la risoluzione del tenant nel middleware` |
| `feature/billing-export` | the branch name | `Aggiungi export fatture per tenant` |
| `Aggiunto il nuovo endpoint.` | past tense, trailing period | `Aggiungi endpoint API fatture` |

If the branch is a single logical change, the PR title and the squashed commit subject are the same
sentence — the platform copies one into the other, so write it once and write it well (`commit`).

## The body

Short but complete. A reviewer should know, before reading the diff, **what changed** and **why**.

```markdown
- Aggiunge `InvoiceExportService` e l'endpoint `/api/tenants/{id}/invoices/export`.
- Sposta la risoluzione del tenant dai controller al middleware in `Shared.Tenancy` — tre controller
  la ripetevano e uno sbagliava il caso di impersonation.
- La migration `20260902_AddInvoiceExportLog` aggiunge una tabella; nessuna colonna esistente cambia.

Rilascio:
- `Billing.Api` — contiene il nuovo endpoint e applica la migration.
- `Tenants.Api`, `Orders.Api` — ospitano due dei tre controller che perdono la risoluzione del
  tenant, ora in `Shared.Tenancy`: referenziano la libreria modificata.
- Database `billing` — migration da applicare prima dei servizi.

Rischio merge: irreversibile — la migration crea una tabella che il rollback non elimina; impatto:
export fatture di tutti i tenant.

Verifica:
- Prima: `dotnet test --filter InvoiceExport` → 2 falliti (endpoint assente).
- Dopo: stesso comando → 14 passati; export di prova su tenant `demo` scaricato e aperto.

Note per il reviewer:
- Per ora l'export è sincrono; il percorso a coda è fuori scope (item #<id>).

Fixes #<n>
```

Rules:

1. **One bullet per real change**, not per file and not per commit.
2. Say **why** whenever the change is not self-evident — a why the diff cannot show is the single
   most valuable line in the body.
3. Call out anything the reviewer must not miss: a migration, a config key, a breaking signature, a
   deliberate deviation, a follow-up left undone.
4. Name what is **out of scope**, so the review does not turn into a design discussion.
5. No empty template sections, no "N/A", no checklist nobody ticks — with **two exceptions**: the
   `Rilascio:` block is always written, `nessun componente` included (see below), and so is the
   `Rischio merge:` line.
6. **`Rischio merge:`** — one line: **reversibile** (a revert of the squash commit undoes it all) or
   **irreversibile** (a migration that drops or rewrites data, a published contract, a message
   already consumed, an external call with side effects) and what cannot be undone; then the
   **impatto** — who or what breaks if it is wrong. It tells the reviewer how hard to look. The
   minimal form, for a docs-only or tooling change: `Rischio merge: reversibile — revert dello
   squash commit; nessun impatto a runtime`.
7. **`Verifica:`** — when a command or a check was run, the evidence before and after: the failing
   then passing test, the output, the screenshot path. Quote the command; never paraphrase a result
   (`done-check`). Nothing was run → leave the block out rather than invent one.
8. No secrets, connection strings, tokens or customer data — a PR body is as public as the repo.

## Deriving it

```powershell
$base = (git symbolic-ref --short refs/remotes/origin/HEAD) -replace '^origin/', ''
git log --oneline "origin/$base..HEAD"      # the intent, commit by commit
git diff --stat "origin/$base...HEAD"       # where the weight actually is
```

Read the linked parent item or issue too: the body should answer the item, and any gap between what
the item asked and what the branch does belongs in the body as an explicit note. On Azure DevOps
the item text comes through `azdo-cli`; on GitHub, `gh issue view <n> --json title,body`.

## The release scope — the `Rilascio:` block

Every body carries it, right after the change bullets. It answers one question: **which releasable
components must be deployed for this PR to take effect**. One bullet per component, each with the
reason it is in the list — the reason is what lets a reviewer contest the list.

| What changed | What gets released |
| --- | --- |
| a file inside one deployable | that deployable |
| a shared library, a contracts package, a shared UI lib | **every deployable that references it**, one by one |
| a message contract — event, RPC, queue payload | the publisher **and every consumer** (`rabbitmq`) |
| a migration | the deployable that applies it, plus the database as its own step |
| only pipelines, docs, tests, editor config | nothing — `Rilascio: nessun componente` |

### Finding the deployables

1. **List the files**, not the commits: `git diff --name-only origin/<base>...HEAD`.
2. **Map each file to the unit that gets deployed**, discovered in the repo rather than assumed:
   - a **pipeline definition with path filters** is the authoritative release map where one exists —
     the paths it triggers on are, by construction, the files that release that component
     (`pipeline`);
   - otherwise: a `Dockerfile`, an executable or Web-SDK project, an `application` entry in the
     Angular workspace config, a Vite/Next app root, a function or worker host, a chart or
     deployment manifest.
3. **Fan out through references** — this is the step that is actually forgotten:
   - a class library or contracts package → every deployable that reaches it through a project or
     package reference, transitively;
   - a shared frontend library or a path-mapped module → every app that imports it;
   - a **message contract** — event, RPC request/response, queue payload → the **publisher and
     every consumer**, found by searching the solution for the message type (`rabbitmq`);
   - a database migration → the deployable that runs it, and the database itself as a release step
     with its own ordering (usually before the services).
4. **Ordering and prerequisites** where they matter: migration before services, producer before
   consumer on an additive contract, consumer before producer on a removal, a config key or a
   variable group that must exist in the environment first. One extra clause on the bullet, not a
   runbook.
5. **Unmappable file** → say so explicitly in the block. Silence turns a doubt into a missed
   release; a line saying "non risolto: `<path>`" is a question the reviewer can answer.

### Rules

| Case | What the block says |
| --- | --- |
| Named components | `- <componente> — <perché>`, one per line, real deployable names from the repo |
| A shared library changed | the **consumers**, never the library — a library is not deployed |
| Nothing deployable (docs, tests, editor config, a pipeline that only builds) | `Rilascio: nessun componente` |
| Uncertain fan-out | list what is certain, then one line naming the doubt |

Never write "tutti i servizi" as shorthand: if it really is all of them, they are still listed by
name — that list is what makes the size of the change visible.

## Linking

The PR carries at least one work item, and that item is the **parent backlog item** — a User Story
or Product Backlog Item, a Bug, an Impediment, a TECH activity; on GitHub, the issue. A **Task** is
never linked: it exists to carry hours (`worklog` owns them), not to state what was delivered. An id
read off the branch name or a commit message is a candidate, not the answer — read its type first,
and if it is a Task link its parent instead (`azdo-cli`). Nothing resolvable means the PR does not
get opened: ask which item the change belongs to, or create it (`workitem-create`).

- **Azure DevOps** — attach the parent item to the PR as a real link (`azdo-cli`). Policies and the
  item's own state transition depend on that link; a URL in the body drives nothing.
- **GitHub** — `Fixes #<n>` or `Closes #<n>` in the body closes the issue on merge. Use `Refs #<n>`
  when the PR advances an issue without closing it.
- Multiple parents: one link each, and if they sit under different Features say so in the body — the
  branch is probably doing two things. Reference other PRs by number rather than describing them.

## The trailer

When Claude opens the PR, the body ends with exactly one trailer line:

```
🤖 Opened with [Claude Code](https://claude.com/claude-code)
```

Nothing after it. It goes on the PR body only — never in the title, never in a commit message
unless the commit convention already asks for a co-author trailer.

## Draft PRs

A draft says "look, but do not spend a full pass". Convert to ready only once the local build and
tests are green and the description is final; converting is a one-flag change, and the reviewer's
notification depends on it. Say in the body what the draft is still waiting for.
