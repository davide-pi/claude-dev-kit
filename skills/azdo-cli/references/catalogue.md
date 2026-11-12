# Boards, type roles and pipelines — the essentials

## Type roles

Other assets speak in roles; Azure DevOps has type names from the process template. The table is a
starting hypothesis per template, never the source of a name.

| Role | Scrum | Agile | Basic | CMMI |
| --- | --- | --- | --- | --- |
| Backlog item | `Product Backlog Item` | `User Story` | `Issue` | `Requirement` |
| Defect | `Bug` | `Bug` | — | `Bug` |
| Analysis | `Impediment` | `Issue` | — | `Issue` |
| Technical activity | often custom (`Tech`) | often custom | — | `Change Request` |
| Time (carries hours) | `Task` | `Task` | `Task` | `Task` |
| Grouping | `Feature`, `Epic` | `Feature`, `Epic` | `Epic` | `Feature`, `Epic` |

- The defect role is always `Bug`, never `Issue`. `Epic` sits above `Feature`; a project may enable one or neither.
- Never carry a custom type across projects. No type for the role → ask; a wrong type misroutes the backlog level.
- `Microsoft.VSTS.Scheduling` fields (remaining, completed, original estimate) go on a `Task` only; `worklog` writes them.
- A PR never links a Task: it hides the change from the item everyone reads and from the completion-time
  transition (`--transition-work-items`, `repos-and-prs.md`).

## Discovering types, states, classification

```powershell
$org = 'https://dev.azure.com/<org>'; $proj = '<project>'
# Authoritative: every type the project has, used or not.
az devops invoke --org $org --area wit --resource workItemTypes --route-parameters project=$proj --query "value[].{name:name, ref:referenceName}" -o table
az devops project show --org $org --project $proj --query capabilities.processTemplate -o jsonc   # which table column to start from
az devops invoke --org $org --area wit --resource workItemTypeStates --route-parameters project=$proj type='<confirmed-type>' --query "value[].{state:name, category:category}" -o table
az boards area project list -p $proj --depth 3 -o jsonc          # --area/--iteration reject a path not listed here
az boards iteration project list -p $proj --depth 3 -o jsonc
az boards iteration team list --team '<team>' -p $proj -o table
```

There is no `az boards work-item type` verb. WIQL plus client-side dedupe shows only types *in use* (an
unused type never surfaces, so empty is no proof); `workItemTypes` decides what *exists*. Say which route
an answer came from. A type's field set is the MCP gap (`mcp-fallback.md`).

## WIQL

`az boards query` takes a WIQL string, `--id <guid>` or `--path 'Shared Queries/<name>'`; flat queries
only (a tree or one-hop query fails: filter flat or query each side). `-p` doesn't scope it: repeat
`[System.TeamProject] = '<project>'`; `@project` fails the same way. `@me`, `@today`, `@currentIteration`
resolve server-side, so prefer them. No `DISTINCT`: select the column, dedupe on the client.

| Need | Predicate |
| --- | --- |
| Children of one parent | `[System.Parent] = <id>` |
| Under an area | `[System.AreaPath] UNDER '<project>\<area>'` |
| Current iteration | `[System.IterationPath] = @currentIteration` |
| Changed recently | `[System.ChangedDate] >= @today - 7` |
| Title text | `[System.Title] CONTAINS 'invoice'` |

## Reading, hierarchy, comments

- `work-item show --id <id>`: `--expand` is `all|fields|links|relations|none`; `--fields` is a **comma** list;
  `--as-of <date>` shows a past state; never `--open` in a script. `--expand relations` lists attachment and
  PR links; no verb downloads attachment content.
- Hierarchy is the `Hierarchy` relation; `az boards work-item relation list-type -o table` gives the names
  this org has. Up: `--query 'fields."System.Parent"' -o tsv`, one call per hop (empty = top, one parent max).
  Down: flat WIQL `[System.Parent] = <id>`, one level per query. A hop is structural: read
  `System.WorkItemType` of every item you reach, a Task can hang off a Feature.
- Links: `relation add --id <child> --relation-type parent --target-id <parent>`; `--target-id` takes a
  comma list (a whole set of children in one call); `relation remove ... -y`; `relation show --id <id>`.
- Comments: `--discussion '<text>'` on create/update is the only write verb. Read back via
  `az devops invoke --area wit --resource comments --route-parameters project=$proj workItemId=<id> --query "comments[].{by:createdBy.displayName, on:createdDate, text:text}" -o jsonc`;
  route rejected → list areas (`auth-and-config.md`); default api-version rejected → `--api-version`.

## Creating and updating

Before any `create`, each gate in its own message:

| Gate | Rule |
| --- | --- |
| table | one row per item: #, role, title, type name as the project returns it, parent, assignee; owner approves before the first write |
| assignee | the owner by default, resolved with the `@Me` probe, UPN shown in the table |
| never | a test or placeholder item; a role with no type is a question, never the nearest type |
| after | read each item back (`--fields System.AssignedTo,System.State,System.Parent`); a mid-batch failure reports the ids already created so a retry doesn't duplicate |

```powershell
az boards work-item create -p $proj --type '<type>' --title '<title>' --description '<html>' `
  --area '<project>\<area>' --iteration '<project>\<iteration>' --fields 'System.Tags=<tag>' 'Microsoft.VSTS.Common.AcceptanceCriteria=<criteria>'
az boards work-item update --id <id> --state '<state>' --assigned-to '<upn>' --fields 'Microsoft.VSTS.Scheduling.RemainingWork=<hours>'
```

- `--type` create only (the name, not an id); `--state` update only (create, then update the state);
  `--fields` space-separated quoted `field=value` on both; `--reason` must be valid for the target state;
  `--area`/`--iteration` are full backslash paths.
- One field the type lacks fails the whole call (`workitem-content.md` §1); a field the form doesn't show is
  a silent loss (§2); `--description` renders per the field's format (HTML field ignores markdown).
- `work-item delete` goes to the recycle bin; `--destroy` is irreversible: never unprompted.
- Attachments have no verb: REST with the login token (`workitem-content.md` §3–4).

## Pipelines

`az pipelines` is the default; `az pipelines build` is the older surface (`build cancel --build-id <run-id>`
is the only cancel, and spells the flag `--build-id`; `build queue` ≈ `run`).

```powershell
az pipelines list --query "[].{id:id, name:name, folder:folderPath}" -o table
az pipelines list --repository <repo> --repository-type tfsgit -o table     # --repository-type is mandatory with --repository
az pipelines show --name '<name>' --query "configuration.path" -o tsv        # the YAML file
az pipelines runs list --pipeline-ids <id> --result failed --top 5 --query-order FinishTimeDesc -o table
az pipelines run --name '<name>' --branch <branch> --variables 'K=v' --parameters 'env=staging'
```

- `--result failed --top N` is the first command on a red CI run. Filters: `--status`, `--reason`
  (`pullRequest`, `individualCI`, `schedule`…), `--branch`, `--requested-for`.
- `--branch` takes a short name, `refs/heads/…`, `refs/tags/…` or `refs/pull/<n>/merge`.
- **Queueing is a write** (it consumes an agent and can deploy): say pipeline, branch and parameters first;
  never queue a release-shaped pipeline to "see what happens".

### A failed run's logs — no verb, use invoke, outside in

```powershell
# the timeline names every failing step and the errors the agent already extracted: read `issues` first
az devops invoke --area build --resource Timeline --route-parameters project=$proj buildId=<run-id> `
  --query "records[?result=='failed'].{name:name, type:type, log:log.id, issues:issues[].message}" -o jsonc
# only then that one step's log
az devops invoke --area build --resource logs --route-parameters project=$proj buildId=<run-id> logId=<log-id> `
  --accept-media-type text/plain --out-file <scratch-path>\step.log
```

Run id = build id. Never pull a whole run's logs (tens of thousands of lines of noise). Route rejected →
confirm it against the area listing (`auth-and-config.md`); the MCP build-log tool only when no route verifies.

Artifacts and variables: `runs artifact list|download --run-id <id>`, `variable list --pipeline-name`,
`variable-group list|show`. A secret group returns `isSecret: true` with no value: correct, never route
around it; read the name and stop.
