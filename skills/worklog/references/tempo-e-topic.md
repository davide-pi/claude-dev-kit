# Period, time, topics and rounding

## Phase 1 — the period

The argument is natural language and must become two concrete dates (`yyyy-MM-dd`) before the
engine runs:

| Argument | `From` / `To` |
| --- | --- |
| empty | today / today |
| `ieri`, `yesterday` | the day before |
| `yyyy-MM-dd` | that day |
| `yyyy-MM-dd..yyyy-MM-dd` | the two ends |
| "questa settimana", "settimana scorsa", "ultimi N giorni", "10-15 lug" | compute the ends from today's date |

Still ambiguous → **ask**: a wrong period puts hours on the wrong item. A range runs the engine
**once**, then Phases 3-4 go **day by day**: coverage is a per-day fact, and per-day audit entries are
what the reminder reads.

## Phase 2 — the engine

```powershell
pwsh -NoProfile -File "$HOME\.claude\skills\worklog\worklog.ps1" -From "<yyyy-MM-dd>" -To "<yyyy-MM-dd>"
```

Reads every transcript under `~/.claude/projects` touched in the period — main sessions **and**
subagents — and never touches Azure DevOps. A gap between two consecutive main-session events is:

| Gap | Active when | Counted as |
| --- | --- | --- |
| ≤ 15 min (`-IdleMinutes`) | always | base |
| ≤ 45 min (`-HardPauseMinutes`) | anything in flight spans it: a tool call, a subagent, a background job, a turn | wait |
| ≤ 45 min | the next event is on the **same topic** (project + branch) | continuity |
| ≤ 20 min (`-SwitchMinutes`) | the topic changes | continuity |
| 45-120 min (`-MaxSpanMinutes`) | a **foreground** tool call or a **working subagent** spans it — not a background job (dev servers live there), not a bare turn | wait |
| longer | never | pause |

Parallel sessions share one timeline, so wall-clock time counts once. Each interval goes to the topic
and the **day** of the event that opens it.

Stdout, the authoritative numbers:

- header: total active time and how much of it the waits and the continuity **recovered** over the
  old fixed 15-minute threshold;
- project → branch: active minutes, time window, prompt count;
- **GIORNO** table, one row per day: `ATTIVO`, `RECUPERATI`, `TARGET`, `LOGGATO` (already in the
  audit; a multi-day entry split evenly over its weekdays), `MANCANO` (target − logged);
- **Attese lunghe**: every wait above 45 minutes counted active. A permission prompt left pending
  over lunch looks exactly like a long build: show them in Table 1 and let the user drop them;
- the paths of the raw digest, the audit and `targets.json`.

**`-SessionId <id>`** (case-insensitive; the scoped run `sessione <id>`): only a selection. Timeline,
active time and topic minutes are the global ones, parallel sessions counted once — the session's own
minutes are never computed, they would double-count parallel chats and re-runs. A **Sessione** section
lists each (day, project / branch) with at least one main-session event of that session and the topic's
whole-day minutes; the digest marks those topics `sessione: si` and the session's own lines `[S]`. Keep
only those topics in Phases 3-7. A topic flagged `[anche altre sessioni]` (typically the default branch)
holds other chats' work too: its minutes are not the chat's alone, so never log it whole unasked — ask in
Table 2 which item(s) it belongs to, telling the chat's share from the `[S]` lines.
`nessun evento` → the id is not in the period: say so, ask for the right period or id.

**Targets**: `~/.claude/worklog/targets.json` — `{ "targetHours": 8, "days": { "<yyyy-MM-dd>": { "hours": 6, "note": "corso 4h + straordinario 2h" } } }`.
Missing file or date → `targetHours` Monday-Friday, 0 at weekends. Only `worklog-push.ps1` writes it
(a `target` row, `scrittura.md`); the user may edit it by hand for a known event.

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

```powershell
pwsh -NoProfile -File "$HOME\.claude\skills\worklog\round.ps1" -TargetHours 8 `
  "80|import nuovi mercati|main" "4|fix seed|donor" "7|fix proc|keep" "40|tooling worklog|internal"
```

- Entry `minutes|label|role`, role default `main`; the Italian label seeds the Task title.
- **Nearest 0.5h per topic**, no cap: 45 min → 1.0h (ties away from zero), under ~15 min → 0h.
- **All of one day's topics in one call**: the donor spread depends on how many `main` rows there are.
- `-TargetHours` = the day's `TARGET` from the GIORNO table. The helper prints:
  - `TOTALE` and `di cui LOGGABILE` (0h and internal rows excluded);
  - `NON FATTURATO`: internal minutes plus what rounding and the 0h rows dropped — said, never hidden;
  - `COPERTURA: <loggabile>h / <target>h - mancano <x>h`, flagged `sotto target` when more than 1h
    short: the trigger of the gap prompt.
- Minutes changed in the Table 1 loop → **re-round**; never correct hours by hand.
- A re-run of a day already in the audit: coverage counts this run's rows; the GIORNO `LOGGATO` says
  what the board already holds, and the push writes only the delta.
