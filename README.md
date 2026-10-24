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
| **Knowledge** | not re-deciding what was decided once | 33 skills, depth in reference files loaded on demand |
| **Exploration** | finding context without burning the main context window | 10 subagents |
| **Execution** | running a known sequence in one shot | 8 one-shot skills (`/name`), 3 saved workflows |
| **Safety net** | not forgetting, and not doing the irreversible | 14 hook files (`nudges.js` runs four of them), the completion gate, the validator |

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
| `skills/deliver/SKILL.md` | Every code change from triage to verdict: scenario and size, a doubts pass before the loop on M and L (a question only when its answer changes behaviour), a written perimeter (per worktree, in the git dir), acceptance criteria with their proof (scaled by size) before the edit, the `impl-review-loop` workflow once per coherent request (size S: the session edits inline, the loop only reviews), the mechanical `scope-guard.js --check` after an `OK`, tests by level run in the main session, a proof check of the criteria's tests, a verdict block (with the defaults chosen and a proposed local test) and a table of what was left outside. References for the scenarios and for perf baselines. |
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
| `skills/retro/SKILL.md` | `/retro [session] [focus]`, forked — retrospective on a session: classifies every friction event and proposes the environment fix (an automated check first, then pointer, hook, skill, access). Proposes only. A monthly step reviews asset usage (`/skill-doctor`, `/doctor prompt-audit`) and the automatic warnings' false-positive rate; the `findings` focus reads the `deliver` findings log and proposes at most five implementer-rule lines for the owner to approve. |
| `skills/commit/SKILL.md` | `/commit` — a commit with a generated message, on the current, an existing or a new branch. Never pushes. |

**Workflows** (`workflows/*.js`) are saved scripts that fan a job out over many subagents and merge
the result; `enableWorkflows` in `settings.json` turns them on and each installs as `/<name>`. The
validator compiles each one the way the runtime does (`meta` first, no import, no `Date.now`).
All three exceed the `workflowSizeGuideline` of five agents on purpose (`impl-review-loop` by design: one implementer, up to four reviewers in round 1, up to five in a delta round, a convergence stop on the fixes), so the "Large workflow" notice
is expected.

| Workflow | Does |
|---|---|
| `workflows/review-large.js` | `/review-large` — `{ range, files?, intent, effort, modelB, filesPerReviewer }`: one `code-reviewer` per group of 6 changed files (`filesPerReviewer`) of a diff too big for one reviewer, at most 8 reviewers per model (above that it refuses and says to narrow `files` or raise `filesPerReviewer`), the spawn count logged before the first one starts, a second model alongside it from `high` effort up (`modelB`, default `opus`), one merger that applies the declared agreement rule and writes one Italian report. |
| `workflows/impl-review-loop.js` | `impl-review-loop` — `{ brief, request, decisions, perimeter, repoRoot, start, size, risk, inline, changed, verify, stackSkill, implementerEffort, preview, resolutions }`: `implementer` (or, with `inline`, the files the session edited), then reviewers by size (S one Sonnet, M one Sonnet at high, L Sonnet and Opus at high). The size comes from the triage and the `risk` axes (`logic`, `data`, `money`, `concurrency`, `contract`, `security`, `performance`) only raise its floor: data, money, concurrency, contract or security → at least M, three axes → L; `security` and `performance` also add their specialists at M and L; the file count never changes the size, it only splits the reviewers (8 files each) and, past what the size implies, adds a `gaps` line, a fix of the open P1/P2 inside the perimeter and a re-review of the delta, until none is open. One run per coherent request. The whole panel reads round 1, a delta round only the reviewers that raised the open findings plus one Sonnet at medium; after a review fix the whole panel reads the cumulative fix diff once (skipped when every panel reviewer already read every fix delta), then one cleanup pass fixes the P3 findings inside the perimeter and a Sonnet reads its delta (neither at S). A file past 600 lines, or 200+ lines at the start that grew by 30%, becomes a split proposal from `snapshot.ps1`'s line counts (listed apart, never fixed). Only the files changed since `start` are reviewed and the user's dirty files are never reverted; every implementer and fixer run ends with `scripts/snapshot.ps1`. The `verify` command is a gate: a failing run becomes a synthetic P1 `V<n>` and the loop cannot end `OK` until it passes. It ends `OK` or `STALL` (`question`, `still-open`, `reappeared`, `no-verdict`, `not-reproduced`, `disputed`, `churn`, `not-converging`, a verify stall, `gap`, `widen`, each with its history); a relaunch with `resumeFromRunId` and every `resolutions` entry so far carries on after the user's answer (`skills/deliver/references/stall.md`, read only on a stall). The round decision is plain code (tested). Returns status, rounds, open and out-of-scope findings, `cleaned`, the `defaults` the agents chose, the files changed and `findingsLog`, which the session passes to `perimeter.ps1 -Close -FindingsLog`; after an `OK` the session runs `hooks/scope-guard.js --check`. |
| `workflows/audit-repos.js` | `/audit-repos` — `{ question, root?, repos? }`: the same read-only question put to every repository under a workspace root, the answers ranked by a rule declared before the fan-out; a repository that could not be read is a gap, never counted as clean. |

## Subagents

Analysis and authoring on their own model boundary, so the main context window stays free. All
default to Sonnet, except `Explore` (Haiku); the caller can override.

| Agent | Does |
|---|---|
| `agents/code-reviewer.md` | Stack-agnostic review — defects, regressions, security, clean code, and whether the change did everything its intent and the owner's own request implied (a vacuous test named as a criterion's proof is a P2; a file past 600 lines, or 200+ lines that grew by 30%, gets a split proposal; a comment's wording alone is no finding, a vacuous comment is a P3 to delete) — on a `low` to `max` effort ladder. Returns findings, posts nothing. |
| `agents/review-security.md` | Works from the exposed surface inward: entry points, trust boundaries, taint paths, authz, secrets. Same output contract, so results merge. |
| `agents/review-performance.md` | Reasons about cost: complexity, per-item I/O, allocations, blocking, caching, queries. No cost stated, no finding. |
| `agents/investigator.md` | Two modes: `locate` turns a symptom into the exact `file:line` that owns it; `trace` maps a flow across services over the message bus, hop by hop. Read-only. |
| `agents/implementer.md` | Writes production code for a scope the caller already decided, at `effort: medium` (the brief may ask for `high`), so an Opus session plans and reviews while Sonnet types. Contained diff, verified, never commits, comments only for a non-obvious why; the non-trivial choices the brief did not state come back as `defaults`, and an owner decision in the brief binds it. |
| `agents/db-analyst.md` | The only holder of database access, and where `/db` runs: a query, plan or schema read through the CLI clients (non-dev hosts only via `db-ro.ps1`), the cause, the index that would change it, and its cost. Applies nothing. |
| `agents/ops-analyst.md` | Logs, metrics, profiles and traces of a running service, and where `/logs` runs: Grafana through an inline MCP server (`GRAFANA_URL`, `GRAFANA_TOKEN`) that never reaches the main conversation, plus compose, containers, kubectl, Aspire and log files. Read-only, redacts secrets. |
| `agents/doc-keeper.md` | Maintains code-derived and experience-derived docs against the source. Active only where the repository actually has a docs tree. |
| `agents/Explore.md` | Overrides the built-in `Explore` so searches run on Haiku at medium effort without CLAUDE.md: `file:line` hits and a one-line conclusion, nothing else. |
| `agents/analyst.md` | Where `/fix-ci`, `/retro` and `/items-qa` run forked: the whole tool set minus Edit and Write (`disallowedTools`), so the file tools are removed rather than merely forbidden (a shell can still write: the agent's rules say what it may create); the skill supplies the task and the report. |

## Hooks

The safety net: it fires whether or not you remembered. Every hook exits 0 on any internal error —
a broken hook must never block work (`worktree-root.js` alone fails loudly: a silent failure would leave the session in a worktree that does not exist). The other exceptions are `guard-shell.js` and `secret-scan.js`, which run with `onFailure: "block"`: a missing or unloadable script blocks the call (requires Claude Code 2.1.308 or later), while a runtime error inside them still approves, by design. Each has a dependency-free test in `tools/`.

| Hook | Event | Does |
|---|---|---|
| `hooks/guard-shell.js` | `PreToolUse` | One entry point for every shell guard, sharing `hooks/lib/`. Confirms before a commit or push lands on the repository's default branch, and before an action with no undo — dropping or truncating, dropping a stash, force-removing a worktree, expiring the reflog, dropping a database through the EF tool, flushing a cache, tearing down volumes, pruning, deleting a volume, queue, cloud or cluster resource — **including when it is nested inside a `docker exec`, a `sqlcmd -Q` or a pipeline**, which a permission pattern cannot see. It also **asks** when an Azure DevOps write breaks the ALM contract (`lib/alm-contract.js`: a PR without `--work-items` or without squash and delete-source-branch, a work item without `--assigned-to`, `CompletedWork` written outside `worklog-push.ps1`, `az devops configure --defaults`; and always the PR completion itself, `az repos pr update --status completed` / `--auto-complete` and `gh pr merge`, while the settings allow the other reversible PR and work item writes), **denies** a raw `sqlcmd`, `psql` or `redis-cli` aimed at a non-dev host (`lib/sql-target.js`, pointing at `db-ro.ps1`) and a shell read (`Get-Content`, `cat`, `grep`, `find -exec`) of a secret file such as `.env`, a key or a token cache (`lib/secret-read.js`: the `Read` deny rules do not cover the shell), **asks** before a `docker cp` that overwrites a host file outside the working directory or under `~/.claude` (`lib/docker-cp.js`), a push that deletes or forces a ref, a recursive or forced delete and a `git switch --force` (`lib/destructive.js`), and **rewrites** a single `dotnet test`, `dotnet build`, `npm test`, `npx vitest` or non-follow `docker compose logs` through a filter that keeps the failures and the summary (a build: each distinct error and warning once, with a count) (`lib/output-filter.js`; `# raw` anywhere in the command opts out, and so does any other unquoted `#`: a trailing comment would swallow the wrapper). The second rewrite pins the Azure CLI identity (`lib/az-pin.js`): a single plain `az` command that the user-scope `settings.json` allows and no `deny` or `ask` rule there matches (project settings are not read), run in a directory `workspaces.json` maps to an identity, starts with `$env:AZURE_CONFIG_DIR='<dir>'; ` (PowerShell) or `AZURE_CONFIG_DIR='<dir>' ` (Bash); a chained line, or anything the allow list does not cover, is left to the permission flow and to the manual prefix in `azdo-cli`. `az account set` is denied in `settings.json` and asked about here, nested or not. The same words in a comment, a path, a search pattern or a dry run are ignored. |
| `hooks/agent-guard.js` | `PreToolUse` (`Agent\|Task`) | Denies a subagent spawn with no `subagent_type`, and a `general-purpose` or `claude` spawn with no `model` (it would inherit the session model, often Opus). Any other spawn passes in silence; an error lets it through. |
| `hooks/secret-scan.js` | `PreToolUse` | Blocks a write introducing a provider token, a cloud key, a private key block or a password-bearing connection string, naming the pattern and the line. Placeholders and variable references pass. |
| `hooks/format-on-edit.js` | `PostToolUse` (through `nudges.js`) | Formats only the file just written, and does nothing where the project has no such tooling configured. Exits at once on an extension no formatter owns. |
| `hooks/session-brief.js` | `SessionStart` | Four cached lines of orientation: branch and dirty state, last commit, upstream drift, work item (from the branch name), plus one line when the `deliver` findings log (`<git-dir>/deliver/findings.jsonl`) shows a category recurring 5+ times since the last retro or a file with 3+ open P3 findings; failing that, a `/retro` line once 3+ runs follow the last retro marker (appended to the findings-log line when that one fires). No network call. |
| `hooks/worklog-pending.js` | `SessionStart` (`startup` only) | Names the working days with activity under a mapped workspace root but no `/worklog` audit entry — current month, or current week where it reaches back — and the logged days **under target** (more than an hour short of 8h on a weekday, or of the day's own value in `worklog/targets.json`), and caches the count for the statusline clock badge. Roots come from `CLAUDE_WORKSPACE_ROOTS`; unset means silence. |
| `hooks/workspace-context.js` | `SessionStart` (`startup|resume|clear|compact`) | Turns the session cwd into one `ALM:` context line (platform, org, project or per-subfolder project, az identity, note) from local-only `~/.claude/workspaces.json` (copy `workspaces.example.json`), and pins the Azure CLI identity by exporting `AZURE_CONFIG_DIR` (and `AZ_IDENTITY`, for PowerShell) through `CLAUDE_ENV_FILE`, so two sessions on different orgs never flip each other's default. A map with no matching root prints `ALM: non mappato`; no map, no output. Fires again after `/compact`. |
| `hooks/ensure-edge-cdp.ps1` | `PreToolUse` | Before a `browser-use` tool call, makes sure Edge is running with its CDP port open, starting it if needed. Never blocks. |
| `hooks/context-nudge.js` | `UserPromptSubmit` (through `nudges.js`) | Off by default: runs only when `CLAUDE_NUDGE_STEPS` (comma-separated absolute tokens, e.g. `250000`) is set and valid; then one line into the turn when the context first crosses each step, once per step per session. The steps are absolute because a percentage of a 1M window fires too late to matter. The number is the harness's own: `statusline.js` writes it to `~/.claude/.cache/context-<session>.json` whenever a value changes (and at least hourly) and the hook only reads it (a snapshot without a token count falls back to 50 / 70 / 85 %, on windows up to 250k only). |
| `hooks/edit-nudge.js` | `PostToolUse` on `Write`, `Edit`, `MultiEdit`, `UserPromptSubmit` (through `nudges.js`) | One line into the turn at the **third edit** the main session makes in one user turn: scope decided -> delegate to `implementer` and review its diff. The count lives in `~/.claude/.cache/edits-<session>.json` and resets on every user prompt; edits made inside a subagent (`agent_id` in the payload, or a transcript under `<session>/subagents/`) are not counted, nor is a file under the system temp directory (the session's scratchpad). A nudge, never a block. |
| `hooks/scope-guard.js` | `PostToolUse` on `Edit`, `Write` and `MultiEdit` (through `nudges.js`) | When a `deliver` perimeter is active, one line into the turn for an edit of a file outside it: note it and ask the user (inside a subagent: note it under Noticed). The perimeter is one file per worktree, `$(git rev-parse --git-dir)/deliver/perimeter.md` (never committed): `branch:`, `status: active`, then `- <path | dir/ | glob>` lines, repo-relative, anchored at the root and case-insensitive; `deliver` overwrites it at each triage and sets `status: closed` at the verdict. No file, a closed one, another branch's, no git repository, or a plan file: silence. A nudge, never a block. |
| `hooks/nudges.js` | `UserPromptSubmit`, `PostToolUse` | The one entry point settings.json wires for `context-nudge.js`, `edit-nudge.js`, `scope-guard.js` and `format-on-edit.js` (the formatter is part of this dispatcher, not a hook of its own): reads the payload once, runs the nudges that belong to the event in the same node process and prints their lines as one `additionalContext`. Each nudge still runs alone as a script. |
| `hooks/done-claim.js` | `Stop` | On in the template (`CLAUDE_DONE_CLAIM=1`; empty turns it off). A turn that edited files and ends claiming success — "fatto", "fixed", "passing" (not a bare "passa") — with no shell command run after the last edit and, in the message, no fenced block, quoted output line (a `> **Dettaglio**` block does not count), inline `` `command` → result ``, honest "non verificato" or a `deliver` verdict block (a `Livello | Comando | Riga che decide | Stato` table with a filled `fatto` or `failed` row) is sent back once to show the evidence. The transcript is read backward in 512 KB chunks to the start of the turn (cap 8 MB); a verdict table of a turn still cut is sent back once to be rewritten with fresh output (fail closed). A verdict table written while the repo's `deliver` perimeter is still `status: active` on the current branch is sent back once to close it with `-FindingsLog` first. A regex over the final message, no tokens; each trigger is logged with the rule that fired in `~/.claude/.cache/done-claim.log` so false positives can be counted. |
| `hooks/worktree-root.js` | `WorktreeCreate`, `WorktreeRemove` | Puts the harness's own worktrees (`EnterWorktree`, an agent with `isolation: "worktree"`) under `CLAUDE_WORKTREE_ROOT` as `<root>/<repo>-<name>` instead of inside the checkout, away from the Windows path limit; removal refuses a dirty tree and never deletes the branch. Root unset: the native layout. |

## Configuration and tooling

| Path | Purpose |
|---|---|
| `CLAUDE.md` | User instructions, kept under 3 KB because every turn pays for them: the route table, the standing rules, change scope, language, done means verified. Workspace facts come from the `ALM:` line, not from here; the ALM rules that a missing flag breaks are enforced by `lib/alm-contract.js`. |
| `rules/*.md` | Path-scoped facts per stack (C#, tests, EF migrations, TypeScript, Angular, React, SQL, pipelines, docker, kit assets): each loads only when a matching file is read or edited, `paths` as one comma-separated string, 25 lines at most, pointing at the skill that owns the procedure. |
| `output-styles/owner-80-20.md` | Output style for a senior developer who reads fast: decision first in one bold line, the shortest shape that fits, every item of a multi-ask answered in order, stable `#n` numbering, no narration between tools, ask only before the irreversible. Replaces the built-in `Concise`; the template selects it with `"outputStyle": "owner-80-20"` in `settings.json`. |
| `tools/instructions-log.js` | Dev-only `InstructionsLoaded` hook, wired in the repo's own `.claude/settings.local.json`: logs which instruction file loaded and why, to confirm a `paths` rule fires. |
| `settings.json` | Model and fallbacks, environment variables, permission allow/ask/deny rules (`Read` denies on secret-bearing **files** only, never on folders), the hooks, PowerShell as the default shell, workflows (`enableWorkflows`, `workflowSizeGuideline`, `workflowKeywordTriggerEnabled`), the one allow rule for `db-ro.ps1`, `bashOutputMaxChars` (how many characters of one shell result reach the context), enabled plugins, status line, UI preferences. |
| `loop.md` | Maintenance prompt that a bare `/loop` runs (installed at `~/.claude/loop.md` like any root file): PR status and active threads, the branch's latest pipeline run, `/fix-ci` suggested when red; read-only. Runs only when the owner types `/loop`: the assistant never starts, schedules or suggests it. |
| `statusline.js` | Model and effort first, then the folder — or, inside a linked worktree, the worktree under a tree icon — git branch and dirty badges, context bar with token count, the 5h and 7d rate-limit windows with weekly pacing, session cost always shown; a second line only when it has something: the unlogged-hours clock badge (also for under-target days), a cache-cold badge, vim mode. Segments are joined by a dim dot, no brackets; names and branch are hyperlinks. Each render writes the context snapshot `context-nudge.js` reads, under `~/.claude/.cache/`. With the optional cockpit mod (below) it also shows the last turn's cost and agents and tasks badges. |
| `mods/cockpit/` | The cockpit mod (a Claude Code plugin, see "Cockpit mod"), installed to `~/.claude/mods/cockpit` like `scripts/`. |
| `tools/cockpit-icon.mjs` | Dependency-free generator of the cockpit mod's `.claude-plugin/icon.png` (512x512 dial): `node tools/cockpit-icon.mjs [out.png]`. |
| `scripts/db-ro.ps1` | Read-only access to non-dev databases — SQL Server (go-sqlcmd), PostgreSQL (`psql`), Redis (`redis-cli`): targets from local-only `~/.claude/db-targets.json` (copy `db-targets.example.json`), by project → environment → engine (`-Env prod -Engine postgres`, `-Project` a name or a path), any string value able to embed `${VAR}` (the project's env file, then the environment) and a Postgres block able to take a `url`; the client runs native, else in WSL, else through docker (`sqlcmd`: native only); the secret travels in the client's own environment variable for that process only (`WSLENV` forwards it into WSL and is restored afterwards); a permission probe runs first (`-Probe` runs it alone): exit 3 when read-only cannot be proven, exit 4 listing the grants when the credential can write — the user is asked once per target and `-AcceptWriteGrant` then runs on the client-side filter alone (reads only, the header says `readonly=NO`) — and write commands in the query are rejected. An environment may set `"readOnly": false` only on a dev host (`devHosts` plus the loopback names; any other host is exit 2 before connecting): no probe and no read filter, the header says `readonly=NO(local)`, the escape filters stay. `hooks/lib/sql-target.js` denies a raw client at a non-dev host and points here. |
| `scripts/snapshot.ps1` | Run beside `perimeter.ps1` as the last step of every `impl-review-loop` implementer and fixer (`-Since <previous tree or start head> -Start <start head> -Dirty <files>`): prints `{ tree, files, churn, big }` of the working tree from a throwaway git index, so the user's index and tree are never touched; `big` lists the changed text files past 600 lines, or with 200+ lines at the start that grew by 30% (the loop turns each into a split proposal). |
| `scripts/perimeter.ps1` | Writes (`-Files a,b,c`) or closes (`-Close`) the `deliver` perimeter of the current worktree: `<git dir>/deliver/perimeter.md`, bound to the checked-out branch, stamped `opened:` (UTC), UTF-8 without BOM, linked worktrees included. `-Close -FindingsLog '<json>' [-Run <id>] [-Tokens <n>]` first appends one line (the loop's findings log plus `at`, `run`, `minutes`, `tokens`) to `<git dir>/deliver/findings.jsonl`; `-LogRun '<json>'` appends the same line without closing (a change with several runs; `minutes` count from the previous logged run); a bare `-Close` needs a run logged since `opened:`, `-FindingsLog` or `-NoFindings` (a change that never ran the loop), else exit 2. The settings allow exactly this script. |
| `db-targets.example.json` | Shape of the local-only `~/.claude/db-targets.json` read by `db-ro.ps1`: project → environment → engine (`sql`, `postgres`, `redis`), `${VAR}` values for the secrets, the allowed databases, `readOnly`. Placeholders only. |
| `workflows/*.js` | Saved workflows, see above; installed to `~/.claude/workflows/`. |
| `workspaces.example.json` | Shape of the local-only `~/.claude/workspaces.json` read by `hooks/workspace-context.js`: workspace root → platform, org, project (or a subfolder → project map), az identity, account, note. Placeholders only. |
| `settings.overlay.example.json` | Shape of the local-only `~/.claude/settings.overlay.json`: your personal settings on top of `settings.json` (model, output style, extra allow rules, a key removed with `null`). Placeholders only; see "Settings overlay". |
| `tools/merge-settings.mjs` | Dependency-free merge of the `settings.json` template and the overlay (`--template`, `--overlay`, `--out`), and `--check <live>` that lists the keys where the live file is not that merge. |
| `install.ps1` | Idempotent install into the Claude config directory, plus `-Check` (drift and environment report, exit 1 on problems) and `-Pull` (import live edits back into the repo, whole skill folders included). |
| `tools/cost-audit.mjs` | Read-only report on `~/.claude/projects/**/*.jsonl` for a window (`--days`, default 30; `--projects`, `--log`, `--top`): baseline tokens per session, the share of main-thread input spent in turns above 200k and 300k context, Skill loads, tool calls per MCP server, hook injections and the `done-claim` log. Run it before and after a settings or hook change to judge it. |
| `tools/validate.mjs` | Dependency-free CI checks: JSON, front matter, cross-references, machine paths and secrets, the line caps (SKILL.md 120), the body skeleton and contract line, the 25-word `Use when` description, explicit-trigger skills locked with `disable-model-invocation`, reference reachability, pinned versions, the agents' contract and output sections, `memory` only with a write tool, no `commands/` folder, and each saved workflow compiled as the runtime does. |
| `tools/*.test.mjs` | One dependency-free `node:test` file per hook entry point or library (`guard-shell`, `secret-scan`, `secret-read`, `format-on-edit`, `session-brief`, `worklog-pending`, `workspace-context`, `worktree-root`, `context-nudge`, `edit-nudge`, `scope-guard`, `perimeter`, `snapshot`, `impl-review-loop`, `nudges`, `cost-audit`, `done-claim`, `output-filter`, `az-pin`, `merge-settings`, `alm-contract`, `sql-target`, `db-ro`, `review-large`, the worklog scripts), covering the true positives and, the part that matters, the false positives. |
| `evals/<skill>/<case>/` | Automated `claude plugin eval` suites (18 suites so far: `pr-create`, `azdo-cli`, `worklog`, `branch-flow`, `user-story-standard` and the `paths:` skills): a `prompt.md` and `graders/*.md` per case, the skill and its neighbours loaded through `plugins:`. Triggering is `tool_used: Skill` (`min: 1` must load, `min: 0` + `max: 0` must stay out), plus a regex on the answer where cheap. No shell or write tool is granted, so no case can touch Azure DevOps, a database or the network. |
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

- **Claude Code 2.1.308 or later** (CLI, desktop, or IDE extension) — `guard-shell.js` and `secret-scan.js` use `onFailure: "block"`.
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
`autoCompactEnabled: true` — auto-compaction manages the window in the template; the opt-in `context-nudge.js` (`CLAUDE_NUDGE_STEPS`) can add a line when the context crosses a step; `outputStyle: "owner-80-20"`, a communication style the template selects; and the keys of the v3 features — `enableWorkflows`, `workflowSizeGuideline`, `skipWorkflowUsageWarning` with an allow rule for `Workflow(impl-review-loop)` (the loop `deliver` launches runs without a prompt), and `workflowKeywordTriggerEnabled: false` (the saved workflows run when typed by name, not when a prompt merely says "workflow"), `bashOutputMaxChars`, and `CLAUDE_DONE_CLAIM` (`1`, the completion gate is on) / `CLAUDE_WORKTREE_ROOT` under `env`, the latter empty in the template (the short worktree root is opt-in).

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
6. `/usage` lists the `Explore` subagent on `haiku`.

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

## Cockpit mod

`mods/cockpit/` is a plugin that adds a side pane beside the chat: an always-visible header and four tabs. `settings.json` loads it with `CLAUDE_CODE_PLUGIN_DIRS` (`~/.claude/mods/cockpit`) and `install.ps1` copies the folder to `~/.claude/mods/` like any asset (`-Check` compares it, `-Pull` imports it, except the engine-generated `.claude-plugin/types/`).

- `/cockpit` opens the pane. It is closed by default; the `x` in the pane closes it and the status line comes back (while the pane is open the status line prints an empty line, since the pane carries the same data). The content is at most 60 columns wide with one column of margin on each side; everything truncates or wraps to it.
- Header, above the tab bar on every tab: model, effort, what Claude is doing (idle, working, thinking, a tool by name, waiting for a permission), the session cost and the last round's cost; the folder (a plain folder, a repository or a linked worktree icon), the branch with ahead/behind and the compact git state; the `ALM <org> / <project> · <identity>` line resolved from `workspaces.json`; the context bar (a red warning from 80 %), the 5h and 7d credits with the burn-rate line, the cache hit of the last turn (green from 80 %, amber from 50 %, red below) and the autocompact forecast `~N richieste` (from the average context growth of the last main turns; absent with fewer than two).
- Four tabs, the selected one kept across reloads: `Agenti` (one block per live agent: state, type and description, model with an asked-against-got warning, effort, tokens in/out/cache, time, share of the session's tokens, the tool running now; then the `STORICO` of the finished ones; pressing a row opens that agent's transcript); `Contesto` (the breakdown by category from `usage({ breakdown: 'summary' })`, the five biggest static consumers, the skills invoked, a sparkline of the context per round and `conviene compattare` when it fits; `conteggio esatto` runs the `full` breakdown, which spends token-count requests, so only on press); `Lavoro` (a `●` when worklog hours are pending or under target; the changed files with `+/-`, pressing one opens a second pane `cockpit-diff`; the deliver perimeter and the files outside it; the session tasks; the last 8 tools of the main loop; the pull requests of this chat; a running workflow; the last hook triggers from `done-claim.log`); `Sistema` (CPU, RAM and network with sparklines, disk, power, and the session's child processes with their listening ports).
- Refresh tiers: fast (2 s) only while `Agenti` or `Lavoro` is selected, for the elapsed times; medium (10 s) for git, whenever the pane is open; slow (30 s) for the state file's heartbeat, the ALM line, the worklog and the done-claim log. The pull request and the repo's default branch are read at most every 5 min in the background: `gh pr view` on GitHub; on Azure DevOps `az repos pr list` with the org of the ALM line and the az config folder of its identity (`~/.azure-<identity>`, when present), never the CLI default (no checks are shown there). No CLI or no PR: nothing is drawn.
- `Sistema` runs only while it is selected: `$.process.spawn` starts one child, `mods/cockpit/sysmon/sysmon.mjs`, when the tab opens and ends it when the tab or the pane closes. It prints one JSON line every 2 s (CPU, RAM, network rate from `netstat -e`), the child processes and ports every 10 s, the disk every 30 s and the power source once; ticks never overlap. Network, processes and power are read on Windows only; a part that cannot be read, or a child that cannot start, reads `non disponibile`.
- Session data: what must survive a resume (the history of finished agents, the pull requests of the chat, the quick note, the context samples of the sparkline and the forecast) lives in `~/.claude/.cache/cockpit-data-<session>.json`, written like the state file (at most every 3 s) and read when the session starts or resumes; an agent still running when its session ended is marked with a dim `■` (interrotto). A state file from before the data file hands its history and pull requests over once.
- Cleanup: the status line's hourly prune keeps `cockpit-data-<session>.json` while `~/.claude/projects/*/<session>.jsonl` exists (sessions are kept `cleanupPeriodDays`, 90 days by default) and deletes it when the transcript is gone, checked with one directory listing per project folder; nothing is deleted when the projects folder cannot be listed. `cockpit-<session>.json` stays the 3-day handshake with the status line.
- Alerts, as `$.ui.toast`, each once per episode (raised again only after the cause cleared): context at 80 % or more, 5h credits at 10 % left or less, a subagent that failed, the checks of a pull request that turned red. What a session was resumed with is not news and raises nothing.
- Quick note: a two-row field under the tab bar, saved with the session data. `invia` (the button, or Enter in the field) appends the note to the prompt box with `$.prompt.fill` and clears it; it never submits, so the person decides. A prompt box that refuses the text keeps the note.
- Buttons on the last row of every tab: `compatta` runs the compaction with instructions (what to keep: current task, decisions and why, open tasks, the active perimeter; what to drop: summarized tool output), `segna ore` runs `/worklog oggi sessione <id>` for the hours of this chat, `invia` shows while the note holds something.
- Credit rows read `63% 5h ↻  2h10m`: percentage first, then a 6-cell countdown (`   45m`, ` 2h14m`, ` 3d06h`), no reset clock. Under the 5h row the burn-rate line (from 30 min of samples, at least 10 min): `−9%/h · finisce tra  6h50m: arrivi al reset` in green, `−31%/h · finisce tra  1h40m, prima del reset` in red; no line with fewer samples.
- The mod writes the handshake to `~/.claude/.cache/cockpit-<session>.json` (pane open or closed, tab, last turn cost, agent counts, tasks, token counts); `statusline.js` only reads it. The pane counts as open for the status line only while the mod refreshes it (every 30 s, `at`); an `open: true` older than 45 s is ignored, so a reloaded mod never leaves the line hidden. `statusLine.refreshInterval` is `2` in the template, so the line picks up the pane state and the running agents without waiting for the next message.
- `~/.claude/mods` is kit-owned: `install.ps1` copies the whole mod there, tests and check included, and a later install overwrites local edits (change the repo, not the live copy).
- The status line caches the git results per folder for 5 s under `~/.claude/.cache/` and writes its rate-limit cache only when a value changes, so a short `refreshInterval` stays cheap.
- `statusline.js` works without the mod: no state file means no cockpit segments and the line never hides.
- The icon `.claude-plugin/icon.png` is generated by `node tools/cockpit-icon.mjs` (no dependencies).
- Check: `claude plugin test mods/cockpit`, `claude plugin validate mods/cockpit` and `node --test tools/statusline-cockpit.test.mjs` (the status line on a sample payload in each cockpit state, and the cache pruning).

## MCP servers

MCP servers do not live in the Claude config directory, so copying files does not install them.
Register them user-scoped, replacing the placeholder with your own organization:

```powershell
npm install -g @azure-devops/mcp
claude mcp add --scope user azdo-<org-alias> -- mcp-server-azuredevops <your-org> -d core repositories work-items search
```

The global install starts the server in about a second; `npx -y` checks the registry at every
session start and can hit the MCP connect timeout. Update it with `npm install -g @azure-devops/mcp@latest`.

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
| `CLAUDE_DONE_CLAIM` | `hooks/done-claim.js` | `1` turns the completion gate on: a turn that edited files and claims success without evidence is sent back once. `1` in the template; empty turns it off. |
| `CLAUDE_NUDGE_STEPS` | `hooks/context-nudge.js` | Comma-separated absolute token counts (e.g. `250000`) at which the hook adds one line to the turn. Empty in the template: **empty or invalid means the hook is silent** and auto-compaction alone handles the window. |
| `WSLENV` | `scripts/db-ro.ps1` | Not set by you: the script appends the credential variable to it for the one WSL client process and restores it afterwards. Listed because the script reads and writes it. |
| `CLAUDE_CONFIG_DIR` | the hooks, `statusline.js` | Claude Code's own variable; the caches and logs follow a relocated config directory. Rarely set. |
| `COLUMNS` | `statusline.js` | Terminal width for the context bar; falls back to a sane default when unset. |
| `USERPROFILE`, `LOCALAPPDATA` | the PowerShell scripts | Standard Windows variables, listed so the dependency is explicit. |

Everything `settings.json` sets for the session — the auto-compaction threshold, the debug level, the
mouse and notification behaviour, the PowerShell tool, OSC 8 hyperlinks — is documented inline in
that file next to each value.

## Habits

- `/btw` for a side question: it answers without polluting the working context.
- `/branch` to try an alternative without losing the current conversation.
- `/rewind` before a risky attempt, so a bad turn is undone rather than argued away.

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
