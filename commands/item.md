---
description: Read a work item properly — description, acceptance criteria, state, parent, links, attachments, discussion — or list your active items.
argument-hint: "[id | url] | (empty for your active items)"
---

Put a work item on screen in a form a human can act on. Reading only: the item is not updated, not
transitioned, not commented. CLI mechanics, auth and the MCP fallback come from **`azdo-cli`**.

**Language** — the report is written in **Italian**: its headings (`Descrizione`, `Criteri di
accettazione`, `Contesto`, `Link`, `Discussione`), the notes for what is missing and any question
back to the user. The item's own content is printed as it stands, and so is everything the platform
returns — state, area and iteration paths, field names such as `Acceptance Criteria`, branch and PR
titles: quoted as-is, never translated.

## Argument grammar

- *(empty)* → list the developer's active items.
- **`<number>`** / a work-item **URL** (take the trailing id) → read that item.
- The request is to **create** an item ("new bug for…", "open a task…") → stop and route to
  **`workitem-create`**; this command does not create.
- The request is **what to do about** the item ("how do I implement 1234", "break this down") →
  read it first, then route to **`workitem-analyze`** with the id.

## Steps

1. **Platform** — `git remote get-url origin`. Azure DevOps → below. GitHub → the item is an issue:
   `gh issue view <n> --comments`, and map the sections the same way. No recognised remote → ask
   which org and project, do not guess.

2. **Read the item** — one call, everything attached:
   ```powershell
   az boards work-item show --id <id> --expand all -o json
   ```

3. **Read the discussion** — there is no `az boards` verb for comments. Use the REST invoke:
   ```powershell
   az devops invoke --area wit --resource comments -o json `
     --route-parameters project=<project> workItemId=<id> --api-version <preview-version>
   ```
   The comments resource is preview-only, so the `--api-version` value has to match the
   organization — `azdo-cli` holds the current one. If the invoke fails, fall back to the Azure
   DevOps MCP work-item tool per `azdo-cli`, and say which path produced the discussion.

4. **Shape the fields.** The JSON is a flat `fields` bag; the parts a human needs:

   | On screen | Field / source |
   | --- | --- |
   | Title, type, state, reason | `System.Title`, `System.WorkItemType`, `System.State`, `System.Reason` |
   | Assignee, area, iteration | `System.AssignedTo.displayName`, `System.AreaPath`, `System.IterationPath` |
   | Description | `System.Description` (Bug: also `Microsoft.VSTS.TCM.ReproSteps`) |
   | Acceptance criteria | `Microsoft.VSTS.Common.AcceptanceCriteria` |
   | Effort, priority | `Microsoft.VSTS.Scheduling.*`, `Microsoft.VSTS.Common.Priority` |
   | Parent | `relations` entry with `rel` = `System.LinkTypes.Hierarchy-Reverse` |
   | Children | `rel` = `System.LinkTypes.Hierarchy-Forward` |
   | Attachments | `rel` = `AttachedFile` — name plus `url` |
   | PRs and commits | `rel` = `ArtifactLink` |

   Field values are **HTML**: convert to readable markdown (headings, lists, tables, `<br>` to
   newlines, entities decoded) and shape the JSON with the CLI's own `--query` or with `node`.
   Never print raw HTML at the user.

5. **Empty list, empty answer.** Missing description or empty acceptance criteria is *the* finding —
   print `nessun criterio di accettazione` in place of the section, never drop it silently.

6. **Report**, in this order: one header line (`#<id> · <type> · <state> · <assignee>` and the item
   URL) · `Descrizione` · `Criteri di accettazione` as a checklist · `Contesto` (parent, children,
   area, iteration, effort) · `Link` (PRs, commits, attachments with their names) · `Discussione`,
   oldest first, `author — date` then the comment, HTML converted, only the last five unless the
   user asked for all. Close with **one** Italian line: the obvious next step and the command for
   it (`workitem-analyze`, `/ship`).

## No id — list the active items

```powershell
az boards query --wiql "SELECT [System.Id],[System.WorkItemType],[System.Title],[System.State],[System.IterationPath] FROM WorkItems WHERE [System.AssignedTo] = @Me AND [System.State] NOT IN ('Closed','Removed','Done') ORDER BY [System.ChangedDate] DESC" -o table
```

Print id, type, state, iteration and title, newest change first, then ask which one to open.

## Guardrails

- **Read-only.** No `az boards work-item update`, no `--discussion`, no `--state`, no
  `relation add`/`remove`, no `gh issue comment`/`edit`/`close`. Reading an item never changes it.
- Never invent a missing acceptance criterion, description or estimate to make the item look
  complete: absent is reported as absent.
- Do not download attachments unless asked — list their names and URLs.
- Do not start implementing. Analysis is `workitem-analyze`; creation is `workitem-create`.
- Do not use `--open`: print the URL instead of launching a browser.
