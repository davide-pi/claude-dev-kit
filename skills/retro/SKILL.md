---
name: retro
description: >-
  Use when the user types /retro: mines a session's or the last days' friction, proposes
  environment fixes and coaching advice, enforceable checks first. Proposes only.
argument-hint: "[session-id | current | days <n>] [focus | monthly | findings]"
disable-model-invocation: true
context: fork
agent: analyst
model: sonnet
background: false
---

# retro — friction in a session, turned into checks and pointers

**Contract.** One proposal row per event the mode admits, enforceable lessons as ready-to-file backlog
items · never edits a skill, hook, rule, setting or `CLAUDE.md`, never files the items itself ·
report in Italian; paths, tool names and quoted transcript lines verbatim, secrets as `<REDACTED>`.

Arguments: `$ARGUMENTS`

You start with no conversation history: the session you judge exists only as its transcript on
disk (the `findings` mode reads the deliver log instead). You cannot ask the user; the caller relays your report and asks which rows to apply.

## When

- After a session that went badly or slowly, to change the environment the next one runs in.

Not for: reviewing the code the session wrote (`/code-review`); a team or sprint retrospective; a
single correction the user already gave (it is one event, not a retro).

## Decide

### Which transcript

| First argument | File |
| --- | --- |
| `days <n>`, checked first: two tokens, `n` a whole number ≥ 1 (else 10, said in line 1); the focus follows | every main transcript modified in the last `n` days: `references/modes.md` |
| empty or `current` | `~/.claude/projects/*/${CLAUDE_SESSION_ID}.jsonl` |
| a session id | `~/.claude/projects/*/<id>.jsonl` |
| no match | the newest `*.jsonl` in the project folder whose name is the cwd with every non-alphanumeric character turned into `-`; say which file was read |

Subagent transcripts sit beside it under `<session-id>/subagents/`; read them only when an event
points there. State the file read (path, size) in the report.

### What each mode proposes

| Mode | Suite proposals | `Consigli per te` |
| --- | --- | --- |
| one session | only the **Automated check** row below, its `Proposta` cell ending `(da confermare nella retro a 10 giorni)`: one session is noise for anything else | yes, ≤ 3 |
| `days <n>` | every category, only for events recurring in 2+ sessions | yes, ≤ 5, patterns in 2+ sessions |
| `monthly` | environment health, only when the owner asks or the focus is `monthly`, never on your own: `references/modes.md` | no |
| `findings` | its section below | no |

### Friction events — what to collect

A long search · a mistake later corrected · the user repeating or correcting (turns opening "no") · a
failed, retried call · a permission prompt · a fact asked for · a huge output. Each keeps its turn.

### Where the fix lives — first matching row wins

| Category | The event | Fix |
| --- | --- | --- |
| **Automated check** | a mistake a deterministic rule would catch: a fixed pattern, a banned API or command, a file location, a missing flag | **a backlog item** for a hook, lint rule, CI step or `validate.mjs` check — never a sentence |
| Tool economy | an expensive or repeated call, a permission prompt | a narrower command, an allow rule, a script |
| Information access | a fact out of reach (logs, database, board, browser) | a read-only CLI, an agent that holds the access |
| Navigation | many reads to find one file or fact | a pointer in the project's `CLAUDE.md` or docs tree (`/docs-sync`) |
| Skill gap | the same decision re-made by hand, or a skill that did not fire | the skill or its description (`skill-forge`) |
| Review rule | a judgement-call mistake the reviewer let through | the reviewer's brief or a repo convention |
| Steering bloat | a `CLAUDE.md` or rule line that changed nothing, or that a check could enforce | delete it, or move it into the check |
| No-op | an instruction the model follows by default | delete the sentence |

Before proposing, grep what exists — `~/.claude/{skills,agents,hooks,rules}`, `~/.claude/CLAUDE.md`,
the repo's checks: an asset that did not fire, or a check left unwired, *is* the finding.

### Findings — implementer rules from the deliver log

Runs only when the focus argument is `findings` (the SessionStart nudge names `/retro current findings`): no transcript needed. Read
`$(git rev-parse --git-dir)/deliver/findings.jsonl` of the cwd (you derive the path; one JSON line per run, `{ "retro": … }` lines mark a settled
retro): the lines after the last marker, grouped by `category` and by `path`. Propose at most 5 lines for the implementer's rules
(`agents/implementer.md` or the repo's conventions), each with the findings that prove it (category, count, files); a line a
check could enforce is a backlog item, as above. The owner approves; after the yes the caller appends the marker `{"retro":"<date>"}`: the
report carries the exact command (Report, row 6).

### Report — returned to the caller, ≤ 40 lines (`days`: ≤ 60)

1. `Trascritto: <path> (<size>) · eventi: N · senza proposta: N (perché)`; in `findings` mode `Log: <path> · righe dopo l'ultimo retro: N`; in `days` mode the line of `references/modes.md`.
2. Proposals, most severe first, as a table `Proposta | Categoria | Evento (turno) | Dove | Rischio`;
   `Dove` is the file or asset; an automated check reads `backlog: <hook|lint|CI|validate>`.
3. `Backlog` — one block per automated check: Italian title · what the check matches and where it
   runs · the event that proves it · acceptance: the event's command or edit, replayed, is caught.
4. `Consigli per te`, in the session and `days` modes: the table of `references/modes.md`.
5. When `monthly` ran: `Salute: <outcome, one line per step>`.
6. `findings` mode only: the line for the caller, the command that appends the marker after the owner's yes: `Add-Content -Path "$(git rev-parse --git-dir)/deliver/findings.jsonl" -Value '{"retro":"<date>"}'`.
7. Last line: `Quali righe applico? Le voci di backlog le apre il chiamante dopo il tuo sì.`

## Do

```powershell
$t = Get-ChildItem "$HOME/.claude/projects" -Recurse -Filter "<session-id>.jsonl" | Select-Object -First 1
"{0} ({1:N0} KB)" -f $t.FullName, ($t.Length / 1KB)
```

Never read the whole transcript at once: Grep it for `"is_error":true`, `"tool_use"`, permission
denials and user turns, then Read slices around each hit (`offset`/`limit`).

## Traps

1. A lesson written as a `CLAUDE.md` line when a regex could catch it → ignored again → backlog item.
2. A proposal with no event behind it → opinion → drop it.
3. A retro that only adds lines → the next session pays for them every turn → prefer deleting.
4. A quoted line carrying a token or connection string → `<REDACTED>`.

## References

- `references/modes.md` — the arguments read `days <n>` or `monthly`, or any mode that carries `Consigli per te`:
  the period's transcripts, the coaching patterns and limits, the health steps.
