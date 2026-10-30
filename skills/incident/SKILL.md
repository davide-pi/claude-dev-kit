---
name: incident
description: >-
  Use when a symptom in a running environment has an unknown cause, needing logs, DB and code together:
  "analizza cosa è successo in prod", "indaga l'ordine 4711". Not one log or DB read, code, tests.
argument-hint: "\"<symptom>\" [--since <dur> | --from <ts> --to <ts>] [--id <corr>…] [--env <env>] [--repo <root>…] [--item AB#<id>] [--slack <link>]"
---

# incident — the whole picture of an incident, gathered in parallel, analysed once

**Contract.** One synthesis built from parallel evidence packs: a single timeline, the gaps, 2–3 ranked
hypotheses each with the probe that decides it · never edits code, writes data or fixes anything (the fix
goes through `debug-systematic`, then `deliver`) · prose in the chat language; log lines, SQL, ids,
`file:line` verbatim.

Arguments: `$ARGUMENTS` — none when the skill loaded on its own: take the symptom, window, ids and
environment from the user's message.

## When

- The user asks to analyse or investigate something that happened, or keeps happening, in a running
  environment (local stack, staging, prod) and its evidence is not yet gathered: an error report, a wrong
  value a user saw, a stuck or missing flow, "ieri alle 15 è esploso". Typed or not as `/incident`.

Not for: a question or analysis of code with no runtime symptom (answer, `investigator`); a failing local
test or a bug already reproduced on demand (`debug-systematic`); one query (`/db`) or one log read (`/logs`),
even with a time; a slow or leaking process to measure (`dotnet-diagnostics`); a review (`/code-review`).

## Decide

### 1. Pre-flight — main session, at most 4 reads, no subagent

| Source | Read when | How |
| --- | --- | --- |
| work item | an `AB#` or item id is given | `azdo-cli` read, on the `ALM:` target |
| Slack thread | a link is given | the Slack connector, that thread only |
| recent commits | a repo root is known | `git -C <root> log --since=<window start - 2d> --oneline` |
| recent deploys | the symptom has a start time | `az pipelines runs list --top 10` on the `ALM:` target |

Then write the **case card** (`references/evidence-pack.md` § Card): symptom verbatim, window in UTC with
the offset, correlation ids, environment, services, repo roots, already ruled out. Roots: the arguments,
else the current repo and its sibling folders, each classed by `*.sln` / `angular.json` / `package.json`
within 3 levels; a side still unknown goes in the questions.

**Ask once, before the launch**, every doubt that would stop a collector: environment, which service,
the database target, the window when none is stated. Subagents cannot ask. A non-dev database: name the
target and say collectors only read; whether the credential is read-only is what `db-analyst` checks.

### 2. Collectors — one message, parallel Agent calls

| Collector | Launch when | Its focus |
| --- | --- | --- |
| `ops-analyst` | always | errors and their first occurrence in the window, by id; rate and latency in Grafana when reachable |
| `db-analyst` | the symptom involves persisted state (an entity, a status, a missing or double row) | the entities by id: current state, timestamps, related rows; `SELECT` only |
| `investigator` (backend) | a backend root is known | `locate` the owner of the failing behaviour, `trace` when it crosses the bus |
| `investigator` (frontend) | a frontend root is known, or the symptom is on screen | route → component → HTTP call → state, ending at the endpoint's verb + URL |

Rules:
1. Agent tool directly (`subagent_type` as named), never `/db` or `/logs`: those run in the foreground.
2. One `investigator` per root; never two on the same root.
3. Every brief = the card + the role section + the pack format (`references/evidence-pack.md`), and the
   budget: **≤ 18 tool calls for `investigator`, ≤ 22 for the others, then write the pack**.
4. A collector whose "launch when" is false is not launched; say which ones ran and why.

### 3. Synthesis — main session

From the packs only (`references/evidence-pack.md` § Synthesis):
1. **Timeline**: one list, joined on timestamp (normalised to UTC) and correlation id.
2. **Gaps first**: every *Not found* and *Blocked*, before any hypothesis; an empty result is not a healthy one.
3. **Path**: UI → API → bus → DB as the packs confirm it, the unconfirmed hops marked.
4. **2–3 hypotheses**, ranked, each with a falsifiable prediction and the one probe that decides it.
   The packs' readings are inputs, not conclusions.

Second round, at most one, only the collectors concerned:
- *Blocked* → ask the user for the missing input, then relaunch that collector. A grant list from
  `db-analyst` (exit 4) → ask once per target; on a yes, the brief names `-AcceptWriteGrant`. Exit 3 → no relaunch.
- a frontend pack names an endpoint and a backend root exists → relaunch the backend `investigator`
  with that verb + URL as the entry.

Main context over ~120k → the synthesis goes to a `general-purpose` subagent on Opus with the packs verbatim.

## Do

1. Pre-flight, the card, the questions in one message.
2. Launch the collectors in one message; wait for all of them.
3. Synthesis (second round if needed); show it, then ask whether to probe the top hypothesis.
4. The probe and the fix continue in `debug-systematic` (phase 2 onwards). A frontend symptom that needs
   the console or network → `browser-use`, in the main session, after the packs.

## Traps

1. A collector returns "nothing found" and the synthesis reads it as healthy → wrong filter, label or
   window → *Not found* lists what was searched; check it before trusting the silence.
2. Log, database and user clocks in different zones → events out of order → every pack states its zone,
   the card fixes UTC.
3. Launching on every "non funziona" → four agents for a typo → only with a runtime symptom; a code
   question stays a question.
4. Telling the user a prod database is "read-only" before `db-analyst` proved it → the credential may
   hold write grants → say "collectors only read"; the grant check is the agent's.

## References

- `references/evidence-pack.md` — before writing the briefs: the card, the role sections, the pack format,
  the synthesis skeleton.
