---
name: item
description: >-
  Use when a work item or issue must be read in full: criteria, state, parent, links, discussion;
  or the user's active items listed. Read-only.
argument-hint: "[id | url] | (empty for your active items)"
---

# item — a work item on screen, in a form a person can act on

**Contract.** One item rendered in fixed sections, or the list of active items · never updates,
transitions, comments on or links an item · report in Italian; the item's content, field names,
states and paths verbatim.

Arguments: `$ARGUMENTS`

## When

- `/item <id>`, "fammi vedere il 4821", "quali sono i criteri del …": read one item.
- `/item` alone: the user's active items.

Not for: creating an item (`workitem-create`); planning how to build it (`plan-work`, after reading);
rewriting its text (`user-story-standard`).

## Decide

### Argument and platform

| Input | Action |
| --- | --- |
| a number, or a work-item URL (take the trailing id) | read that item |
| empty | list active items, then ask which to open |
| "create …" | stop, route to `workitem-create` |
| "how do I build …" | read it, then route to `plan-work` with the id |

Platform from `git remote get-url origin`: Azure DevOps → org and project from the session's `ALM:`
line, passed explicitly; GitHub → the item is an issue (`gh issue view <n> --comments`), same
sections. No line and no recognised remote → ask which org and project.

### Fields → sections

| Section | Source |
| --- | --- |
| header | `#<id> · System.WorkItemType · System.State · System.AssignedTo.displayName` + the URL |
| `Descrizione` | `System.Description` (a Bug also `Microsoft.VSTS.TCM.ReproSteps`) |
| `Criteri di accettazione` | `Microsoft.VSTS.Common.AcceptanceCriteria`, as a checklist |
| `Contesto` | parent (`System.LinkTypes.Hierarchy-Reverse`), children (`-Forward`), area, iteration, effort, priority |
| `Link` | `ArtifactLink` (PRs, commits), `AttachedFile` (name + URL, not downloaded) |
| `Discussione` | the comments, oldest first, `autore — data`, the last five unless all were asked for |

Field values are HTML: convert to markdown (lists, tables, line breaks, entities); never print raw
HTML. An empty description or criteria field is printed as the finding — `nessun criterio di
accettazione` — never dropped and never invented.

Close with one Italian line: the obvious next step and its owner (`plan-work`, `pr-create`).

## Do

```powershell
# the fields the sections use; --fields cannot combine with --expand, so the links are a second call
az boards work-item show --id <id> --org https://dev.azure.com/<org> --fields System.Id,System.WorkItemType,System.State,System.Title,System.AssignedTo,System.Description,Microsoft.VSTS.TCM.ReproSteps,Microsoft.VSTS.Common.AcceptanceCriteria,Microsoft.VSTS.Scheduling.Effort,Microsoft.VSTS.Common.Priority,System.AreaPath,System.IterationPath -o json
az boards work-item show --id <id> --org https://dev.azure.com/<org> --expand relations --query "relations[].{rel:rel,url:url,name:attributes.name}" -o json
# comments: no az verb — REST invoke, preview-only; the api-version that works lives in azdo-cli
az devops invoke --area wit --resource comments --org https://dev.azure.com/<org> `
  --route-parameters project=<project> workItemId=<id> --api-version <preview-version> -o json
# active items
az boards query --org https://dev.azure.com/<org> --project <project> -o table --wiql `
  "SELECT [System.Id],[System.WorkItemType],[System.Title],[System.State],[System.IterationPath] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.AssignedTo] = @Me AND [System.State] NOT IN ('Closed','Removed','Done') ORDER BY [System.ChangedDate] DESC"
```

The comments invoke fails → the MCP work-item tool per `azdo-cli` (behind a prompt), and the report
says which path produced the discussion.

## Traps

1. `az devops configure` defaults used instead of the `ALM:` line → wrong org → pass `--org` and
   `--project` every time.
2. Raw HTML pasted at the user → convert before printing.
3. `--open` launches a browser → print the URL instead.
4. Attachments downloaded unasked → list names and URLs only.
