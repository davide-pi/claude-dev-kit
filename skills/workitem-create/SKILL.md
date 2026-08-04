---
name: workitem-create
description: Create one or more Azure DevOps work items from a user-provided description and images. Asks questions (targeted Q&A escalating to grilling) to produce items that are complete and clear for both humans and AIs, then shows Table 1 (type/title), discovers MCP+project+types+parent, shows Table 2 with parent link, and on confirmation creates the items (English, New and unassigned) returning a summary with links. Explicit trigger: only when the user types /workitem-create.
---

# /workitem-create — Create Azure DevOps work items from a description + images

From a user description (and images), draft **one or more work items**, validate them through two tables with confirmation loops, and on confirmation **create them on Azure DevOps**.

**Everything is in English**: this skill and all its output — chat, tables, questions, and the work items themselves.
Items must be clear and well structured for both a **human** and an **AI** that will implement them.
No org/project/MCP/type name is hardcoded: all are discovered **at runtime**.

---

## Concepts

- **English everywhere.** All chat, tables, questions, and every item title/description/criteria written to Azure are in English.
- **Runtime discovery.** MCP servers, projects, and types are never assumed: read them from the tools actually connected and from the chosen project.
- **Images = context + placeholder only.** The MCP **cannot** upload attachments. Images are for you, to understand and write the item; in the body you leave a **numbered placeholder** where each image belongs, and at the end you produce a **"attach manually" checklist**. The user attaches them from the UI.
- **Flexible hierarchy.** Default: sibling items under an existing parent. On request: **multi-level hierarchies** (e.g. Feature → Story → Task) created in the same run, with the root linked to an existing parent.
- **State and assignment.** Items are created in state **New** and **unassigned**, unless the user explicitly says otherwise.
- **Multi-gate confirmation.** Table 1, Table 2, and (if requested) the content preview are gates: proceed only on explicit confirmation.
- **No throwaway items.** Never create "test" items on the real board. The skill is validated by reading this file; at runtime the first-create caution (Phase 7) applies.

---

## PHASE 1 — Process the request (intake)

Input: `/workitem-create` + a free-form description (optional) + images pasted into chat.

1. Read the text **and** the images carefully.
2. Assign each image a **numbered ID** (`IMAGE 1`, `IMAGE 2`, …) and a **caption** of what it shows. You will use these IDs as placeholders in the items and in the final checklist.
3. Summarize in 2-4 lines what you understood: objective, context, expected output, and which preliminary items you foresee. **This is not Table 1 yet.**
4. Note what the user already specified (number of items, types, project, parent): it will be validated later.

---

## PHASE 2 — Questions (hybrid: targeted Q&A → grilling)

Goal: gather everything needed for complete items, with no remaining doubts.

- **Default — targeted Q&A (batched).** Group the questions: use `AskUserQuestion` for discrete choices (type if uncertain, how many items, hierarchy yes/no, priority, state/assignment if different from defaults); open questions in chat for details. Aim for few iterations.
- **Escalation — grilling.** If the work is complex or ambiguous, or the user asks for it, switch to the **`grill-me`** style on the open points: one question at a time, walk every branch of the decision tree, resolve dependencies between decisions. You may invoke the `grill-me` skill or apply its method.
- **If an answer is derivable** from the images or context, **derive it** instead of asking.

Cover at least: value/objective, **precise scope of each item**, acceptance criteria, technical constraints and implementation hints, dependencies between items, what is **out of scope**, references (related items/PRs/docs), and **where each image belongs**.

Do not move to the draft until every material doubt is resolved.

---

## PHASE 3 — Draft items + Table 1 + confirmation loop

1. Define the split into **1+ items**. For each: type (provisional, validated in Phase 4) and a concise, specific **title**.
2. If it is a multi-level hierarchy, represent the nesting.
3. Print **Table 1 only**:

```markdown
| # | Type       | Title |
|---|------------|-------|
| 1 | Feature    | Multi-tenant billing dashboard |
| 2 | User Story | ↳ Show per-tenant invoice list |
| 3 | Task       | ↳↳ Add invoices API endpoint |
```

- `#` numbers the rows (the user can say "change item 2").
- For hierarchies, indent child titles with `↳` (one `↳` per level).

4. Ask: **"Do you want to change anything (number of items, types, titles, split, hierarchy)?"**
   - If changed → apply, reprint Table 1, ask again. Repeat until approved.
   - Only after explicit approval → Phase 4.

---

## PHASE 4 — Azure DevOps discovery (MCP, project, types, parent)

### MCP
Use the Azure DevOps MCP servers **connected in this session** (tools `mcp__<name>__wit_*`, `..._core_*`, `..._search_*`). Do not assume names: look at what actually exists.
- Multiple MCPs pointing to the **same org** are equivalent → use the first.
- MCPs on **different orgs** with an undeducible choice → **ask which to use**.
- **The tool names below are examples, not a contract.** This MCP consolidates its surface from time
  to time — `wit_get_work_item` became `wit_work_item`, `wit_create_work_item`/`wit_update_work_item`
  became `wit_work_item_write`, `wit_my_work_items`/`wit_query_by_wiql` became `wit_query`. So match
  by **capability** (read an item, write an item, link items, list backlogs, search) against the tools
  the server really exposes, and if a name below is missing, use the one with the same capability and
  say in chat which you used. Never invent a name, and never abandon a step because its example name
  is gone.

### Project
If not already known from context/user, list projects (`core_list_projects`) and **ask which one to create in**. Normally a run targets a single project.

### Types (honest discovery)
- `wit_backlog` → backlog levels (Epic/Feature/Story…).
- WIQL → types **actually in use** (WIQL has no `DISTINCT`: sample work items and dedupe the `System.WorkItemType` values).
- For **each chosen type**, `wit_work_item` to **validate it** and **read its real field set** (needed in Phase 7).
- Present the list as "types available/in use" — it may not be exhaustive (process types never used won't surface via WIQL). The complete source would be the REST `_apis/wit/workitemtypes`, which requires an auth token: only offer it if the user wants the exhaustive list.
- **Type rule:** if a requested type **is not present**, or **was not specified**, **ask the user** and list the ones found.

### Parent
For each **root** item that must sit under an existing parent:
- Search candidates (`search_workitem`, `wit_query`, `wit_query` by keyword/area) and **propose** the most relevant.
- The user confirms/corrects, provides an **id or URL**, or says "no parent".
- In a multi-level hierarchy only the **root** has an existing parent; new children hang off items created in this same run.

---

## PHASE 5 — Table 2 (with parent link) + confirmation loop

```markdown
| # | Type       | Title | Parent |
|---|------------|-------|--------|
| 1 | Feature    | Multi-tenant billing dashboard | [Epic #4210](https://<org>.visualstudio.com/<project>/_workitems/edit/4210) |
| 2 | User Story | ↳ Show per-tenant invoice list | → #1 (new, created in this run) |
| 3 | Task       | ↳↳ Add invoices API endpoint   | → #2 (new, created in this run) |
```

- `Type`: the one **validated** in Phase 4.
- `Parent`:
  - **existing** parent → **clickable link** `[Type #id](url)`;
  - child of a **new** item → `→ #<row> (new, created in this run)`;
  - no parent → `—`.
  - Build the URL from the item's `_links.html.href`, or from the pattern `https://<org>.visualstudio.com/<project>/_workitems/edit/<id>` (org/project discovered at runtime, never hardcoded). **Always a link, never just the number.**
- Below the table, state the chosen **MCP and project**.

Then **ask** for changes (different parent, MCP/project, type, hierarchy, titles).
- If changed → redo the needed part of Phase 4, reprint Table 2, ask again. Repeat until confirmed.
- Only on explicit confirmation → Phase 6.

---

## PHASE 6 — Detailed content preview (optional)

Ask (or honor what the user already said): **"Do you want to review the full content of each item before I create them, or should I create them directly?"**
- **Yes** → show, for each item, the **full body** (template below), including the numbered image placeholders. Apply corrections, reprint, then confirm.
- **No** → proceed to Phase 7.

---

## PHASE 7 — Create on Azure DevOps

Create the items with a structured body (template below), using **Html** format for `Description` and `Acceptance Criteria` (ADO markdown rendering is inconsistent).

### Fields: only those supported by the type
Before creating, you read each type's real field set (`wit_work_item`, Phase 4). **Set only fields that exist on that type**: setting a non-existent field **fails the whole create** (e.g. `Microsoft.VSTS.Common.AcceptanceCriteria` and `Microsoft.VSTS.TCM.ReproSteps` don't exist on every type/process). If a field is missing, fold that content **into the Description**.

### State and assignment
- **State** `New` unless told otherwise. If the type starts in a different state or the user asks for another, set it explicitly.
- **Assignee**: none, unless explicitly requested. If "to me", resolve identity at runtime (MCP identity tool or `git config user.email`).

### Order and parent (sequential, parent before children)
- Item **with a parent** (existing or created earlier in this run) → `wit_work_item_write(parentId, workItemType, items:[{title, description (Html)}])` (links atomically), then `wit_work_item_write` for the extra supported fields (Acceptance Criteria, Tags, State/Assignee if different from defaults).
- **Root** item **with no parent** → `wit_work_item_write(workItemType, fields:[...])` with all supported fields in one call.
- **Root** item **under an existing parent** → prefer the atomic `wit_work_item_write(parentId=<existing>, …)`; alternatively `wit_work_item_write` + `wit_work_item_link_write(updates:[{id:<new>, linkToId:<parent>, type:"parent"}])`.
- **Parallelism**: **sequential by default**. Only if the batch is large and there are **independent subtrees** may you parallelize them (≤4 agents), keeping parent-before-children within each subtree.

### Safeguards
- **First create in session**: on the very first item on an Azure org never touched in this session, create **one** item, show it, then proceed with the rest.
- **Mid-batch failure**: report the **ids already created** so a retry does not duplicate.
- **Verify**: re-read the created items (`wit_work_item` / `wit_work_item`) and confirm type, parent, state, and fields before the summary.

---

## PHASE 8 — Final summary

Print the **final table**:

```markdown
| # | Type       | Title (link) |
|---|------------|--------------|
| 1 | Feature    | [Multi-tenant billing dashboard](https://<org>.visualstudio.com/<project>/_workitems/edit/4711) |
| 2 | User Story | ↳ [Show per-tenant invoice list](https://<org>.visualstudio.com/<project>/_workitems/edit/4712) |
```

- Title = **clickable link** to the created item. Indent children (`↳`) to show the hierarchy.

Then the **images-to-attach-manually checklist** (one row per item that contains placeholders):

```
Images to attach manually:
- [Item #4712](url): IMAGE 1 (login error screenshot), IMAGE 2 (expected layout)
```

---

## Item body template (English, Html)

Adapt the sections to the type (Task leaner; Bug uses Repro/Expected/Actual). Base:

- **Context / Background** — why, current situation.
- **Objective** — expected outcome.
- **Scope / What to do** — scope and concrete steps.
- **Acceptance Criteria** — verifiable checklist (dedicated field if the type supports it, otherwise inside Description).
- **Technical notes / Implementation hints** — guidance for the dev/AI: files, APIs, constraints, edge cases.
- **Out of scope** — what NOT to do.
- **References** — related items/PRs/docs (links).
- **Images** — numbered placeholders, e.g. `> 📎 IMAGE 1 — <caption> (attach manually)`.

For a **Bug** add/use: **Repro steps**, **Expected result**, **Actual result** (in addition to Context/References/Images).

---

## Style
- Everything in English: chat, tables, questions, and item titles/descriptions/criteria.
- Links always clickable, never just the number (parent and created items).
- Never invent types, fields, or tools: use those actually exposed/existing on the project and connected MCP.
- Every gate (Table 1, Table 2, preview) requires explicit confirmation before proceeding.
- Number the images and list them in the final checklist: the user attaches them manually.
