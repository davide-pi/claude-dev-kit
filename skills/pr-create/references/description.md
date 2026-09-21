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
- Sposta la risoluzione del tenant dai controller al middleware — tre controller la ripetevano e
  uno sbagliava il caso di impersonation.
- La migration `20260902_AddInvoiceExportLog` aggiunge una tabella; nessuna colonna esistente cambia.

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
5. No empty template sections, no "N/A", no checklist nobody ticks.
6. No secrets, connection strings, tokens or customer data — a PR body is as public as the repo.

## Deriving it

```powershell
$base = (git symbolic-ref --short refs/remotes/origin/HEAD) -replace '^origin/', ''
git log --oneline "origin/$base..HEAD"      # the intent, commit by commit
git diff --stat "origin/$base...HEAD"       # where the weight actually is
```

Read the linked parent item or issue too: the body should answer the item, and any gap between what
the item asked and what the branch does belongs in the body as an explicit note. On Azure DevOps
the item text comes through `azdo-cli`; on GitHub, `gh issue view <n> --json title,body`.

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
