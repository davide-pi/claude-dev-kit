# Standing rules

## Route
| Request | Owner |
| --- | --- |
| code change: bug, failing test, perf, refactor, migration, feature, spike | `deliver` |
| question, explanation, review of an existing diff | answer, `investigator`, `/code-review`: never `deliver` |
| work item to build | `azdo-cli` read, `plan-work` readiness, `deliver` |
| subsystem, 5+ files, new interface | `plan-work`, then `deliver` |
| attack a design | `grill-me` |
| commit, PR, ship | `branch-flow`, `/commit`, `pr-create` |

1. Ask only before the irreversible: data, deploy, money, deletes. Else the approach in one line, then go;
   a shared contract (API, event, schema) -> agree the interface first.
2. CLI before MCP: `az`, `gh`; `azdo-*` MCP only for a proven gap (`azdo-cli`).
3. ALM target (org, project, az identity) = the `ALM:` session line, passed explicitly, never the
   `az devops configure` default. No line, unmapped, or an added dir -> ask.
4. Fan-out searches, wide reads -> `Explore`. Briefs ask for concise reports.
5. Reviews (`/code-review`, ad-hoc) run in subagents; `/security-review` only when I name it.

Route, rules 1, 4: main session only; a subagent never invokes `deliver` or asks the user.

## Change scope
The smallest diff that fully satisfies the request, written well. No unrequested refactor, rename, reformat,
dependency bump or "while I'm here" fix. Remove only what your change made unused. Anything else: one row
each, then stop.

| # | Proposal | Reason | Risk |
| --- | --- | --- | --- |

Number rows `#P1`, `#P2`; stable all conversation. Risk: **high** behaviour, data, contract; **medium** local
logic, testable; **low** cosmetic.

## Language
- Chat: `language` setting (unset: English), agent reports too.
- Commit, pr, prComment, items, wiki: each per the `Lang:` line (none: en).
- English: code, comments, tests, tech docs, `CLAUDE.md`, plans, specs, kit assets.
- Verbatim: identifiers, commands, SQL, tool output, `file:line`, branches, `AB#<id>`, `Fixes #<n>`, ADO
  type/state/field names, `[Claude AI Review]`, `CONFIRMED`/`PLAUSIBLE`, `P1|P2|P3`, `S|M|L`.
- Chat `it`: `Verifica` `Livello|Comando|Riga che decide|Stato` `fatto` `non verificato: <motivo>`, `#|Proposta|Motivo|Rischio` alto|medio|basso

## Done means verified
Never claim done, fixed, passing, verified without a command run this turn (reading code or a report
isn't proof). A main-session edit reply opens with a `**Verification**` line, plain
`Level|Command|Deciding line|Status` table, no fence; Deciding line: verbatim output. Status: `done`, `not verified: <reason>`
(Command: how to check), `failed` (quoted).

## Search, no prompts
A command starts with the program: `grep -rn x <abs-path>`, `git -C <path> log`; `cd X && ...` always prompts.
