# PR title and description

## The title

One imperative line, specific to this change, no trailing period, in the pr language.

| Bad | Better |
| --- | --- |
| `Fixes` | `Fix invoice total rounding on multi-currency orders` |
| `feature/billing-export` | `Add invoice export per tenant` |

## The body

A reviewer should know, before reading the diff, **what changed** and **why**. The example and the labels
are English; write the body in the pr language, the labels as `SKILL.md`'s contract maps them.

```markdown
- Adds `InvoiceExportService` and the `/api/tenants/{id}/invoices/export` endpoint.
- Moves tenant resolution from the controllers to the middleware in `Shared.Tenancy`: three controllers
  repeated it and one got the impersonation case wrong.
- The `20260902_AddInvoiceExportLog` migration adds a table; no existing column changes.

Release:
- `Billing.Api`: holds the new endpoint and applies the migration.
- `Tenants.Api`, `Orders.Api`: host two of the three controllers that lose tenant resolution, now in
  `Shared.Tenancy`; they reference the changed library.
- Database `billing`: migration to apply before the services.

Merge risk: irreversible, the migration creates a table the rollback does not drop; impact: invoice
export for every tenant.

Verification:
- Before: `dotnet test --filter InvoiceExport` → 2 failed (endpoint missing).
- After: same command → 14 passed; a test export on tenant `demo` downloaded and opened.

Notes for the reviewer:
- The export is synchronous for now; the queued path is out of scope (item #<id>).

Fixes #<n>
```

Rules:

1. Say **why** whenever the change is not self-evident — a why the diff cannot show is the single
   most valuable line in the body.
2. Call out anything the reviewer must not miss: a migration, a config key, a breaking signature, a
   deliberate deviation, a follow-up left undone.
3. Name what is **out of scope**, so the review does not turn into a design discussion.
4. **`Merge risk:`** — **reversible** (a revert of the squash commit undoes it all) or
   **irreversible** (a migration that drops or rewrites data, a published contract, a message
   already consumed, an external call with side effects) and what cannot be undone; then the
   **impact** — who or what breaks if it is wrong. The minimal form, for a docs-only or tooling
   change: `Merge risk: reversible, revert of the squash commit; no runtime impact`.
5. **`Verification:`** — the evidence before and after: the failing then passing test, the output, the
   screenshot path. Quote the command; never paraphrase a result (`plan-work`'s `evidence-by-stack.md`).

## The release scope — the `Release:` block

| What changed | What gets released |
| --- | --- |
| a file inside one deployable | that deployable |
| a shared library, a contracts package, a shared UI lib | **every deployable that references it**, one by one |
| a message contract — event, RPC, queue payload | the publisher **and every consumer** (`rabbitmq`) |
| a migration | the deployable that applies it, plus the database as its own step |
| only pipelines, docs, tests, editor config | nothing — `Release: no components` |

Uncertain fan-out: list what is certain, then one line naming the doubt. Never "all services": if it
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
gh pr create --base $base --title '<title>' --body-file $bodyFile      # + --draft when SKILL.md §5 says draft
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

## No parent item

Ask once, answerable with one pick: numbered options from the likely candidates — an `AB#` in the
branch or commits, recent items assigned to the owner (`az boards query`, `@Me`, changed lately, never
a Task) — plus "create one" (`user-story-standard` text, then `azdo-cli` after the owner's ok).

## Draft PRs

Say in the body what the draft is still waiting for.
