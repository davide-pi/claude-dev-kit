# Project-management hours

The "management" case: time **attributable to no product item** — client meetings and calls,
backlog analysis and grooming, estimates, coordination, `/workitem-create` session-mode runs. It
does not go on the Tasks of the work done (that is `scrittura.md`) but into a **fixed structure per
engagement**. Hours are written **only from here**: no other asset logs them.

## The fixed structure

Per engagement, where **the engagement is the Epic's title**. The titles below are board data —
Italian and exact:

```text
Epic  <Epic title>                                   ← the engagement
└── Feature  "Gestione progetto"                     ← exact title, one per Epic
    └── PBI  "Gestione progetto - <Epic title>"      ← exactly one, holds all the hours
        ├── Task  "<yyyy/MM/dd> - <activity title>"  ← one per logged session
        └── Task  "<yyyy/MM/dd> - <activity title>"
```

| Level | Rule |
| --- | --- |
| Feature | **exact** title `Gestione progetto`, child of the Epic |
| PBI | **one** per Epic, title `Gestione progetto - <Epic title>` |
| Hours Task | **one per logged session**, not one per item worked on |

## Finding the PBI — and creating it when missing

1. **Org and project** from the workspace→project mapping in the user instructions, by the
   project's path; passed explicitly on every command, never the `az devops configure` default.
   Unmapped path → **ask**.
2. **The engagement's Epic.** Several Epics and the right one not derivable from the period's work
   → **ask**: management hours land on an engagement, and the wrong one is the wrong client.
3. **Every Feature of the Epic**, **Done ones included** — no state filter: an old engagement's
   management Feature is often closed.
4. **The PBI among those Features' children, by prefix match**, not exact title — the title carries
   the engagement name and may not match character for character:

   ```text
   [System.WorkItemType]='<backlog-item type>'
     AND [System.Title] CONTAINS 'Gestione progetto -'
     AND [System.Parent] IN (<featureId>, ...)
   ```

5. **Missing → create it**, titled `Gestione progetto - <Epic title>`, under the `Gestione progetto`
   Feature. Feature missing too → create it **first** (exact title, child of the Epic), then the
   PBI, then the Task.

Verbs, flags and the full WIQL are `azdo-cli`'s — including naming the project **inside** the WIQL.
The backlog-item type is resolved per project (`azdo-cli`), never assumed.

## The hours Task

| Field | Value |
| --- | --- |
| type | the time role (`Task`), child of the management PBI |
| title | `<yyyy/MM/dd> - <activity title>` — the date of the logged session; the title is a one-line Italian summary of the session, consistent with Table 1 |
| assignee | the user, identity resolved **against the organization** at runtime (`azdo-cli`, "Resolving the identity to assign to"); never fixed, never the machine's |
| completed work | the session's hours, rounded by the helper like every other row |
| state | forced to **Done** right after creation — an hours Task never stays `New` |

## Idempotence

- The cumulative rule holds: read completed work, add the **delta**, write back. For a new Task the
  delta is the whole.
- A re-run of the same period **never** creates a twin: look up the audit entry
  `(periodFrom, periodTo, itemId)` first, then a Task under the management PBI with the same date
  prefix. Found → add the delta. Delta 0 → touch nothing.
- The audit row is written like any other, with the Task's `itemId` and the PBI's `parentId`.

## In Table 2

Management shows as an ordinary row, so the user sees where the hours land before anything is
written (the full Table 2 shape is in `tabelle.md`):

```markdown
| 3 | riunione cliente | Riunione + grooming backlog | 1.5h | <Project> | padre [PBI #<id> — Gestione progetto - <titolo Epic>](<link>) → **Task DA CREARE** ("<aaaa/MM/gg> - <titolo attività>") |
```

Several management sessions in a period → **several rows and several Tasks**, one per session;
never merged into one Task for the period.

## Traps

1. A duplicate management PBI appears → searched by exact title, or only among non-Done Features →
   prefix match, over every Feature of the Epic, Done included.
2. Management hours land on a product item → the topic looked close to a backlog item → not
   attributable to an item means management; in doubt, ask.
3. One hours Task per item worked on → the development logic was applied → one Task per session.
4. The hours Task is assigned to a fixed account → the identity was hardcoded → resolve it per run.
5. The hours Task stays `New` → the state was not forced → `Done` right after creation.
6. Same-day re-run doubles the hours → a new Task instead of the delta → audit and date-prefix
   lookup before creating.
7. An `internal` topic (tooling, not billable) ends up as management → they differ → `internal`
   stays its own row and is never logged.
