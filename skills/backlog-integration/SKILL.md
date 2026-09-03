---
name: backlog-integration
description: >-
  Guided session that turns the outcome of a client meeting into real work items on an
  already-started Azure DevOps board: pick or create the top grouping item and the feature item that
  become the session focus, then work one point at a time — proposing title, content, assignee and
  attachments per point — collect the drafts in a cart, recap it, and create everything in bulk
  reporting the real id of each item. Covers the grouping / feature / backlog item / unit-of-time
  hierarchy, the backlog item, defect, technical activity and analysis roles at the same level,
  assignee inference from the items already under the focus feature, and image attachments. Every
  role is resolved to the project's real work item type through azdo-cli — no type name is
  hardcoded. Organization and project are resolved from the working directory and passed explicitly,
  never taken from the CLI default. Explicit trigger: only when the user types /backlog-integration.
disable-model-invocation: true
---

# backlog-integration — a client meeting becomes items on a live board

**Language.** This skill's own prose is English. Everything the user reads during the session is
**Italian**: the opening question of each point, the cart recap and the creation report including
their column headers, and every confirmation request. The item content is Italian too, as
`user-story-standard` prescribes. Instructional and machine text stays English: the per-step
**Done when** gates, the role names, whatever type names the project resolves them to, the state
names, WIQL and field reference names.

## When

- The user types `/backlog-integration`. Nothing else loads this skill.
- What came out of a client meeting has to land on a board that already exists, point by point.
- Several points belong under one grouping and one feature item and are better drafted, reviewed,
  then created together rather than one at a time on the board.
- A point is still shapeless and its **role** — backlog item, defect, technical activity, analysis —
  has to be decided out loud with the user.

Not for: building a backlog from scratch (the top grouping item is assumed to exist, or is created
explicitly in this session); one item from an already written description (`workitem-create`);
logging hours, which only `worklog` writes; reading or attacking an item already on the board
(`workitem-analyze`); Azure DevOps CLI syntax, auth, verbs and the role-to-type mapping
(`azdo-cli`). Never fires without the explicit trigger.

## Decide

### 1. Hierarchy — expressed in roles, never in type names

Top grouping, the client's engagement → **feature** → **backlog item** (the backlog item, defect,
technical activity and analysis roles, all at the same level) → **unit of time**. A backlog item is
**never** a direct child of the top grouping: a feature always sits in between. Which type fills
each role is process-dependent and case-sensitive, so resolve every one of them through `azdo-cli`
before creating anything — and where the project has no type for a role, **ask** rather than
substitute the nearest-looking one.

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
| 1 | Which grouping item? Resolve the top grouping type first, then list the project's non-Done items of that type with id and title; always offer "create a new one" — title only, no other field. | a top-grouping id, existing or just created |
| 2 | Which feature? List that item's non-Done children of the feature type with id, title and state; always offer "create a new one" (title only). On a small project a generic container feature is fine — do not force a structure the client does not have. | a feature id, child of the step-1 grouping item. That pair is the session **focus** |
| 3 | Dig into one point — repeated once per point, in the order the user raises them (`point-intake.md`). | the point is in the cart with role, title, content, assignee and the image decision all **confirmed** by the user, not merely proposed |
| 4 | Recap the whole cart and refine it (`cart-and-creation.md`). | every entry has an unambiguous assignee and parent feature, and the user has confirmed the cart as a whole |
| 5 | Create in bulk (`cart-and-creation.md`). | every entry has a real id under the right parent, and attachments are either done or their failures reported |
| 6 | Continue on the same grouping item, or close — hours are not part of it, see rule 5 (`cart-and-creation.md`). | the session is closed, or step 2 has restarted with an **empty** cart |

**One point at a time.** Never ask for a full account of the meeting in one block: one point at a
time is how the user thinks. After each point ask whether there are others, and keep going until the
user says there are none.

### 4. Content and mechanics come from elsewhere

| Concern | Owner |
| --- | --- |
| Title, description and acceptance criteria for any of the four backlog-level roles | `user-story-standard` — the format lives there and is not restated here, for any of the four |
| The role-to-type mapping, and which type a project really has for each role | `azdo-cli` — the single owner; never map a role to a name by guesswork |
| WIQL, work item create and update, parent links, the defect field mapping, attachment upload | `azdo-cli` |
| Auth failures, "not found", MCP fallback decisions | `azdo-cli` |

### 5. Hours are not written here

Closing a session writes no hours. Management time for this engagement goes through **`/worklog`**,
the only asset in the kit that writes hours — two writers, and every session gets logged twice.

## Do

```powershell
Get-Location   # step 0: the path decides organization and project through the user's mapping

# Steps 1-2, the session's reads. $topType and $featType are the types resolved for the top
# grouping and feature roles (azdo-cli) — never literals carried over from another project.
# Name the project INSIDE the WIQL as well as on the command: --project alone does not reliably
# scope `az boards query`. Flags and output shapes: azdo-cli.
$org = 'https://dev.azure.com/<org>'; $prj = '<project>'
az boards query --org $org --project $prj -o table --wiql @"
SELECT [System.Id],[System.Title],[System.State] FROM WorkItems
WHERE [System.TeamProject]='$prj' AND [System.WorkItemType]='$topType'
  AND [System.State] <> 'Done' ORDER BY [System.Id]
"@

# Same shape for its feature children: [System.WorkItemType]='$featType'
# AND [System.Parent] = <groupingId> AND [System.State] <> 'Done'
```

Step 3's assignee-inference query is in `point-intake.md`. Every write of step 5 — create, parent
link, assignee, attachment upload — runs through the verbs documented in `azdo-cli`.

## Traps

1. Items land on the previous client's board → the configured default project was used → resolve it
   from the working directory and pass `--org` and `--project` on every single call.
2. A query returns items from another project → `--project` alone does not scope `az boards query`
   → also put `[System.TeamProject]='<project>'` inside the WIQL.
3. A defect looks empty on the board → it was written into `Description`, which that type may not
   have → use the type's own fields (`azdo-cli`), and only those the user actually answered.
4. A backlog item hangs straight off the top grouping → the feature step was skipped or the focus
   was lost → every item created here is a child of the focus feature.
5. A role is created as a type name remembered from the last client → the mapping was assumed → the
   type is resolved per project every session, and a role with no type is a question.
6. The whole cart stops halfway → one attachment upload failed and was treated as fatal → report
   which image failed and carry on with the rest of the cart.
7. The user is asked to recount the entire meeting → the points were requested in one block → one
   point at a time, in the order they are raised.
8. Item bodies drift into a format invented on the spot → the standard was never loaded → route to
   `user-story-standard` for all four roles, every time.
9. The second round creates duplicates → the cart was not emptied when step 6 looped → step 3
   restarts with an empty cart.
10. This session creates the management feature or backlog item → the closing step felt like the
    place for hours → it is not: `/worklog` owns that structure and writes it alone.

## References

- `point-intake.md` — step 3 in full: the opening question, content per role, assignee inference and
  its query, the images question, and what a cart entry must hold before the gate passes.
- `cart-and-creation.md` — steps 4 to 6: the recap table, the two fields that may not stay
  ambiguous, the per-item creation order, failure isolation, the id report and the loop.
