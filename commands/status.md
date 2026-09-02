---
description: Where you stand right now — your open work items, your PRs and the PRs awaiting you, dirty or unpushed branches, red builds. Read-only.
argument-hint: "[items|prs|branches|builds] [--all]"
---

One read-only sweep of everything that is currently on the developer's plate. Nothing is created,
changed, transitioned or posted. Azure DevOps CLI mechanics (auth, WIQL, default org and project)
come from **`azdo-cli`**; this command only assembles the picture.

## Argument grammar

- *(empty)* → all four sections.
- **`items` | `prs` | `branches` | `builds`** → only that section (repeatable).
- **`--all`** → in `prs`, include PRs not involving the developer; in `builds`, include succeeded
  runs.

## Steps

1. **Detect the platform** — `git remote get-url origin`: `dev.azure.com` / `visualstudio.com` →
   Azure DevOps, `github.com` → GitHub. Outside a repo, or an unrecognised remote → run the
   `branches` section only and say the rest needs a repo.

2. **Identity** — `az account show --query user.name -o tsv` for the Azure DevOps filters;
   `@me` for GitHub. WIQL uses `@Me` directly and needs nothing resolved.

3. **Your work items** (Azure DevOps only):
   ```powershell
   az boards query --wiql "SELECT [System.Id],[System.WorkItemType],[System.Title],[System.State] FROM WorkItems WHERE [System.AssignedTo] = @Me AND [System.State] NOT IN ('Closed','Removed','Done') ORDER BY [System.ChangedDate] DESC" -o table
   ```
   On GitHub, substitute `gh issue list --assignee @me --state open --limit 20`.

4. **Your pull requests and the ones awaiting you**:
   ```powershell
   az repos pr list --status active --creator <you> -o table
   az repos pr list --status active --reviewer <you> -o table
   ```
   ```powershell
   gh pr status                      # yours, plus the ones requesting your review
   gh search prs --review-requested @me --state open --limit 20
   ```

5. **Local branches with work in them** — three cheap reads, no fetch, no switch:
   ```powershell
   git status --short                                  # uncommitted here
   git for-each-ref --format="%(refname:short) %(upstream:short) %(upstream:track)" refs/heads
   git branch --show-current
   ```
   Report each branch as *dirty* (uncommitted), *unpushed* (`[ahead N]`), *no upstream*, or clean.
   `[behind N]` is stale local information — label it as such, do not fetch to refresh it.

6. **Red runs** — last 5, failures only:
   ```powershell
   az pipelines runs list --status completed --result failed --top 5 --query-order FinishTimeDesc -o table
   ```
   ```powershell
   gh run list --status failure --limit 5
   ```
   A failure on the current branch is the headline; anything else is context.

7. **Report** — four short sections in this order, each at most five rows, newest first: **Items**,
   **PRs** (yours, then awaiting you), **Branches**, **Builds**. Then **one** closing line naming
   the single most urgent thing and the command that handles it (`/fix-ci`, `/ship`, `/item <id>`).

## Degrading gracefully

| Situation | What to do |
| --- | --- |
| No git remote / not a repo | branches section only, one line for the rest |
| Platform CLI not authenticated | name the section, say "not authenticated", carry on |
| Azure DevOps default org or project unset | say so and route to `azdo-cli`; do not guess |
| Repo has no pipelines or workflows | "no CI configured" — not an error |
| A section returns empty | "none" — an empty section is a valid, useful answer |

A section that cannot be read never aborts the others: report what worked, name what did not.

## Guardrails

- **Read-only.** No `create`/`update`/`delete` verbs, no `--open`, no state transitions, no
  comments, no votes, no `gh run rerun`, no `git fetch`/`switch`/`stash`/`commit`/`push`.
- Do not diagnose the red runs here — report the run and hand off to `/fix-ci`.
- Do not open browsers or dashboards; print URLs and let the user click.
- Never invent an identity or an organization to make a query work: an unresolved filter is a
  degraded section, not a guess.
- Keep it to one screen. This is a standing report, not an audit.
