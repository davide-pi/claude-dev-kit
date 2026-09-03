# The tables and their confirmation loops

Three printed artefacts: Table 1 (the split), Table 2 (the split plus the resolved target), and the
final summary. Each of the first two is a **gate**: print, ask, apply changes, reprint, ask again —
and move on only on explicit approval. The titles they print are the items' real ones: Italian.

## Table 1 — the split

Printed at gate 3, before any Azure DevOps call. Nothing but this table.

```markdown
| # | Type       | Title |
|---|------------|-------|
| 1 | Feature    | Dashboard di fatturazione multi-tenant |
| 2 | User Story | ↳ Mostra l'elenco fatture per tenant |
| 3 | Task       | ↳↳ Aggiungi endpoint API fatture |
```

- `#` numbers the rows so the user can say "change item 2".
- `Type` is still **provisional** — discovery validates it at gate 4.
- Hierarchy is shown with one `↳` per level of nesting.
- Titles are concise and specific: a title that fits three different items is not a title.

Then ask: **"Do you want to change anything — number of items, types, titles, the split, the
hierarchy?"** Apply, reprint, re-ask. Only explicit approval opens gate 4.

## Table 2 — the split plus the target

Printed at gate 5, after discovery.

```markdown
| # | Type       | Title | Parent |
|---|------------|-------|--------|
| 1 | Feature    | Dashboard di fatturazione multi-tenant | [Epic #4210 — Piattaforma di fatturazione](https://<org-host>/<project>/_workitems/edit/4210) |
| 2 | User Story | ↳ Mostra l'elenco fatture per tenant  | → #1 (new, created in this run) |
| 3 | Task       | ↳↳ Aggiungi endpoint API fatture     | → #2 (new, created in this run) |
```

- `Type` is the one **validated** against the project's real types.
- `Parent`:
  - an existing parent → a **clickable link** whose text is `<Type> #<id> — <title>`;
  - a child of a row in this run → `→ #<row> (new, created in this run)`;
  - no parent → `—`.
- Build the URL from the item's own HTML link field when the call returns one, otherwise from the
  project's `_workitems/edit/<id>` pattern with the org host and project **discovered at runtime**.
  **Always a link, never a bare number** — the same rule holds in the final summary.
- Under the table, state the **project** the items will be created in, and the interface used (CLI,
  or the MCP fallback and why).

Then ask for changes — different parent, different project, different type, different hierarchy,
different titles. Anything that changes re-runs the affected part of discovery and reprints the
table. Only explicit confirmation starts creating.

## The optional content preview

Ask once, or honour what the user already said: **"Do you want to review the full body of each item
before I create them, or should I create them directly?"** If yes, print each body in full,
including the numbered image placeholders, apply corrections, reprint, then confirm.

## Final summary

```markdown
| # | Type       | Title (link) |
|---|------------|--------------|
| 1 | Feature    | [Dashboard di fatturazione multi-tenant](https://<org-host>/<project>/_workitems/edit/4711) |
| 2 | User Story | ↳ [Mostra l'elenco fatture per tenant](https://<org-host>/<project>/_workitems/edit/4712) |
```

Titles are clickable links to the created items; children stay indented so the hierarchy is visible
at a glance. Then the attachment checklist, one row per item that carries placeholders:

```markdown
Images to attach manually:
- [Task #4712 — Mostra l'elenco fatture per tenant](<url>): IMAGE 1 (login error screenshot), IMAGE 2 (expected layout)
```

Close with one line: how many items were created, in which project, and anything that did **not**
happen (a field folded into the description, a state corrected after the create, a link that failed).

## Traps

1. Table 1 printed together with discovery results → the gate collapses → Table 1 comes before any
   Azure DevOps call.
2. A parent shown as `#4210` → the user cannot check it without searching → always a link with the
   title in the text.
3. Table 2 reprinted without re-running discovery after a project change → types and parents are
   stale → a project or org change invalidates gate 4.
4. "Looks good, go" treated as approval for both tables → only one gate was passed → each table
   gets its own explicit approval.
5. The final summary lists items but not the attachments → the user never attaches them → the
   checklist is part of the summary, not an optional extra.
