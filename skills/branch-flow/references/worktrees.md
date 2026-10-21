# Isolated worktrees

A worktree is a second working directory for the **same** repository, checked out on its own branch.
The `.git` directory is shared, so branches, remotes, stashes and the object store are the same —
only the files on disk and the checked-out branch differ. That is what makes it the right tool for
"I need to work on something else without disturbing what is in front of me".

## Where: the root first, then the tool

Every worktree lives under `$env:CLAUDE_WORKTREE_ROOT` as `<repo>-<short-topic>` — a short root
keeps deep repos under the Windows path limit. Unset → beside the repo (`../<repo>-<topic>`).

| Need | Native move — only when the `worktree-root.js` hook (`WorktreeCreate`) is installed | Otherwise |
| --- | --- | --- |
| work in isolation for a while, then come back | `EnterWorktree` / `ExitWorktree` | `git worktree add` + `git worktree remove` |
| a subagent with its own copy of the repo | `isolation: "worktree"` on the agent call | create the worktree first, pass its path in the brief |

Without the hook the native tools create under `<repo>\.claude\worktrees\` — inside the repo and
past the path limit — so the git fallback below is the default, not a downgrade. Check for the hook:
`Get-Content ~/.claude/settings.json | Select-String WorktreeCreate`. Say which route was used.

## The git fallback

```powershell
# one directory per worktree, <repo>-<short topic>, under CLAUDE_WORKTREE_ROOT — unset → beside the repo
$wt   = "$env:CLAUDE_WORKTREE_ROOT/<repo>-<topic>"   # no root: "../<repo>-<topic>"
$base = (git symbolic-ref --short refs/remotes/origin/HEAD) -replace '^origin/', ''
git fetch origin $base

# new branch + new checkout in one move
git worktree add $wt --track -b feature/<topic> "origin/$base"

# an existing branch instead
git worktree add $wt feature/<topic>

git worktree list                       # what exists, and which branch each one holds
```

Then work in that directory. Every git command inside it behaves normally; commits land on that
worktree's branch only.

## Rules that keep worktrees cheap

1. **One branch, one worktree.** Git refuses to check out the same branch twice, and that refusal
   is a feature — do not work around it with a detached HEAD.
2. **Outside the repository.** A worktree nested in the main checkout ends up in globs, watchers,
   test discovery and, eventually, a commit. Put it under the worktree root, or beside the repo.
3. **Name it after the work**, not after the date: `<repo>-tenant-billing`, so `git worktree
   list` reads like a to-do list. Short: every character counts against the path limit.
4. **Untracked files do not follow.** `.env`, local `appsettings.*.json`, `node_modules`, build
   output and user-secret files exist only in the tree that created them: copy or re-create what the
   build needs, and expect the first build there to be a cold one.
5. **Install and restore per worktree** (`dotnet restore`, `npm install`): the package caches are
   shared but the `obj/`, `bin/` and `node_modules` directories are not.
6. **A worktree is not a backup.** It shares the object store; deleting the repo takes it with it.

## Removing one

```powershell
git worktree remove $wt           # refuses if the tree is dirty — look before forcing
git worktree remove --force $wt   # only when the changes are genuinely disposable
git worktree prune                              # after a manual directory delete
```

Remove the worktree **before** deleting its branch, and delete the branch through the finish menu in
`finishing.md` rather than by hand — a merged branch and an abandoned one get different treatment.

## Traps

1. The worktree directory is deleted with `Remove-Item` → git still lists it and refuses to reuse
   the branch → `git worktree prune`.
2. `git worktree add` fails with "already checked out" → that branch lives in another worktree →
   `git worktree list` to find it, then reuse or pick another branch.
3. Tests pass in the main tree and fail in the worktree → an untracked local config file was never
   copied → copy the local settings, do not commit them.
4. Two agents share one worktree → interleaved edits and lost work → one worktree per agent, and no
   shared branch between them.
5. A worktree lives for weeks and drifts far behind → nobody rebased it → rebase onto
   `origin/<base>` while it is still cheap, or finish the branch.
