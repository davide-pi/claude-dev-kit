---
name: workitem-create
description: >-
  Create Azure DevOps work items — one, a small tree, or a session cart from a client meeting —
  through Q&A and confirmation tables. Explicit trigger: only when the user types /workitem-create.
disable-model-invocation: true
---

# workitem-create — a description becomes real work items

## When

- The user types `/workitem-create`, with or without a description and pasted images.
- A piece of work has to become one item, or a small hierarchy of items, on a board.
- An existing parent — a grouping item, or a backlog item that needs units of time — takes children.
- `/workitem-create` after a client meeting, or with "sessione" / several points to draft under one
  feature: the **session mode** — one point at a time into a cart, recap, bulk create
  (`references/session-cart.md`).

Not for: logging hours on an existing item (`worklog`), reading or analysing an item already on the
board (`/item`, `plan-work`), testing an implemented item (`items-qa`), or Azure DevOps CLI configuration, auth, verbs and
the role-to-type mapping (`azdo-cli`). Never fires without the explicit trigger.

## Decide

### 1. Non-negotiables

| Rule | Detail |
| --- | --- |
| Italian | every title, description and criterion written to the board, and every question, table and confirmation the user reads |
| Nothing hardcoded | project, parent, fields and the type filling each role are **discovered at runtime**, every run |
| New, assigned to the user | the default for every item created here; another assignee, or none at all, only where the user said so. The identity is resolved **against the organization** at gate 4 (`azdo-cli`) and shown in Table 2 |
| Gated | Table 1, Table 2 and the optional content preview each need explicit confirmation |
| Never a throwaway | no "test" item on a real board, ever |
| Content is not ours | role classification, wording and acceptance criteria come from `user-story-standard`; this skill owns the mechanism |

### 2. The five gates, in order

| Gate | What happens | Detail |
| --- | --- | --- |
| 1. Intake | read the text **and** the images; number them `IMAGE 1..n` with a caption; summarise in 2-4 lines what was understood | — |
| 2. Q&A | targeted batched questions, escalating to grilling when the work is ambiguous | `questions.md` |
| 3. Table 1 | the split into items: `#`, role (provisional), title — confirm, edit, reprint until approved | `tables.md` |
| 4. Discovery | project, which real type fills each role, their field sets, the parent | below |
| 5. Table 2 | the same rows plus the resolved parent link and the assignee — confirm, then optionally preview the full bodies, then create | `tables.md`, `user-story-standard` |

Never merge two gates into one message, and never move past one without explicit approval.

### 3. Discovery — CLI first

The Azure DevOps CLI is the **first move** for everything in gate 4 and for the creation itself.
Configuration, auth, org/project resolution, WIQL and the boards verbs all belong to `azdo-cli` —
call it, do not re-derive it here.

Table 1 carries **roles**, not type names. Gate 4 turns each role into the type that project really
has; `azdo-cli` owns the role-to-type mapping and the discovery calls.

| Needed | Source |
| --- | --- |
| which project | the workspace-to-project mapping in the user instructions, else list the org's projects via the CLI, else ask |
| which types exist, and their real field set | CLI: the process/work-item-type metadata for that project |
| which type fills a role here | the mapping in `azdo-cli`, matched against the types just discovered |
| which types are actually **in use** | CLI: a WIQL sample, deduped on the type field (WIQL has no `DISTINCT`) |
| candidate parents | CLI: WIQL by area, title keyword or recent activity; propose the best, let the user confirm or give an id/URL |
| the identity to assign to | CLI, **once per organization**: the WIQL `@Me` probe in `azdo-cli` — never `git config user.email`, which is the machine's identity and belongs to the wrong tenant as soon as a second org is in play |
| anything the CLI seems not to reach | the gap list in `azdo-cli` `mcp-fallback.md` decides — never restate it here |

**No type name is a default.** If the project has no type for a role — a technical activity on a
process that has none, an analysis item on a process without one — **ask** which type to use and
list the types found. Never substitute the nearest-looking one, never carry a name over from another
project. Types never used may not surface from WIQL — say the list is "in use", not exhaustive.

### 4. Hierarchy

Default: sibling items under one existing parent. On request: a multi-level tree — grouping item →
backlog item → unit of time, in the types that project resolved — created in the same run, where
only the **root** hangs off an existing parent and every other link points at an item created in
this run. Create parents before children, sequentially.

## Do

```powershell
git remote get-url origin        # which repo, hence which project the work belongs to
```

Everything else is Azure DevOps: project listing, type and field metadata, WIQL parent search, the
creates, the parent links and the read-back verification all run through the CLI as documented in
`azdo-cli`. Per-call rules — which fields are
safe to set on which type, HTML bodies, creation order, first-create caution, mid-batch failure
reporting and the read-back — are in `item-content.md`.

Report the result as the final table plus the manual-attachment checklist (`tables.md`).

## Traps

1. The whole create fails on one field → a field that does not exist on that type was set (acceptance
   criteria and repro steps do not exist on every type or process) → read the type's field set first
   and fold unsupported content into the description.
2. The description renders as raw markup on the board → the field was written as markdown → write
   description and criteria as HTML; board markdown rendering is inconsistent.
3. Children land with no parent → the link was left for a second pass that failed → create parent
   first and link in the same call where the CLI allows it, then verify by reading the item back.
4. A retry duplicates items → a mid-batch failure reported no ids → always report the ids already
   created before stopping.
5. Items are created in the wrong project → the project was inferred from the conversation, not the
   path → resolve it from the workspace mapping or ask; state the project in Table 2.
6. Images silently disappear → they were never attached → attach them over REST with the `az login`
   token (`azdo-cli`); whatever fails stays a numbered placeholder in the manual-attachment checklist.
7. An item is created in state New but the type starts elsewhere → the process defines its own
   initial state → set the state explicitly after the create when it differs.
8. A type name from the last project is reused → it was remembered instead of discovered → resolve
   the role against this project's types every run, and ask when no type fills it.
9. Questions keep coming after Table 1 is approved → the Q&A gate was left open → resolve every
   material doubt in gate 2; after that, only discovery facts change the tables.
10. The items are created but nobody owns them → the assignee was left empty, or set from the
    machine's git identity on an organization whose tenant knows the user under another UPN → resolve
    the identity per organization, set it in the create call, and check it in the read-back.

## References

- `questions.md` — what the Q&A must cover, how to batch it, when to escalate to grilling, and what
  to derive from the images instead of asking.
- `tables.md` — the exact shape of Table 1, Table 2, the final summary and the attachment checklist,
  with the link and hierarchy formats and the confirmation loops.
- `item-content.md` — fields and HTML, creation order and parent linking, safeguards, read-back.
- `session-cart.md` — session mode: focus grouping and feature, one point at a time into a cart,
  assignee inference, the recap and the bulk create.
