---
name: backlog-integration
description: >-
  Guided session that turns the outcome of a client meeting into real work items on an
  already-started Azure DevOps board: pick or create the Epic and the Feature that become the
  session focus, then work one point at a time — proposing title, content, assignee and attachments
  per point — collect the drafts in a cart, recap it, and create everything in bulk reporting the
  real id of each item. Covers the Epic → Feature → backlog item → Task hierarchy, the Product
  Backlog Item, Bug, Tech and Impediment types at the same level, assignee inference from the items
  already under the focus Feature, and image attachments. Organization and project are resolved from
  the working directory and passed explicitly, never taken from the CLI default. Explicit trigger:
  only when the user types /backlog-integration.
disable-model-invocation: true
---

# backlog-integration — a client meeting becomes items on a live board

**Language.** This skill's own prose is English. Everything the user reads during the session is
**Italian**: the opening question of each point, the cart recap and the creation report including
their column headers, and every confirmation request. The item content is Italian too, as
`user-story-standard` prescribes. Instructional and machine text stays English: the per-step
**Done when** gates, the work item type names (`Epic`, `Feature`, `Product Backlog Item`, `Bug`,
`Tech`, `Impediment`, `Task`), the state names, WIQL and field reference names.

## When

- The user types `/backlog-integration`. Nothing else loads this skill.
- What came out of a client meeting has to land on a board that already exists, point by point.
- Several points belong under one Epic and Feature and are better drafted, reviewed, then created
  together rather than one at a time on the board.
- A point is still shapeless and its type — Product Backlog Item, Bug, Tech, Impediment — has to be
  decided out loud with the user.

Not for: building a backlog from scratch (the Epic is assumed to exist, or is created explicitly in
this session); one item from an already written description (`workitem-create`); logging hours,
which only `worklog` writes; reading or attacking an item already on the board (`workitem-analyze`);
Azure DevOps CLI syntax, auth and verbs (`azdo-cli`). Never fires without the explicit trigger.

## Decide

### 1. Hierarchy

Epic (the client's engagement) → Feature → **backlog item** (`Product Backlog Item`, `Bug`, `Tech`,
`Impediment` — all at the same level) → Task. A backlog item is **never** a direct child of an Epic:
a Feature always sits in between. Type names are process-dependent and case-sensitive — confirm the
ones the project really has through `azdo-cli` before creating anything.

### 2. Organization and project

| Question | Answer |
| --- | --- |
| Which organization and project | resolved from the **current working directory** through the workspace-to-platform mapping in the user instructions |
| The path is not mapped | **ask** — never guess a client |
| How they travel | passed **explicitly** on every command, read or write, for the whole session |
| The `az devops configure` default | **never trusted**: it may still point at a previous session's client |

### 3. The session, step by step

Every step ends on a verifiable condition. Do not enter the next one until it holds.

| # | Step | Done when |
| --- | --- | --- |
| 0 | Which project are we on today? Ask explicitly if the message does not say, and resolve it before querying the board. | a project name confirmed by the user |
| 1 | Which Epic? List the project's non-Done Epics with id and title; always offer "create a new Epic" — title only, no other field. | an Epic id, existing or just created |
| 2 | Which Feature? List that Epic's non-Done Feature children with id, title and state; always offer "create a new Feature" (title only). On a small project a generic container Feature is fine — do not force a structure the client does not have. | a Feature id, child of the step-1 Epic. That Epic+Feature pair is the session **focus** |
| 3 | Dig into one point — repeated once per point, in the order the user raises them (`point-intake.md`). | the point is in the cart with type, title, content, assignee and the image decision all **confirmed** by the user, not merely proposed |
| 4 | Recap the whole cart and refine it (`cart-and-creation.md`). | every entry has an unambiguous assignee and parent Feature, and the user has confirmed the cart as a whole |
| 5 | Create in bulk (`cart-and-creation.md`). | every entry has a real id under the right parent, and attachments are either done or their failures reported |
| 6 | Continue on the same Epic, or close — hours are not part of it, see rule 5 (`cart-and-creation.md`). | the session is closed, or step 2 has restarted with an **empty** cart |

**One point at a time.** Never ask for a full account of the meeting in one block: one point at a
time is how the user thinks. After each point ask whether there are others, and keep going until the
user says there are none.

### 4. Content and mechanics come from elsewhere

| Concern | Owner |
| --- | --- |
| Title, description and acceptance criteria for a Product Backlog Item, a Bug, a Tech or an Impediment | `user-story-standard` — the format lives there and is not restated here, for any of the four types |
| WIQL, work item create and update, parent links, the Bug field mapping, attachment upload | `azdo-cli` |
| Auth failures, "not found", MCP fallback decisions | `azdo-cli` |

### 5. Hours are not written here

Closing a session writes no hours. Management time for this engagement goes through **`/worklog`**,
the only asset in the kit that writes hours — two writers, and every session gets logged twice.

## Do

```powershell
Get-Location   # step 0: the path decides organization and project through the user's mapping

# Steps 1-2, the session's reads. Name the project INSIDE the WIQL as well as on the command:
# --project alone does not reliably scope `az boards query`. Flags and output shapes: azdo-cli.
$org = 'https://dev.azure.com/<org>'; $prj = '<project>'
az boards query --org $org --project $prj -o table --wiql @"
SELECT [System.Id],[System.Title],[System.State] FROM WorkItems
WHERE [System.TeamProject]='$prj' AND [System.WorkItemType]='Epic'
  AND [System.State] <> 'Done' ORDER BY [System.Id]
"@

# Same shape for the Epic's Features: [System.WorkItemType]='Feature'
# AND [System.Parent] = <epicId> AND [System.State] <> 'Done'

# Step 3, assignee inference: everything already hanging off the focus Feature.
az boards query --org $org --project $prj -o table --wiql @"
SELECT [System.Id],[System.WorkItemType],[System.AssignedTo] FROM WorkItems
WHERE [System.TeamProject]='$prj' AND [System.Parent] = <featureId>
"@
```

Count the identities returned and propose the most frequent one; an empty result means asking the
user. Every write of step 5 — create, parent link, assignee, attachment upload — runs through the
verbs documented in `azdo-cli`.

## Traps

1. Items land on the previous client's board → the configured default project was used → resolve it
   from the working directory and pass `--org` and `--project` on every single call.
2. A query returns items from another project → `--project` alone does not scope `az boards query`
   → also put `[System.TeamProject]='<project>'` inside the WIQL.
3. A Bug looks empty on the board → it was written into `Description`, which a Bug does not have on
   its form → use the type's own fields (`azdo-cli`), and only those the user actually answered.
4. A backlog item hangs straight off the Epic → the Feature step was skipped or the focus was lost →
   every item created here is a child of the focus Feature.
5. The whole cart stops halfway → one attachment upload failed and was treated as fatal → report
   which image failed and carry on with the rest of the cart.
6. The user is asked to recount the entire meeting → the points were requested in one block → one
   point at a time, in the order they are raised.
7. Item bodies drift into a format invented on the spot → the standard was never loaded → route to
   `user-story-standard` for all four types, every time.
8. The second round creates duplicates → the cart was not emptied when step 6 looped → step 3
   restarts with an empty cart.
9. This session creates the management Feature or PBI → the closing step felt like the place for
   hours → it is not: `/worklog` owns that structure and writes it alone.

## References

- `point-intake.md` — step 3 in full: the opening question, content per type, assignee inference,
  the images question, and what a cart entry must hold before the gate passes.
- `cart-and-creation.md` — steps 4 to 6: the recap table, the two fields that may not stay
  ambiguous, the per-item creation order, failure isolation, the id report and the loop.
