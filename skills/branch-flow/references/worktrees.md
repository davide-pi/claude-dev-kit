# Isolated Claude workspaces

A parallel change gets its own Claude workspace: a new session in the desktop app, with its own
checkout of the same repository on its own branch. Branches and the remote are shared; the files on
disk and the checked-out branch are not. That is the right tool for "I need to work on something else
without disturbing what is in front of me". A Claude workspace is a git worktree the app creates and
removes for the session (through the `WorktreeCreate` hook), so a separate change in its own workspace
can't collide with another session's files. Inside one change, `build` runs parallel tasks in the same
tree only when their files are disjoint. Don't create checkouts by hand with `git worktree add`.

## Open one

1. Fetch and name the branch first (`SKILL.md` § 2): `git fetch origin <base>`, branch off `origin/<base>`.
2. Open a new workspace in the desktop app for the repo and start the work there.
3. Say which workspace holds which branch, so nobody edits the same branch twice.

## Rules that keep workspaces cheap

1. **One branch, one workspace.** Git refuses to check out the same branch twice; keep it that way.
2. **One workspace per agent.** Parallel agents never share a checkout or a branch. A subagent can't
   open a desktop workspace: it gets its isolation from the Agent tool's `isolation: "worktree"`, which
   the `WorktreeCreate` hook (`hooks/worktree-root.js`) places under `CLAUDE_WORKTREE_ROOT` (unset: a
   sibling of the repo), as `<root>\<repo>-<name>` on branch `worktree-<name>`.
3. **Name the branch after the work**, not after the date.
4. **Untracked files do not follow.** `.env`, local `appsettings.*.json`, `node_modules`, build
   output and user-secret files exist only where they were created: copy or re-create what the
   build needs, and expect the first build there to be a cold one.
5. **Install and restore per workspace** (`dotnet restore`, `npm install`): `obj/`, `bin/` and
   `node_modules` are not shared.

## Closing one

A workspace is a git worktree that holds its branch, so git refuses to delete or switch that branch
while it exists. After the finish menu in `finishing.md`, close or archive the workspace in the
desktop app first (that removes its worktree); only then delete the branch. Leftovers show in
`git worktree list`; `git worktree prune` clears the stale entries.

## Traps

1. Tests pass in one workspace and fail in another → an untracked local config file was never
   copied → copy the local settings, do not commit them.
2. Two agents share one workspace → interleaved edits and lost work → one workspace per agent.
3. A workspace lives for weeks and drifts far behind → nobody rebased it → rebase onto
   `origin/<base>` while it is still cheap, or finish the branch.
