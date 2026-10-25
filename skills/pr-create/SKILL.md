---
name: pr-create
description: >-
  Use when a pull request is opened or its title and description written: "open the PR", "ship
  this branch", "write the PR description".
---

# pr-create — turn a pushed branch into a reviewable PR

**Contract.** An open PR with title, body, `Rilascio:` block and the parent work item linked ·
never merges, never opens a PR with no parent item · title and body Italian, identifiers verbatim.

## When

- A branch is complete, or complete enough to review, and needs a PR.
- A PR title or description has to be written or rewritten.
- A PR exists and new commits have to reach it (push; no second PR).

Not for: branch naming and the merge (`branch-flow`), reviewing a PR (`pr-review`), Azure DevOps
verbs and auth (`azdo-cli`).

## Decide

### 1. Target

Platform from the remote (`github.com` → `gh`; `dev.azure.com`, `*.visualstudio.com` → `az repos`).
Target = the default branch read from `refs/remotes/origin/HEAD`, another only when the user names
it. An open PR already exists on this branch → push to it, never create a second.

### 2. The parent item — a precondition, not a step

The PR links at least one **parent backlog item** — User Story or PBI, Bug, Impediment, TECH; on
GitHub the issue — **never a Task** (a Task carries hours, not intent).

| Step | Rule |
| --- | --- |
| collect | candidate ids from the branch name, commit messages, the session's work |
| resolve | read each id's **type**; a Task → its parent; de-duplicate; link all that remain |
| none left | **stop and ask once**, answerable with one pick: numbered options from the likely candidates — an `AB#` in the branch or commits, recent items assigned to the owner (`az boards query`, `@Me`, changed lately, never a Task) — plus "create one" (`workitem-create`); never create an item unasked |
| parents under different Features | link them all and say so: the branch may be doing two things |
| link | Azure DevOps: `--work-items` on the create (a real link drives policy and state; a URL in the body drives nothing) · GitHub: `Fixes #<n>` / `Closes #<n>`, `Refs #<n>` when it does not close |

The shell guard's `alm-contract.js` check asks on an `az repos pr create` lacking `--work-items` or the squash
flags: a prompt there means the precondition was skipped.

### 3. Title and body — Italian, derived from the diff

| Part | Rule |
| --- | --- |
| title | one imperative line, specific, no period: `Aggiungi export fatture per tenant`; it becomes the squash commit subject |
| body | one bullet per real change and its why; anything the reviewer must not miss (migration, config key, breaking signature); out of scope named |
| `Rilascio:` | always present — see §4 |
| `Rischio merge:` | always present: `reversibile` or `irreversibile` (what cannot be undone); `impatto:` who or what breaks |
| `Verifica:` | only when something was run: the command, before → after; nothing run → no block |
| never | an empty template, a commit-by-commit dump, a diff retold in prose, secrets or customer data |

Source: `git log` and `git diff --stat` against `origin/<base>`, plus the linked item's text — a gap
between what the item asked and what the branch does is a body note.

### 4. `Rilascio:` — what this change forces to deploy

One bullet per deployable with the reason, real names from the repo. A shared library, contracts
package or message contract releases **its consumers, named one by one**, never itself; a migration
releases its deployable plus the database as its own step, with the ordering. Nothing deployable →
`Rilascio: nessun componente` (absent reads as forgotten). Never "tutti i servizi". A file that maps
to nothing → `non risolto: <path>`. Mapping and fan-out: `references/description.md`.

### 5. Draft or ready

Draft when CI has not run, the branch is opened for early feedback, or the description is not final.
Never ready with a red local build.

## Do

```powershell
$base = (git symbolic-ref --short refs/remotes/origin/HEAD) -replace '^origin/', ''
git fetch origin $base
git log --oneline "origin/$base..HEAD"; git diff --stat "origin/$base...HEAD"
git diff --name-only "origin/$base...HEAD"            # the Rilascio fan-out starts here
git push --set-upstream origin (git branch --show-current)
# body as a UTF-8 file: newlines and code fences survive the shell
Set-Content -Path pr-body.md -Encoding utf8 -Value $body

# GitHub
gh pr create --base $base --title '<titolo>' --body-file pr-body.md      # --draft when applicable
gh pr view --json url --jq .url

# Azure DevOps — org and project from the ALM: line; one --description value per line
az repos pr create --org $org -p $proj --repository <repo> --source-branch (git branch --show-current) `
  --target-branch $base --title '<titolo>' --description (Get-Content pr-body.md -Encoding utf8) `
  --work-items <id> --squash true --delete-source-branch true --draft false
```

Merge intent goes on the **create** (squash + delete source branch): it reaches auto-complete and
every CLI completion. The web dialog's Complete button is covered only by the `Limit merge types` →
squash-only branch policy: suggest it where the repo lacks it. Then delete `pr-body.md` and report the
URL.

## Traps

1. "No commits between …" → the branch was never pushed → push with `--set-upstream` first.
2. The item stays Active after the merge → it was pasted as a URL → link it for real.
3. An English title or body → the code's language leaked → title and body are Italian, always.
4. The body reads like a changelog → `git log` was pasted → describe the change, not its history.
5. `Rilascio:` names the changed library, or misses a consumer → the fan-out was skipped → resolve
   consumers by project reference and by message type, not by memory.

## References

- `references/description.md` — writing the body: the bullet shape with a worked example, mapping
  files to deployables and the reference fan-out, `Rischio merge` and `Verifica` forms, the trailer,
  draft notes.
