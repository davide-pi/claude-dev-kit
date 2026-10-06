# The two tables and the recap

Two gates, one protocol each: print the table, ask for changes, apply, **reprint**, ask again. The
next phase starts **only** on explicit confirmation. Tables, headers, short descriptions and
questions are **Italian** — the short description also seeds the Task title and description, and
work items are Italian.

## Table 1 — activity summary

Print **only** this table in chat. The step-by-step timeline lives in the digest and is shown only
on request.

```markdown
| # | Topic | Descrizione breve | Tempo | Da | A | Arrotondato |
|---|-------|-------------------|-------|----|---|-------------|
| 1 | import nuovi mercati | Import e mappatura dei nuovi mercati | 1h20m | 09:08 | 10:16 | 1.5h |
| 2 | cache traduzioni | Fix invalidazione cache traduzioni | 25m | 11:40 | 12:05 | 0.5h |
| 3 | tooling worklog | Fix retention engine worklog | 8m | 15:02 | 15:10 | 0h *(non loggato, interno)* |
| | **Totale** | | **<somma misurata>** | | | **<somma arrotondata>** |
```

- `#` numbers the rows, so the user can say "cambia la 2".
- `Tempo` = measured by the engine; `Da`/`A` = time window (add the date when the range spans
  several days); `Arrotondato` = what the helper printed.
- Mark the **0h (non loggato)** rows and the **internal** ones.
- `donor` rows do not appear — they were spread. If there were any, say so in one line below.

Then ask: **"Vuoi modificare qualcosa (topic, descrizioni, tempi, accorpare o dividere righe)?"**
Changes → apply, **re-round** if minutes changed, reprint, ask again — until confirmed.

## Table 2 — where the hours go

```markdown
| # | Topic | Descrizione breve | Arrotondato | Progetto | Item |
|---|-------|-------------------|-------------|----------|------|
| 1 | import nuovi mercati | Import e mappatura nuovi mercati | 1.5h | <Project> | [Task #<id> — Import e mappatura dei nuovi mercati](https://<org-host>/<project>/_workitems/edit/<id>) (esistente, su item 2h → +1.5h) |
| 2 | cache traduzioni | Fix invalidazione cache traduzioni | 0.5h | <Project> | padre [US #<id> — Pipeline di localizzazione](https://<org-host>/<project>/_workitems/edit/<id>) → **Task DA CREARE** ("Fix invalidazione cache traduzioni") |
```

- `Progetto`: the Azure DevOps project actually resolved. Below the table state the **interface**
  used: CLI, or the MCP fallback and why.
- `Item`:
  - existing Task → `[Task #<id> — <titolo>](<link>) (esistente, su item <T>h → +<delta>h)`. Hours
    **already on the item are always shown**, zero included — the only way the user sees what is
    being added to what. If the audit already wrote something for this period, add
    `già scritto <X>h → delta <±Y>h`; hours the audit does not know are marked
    `su item <T>h (<Y>h non da worklog)` and **the row stays undecided** until the user says whether
    they are the same work (`scrittura.md`, Phase 5 step 5);
  - Task to create → `padre [<Tipo> #<id> — <titolo>](<link>) → **Task DA CREARE** ("<titolo previsto>")`.
- **Always a clickable link with the title, never a bare number** — parent, existing Task and final
  recap alike. Link text `<Tipo> #<id> — <titolo>`, the title read from the item at runtime; the URL
  from the item's HTML link, or the `_workitems/edit/<id>` pattern with org host and project
  **discovered at runtime**.
- Below the table, row by row, the **PRs** and **commits** to be linked (or "nessuno").
- Omit the 0h rows but recall them in a note: they make the measured total add up.

Then ask for changes: another item, another project, create the Task or not, hours, PRs, commits.
A change → redo the affected discovery, reprint Table 2, ask again. Write only on explicit
confirmation.

## Final recap

After the writes and **after** reading the items back: per row, the item touched, hours before and
after, whether it was created, parent, final state, PRs and commits linked. Every item and parent is
a **clickable link with its title**.

Close with one Italian line: total hours logged, on which project, and what did **not** happen — a
0h row not logged, a failed link, a field not written.

## Traps

1. The timeline is printed beside the table → the message becomes unreadable → it lives in the digest.
2. The rounded total does not match the rows → a row was corrected by hand → rounded numbers come
   only from the helper.
3. An item shown as `#105060` → the user cannot check it without searching → link with title.
4. "Ok procedi" on Table 1 taken for Table 2 as well → only one gate passed → each table has its own
   confirmation.
5. The recap repeats Table 2 instead of the outcome → the plan was trusted, not the board → the
   recap describes what was written and verified.
