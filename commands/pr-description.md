---
description: Generate a structured PR description from the current branch diff.
argument-hint: [PR title, linked work item #, or extra context]
---

Generate a PR description from the current changes. Incorporate "$ARGUMENTS" if provided.

## Steps (run in order)

1. **Base branch** — resolve it, never assume: `git symbolic-ref --short refs/remotes/origin/HEAD`
   (strip the `origin/`), falling back to whichever of `main`/`master` exists. Call it `<base>` below.
2. **Diff** — `git fetch origin <base>` then `git diff origin/<base>...HEAD`, so a stale local base
   does not drag already-merged commits into the description. If empty, stop and say there's nothing
   to describe.
3. **Changed files** — `git diff --name-status origin/<base>...HEAD`.
4. **Write** the description using the template below.
5. **(Optional) Publish** — only if the request or `$ARGUMENTS` asks to open/update the PR: use the
   Azure DevOps MCP server connected **in this session** (identify it from the `mcp__<server>__repo_*`
   tools that actually exist — never assume a server name, and match tools by capability since that
   MCP renames them), create or update the PR on the current branch, set this text as its description,
   and link a provided `AB#<id>` work item. Otherwise just output the text — opening a PR is
   outward-facing, so never do it unprompted.

## Writing rules

- Reference concrete file / class / method names — no vague summaries.
- No marketing language (seamlessly, robust, powerful, enhance).
- Bullets in Modifiche; prose only in Sintesi and Motivazione. One idea per bullet.
- Write the description **in Italian** — a person reads it — and the PR title too, if one is
  generated: imperative Italian, one line, no prefix. English stays only where it is a machine
  value: identifiers, file, class, method and branch names, code, commands and their output,
  `AB#<id>`, and the section headings of the template below, which are used exactly as written
  there (`Test` and `Breaking change` are the standard technical terms and stay in that form).
- Omit any section with nothing meaningful to say.
- This repo uses Azure DevOps PRs — link a work item as `AB#<id>` only if one is provided; don't invent one.

## Output template

### Sintesi

One or two sentences: what this PR does, not how.

### Motivazione

Why this was needed — bug, requirement, or tech debt.

### Modifiche

Bullets grouped by area (feature / fix / refactor / config) when there are more than ~5 items.

### Test

How it was verified. If the repo has an automated suite, say what it covers for this change; where it
has none, describe the manual steps (build, run profile, health endpoint, exercised path). If it was
not verified, say so plainly — that is more useful than an implied "it works".

### Breaking change

Migration steps. **Omit entirely if none.**

## Guardrails

- Generate text only: never create, update, or merge the PR itself, never push, never commit.
- Never invent verification. If the change was not exercised, the `Test` section says exactly that.
- Never restate the diff line by line — the reviewer can read it; describe intent and consequence.
