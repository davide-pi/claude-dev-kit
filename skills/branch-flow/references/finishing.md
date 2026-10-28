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

Then run the repo's own gates — build, tests, linter, formatter — and read the output.
`plan-work`'s `references/evidence-by-stack.md` owns which evidence each kind of change requires;
do not restate it here, run it.

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

Presented to the user: one line per option, in the chat language, that actually applies — *"Fatto e verificato →
push, PR, squash-merge, cancello il branch"*.

Never merge to "keep the work safe". A push already keeps it safe; merging publishes it.

Every route through a PR needs a linkable parent backlog item (never a Task): nothing linkable →
ask which item the work belongs to before the push (`pr-create` owns the rule).

## 3. Merging, per platform

Both platforms: **squash** (one commit per PR, linear history) and **delete the source branch**
after the merge. This is not a preference to weigh per PR — it is the only strategy used here, and a
merge commit or a surviving branch is a mistake to fix, not an outcome to report. If a repository
policy forbids squash, **stop and say so**; do not quietly merge some other way. Both gates apply
on both platforms: pipeline green, and the PR reviewed — `/code-review <pr>` (AI) plus the owner's own
read. There is no second human reviewer: a human approval is required only where the repository's
branch policy demands one.

The intent is set at **creation** (`pr-create` passes it), which covers auto-complete and every CLI
completion; setting it again at completion is belt and braces, not a duplicate. What it does **not**
cover is a human pressing Complete in the web dialog — only the branch policy `Limit merge types`
(squash only) on the default branch does. Suggest it where the repo does not have it.

- **GitHub** — `gh pr merge <n> --squash --delete-branch`. Add `--auto` to let it merge itself once
  the checks pass instead of babysitting them.
- **Azure DevOps** — completion, squash and delete-source-branch are `az repos pr` options; the
  verbs, the auth and the org/project resolution belong to `azdo-cli`. Set the PR to complete
  automatically when the policies pass rather than polling the build.
- Either platform: if the PR carries a work item link, let the merge transition the item instead of
  editing it by hand afterwards.

Completing the merge is the owner's decision. Prepare it, report it, do not decide it.

## 4. After the merge

```powershell
git switch $base; git pull --ff-only
git branch -D feature/<name>            # always -D: every merge here is a squash, git sees it unmerged
git fetch --prune                       # drop the remote-tracking ref
git worktree remove <worktree-path>     # if the work lived in a worktree (see worktrees.md)
```

A squash-merged branch looks **unmerged** to `git branch --merged`, because its commits never
appear on the base. That is expected — check the PR state, not the merge base, before deleting.

## 5. Not merging, properly

A branch that will not merge still owes an explanation, written in the chat language because a person reads it
— the branch name and any command inside it stay as they are. Write, in this order:

1. what the branch does, in one line;
2. why it is not merging — wrong layer, cost, a requirement that changed, a simpler fix found;
3. what would have to be true for it to merge;
4. anything reusable from it — a test, a repro script, a query, a measurement.

Then delete it, or keep it with the blocker named. An unexplained branch left alive is a decision
deferred forever, and it makes every other branch in the list less trustworthy.

## Traps

1. "All tests pass" claimed without running them → memory of the last run → run them and read the
   output; `evidence-by-stack.md` (`plan-work`) exists for this.
2. Merged to protect the work → confusing push with merge → push protects, merge publishes.
3. Squash-merged branch not deleted because `--merged` does not list it → squash rewrites history →
   trust the PR state.
4. Merge commit instead of squash → the platform's default button was used → squash, so one PR is
   one commit.
5. A dead end deleted with nothing written down → the same approach gets retried in two months →
   the lesson is the deliverable of a failed branch.
6. Work item left Active after the merge → the transition was left to a human → link the item on
   the PR and let completion move it.
