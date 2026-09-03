---
name: pr-create
description: >-
  Open a pull request on Azure DevOps or GitHub, with an Italian title and description and the work
  item or issue linked. Use when creating a PR, when writing a PR title or body, or when a finished
  branch has to be turned into a reviewable change. Covers platform detection from the remote,
  targeting the protected default branch, the imperative Italian title rule, the body a reviewer
  actually needs, linking the work item, draft versus ready, and re-pushing an open PR.
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

The PR **always targets the protected default branch** read from the remote, never a hardcoded
name: `git symbolic-ref --short refs/remotes/origin/HEAD`. Target another branch only when the user
names it (a stacked PR, a release branch).

### 2. Title and description — always Italian

Regardless of the language of the conversation:

| Part | Rule |
| --- | --- |
| Title | one line, **imperative**, specific, no trailing period — `Aggiungi export fatture per tenant` |
| Body | what changed and why, as a few bullets; only what a reviewer needs |
| Never | a filled-in template with empty sections, a commit-by-commit dump, or a diff restated in prose |

Derive both from the change, not from the branch name: `git log --oneline origin/<base>..HEAD` and
`git diff --stat origin/<base>...HEAD`. Body shape and the trailer are in `description.md`.

### 3. Linking the work

| Platform | Link | Effect |
| --- | --- | --- |
| Azure DevOps | attach the work item to the PR (`azdo-cli`) | the item follows the PR and transitions on completion |
| GitHub | `Fixes #<n>` / `Closes #<n>` in the body | the issue closes on merge |
| Neither exists | say so in the body in one line | nothing silently implied |

On Azure DevOps prefer the real PR-to-work-item link over pasting the item URL in the body: only
the link drives policy and item state.

### 4. Draft or ready

Draft when CI has not run yet, when the branch is a work in progress opened for early feedback, or
when the reviewer would waste a pass. Ready otherwise. Never open ready-for-review with a red
local build.

## Do

```powershell
# facts first
$base = (git symbolic-ref --short refs/remotes/origin/HEAD) -replace '^origin/', ''
git fetch origin $base
git log --oneline "origin/$base..HEAD"; git diff --stat "origin/$base...HEAD"
git push --set-upstream origin (git branch --show-current)

# body as a file, so newlines and code fences survive the shell
Set-Content -Path pr-body.md -Encoding utf8 -Value @'
- <what changed, one bullet per real change>
- <why, if it is not obvious from the change>

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

## References

- `description.md` — the body a reviewer actually needs: the bullet shape, how to derive it from
  the diff and the work item, what to leave out, the Claude trailer, and the draft-PR note.
