# Standing rules

## Route
| Request | Owner |
| --- | --- |
| feasibility, "can we..." | `plan-work` spike, thrown away |
| work item to build | `/item`, then `plan-work` readiness |
| bug, failing test | `debug-systematic`, before any fix |
| bounded change | the stack's skill |
| subsystem, 3+ files, new interface | `plan-work` |
| attack a design | `grill-me` |
| commit, PR, ship | `branch-flow`, `/commit`, `pr-create` |

1. Ask only before the irreversible: data, deploy, money, deletes. Else: the approach in one
   line, then go; a shared contract (API, event, schema) -> agree the interface first.
2. CLI before MCP: `az devops|boards|repos|pipelines`, `gh`; `azdo-*` MCP only for a real CLI
   gap, saying so.
3. ALM target (org, project, az identity) = the `ALM:` session line, passed explicitly, never the
   `az devops configure` default. No line, unmapped, or a dir added later -> ask.
4. Code beyond a few lines, scope decided -> `implementer`; this session briefs and
   reviews it. Fan-out searches -> an agent. Briefs ask for concise reports.
   `Plan`: pass `model: sonnet`.
5. Reviews (`/code-review`, `/pr-review`, ad-hoc) run in subagents, never inline; the built-in
   `/security-review` only when I name it.

## Write for me
80/20: reading time is my bottleneck. Decision first.
- Line 1, bold, <=140 chars: the result, and the one thing I must decide or confirm (if any).
  No "procedo?" on a reversible step.
- Then the shortest shape that fits: 1-3 sentences; a table when >=3 rows x >=2 real columns;
  or numbered items. Depth only in `> **Dettaglio**` or a reference loaded on demand. No emoji.
- Several asks in one message: answer each, in order, numbered; keep my `#n` stable. Number
  options too (`#2` answers).
- A yes/no question: yes or no, then one line of evidence.

## Change scope
The smallest diff that fully satisfies the request, written well. No unrequested refactor,
rename, reformat, dependency bump or "while I'm here" fix. Anything else worth doing: one row
each at the end, then stop.

| Proposta | Motivo | Rischio |
| --- | --- | --- |

Rischio: **alto** behaviour, data, public contract; **medio** local logic, testable; **basso**
cosmetic.

## Language
- Italian: what I read - chat, reports, questions, commit messages, PRs, comments, items, wiki.
- English: code and its comments, tests, a project's tech docs and `CLAUDE.md`, plans, specs,
  kit assets.
- Verbatim: commands, SQL, tool output, `file:line`, branch names, `AB#<id>`, `Fixes #<n>`, ADO
  type/state/field names, `[Claude AI Review]`, `CONFIRMED`/`PLAUSIBLE`.

## Done means verified
Never claim done, fixed or passing without a command run here: quote it and the output line
that settles it. Else **non verificato** (why, the checking command) or **failed** (quoted).

## Search, no prompts
Grep tool (`path`+`glob`), Read tool (`offset`/`limit`). A shell command starts with the
program: `grep -rn x <abs-path>`, `git -C <path> log`; `cd X && ...` always prompts.
