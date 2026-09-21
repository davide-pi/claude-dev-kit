# Boards — the command catalogue

Every verb below was read out of `az boards --help` and its sub-verbs. Where a capability has no
verb, the row says so instead of inventing a flag.

## Querying with WIQL

`az boards query` accepts a WIQL string, a saved query id, or a saved query path. It supports
**flat** queries only — a tree or one-hop query fails, so express the relationship as a flat filter
or query the sides separately.

**`--project` / `-p` does not scope the query reliably.** It has been observed returning work items
belonging to other projects, so the flag alone is not a filter — it is a hint. Every WIQL repeats
the scope in its own `WHERE`, as a literal project name, **in addition to** `-p`:

```powershell
$wiql = @"
SELECT [System.Id], [System.WorkItemType], [System.Title], [System.State], [System.AssignedTo]
FROM WorkItems
WHERE [System.TeamProject] = '<project>'
  AND [System.AssignedTo] = @me
  AND [System.State] NOT IN ('Closed', 'Removed')
ORDER BY [System.ChangedDate] DESC
"@
az boards query --org <org-url> -p <project> --wiql $wiql -o table

az boards query --id <query-guid> -o table                    # a saved query, by id
az boards query --path 'Shared Queries/Current Sprint' -o table
```

Useful WIQL shapes, all flat:

| Need | Predicate |
| --- | --- |
| Children of one parent | `[System.Parent] = <id>` |
| Everything under an area | `[System.AreaPath] UNDER '<project>\<area>'` |
| The current iteration | `[System.IterationPath] = @currentIteration` |
| Changed recently | `[System.ChangedDate] >= @today - 7` |
| One type only | `[System.WorkItemType] = 'Bug'` |
| Free text in the title | `[System.Title] CONTAINS 'invoice'` |

`@me`, `@today` and `@currentIteration` are macros the service resolves — prefer them over
hardcoding an identity or a date. `@project` is the exception: it resolves from the same request
context that already fails to scope, so write the project name out for `[System.TeamProject]`.
There is no `DISTINCT` in WIQL: to learn which values are in use, select the column and dedupe on
the client.

## Reading one work item

```powershell
az boards work-item show --id <id> --expand all -o jsonc

# Only the fields that matter, for a compact read.
az boards work-item show --id <id> `
  --fields System.Id,System.WorkItemType,System.Title,System.State,System.AssignedTo,System.Parent,System.AreaPath,System.IterationPath,System.Tags,System.Description,Microsoft.VSTS.Common.AcceptanceCriteria `
  -o jsonc

# The link graph — parents, children, related items, attachments, PRs.
az boards work-item show --id <id> --expand relations `
  --query "relations[].{rel:rel, url:url, name:attributes.name}" -o table
```

| Flag | Note |
| --- | --- |
| `--expand` | `all`, `fields`, `links`, `relations`, `none`; default `all` |
| `--fields` / `-f` | **comma**-separated field reference names |
| `--as-of` | the item as it was at a date or timestamp — how a field changed over time |
| `--open` | opens it in a browser; never use it in a scripted flow |

`--expand relations` returns the attachment and pull-request links too. Attachment content sits
behind the returned URL; the CLI has no verb to download it.

## Creating and updating

```powershell
az boards work-item create -p <project> --type '<type>' --title '<title>' `
  --description '<html-or-text>' --area '<project>\<area>' --iteration '<project>\<iteration>' `
  --fields 'System.Tags=<tag>' 'Microsoft.VSTS.Common.AcceptanceCriteria=<criteria>'

az boards work-item update --id <id> --state '<state>' --title '<title>' `
  --assigned-to '<upn>' --fields 'Microsoft.VSTS.Scheduling.RemainingWork=<hours>'
```

| Flag | Applies to | Note |
| --- | --- | --- |
| `--type` | create only | required; the type name, not its id |
| `--state` | update only | `create` has no `--state`; create, then update the state |
| `--fields` / `-f` | both | **space**-separated `field=value` pairs, each quoted |
| `--discussion` | both | adds one comment to the discussion — the CLI's only comment write |
| `--assigned-to` | both | a display name or UPN the organization can resolve |
| `--reason` | both | must be a reason valid for the target state |
| `--area`, `--iteration` | both | full classification paths, backslash-separated |

Three rules the CLI will not warn you about:

1. **Set only fields the type has.** One unknown field reference fails the whole call, so
   `Microsoft.VSTS.Common.AcceptanceCriteria` and `Microsoft.VSTS.TCM.ReproSteps` are not safe
   defaults. Discover the type's fields first — `workitem-content.md`, section 1.
2. **A field the form does not show is a silent loss**, not an error: the call succeeds and the item
   looks empty on the board. A Bug is the case that bites, because on a Scrum form it has no
   Description field at all — `workitem-content.md`, section 2.
3. **`--description` is rendered per the field's format.** A description field configured as HTML
   renders HTML and ignores markdown; write the markup the field expects.

`az boards work-item delete --id <id>` moves an item to the recycle bin, `--destroy` erases it
permanently and `-y` skips the prompt. Destroying is irreversible — do not run it unprompted.

## Comments

`--discussion` on `create` or `update` is the only comment verb in the CLI, and it only writes:

```powershell
az boards work-item update --id <id> --discussion '<comment text>'
```

Reading the discussion back has no verb. Stay on the CLI with `invoke`:

```powershell
az devops invoke --area wit --resource comments --route-parameters project=<project> workItemId=<id> `
  --query "comments[].{by:createdBy.displayName, on:createdDate, text:text}" -o jsonc
```

The `wit`/`comments` resource is published under two route templates, so if the route parameter is
rejected, list the areas as described in `auth-and-config.md` and read the template; if the endpoint
rejects the default API version, pin it with `--api-version`. The MCP work-item read, which returns
the comments alongside the item, is the fallback — see `mcp-fallback.md`.

## Parent and child links

```powershell
az boards work-item relation list-type -o table          # the relation names this organization has
az boards work-item relation add --id <child> --relation-type parent --target-id <parent>
az boards work-item relation add --id <parent> --relation-type child --target-id <c1>,<c2>
az boards work-item relation remove --id <id> --relation-type parent --target-id <parent> -y
az boards work-item relation show --id <id> -o jsonc     # relations with friendly names
```

`--target-id` takes a comma-separated list, so a whole set of children goes in one call.
`--target-url` links an item in another organization by URL. `list-type` is organization-level: run
it once rather than assuming `parent`, `child`, `related` and `duplicate` are all that exist.

## Discovering types, states and classification — do not assume a process

There is no `az boards work-item type` verb. Three honest routes, cheapest first:

```powershell
# 1. Which types and states are actually in use — WIQL plus client-side dedupe.
$w = "SELECT [System.Id],[System.WorkItemType],[System.State] FROM WorkItems WHERE [System.TeamProject] = '<project>'"
$items = az boards query --wiql $w -p <project> -o json | ConvertFrom-Json
$items.fields.'System.WorkItemType' | Sort-Object -Unique
$items | Group-Object { $_.fields.'System.WorkItemType' } |
  ForEach-Object { "$($_.Name): $((($_.Group.fields.'System.State') | Sort-Object -Unique) -join ', ')" }

# 2. The authoritative list, through the CLI's REST escape hatch.
az devops invoke --area wit --resource workItemTypes --route-parameters project=<project> `
  --query "value[].{name:name, ref:referenceName}" -o table
az devops invoke --area wit --resource workItemTypeStates `
  --route-parameters project=<project> type='<type>' --query "value[].{state:name, category:category}" -o table

# 3. Which process the project runs on, when the answer needs a name.
az devops project show --project <project> --query capabilities.processTemplate -o jsonc
```

Route 1 is complete only for types and states that some item already uses; an unused type never
surfaces. Route 2 is exhaustive. Say which route the answer came from, so a caller knows how far to
trust it. The field set a create must respect is the one thing neither route returns cleanly — take
the MCP work-item-type read for that.

Classification paths do have verbs, and `--fields`/`--area`/`--iteration` will reject a path that is
not in these lists:

```powershell
az boards area project list -p <project> --depth 3 -o jsonc
az boards iteration project list -p <project> --depth 3 -o jsonc
az boards iteration team list --team '<team>' -p <project> -o table
```

## Attaching a file — no verb, but not a gap

`az boards` has no attachment verb, and it does not need one: the bearer token of the current
`az login` reaches the REST endpoint directly, with no PAT and no MCP tool. Two steps — POST the
bytes to the attachments endpoint, then PATCH an `AttachedFile` relation onto the item. On a Bug the
image belongs **inline in the field** rather than as a relation. Both recipes, with the fixed Azure
DevOps resource id the token is requested for, are in `workitem-content.md`, sections 3 and 4.
