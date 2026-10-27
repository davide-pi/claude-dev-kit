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

- New work starts and nothing is branched yet, or a branch has the wrong prefix or case.
- Work needs isolation: a dirty tree, two changes in flight, an experiment, parallel agents.
- The work is complete and the branch has to reach the default branch — or must not.

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

### 4. Finish — the menu

| State of the work | Move |
| --- | --- |
| done, verified, wanted | push → PR (`pr-create`) → review → **squash-merge** → delete the branch |
| gates red | fix the gate first; a red pipeline or a pending review is not a merge |
| works, wrong approach | do not merge; write why it loses, usually as a work item |
| partly wanted | cherry-pick the wanted commits onto a fresh branch |
| dead end | delete local and remote, write the lesson |
| wanted later | keep it, rebase while cheap, name the blocker |

Merge gates: pipeline green **and** reviewed (`/code-review <pr>` plus the owner's read; a human approval
only where branch policy demands it). Squash and delete-source-branch are the only strategy; a policy
that forbids squash → stop and say so. Completing the merge is the owner's call: prepare, report,
never decide. Full walk: `references/finishing.md`.

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

# after the PR is merged (check its state): a squash looks unmerged to git, so -D
git switch $base; git pull --ff-only; git branch -D feature/<name>; git fetch --prune
```

## Traps

1. `git diff master...HEAD` shows already-merged commits → the local base is stale → fetch, then
   diff and branch against `origin/<base>`.
2. A commit lands on the default branch → work started before branching → the default-branch hook
   asks first; branch, switch, commit there.
3. Stash used to juggle two changes → one is forgotten or popped on the wrong branch → a worktree.
4. A worktree removed with `Remove-Item` → git keeps a dangling entry → `git worktree remove`, or
   `git worktree prune` after the fact.
5. A deleted branch reappears in `git branch -a` → the remote-tracking ref survives →
   `git fetch --prune`.
6. A dead-end branch kept "just in case" → the branch list stops meaning anything → the finish
   menu; a written lesson beats a branch nobody dares delete.

## References

- `references/worktrees.md` — creating, using or removing a worktree: the root, the native path and
  the git fallback, one worktree per agent, untracked files, clean-up.
- `references/finishing.md` — the branch is complete: pre-merge evidence, squash-merge and delete
  per platform, the not-merging paths, what to leave behind.
