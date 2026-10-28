# The audit and the closed day

Open when a day has nothing loggable, is reduced, or its hours sit on a sheet. Rows and push: `writing.md`.

## The audit

- Key `(periodFrom, periodTo, itemId)`; a re-run updates the entry instead of adding one.
- Fields: `periodFrom`, `periodTo`, `topic`, `mcp`, `project`, `itemId`, `parentId`, `created`,
  `hoursLogged` (the period's total on the item), `prs`, `commits`, `ts`, and `note`/`sheet`/`overtime`
  when given. `hoursLogged` is the period total, not the item's cumulative value: that is what makes
  the delta computable on a re-run.
- **Never pruned**: an old re-run always finds its delta. The digest expires, not the audit.

## The closed day

A day is "closed" when **an audit entry covers it**; it is **under target** when its logged hours are
more than 1h short of its target. `hooks/worklog-pending.js` reads both for the session-start
reminder and the statusline badge. So:

| Case | Push row |
| --- | --- |
| Hours logged | the hours rows |
| Hours kept on a **sheet**, not a board (roots `workspaces.json` sends to a sheet) | a close row with the real hours: `itemId: null`, `hours: <h>`, `project: "<root>/<project>"`, `sheet: "<sheet path>"` |
| The day happened but **nothing is loggable** (tooling only, leave, a fully `internal` day) | a close row: `topic: "nulla-da-registrare"`, `itemId: null`, `hours: 0` — a day closed at zero is never under target |
| A **reduced day** (event, leave, course, part-time) | a `target` row with the real target and a note, plus the day's hours rows |
| The user postpones ("lo faccio domani") | **nothing**: the day stays pending, which is exactly right |

Ask before a close row at zero, in the chat language: "il <data> non c'è niente da registrare, lo chiudo a zero?"
