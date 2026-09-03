---
description: Working tree to shipped: branch, commit, push, PR with a generated description, work item linked, links reported — stops before merge.
argument-hint: "[work-item-id] [-b <branch>] [--draft] [-t <target-branch>]"
---

Take the current change all the way to an open pull request in one pass. Conventions are **not**
re-decided here: branch naming and the default-branch rule come from **`branch-flow`**, the PR title
and body shape from **`pr-create`**, the Azure DevOps CLI mechanics from **`azdo-cli`**. This
command runs the sequence and reports the links.

**Output language** — stated here rather than inherited, because the three outputs do not agree:

| Output | Language |
| --- | --- |
| Branch name | **English** kebab-case — it is an identifier (`feature/invoice-export`) |
| Commit subject and body | **Italian**, per `/commit`; the code and its comments stay English |
| PR title and description | **Italian**, per `pr-create` |

Machine identifiers inside those texts — `AB#<id>`, `Fixes #<n>`, branch and file names, work-item
state names — are written as-is and never translated. The step 8 report is Italian.

## Argument grammar

Parse "$ARGUMENTS"; order does not matter, all parts optional.

- **`<number>`** (bare digits) → the id to start from; step 6 resolves it to the item actually
  linked. Absent → infer the candidates from the branch name, then from the commit subjects, then
  from what the session was working on.
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
     kebab-case name **in English** per `branch-flow` (`-b` wins), then `git switch -c <name>`,
     carrying the working tree along.
   - Already on a feature branch → keep it; state which one.

4. **Commit** — stage what step 2 listed (`git add -A`, or only the already-staged set if the user
   staged deliberately), generate the message **in Italian** per the **`/commit`** rules, then
   `git commit -m "<subject>"`. A failing hook stops the run — surface its output, never
   `--no-verify`.

5. **Push** — `git push -u origin <branch>`. A rejected push means the remote moved: report and
   stop; do not force.

6. **Work item — the precondition** — a PR always carries at least one item, and it is the **parent
   backlog item** (User Story or PBI, Bug, Impediment, TECH activity; on GitHub, the issue), never a
   **Task**, which only carries hours. For every candidate id read its **type**; a `Task` is replaced
   by its parent, then de-duplicate — types, parents and org/project resolution via `azdo-cli`.
   Nothing resolvable → **stop and ask** which item this change belongs to, or route to
   `workitem-create`. Several parents → link them all, and if they sit under different Features say
   the branch may want splitting.

7. **Pull request** — title and body **in Italian** per `pr-create`: one imperative title line
   with no trailing period; body = what changed and why, from `git log <base>..HEAD` and the diff.
   The `<id>` below is the parent item resolved in step 6.

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
   shells. On GitHub the link is `Closes #<n>` in the body. Verify every link came back in the
   create output — an item missing from it is not linked: add it with
   `az repos pr work-item add --id <pr-id> --work-items <id>` and read the result again.

8. **Report** — one block, in Italian: branch, commit hash, PR id and URL, **which item was linked**
   — saying it is the parent when the id given was a Task — the target branch, and one line on what
   still gates the merge (checks running, reviewers required).

## Guardrails

- **Never merge, complete or abandon.** No `gh pr merge`, no `az repos pr update --status
  completed`, no `--auto-complete`, no `--bypass-policy`. The command ends at an open PR.
- **Never commit on the default branch** — step 3 branches instead, always.
- **Never open a PR with no work item linked** — step 6 stops and asks instead.
- Never `git push --force` / `--force-with-lease`, never `git rebase`, never amend an existing
  commit, never `--no-verify`.
- Do not transition the work item's state and do not assign reviewers unless the user asked in this
  invocation.
- Do not run builds or tests to decide whether to ship; CI is the gate. If the user wants a gate
  first, that is `done-check`.
- No `--delete-source-branch`: branch cleanup belongs to `branch-flow` after the merge.
