---
description: Generate a structured PR description from the current branch diff.
argument-hint: [PR title, linked work item #, or extra context]
---

Generate a PR description from the current changes. Incorporate "$ARGUMENTS" if provided.

## Steps (run in order)

1. **Base branch** — this repo's main branch is `master`. Diff against it directly; only run
   `git remote show origin` if `master` doesn't exist locally.
2. **Diff** — `git diff master...HEAD`. If empty, stop and say there's nothing to describe.
3. **Changed files** — `git diff --name-status master...HEAD`.
4. **Write** the description using the template below.
5. **(Optional) Publish** — only if the request or `$ARGUMENTS` asks to open/update the PR: use the
   `azure-devops` MCP (repositories domain) to create or update the PR on the current branch, set this
   text as its description, and link a provided `AB#<id>` work item. Otherwise just output the text —
   opening a PR is outward-facing, so never do it unprompted.

## Writing rules

- Reference concrete file / class / method names — no vague summaries.
- No marketing language (seamlessly, robust, powerful, enhance).
- Bullets in Changes; prose only in Summary and Motivation. One idea per bullet.
- Omit any section with nothing meaningful to say.
- This repo uses Azure DevOps PRs — link a work item as `AB#<id>` only if one is provided; don't invent one.

## Output template

### Summary

One or two sentences: what this PR does, not how.

### Motivation

Why this was needed — bug, requirement, or tech debt.

### Changes

Bullets grouped by area (feature / fix / refactor / config) when there are more than ~5 items.

### Testing

How it was verified. This repo has **no automated tests** — describe the manual steps (build,
Aspire profile, `/health`, exercised path). If not verified, say so plainly.

### Breaking changes

Migration steps. **Omit entirely if none.**
