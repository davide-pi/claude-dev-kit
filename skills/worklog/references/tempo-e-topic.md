# Period, time, topics and rounding

## Phase 1 — the period

The argument is natural language and must become two concrete dates (`yyyy-MM-dd`) before the
engine runs (a `sessione <id>` with no period is the one exception, last row):

| Argument | `From` / `To` |
| --- | --- |
| empty | today / today |
| `ieri`, `yesterday` | the day before |
| `yyyy-MM-dd` | that day |
| `yyyy-MM-dd..yyyy-MM-dd` | the two ends |
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
subagents — and never touches Azure DevOps. Two kinds of minutes:

| Kind | What it is | Rule |
| --- | --- | --- |
| `CLAUDE` | Claude at work | per session, the union of its turns (`turn_duration`) and its subagents' activity (events ≤ 15 min apart, `-IdleMinutes`, or a longer gap spanned by one tool call of that subagent, up to `-MaxSpanMinutes`); a turn with no `turn_duration` (interrupted) runs from its prompt to the last reply before the next prompt; **summed** across sessions; background jobs (dev servers) never count |
| `TU` | the user writing and reading | after each busy interval of a session, up to 15 min (`-MarginMinutes`) or until that session's next busy start or prompt; **counted once**: the union over all sessions, minus every session's busy time, each minute to the topic of the session whose busy interval ended last |

Minutes inside 08:00-20:00 (`-DayStart`, `-DayEnd`) are the normal ones: `TOTALE` = `CLAUDE` + `TU`.
Minutes outside go to `FUORI`, never dropped. A resumed transcript copies earlier messages: those
count once, and a resume joins the original session (a fork running in parallel stays a separate
one). Who the original is: the file that starts first; on a tie, the chain created first (a chain follows
the `continued-in` lines; a file in no chain is its own chain), then the original before its resume inside
the chain, then the file created first. Limit: only some resumes leave a `continued-in` line (none for a
plain `--resume` or a fork), and the creation time is unreliable after a copy, sync or restore, so the head
of a fork can land on the wrong file. A minute goes to the topic (project + branch) the session's events say at that moment and to
its local **day**.

Example: chat 1 works 10:00-11:00, chat 2 works 10:30-11:30, the user reads 15 min after each →
`CLAUDE` 2h (summed), `TU` 15m (only 11:30-11:45: 11:00-11:15 is covered by chat 2 working),
`TOTALE` 2h15m.

Stdout, the authoritative numbers:

- header: `CLAUDE`, `TU`, `TOTALE` and `FUORI` for the period;
- project → branch: the same four columns, time window, prompt count;
- **GIORNO** table, one row per day: `CLAUDE`, `TU`, `TOTALE`, `FUORI`, `TARGET`, `LOGGATO` (already in
  the audit; a multi-day entry split evenly over its weekdays), `MANCANO` (target − logged);
- **Attese lunghe**: every turn above 120 minutes (`-MaxSpanMinutes`), counted in `CLAUDE` (a subagent tool call that long counts up to the limit). A
  permission prompt left pending over lunch looks exactly like a long build: show them in Table 1 and
  let the user drop them;
- the paths of the raw digest, the audit and `targets.json`.

**`-SessionId <id>`** (case-insensitive; the scoped run `sessione <id>`): a selection; the totals and the
topic minutes of the run do not change. A **Sessione** section lists each (day,
project / branch) with at least one main-session event of that session and the session's **own**
`CLAUDE` + `TU` minutes there (`FUORI` apart); the digest marks those topics `sessione: si` and the session's own lines `[S]`. Keep
only those topics in Phases 3-7. A topic flagged `[anche altre sessioni]` (typically the default branch)
holds other chats' work too: the minutes listed are the chat's share, but the topic's whole-day
minutes are not, so never log the topic whole unasked — ask in Table 2 which item(s) it belongs to,
telling the chat's share from the `[S]` lines.
Without `-From` the engine finds the session's first day itself (first event of its transcript) and runs to today, printing `Sessione <id>: dal <data>`.
`nessun evento` → the id is not in the period: say so, ask for the right period or id (do not go to the gap prompt).

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
  what the board already holds, and the push writes only the delta.
