# Period, time, topics and rounding

## Phase 1 — the period

The argument must become two concrete dates (`yyyy-MM-dd`) before the engine runs (a `sessione <id>`
with no period is the exception):

| Argument | `From` / `To` |
| --- | --- |
| `sessione <id>` with no period | **omit** `-From`/`-To`: the engine derives them (first day of the session → today) |
| "questa settimana", "settimana scorsa", "ultimi N giorni", "10-15 lug" | compute the ends from today's date |

Still ambiguous → **ask**: a wrong period puts hours on the wrong item. A range runs the engine
**once**, then Phases 3-4 go **day by day**: coverage is a per-day fact, and per-day audit entries are
what the reminder reads.

## Phase 2 — the engine

```powershell
pwsh -NoProfile -File "$HOME\.claude\skills\worklog\worklog.ps1" -From "<yyyy-MM-dd>" -To "<yyyy-MM-dd>"
```

Reads every transcript under `~/.claude/projects` touched in the period — main sessions **and**
subagents — and never touches Azure DevOps. Two kinds of minutes: `CLAUDE` (Claude at work, summed
across sessions) and `TU` (the user writing and reading, counted once). `TOTALE` = `CLAUDE` + `TU`
inside 08:00-20:00 (`-DayStart`, `-DayEnd`); minutes outside go to `FUORI`, never dropped. A minute
goes to the topic (project + branch) the session's events say at that moment and to its local **day**.
Counting rules: `motore.md`.

Stdout, the authoritative numbers:

- header: `CLAUDE`, `TU`, `TOTALE` and `FUORI` for the period;
- project → branch: the same four columns, time window, prompt count;
- **GIORNO** table, one row per day: `CLAUDE`, `TU`, `TOTALE`, `FUORI`, `TARGET`, `LOGGATO` (already in
  the audit; a multi-day entry split evenly over its weekdays), `MANCANO` (target − logged);
- **Attese lunghe**: every turn above 120 minutes (`-MaxSpanMinutes`), counted in `CLAUDE` (a subagent tool call that long counts up to the limit). A
  permission prompt left pending over lunch looks exactly like a long build: show them in Table 1 and
  let the user drop them;
- the paths of the raw digest, the audit and `targets.json`.

**Targets**: `~/.claude/worklog/targets.json` — `{ "targetHours": 8, "days": { "<yyyy-MM-dd>": { "hours": 6, "note": "corso 4h + straordinario 2h" } } }`.
Only `worklog-push.ps1` writes it (a `target` row, `chiusura.md`); the user may edit it by hand for a
known event.

Retention: at launch the engine prunes **digests** older than 7 days; the **audit is never pruned**.
`Nessuna attivita'` → say so; on a weekday ask whether the day still has hours to cover (gap prompt,
`ore-gestione.md`) or closes at zero.

Then **read the digest** (`_raw/<period>.md`): project → branch → prompts and replies. Topics,
descriptions and decisions come from there; open a transcript only for a missing detail.

## Phase 3 — topics and roles

**The topic comes from the git branch.** A `feature/*`, `fix/*` or `bugfix/*` branch is a topic: give
it a human Italian name. Work on the default branch, `HEAD` or no branch → **split it into semantic
topics** from the digest and spread its minutes by a reasonable estimate, **saying so**. A topic
crosses projects only when it is clearly the same work.

| Role | When | Effect |
| --- | --- | --- |
| `main` | a real topic, ≥ ~15 min | receives the donors' minutes, rounds normally |
| `donor` | a micro-topic (< ~15 min) of client work **without** its own item | minutes spread **evenly** over the `main` topics; the row disappears |
| `keep` | a micro-topic **with** its own item, or worth keeping | stays a row, lifted to **at least 0.5h** |
| `internal` | not billable (tooling, the kit) | own row, rounds normally, never receives or gives minutes, never logged — it shows in NON FATTURATO |

Certainty about the item comes in Phase 5: classify by judgement here, re-check in discovery. An
`internal` topic becomes `donor` only when the user asks.

## Rounding — one day per call

Usage as in `SKILL.md` Do.

- Entry `minutes|label|role`, role default `main`: `minutes` = the row's `Totale` as adjusted in Table 1; the Italian label seeds the Task title.
- **Nearest 0.5h per topic**, no cap: 45 min → 1.0h (ties away from zero), under ~15 min → 0h.
- **All of one day's topics in one call**: the donor spread depends on how many `main` rows there are.
- `-TargetHours` = the day's `TARGET` from the GIORNO table. The helper prints:
  - `TOTALE` and `di cui LOGGABILE` (0h and internal rows excluded);
  - `NON FATTURATO`: internal minutes plus what rounding and the 0h rows dropped — said, never hidden;
  - `COPERTURA: <loggabile>h / <target>h - mancano <x>h`, flagged `sotto target` when more than 1h
    short: the trigger of the gap prompt.
- Minutes changed in the Table 1 loop → **re-round**; never correct hours by hand.
- A re-run of a day already in the audit: coverage counts this run's rows; the GIORNO `LOGGATO` says
  what the board already holds.
