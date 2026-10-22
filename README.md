# claude-dev-kit

A personal [Claude Code](https://docs.claude.com/en/docs/claude-code) toolkit for a developer who
has to cover every role alone: analyst, backend, DBA, frontend, reviewer, release manager, ops.

Opinionated about **C# / ASP.NET, EF Core, SQL Server, PostgreSQL, Redis, RabbitMQ, TypeScript,
Angular, React**, with **Azure DevOps** as the ALM platform and GitHub alongside it. Opinionated on
*technique*, anonymous on *identity*: the patterns, libraries and commands are real, while
organization and project names, machine paths and addresses are placeholders.

**Italian by default; English for the code and for what the AI reads back.** Everything an asset
makes a *person* read is Italian — chat reports, commit messages, pull request titles and bodies,
review comments, work items, wiki pages. English is reserved for the code, for a project's technical
documentation tree, for plan files and specs (a later session reads those back, which makes them
AI-facing reference), and for the instructional prose of the assets in this repository. So an asset
is written in English and *says* "produce Italian" — swap that second half for your own language and
nothing else changes. Machine identifiers are never translated in either direction.

## Five levels

| Level | What it solves | Assets |
|---|---|---|
| **Routing** | which asset owns this task | the route table in `CLAUDE.md`, path-scoped `rules/` |
| **Knowledge** | not re-deciding what was decided once | 32 skills, depth in reference files loaded on demand |
| **Exploration** | finding context without burning the main context window | 9 subagents |
| **Execution** | running a known sequence in one shot | 8 one-shot skills (`/name`), 2 saved workflows |
| **Safety net** | not forgetting, and not doing the irreversible | 10 hooks, the completion gate, the validator |

Two rules govern all of them, and they live in `CLAUDE.md` so they apply without being triggered:
**route through the table**, and **try the CLI before the MCP server, every time**.

## Skills

One skeleton throughout — *When* (with what it explicitly excludes), *Decide* (a decision table or
tree), *Do* (copy-pasteable PowerShell), *Traps*, *References* — a `**Contract.**` line after the title
(what it produces · what it never does · the output language), the description a `Use when` trigger of
25 words at most, the file capped at 120 lines, with depth in `references/` files loaded only on demand. No skill pins a version: where the answer depends on one,
the skill says which file to read or where to verify it.

**Routing and process.** These absorb the parts of the `superpowers` plugin worth keeping, without
the ceremony and rewritten for PowerShell.

| Skill | Purpose |
|---|---|
| `skills/plan-work/SKILL.md` | A plan file with verifiable tasks, sized to the change — and when not to write one at all. Also turns a work item into an attack plan before any code. |
| `skills/debug-systematic/SKILL.md` | Reproduce, isolate, explain, then fix — with a symptom-to-instrument table for .NET processes, query plans, brokers, pipelines and intermittent failures. |
| `skills/skill-forge/SKILL.md` | How to add or change an asset of this kit: shape decision, front matter, caps, splitting, finish checklist. |
| `skills/grill-me/SKILL.md` | Red-team a plan: interview the decision tree round by round — the whole frontier at once, each question with a recommended answer — then a Decision Summary. |

**Backend .NET**

| Skill | Purpose |
|---|---|
| `skills/dotnet-backend/SKILL.md` | House shape of the backend: EasyNetQ RPC handlers, Polly retries, Serilog, Scrutor/Quartz; DI lifetimes and the captive dependency, async discipline, options and secrets; the Redis multiplexer, Streams consumer groups and their pending-forever trap (generic Redis → `redis-development` plugin). |
| `skills/dotnet-testing/SKILL.md` | Adding tests where there are none: the RPC handler as the seam, the first test project and its pipeline step, what deserves a test, xUnit mechanics. |
| `skills/dotnet-diagnostics/SKILL.md` | Production first through Grafana (Loki, Prometheus, Pyroscope) — read inside `ops-analyst`, never on the main thread — `/logs` and the Aspire dashboard locally, `dotnet-*` counters, traces and dumps as fallback. |
| `skills/ef-core/SKILL.md` | Modelling, the query cost model, and the single owner of the migration procedure and its guardrails (never hand-edit a migration or the snapshot). |

**Data and messaging**

| Skill | Purpose |
|---|---|
| `skills/sql-server/SKILL.md` | The house T-SQL rules, the clients (native, WSL or docker), stored procedures, the slow-query ladder for SQL Server and the Postgres read cache; plans go to `db-analyst`. |
| `skills/rabbitmq/SKILL.md` | EasyNetQ RPC-first: timeouts, missing responders, exceptions across the wire, shared contracts; subscription ids, broker operations; flows → `investigator` (trace). |

**Frontend**

| Skill | Purpose |
|---|---|
| `skills/angular/SKILL.md` | The eras that coexist in one codebase — standalone with signals, module-based with RxJS and a Redux-style store — with the file-based test for which one you are in, both test harnesses, and an incremental migration ladder. |
| `skills/react/SKILL.md` | Vite + Tailwind setup, where state belongs, the house TypeScript rules. |

**Delivery and ALM.** CLI-first on both platforms; the MCP servers are a documented fallback for the
few capabilities the CLI genuinely lacks.

| Skill | Purpose |
|---|---|
| `skills/azdo-cli/SKILL.md` | The foundation everything else calls: configuration and defaults, auth including an organization on another tenant, WIQL, the boards, repos, PR and pipeline verbs, resolving the identity to assign to **against the organization** rather than the machine, `az devops invoke` as the REST escape hatch, and the fallback rules. |
| `skills/user-story-standard/SKILL.md` | The company standard for **what an item says**: classifying a request as a User Story, Bug, Impediment or TECH, the exact body shape of each, and acceptance criteria in the mandatory `Dato che / Quando / Allora` form — plus the four coverage families behind them, and the rule that the criteria are never written together with the story, because what looks like one story usually contains three. |
| `skills/workitem-create/SKILL.md` | `/workitem-create` — a description and images become work items after a Q&A pass and two confirmation tables, assigned to you by default with the UPN shown before and read back after. Owns the **mechanism** — including turning a client meeting into items on an existing board; the content follows `user-story-standard`. |
| `skills/estimate/SKILL.md` | `/estimate` — hours for new work, deduced from the request and the team's last three months of completed items on Azure DevOps: a sufficiency verdict first, then a calibrated estimate with its references, margin and "not included" list. Read-only; `candidates.ps1` and `calibrate.ps1` do the history and the calibration. |
| `skills/project-wiki-standard/SKILL.md` | `/project-wiki-standard` — the canonical structure of an Azure DevOps project wiki and the zero-duplication rule that keeps it usable: one place per fact, an answered question **migrates** to the page that owns it and is deleted, and constraints stay separate from the decisions taken in response. |
| `skills/worklog/SKILL.md` | `/worklog` — reconstructs what was done in a period from the session transcripts, estimates time per topic, then logs the hours on the right work items, reconciling hours already on an item that the audit does not know. Every day is measured against its target (8h on a weekday, 0 at weekends, or its own value in `worklog/targets.json`) and a shortfall is chased before anything is logged. The audit is never pruned: it is what closes a day, zero-hour days included, and what the reminder hook reads. Italian by design. |
| `skills/pr-review/SKILL.md` | `/pr-review [target] [effort] [focus]` — reviews a PR and posts **only genuine questions**; everything else stays in chat. Delegates to `code-reviewer`, fanning out to the specialists from `high`. Also owns receiving review findings: verify before implementing. |
| `skills/pr-create/SKILL.md` | Opening a PR on either platform: Italian imperative title, reviewer-sized body with a `Rilascio:` block naming every component the change forces a deploy of, protected-branch target read from the remote, the parent backlog item linked (never a Task). |
| `skills/branch-flow/SKILL.md` | Branch conventions on both platforms, isolated worktrees, and the finish menu once the work is complete — always squash and delete the source branch. |
| `skills/items-qa/SKILL.md` | `/items-qa` — drives a real browser against a running site to test work items against their acceptance criteria, reads the existing discussion first, and posts a verdict that explicitly is not an approval. |

**Environment and CI**

| Skill | Purpose |
|---|---|
| `skills/docker-dev-env/SKILL.md` | Aspire-first for the backend, compose for the rest; clients native, in WSL or inside containers, healthchecks against readiness, deliberate volume resets, local secrets. |
| `skills/pipeline/SKILL.md` | Azure DevOps YAML with the house rules (scripts over tasks, no test stage), templates, versioning, variables and caching; the Ansible deploy; failures → `/fix-ci`. |

## One-shot skills and workflows

The one-shot layer: the decision is already made, the skill runs the sequence. These were slash
commands; commands are now skills, so each is a `skills/<name>/SKILL.md` typed as `/name` and a
`commands/` folder must not exist (the validator fails on it, and a stale live copy would shadow
the skill — `install.ps1` offers to remove it). Each declares what it never does in its contract
line, and none of them merges, deploys, force-pushes or drops. The noisy ones run **forked** in a
subagent, so the raw output never reaches the main conversation.

| Skill | Does |
|---|---|
| `skills/item/SKILL.md` | `/item` — reads a work item properly (acceptance criteria, parent, links, attachments, discussion), or lists your active ones. |
| `skills/fix-ci/SKILL.md` | `/fix-ci`, forked — a red run: fetch only the failing step's log, isolate the error, and separate a code fault from a pipeline fault from an environment difference. |
| `skills/db/SKILL.md` | `/db`, forked into `db-analyst` — inspect the project's database: discover the engine and connection, run a query or describe a schema. Read-only by default. |
| `skills/logs/SKILL.md` | `/logs`, forked into `ops-analyst` — tail and filter the current service's logs, whichever way this project produces them. |
| `skills/docs-sync/SKILL.md` | `/docs-sync` — runs `doc-keeper` on the repository's tech docs or wiki tree, against the working diff, a range or a full audit. |
| `skills/code-review/SKILL.md` | `/code-review [scope] [effort] [focus]` — reviews the working diff and reports in chat only. |
| `skills/retro/SKILL.md` | `/retro [session] [focus]`, forked — retrospective on a session: classifies every friction event and proposes the environment fix (an automated check first, then pointer, hook, skill, access). Proposes only. |
| `skills/commit/SKILL.md` | `/commit` — a commit with a generated message, on the current, an existing or a new branch. Never pushes. |

**Workflows** (`workflows/*.js`) are saved scripts that fan a job out over many subagents and merge
the result; `enableWorkflows` in `settings.json` turns them on and each installs as `/<name>`. The
validator compiles each one the way the runtime does (`meta` first, no import, no `Date.now`).
Both exceed the `workflowSizeGuideline` of five agents on purpose, so the "Large workflow" notice
is expected.

| Workflow | Does |
|---|---|
| `workflows/review-large.js` | `/review-large` — `{ range, files?, intent, effort, modelB, filesPerReviewer }`: one `code-reviewer` per group of 6 changed files (`filesPerReviewer`) of a diff too big for one reviewer, at most 8 reviewers per model (above that it refuses and says to narrow `files` or raise `filesPerReviewer`), the spawn count logged before the first one starts, a second model alongside it from `high` effort up (`modelB`: the session's family, passed by the caller), one merger that applies the declared agreement rule and writes one Italian report. |
| `workflows/audit-repos.js` | `/audit-repos` — `{ question, root?, repos? }`: the same read-only question put to every repository under a workspace root, the answers ranked by a rule declared before the fan-out; a repository that could not be read is a gap, never counted as clean. |

## Subagents

Analysis and authoring on their own model boundary, so the main context window stays free. All
default to Sonnet; the caller can override.

| Agent | Does |
|---|---|
| `agents/code-reviewer.md` | Stack-agnostic review — defects, regressions, security, clean code, and whether the change did everything its intent implied — on a `low` to `max` effort ladder. Returns findings, posts nothing. |
| `agents/review-security.md` | Works from the exposed surface inward: entry points, trust boundaries, taint paths, authz, secrets. Same output contract, so results merge. |
| `agents/review-performance.md` | Reasons about cost: complexity, per-item I/O, allocations, blocking, caching, queries. No cost stated, no finding. |
| `agents/investigator.md` | Two modes: `locate` turns a symptom into the exact `file:line` that owns it; `trace` maps a flow across services over the message bus, hop by hop. Read-only. |
| `agents/implementer.md` | Writes production code for a scope the caller already decided, at `effort: high`, so an Opus session plans and reviews while Sonnet types. Contained diff, verified, never commits. |
| `agents/db-analyst.md` | The only holder of database access, and where `/db` runs: a query, plan or schema read through the CLI clients (non-dev hosts only via `db-ro.ps1`), the cause, the index that would change it, and its cost. Applies nothing. |
| `agents/ops-analyst.md` | Logs, metrics, profiles and traces of a running service, and where `/logs` runs: Grafana through an inline MCP server (`GRAFANA_URL`, `GRAFANA_TOKEN`) that never reaches the main conversation, plus compose, containers, kubectl, Aspire and log files. Read-only, redacts secrets. |
| `agents/doc-keeper.md` | Maintains code-derived and experience-derived docs against the source. Active only where the repository actually has a docs tree. |
| `agents/Explore.md` | Overrides the built-in `Explore` so searches run on Sonnet at low effort without CLAUDE.md: `file:line` hits and a one-line conclusion, nothing else. |
| `agents/analyst.md` | Where `/fix-ci`, `/retro` and `/items-qa` run forked: the whole tool set minus Edit and Write (`disallowedTools`), so the file tools are removed rather than merely forbidden (a shell can still write: the agent's rules say what it may create); the skill supplies the task and the report. |

## Hooks

The safety net: it fires whether or not you remembered. Every hook exits 0 on any internal error —
a broken hook must never block work (`worktree-root.js` alone fails loudly: a silent failure would leave the session in a worktree that does not exist) — and each has a dependency-free test in `tools/`.

| Hook | Event | Does |
|---|---|---|
| `hooks/guard-shell.js` | `PreToolUse` | One entry point for every shell guard, sharing `hooks/lib/`. Confirms before a commit or push lands on the repository's default branch, and before an action with no undo — dropping or truncating, dropping a stash, force-removing a worktree, expiring the reflog, dropping a database through the EF tool, flushing a cache, tearing down volumes, pruning, deleting a volume, queue, cloud or cluster resource — **including when it is nested inside a `docker exec`, a `sqlcmd -Q` or a pipeline**, which a permission pattern cannot see. It also **asks** when an Azure DevOps write breaks the ALM contract (`lib/alm-contract.js`: a PR without `--work-items` or without squash and delete-source-branch, a work item without `--assigned-to`, `CompletedWork` written outside `worklog-push.ps1`, `az devops configure --defaults`; and always the PR completion itself, `az repos pr update --status completed` / `--auto-complete` and `gh pr merge`, while the settings allow the other reversible PR and work item writes), **denies** a raw `sqlcmd`, `psql` or `redis-cli` aimed at a non-dev host (`lib/sql-target.js`, pointing at `db-ro.ps1`), and **rewrites** a single `dotnet test`, `dotnet build`, `npm test`, `npx vitest` or non-follow `docker compose logs` through a filter that keeps the failures and the summary (a build: each distinct error and warning once, with a count) (`lib/output-filter.js`; `# raw` anywhere in the command opts out, and so does any other unquoted `#`: a trailing comment would swallow the wrapper). The second rewrite pins the Azure CLI identity (`lib/az-pin.js`): a single plain `az` command that the user-scope `settings.json` allows and no `deny` or `ask` rule there matches (project settings are not read), run in a directory `workspaces.json` maps to an identity, starts with `$env:AZURE_CONFIG_DIR='<dir>'; ` (PowerShell) or `AZURE_CONFIG_DIR='<dir>' ` (Bash); a chained line, or anything the allow list does not cover, is left to the permission flow and to the manual prefix in `azdo-cli`. `az account set` is denied in `settings.json` and asked about here, nested or not. The same words in a comment, a path, a search pattern or a dry run are ignored. |
| `hooks/secret-scan.js` | `PreToolUse` | Blocks a write introducing a provider token, a cloud key, a private key block or a password-bearing connection string, naming the pattern and the line. Placeholders and variable references pass. |
| `hooks/format-on-edit.js` | `PostToolUse` | Formats only the file just written, and does nothing where the project has no such tooling configured. Exits at once on an extension no formatter owns. |
| `hooks/session-brief.js` | `SessionStart` | Four cached lines of orientation: branch and dirty state, last commit, upstream drift, work item (from the branch name). No network call. |
| `hooks/worklog-pending.js` | `SessionStart` (`startup` only) | Names the working days with activity under a mapped workspace root but no `/worklog` audit entry — current month, or current week where it reaches back — and the logged days **under target** (more than an hour short of 8h on a weekday, or of the day's own value in `worklog/targets.json`), and caches the count for the statusline clock badge. Roots come from `CLAUDE_WORKSPACE_ROOTS`; unset means silence. |
| `hooks/workspace-context.js` | `SessionStart` (`startup|resume|clear|compact`) | Turns the session cwd into one `ALM:` context line (platform, org, project or per-subfolder project, az identity, note) from local-only `~/.claude/workspaces.json` (copy `workspaces.example.json`), and pins the Azure CLI identity by exporting `AZURE_CONFIG_DIR` (and `AZ_IDENTITY`, for PowerShell) through `CLAUDE_ENV_FILE`, so two sessions on different orgs never flip each other's default. A map with no matching root prints `ALM: non mappato`; no map, no output. Fires again after `/compact`. |
| `hooks/ensure-edge-cdp.ps1` | `PreToolUse` | Before a `browser-use` tool call, makes sure Edge is running with its CDP port open, starting it if needed. Never blocks. |
| `hooks/context-nudge.js` | `UserPromptSubmit` (through `nudges.js`) | One line into the turn when the context first crosses 120k, 200k and 320k tokens (60 / 100 / 160 % of `CLAUDE_NUDGE_TOKENS`, default 200k), once per band per session; `CLAUDE_NUDGE_STEPS` (comma-separated absolute tokens, e.g. `250000`) replaces the ladder when set and valid. The bands are absolute because a percentage of a 1M window fires too late to matter. The number is the harness's own: `statusline.js` writes it to `~/.claude/.cache/context-<session>.json` whenever a value changes (and at least hourly) and the hook only reads it (a snapshot without a token count falls back to 50 / 70 / 85 %, on windows up to 250k only). With auto-compaction off, nothing else says the window is filling. |
| `hooks/edit-nudge.js` | `PostToolUse` on `Write` and `Edit`, `UserPromptSubmit` (through `nudges.js`) | One line into the turn at the **third edit** the main session makes in one user turn: scope decided -> delegate to `implementer` and review its diff. The count lives in `~/.claude/.cache/edits-<session>.json` and resets on every user prompt; edits made inside a subagent (`agent_id` in the payload, or a transcript under `<session>/subagents/`) are not counted, nor is a file under the system temp directory (the session's scratchpad). A nudge, never a block. |
| `hooks/nudges.js` | `UserPromptSubmit`, `PostToolUse` | The one entry point settings.json wires for `context-nudge.js` and `edit-nudge.js`: reads the payload once, runs the nudges that belong to the event in the same node process and prints their lines as one `additionalContext`. Each nudge still runs alone as a script. |
| `hooks/done-claim.js` | `Stop` | Opt-in (`CLAUDE_DONE_CLAIM=1`). A turn that edited files and ends claiming success — "fatto", "fixed", "passing" (not a bare "passa") — with no shell command run after the last edit and, in the message, no fenced block, quoted output line (a `> **Dettaglio**` block does not count), inline `` `command` → result `` or honest "non verificato" is sent back once to show the evidence. A regex over the final message, no tokens; each trigger is logged with the rule that fired in `~/.claude/.cache/done-claim.log` so false positives can be counted. |
| `hooks/worktree-root.js` | `WorktreeCreate`, `WorktreeRemove` | Puts the harness's own worktrees (`EnterWorktree`, an agent with `isolation: "worktree"`) under `CLAUDE_WORKTREE_ROOT` as `<root>/<repo>-<name>` instead of inside the checkout, away from the Windows path limit; removal refuses a dirty tree and never deletes the branch. Root unset: the native layout. |

## Configuration and tooling

| Path | Purpose |
|---|---|
| `CLAUDE.md` | User instructions, kept under 3 KB because every turn pays for them: the route table, the standing rules, change scope, language, done means verified. Workspace facts come from the `ALM:` line, not from here; the ALM rules that a missing flag breaks are enforced by `lib/alm-contract.js`. |
| `rules/*.md` | Path-scoped facts per stack (C#, tests, EF migrations, TypeScript, Angular, React, SQL, pipelines, docker, kit assets): each loads only when a matching file is read or edited, `paths` as one comma-separated string, 25 lines at most, pointing at the skill that owns the procedure. |
| `output-styles/owner-80-20.md` | Output style for a senior developer who reads fast: decision first in one bold line, the shortest shape that fits, every item of a multi-ask answered in order, stable `#n` numbering, no narration between tools, ask only before the irreversible. Replaces the built-in `Concise`; the template selects it with `"outputStyle": "owner-80-20"` in `settings.json`. |
| `tools/instructions-log.js` | Dev-only `InstructionsLoaded` hook, wired in the repo's own `.claude/settings.local.json`: logs which instruction file loaded and why, to confirm a `paths` rule fires. |
| `settings.json` | Model and fallbacks, environment variables, permission allow/ask/deny rules (`Read` denies on secret-bearing **files** only, never on folders), the hooks, PowerShell as the default shell, workflows (`enableWorkflows`, `workflowSizeGuideline`, `workflowKeywordTriggerEnabled`), the one allow rule for `db-ro.ps1`, `bashOutputMaxChars` (how many characters of one shell result reach the context), enabled plugins, status line, UI preferences. |
| `statusline.js` | Folder — or, inside a linked worktree, the worktree under a tree icon — then git branch and dirty badges, context bar with token count, a cache-cold badge, rate limits with weekly pacing, session cost, model, effort, the unlogged-hours clock badge (also for under-target days), vim mode. Names and branch are hyperlinks. Each render writes the context snapshot `context-nudge.js` reads, under `~/.claude/.cache/`. |
| `scripts/db-ro.ps1` | Read-only access to non-dev databases — SQL Server (go-sqlcmd), PostgreSQL (`psql`), Redis (`redis-cli`): targets from local-only `~/.claude/db-targets.json` (copy `db-targets.example.json`); the client runs native, else in WSL, else through docker (`sqlcmd`: native only); the secret travels in the client's own environment variable for that process only (`WSLENV` forwards it into WSL and is restored afterwards); a permission probe runs first (`-Probe` runs it alone): exit 3 when read-only cannot be proven, exit 4 listing the grants when the credential can write — the user is asked once per target and `-AcceptWriteGrant` then runs on the client-side filter alone (reads only, the header says `readonly=NO`) — and write commands in the query are rejected. `hooks/lib/sql-target.js` denies a raw client at a non-dev host and points here. |
| `db-targets.example.json` | Shape of the local-only `~/.claude/db-targets.json` read by `db-ro.ps1`: workspace root → environment → engine, server, credential reference (`env:NAME` or `envfile:<path>#KEY`), the allowed databases. Placeholders only. |
| `workflows/*.js` | Saved workflows, see above; installed to `~/.claude/workflows/`. |
| `workspaces.example.json` | Shape of the local-only `~/.claude/workspaces.json` read by `hooks/workspace-context.js`: workspace root → platform, org, project (or a subfolder → project map), az identity, account, note. Placeholders only. |
| `settings.overlay.example.json` | Shape of the local-only `~/.claude/settings.overlay.json`: your personal settings on top of `settings.json` (model, output style, extra allow rules, a key removed with `null`). Placeholders only; see "Settings overlay". |
| `tools/merge-settings.mjs` | Dependency-free merge of the `settings.json` template and the overlay (`--template`, `--overlay`, `--out`), and `--check <live>` that lists the keys where the live file is not that merge. |
| `install.ps1` | Idempotent install into the Claude config directory, plus `-Check` (drift and environment report, exit 1 on problems) and `-Pull` (import live edits back into the repo, whole skill folders included). |
| `tools/cost-audit.mjs` | Read-only report on `~/.claude/projects/**/*.jsonl` for a window (`--days`, default 30; `--projects`, `--log`, `--top`): baseline tokens per session, the share of main-thread input spent in turns above 200k and 300k context, Skill loads, tool calls per MCP server, hook injections and the `done-claim` log. Run it before and after a settings or hook change to judge it. |
| `tools/validate.mjs` | Dependency-free CI checks: JSON, front matter, cross-references, machine paths and secrets, the line caps (SKILL.md 120), the body skeleton and contract line, the 25-word `Use when` description, explicit-trigger skills locked with `disable-model-invocation`, reference reachability, pinned versions, the agents' contract and output sections, `memory` only with a write tool, no `commands/` folder, and each saved workflow compiled as the runtime does. |
| `tools/*.test.mjs` | One dependency-free `node:test` file per hook entry point or library (`guard-shell`, `secret-scan`, `format-on-edit`, `session-brief`, `worklog-pending`, `workspace-context`, `worktree-root`, `context-nudge`, `edit-nudge`, `nudges`, `cost-audit`, `done-claim`, `output-filter`, `az-pin`, `merge-settings`, `alm-contract`, `sql-target`, `db-ro`, `review-large`, the worklog scripts), covering the true positives and, the part that matters, the false positives. |
| `evals/<skill>/<case>/` | Automated `claude plugin eval` suites (13 skills so far: `pr-create`, `azdo-cli`, `worklog`, `branch-flow`, `user-story-standard` and the `paths:` skills): a `prompt.md` and `graders/*.md` per case, the skill and its neighbours loaded through `plugins:`. Triggering is `tool_used: Skill` (`min: 1` must load, `min: 0` + `max: 0` must stay out), plus a regex on the answer where cheap. No shell or write tool is granted, so no case can touch Azure DevOps, a database or the network. |
| `evals/skill-triggering.md` | The manual `MUST` / `MUST NOT` rows of the skills with no suite yet, and what a suite cannot express (the `paths:` hidden-until-read gate). The `MUST NOT` rows are the borders between neighbouring assets. |
| `tools/run-evals.ps1` | Runs only the suites whose `skills/<name>/` or `evals/<name>/` changed against `-Base` (default: the remote default branch): `--ablation none` so the triggering graders score, `--no-publish`, `--max-cost-usd` per suite (`-MaxCostUsd`, default 2), reports under `%TEMP%\kit-evals\`. `-List` shows what would run, `-All` / `-Suite` override, `-Runs` / `-Model` tune; about $0.10 per run, so a suite is roughly $0.5 to $1. |
| `mcp/servers.example.json` | The Azure DevOps MCP server the skills fall back to, as a mergeable JSON block, and the note on how the `ops-analyst` Grafana servers are wired. Not installed by copying — see below. |
| `docs/specs/` | The design specs the kit was built from, including the asset contract every asset obeys. |

## What the kit deliberately does not cover

Installed plugins already own these, so no asset restates them — they route to them in one line.

| Area | Owner |
|---|---|
| Redis data modelling, clustering, search, security, observability | `redis-development` (off by default, enabled on demand) |
| Microsoft and .NET API lookup, signatures, samples | `microsoft-docs` |
| Modern web-platform APIs, CSS features, Core Web Vitals | `modern-web-guidance` |
| Visual and UX design | `frontend-design` |
| Cross-session memory | Claude Code's native auto-memory (`memory/` + `MEMORY.md`) |
| Generic skill-authoring machinery | `skill-creator` |
| Semantic navigation in C# and TypeScript | `csharp-lsp`, `typescript-lsp` |

## Requirements

- **Claude Code** (CLI, desktop, or IDE extension).
- **Node.js 18+** and **git** on `PATH` — for the status line, the Node hooks, the validator and the tests.
- **PowerShell 7** as `pwsh` on `PATH` — used by `settings.json` for `ensure-edge-cdp.ps1`, and by the worklog and database scripts.
- **Microsoft Edge** with remote debugging allowed (`edge://inspect`) — only for the `browser-use` plugin, which attaches to Edge's CDP port rather than launching a browser.
- A **Nerd Font** in the terminal — the status line draws its badges with Nerd Font glyphs; without one you get replacement boxes.
- **`az` with the `azure-devops` extension** (`az extension add --name azure-devops`) — the whole ALM pillar depends on the extension specifically. **`gh`**, authenticated, for GitHub repositories.
- **`dotnet`** with the EF tool, **`docker`**, and **`sqlcmd`** (go-sqlcmd: `db-ro.ps1` runs it native only). The diagnostics skill installs the .NET diagnostic tools on demand.
- **Language servers** on `PATH`: `dotnet tool install -g csharp-ls` and `npm i -g typescript typescript-language-server`.
- **`psql` and `redis-cli` are optional**: native, installed in WSL, or run through a container, in that order (`db-ro.ps1` picks the route, preferring an image already present locally over its default `postgres` / `redis` one). `install.ps1 -Check` reports which route each will take.
- `settings.json` and the hooks are Windows and PowerShell oriented; adjust for macOS or Linux.

## Installation

```powershell
.\install.ps1            # install or update the Claude config directory, check prerequisites
.\install.ps1 -Check     # report drift and environment problems, write nothing (exit 1 if any)
.\install.ps1 -Pull      # bring changes made in the live config back into the repo
```

The installer discovers what the repo contains rather than working from a list, so a new asset needs
no change here. It copies but never deletes on its own: it **detects and offers to remove** what the kit no
longer ships and the live config still carries — a `commands/*.md` that now shadows a skill of the same
name, and retired assets (`dev-loop`, `done-check`, `redis-dotnet`, `test-writer`, `az-identity.js`,
`sql-ro.ps1`) — asking for each. It asks before overwriting `CLAUDE.md` or `settings.json` (`-Force` skips the
prompt). Some settings are personal choices worth reviewing first: `"language": "Italian"`;
`model` / `effortLevel` / `alwaysThinkingEnabled` / `advisorModel`, which pick a capability *and* a
cost profile; `voice` and the push notifications; and
`autoCompactEnabled: false` — auto-compaction is off on purpose, and `context-nudge.js` says when to compact
by hand; `outputStyle: "owner-80-20"`, a communication style the template selects; and the keys of the v3 features — `enableWorkflows`, `workflowSizeGuideline` and `workflowKeywordTriggerEnabled: false` (the saved workflows run when typed by name, not when a prompt merely says "workflow"), `bashOutputMaxChars`, and `CLAUDE_DONE_CLAIM` / `CLAUDE_WORKTREE_ROOT` / `CLAUDE_NUDGE_TOKENS` under `env`, all empty in the template (the completion gate and the short worktree root are opt-in; the nudge defaults to 200k tokens).

Then restart Claude Code. `-Check` reports anything that exists only in the live config, which is
the state where a retired skill keeps firing next to its replacement. Without an overlay, `-Check` does
not compare `settings.json`: your copy is a personalised merge of the template, by design. With an
overlay (below) it does.

### Settings overlay

Keep your own choices in `~/.claude/settings.overlay.json` (never in the repo; `settings.overlay.example.json`
shows the shape) and build the live file from the template instead of merging by hand:

```powershell
node tools/merge-settings.mjs --template settings.json --overlay ~/.claude/settings.overlay.json --out ~/.claude/settings.json
node tools/merge-settings.mjs --template settings.json --overlay ~/.claude/settings.overlay.json --check ~/.claude/settings.json
```

| Where | The overlay does |
|-------|------------------|
| objects | merge deeply |
| scalars | the overlay wins |
| arrays of strings (`permissions.allow`, …) | ordered union, template first, no duplicates |
| `hooks.<Event>` | union by matcher and command (`args` included); no hook twice |
| any other array | the overlay replaces it |
| a key set to `null` | the key is removed from the result |

`--check` exits 1 and prints the differing keys (`~` differs, `+` missing from the live file, `-` only in it).
With an overlay, `install.ps1` writes the merge instead of copying the template (asking first when the live
file differs) and `-Pull` never imports `settings.json`; `-Check` runs `--check`, so a template update that
never reached the live file shows up there. A setting the app writes itself (`/config`, `/plugin`, `/model`)
lands only in the live file: copy it into the overlay, or the next install drops it.

## Post-install smoke test

In a new session, started in a directory your `workspaces.json` maps:

1. The first context carries an `ALM:` line naming `<org>`, `<project>` and the az identity.
2. `az account show --query user.name -o tsv`, run through PowerShell, prints `<identity-user>`.
3. `dotnet test` through PowerShell, on a run of over 60 output lines, opens with `[output-filter]` and keeps the run's exit code.
4. `/db "select 1"` against localhost returns `1`.
5. A worktree opened by Claude Code lands under `<CLAUDE_WORKTREE_ROOT>`.
6. `/usage` lists the `Explore` subagent on `sonnet`.

## Plugins

Register the marketplace once, then install each plugin and restart:

```
/plugin marketplace add anthropics/claude-plugins-official
/plugin install redis-development       # Redis, everything but the .NET client (off by default)
/plugin install microsoft-docs          # live Microsoft and .NET documentation
/plugin install modern-web-guidance     # web platform, CSS, Core Web Vitals (off by default: enable on demand)
/plugin install frontend-design         # visual and UX design
/plugin install skill-creator           # generic skill authoring
/plugin install csharp-lsp              # C# semantic navigation (needs csharp-ls on PATH)
/plugin install typescript-lsp          # TypeScript semantic navigation
/plugin install browser-use             # drives the real Edge profile over CDP (see ensure-edge-cdp)
```

Retired on purpose — `settings.json` keeps `remember` off, so an old install does not come back:

| Plugin | Why it is off |
|---|---|
| `remember` | its `PostToolUse` hook runs bash on **every** tool call, about a second each on Windows (upstream issue #913); the native auto-memory covers durable facts |
| `headroom` | a proxy for context compression; native prompt caching does better on long sessions, and it sends telemetry by default |
| `code-review` | GitHub-only and posts on its own; the kit's review agents and the native `/code-review` cover it |

The `superpowers` plugin is deliberately **not** enabled: the seven of its skills worth keeping were
absorbed into the process skills above — compacted, made Windows-native and wired to this stack —
and enabling it alongside them puts two processes in competition for the same moment.

Browser automation is `browser-use` alone: the real Edge profile, visible and already signed in, and one
script batches many steps into one call. The Playwright MCP server and Claude in Chrome were retired:
more tool names in every turn and one round-trip per action. `modern-web-guidance` is off by default
because its description demands a lookup before every frontend task; `angular` and `react` cover the
day-to-day.

A plugin shipping its own MCP server may need extra tooling on the machine. `install.ps1 -Check`
flags plugins enabled in `settings.json` but not actually installed: the state in which their tools
silently do not exist.

## MCP servers

MCP servers do not live in the Claude config directory, so copying files does not install them.
Register them user-scoped, replacing the placeholder with your own organization:

```powershell
claude mcp add --scope user azdo-<org-alias> -- npx -y @azure-devops/mcp <your-org> -d core repositories work-items search
```

One Azure DevOps entry per organization; the skills discover the server at runtime and match the
organization from the git remote, so any naming scheme works.

There is no database MCP server: database access is the CLI (`scripts/db-ro.ps1`, above), so the
credential never enters a tool call and the hook can see the command. **Grafana** is defined inline in
`agents/ops-analyst.md` as two HTTP servers (`grafana-staging`, `grafana-prod`) that exist only inside
that agent and never reach the main conversation. They are not registered with `claude mcp add`: run
the Grafana MCP server in HTTP mode for each environment — its own `GRAFANA_URL` and service-account
token live in *that* process's environment, never in the kit — and serve them on
`http://localhost:8000/mcp` (staging) and `http://localhost:8001/mcp` (prod), the URLs written in the agent's
front matter — another port means editing those two lines.

**CLI first.** A skill reaches for an MCP server only for what the CLI does not have: reading a work
item discussion, attachments, PR comment threads, run logs, full-text search, and a project's work
item types and states. `azdo-cli` lists each one with the reason.

## Environment variables

| Variable | Who needs it | Value |
|---|---|---|
| `CLAUDE_HOOKS` | every hook in `settings.json` | The hooks directory inside your Claude config directory. Hooks run in *exec* form with no shell to expand variables, which is why the Node ones read it themselves. **Without it they fall back to `~/.claude/hooks`**, so a default install keeps every guard on; only a relocated config directory needs it (a hook that cannot be found still exits 0 by design, and `install.ps1 -Check` notices). `install.ps1` sets it at user level. |
| `CLAUDE_WORKSPACE_ROOTS` | `hooks/worklog-pending.js` | The workspace roots whose work is billable, `;`-separated — the same roots as `workspaces.json`. Set in `settings.json` → `env`, empty in the template: **empty means the reminder never fires**. |
| `CLAUDE_WORKSPACE_NESTED` | `hooks/worklog-pending.js` | Folders under a root whose project is the subfolder below them (the per-subfolder shape of the mapping), `;`-separated, so the reminder labels `<root>/<project>`. Optional. |
| `CLAUDE_WORKTREE_ROOT` | `branch-flow` (worktrees) | A short root for every worktree (`<root>/<repo>-<topic>`), keeping deep repos under the Windows path limit. Empty in the template: worktrees go beside the repo. |
| `CLAUDE_DONE_CLAIM` | `hooks/done-claim.js` | `1` turns the completion gate on: a turn that edited files and claims success without evidence is sent back once. Empty in the template (opt-in). |
| `WSLENV` | `scripts/db-ro.ps1` | Not set by you: the script appends the credential variable to it for the one WSL client process and restores it afterwards. Listed because the script reads and writes it. |
| `CLAUDE_CONFIG_DIR` | the hooks, `statusline.js` | Claude Code's own variable; the caches and logs follow a relocated config directory. Rarely set. |
| `COLUMNS` | `statusline.js` | Terminal width for the context bar; falls back to a sane default when unset. |
| `USERPROFILE`, `LOCALAPPDATA` | the PowerShell scripts | Standard Windows variables, listed so the dependency is explicit. |

Everything `settings.json` sets for the session — the auto-compaction threshold, the debug level, the
mouse and notification behaviour, the PowerShell tool, OSC 8 hyperlinks — is documented inline in
that file next to each value.

## Validation

```powershell
node tools/validate.mjs
node --test tools/*.test.mjs
```

Nothing here compiles, so a broken front matter, a hook pointing at an uncommitted file, or a skill
that quietly grew past its cap would only surface when Claude Code stopped loading an asset. Both
commands run in CI on every pull request and on pushes to `main`, alongside a syntax check of the
status line and a parse of every PowerShell script.

## Adapting it to your project

Three things are placeholders on purpose, because this repository is public: **Azure DevOps
organization and project names**, **absolute machine paths**, and **addresses**. Replace them in the
local-only `workspaces.json` (from `workspaces.example.json`), in `CLAUDE_WORKSPACE_ROOTS` / `CLAUDE_WORKSPACE_NESTED` in
`settings.json`, and in `mcp/servers.example.json`.

Everything else is meant to be opinionated. If a pattern does not match your project, change the
skill — `skill-forge` tells you how to do it without breaking the contract, and the validator tells
you if you did.

## License

[MIT](LICENSE) © 2026 Davide Piccinini
