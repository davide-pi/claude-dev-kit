# Period, time, topics and rounding

## Phase 1 — the period

The trigger's argument is natural language and must become two concrete dates (`yyyy-MM-dd`)
before the engine runs:

| Argument | `From` / `To` |
| --- | --- |
| empty | today / today |
| `ieri`, `yesterday` | the day before |
| `yyyy-MM-dd` | that day |
| `yyyy-MM-dd..yyyy-MM-dd` | the two ends |
| "questa settimana", "settimana scorsa", "ultimi N giorni", "10-15 lug" | compute the ends from today's date |

Still ambiguous ("la settimana" without knowing which) → **ask** first: a wrong period puts hours
on the wrong work item.

## Phase 2 — the engine

```powershell
pwsh -NoProfile -File "$HOME\.claude\skills\worklog\worklog.ps1" -From "<yyyy-MM-dd>" -To "<yyyy-MM-dd>"
```

What it does, exactly:

- reads the **main** Claude Code transcript sessions (subagents and sidechains excluded);
- filters events in the range and attributes them to `(project, branch)` on one global timeline;
- **active time** = the sum of intervals between consecutive events within the idle threshold
  (default 15 minutes). Longer intervals — nights between the days of a range included — are breaks
  and do not count;
- prints the authoritative metrics on stdout: per project and per branch, active minutes, time
  window and prompt count;
- writes the **raw digest** to `_raw/<period>.md` under the skill's working folder and prints its
  path, together with the **audit** path (`pushed.json`);
- runs **retention** at launch: it prunes **only digests** older than the retention window (default
  7 days). There is no scheduler; cleanup happens only here. The **audit is never pruned**: it is the
  only memory of which periods already reached the board, and the unlogged-days reminder depends on
  it (`scrittura.md`, "The closed day").

Optional parameters beyond `-From`/`-To`: projects root, output folder, idle threshold, retention
days and the digest truncation limits. Leave them alone without a reason.

The engine writes **no** tables and **never** touches Azure DevOps: that is the skill's job.

`Nessuna attivita'` on stdout → report it and stop. Otherwise **read the digest**: project → branch
→ timeline of prompts and replies. It is the material topics, descriptions and decisions come from;
open the original transcripts only for a missing detail.

## Phase 3 — topics and roles

**The topic comes from the git branch.** A `feature/*`, `fix/*` or `bugfix/*` branch is a topic:
give it a human name, in Italian. Work on the default branch, `HEAD` or no branch has no branch
topic → **split it into one or more semantic topics** from the digest and spread its minutes by a
reasonable estimate, **saying so** in chat. Topics normally stay per project; one crosses two only
when it is clearly the same work.

Each topic gets a **role**, which decides how it rounds:

| Role | When | Effect |
| --- | --- | --- |
| `main` | a real topic, time >= ~15 min | receives the donors' redistribution, rounds normally |
| `donor` | a micro-topic (< ~15 min) of client work **without** its own item | its minutes go into a pool spread **evenly** over the `main` topics; the topic disappears from the table |
| `keep` | a micro-topic **with** its own item, or otherwise worth keeping | stays a row, lifted to **at least 0.5h** so it gets logged |
| `internal` | internal / non-billable time (e.g. tooling work) | its own row, rounds normally (may give 0h), **neither** receives the pool **nor** is spread |

Certainty about the item comes in Phase 5: classify by judgement here, re-check in discovery. An
`internal` topic becomes `donor` only when the user explicitly asks.

## Rounding

```powershell
pwsh -NoProfile -File "$HOME\.claude\skills\worklog\round.ps1" `
  "80|import nuovi mercati|main" "4|fix seed|donor" "7|fix proc|keep" "8|tooling worklog|internal"
```

- Entry format: `minutes|label|role`; the role is optional and defaults to `main`. The label is
  Italian — it seeds the short description and the Task title.
- **Nearest-0.5h per topic, independently**, **no cap**: the total is the real sum of the results,
  not a forced number. 45 minutes give 1.0h (a tie rounds away from zero, not down); under ~15
  minutes rounds to **0h**.
- The helper spreads the `donor` topics, lifts `keep` to 0.5h, leaves `internal` alone, and prints
  two totals: all rows, and the **loggable** share (0h and internal excluded).
- Pass **all** topics in **one** invocation: the redistribution depends on how many `main` topics
  there are, so separate invocations give different, wrong numbers.
- `donor` topics with no `main` → the helper warns and treats them as `keep`.
- Minutes changed in the Table 1 loop → **re-round**; never correct hours by hand.
