---
name: branch-flow
description: >-
  Branch conventions, isolated worktrees and branch finishing, on both Azure DevOps and GitHub. Use
  when new work starts and nothing is branched yet, when naming or renaming a branch, when work
  needs isolation from the current tree, or when a finished branch has to reach the default branch
  — or must not. Covers the protected default branch, `feature/*` and `fix/*` prefixes, kebab-case
  names, platform detection from the remote, worktrees, squash-merge through a pull request, and
  what to do with a branch nobody wants merged.
---

# branch-flow — branch it, isolate it, finish it

**Language — one sentence, two languages.** This skill's instructions are English, and so is
everything it produces as an **identifier**: branch names (`feature/*`, `fix/*`, kebab-case), the
default-branch name, git commands and flags, platform verbs. Everything it says to a person is
**Italian**: why a branch is named the way it is, the finish menu when it is actually presented, the
recommendation, and the reason a branch is not merging. The two mix inside the same paragraph, and
that is correct — *"Ho creato `feature/tenant-billing-dashboard` partendo da `origin/main`: il
working tree era sporco, quindi ho isolato il lavoro in un worktree"*. The identifier is never
translated; the prose around it is never left in English.

## When

- New work starts and nothing has been branched yet.
- A branch name carries the wrong prefix or the wrong case.
- Work needs isolation from the current tree: a dirty tree, a parallel experiment, an agent fan-out.
- Implementation is complete and the branch has to reach the default branch — or must not.
- A commit or a push is about to land on the default branch.

Not for: the PR title and body (`pr-create`), reviewing a PR (`pr-review`), writing the commit
message (`/commit`), or Azure DevOps CLI configuration and verbs (`azdo-cli`).

## Decide

### 1. Platform — read the remote once, then stop guessing

| `git remote get-url origin` contains | Platform | PR, merge and branch delete go through |
| --- | --- | --- |
| `github.com` | GitHub | `gh` |
| `dev.azure.com`, `*.visualstudio.com` | Azure DevOps | `azdo-cli` |
| anything else | unknown | ask before pushing anything |

**The default branch is protected on both platforms**: no direct push, every change arrives through
a pull request. Its name is `main` on newer repos and `master` on older ones — read it, never
assume: `git symbolic-ref --short refs/remotes/origin/HEAD`.

### 2. Branch — prefix, then name

| Work | Prefix | Example |
| --- | --- | --- |
| feature, chore, tooling, docs, refactor — anything not a fix | `feature/` | `feature/tenant-billing-dashboard` |
| bug fix | `fix/` | `fix/mobile-gallery-overflow` |

- Everything after the prefix is **kebab-case**: lowercase words joined by `-`, short and specific.
- Always branch off the **freshly fetched** default branch, and open the PR back into it.
- If the repo already uses other prefixes (`bugfix/`, `hotfix/`, `release/`), follow the repo —
  check `git branch -r` before inventing a third convention.
- On Azure DevOps, put the work item id in the name only if the repo already does it.

### 3. Isolate — worktree or current tree

| Situation | Where the work happens |
| --- | --- |
| short change, clean tree | current tree, new branch |
| tree dirty with unrelated work in progress | **worktree** |
| two changes in flight at the same time | one **worktree** each |
| experiment likely to be thrown away | **worktree** |
| a written plan spanning many files or sessions | **worktree** |
| parallel agents touching the same repo | one **worktree** per agent |

A worktree is a second checkout of the same repository on its own branch — no stash, no context
switch, no half-finished edits mixed together. Mechanics in `worktrees.md`.

### 4. Finish — the menu once the work is complete

| State of the work | Move |
| --- | --- |
| done and verified | push, open the PR (`pr-create`), **squash-merge**, delete the branch |
| done but gates red | fix the gate first — a red pipeline or a pending review is not a merge |
| valuable but must not merge as-is | keep the branch, say why, and record what would have to change |
| dead end | delete it locally and remotely, and write down what was learned |
| partly wanted | cherry-pick the wanted commits onto a fresh branch, drop the rest |

Merge only when the pipeline is green **and** at least one review is approved. Squash, so the
default branch keeps one commit per PR. Full decision walk in `finishing.md`.

## Do

```powershell
# where am I, and what is protected?
git remote get-url origin
git symbolic-ref --short refs/remotes/origin/HEAD    # e.g. origin/main -> the protected branch
git status --short; git branch --show-current

# start work from a fresh base ($base = the name read above, without the origin/ prefix)
git fetch origin $base
git switch --create feature/<kebab-case-name> "origin/$base"

# wrong prefix or wrong case, before pushing
git branch --move <old> feature/<new>

# already pushed under the wrong name
git push origin --delete <old>; git push --set-upstream origin feature/<new>

# after the PR is merged: drop the local branch and the stale remote ref
git switch $base; git pull --ff-only
git branch --delete feature/<name>; git fetch --prune
```

## Traps

1. `git diff master...HEAD` shows merged commits → the local default branch is stale → always diff
   and branch off `origin/<base>` after a fetch.
2. A commit lands on the protected branch → work started before branching → the default-branch
   guard hook asks first; branch, then `git switch` and commit there.
3. `git checkout -b` off a stale local base → the base was never fetched → fetch, then branch off
   the remote ref.
4. A branch named `Feature/Fix_Login` is rejected or duplicated → prefix and case are conventions,
   not suggestions → rename before pushing; after pushing, delete the remote ref too.
5. Stash used to juggle two changes → one of them gets forgotten or popped onto the wrong branch →
   use a worktree instead.
6. A worktree is removed with `Remove-Item` → git keeps a dangling administrative entry →
   `git worktree remove`, or `git worktree prune` after the fact.
7. The branch is deleted after merge but keeps reappearing in `git branch -a` → the remote-tracking
   ref survives → `git fetch --prune`.
8. A dead-end branch is left alive "just in case" → the branch list stops meaning anything → decide
   with the finish menu; a lesson written down beats a branch nobody dares delete.

## References

- `worktrees.md` — creating, using and removing an isolated worktree: the native worktree tooling
  first, the plain git command as fallback, one worktree per agent, and the clean-up rules.
- `finishing.md` — the full finish walk: pre-merge gates, squash-merge and branch delete on both
  platforms, the not-merging paths, and what to leave behind either way.
