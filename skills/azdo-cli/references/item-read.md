# Reading a work item in full

Read when the owner asks to see one item ("fammi vedere il 4821", "quali sono i criteri del …") or the
list of their active items. Read-only: never update, transition, comment on or link an item. Report in
the chat language; the item's content, field names, states and paths verbatim.

## Input and platform

| Input | Action |
| --- | --- |
| a number, or a work-item URL (take the trailing id) | read that item |
| no id ("i miei item") | list active items, then ask which to open |
| "create …" | not a read: `user-story-standard` writes the text, creation is `azdo-cli` after the owner confirms |
| "how do I build …" | read it, then route to `plan-work` with the id |

Platform from `git remote get-url origin`: Azure DevOps → org and project from the `ALM:` line, passed
explicitly; GitHub → the item is an issue (`gh issue view <n> --comments`), same sections. No line and no
recognised remote → ask which org and project.

## Fields → sections, in this order

| Section | Source |
| --- | --- |
| header | `#<id> · System.WorkItemType · System.State · System.AssignedTo.displayName` + the URL |
| `Descrizione` | `System.Description` (a Bug also `Microsoft.VSTS.TCM.ReproSteps`) |
| `Criteri di accettazione` | `Microsoft.VSTS.Common.AcceptanceCriteria`, as a checklist |
| `Contesto` | parent (`System.LinkTypes.Hierarchy-Reverse`), children (`-Forward`), area, iteration, effort, priority |
| `Link` | `ArtifactLink` (PRs, commits), `AttachedFile` (name + URL, not downloaded) |
| `Discussione` | the comments, oldest first, `autore — data`, the last five unless all were asked for |

Field values are HTML: convert to markdown (lists, tables, line breaks, entities); never print raw HTML.
An empty description or criteria field is printed as the finding — `nessun criterio di accettazione` —
never dropped and never invented. Close with one line in the chat language: the obvious next step and its owner
(`plan-work`, `pr-create`).

## Calls

```powershell
# --fields cannot combine with --expand, so the links are a second call
az boards work-item show --id <id> --org https://dev.azure.com/<org> --fields System.Id,System.WorkItemType,System.State,System.Title,System.AssignedTo,System.Description,Microsoft.VSTS.TCM.ReproSteps,Microsoft.VSTS.Common.AcceptanceCriteria,Microsoft.VSTS.Scheduling.Effort,Microsoft.VSTS.Common.Priority,System.AreaPath,System.IterationPath -o json
az boards work-item show --id <id> --org https://dev.azure.com/<org> --expand relations --query "relations[].{rel:rel,url:url,name:attributes.name}" -o json
# comments: no az verb — REST invoke, preview-only
az devops invoke --area wit --resource comments --org https://dev.azure.com/<org> `
  --route-parameters project=<project> workItemId=<id> --api-version <preview-version> -o json
# active items
az boards query --org https://dev.azure.com/<org> --project <project> -o table --wiql `
  "SELECT [System.Id],[System.WorkItemType],[System.Title],[System.State],[System.IterationPath] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.AssignedTo] = @Me AND [System.State] NOT IN ('Closed','Removed','Done') ORDER BY [System.ChangedDate] DESC"
```

The comments invoke fails → the MCP work-item tool per `references/mcp-fallback.md` (behind a prompt),
and the report says which path produced the discussion. The `api-version` that works: `boards-catalogue.md`.

## Traps

1. `--open` launches a browser → print the URL instead.
2. Attachments downloaded unasked → list names and URLs only.
3. The wrong org's item comes back → the `az devops configure` default answered instead of the
   `ALM:` line → pass `--org` and `-p` from that line on every call.
4. Asked to rewrite the item text → not a read → `user-story-standard`.
