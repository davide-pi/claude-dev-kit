---
description: Working tree to shipped: branch, commit, push, PR with a generated description, work item linked, links reported — stops before merge.
argument-hint: "[work-item-id] [-b <branch>] [--draft] [-t <target-branch>]"
---

Take the current change all the way to an open pull request in one pass. Conventions are **not**
re-decided here: branch naming and the default-branch rule come from **`branch-flow`**, the PR title
and body shape from **`pr-create`**, the Azure DevOps CLI mechanics from **`azdo-cli`**. This
command runs the sequence and reports the links.

## Argument grammar

Parse "$ARGUMENTS"; order does not matter, all parts optional.

- **`<number>`** (bare digits) → the work item / issue to link. Absent → infer from the current
  branch name, else from the commit subject, else ship without a link and say so.
- **`-b <branch>`** → create this branch instead of deriving a name.
- **`-t <branch>`** → PR target; default the repo's default branch.
- **`--draft`** → open the PR as a draft.

## Steps (run in order)

1. **Platform** — `git remote get-url origin`: `dev.azure.com` / `visualstudio.com` → Azure DevOps,
   `github.com` → GitHub. Never assume: no recognised remote → stop and say which step needs it.

2. **Preflight** — `git status --short` and `git diff --stat`. Nothing to ship and nothing unpushed
   → stop and say so. Report untracked files explicitly before they get swept in.

3. **Branch** — `git branch --show-current`.
   - On the repo's **default branch** → never commit there. Derive a `feature/…` or `fix/…`
     kebab-case name per `branch-flow` (`-b` wins), then `git switch -c <name>`, carrying the
     working tree along.
   - Already on a feature branch → keep it; state which one.

4. **Commit** — stage what step 2 listed (`git add -A`, or only the already-staged set if the user
   staged deliberately), generate the message per the **`/commit`** rules, then
   `git commit -m "<subject>"`. A failing hook stops the run — surface its output, never
   `--no-verify`.

5. **Push** — `git push -u origin <branch>`. A rejected push means the remote moved: report and
   stop; do not force.

6. **Pull request** — title and body per `pr-create` (English, imperative title, body = what
   changed and why, from `git log <base>..HEAD` and the diff).

   Azure DevOps:
   ```powershell
   az repos pr create --source-branch <branch> --target-branch <base> `
     --title "<title>" --description "<line1>" "<line2>" --work-items <id> --draft false
   ```
   GitHub:
   ```powershell
   gh pr create --base <base> --head <branch> --title "<title>" --body-file <file>
   ```
   Long bodies go through `--body-file` on GitHub and repeated `--description` values on Azure
   DevOps (each value becomes a new line) — never a shell heredoc, which breaks across the two
   shells.

7. **Link the work item** — Azure DevOps: `--work-items` in step 6, or afterwards
   `az repos pr work-item add --id <pr-id> --work-items <id>`. GitHub: reference `Closes #<n>` in
   the body. Verify the link came back in the create output; if it did not, say so rather than
   assuming.

8. **Report** — one block: branch, commit hash, PR id and URL, the linked item, the target branch,
   and one line on what still gates the merge (checks running, reviewers required).

## Guardrails

- **Never merge, complete or abandon.** No `gh pr merge`, no `az repos pr update --status
  completed`, no `--auto-complete`, no `--bypass-policy`. The command ends at an open PR.
- **Never commit on the default branch** — step 3 branches instead, always.
- Never `git push --force` / `--force-with-lease`, never `git rebase`, never amend an existing
  commit, never `--no-verify`.
- Do not transition the work item's state and do not assign reviewers unless the user asked in this
  invocation.
- Do not run builds or tests to decide whether to ship; CI is the gate. If the user wants a gate
  first, that is `done-check`.
- No `--delete-source-branch`: branch cleanup belongs to `branch-flow` after the merge.
