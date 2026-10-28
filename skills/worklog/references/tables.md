# The two tables, coverage and the recap

Two gates, one protocol each: print the table, ask for changes, apply, **reprint**, ask again. The
next phase starts **only** on explicit confirmation. Everything here is in the chat language: the short description
also seeds the Task title and description.

## Table 1 — the day, against its target

One block per day (a range prints one per day). Only this in chat; the timeline stays in the digest.

```markdown
**Monday 12/10** — target 8h · already on the board 0h

| # | Project | Topic | Claude + You | Total | Rounded |
|---|---------|-------|--------------|-------|---------|
| 1 | <Project> | import nuovi mercati — mappatura nuovi mercati | 55m + 25m | 1h20m | 1.5h |
| 2 | <Project> | cache traduzioni — fix invalidazione cache | 15m + 10m | 25m* | 0.5h |
| 3 | internal | tooling worklog — fix engine worklog | 30m + 10m | 40m | 0.5h (internal, not logged) |
| | | **Total** | **1h40m + 45m** | **2h25m** | **2h loggable** |

\* estimate: split of the default branch
Out of hours: #1 +10m
Not billed: 40m (internal 40m, rounding 0m)
Long waits counted: 10:45-13:10 (2h25m, <repo>) — keep or drop them
**Coverage: 2h / 8h — 6h missing**
```

At chat `it` (worklog tables are chat output): Project=Progetto, Claude + You=Claude + Tu, Total=Totale, Rounded=Arrotondato, loggable=loggabili, internal=interno (as `round.ps1` prints it), not logged=non loggato, already on the board=già sul board, estimate=stima, Out of hours=Fuori orario, Not billed=Non fatturato (internal=interni, rounding=arrotondamento), Long waits counted=Attese lunghe contate (keep or drop them=tienile o toglile), Coverage=Copertura (missing=mancano), Source=Fonte (`#<n> da <…>`), declared=dichiarato, calendar=calendario.

| Column / line | Source |
| --- | --- |
| `Project` | **every row, gap rows included**: the board project from `workspaces.json` (the topic's path), `internal` for internal rows; unmapped or unsure → `?` and ask in the same message |
| `Topic` | `<topic> — <short description>` in one cell, **at most ~50 characters**: cut the description, never wrap it |
| `Claude + You` / `Total` | the engine's `CLAUDE`, `TU` and `TOTALE` for the topic: measured hours, extra, their sum; the user adjusts by judgement. An estimate (a split of the default branch) gets `*` after `Total` and the line `\* estimate: <why>` below the table — **never `~`** in a cell: two of them in a row render as strikethrough |
| `Rounded` | `round.ps1` on `Total`, never by hand; mark `0h (not logged)` and `internal` rows |
| `Out of hours` line | the engine's `FUORI`, what fell outside 08:00-20:00: `#<n> +<min>` per row that has any; omit the line when all are 0 |
| `Source` line | only rows not from the transcripts (gap rows): `#<n> from <declared, Slack, calendar, board, git>`; omit it otherwise |
| header `already on the board` | the GIORNO table's `LOGGATO` for the day |
| `Not billed` | the helper's NON FATTURATO line, verbatim numbers |
| `Long waits counted` | the engine's long turns on that day; omit the line when there are none |
| `Coverage` | the helper's COPERTURA line, recomputed after every change |

`donor` rows do not appear (they were spread): say so in one line if there were any.

**Under target** (more than 1h short) → the **gap prompt** right after the table — one
`AskUserQuestion`, shape and follow-ups in `hours-management.md`. The answers become new rows, each named on
the `Source` line; reprint, recompute the coverage, then the usual question. Not under target → straight to:

**"Do you want to change anything (topics, descriptions, times, merge or split rows, long waits)?"** (at `it`: "Vuoi modificare qualcosa (topic, descrizioni, tempi, accorpare o dividere righe, attese lunghe)?")

Minutes changed → re-round, reprint, ask again — until confirmed.

## Table 2 — where the hours go

```markdown
| # | Topic | Short description | Rounded | Project | Item |
|---|-------|-------------------|---------|---------|------|
| 1 | import nuovi mercati | Import e mappatura nuovi mercati | 1.5h | <Project> | [Task #<id> — Import e mappatura dei nuovi mercati](https://<org-host>/<project>/_workitems/edit/<id>) (existing, on item 2h → +1.5h) |
| 2 | cache traduzioni | Fix invalidazione cache traduzioni | 0.5h | <Project> | parent [US #<id> — Pipeline di localizzazione](<link>) → **Task TO CREATE** ("Fix invalidazione cache traduzioni") |
| 3 | riunione cliente | Allineamento settimanale | 1h | <Project> | parent [PBI #<id> — Gestione progetto - <Epic title>](<link>) → **Task TO CREATE** ("<yyyy/MM/dd> - Allineamento settimanale") |
```

At chat `it`: Short description=Descrizione breve, Rounded=Arrotondato, Project=Progetto, existing=esistente, on item=su item, parent=padre, TO CREATE=DA CREARE, already written=già scritto, not from the worklog=non da worklog, none=nessuno, Choice=Scelta, Reason=Motivo, final coverage=copertura finale, `<yyyy/MM/dd>`=`<aaaa/MM/gg>`.

- `Project`: the project actually resolved. Below the table, the **interface** used (CLI, or the MCP
  fallback and why).
- `Item`:
  - existing Task → `[Task #<id> — <title>](<link>) (existing, on item <T>h → +<delta>h)`. Hours
    already on the item are **always shown**, zero included. Re-run → add
    `already written <X>h → delta <±Y>h`. Hours the audit does not know → `on item <T>h (<Y>h not from the worklog)`
    and the row stays **undecided** until the user says whether it is the same work (`writing.md`);
  - Task to create → `parent [<Type> #<id> — <title>](<link>) → **Task TO CREATE** ("<planned title>")`.
- **Always a link with the title, never a bare number** — parent, Task and recap alike. Text
  `<Type> #<id> — <title>` read at runtime; URL from the item's HTML link or `_workitems/edit/<id>`
  with the org host and project discovered at runtime.
- Below the table, row by row, the **PRs** and **commits** to link, as a table `| # | PR | Commit |`
  ("none" in the cell), never a bulleted list.
- Choices made or to confirm (rows merged, hours split between Tasks, why an item was picked): a table
  `| # | Choice | Reason |`, never bullets.
- 0h rows are omitted but recalled in a note, so the measured total still adds up.

Then ask for changes (item, project, create or not, hours, PRs, commits). A change → redo the affected
discovery, reprint, ask again. Write only on explicit confirmation.

## Final recap

From the push output (`worklog-push.ps1` prints item, before, delta, after, audit, outcome per row) and
**after** reading the items back: per row, the item touched, hours before and after, created or not,
parent, final state, PRs and commits linked — every item linked as in Table 2. Then one line per
day: `final coverage <h>/<target>h`. Close with one line in the chat language: total logged, on which project,
and what did **not** happen (a 0h row, a failed row, a failed link).

## Traps

1. "Ok procedi" on Table 1 taken for Table 2 → one gate passed → each table has its own confirmation.
