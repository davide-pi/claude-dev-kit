---
name: worklog
description: >-
  Use when the user asks to log hours ("segna le ore", "registra le ore", /worklog [period]): hours
  per day from the transcripts, onto Azure DevOps.
---

# worklog — what was done, each day against its target, the hours on the board

**Contract.** Per day: Table 1 with its coverage, Table 2, then hours on Tasks and an audit entry ·
never estimates by hand, never writes hours outside `worklog-push.ps1`, never logs a source event
unconfirmed · Italian chat, tables and board text; field names, WIQL and engine output verbatim.

## When

- `/worklog`, `/worklog ieri`, `/worklog <data>`, a range (default: today); or asked in prose ("segna le ore").
- **Scoped**: `/worklog [period] AB#<id> | PR <n> | topic <text>`, or "segna le ore di questo item/PR": only
  the topics whose branch, PR, item or label match go through Phases 3–7; the day's target, COPERTURA, gap
  prompt and close/target rows are skipped (the rest of the day stays for a full run). Nothing matches → say so.
- The session-start reminder names a day **non registrato** or **sotto target** → `/worklog <data>`.
- A day already logged is re-run: only the delta reaches the board.

Not for: creating backlog items (`workitem-create`), Azure DevOps verbs, auth and identity
(`azdo-cli`), PR links (`pr-create`). Asked by the user only, never on Claude's own initiative.

## Decide

### 1. Fixed rules

| Rule | Detail |
| --- | --- |
| Time only from the engine | never estimated by hand; splitting a bucket is said out loud |
| Every day against its **target** | 8h Monday-Friday, 0 at weekends, a date's own value in `targets.json`; **under target** = more than 1h short → gap prompt |
| Hours come from the user, sources propose | Slack, calendar, board and git events are candidate rows, confirmed one by one |
| Two gates | Table 1 and Table 2, each with its own explicit confirmation |
| Hours **only** through `worklog-push.ps1` | it adds the delta to `CompletedWork` (never overwrites), reads it back, writes the audit; the shell guard asks on any other `CompletedWork` write |
| Hours already on the item are reconciled | hours the audit does not know → ask; same work → `"delta": 0` |
| Never leave a Task `New` | `Active` ongoing, `Closed`/`Done` finished |
| Every day handled ends in the audit | nothing loggable → close row at zero, after asking; a reduced day → `target` row |
| Nothing hardcoded | org, project, items, identity resolved per run |

### 2. Phases

| Phase | What | Detail |
| --- | --- | --- |
| 1. Period | argument → `From`/`To`; ambiguous → ask; a range goes **day by day** from Phase 3 | `tempo-e-topic.md` |
| 2. Engine | `worklog.ps1`: active time per project/branch, GIORNO table (attivo, target, loggato, mancano), long waits, digest | `tempo-e-topic.md` |
| 3. Topics | topics from branch and digest, a role each, `round.ps1 -TargetHours <t>` per day | `tempo-e-topic.md` |
| 4. Table 1 + coverage | the table, NON FATTURATO, COPERTURA; under target → **gap prompt** → management rows, source proposals, reduced day | `tabelle.md`, `ore-gestione.md`, `fonti-esterne.md` |
| 5. Discovery | per loggable row: project, Task or parent, PRs/commits, hours on item, reconciliation | `scrittura.md` |
| 6. Table 2 | where the hours go | `tabelle.md` |
| 7. Write | create missing Tasks (no hours), links, rows file → push `-DryRun` → push → read back → recap | `scrittura.md` |

### 3. Development, management, internal

| Case | When | Where the hours go |
| --- | --- | --- |
| Development | a branch, commit, PR or work item covers it | the **Task** of the item worked on (`scrittura.md`) |
| Management | meetings, calls, grooming, estimates, coordination — most of the gap prompt | Feature `Gestione progetto` → PBI `Gestione progetto - <Epic>` → one Task per session, `Done` (`ore-gestione.md`) |
| Internal | tooling, the kit: not billable | its own row, never logged, shown in NON FATTURATO |

In doubt → ask. Never spread management hours over a product item to reach the target.

## Do

```powershell
$wl = "$HOME\.claude\skills\worklog"
# Phase 2 — the engine: reads the transcripts, writes only the digest
pwsh -NoProfile -File "$wl\worklog.ps1" -From "<yyyy-MM-dd>" -To "<yyyy-MM-dd>"
# Phase 3 — one day, all its topics in one call, against that day's target
pwsh -NoProfile -File "$wl\round.ps1" -TargetHours 8 "80|import nuovi mercati|main" "4|fix seed|donor" "40|tooling|internal"
# Phase 7 — the confirmed rows (shape in scrittura.md): preview, then write
pwsh -NoProfile -File "$wl\worklog-push.ps1" -Rows "<rows.json>" -DryRun
pwsh -NoProfile -File "$wl\worklog-push.ps1" -Rows "<rows.json>"
```

The engine's header says how much the waits and the continuity recovered; the **Attese lunghe**
list (> 45 min counted active) goes into Table 1 for the user to keep or drop. `Nessuna attivita'`
on a weekday → gap prompt or close at zero, after asking. Read the digest for topics and decisions;
open a transcript only for a missing detail.

## Traps

1. Hours doubled → a raw `az` update, or the delta passed as `hours` → only the push; `hours` = the
   period total on the item.
2. Hours doubled while adding → hours logged by hand the audit did not know → reconcile, ask; same
   work → `"delta": 0`.
3. A day closed at 0.5h, no question asked → coverage skipped → COPERTURA and the gap prompt on
   every under-target day.
4. The gap filled to 8h by itself → the target treated as a quota → hours only as the user declares.
5. Source events logged as found → they are proposals → each row confirmed.
6. A lunch break counted as work → a permission prompt left pending looks like a long tool call →
   show the long waits, drop them in the Table 1 loop.
7. The reminder keeps flagging a day → no audit entry, or under target with no decision → close row,
   or `target` row for a reduced day.
8. A second management Task for the same day → a re-run created instead of reusing → audit and
   date-prefix lookup first.
9. Default-branch work vanishes → no branch topic → split it from the digest, say it is an estimate.
10. The recap shows the plan → it is the push output plus the read-back.

## References

- `tempo-e-topic.md` — period, the engine's pause rules and GIORNO table, `targets.json`, topics,
  roles, rounding per day, NON FATTURATO and COPERTURA.
- `tabelle.md` — Table 1 with coverage, Table 2, link format, confirm loops, the recap.
- `ore-gestione.md` — the gap prompt; management hours: fixed Feature/PBI, one Task per session.
- `fonti-esterne.md` — board, git, Slack and calendar as proposals for an under-target day.
- `scrittura.md` — discovery, reconciliation, Task creation, the rows file and the push, the audit,
  the closed day.
