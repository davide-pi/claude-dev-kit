---
name: workitem-create
description: >-
  Create one or more Azure DevOps work items from a description and images, complete enough for a
  human or an AI to implement without asking anything back. Runs a targeted Q&A that escalates to
  grilling, then two confirmation tables (type/title, then type/title/parent), then creates the
  items in Italian through the Azure DevOps CLI, state New and unassigned. Item wording and
  acceptance criteria follow user-story-standard. Project, work item types and parent are discovered
  at runtime — nothing is hardcoded. Explicit trigger: only when the user types /workitem-create.
---

# workitem-create — a description becomes real work items

## When

- The user types `/workitem-create`, with or without a description and pasted images.
- A piece of work has to become one item, or a small hierarchy of items, on a board.
- An existing parent (Epic, Feature, Story) has to receive new children.

Not for: logging hours on an existing item (`worklog`), reading or analysing an item already on the
board, testing an implemented item (`items-qa`), or Azure DevOps CLI configuration, auth and verbs
(`azdo-cli`). Never fires without the explicit trigger.

## Decide

### 1. Non-negotiables

| Rule | Detail |
| --- | --- |
| Italian on the board | every title, description and criterion written to the board; chat, questions and tables follow the user |
| Nothing hardcoded | project, work item types, fields and parent are **discovered at runtime**, every run |
| New and unassigned | unless the user explicitly asks otherwise |
| Gated | Table 1, Table 2 and the optional content preview each need explicit confirmation |
| Never a throwaway | no "test" item on a real board, ever |
| Content is not ours | type classification, wording and acceptance criteria come from `user-story-standard`; this skill owns the mechanism |

### 2. The five gates, in order

| Gate | What happens | Detail |
| --- | --- | --- |
| 1. Intake | read the text **and** the images; number them `IMAGE 1..n` with a caption; summarise in 2-4 lines what was understood | — |
| 2. Q&A | targeted batched questions, escalating to grilling when the work is ambiguous | `questions.md` |
| 3. Table 1 | the split into items: `#`, type (provisional), title — confirm, edit, reprint until approved | `tables.md` |
| 4. Discovery | project, the types that really exist, their real field sets, the parent | below |
| 5. Table 2 | the same rows plus the resolved parent link — confirm, then optionally preview the full bodies, then create | `tables.md`, `user-story-standard` |

Never merge two gates into one message, and never move past one without explicit approval.

### 3. Discovery — CLI first, MCP where the CLI has no verb

The Azure DevOps CLI is the **first move** for everything in gate 4 and for the creation itself.
Configuration, auth, org/project resolution, WIQL and the boards verbs all belong to `azdo-cli` —
call it, do not re-derive it here.

| Needed | Source |
| --- | --- |
| which project | the workspace-to-project mapping in the user instructions, else list the org's projects via the CLI, else ask |
| which work item types exist, and their real field set | CLI: the process/work-item-type metadata for that project |
| which types are actually **in use** | CLI: a WIQL sample, deduped on the type field (WIQL has no `DISTINCT`) |
| candidate parents | CLI: WIQL by area, title keyword or recent activity; propose the best, let the user confirm or give an id/URL |
| free-text or cross-project search, attachments, item comments | **MCP fallback** — the CLI has no verb for these |

If a requested type does not exist, or none was specified, **ask** and list what was found. Types
never used in the project may not surface from WIQL — say the list is "in use", not exhaustive.

### 4. Hierarchy

Default: sibling items under one existing parent. On request: a multi-level tree (Feature → Story →
Task) created in the same run, where only the **root** hangs off an existing parent and every other
link points at an item created in this run. Create parents before children, sequentially.

## Do

```powershell
git remote get-url origin        # which repo, hence which project the work belongs to
git config user.email            # only if the user asks for the items to be assigned to them
```

Everything else is Azure DevOps: project listing, type and field metadata, WIQL parent search, the
creates, the parent links and the read-back verification all run through the CLI as documented in
`azdo-cli`, with the MCP fallback above where no verb exists. Per-call rules — which fields are
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
6. Images silently disappear → the CLI cannot upload attachments → leave numbered placeholders in
   the body and end with the manual-attachment checklist; use the MCP attachment capability only if
   the connected server actually exposes one.
7. An item is created in state New but the type starts elsewhere → the process defines its own
   initial state → set the state explicitly after the create when it differs.
8. Questions keep coming after Table 1 is approved → the Q&A gate was left open → resolve every
   material doubt in gate 2; after that, only discovery facts change the tables.

## References

- `questions.md` — what the Q&A must cover, how to batch it, when to escalate to grilling, and what
  to derive from the images instead of asking.
- `tables.md` — the exact shape of Table 1, Table 2, the final summary and the attachment checklist,
  with the link and hierarchy formats and the confirmation loops.
- `item-content.md` — fields and HTML, creation order and parent linking, safeguards, read-back.
