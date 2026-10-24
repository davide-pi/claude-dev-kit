---
name: workitem-create
description: >-
  Use when the user types /workitem-create to turn a description, images or a meeting's points
  into Azure DevOps work items.
disable-model-invocation: true
argument-hint: "[description | sessione]"
---

# workitem-create — a description becomes real work items

**Contract.** Items on the board after confirmed tables, assigned to the user and read back · never
creates before Table 2 is approved, never a test or throwaway item · Italian on the board and in chat.

## When

- The user types `/workitem-create`, with or without a description and pasted images.
- One item, a small tree, or children under an existing parent.
- After a client meeting, or with "sessione" / several points under one feature: **session mode**,
  one point at a time into a cart, then a bulk create (`references/session-cart.md`).

Not for: the item's wording and criteria (`user-story-standard` owns them), hours (`worklog`),
reading or planning an existing item (`/item`, `plan-work`).

## Decide

### 1. Non-negotiables

| Rule | Detail |
| --- | --- |
| Nothing hardcoded | project, parent, fields and the type filling each role are discovered every run |
| Assigned to the user | the identity resolved **against the organization** once per org (`azdo-cli` "Resolving the identity to assign to") — never `git config user.email`; shown in Table 2, checked in the read-back; another assignee or none only when the user says so |
| Gated | Table 1, Table 2 and the optional body preview each need an explicit yes; never two gates in one message |
| Content is not ours | role, wording and acceptance criteria follow `user-story-standard` |

### 2. The five gates

| Gate | What happens | Detail |
| --- | --- | --- |
| 1. Intake | read the text **and** every image (`IMAGE 1..n`, captioned); 2–4 lines of what was understood | — |
| 2. Q&A | batched targeted questions; escalate to `grill-me` style rounds when decisions depend on each other | `references/questions.md` |
| 3. Table 1 | the split: `#`, role (provisional), title — reprint until approved | `references/tables.md` |
| 4. Discovery | project, the real type per role, field sets, parent, assignee | §3 |
| 5. Table 2 | Table 1 plus resolved type, parent link and assignee — approve, optional body preview, create | `references/tables.md` |

After Table 1 is approved only discovery facts change the tables; a material doubt belongs in gate 2.

### 3. Discovery — CLI first (`azdo-cli`)

| Needed | Source |
| --- | --- |
| project | the session's `ALM:` line; unmapped → list the org's projects and ask |
| types and their field sets | `invoke --area wit --resource workItemTypes` for that project |
| which type fills a role | `azdo-cli` `references/work-item-roles.md`, matched against the types just listed |
| types actually in use | a WIQL sample, deduped on the type (WIQL has no `DISTINCT`) — call the list "in use", not exhaustive |
| candidate parents | WIQL by area, title keyword or recent activity; propose one, the user confirms or gives an id |
| the assignee | the `@Me` probe, once per organization |

No type fills a role → **ask**, listing the types found; never the nearest-looking one, never a name
from another project.

### 4. Hierarchy

Default: siblings under one existing parent. On request: grouping item → backlog item → time unit
in the types this project resolved, created in one run — only the **root** hangs off an existing
parent. Parents before children, sequentially, each child linked in its create call.

## Do

```powershell
$org = 'https://dev.azure.com/<org>'; $proj = '<project>'     # from the ALM: line
az devops invoke --org $org --area wit --resource workItemTypes --route-parameters project=$proj --query "value[].name" -o tsv
az boards work-item create --org $org -p $proj --type '<type as listed>' --title '<titolo>' `
  --assigned-to '<upn from the @Me probe>' --description '<html>' --fields '<Field>=<value>'
az boards work-item show --org $org --id <id> --fields System.AssignedTo,System.State,System.Parent -o table
```

The shell guard's `alm-contract.js` check asks on a create without `--assigned-to`: a prompt there means the
assignee was dropped. Field safety per type, HTML bodies, creation order, mid-batch failure
reporting and the read-back: `references/item-content.md`. Report with the final table and the
manual-attachment checklist (`references/tables.md`).

## Traps

1. The whole create fails on one field → that field does not exist on the type (criteria and repro
   steps are not universal) → read the field set first; fold unsupported content into the body.
2. The body renders as raw markup → it was written as markdown → write description and criteria as HTML.
3. Children land with no parent → the link was left for a second pass → link in the create call,
   then read the item back.
4. A retry duplicates items → a mid-batch failure reported no ids → always report the ids already
   created before stopping.
5. Images vanish → they were never attached → REST upload with the `az login` token (`azdo-cli`);
   what fails stays a numbered placeholder in the attachment checklist.
6. The item starts in another state than New → the process defines its own initial state → set the
   state explicitly after the create when it differs.

## References

- `references/questions.md` — gate 2: what the Q&A covers, batching, when to escalate, what to read
  off the images instead of asking.
- `references/tables.md` — gates 3 and 5: Table 1, Table 2, the final summary, the attachment
  checklist, link and hierarchy formats.
- `references/item-content.md` — the create calls: fields and HTML, order and linking, safeguards,
  read-back.
- `references/session-cart.md` — session mode: focus and feature, one point at a time, assignee
  inference, the recap and the bulk create.
