---
name: branch-flow
description: >-
  Use when new work starts unbranched, a branch is named or renamed, a worktree is needed, or a
  finished branch must reach the default branch.
---

# branch-flow — branch it, isolate it, finish it

**Contract.** A correctly named branch, an isolated worktree, a finish decision · never a commit or
push on the default branch, never a merge with red gates or without the owner · Italian prose,
branch names and commands verbatim.

## When

Not for: the PR title and body (`pr-create`), reviewing a PR (`code-review`), Azure DevOps verbs
(`azdo-cli`).

## Decide

### 1. Platform — read the remote once

| `git remote get-url origin` contains | Platform | PR, merge, branch delete through |
| --- | --- | --- |
| `github.com` | GitHub | `gh` |
| `dev.azure.com`, `*.visualstudio.com` | Azure DevOps | `azdo-cli` |
| anything else | unknown | ask before pushing anything |

The default branch is protected on both: every change arrives through a PR. Its name is read, never
assumed: `git symbolic-ref --short refs/remotes/origin/HEAD`.

### 2. Branch — prefix, then kebab-case

| Work | Prefix | Example |
| --- | --- | --- |
| anything not a fix: feature, chore, tooling, docs, refactor | `feature/` | `feature/tenant-billing-dashboard` |
| bug fix | `fix/` | `fix/mobile-gallery-overflow` |

- After the prefix: lowercase words joined by `-`, short and specific.
- Branch off the **freshly fetched** `origin/<base>`, never the local base; the PR goes back into it.
- The repo already uses other prefixes (`bugfix/`, `release/`) → follow the repo (`git branch -r`).
- A work item id in the name only where the repo already does it.

### 3. Isolate — worktree or current tree

| Situation | Where |
| --- | --- |
| short change, clean tree | current tree, new branch |
| dirty tree, two changes in flight, a likely throwaway, a multi-session plan | a **worktree** |
| parallel agents on one repo | one worktree **per agent** |

Worktrees live under `$env:CLAUDE_WORKTREE_ROOT` as `<repo>-<short-topic>` — a short root keeps deep
repos under the Windows path limit. The native tools (`EnterWorktree`, `isolation: "worktree"`)
create under `<repo>\.claude\worktrees\` unless the `worktree-root.js` hook redirects
them; without it, use the git fallback in `references/worktrees.md`.

### 4. Finish

Merge gates: pipeline green **and** reviewed. Squash and delete-source-branch are the only strategy.
Completing the merge is the owner's call: prepare, report, never decide. The menu (merge, cherry-pick,
dead end, later), the per-platform merge and the clean-up: `references/finishing.md`.

## Do

```powershell
git remote get-url origin; git symbolic-ref --short refs/remotes/origin/HEAD
git status --short; git branch --show-current

# start from a fresh base ($base = the name above without origin/)
git fetch origin $base
git switch --create feature/<kebab-name> "origin/$base"

# wrong name: before the push / after the push
git branch --move <old> feature/<new>
git push origin --delete <old>; git push --set-upstream origin feature/<new>
```

## Traps

1. `git diff master...HEAD` shows already-merged commits → the local base is stale → fetch, then
   diff and branch against `origin/<base>`.
2. A commit lands on the default branch → work started before branching → the default-branch hook
   asks first; branch, switch, commit there.
3. Stash used to juggle two changes → one is forgotten or popped on the wrong branch → a worktree.

## References

- `references/worktrees.md` — creating, using or removing a worktree: the root, the native path and
  the git fallback, one worktree per agent, untracked files, clean-up.
- `references/finishing.md` — the branch is complete: pre-merge evidence, squash-merge and delete
  per platform, the not-merging paths, what to leave behind.
