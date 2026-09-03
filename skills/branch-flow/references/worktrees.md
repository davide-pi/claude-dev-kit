# Isolated worktrees

A worktree is a second working directory for the **same** repository, checked out on its own branch.
The `.git` directory is shared, so branches, remotes, stashes and the object store are the same —
only the files on disk and the checked-out branch differ. That is what makes it the right tool for
"I need to work on something else without disturbing what is in front of me".

## Native tooling first

Prefer whatever worktree support the running environment already exposes — it creates the
directory, tracks it, and cleans it up on the way out, so nothing is left dangling:

| Need | Native move | Fallback |
| --- | --- | --- |
| Work in isolation for a while, then come back | the harness worktree tools (`EnterWorktree` / `ExitWorktree`, when the session exposes them) | `git worktree add` + `git worktree remove` |
| Give a subagent its own copy of the repo | dispatch it with worktree isolation (`isolation: "worktree"` on the agent call) | create the worktree first, then pass its path to the agent |
| Editor-side worktree | the IDE's own worktree command | the git commands below |

Check for the native path before shelling out: it is not always available, and the plain git
command is a complete fallback, never a downgrade in correctness. Say which one was used — in
Italian, with the directory and branch names left as they are.

## The git fallback

```powershell
# one directory per worktree, as a sibling of the repo — never inside it
$base = (git symbolic-ref --short refs/remotes/origin/HEAD) -replace '^origin/', ''
git fetch origin $base

# new branch + new checkout in one move
git worktree add ../<repo>-<topic> --track -b feature/<topic> "origin/$base"

# an existing branch instead
git worktree add ../<repo>-<topic> feature/<topic>

git worktree list                       # what exists, and which branch each one holds
```

Then work in that directory. Every git command inside it behaves normally; commits land on that
worktree's branch only.

## Rules that keep worktrees cheap

1. **One branch, one worktree.** Git refuses to check out the same branch twice, and that refusal
   is a feature — do not work around it with a detached HEAD.
2. **Outside the repository.** A worktree nested in the main checkout ends up in globs, watchers,
   test discovery and, eventually, a commit. Put it beside the repo.
3. **Name it after the work**, not after the date: `../<repo>-tenant-billing`, so `git worktree
   list` reads like a to-do list.
4. **Untracked files do not follow.** `.env`, local `appsettings.*.json`, `node_modules`, build
   output and user-secret files exist only in the tree that created them: copy or re-create what the
   build needs, and expect the first build there to be a cold one.
5. **Install and restore per worktree** (`dotnet restore`, `npm install`): the package caches are
   shared but the `obj/`, `bin/` and `node_modules` directories are not.
6. **A worktree is not a backup.** It shares the object store; deleting the repo takes it with it.

## Removing one

```powershell
git worktree remove ../<repo>-<topic>           # refuses if the tree is dirty — look before forcing
git worktree remove --force ../<repo>-<topic>   # only when the changes are genuinely disposable
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
