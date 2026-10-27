# PR title and description

## The title

One imperative line, specific to this change, no trailing period.

| Bad | Better |
| --- | --- |
| `Correzioni` | `Correggi l'arrotondamento del totale fattura su ordini multivaluta` |
| `feature/billing-export` | `Aggiungi export fatture per tenant` |

## The body

A reviewer should know, before reading the diff, **what changed** and **why**.

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

1. Say **why** whenever the change is not self-evident — a why the diff cannot show is the single
   most valuable line in the body.
2. Call out anything the reviewer must not miss: a migration, a config key, a breaking signature, a
   deliberate deviation, a follow-up left undone.
3. Name what is **out of scope**, so the review does not turn into a design discussion.
4. **`Rischio merge:`** — **reversibile** (a revert of the squash commit undoes it all) or
   **irreversibile** (a migration that drops or rewrites data, a published contract, a message
   already consumed, an external call with side effects) and what cannot be undone; then the
   **impatto** — who or what breaks if it is wrong. The minimal form, for a docs-only or tooling
   change: `Rischio merge: reversibile — revert dello squash commit; nessun impatto a runtime`.
5. **`Verifica:`** — the evidence before and after: the failing then passing test, the output, the
   screenshot path. Quote the command; never paraphrase a result (`plan-work`'s `evidence-by-stack.md`).

## The release scope — the `Rilascio:` block

| What changed | What gets released |
| --- | --- |
| a file inside one deployable | that deployable |
| a shared library, a contracts package, a shared UI lib | **every deployable that references it**, one by one |
| a message contract — event, RPC, queue payload | the publisher **and every consumer** (`rabbitmq`) |
| a migration | the deployable that applies it, plus the database as its own step |
| only pipelines, docs, tests, editor config | nothing — `Rilascio: nessun componente` |

Uncertain fan-out: list what is certain, then one line naming the doubt. Never "tutti i servizi": if it
really is all of them, they are still listed by name.

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
     every consumer**, found by searching the solution for the message type (`rabbitmq`).
4. **Ordering and prerequisites** where they matter: migration before services, producer before
   consumer on an additive contract, consumer before producer on a removal, a config key or a
   variable group that must exist in the environment first. One extra clause on the bullet, not a
   runbook.

## GitHub

```powershell
gh pr create --base $base --title '<titolo>' --body-file pr-body.md      # --draft when applicable
gh pr view --json url --jq .url
gh issue view <n> --json title,body                                      # the linked issue's text
```

Link: `Fixes #<n>` / `Closes #<n>`, `Refs #<n>` when it does not close; the line goes last before the
trailer. On Azure DevOps the item text comes through `azdo-cli`. Other PRs are referenced by number,
not described.

## The trailer

When Claude opens the PR, the body ends with the attribution the session prescribes (the harness
states it; the default is below), and nothing after it:

```
🤖 Opened with [Claude Code](https://claude.com/claude-code)
```

It goes on the PR body only — never in the title, never in a commit message
unless the commit convention already asks for a co-author trailer.

## Draft PRs

Say in the body what the draft is still waiting for.
