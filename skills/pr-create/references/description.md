# PR title and description

Everything on this page is written in **English**, whatever language the conversation is in. The
title and body are read by reviewers, by the platform's search, and by whoever bisects this change
in a year.

## The title

One imperative line, specific to this change, no trailing period.

| Bad | Why | Better |
| --- | --- | --- |
| `Fixes` | says nothing | `Fix invoice total rounding on multi-currency orders` |
| `Update files` | describes the mechanics | `Move tenant resolution into middleware` |
| `feature/billing-export` | the branch name | `Add per-tenant invoice export` |
| `Added the new endpoint.` | past tense, trailing period | `Add invoices API endpoint` |

If the branch is a single logical change, the squashed commit subject and the PR title are the same
sentence. Write it once.

## The body

Short but complete. A reviewer should know, before reading the diff, **what changed** and **why**.

```markdown
- Adds `InvoiceExportService` and the `/api/tenants/{id}/invoices/export` endpoint.
- Extracts tenant resolution out of the controllers into middleware — three controllers were
  repeating it and one of them got it wrong for the impersonation case.
- Migration `20260902_AddInvoiceExportLog` adds one table; no existing column changes.

Notes for the reviewer:
- The export runs synchronously for now; the queue path is out of scope (item #<id>).

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

Read the linked work item or issue too: the body should answer the item, and any gap between what
the item asked and what the branch does belongs in the body as an explicit note. On Azure DevOps
the item text comes through `azdo-cli`; on GitHub, `gh issue view <n> --json title,body`.

## Linking

- **Azure DevOps** — attach the work item to the PR as a real link (`azdo-cli`). Policies and the
  item's own state transition depend on that link; a URL in the body drives nothing.
- **GitHub** — `Fixes #<n>` or `Closes #<n>` in the body closes the issue on merge. Use `Refs #<n>`
  when the PR advances an issue without closing it.
- Multiple items: one link each. Reference other PRs by number rather than describing them.

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
