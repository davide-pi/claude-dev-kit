# claude-dev-kit v3 — Rewrite briefs (batches 3–5)

Companion to `2026-10-21-kit-v3-design.md`. One brief per asset so an implementer can rewrite it without re-deriving
the design. Every brief has the same four fields. Shared rules first; they are not repeated per asset.

## Shared contract (applies to every skill and agent)

| Rule | Value |
| --- | --- |
| Contract line | line 1 after the title: `**Contract.** <what it produces> · <what it never does> · <output language>` — one line, bold label, before `## When` |
| Description | ≤ 25 words, third person, opens with `Use when …` (directive) then the trigger terms a user types; never a content summary; no `paths` on skills until the batch-4 smoke test passes |
| Body shape | `# name — purpose` · contract line · `## When` (bullets + `Not for:` line) · `## Decide` (tables/trees) · `## Do` (PowerShell, real flags) · `## Traps` (symptom → cause → fix, one line each) · `## References` (file + the condition that sends you there) |
| Size | SKILL.md ≤ 120 lines (cap lowered from 150; the validator enforces 120 from batch 4, skill-forge states it); reference ≤ 200 lines, one topic; agent body ≤ 110 lines |
| Phrasing | outcome, not procedure, wherever the model already knows how ("the PR body names every deployable" not "step 1: list files, step 2: …"); keep the procedure only where the house way differs from the default |
| Drop everywhere | restated CLAUDE.md rules (language, 80/20, change scope), version numbers, "Language." paragraphs longer than one line, Traps that restate a Decide row, prose explaining why a rule exists when a table row already says it |
| Agents | body = role (2 lines) · ground rules (hard, ≤ 6 bullets) · method (tables) · **output contract** (exact shape, ≤ N lines, Italian prose, verbatim identifiers) · "never" list; no `memory` unless the agent has Write/Edit; `maxTurns` advisory |
| Compaction | skill bodies re-inject capped at 5 k tokens, truncated from the bottom: the Decide section must sit in the first 5 k tokens; nothing load-bearing after `## Do` |
| Validate | `node tools/validate.mjs` (caps, description words, identity), `claude plugin validate ~/.claude/skills` (frontmatter parses), eval cases MUST/MUST NOT + `/name` smoke test for user-invoked skills |

## Batch 3 — CLAUDE.md, rules, hooks

| Asset | Contract | Must contain | Must drop | Target |
| --- | --- | --- | --- | --- |
| `CLAUDE.md` | user-level standing instructions, ≤ 2,700 B | routing table (7 rows: feasibility→plan-work spike · work item→`/item` then plan-work · bug→debug-systematic · bounded change→domain skill · subsystem→plan-work · design attack→grill-me · commit/PR→branch-flow, `/commit`, pr-create); gate line "ask only before the irreversible: data, deploy, money, deletes"; reviews in subagents never inline; implementer for code beyond a few lines; ALM target = the `ALM:` session line, else ask; write-for-me (3 lines); change scope + Proposta table header (4 lines); language (3 lines); done = command run and output quoted (2 lines); search with Grep/Read, shell commands start with the program (2 lines) | system preferences; review model-selection; review output format; workspace map; worktree root; ALM rules table; "start at dev-loop"; anything a hook now enforces | ≤ 60 lines |
| `rules/*.md` (10) | facts loaded on touch, never standing rules | frontmatter `paths: "a,b"` (comma **string**, not YAML list — list form was ignored on earlier versions); ≤ 25 lines; facts + gotchas only; a pointer line "procedure: skill `<name>`" | procedures, examples longer than one line, anything that must survive compaction (paths rules are summarised away) | ≤ 25 lines each |
| `workspace-context.js` | SessionStart (matcher `startup\|resume\|clear\|compact`) → one `ALM:` line on stdout + env file | reads `~/.claude/workspaces.json` (root → platform, org, identity, project or subfolder map or `ask`); longest-prefix match on `cwd`; writes `AZURE_CONFIG_DIR`/`AZ_IDENTITY` to `CLAUDE_ENV_FILE` only when the dir exists; stdout: `ALM: Azure DevOps · org <x> · project <y> · az identity <z>` or `ALM: non mappato — chiedi`; silent on error, exit 0 | network, `az` calls, hardcoded roots | ≤ 90 lines + tests |
| `session-brief.js` | unchanged logic | matcher gains `compact` so the brief returns after `/compact` | — | — |
| `tools/instructions-log.js` (dev only) | `InstructionsLoaded` hook that appends `{file, load_reason}` to `~/.claude/.cache/instructions.log` | used only during batch 3/4 verification; wired in `settings.local.json` of the kit repo, not the template | — | ≤ 30 lines |

## Batch 4 — Skills

Step 0 of the batch (before any `paths` edit), headless smoke test:

```powershell
$t = New-Item -ItemType Directory -Path (Join-Path $env:TEMP "paths-probe") -Force
New-Item -ItemType Directory -Path "$t\.claude\skills\probe-cs","$t\src" -Force | Out-Null
Set-Content "$t\.claude\skills\probe-cs\SKILL.md" "---`nname: probe-cs`ndescription: Use when a C# file is read. Probe skill.`npaths: `"**/*.cs`"`n---`n# probe-cs`nPROBE-TOKEN-7731 is the marker."
# second probe, UNQUOTED glob (quoting artefacts were reported: unquoted sometimes registers where quoted does not)
New-Item -ItemType Directory -Path "$t\.claude\skills\probe-ts" -Force | Out-Null
Set-Content "$t\.claude\skills\probe-ts\SKILL.md" "---`nname: probe-ts`ndescription: Use when a TypeScript file is read. Probe skill.`npaths: **/*.ts`n---`n# probe-ts`nPROBE-TOKEN-4410 is the marker."
Set-Content "$t\src\Foo.cs" "class Foo {}"; Set-Content "$t\src\foo.ts" "export const x = 1;"
Set-Location $t
claude -p "List every skill name available to you, one per line, nothing else."            # expect: probe-cs, probe-ts listed
claude -p "Read src/Foo.cs, then answer only with the marker token from any skill that loaded, or NONE."  # expect: PROBE-TOKEN-7731
claude -p "Read src/foo.ts, then answer only with the marker token from any skill that loaded, or NONE."  # expect: PROBE-TOKEN-4410
```

Both forms pass → `paths` on the nine domain skills, in the form that passed (if only one form passes, use that form
and the validator enforces it). Listing fails but Read passes → `paths` + keep trigger terms in the
description. Read fails → **fallback ladder**: (a) the facts are already in `rules/*.md`; (b) `hooks/skill-on-path.js`
(PreToolUse `Read|Edit|Write`): globs `tool_input.file_path`, returns `additionalContext: "File type owned by skill
<name>: load it with the Skill tool before changing the file"`; (c) description with file-type keywords and no `paths`.
`validate.mjs` warns on skill `paths` until a `PATHS_OK=1` marker file exists in `tools/`.

Second check of the batch: `context: fork` + `background: false` with fork mode on (2.1.302+): run `/db "SELECT 1"` and
confirm the result arrives in the same turn; if it arrives as a background notification, set
`CLAUDE_CODE_FORK_SUBAGENT=0` in the template env and note it in §11.

| Skill | Contract | Must contain | Must drop | Target |
| --- | --- | --- | --- | --- |
| plan-work | plan file (English) with verifiable tasks; never writes code | "is a plan worth writing" table; task fields table; size table; where the file lives; **spike** section (claim, cheapest instrument, timebox, throwaway) and **delegation** section (independence test, brief = files + change + verify + output cap "≤ 30 lines, table", never delegate: irreversible steps, the gate decision) absorbed from dev-loop | the from-work-item readiness verdict duplicated in prose (reference keeps it); Traps 1,3,7 (restate Decide) | 110 lines; refs: `from-work-item`, `plan-template`, `spike`, `delegation` |
| debug-systematic | repro → isolate → explain → fix; no production edit before phase 3 | the four phases table; hypotheses rule (3–5, falsifiable, shown not blocking); symptom → instrument table (keep, it is the skill); "three wrong hypotheses" rule | the Language paragraph; Traps 2, 7 (generic) | 100 lines |
| grill-me | interview until the frontier is empty; builds nothing | frontmatter `disable-model-invocation: true`; frontier table; AskUserQuestion field table; Decision Summary shape | the printed-fallback block (one line: "tool unavailable → numbered questions, recommended answer first") | 80 lines |
| skill-forge | the kit's contract as a procedure; `paths` on the kit's own files once the smoke test passes | shape table; the shared contract above (as the normative copy); description craft: directive opener, ≤ 25 words, triggers first, third person; outcome phrasing rule; fork skills are self-contained (no history); `model:` on a non-fork skill = cache miss; listing budget facts (1 % of window, 1,536-char cap, least-used dropped first; `/doctor`, `/skill-doctor`) | the plugin comparison prose; Traps 5, 7, 12 | 120 lines; refs: `asset-templates` (frontmatter fields incl. `paths`, `context`, `agent`, `background`, `memory`, `maxTurns`, `omitClaudeMd`), `description-craft` (+ the activation study as secondhand), `writing-for-agents` |
| branch-flow | branch, isolate, finish; never merges without green gates | platform table; prefix table; isolate table with the worktree root (`CLAUDE_WORKTREE_ROOT`, native path via hook, git fallback); finish menu | the two-language paragraph (contract line covers it); Traps 1, 3 (same fix) | 100 lines |
| pr-create | PR with Italian title/body, `Rilascio:` block, parent item linked; never merges | the precondition "parent backlog item, never a Task" (hook `alm-contract.js` enforces `--work-items` and squash flags: say so, drop the warning prose); `Rilascio:` rule; body-as-file | Traps 1, 2, 8, 9 (now hook-enforced or in Decide) | 100 lines |
| pr-review | `/pr-review [target] [effort] [focus]`; posts only questions; never approves | golden rules table; §5 two-model ladder (reviewer A sonnet, reviewer B session family, same brief; CONFIRMED when both agree); report shape from `code-review/references/report-format.md`; incremental pass rule | the effort table duplicated in the reference; Traps 6 (format now in reference) | 110 lines |
| azdo-cli | `az` first, `invoke` second, MCP last; org/project from the `ALM:` line | decision 1 rewritten: "org and project come from the session's `ALM:` line; none → ask"; type discovery; verify-before-typing; auth triage | the CLAUDE.md-mapping sentence; `mcp-fallback.md` loses `/db`, `/logs` rows and gains "azdo MCP is behind `ask`: say why before calling" | 120 lines |
| *all nine stack skills below* | house rules per stack; never the generic framework tutorial | `paths` per design §3 (after smoke test); description opens `Use when …` with the file types named; one line "facts also in `rules/<x>.md`" | `Not for:` lists longer than 3 items; plugin routing prose beyond one line; any Trap whose fix is already a Decide row | ≤ 110 lines each |
| angular | the era decides the idiom; never modernise in place | era-detection table (files, not assumptions); signal / observable / store table; "do I need the store" test; five-line types rule; migration ladder as 4 rows | the AngularJS narrative beyond its detection row; the three plugin bullets → one line | refs: 5 K |
| react | state in the right place, effects almost nowhere | state-placement ladder; "do I need an effect" tree; library threshold table; five-line types rule | plugin bullets → one line | refs: 3 K |
| dotnet-backend | the stack as it is; match the layout | layout-match rule; DI lifetime house shape + captive-dependency check; exception-vs-data table; Polly "retry only what is safe to repeat"; secrets never in the tree; one Traps line → `references/redis.md` | the Do block listing referenced packages (one command) | refs: 3 K + redis |
| dotnet-testing | risk decides what; the codebase decides how | "does this change earn a test" table; substitute vs hand-written fake; discover-before-inventing (copy the sibling test); prove-it-fails-first line; no-tests-tree fallback | the Language paragraph (contract line) | refs: 3 K |
| ef-core | model, query, migrate without breaking a database | configuration placement; query shape by cost table; migration decision tree; **never hand-edit a migration or the snapshot** as the contract line's "never"; design-time factory trap | the opening bold paragraph (folded into the contract line) | refs: 4 K |
| sql-server | T-SQL that performs; Postgres read cache beside it; read-only by default | slow-query ladder (statistics → plan → index); connection details from config never guessed; **every non-dev host through `db-ro.ps1`**; Postgres half (EXPLAIN, differences); plans → db-analyst | version prose | `sqlcmd-workflow.md` R (db-ro.ps1, psql, redis-cli rows); others K |
| rabbitmq | RPC is the norm: design for the timeout and the duplicate | timeout and idempotency rules; contract-change fan-out ("find every user of the type" command); subscription-id rule; broker inspection via `rabbitmqctl` in the container; flows → investigator `trace` | version prose | refs: 3 K |
| pipeline | Azure DevOps YAML house rules; a red run is `/fix-ci` | scripts over tasks; template boundary table; variable / variable group / secret / parameter routing; versioning (GitVersion) rules; the Ansible deploy contract (artifact names, `migration.sql`); expand-and-validate command | the GitHub Actions "conversation first" bullet → one Decide row | refs: 4 K |
| docker-dev-env | the local stack: Aspire first for the backend, compose for the rest | Aspire-vs-compose decision; healthcheck = readiness; volume reset table (keep / reset / throw away); port collision procedure; clients in containers (+ psql/redis-cli wrappers, docker and wsl forms) | version prose | `clients-in-containers.md` R; others K |
| dotnet-diagnostics (tools.md) | — | `tools.md`: Grafana/Loki = ops-analyst; local `dotnet-*` tools install lines kept | the LogQL block (moves to the agent) | — |
| dotnet-backend + redis | — | `references/redis.md` = redis-dotnet body minus its When; one Traps line routes there | redis-dotnet skill folder | — |
| dotnet-diagnostics | evidence from a running service; production first | instrument table; "Grafana/Loki queries run in `ops-analyst`, never here" as a Decide row; log-level table | the LogQL block in Do (moves to the agent body) | 100 lines |
| user-story-standard | the four item shapes and the AC form; never writes to the board | classification table; non-negotiables; the mixed-language rule as 2 lines | Traps that repeat non-negotiables | 110 lines |
| workitem-create | `/workitem-create`; items on the board after confirmation tables; always assigned to the user | five gates; discovery CLI first; hierarchy; "assignee shown before, read back after" (hook asks on a create without `--assigned-to`) | — | 110 lines |
| items-qa | `/items-qa <items> <url>`; verdict in Discussion; never approves | frontmatter `context: fork`, `agent: general-purpose`, `background: false`; **self-contained**: restate every input it needs (items, url, viewport, user) because a fork has no history; the five references stay | nothing else | 110 lines |
| project-wiki-standard | `/project-wiki-standard`; one place per fact | unchanged except contract line and description shape | — | — |
| worklog | `/worklog [period]`; hours only through `worklog-push.ps1`; Italian throughout | `disable-model-invocation: true` (owner decision); phases incl. the new **copertura** step: day target from `workspaces.json` overrides, gap prompt (AskUserQuestion: riunioni / chiamate / test manuali / altro, management item preselected), opt-in external sources (`references/fonti-esterne.md`: Outlook calendarView, Slack `from:me on:<date>`, proposals never auto-logged); engine flags (`-IdleMinutes` adaptive: gap active when a tool call, subagent, background task or same-topic continuation spans it; hard pause > 45 min, topic switch > 20 min) | the reminder-text duplication (the hook prints it) | 120 lines; `tempo-e-topic.md`, `ore-gestione.md`, `tabelle.md` rewritten for the new columns (`attivo`, `loggato`, `non fatturato`, `copertura`) |
| estimate | `/estimate`; hours from the team's recent history; read-only | unchanged except contract line; description shape | — | — |
| code-review (ex command) | `/code-review [scope] [effort] [focus]`; chat only | argument grammar; diff written once to scratchpad; §5 ladder; merge rule; report from `references/report-format.md` (the ex-CLAUDE.md section: tables last, fields, sort, columns, Fix rapidi) | the model-selection paragraph (now in Decide as the ladder); Guardrails duplicated under Never | 100 lines + reference |
| commit (ex command) | commit with Italian message; never pushes | grammar; staging rule; message rules; **done-check gate** as one Decide row: "before committing: the evidence line for the change type — `references/evidence-by-stack.md`" | — | 90 lines |
| db (ex command) | `/db "<sql>" \| <table> [--write] [--db]`; runs in db-analyst; non-dev hosts only via `db-ro.ps1` | `context: fork`, `agent: db-analyst`, `background: false`; self-contained (restate the argument grammar and the report shape); engine discovery; "non-dev → `db-ro.ps1`, dev → direct client"; psql/redis-cli rows | the credentials prose beyond "never echoed" | 100 lines |
| logs (ex command) | `/logs [service] [filter] …`; runs in ops-analyst | `context: fork`, `agent: ops-analyst`, `background: false`; source table; Loki/LogQL shapes (from dotnet-diagnostics Do); report ≤ 40 lines, lines verbatim | — | 100 lines |
| fix-ci (ex command) | `/fix-ci [run]`; diagnosis + proposed fix; never reruns or edits CI | `context: fork`, `model: sonnet`, `background: false`; the four-class table; "failing step only"; report shape | — | 100 lines |
| item (ex command) | `/item [id]`; read-only | unchanged logic; contract line; description shape | — | 90 lines |
| docs-sync, retro (ex commands) | as today; retro `context: fork`, `model: sonnet` | contract line; retro's category table gains "Automated check before written rule" as the first row | — | ≤ 90 lines each |

## Batch 5 — Agents

| Agent | Contract (output) | Must contain | Must drop | Frontmatter |
| --- | --- | --- | --- | --- |
| implementer | `## Scope · ## Files · ## Evidence · ## Not verified · ## Open questions` ≤ 40 lines | description "Use proactively for any code change beyond a few lines whose scope is decided…"; contained-diff rule; local-idiom rule; verify-before-report with quoted output; "load the stack skill the brief names" | — | `model: sonnet`, `effort: high`, `memory: project` (has Write/Edit → works; verify a MEMORY.md appears), `maxTurns: 60` |
| code-reviewer | findings blocks + the field set (`priority`, `risk`, `effort`, `status`, `CONFIRMED/PLAUSIBLE`, category slug), ≤ 60 lines at medium | input incl. "specialists beside you" and "previous findings"; method A–E; completeness pass; **"you may be one of two reviewers on different models: do not soften for agreement"** | the CLAUDE.md reference for the report format (fields defined in the body already) | `model: sonnet`, `omitClaudeMd: true`, `maxTurns: 40` |
| review-security / review-performance | same field set, ≤ 40 lines | unchanged method; output cap | — | `model: sonnet`, `omitClaudeMd: true`, `maxTurns: 30` |
| investigator | `locate`: owner `file:line`, excerpt, hop, related (≤ 20 lines); `trace`: ordered hop map (≤ 40 lines) | unchanged | `memory` | `model: sonnet`, `omitClaudeMd: true`, `maxTurns: 25` |
| db-analyst | `## Subject · ## What it does · ## Plan reading · ## Findings · ## Index recommendation` ≤ 50 lines; `/db` mode: statement + ≤ 50 rows as a table + one reading line | tools table: dev host → `sqlcmd`/`psql`/`redis-cli` direct, non-dev → `db-ro.ps1` only; "the hook denies anything else: do not retry around it"; probe-first rule; never writes | every `mcp__sql-prod__*` / `mcp__pg-prod__*` reference; `memory` | `model: sonnet`, `effort: medium`, `tools: Read, Grep, Glob, Bash, PowerShell`, `skills: [sql-server]`, `maxTurns: 30` |
| ops-analyst (new) | `## Source · ## Window · ## Lines (verbatim, ≤ 40) · ## Reading (≤ 5 lines)` | source table (Grafana/Loki via its own MCP, compose, container, kubectl, Aspire, files); LogQL shapes on the house labels; "never restart or delete"; redaction rule | — | `model: sonnet`, `effort: medium`, `tools: Read, Grep, Glob, Bash, PowerShell` + the inline server's tools, `mcpServers:` **inline** definition (`url: ${GRAFANA_URL}`, headers from `${GRAFANA_TOKEN}`; placeholders in the kit, values in the user's env), `skills: [dotnet-diagnostics]`, `maxTurns: 30` |
| doc-keeper | `## Docs tree · ## Verified · ## Updated / Created / Removed · ## Pending approval` ≤ 40 lines | unchanged | — | `model: sonnet`, `memory: project` (has Write/Edit), `maxTurns: 40` |
| Explore (override) | ≤ 20 lines: files found with `file:line`, one line each, no excerpts unless asked | 20-line body: breadth parameter (medium / very thorough), "locate, do not review", read excerpts not whole files, report the conclusion | — | `name: Explore`, `model: sonnet`, `effort: low`, `omitClaudeMd: true`, `tools: Read, Grep, Glob, Bash` (Bash read-only stated), `maxTurns: 20` |
| test-writer | — | — | the file | removed; `dotnet-testing` preloaded into implementer when the brief says tests |
