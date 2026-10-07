---
name: pr-create
description: >-
  Use whenever a pull request has to be opened or its title and description written, on Azure DevOps
  or GitHub — "open the PR", "ship this branch", "write the PR description" — including linking the
  parent work item and naming what the change forces to deploy.
---

# pr-create — turn a pushed branch into a reviewable PR

## When

- A branch is complete (or complete enough to review) and needs a pull request.
- A PR title or description has to be written or rewritten.
- An Azure DevOps work item or a GitHub issue has to be linked to the change.
- A PR exists and new commits have to reach it.

Not for: branch naming and the merge itself (`branch-flow`), reviewing or commenting a PR
(`pr-review`), or Azure DevOps CLI configuration, auth and verbs (`azdo-cli`).

## Decide

### 1. Platform and target

| Remote host | Platform | PR opened through |
| --- | --- | --- |
| `github.com` | GitHub | `gh pr create` |
| `dev.azure.com`, `*.visualstudio.com` | Azure DevOps | the `az repos pr` verbs — see `azdo-cli` |

The PR **always targets the protected default branch** read from the remote, never a hardcoded name:
`git symbolic-ref --short refs/remotes/origin/HEAD`. Another target only when the user names it.

### 2. Title and description — always Italian, whatever the conversation is in

| Part | Rule |
| --- | --- |
| Title | one line, **imperative**, specific, no trailing period — `Aggiungi export fatture per tenant` |
| Body | what changed and why, as a few bullets, **plus the components to release** and a `Rischio merge:` line (reversibile / irreversibile + impatto); only what a reviewer needs |
| Never | a filled-in template with empty sections, a commit-by-commit dump, or a diff restated in prose |

Derive both from the change, not from the branch name: `git log --oneline origin/<base>..HEAD` and
`git diff --stat origin/<base>...HEAD`. Body shape and the trailer are in `description.md`.

### 3. Release scope — which components have to be released

**The body always names the releasable components this change forces a deploy of**, under a
`Rilascio:` block — one bullet per deployable, with the reason — so whoever deploys reads them off
the PR instead of inferring them from the diff. A shared library, a contracts package or a message
contract releases **its consumers, named one by one**, never itself; a migration releases the database
as its own step. Nothing deployable (docs, tests, pipelines) → the block still says `nessun
componente`: absent is indistinguishable from forgotten. Mapping, fan-out, ordering: `description.md`.

### 4. Linking the work — a precondition, not a step

**A pull request always carries at least one work item, and that item is the parent backlog item —
a User Story or PBI, a Bug, an Impediment, a TECH activity; on GitHub, the issue — never a Task.**
No linked parent item, no PR: a Task exists to carry hours (`worklog` owns them) and tells a
reviewer nothing about what was delivered.

Resolve it before the PR is created: collect the candidate ids the branch touches — branch name,
commit messages, what the session was working on — read each id's **type**, replace a `Task` with
its parent, de-duplicate, and link **all** of what is left. Types, parents, auth and org/project
resolution are `azdo-cli`'s. Nothing left → **stop and ask** which item this change belongs to, or
route to `workitem-create`. Several parents → link them all, and if they sit under **different
Features** say so: the branch is doing two things and may want splitting. Say it, do not refuse.

| Platform | Link | Effect |
| --- | --- | --- |
| Azure DevOps | attach the parent item to the PR (`azdo-cli`) | the item follows the PR and transitions on completion |
| GitHub | `Fixes #<n>` / `Closes #<n>` in the body | the issue closes on merge |

On Azure DevOps prefer the real PR-to-work-item link over pasting the item URL in the body: only
the link drives policy and item state.

### 5. Draft or ready

Draft when CI has not run yet, when the branch is a work in progress opened for early feedback, or
when the reviewer would waste a pass. Ready otherwise; never ready-for-review with a red local build.

## Do

```powershell
# facts first
$base = (git symbolic-ref --short refs/remotes/origin/HEAD) -replace '^origin/', ''
git fetch origin $base
git log --oneline "origin/$base..HEAD"; git diff --stat "origin/$base...HEAD"
git diff --name-only "origin/$base...HEAD"     # the release scope is built from this list
git push --set-upstream origin (git branch --show-current)

# body as a file, so newlines and code fences survive the shell
Set-Content -Path pr-body.md -Encoding utf8 -Value @'
- <what changed, one bullet per real change>
- <why, if it is not obvious from the change>

Rilascio:
- <deployable> — <perché è coinvolto>     (oppure una sola riga: nessun componente)

Fixes #<n>
'@
```

- **GitHub**:
  ```powershell
  gh pr create --base $base --title "<imperative title>" --body-file pr-body.md   # --draft when applicable
  gh pr view --json url --jq .url        # report this back
  ```
- **Azure DevOps**: create the PR, set its target branch, attach the work item and mark it draft
  through the `az repos pr` verbs — configuration, auth, org/project resolution and the MCP
  fallback all live in `azdo-cli`. Report the PR URL it returns.

Set the **merge intent on the create** — `--squash true --delete-source-branch true` on Azure DevOps,
the equivalent completion options on GitHub — so the standing squash + delete rule (`branch-flow`)
reaches auto-complete and every CLI path. A human pressing Complete in the web dialog is **not**
covered by them: only the `Limit merge types` → squash-only branch policy is, so say so.

Then delete `pr-body.md` and report the URL. Pushing more commits updates an open PR by itself —
no new PR, and no force-push unless the user asks.

## Traps

1. The body arrives with literal `\n` → it was passed inline through the shell → use `--body-file`
   (or the platform equivalent) with a real file.
2. The PR targets `main` in a repo whose default branch is `master` → the name was assumed →
   read it from `refs/remotes/origin/HEAD`.
3. "No commits between …" → the branch was never pushed → push with `--set-upstream` first.
4. The work item stays Active after the merge → the item was pasted as a URL, not linked → attach
   it as a real PR link.
5. An English title or body reaches the PR → the code's language leaked into the prose → title and
   body are Italian, always; the chat summary can stay in the user's language.
6. A second PR appears for the same branch → a new `create` was run instead of pushing → check for
   an open PR on this branch first, then push.
7. The description reads like a changelog of commits → it was generated from `git log` verbatim →
   describe the change, not its history.
8. A **Task** ends up linked to the PR → the first id found on the branch was linked without reading
   its type → read the type, walk to the parent, link that.
9. A PR is opened with no item attached → nobody stopped to ask → an unlinked PR is not a valid
   outcome: ask which item the change belongs to, or create it (`workitem-create`).
10. The body has no `Rilascio:` block → the change "looked local" → every PR carries one; a PR that
    deploys nothing says `nessun componente` instead of staying silent.
11. `Rilascio:` names the changed library, or misses a consumer of a changed contract → the fan-out
    was skipped → resolve the consumers by project reference and by message type, not by memory.

## References

- `description.md` — the body a reviewer needs: the bullet shape, deriving it from the diff and the
  work item, mapping changed files to the deployables to release, the trailer, and the draft note.
