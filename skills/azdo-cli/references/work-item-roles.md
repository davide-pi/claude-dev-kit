# Work item types by role — discover the name, never assume it

Other assets speak in **roles** (backlog item, defect, analysis, technical activity, time, grouping); Azure DevOps
has type **names** from the process template. This file maps one to the other; the mapping is
**always confirmed at runtime**.

Read it whenever a command, a WIQL predicate or a confirmation table has to name a type, and before
walking from a Task up to the item that owns it.

## 1. The query comes first, the table second

**A type name is written into a command only after the project's own type list has returned it,
spelled identically.** Section 2 is a hypothesis about which name fills which role — it is never
the source of the name.

```powershell
$org = 'https://dev.azure.com/<org>'; $proj = '<project>'

# Authoritative: every type the project has, used or not. This is the query that decides.
az devops invoke --org $org --area wit --resource workItemTypes --route-parameters project=$proj `
  --query "value[].{name:name, ref:referenceName}" -o table

# Which template it runs on — which row of section 2 to start from, not the answer itself.
az devops project show --org $org --project $proj --query capabilities.processTemplate -o jsonc

# The states of one confirmed type, for the transitions an asset will drive.
az devops invoke --org $org --area wit --resource workItemTypeStates `
  --route-parameters project=$proj type='<confirmed-type-name>' `
  --query "value[].{state:name, category:category}" -o table
```

The WIQL-and-dedupe route in `boards-catalogue.md` is the cheap alternative and it is **incomplete
by construction**: a type nobody has used yet never surfaces, so an empty result is not evidence
that a type is missing. Use it to see what is *in use*; use `workItemTypes` to decide what
*exists*. Say which route an answer came from, so the caller knows how far to trust it. The field
set a create must respect is the one thing neither route returns cleanly — that is the MCP
work-item-type read (`mcp-fallback.md`).

## 2. The role table — a starting hypothesis, per template

| Role | Scrum | Agile | Basic | CMMI |
| --- | --- | --- | --- | --- |
| **Backlog item** — a new capability or change | `Product Backlog Item` | `User Story` | `Issue` | `Requirement` |
| **Defect** — something that misbehaves | `Bug` | `Bug` | — | `Bug` |
| **Analysis** — a question to analyse before a fix can be defined | `Impediment` | `Issue` | — | `Issue` |
| **Technical activity** — invisible to the end user | often a custom type such as `Tech` | often a custom type | — | `Change Request` |
| **Time** — carries hours, never linked to a PR | `Task` | `Task` | `Task` | `Task` |
| **Grouping** — above the backlog item | `Feature`, `Epic` | `Feature`, `Epic` | `Epic` | `Feature`, `Epic` |

Awkward cells:

- **The defect role is always `Bug`**, never `Issue`; Basic has no defect, analysis or technical-activity type.
- **The technical-activity role is usually a custom type**; `Tech` is the name this kit's conventions expect, but
  the spelling is not guaranteed and it is the role most likely to be absent.
- **`Feature` and `Epic` are two levels, not synonyms**: `Epic` sits above `Feature`; a project may enable only one,
  or turn the portfolio backlog off.

## 3. `Issue`

Analysis on Agile, backlog item on Basic (`SKILL.md` §4). `workItemTypes` on a Basic project returns exactly
`Epic`, `Issue`, `Task`, which no Agile project does.

## 4. Custom types, and a role with no type

- Never carry a custom type across projects, nor assume one organization customised two projects the same way.
- No type for the role → ask (`SKILL.md` §4); a wrong type misroutes the item's backlog level and is tedious to
  correct. A role can also be filled by a type this table never predicted: the query is the authority.

## 5. Two facts about the model other assets depend on

- The `Microsoft.VSTS.Scheduling` fields (remaining work, completed work, original estimate) are written on a
  `Task`, never on the item above it. `worklog` writes them.
- A PR never links a Task: linking it hides the change from the item everyone reads, and from any
  completion-time state transition that follows the link (`--transition-work-items` in `repos-and-prs.md`).

## 6. Walking the hierarchy between roles

Parent and child are the `Hierarchy` relation, and `az boards work-item relation list-type` is what
proves the relation names this organization actually has — run it once instead of assuming.
Upwards, `System.Parent` is the cheapest read: one call per hop.

```powershell
# One hop up: the item a Task belongs to (backlog item, defect or analysis item).
$parent = az boards work-item show --org $org --id <task-id> --query 'fields."System.Parent"' -o tsv

# Second hop: that item up to its Feature, and a Feature up to its Epic — the same field.
az boards work-item show --org $org --id $parent `
  --query '{type:fields."System.WorkItemType", title:fields."System.Title", up:fields."System.Parent"}' -o jsonc

# The whole link graph of one item, when both directions matter at once.
az boards work-item show --org $org --id <id> --expand relations `
  --query "relations[].{rel:rel, url:url, name:attributes.name}" -o table

# Downwards: the Tasks under an item, or the backlog items under a Feature. Flat WIQL, one level.
$w = "SELECT [System.Id],[System.WorkItemType],[System.Title] FROM WorkItems WHERE [System.TeamProject] = '$proj' AND [System.Parent] = <id>"
az boards query --org $org -p $proj --wiql $w -o table
```

Three notes:

1. **Read the type of every item you walk to.** A hop is structural, not semantic: nothing stops a
   Task from hanging directly off a Feature, so confirm the role from `System.WorkItemType` rather
   than from the number of hops you walked.
2. `System.Parent` is empty at the top of the tree, and an item has at most one parent — a missing
   value means the item is unparented, not that the read failed.
3. WIQL is **flat only** (`boards-catalogue.md`), so a two-level walk is two queries, and
   `[System.Parent] = <id>` is the predicate for each level.
