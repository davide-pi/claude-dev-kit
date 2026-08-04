---
name: git-branching
description: >-
  Branching conventions and Git flow for this developer's GitHub projects. Use when creating a
  branch, starting new work, naming a branch, or deciding how a change reaches `main`. Covers the
  protected `main` branch, `feature/*` and `fix/*` prefixes, kebab-case naming, and the PR merge
  flow (squash, CI + review gates, delete after merge).
---

# Git Branching Conventions

**`main` is the principal branch and it is PROTECTED** by GitHub branch-protection rules: **no direct
pushes**. Every change — no exceptions — reaches `main` through a Pull Request.

## Branch types

- **`feature/<name>`** — new development: features, chores, tooling, docs, refactors — anything that
  is NOT a bug fix.
- **`fix/<name>`** — bug fixes.

Always branch off the **latest `main`** and open the PR back **into `main`**.

## Naming

- The prefix is always `feature/` or `fix/`.
- The part **after** the prefix is **kebab-case**: lowercase words joined by `-`.
- Keep it short and descriptive.

Examples:

- `feature/netlify-mcp-and-deploy-cleanup`
- `feature/rsvp-form-validation`
- `fix/mobile-gallery-overflow`

## Merge flow

1. Open a PR into `main` (see the **`pr-create`** skill for title and description conventions).
2. Merge **only** when **both** gates are green:
   - the **CI pipeline** passes (lint / test / build), and
   - at least **one review is approved**.
3. Use **squash and merge** — one commit per PR, linear history on `main`.
4. **Delete the branch** after the merge.

## Applying it

- **Never commit straight to `main`.** If asked to make a change, first create a `feature/` or
  `fix/` branch off the latest `main`.
- If a branch has the **wrong prefix** or a **non-kebab-case** name, rename it before pushing or
  opening the PR:

  ```bash
  git branch -m <old> <new>
  ```
