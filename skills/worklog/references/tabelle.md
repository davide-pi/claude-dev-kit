# The two tables, coverage and the recap

Two gates, one protocol each: print the table, ask for changes, apply, **reprint**, ask again. The
next phase starts **only** on explicit confirmation. Everything here is Italian: the short description
also seeds the Task title and description.

## Table 1 — the day, against its target

One block per day (a range prints one per day). Only this in chat; the timeline stays in the digest.

```markdown
**Lunedì 12/10** — target 8h · già sul board 0h

| # | Progetto | Topic | Claude + Tu | Totale | Arrotondato |
|---|----------|-------|-------------|--------|-------------|
| 1 | <Project> | import nuovi mercati — mappatura nuovi mercati | 55m + 25m | 1h20m | 1.5h |
| 2 | <Project> | cache traduzioni — fix invalidazione cache | 15m + 10m | 25m* | 0.5h |
| 3 | interno | tooling worklog — fix engine worklog | 30m + 10m | 40m | 0.5h (interno, non loggato) |
| | | **Totale** | **1h40m + 45m** | **2h25m** | **2h loggabili** |

\* stima: ripartizione del branch di default
Fuori orario: #1 +10m
Non fatturato: 40m (interni 40m, arrotondamento 0m)
Attese lunghe contate: 10:45-13:10 (2h25m, <repo>) — tienile o toglile
**Copertura: 2h / 8h — mancano 6h**
```

| Column / line | Source |
| --- | --- |
| `Progetto` | **every row, gap rows included**: the board project from `workspaces.json` (the topic's path), `interno` for internal rows; unmapped or unsure → `?` and ask in the same message |
| `Topic` | `<topic> — <descrizione breve>` in one cell, **at most ~50 characters**: cut the description, never wrap it |
| `Claude + Tu` / `Totale` | the engine's `CLAUDE`, `TU` and `TOTALE` for the topic: measured hours, extra, their sum; the user adjusts by judgement. An estimate (a split of the default branch) gets `*` after `Totale` and the line `\* stima: <why>` below the table — **never `~`** in a cell: two of them in a row render as strikethrough |
| `Arrotondato` | `round.ps1` on `Totale`, never by hand; mark `0h (non loggato)` and `interno` rows |
| `Fuori orario` line | the engine's `FUORI`, what fell outside 08:00-20:00: `#<n> +<min>` per row that has any; omit the line when all are 0 |
| `Fonte` line | only rows not from the transcripts (gap rows): `#<n> da <dichiarato, Slack, calendario, board, git>`; omit it otherwise |
| header `già sul board` | the GIORNO table's `LOGGATO` for the day |
| `Non fatturato` | the helper's NON FATTURATO line, verbatim numbers |
| `Attese lunghe contate` | the engine's long turns on that day; omit the line when there are none |
| `Copertura` | the helper's COPERTURA line, recomputed after every change |

`donor` rows do not appear (they were spread): say so in one line if there were any.

**Under target** (more than 1h short) → the **gap prompt** right after the table — one
`AskUserQuestion`, shape and follow-ups in `ore-gestione.md`. The answers become new rows with their
`Fonte`; reprint, recompute the coverage, then the usual question. Not under target → straight to:

**"Vuoi modificare qualcosa (topic, descrizioni, tempi, accorpare o dividere righe, attese lunghe)?"**

Minutes changed → re-round, reprint, ask again — until confirmed.

## Table 2 — where the hours go

```markdown
| # | Topic | Descrizione breve | Arrotondato | Progetto | Item |
|---|-------|-------------------|-------------|----------|------|
| 1 | import nuovi mercati | Import e mappatura nuovi mercati | 1.5h | <Project> | [Task #<id> — Import e mappatura dei nuovi mercati](https://<org-host>/<project>/_workitems/edit/<id>) (esistente, su item 2h → +1.5h) |
| 2 | cache traduzioni | Fix invalidazione cache traduzioni | 0.5h | <Project> | padre [US #<id> — Pipeline di localizzazione](<link>) → **Task DA CREARE** ("Fix invalidazione cache traduzioni") |
| 3 | riunione cliente | Allineamento settimanale | 1h | <Project> | padre [PBI #<id> — Gestione progetto - <titolo Epic>](<link>) → **Task DA CREARE** ("<aaaa/MM/gg> - Allineamento settimanale") |
```

- `Progetto`: the project actually resolved. Below the table, the **interface** used (CLI, or the MCP
  fallback and why).
- `Item`:
  - existing Task → `[Task #<id> — <titolo>](<link>) (esistente, su item <T>h → +<delta>h)`. Hours
    already on the item are **always shown**, zero included. Re-run → add
    `già scritto <X>h → delta <±Y>h`. Hours the audit does not know → `su item <T>h (<Y>h non da worklog)`
    and the row stays **undecided** until the user says whether it is the same work (`scrittura.md`);
  - Task to create → `padre [<Tipo> #<id> — <titolo>](<link>) → **Task DA CREARE** ("<titolo previsto>")`.
- **Always a link with the title, never a bare number** — parent, Task and recap alike. Text
  `<Tipo> #<id> — <titolo>` read at runtime; URL from the item's HTML link or `_workitems/edit/<id>`
  with the org host and project discovered at runtime.
- Below the table, row by row, the **PRs** and **commits** to link, as a table `| # | PR | Commit |`
  ("nessuno" in the cell), never a bulleted list.
- Choices made or to confirm (rows merged, hours split between Tasks, why an item was picked): a table
  `| # | Scelta | Motivo |`, never bullets.
- 0h rows are omitted but recalled in a note, so the measured total still adds up.

Then ask for changes (item, project, create or not, hours, PRs, commits). A change → redo the affected
discovery, reprint, ask again. Write only on explicit confirmation.

## Final recap

From the push output (`worklog-push.ps1` prints item, before, delta, after, audit, outcome per row) and
**after** reading the items back: per row, the item touched, hours before and after, created or not,
parent, final state, PRs and commits linked — every item a **link with its title**. Then one line per
day: `copertura finale <h>/<target>h`. Close with one Italian line: total logged, on which project,
and what did **not** happen (a 0h row, a failed row, a failed link).

## Traps

1. The timeline printed beside the table → unreadable → it lives in the digest.
2. The rounded total does not match the rows → a row corrected by hand → numbers only from the helper.
3. An item shown as `#105060` → the user cannot check it → link with title.
4. "Ok procedi" on Table 1 taken for Table 2 → one gate passed → each table has its own confirmation.
5. Coverage computed once and left stale → rows added by the gap prompt → recompute after every change.
6. The recap repeats Table 2 → the plan was trusted → the recap is the push output, read back.
7. Table 1 falls apart in the terminal → 12 columns and long descriptions wrap, `~` pairs strike text through →
   the six columns above, `Topic` at ~50 characters, `*` for an estimate (`tools/validate-content.mjs` checks the
   templates: at most 8 columns, no `~`).
