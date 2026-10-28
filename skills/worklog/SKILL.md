---
name: worklog
description: >-
  Use when the user asks to log hours ("segna le ore", "registra le ore", /worklog [period]): hours
  per day from the transcripts, onto Azure DevOps.
---

# worklog — what was done, each day against its target, the hours on the board

**Contract.** Per day: Table 1 with its coverage, Table 2, then hours on Tasks and an audit entry ·
never writes outside the fixed rules below · Italian chat, tables and board text; field names, WIQL
and engine output verbatim.

## When

- Period: `/worklog`, `ieri`, `<data>`, a range (default: today). **Scoped**: `/worklog [period] AB#<id> | PR <n> | topic <text> | sessione <id>` (or "segna le ore di questo item/PR/questa chat"): `scoping.md`.
- A day already logged is re-run: only the delta reaches the board.

Not for: creating backlog items (`user-story-standard`, `azdo-cli`), Azure DevOps verbs, auth and identity
(`azdo-cli`), PR links (`pr-create`).

## Decide

### 1. Fixed rules

| Rule | Detail |
| --- | --- |
| Time only from the engine | never estimated by hand; splitting a bucket is said out loud |
| Every day against its **target** | 8h Monday-Friday, 0 at weekends, a date's own value in `targets.json`; **under target** = more than 1h short → gap prompt |
| Hours come from the user, sources propose | Slack, calendar, board and git events are candidate rows, confirmed one by one; never logged unconfirmed |
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
| 2. Engine | `worklog.ps1`: Claude and user time per project/branch, GIORNO table (claude, tu, totale, fuori, target, loggato, mancano), long turns, digest | `tempo-e-topic.md` |
| 3. Topics | topics from branch and digest, a role each, `round.ps1 -TargetHours <t>` per day | `tempo-e-topic.md` |
| 4. Table 1 + coverage | the table, NON FATTURATO, COPERTURA; under target → **gap prompt** → management rows, source proposals, reduced day | `tabelle.md`, `ore-gestione.md`, `fonti-esterne.md` |
| 5. Discovery | per loggable row: project, Task or parent, PRs/commits, hours on item, reconciliation | `scrittura.md` |
| 6. Table 2 | where the hours go | `tabelle.md` |
| 7. Write | create missing Tasks (no hours), links, rows file → push `-DryRun` → push → read back → recap | `scrittura.md` |

### 3. Development, management, internal

| Case | When | Detail |
| --- | --- | --- |
| Development | a branch, commit, PR or work item covers it | `scrittura.md` |
| Management | meetings, calls, grooming, estimates, coordination — most of the gap prompt | `ore-gestione.md` |
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

The engine's output (header, **Attese lunghe**, `Nessuna attivita'`): `tempo-e-topic.md`. Read the digest
for topics and decisions; open a transcript only for a missing detail.

## Traps

1. A lunch break counted as work → a permission prompt left pending looks like a long tool call →
   show the long waits, drop them in the Table 1 loop.
2. Default-branch work vanishes → no branch topic → split it from the digest, say it is an estimate.

## References

- `tempo-e-topic.md` — Phases 1-3: the period, the engine's output, topics and rounding.
- `motore.md` — the hours or spans look wrong: how the engine counts CLAUDE, TU and FUORI.
- `scoping.md` — a scoped run.
- `tabelle.md` — Phases 4 and 6: the tables, link format, the recap.
- `ore-gestione.md` — an under-target day, or management hours.
- `fonti-esterne.md` — the gap prompt answered `Cercale nelle fonti`.
- `scrittura.md` — Phases 5 and 7: discovery, reconciliation, the rows file and the push.
- `chiusura.md` — nothing loggable, a reduced day, or the sheet root: the audit fields and closed-day rows.
