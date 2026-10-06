---
name: worklog
description: >-
  Reconstruct the work done in a period from the transcripts and log the hours on Azure DevOps.
  Explicit trigger: only when the user types /worklog.
disable-model-invocation: true
---

# worklog — what was done, and the hours on Azure DevOps

**Language.** This skill's prose is English. Everything the user reads — chat, both tables, their
headers, the questions and the recap — is **Italian**, and so is everything written to the board:
task titles, descriptions, comments (work items are Italian, per the user's Language rule). Machine
text stays verbatim: field and state names, WIQL, engine output such as `Nessuna attivita'`.

## When

- The user types `/worklog`, with or without a period (default: today).
- What was done in a day or a range is needed, with time per topic.
- A period's hours have to land on the right work items.
- A period already logged is re-run: only the **delta** is applied.
- The reminder (`hooks/worklog-pending.js`, clock badge) lists **days never logged** in the current
  month, or week where it reaches back; close each with `/worklog <date>`, never older ones.
- **Project-management** time (client meetings and calls, backlog analysis and grooming, estimates,
  coordination) sits on no product item.

Not for: creating work items (`workitem-create`, including its session mode after a client
meeting), reading or analysing an item, reviewing a PR (`pr-review`), Azure DevOps CLI config, auth
and verbs (`azdo-cli`). Never fires without the explicit trigger.

## Decide

### 1. Fixed rules

| Rule | Detail |
| --- | --- |
| Italian | chat, tables and everything written on the board |
| Time comes **only from the engine** | never estimated by hand; splitting a bucket is said out loud |
| Nothing hardcoded | org, projects and items are discovered at runtime, every run |
| Two gates | Table 1 and Table 2: proceed only on explicit confirmation of each |
| `CompletedWork` is **cumulative** | read it, add the delta, write it back — never overwrite |
| Hours **already on the item** are reconciled, not ignored | hours the audit does not know (logged by hand, from the portal, by another tool) are shown in Table 2 and the user is **asked** whether they are the same work: their hours beat the estimate (`scrittura.md`, Phase 5 step 5) |
| Never leave an item in **New** | `Active` if work is ongoing, `Closed` if finished |
| Every day handled is **closed in the audit** | even one with nothing to log (leave, tooling only): an entry at `hoursLogged: 0`, after asking — otherwise the reminder flags it forever (`scrittura.md`) |

### 2. Phases

| Phase | What | Detail |
| --- | --- | --- |
| 1. Period | natural-language argument → concrete `From`/`To` (`yyyy-MM-dd`); ambiguous → **ask** | `tempo-e-topic.md` |
| 2. Extraction | `worklog.ps1` gives active minutes per project/branch and writes the raw digest | `tempo-e-topic.md` |
| 3. Topics and hours | topic from the branch, a role per topic, then `round.ps1` rounds and merges | `tempo-e-topic.md` |
| 4. Table 1 | activity summary + confirm/edit loop | `tabelle.md` |
| 5. Discovery | per loggable topic: project, existing Task or parent to create it under, PRs and commits, delta | `scrittura.md` |
| 6. Table 2 | where the hours go + confirm/edit loop | `tabelle.md` |
| 7. Write | parallel agents on disjoint items, then the audit in sequence and a verified recap | `scrittura.md` |

### 3. Discovery and writes — CLI first

The Azure DevOps CLI is the **first move** for all of Phase 5 and every write in Phase 7; config,
auth, org/project resolution, WIQL and the boards/repos verbs belong to `azdo-cli`.

| Needed | Source |
| --- | --- |
| the project | the workspace→project mapping in the user instructions, else ask |
| the topic's Task or backlog item | WIQL by assignee, branch, area or topic keyword |
| hours currently on the Task | read the work item (needed for the delta) |
| hours, state, assignee, new Tasks under a backlog item | boards verbs |
| PR ↔ work item link | repos verbs — the real link, never a URL in the text |
| anything the CLI seems not to reach | the gap list in `azdo-cli` `mcp-fallback.md` decides |

A topic that could sit on different orgs and cannot be derived → **ask**. The recap always states
the project and the interface used (CLI, or the MCP fallback and why).

### 4. Two cases: development hours and management hours

Hours are written **only here** — no other asset logs them. The split is whether the topic is
**attributable to a product item**:

| Case | When | Where the hours go |
| --- | --- | --- |
| **Development** | the topic is product work: a branch, commits, a PR or a work item covers it | the **Task** of the item worked on — Phases 5-7, `scrittura.md` |
| **Project management** | attributable to no product item: client meetings and calls, backlog grooming, estimates, coordination, `/workitem-create` session-mode runs | the fixed per-engagement structure: Feature `Gestione progetto` → PBI `Gestione progetto - <Epic title>` → **one Task per session**, `Done` — `ore-gestione.md` |

An `internal` topic (tooling, not billable) is **not** management: its own row, never logged. In
doubt → **ask**; never spread management hours onto a product item to make the numbers add up.
Tasks created or updated here exist **only for time**: a PR never links a Task, it links the parent
item (`pr-create`).

## Do

```powershell
# Phase 2 — the engine, the only source of the numbers. Empty = today; also accepts 'ieri'/'yesterday'.
pwsh -NoProfile -File "$HOME\.claude\skills\worklog\worklog.ps1" -From "<yyyy-MM-dd>" -To "<yyyy-MM-dd>"
```

Stdout gives project → branch, active minutes, time window and prompt count, plus the path of the
**raw digest** and of the **audit**. The engine prunes digests older than 7 days, the audit **never**.
`Nessuna attivita'` → report it and stop. Otherwise **read the digest** (`_raw/<period>.md`) for
topics, descriptions and decisions; open the original transcripts only for a missing detail.

```powershell
# Phase 3 — rounding + merging: ALL topics in a single invocation
pwsh -NoProfile -File "$HOME\.claude\skills\worklog\round.ps1" `
  "80|import nuovi mercati|main" "4|fix seed|donor" "7|fix proc|keep" "8|tooling worklog|internal"
```

Entry format `minutes|short-label|role` (the label is Italian: it seeds the Task title). The helper
spreads `donor` over `main`, lifts `keep` to at least 0.5h, leaves `internal` alone, and prints the
total and the **loggable** share.

```powershell
git -C "<project-path>" log --since=<From> --until=<To+1d> --author=(git config user.email) --oneline
```

The commits on the default branch relevant to a topic, for the Phase 5 link.

## Traps

1. Hours double → `CompletedWork` overwritten instead of added → read, add the delta, write back;
   the audit says how much was already written for that period.
2. Hours double anyway, while adding → the item had hours **logged by hand** the audit does not
   know, and the delta stayed the full estimate → reconcile item and audit (Phase 5 step 5) and ask: same
   work → the user's hours win and the delta is 0.
3. A re-run of the same period rewrites everything → the audit was not consulted → look up
   `(periodFrom, periodTo, itemId)` and apply only the delta; delta 0 → leave the hours alone.
4. Hours logged on a backlog item → hours go on **Tasks** → no Task: create it under the item.
5. A new item stays in `New` → the type starts there → correct the state right after creating it.
6. Time does not match memory → gaps over 15 min are breaks by definition → it is an indicative
   estimate; fix it in the Table 1 loop, never by inventing minutes.
7. Work on the default branch vanishes → it has no branch topic → split it into semantic topics from
   the digest and **say** the split is an estimate.
8. Two agents write the same item → overlapping batches in Phase 7 → disjoint items per agent; only
   the orchestrator writes the audit, in sequence.
9. The recap claims things the board does not show → the agents' reports were trusted → read the
   written items back before printing the recap.
10. A second management Task appears for the same day → a re-run created instead of applying the
    delta → look up the audit entry and the Task with the same date prefix, then add the delta.
11. The reminder keeps flagging a day already handled → the session closed without an audit entry
    (or the day was leave only) → the audit is the only criterion: write the entry, at zero hours if
    nothing was loggable.

## References

- `tempo-e-topic.md` — period, engine and digest, active time, topics, the four roles, `round.ps1`.
- `tabelle.md` — the shape of Table 1 and 2, link format, confirm/edit loops, the final recap.
- `scrittura.md` — discovery per topic, writes on Azure DevOps, reconciliation, idempotence, audit.
- `ore-gestione.md` — management hours: the fixed Feature/PBI, the title prefix, one Task per
  session, state Done.
