# Finishing a development branch

The point where implementation stops and integration starts. The mistake this page prevents is
merging on momentum: the work feels done, so the branch goes in. "Done" is a claim that needs
evidence, and not every finished branch deserves to merge at all.

## 1. Establish that it is actually done

Before the menu, get the facts — never assert them from memory:

```powershell
git status --short                      # nothing uncommitted, nothing untracked and forgotten
$base = (git symbolic-ref --short refs/remotes/origin/HEAD) -replace '^origin/', ''
git fetch origin $base
git log --oneline "origin/$base..HEAD"  # what this branch actually adds
git diff --stat "origin/$base...HEAD"   # how wide the change is
```

Then run the repo's own gates — build, tests, linter, formatter — and read the output. `done-check`
owns which evidence each kind of change requires; do not restate it here, run it.

If a gate is red, the branch is not finished. That is the whole decision.

## 2. The menu

| State | Move | Leaves behind |
| --- | --- | --- |
| Done, gates green, wanted | push → PR → review → **squash-merge** → delete the branch | one commit on the default branch |
| Done, gates red | fix the gate, then re-enter the menu | nothing yet |
| Works, but the approach is wrong | do not merge; write down the approach and why it loses | a note, and usually a work item |
| Partly wanted | cherry-pick the good commits onto a fresh branch, abandon the rest | a smaller PR |
| Dead end | delete local and remote branch | a written lesson, not a branch |
| Wanted later, not now | keep the branch, rebase it while it is cheap, say what blocks it | a named blocker |

Never merge to "keep the work safe". A push already keeps it safe; merging publishes it.

## 3. Merging, per platform

Both platforms: **squash** (one commit per PR, linear history) and **delete the source branch**
after the merge. Both gates — pipeline green and at least one approved review — apply on both.

- **GitHub** — `gh pr merge <n> --squash --delete-branch`. Add `--auto` to let it merge itself once
  the checks pass instead of babysitting them.
- **Azure DevOps** — completion, squash and delete-source-branch are `az repos pr` options; the
  verbs, the auth and the org/project resolution belong to `azdo-cli`. Set the PR to complete
  automatically when the policies pass rather than polling the build.
- Either platform: if the PR carries a work item link, let the merge transition the item instead of
  editing it by hand afterwards.

Approving and merging a PR is a human decision. Prepare it, report it, do not decide it.

## 4. After the merge

```powershell
git switch $base; git pull --ff-only
git branch --delete feature/<name>      # -D only if the branch was squashed (git sees it unmerged)
git fetch --prune                       # drop the remote-tracking ref
git worktree remove ../<repo>-<topic>   # if the work lived in a worktree
```

A squash-merged branch looks **unmerged** to `git branch --merged`, because its commits never
appear on the base. That is expected — check the PR state, not the merge base, before deleting.

## 5. Not merging, properly

A branch that will not merge still owes an explanation. Write, in this order:

1. what the branch does, in one line;
2. why it is not merging — wrong layer, cost, a requirement that changed, a simpler fix found;
3. what would have to be true for it to merge;
4. anything reusable from it — a test, a repro script, a query, a measurement.

Then delete it, or keep it with the blocker named. An unexplained branch left alive is a decision
deferred forever, and it makes every other branch in the list less trustworthy.

## Traps

1. "All tests pass" claimed without running them → memory of the last run → run them and read the
   output; `done-check` exists for this.
2. Merged to protect the work → confusing push with merge → push protects, merge publishes.
3. Squash-merged branch not deleted because `--merged` does not list it → squash rewrites history →
   trust the PR state.
4. Merge commit instead of squash → the platform's default button was used → squash, so one PR is
   one commit.
5. A dead end deleted with nothing written down → the same approach gets retried in two months →
   the lesson is the deliverable of a failed branch.
6. Work item left Active after the merge → the transition was left to a human → link the item on
   the PR and let completion move it.
