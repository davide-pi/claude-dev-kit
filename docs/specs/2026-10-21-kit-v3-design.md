# claude-dev-kit v3 — Design

Status: draft 2026-10-21. Branch: `refactor/kit-v3`. Input: `kit-v3-findings.md` (usage, features, constraints).

## 0. Thesis

Cost = context size x turns (10.7 B cache-read vs 34 M output tokens). v2 optimised *knowledge*; v3 optimises
**what is paid every turn** and **what never enters the main context**. Three moves, in order of payoff:

| Move | Mechanism | Effect |
| --- | --- | --- |
| Structural delegation | noisy tools (SQL, logs, browser) reachable only from a subagent or a `context: fork` skill | 722 SQL + 378 Loki + 390 browser calls leave the main thread |
| Load on touch | `paths:` on domain skills and `rules/`; CWD facts emitted by a hook, one row per session | always-loaded bytes -55% |
| Enforce, don't narrate | every mechanical CLAUDE.md rule becomes a command hook or a permission rule | fewer "no…" corrections (77/30 days), shorter CLAUDE.md |

Doc facts relied on (code.claude.com, 2026-10): rules without `paths` load like CLAUDE.md; `paths` rules load on
Read/Write/Edit of a match; skill `paths` "limits when the skill is activated"; agent `model` param > frontmatter >
`CLAUDE_CODE_SUBAGENT_MODEL` > session; a user agent named `Explore` overrides the built-in; `omitClaudeMd`, `memory`,
`maxTurns`, `mcpServers`, `skills` on agents; hook stdout reaches Claude only on `SessionStart`, `UserPromptSubmit`,
`UserPromptExpansion`, `PostModelSwitch` (`CwdChanged`/`DirectoryAdded` are side-effect only); `WorktreeCreate`
command hook prints the worktree path; prompt hooks on `Stop|PreToolUse|PostToolUse|UserPromptSubmit`, never on
`SessionStart`; `enableWorkflows` (per user) and `disableWorkflows` (for everyone) are both real keys — live
`enableWorkflows: false` means workflows are **off** (the findings file was wrong on this); MCP permission rules:
`mcp__<server>__*` for a whole server, `mcp__*` only in deny/ask; `~/` is a valid path anchor in rules, `$HOME` is not.

## 1. dev-loop verdict: kill, fold the table into CLAUDE.md

9 Claude loads / 191 sessions, 0 user loads, while CLAUDE.md said "start at dev-loop": the router is bypassed, not
missing. Routing is a 7-row table (~450 bytes) that belongs where it is read every time — CLAUDE.md. The gate rule
("ask only before the irreversible") is one line there. `references/spike.md` and `references/delegation.md` move
under `plan-work/references/`.

## 2. CLAUDE.md — where each section goes

Live file 9,504 B. Target ≤ 2,700 B. "Rule" = `~/.claude/rules/*.md`; unscoped rule costs exactly CLAUDE.md bytes.

| Section (live bytes) | Destination | Why |
| --- | --- | --- |
| System preferences (163) | **delete** | the environment block already states OS and shell |
| Review agents — model selection (794) | `skills/code-review` + `skills/pr-review` body; 1 line stays: "reviews run in subagents, never inline" | read only when reviewing |
| Review output format (1,704) | a `report-format.md` reference under the code-review skill, shared by pr-review; agents already emit the fields | 0 B always-loaded |
| Workspaces → ALM mapping (1,921) | **hook** `workspace-context.js` (SessionStart) reads local-only `~/.claude/workspaces.json` (root → platform, org, identity, and for "project per subfolder" roots an explicit subfolder → project map, else `project: ask`), emits one line `ALM: <platform> · org <x> · project <y> · az identity <z>`; CLAUDE.md keeps: "ALM target = the `ALM:` session line; a dir added later or unmapped → ask" | CWD-driven, cannot be a `paths` rule; one row per session instead of the whole map; no network in the hook |
| Routing and the CLI rule (406) | routing table (new, ~450) + "CLI before MCP" line; **enforce**: `permissions.ask` on `mcp__azdo-*__*` | the user sees every fallback |
| Token economy (551) | 2 lines (implementer default, concise briefs); **structural**: `Explore` override with `model: sonnet`, `/db` `/logs` `/fix-ci` fork into agents | the "pass model: sonnet" prose becomes config |
| How to write for me (493) | keep, compressed to ~250 B (`outputStyle: Concise` already set live) | read every turn, cheap |
| Change scope (729) | keep, compressed to ~300 B incl. the Proposta table header | judgement rule, no hook can enforce |
| Language (803) | keep, compressed to ~300 B | judgement rule |
| ALM rules table (860) | owning skills (pr-create, workitem-create, branch-flow, worklog) + **hook** `lib/alm-contract.js` (§7); worklog reminder text comes from `worklog-pending.js` itself | mechanical → enforced |
| Git worktrees root (305) | **hook** `worktree-root.js` on `WorktreeCreate` (prints `<root>/<repo>-<name>`), root from `settings.env.CLAUDE_WORKTREE_ROOT`; branch-flow reference keeps the git fallback | enforced on the native path, documented on the manual one |
| Done means verified (225) | keep as 2 lines | highest-value anti-hallucination rule |
| Search without a prompt (550) | keep, compressed to ~200 B | behaviour, not mechanical |

New `rules/` (path-scoped — load only when a matching file is Read/Written/Edited). Globs are relative to the
session cwd; `**/` prefix makes them work at user level.

| File | `paths` | Content (summary) | est. B |
| --- | --- | --- | --- |
| `rules/csharp.md` | `**/*.cs` | file-scoped namespaces, nullable on, `async` all the way + `CancellationToken`, no `.Result`/`.Wait()`, DI lifetime check, Serilog templates not interpolation, no secrets in `appsettings*.json` | 900 |
| `rules/csharp-tests.md` | `**/*Tests*/**/*.cs, **/*.Tests.csproj` | copy the sibling test's style, one reason to fail per test, no wall-clock/random/network, name = `Method_State_Expected` as the repo does | 500 |
| `rules/ef-migrations.md` | `**/Migrations/**/*.cs, **/*ModelSnapshot.cs` | never hand-edit a migration or the snapshot; `migrations script --idempotent` read before `database update`; drop-then-add → rename | 500 |
| `rules/typescript.md` | `**/*.ts, **/*.tsx` | strict on, no `any`/`as`/`!` without a comment, discriminated unions, narrow at the boundary | 500 |
| `rules/angular.md` | `**/*.component.ts, **/*.module.ts, **/angular.json` | read the era from the files first (standalone+signals vs NgModule+NgRx); no `subscribe` without teardown; `inject()` in new code | 500 |
| `rules/react.md` | `**/*.tsx, **/vite.config.*, **/tailwind.config.*` | state placement ladder, no effect for derived state, library threshold | 400 |
| `rules/sql.md` | `**/*.sql` | SARGable predicates, no `SELECT *`, `SET STATISTICS IO` before an index, `TOP`/`LIMIT` on exploratory reads, `TeamProject` scope in WIQL | 500 |
| `rules/pipelines.md` | `**/.pipelines/**, **/azure-pipelines*.y*ml, **/.github/workflows/*.y*ml, **/GitVersion.yml` | scripts over tasks, templates for repeated stages, no secret in YAML, a red run is `/fix-ci` not an edit | 500 |
| `rules/docker.md` | `**/Dockerfile*, **/docker-compose*.y*ml, **/compose*.y*ml, **/*AppHost*/**` | healthcheck = readiness, named volumes, image tag from `.env`, clients run inside the container | 400 |
| `rules/kit-assets.md` | `**/.claude/skills/**, **/.claude/agents/**, **/.claude/hooks/**, **/claude-dev-kit*/**` | the kit contract one-pager: caps, skeleton, identity placeholders, English prose, `node tools/validate.mjs` | 600 |

Rules are *context*, not enforcement; each is ≤ 25 lines, facts only, no procedure (procedures stay in skills).

## 3. Per-asset verdicts

Description target: ≤ 25 words (today 23–52). Legend: K keep · R rewrite · M merge · X kill · C convert.

### Skills

| Asset | Today | Verdict | New shape | Why |
| --- | --- | --- | --- | --- |
| dev-loop | router, 9 loads | **X** | 7-row table in CLAUDE.md; refs → plan-work | §1 |
| plan-work | 2 loads | R | keep auto; absorbs `spike.md`, `delegation.md`; description ≤ 20 words | the fan-out/output-contract knowledge is needed when briefing implementer |
| done-check | 0 loads | **X** | 2 lines in CLAUDE.md; `evidence-by-stack.md` moves under the commit skill's references; implementer body already verifies | the rule lives where the claim is made |
| debug-systematic | 0 loads | K | routing row "bug → debug-systematic"; description ≤ 20 words | content is good; it was never routed to |
| grill-me | user-intent | K | `disable-model-invocation: true` | user says "grill me"; 0 listing bytes |
| skill-forge | 6 loads | K | `paths:` as `rules/kit-assets.md`; `disable-model-invocation: false` | loads only while editing kit files |
| branch-flow | 15 loads | K | worktree root via hook; live reference drift pulled | works |
| pr-create | 28 loads | K | + `lib/alm-contract.js` enforces work-item link and squash flags | most used skill |
| pr-review | `/pr-review` | R | model-diversity fan-out (§5); report format from shared reference | pstack `interrogate` |
| azdo-cli | 23 loads | K | description ≤ 25 words | foundation |
| angular | 0 loads | K + `paths` | `**/*.component.ts, **/*.module.ts, **/angular.json, **/*.spec.ts` | triggering problem, not dead weight |
| react | 0 loads | K + `paths` | `**/*.tsx, **/vite.config.*, **/tailwind.config.*` | same |
| dotnet-backend | 0 loads | K + `paths` | `**/*.cs` (a test file also matches; both load, which is correct) | same |
| dotnet-testing | 2 loads | K + `paths` | `**/*Tests*/**/*.cs, **/*.Tests.csproj` | same; also preloaded in implementer when the brief says tests |
| dotnet-diagnostics | 4 loads | K | preloaded into `ops-analyst` via `skills:`; main-thread description stays | Loki/Grafana work moves to the agent |
| ef-core | 0 loads | K + `paths` | `**/Migrations/**, **/*DbContext*.cs, **/*Configuration.cs` | same |
| sql-server | 0 loads | K + `paths` | `**/*.sql`; preloaded into `db-analyst` | same |
| rabbitmq | 0 loads | K + `paths` | `**/*ServiceContract*/**, **/*Responder*.cs, **/*Subscriber*.cs, **/*Consumer*.cs` | same |
| redis-dotnet | 62 lines | **M** → dotnet-backend `references/redis.md` | one routing line in dotnet-backend Traps | too small to pay a description |
| pipeline | 0 loads | K + `paths` | `**/.pipelines/**, **/azure-pipelines*.y*ml, **/GitVersion.yml, **/.github/workflows/*` | same |
| docker-dev-env | 4 loads | K + `paths` | `**/docker-compose*.y*ml, **/compose*.y*ml, **/*AppHost*/**, **/Dockerfile*` | same |
| user-story-standard | 13 loads | K | description ≤ 25 words | ambient by design |
| workitem-create | `/workitem-create` | K | — | 0 listing bytes |
| items-qa | `/items-qa` | C | `context: fork`, `agent: general-purpose`, `background: false` | ~390 browser calls never enter the main context |
| project-wiki-standard | `/project-wiki-standard` | K | — | 0 listing bytes; usage unknown |
| worklog | live `disable-model-invocation: false`; engine under-measures | **R** (engine, `tempo-e-topic`, `ore-gestione`, `tabelle`, reminder hook — §9b) | flag back to `true` unless the owner wanted otherwise | CLAUDE.md: only `/worklog` writes hours; `false` lists it every turn; 66.5 h logged for ≥ 112 h worked |
| estimate (live only) | `/estimate` | **pull into kit** | anonymised; already `disable-model-invocation: true` | technique, not identity |
| my-voice (live only) | identity | excluded | never in the kit, `install.ps1` exclusion | constraint 1 |

### Reference files and scripts (every file; K keep · R rewrite · M move · X kill)

| Skill | References → verdict |
| --- | --- |
| angular | forms-http-routing K · legacy-modules-store K · modern-signals K · rxjs K · testing-and-migration K |
| azdo-cli | auth-and-config K · boards-catalogue K · mcp-fallback R (gap list shrinks: `/db` and `/logs` no longer MCP) · pipelines-catalogue K · repos-and-prs K · wiki-rest K · work-item-roles K · workitem-content K |
| branch-flow | finishing K (live drift pulled) · worktrees R (root from `CLAUDE_WORKTREE_ROOT`, native path via hook) |
| debug-systematic | data-and-messaging K · intermittent-and-ci K |
| dev-loop | delegation M → plan-work · spike M → plan-work |
| docker-dev-env | aspire K · clients-in-containers R (+ psql/redis-cli wrappers, §8) · compose-stack K · env-and-secrets K · healthchecks K · volumes-and-reset K |
| done-check | evidence-by-stack M → commit skill |
| dotnet-backend | async-concurrency K · di-lifetimes K · errors-and-config K · + redis (from redis-dotnet SKILL.md) |
| dotnet-diagnostics | dumps K · logging K · telemetry K · tools R (Grafana via ops-analyst, not the main thread) |
| dotnet-testing | strategy K · unit-mechanics K · untested-legacy K |
| ef-core | migrations K · modelling K · providers K · querying K |
| items-qa | browser-driving K · evidence K · posting K · reading-items K · verdict-format K (all run inside the fork) |
| pipeline | ansible-deploy K · caching-and-artifacts K · templates K · versioning K |
| plan-work | from-work-item K · plan-template K · + delegation, spike |
| pr-create | description K |
| pr-review | effort-and-fanout R (§5 two-model ladder) · posting K · triage K · + report-format (from CLAUDE.md, shared with code-review) |
| project-wiki-standard | canonical-structure K · maintenance K · scaffolding K · wiki-write-rules K |
| rabbitmq | easynetq K · operations K · principles K |
| react | data-and-forms K · state-and-composition K · vite-tailwind-setup K |
| skill-forge | asset-templates R (skill frontmatter: `paths`, `context`, `agent`, `effort`; agent: `memory`, `maxTurns`, `omitClaudeMd`) · description-craft R (≤ 25 words, `paths` as the trigger fix) · writing-for-agents K |
| sql-server | from-sql-server K · npgsql-dotnet K · sqlcmd-workflow R → `db-ro.ps1` for every non-dev host, psql/redis-cli added · stored-procedures K |
| user-story-standard | acceptance-criteria K · csv-import K · item-formats K |
| workitem-create | item-content K · questions K · session-cart K · tables K |
| worklog | ore-gestione R · scrittura K · tabelle R · tempo-e-topic R (§9b) · `worklog.ps1` R (§9b) · `round.ps1` K |
| estimate (pull) | sufficiency K · history K · deduction K · output K · `candidates.ps1`, `calibrate.ps1` K (anonymised) |

### Hooks, libraries, tools (every file)

| File | Verdict | New shape |
| --- | --- | --- |
| `hooks/guard-shell.js` | R | pull live version (sql-target wired); add `lib/alm-contract.js` call |
| `hooks/lib/default-branch.js`, `segments.js`, `decision.js` | K | — |
| `hooks/lib/destructive.js` | K | + `FLUSHALL|FLUSHDB`, `DROP ROLE`, `TRUNCATE` inside `psql -c` (reuse quoted-SQL blanking) |
| `hooks/lib/sql-target.js` (live only) | pull + R | psql, redis-cli, docker/wsl unwrapping, read-command allow-list (§8) |
| `hooks/secret-scan.js`, `format-on-edit.js`, `session-brief.js`, `ensure-edge-cdp.ps1` | K | — |
| `hooks/worklog-pending.js` | R | also flags under-target days (§9b); prints the one-line instruction CLAUDE.md used to carry |
| `hooks/az-identity.js` (live only) | pull + R → `workspace-context.js` | data-driven, ALM line (§6) |
| new `worktree-root.js`, `context-nudge.js`, `lib/alm-contract.js` | new | §6 |
| `scripts/sql-ro.ps1` (live only) | pull + R → `scripts/db-ro.ps1` | three engines, permission probe (§8) |
| `statusline.js` | R | context band colour from the nudge hook's cache file; under-target badge (§9b) |
| `tools/validate.mjs` | R | rules/: `paths` present and parseable, ≤ 25 lines; skills: description ≤ 25 words (error, not warning), `paths` globs valid; agents: `maxTurns` present; no `commands/` dir |
| `tools/*.test.mjs` | R | + cases for sql-target (psql/redis/docker/wsl), alm-contract, worktree-root, context-nudge |
| `evals/skill-triggering.md` | R | drop dev-loop/done-check/redis sections; add a `paths` case per domain skill ("Read a `.cs` file → skill listed as active"), fork cases for `/db`, `/logs`, `/fix-ci` |
| `mcp/servers.example.json` | R | azdo servers only; a note that database access is CLI (§8) |
| `.github/workflows/validate.yml` | K | — |
| `README.md` | R | asset table regenerated from the new inventory; "levels" row counts updated |

### Commands → skills (`skills/<name>/SKILL.md`; commands/ folder removed)

| Asset | Verdict | Frontmatter | Why |
| --- | --- | --- | --- |
| code-review | C | `argument-hint`, `effort` from args; no fork | spawns reviewers itself; a fork cannot be assumed to spawn subagents |
| commit | C | `allowed-tools: Bash(git add*), Bash(git commit*), PowerShell(git commit*)`; absorbs done-check evidence reference | the "done" claim is made here |
| db | C | `context: fork`, `agent: db-analyst`, `background: false` | SQL noise out of the main thread (§8) |
| logs | C | `context: fork`, `agent: ops-analyst`, `background: false` | Loki/compose output out of the main thread |
| fix-ci | C | `context: fork`, `agent: general-purpose`, `model: sonnet`, `background: false` | log slicing is pure noise; returns a diagnosis |
| item | C | none | the output *is* for the user |
| docs-sync | C | `disable-model-invocation: true` | already delegates to doc-keeper |
| retro | C | `disable-model-invocation: true`, `context: fork`, `model: sonnet` | reads transcripts |

### Agents

| Agent | Today | Verdict | Why |
| --- | --- | --- | --- |
| implementer | 35 uses vs 1,559 main-thread edits | K, R description: "Use proactively for any code change beyond a few lines…" | the cheapest lever on output tokens |
| code-reviewer | 100 | K | spawned twice on two models at high effort (§5) |
| review-security / review-performance | 3 / 9 | K | sonnet; `omitClaudeMd` after confirming each body states Italian output |
| investigator | 14 | K | already `omitClaudeMd` |
| db-analyst | 0 | **R** — the only holder of SQL access; `/db` forks into it | 0 uses = unreachable, not useless: the main thread had the MCP tools |
| ops-analyst | — | **new** — logs, metrics, traces (Grafana/Loki, compose, kubectl); preloads `dotnet-diagnostics` | 378 Loki calls on the main thread |
| doc-keeper | 3 | K, `memory: project` | learns the docs tree |
| test-writer | 0 | **X** | implementer + `dotnet-testing` covers it |
| Explore (override) | built-in, session model | **new agent file** named `Explore`: `model: sonnet`, own read-only `tools`, `omitClaudeMd: true`, a 20-line search body (the override does not inherit the built-in prompt) | deletes the "pass model: sonnet" rule |
| general-purpose | 207 | keep built-in; measure what the 207 were (`/insights` or transcript grep on `subagent_type`) before adding more narrow agents | no breakdown yet |

## 4. Agent frontmatter

| Agent | model | effort | memory | background | tools | mcpServers | skills | maxTurns | other |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| implementer | sonnet | high | project | default | Read, Grep, Glob, Edit, Write, Bash, PowerShell, Skill | — | — (caller names the stack skill) | 60 | — |
| code-reviewer | sonnet | — (caller passes) | — | default | Read, Grep, Glob, Bash, PowerShell | — | — | 40 | `omitClaudeMd: true` |
| review-security | sonnet | — | — | default | same | — | — | 30 | `omitClaudeMd: true` |
| review-performance | sonnet | — | — | default | same | — | — | 30 | `omitClaudeMd: true` |
| investigator | sonnet | medium | project | default | Read, Grep, Glob | — | — | 25 | `omitClaudeMd: true` |
| db-analyst | sonnet | medium | user | default | Read, Grep, Glob, PowerShell, Bash | none after §8 (CLI clients) | sql-server | 30 | no `permissionMode` (ignored under live `auto`); the gate is §8 |
| ops-analyst | sonnet | medium | user | default | Read, Grep, Glob, Bash, PowerShell | grafana (name ref; verify §8) | dotnet-diagnostics | 30 | — |
| doc-keeper | sonnet | medium | project | default | Read, Grep, Glob, Write, Edit, Bash | — | — | 40 | — |
| Explore | sonnet | low | — | default | Read, Grep, Glob, Bash (read-only use stated in body) | — | — | 20 | `omitClaudeMd: true` (the built-in also starts without CLAUDE.md) |

`omitClaudeMd` on the review agents is safe: their bodies already define `P1/P2/P3`, `alto/medio/basso`, `S/M/L`,
`CONFIRMED/PLAUSIBLE` and Italian output (checked: 11 occurrences each); the caller's brief passes the report shape.
`memory: user` on db-analyst/ops-analyst: schemas, label names and hosts recur across repos. `memory: project` on
implementer/investigator/doc-keeper: conventions are per repo.

## 5. Review — model diversity (pstack `interrogate`)

| Effort | Spawn (one message) | Model |
| --- | --- | --- |
| low / medium | code-reviewer | sonnet (frontmatter) |
| high+ | code-reviewer ×2 **same brief**, + review-security, + review-performance | reviewer A sonnet, reviewer B `model: <session family>` (opus); specialists sonnet |
| focus | the specialist alone | sonnet, or `model` named by the user |

Merge rule: same anchor + same defect from two models → `CONFIRMED`, weight first; one model only → `PLAUSIBLE`
unless it quotes evidence. The owner's existing "advanced" / "agent {model}" phrases keep their meaning. No new agent
files: diversity comes from the `model` parameter, not from personas.

## 6. Hooks

| Hook | Event | Type | Converts | Status |
| --- | --- | --- | --- | --- |
| `workspace-context.js` (ex `az-identity.js`) | SessionStart | command | ALM mapping + az identity → one context line (stdout) + `AZURE_CONFIG_DIR`/`AZ_IDENTITY` via `CLAUDE_ENV_FILE`; data from local-only `workspaces.json` (kit ships `workspaces.example.json`) | `CwdChanged`/`DirectoryAdded` cannot add context, so `/add-dir` to another org → the skill asks |
| `guard-shell.js` + `lib/alm-contract.js` | PreToolUse Bash\|PowerShell | command (ask) | `az repos pr create` without `--work-items` or without `--squash true --delete-source-branch true`; `az boards work-item create` without `--assigned-to`; `az devops configure --defaults` | new lib, tests in `tools/` |
| `lib/sql-target.js` (pull from live) + psql/redis-cli | PreToolUse | command (deny) | raw DB client at a non-dev host unless via `/db` script (§8) | live today for sqlcmd |
| `worktree-root.js` | WorktreeCreate | command | `git worktree add <CLAUDE_WORKTREE_ROOT>/<repo>-<name>`, prints the path | contract confirmed; test on Windows paths |
| `context-nudge.js` | UserPromptSubmit | command | `transcript_path` size as a proxy: at 2 / 4 / 6 MB inject once "context is large: `/compact` or `/clear` before a new topic" (no live token field exists) | proxy; calibrate against `/context` |
| `done-claim.prompt` | Stop | prompt, `continueOnBlock` n/a | "last message claims done/fixed/passing without quoted command output → `ok:false`" | **opt-in experiment**: one background-model call per turn end; adopt only if false positives < 1/10 |
| `permissions.ask` | — | settings | every `mcp__azdo-*__*` call asks | CLI-before-MCP, visible |
| `format-on-edit`, `secret-scan`, `session-brief`, `worklog-pending`, `ensure-edge-cdp` | — | — | unchanged | — |

## 7. Workflows

Live `enableWorkflows: false` is valid → workflows are **off**. Turn them on only in batch 8, bounded:
`"enableWorkflows": true`, `"workflowSizeGuideline": "small"`. Adopt for exactly two recurring fan-outs, saved under
`~/.claude/workflows/`:

| Workflow | Shape | Why a workflow |
| --- | --- | --- |
| `/review-large` | one reviewer per changed file (two models for high), one merger → report-format | a PR with 30+ files overflows one reviewer; findings stay in script variables |
| `/audit-repos` | one agent per repo under a workspace root, same question (dependency, pattern, secret), one ranker | RaptorNext has many repos; the main context holds only the ranked list |

Not adopted: ultracode (every task becomes a workflow — opposite of the cost goal).

## 8. Minimise MCP: database access through CLIs behind `/db`

Today: `sql-prod` / `pg-prod` MCP servers (project-scoped `.mcp.json`) put ~35 tool schemas in every turn of those
projects and 722 query results in the main context. Target: **no database MCP**; `/db` (fork → db-analyst) drives
`sqlcmd`, `psql`, `redis-cli` through `scripts/db-ro.ps1` (ex `sql-ro.ps1`), targets from local-only
`db-targets.json`. Read-only is guaranteed in layers; each layer alone is insufficient:

| Layer | SQL Server | Postgres | Redis | Who checks |
| --- | --- | --- | --- | --- |
| 1 server-side (the only guarantee) | login whose database roles are `db_datareader` + `VIEW DEFINITION` and nothing else (`ApplicationIntent=ReadOnly` is routing, not permission) | role with `SELECT` grants only and `pg_read_all_stats`; `ALTER ROLE … SET default_transaction_read_only = on` is a default a session can override, so the grants carry the guarantee | ACL user `-@all +@read +@connection +info +ping` (or Azure Cache *Data Reader* access policy where the tier has it) | `db-ro.ps1` probes at start (`sys.fn_my_permissions`, `SELECT rolsuper, rolcreatedb … FROM pg_roles` + `has_table_privilege(…,'INSERT')` sample, `ACL WHOAMI` + `ACL GETUSER`) and refuses with exit 3 if a write grant is found — the live `sql-ro.ps1` already does this for SQL Server |
| 2 client defaults | no client-side read-only switch exists: the script's statement filter (`SELECT`/`WITH`/`EXEC sp_help*` only, no `;` chaining) is the layer | `PGOPTIONS='-c default_transaction_read_only=on'`, `-v ON_ERROR_STOP=1`, `--no-psqlrc`, statement filter as for SQL Server | `--no-raw`; command allow-list applied by the script before exec | `db-ro.ps1` |
| 3 PreToolUse hook | `lib/sql-target.js`: `sqlcmd|Invoke-Sqlcmd|bcp|SqlPackage` at a non-dev host → deny unless the command is `scripts/db-ro.ps1` | add `psql|pg_dump|pg_restore|pg_dumpall`: host from `-h`/`--host`/`PGHOST=`/`postgres://` URI → same rule | add `redis-cli`: host from `-h`/`-u`/`REDISCLI_…`; non-dev → deny unless `db-ro.ps1`; dev host → allow-list of read commands (`GET MGET HGET* HGETALL SCAN SSCAN HSCAN ZSCAN TTL TYPE INFO CLIENT LIST XINFO XLEN XRANGE XPENDING LRANGE SMEMBERS ZRANGE* DBSIZE EXISTS`); `KEYS`, `MONITOR`, `DEBUG`, `CONFIG` → ask; everything else → deny | hook; recognises the client also inside `docker run|exec …`, `wsl …`, `pwsh -c`/`bash -c` (extend the existing wrapper unwrapping) |

Clients are not installed (checked: `psql` no, `redis-cli` no, `sqlcmd` yes, `winget` yes, `scoop` no, `docker` yes):

| Client | Install route | How the hook recognises it |
| --- | --- | --- |
| psql | native: `scoop install postgresql` (or EDB "Command Line Tools" only); fallback `docker run --rm -i postgres:17 psql` | token `psql`/`psql.exe`, also after `docker run|exec` and `wsl` |
| redis-cli | no current native Windows build with TLS (tporadowski / scoop redis = 5.x) → `docker run --rm -i redis:7 redis-cli --tls …` or WSL `apt install redis-tools` | token `redis-cli`, also after `docker run|exec` and `wsl` |
| sqlcmd | present (go-sqlcmd) | as today |

`db-ro.ps1` owns the wrapper choice per client (native → wsl → docker, first found) so `/db` never asks which to use.
`install.ps1 -Check` reports each client as *native / wsl / docker / missing*. Grafana MCP stays for now (no CLI equivalent) but moves
to `ops-analyst.mcpServers` — verify whether a name reference keeps the server out of the main thread; fallback: inline
definition whose command reads `${GRAFANA_URL}`/`${GRAFANA_TOKEN}` (no identity in the kit).

## 9b. worklog — the engine under-measures

Writes are right (audit = `CompletedWork` on 39 items); the measurement is wrong: Oct 1–21 logged 66.5 h over 14
working days against ≥ 8 h/day worked. Per-day active vs logged: 01 6h37/3.5 · 05 8h44/4.5 · 06 3h25/1.5 ·
09 2h16/0.5 · 12 3h36/6 · 14 6h27/4 · 15 1h55/1 · 16 0h53/3 · 19 9h00/6.5. Even active time is then halved by
rounding and exclusions, and days with 1–3 h of Claude activity hide 5–7 h of meetings, calls, tests and reading.

| Cause (live `worklog.ps1`) | Change | Where |
| --- | --- | --- |
| only prompts count; a gap > `IdleMinutes` (15) is a pause even when a build, pipeline, subagent or the user's thinking filled it | adaptive pause: a gap is active when the transcript shows a tool call, a subagent, a background task or a `/background` job spanning it, or the next prompt continues the same topic (no `/clear`); hard pause only above 45 min, or at a topic switch above 20 min | `worklog.ps1` (reads the transcript jsonl, not only `history.jsonl`) |
| `internal` time (kit, tooling) excluded from billing, `donor` micro-topics rounded away | keep the roles, but report the dropped minutes explicitly in the day table ("non fatturato: 1h10") | `round.ps1` output, `tabelle.md` |
| no expected-day comparison: 0.5 h closes a day | **daily target 8 h** (per-weekday override in `workspaces.json`: e.g. 13/10 event = 0, 20/10 = 4 + 2); the day table ends with `copertura: 3.5h / 8h — mancano 4.5h` and a **gap prompt**: how to cover the difference — meetings, calls, manual tests, other — as one `AskUserQuestion` with the management item preselected | SKILL.md phase 3, `ore-gestione.md` |
| no external sources | opt-in sources for the gap: Outlook/Teams calendar (Graph: `me/calendarView` for the day) and Slack activity (`slack_search_public_and_private from:me on:<date>`); each event becomes a candidate row the user confirms | new `references/fonti-esterne.md`; sources are proposals, never auto-logged |
| reminder = "no audit" only | `worklog-pending.js` also lists **under-target days** (`logged < target - 1h`) for the current month; statusline badge shows both counts | hook + `statusline.js` |
| hours written outside `/worklog` (MCJ #15337, #15338, #15342 by two sessions) | **enforcement, owner decision**: hours writes go through one script, `scripts/worklog-push.ps1` (reads the confirmed rows, writes `CompletedWork`, appends the audit); `lib/alm-contract.js` denies any other `az boards work-item update` carrying `CompletedWork` / `Microsoft.VSTS.Scheduling.CompletedWork` with "le ore si registrano con /worklog"; the MCP `wit_work_item_write` is already under `permissions.ask` (§11) — same shape as `db-ro.ps1`, no environment magic | hook + script; mark ask vs deny |

Verification for the batch: re-run the engine on Oct 1–21 and compare day by day with the table above (engine active
time ≥ the active column on every day; 13/10 and 20/10 honour their overrides); the gap prompt appears on every
under-target day; the reminder lists under-target days; a direct `CompletedWork` write is refused with the message.
**Deadline**: live `cleanupPeriodDays: 30` deletes the Oct 1 transcripts around Oct 31 — run batch 9 before then, or
export the baseline now (`history.jsonl` slice + the `_raw` folder) so the comparison survives.

## 9. Always-loaded byte budget

Measured on the live config (bytes; descriptions = frontmatter `description` text only; skills with
`disable-model-invocation: true` are not listed and cost 0).

| Component | Before (live) | After | Note |
| --- | --- | --- | --- |
| CLAUDE.md | 9,504 | ~2,700 | §2 |
| Skill descriptions listed | 6,582 (22 kit skills 6,111 + worklog 167 drift + my-voice 304) | ~3,000 (22 auto skills × ≤ 25 words, incl. 6 ex-commands) | **assumption**: a `paths`-scoped skill is still listed (docs say only "limits activation"); if it is not, −1,500 |
| Command descriptions listed | 815 | 0 (merged into skills above) | — |
| Agent descriptions | 2,089 | ~1,450 (9 agents × ~160) | 15,000-token warning threshold is far |
| Auto memory `MEMORY.md` | 1,785 | 1,785 | unchanged |
| ALM line from hook | 0 | ~150 | replaces 1,921 in CLAUDE.md |
| **Total** | **20,775 (~5.2k tokens)** | **~9,100 (~2.3k tokens)** | −56% |
| Not measured | database MCP tool schemas (~35 tools) in RaptorNext/MCJ sessions | 0 after §8 | measure with `/context` before and after batch 6 |

## 10. Migration batches (each committable and verifiable alone)

| # | Batch | Contents | Verify |
| --- | --- | --- | --- |
| 1 | Reconcile live drift | pull `commands/db.md`, `hooks/guard-shell.js` + `lib/sql-target.js`, `branch-flow/references/*`, `az-identity.js` (ROOTS → `workspaces.json` + example), `skills/estimate` (anonymised), `scripts/sql-ro.ps1`, settings template hook wiring; worklog flag back to `true` (owner decision); **exclude** `skills/my-voice`, `skills/.trash`, `skills/synced`, catsay Stop/Notification hooks, `Read(//c/Users/…)` allows, `modelSettings`, the owner's `~/.claude/**` ask rules | `node tools/validate.mjs` clean (identity regexes); `install.ps1 -Check` lists only the known local-only set |
| 2 | install.ps1 | `$AssetDirs += rules, workflows, scripts`; `$LocalOnly` exclusion list (my-voice, .trash, synced, `workspaces.json`, `db-targets.json`); `-Pull` skips them; `-Check` groups drift by asset; client presence (psql/redis-cli/sqlcmd: present/docker/missing); hook-wiring check knows every event | `install.ps1 -Check` exit 0 on a clean install; `pwsh` parse in CI |
| 3 | CLAUDE.md v3 + rules + workspace hook | new CLAUDE.md (§2), 10 rules, `workspace-context.js`, routing table, kill dev-loop/done-check (refs moved) | `wc -c CLAUDE.md` ≤ 2,700; `/doctor prompt-audit` no conflicts; session shows the `ALM:` line in each mapped root; a `.cs` Read loads `rules/csharp.md` (`/context`) |
| 4 | Skills | `paths`, descriptions ≤ 25 words, grill-me/skill-forge flags, redis merge, items-qa fork, commands → skills (fork for db/logs/fix-ci/retro) | validator; evals rerun for every changed description (MUST/MUST NOT); `/db` shows a fork, `/context` main thread unchanged |
| 5 | Agents | frontmatter §4, `Explore.md`, `ops-analyst.md`, kill test-writer, implementer description | validator "agent named by prose" passes; spawn each once; `/context` confirms Explore runs sonnet |
| 6 | DB through CLIs (§8) | `db-ro.ps1` (3 engines, permission probe), `sql-target.js` + psql/redis-cli, read-command allow-list, remove `sql-prod`/`pg-prod` from the project `.mcp.json`, install clients | `node --test tools/*.test.mjs` (new cases: psql URI, `PGHOST`, redis `-u`, docker wrappers); `/db "SELECT 1"` on each target; a write attempt exits 3; `/context` shows no `mcp__sql-prod__*` |
| 7 | Hooks | `alm-contract.js`, `worktree-root.js`, `context-nudge.js`, optional `done-claim` prompt hook | unit tests; `EnterWorktree` lands under `cl-wt`; a PR create without `--work-items` asks |
| 8 | Review diversity + workflows | pr-review/code-review rewrite, `report-format.md`, two saved workflows | `/code-review high` on a known diff spawns 4 agents, 2 models; `/workflows` shows size guideline |
| 9 | worklog measurement (§9b) | adaptive pause, transcript-based activity, daily target + gap prompt, external sources (opt-in), reminder for under-target days, `CompletedWork` guard | engine re-run on Oct 1–21 matches the owner's day table; a direct `CompletedWork` write is refused; `node --test` on the hook |
| 10 | Live settings.json redesign (§11) | applied by the main session, one Edit per block, each a user prompt (owner's new `ask` rules on `~/.claude/**`); template updated in the same commit | `/status` shows user settings loaded, no Settings Warning; `claude doctor` lists no rejected entry; `/mcp` shows no M365/Figma/Airtable; `install.ps1 -Check` reports settings drift only on the known local-only keys |

## 11. settings.json — redesign (template and live, batch 9)

The owner added `ask` rules for Edit/Write on `~/.claude/settings.json`: live edits are now a prompt per Edit, not a
classifier block (to confirm on the first try). Every block below is one Edit; the template carries placeholders, the
live file the real values. Local-only keys never enter the template: catsay hooks, `Read(//c/Users/…)`,
`modelSettings`, `Read(~/.claude/…Temp…)`.

| Block | Change | Why |
| --- | --- | --- |
| `permissions.allow` | keep both shells for now (Bash 6,762 calls vs PowerShell on the main thread: Bash dominates despite `defaultShell`); measure per rule with `/insights` for a month, then drop the side a rule never fired on; add for both shells `pwsh -NoProfile -File ~/.claude/scripts/db-ro.ps1 *` (`~/` anchor, not `$HOME`), `psql --version`, `redis-cli --version`, `docker run --rm -i postgres:* psql*`, `docker run --rm -i redis:* redis-cli*`, `wsl redis-cli *` — prefixes that layer 3 still inspects line by line; keep `Read(**)`, `Grep(**)`, `Artifact` | no blind cut: a dropped rule becomes a classifier call per command |
| `permissions.ask` | keep git/sql/docker set; add `mcp__azdo-<org-a>__*`, `mcp__azdo-<org-b>__*` (live: `mcp__azdo-engagelabs__*`, `mcp__azdo-engagesvc__*`); add `Edit(~/.claude/**)`, `Write(~/.claude/**)` (the owner's `~/.claude/*` misses subdirectories — `**` covers hooks, skills, agents) | CLI before MCP made visible; kit edits always confirmed |
| `permissions.deny` | keep all; add `Edit(~/.claude/.credentials.json)`, `Read(~/.azure*/msal*)` | nothing removed: a deny expresses only what a prefix can see; the destructive-SQL and host checks stay in the hook, and `workspaces.json` / `db-targets.json` must stay readable for the hook and the script |
| `deniedMcpServers` | re-add `claude.ai Microsoft 365`, `claude.ai Figma`, `claude.ai Airtable` **if absent** (present in the 16:44 snapshot of the live file; confirm with `/mcp`); template ships the three as the example of the shape | connector tools cost schema bytes every turn |
| `autoMode` | new: `environment: ["Solo developer on Windows; Azure DevOps + GitHub; databases reached only through ~/.claude/scripts/db-ro.ps1"]`, `allow: ["$defaults", "Read-only az devops/boards/repos/pipelines and gh queries", "dotnet build/test, npm test, docker compose ps/logs"]`, `soft_deny: ["$defaults", "Any command that writes to a database not on localhost", "git push to the default branch", "Deleting a branch, worktree, volume or cloud resource", "Editing files under ~/.claude without the user's explicit request this turn"]`, `hard_deny: ["az account set", "dotnet ef database drop", "docker system prune"]` | the classifier gets the house rules instead of inferring them |
| `env` | keep `CLAUDE_CODE_SUBAGENT_MODEL=sonnet`, `CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS=1`, `CLAUDE_WORKSPACE_ROOTS/NESTED`; add `CLAUDE_WORKTREE_ROOT` (live `C:\\__workspaces\\cl-wt`); `MAX_MCP_OUTPUT_TOKENS` 10000 → `4000`; drop `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` (inert while `autoCompactEnabled: false`) | fewer inert keys |
| model / effort | keep `model: opus[1m]`, `effortLevel: medium`, `fallbackModel`; add `subagentPromptCacheTtl: "1h"` (review fan-outs and workflows re-read the same prefix) | cheaper fan-outs |
| compaction | keep `autoCompactEnabled: false` (deliberate, per memory); the nudge hook replaces auto-compact | owner's choice |
| workflows | `enableWorkflows: false` → `true` only with batch 8; add `workflowSizeGuideline: "small"` | §7 |
| hooks | SessionStart: `workspace-context.js` replaces `az-identity.js`; add `WorktreeCreate` → `worktree-root.js`, `UserPromptSubmit` → `context-nudge.js`; optional `Stop` prompt hook (§6); keep catsay Stop/Notification live-only | §6 |
| plugins | disable `skill-creator` (off live already — template still `true`), keep `csharp-lsp`, `typescript-lsp`, `microsoft-docs`, `browser-use`, `frontend-design`; `redis-development` stays off (the redis reference covers the house facts) | template = live |

Outside settings.json, live: remove `sql-prod`/`pg-prod` from the project `.mcp.json` files (batch 6); create
`~/.claude/workspaces.json` from the example (batch 3); `~/.claude/db-targets.json` gains `pg`/`redis` targets (batch 6).

## 12. Habits sheet — candidates (feature | when | how)

| # | Feature | When | How |
| --- | --- | --- | --- |
| 1 | `/clear` on topic change | the next task shares nothing with the last | `/clear`; the session brief re-fires |
| 2 | `/compact <focus>` | context past ~50% and the task continues | `/compact keep the plan and open findings` |
| 3 | `/btw` | a side question mid-task | `/btw <question>` — no context pollution |
| 4 | `/effort low` for chores | renames, commits, reading items | `/effort low`, back to `medium` after |
| 5 | `/db` instead of SQL in chat | any query on a real database | `/db "SELECT …"` → runs in db-analyst |
| 6 | `/logs` instead of Loki in chat | reading production or compose logs | `/logs api --errors --since 1h` |
| 7 | Brief the implementer | a change beyond a few lines whose shape is decided | "implementer: files X, change Y, verify Z" |
| 8 | `/code-review high` before a PR | the change touches contracts, data or auth | two models review; agreement weighs most |
| 9 | `/rewind` over "no…" | a wrong turn after an edit | `/rewind` to the checkpoint, re-brief once |
| 10 | `/goal` | a long run with a testable end | `/goal dotnet test passes with 0 failures` |
| 11 | `/background` | a build or test that takes minutes | `/background dotnet test` and keep working |
| 12 | `/insights` monthly | the 1st of the month | read the skill/agent usage, prune what never fires |
| 13 | `/doctor prompt-audit` after kit changes | after each v3 batch | finds contradictions between CLAUDE.md, rules, skills |
| 14 | `/schedule` for `/worklog` | end of day | a routine that reminds, never logs |
| 15 | Ctrl+G to edit a plan | a plan is almost right | edit in the editor instead of correcting in chat |

## 13. Open decisions for the owner

1. worklog `disable-model-invocation`: restore `true` (CLAUDE.md says only `/worklog` writes hours) or keep live `false`?
2. Prompt hook `done-claim` on Stop: run as a 2-week experiment, or skip?
3. Redis read-only on Azure Cache: is a *Data Reader* access policy available on the tiers in use, or do we create an ACL user on the server?
4. Workflows: turn `enableWorkflows` on with batch 8 (bounded `small`), or stay off until a concrete multi-repo audit is needed?
5. Grafana MCP: keep (attached to ops-analyst) or also replace with the Loki/Prometheus HTTP APIs through a `logs-ro.ps1` script?
6. `CompletedWork` outside `/worklog`: hard deny, or ask with the reason shown? Calendar/Slack as worklog sources: opt-in per run, or always proposed on under-target days?
