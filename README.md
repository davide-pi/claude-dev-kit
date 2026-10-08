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
| **Routing** | which asset owns this task | `dev-loop`, plus the rules in `CLAUDE.md` |
| **Knowledge** | not re-deciding what was decided once | 26 skills, depth in reference files loaded on demand |
| **Exploration** | finding context without burning the main context window | 7 subagents |
| **Execution** | running a known sequence in one shot | 8 slash commands |
| **Safety net** | not forgetting, and not doing the irreversible | 6 hooks, the completion gate, the validator |

Two rules govern all of them, and they live in `CLAUDE.md` so they apply without being triggered:
**start at `dev-loop`**, and **try the CLI before the MCP server, every time**.

## Skills

One skeleton throughout — *When* (with what it explicitly excludes), *Decide* (a decision table or
tree), *Do* (copy-pasteable PowerShell), *Traps*, *References* — capped at 150 lines, with depth in
`references/` files loaded only on demand. No skill pins a version: where the answer depends on one,
the skill says which file to read or where to verify it.

**Routing and process.** These absorb the parts of the `superpowers` plugin worth keeping, without
the ceremony and rewritten for PowerShell.

| Skill | Purpose |
|---|---|
| `skills/dev-loop/SKILL.md` | Entry point: classifies a request (probe, bug, bounded change, subsystem, design attack, parallelisable, integration), routes it, then sizes the approval gate on the cost of being wrong rather than the size of the diff. Owns throwaway spikes and when to fan work out to parallel subagents. |
| `skills/plan-work/SKILL.md` | A plan file with verifiable tasks, sized to the change — and when not to write one at all. Also turns a work item into an attack plan before any code. |
| `skills/done-check/SKILL.md` | The completion gate: evidence before the claim, with a definition of done per change type and the exact command each one requires. |
| `skills/debug-systematic/SKILL.md` | Reproduce, isolate, explain, then fix — with a symptom-to-instrument table for .NET processes, query plans, brokers, pipelines and intermittent failures. |
| `skills/skill-forge/SKILL.md` | How to add or change an asset of this kit: shape decision, front matter, caps, splitting, finish checklist. |
| `skills/grill-me/SKILL.md` | Red-team a plan: interview the decision tree round by round — the whole frontier at once, each question with a recommended answer — then a Decision Summary. |

**Backend .NET**

| Skill | Purpose |
|---|---|
| `skills/dotnet-backend/SKILL.md` | House shape of the backend: EasyNetQ RPC handlers, Polly retries, Serilog, Scrutor/Quartz; DI lifetimes and the captive dependency, async discipline, options and secrets. |
| `skills/dotnet-testing/SKILL.md` | Adding tests where there are none: the RPC handler as the seam, the first test project and its pipeline step, what deserves a test, xUnit mechanics. |
| `skills/dotnet-diagnostics/SKILL.md` | Production first through Grafana (Loki, Prometheus, Pyroscope), `/logs` and the Aspire dashboard locally, `dotnet-*` counters, traces and dumps as fallback. |
| `skills/ef-core/SKILL.md` | Modelling, the query cost model, and the single owner of the migration procedure and its guardrails (never hand-edit a migration or the snapshot). |

**Data and messaging**

| Skill | Purpose |
|---|---|
| `skills/sql-server/SKILL.md` | The house T-SQL rules, sqlcmd through docker, stored procedures, the slow-query ladder for SQL Server and the Postgres read cache; plans go to `db-analyst`. |
| `skills/redis-dotnet/SKILL.md` | The house facts only: multiplexer wiring, Streams consumer groups and the pending-forever trap, timeout counters, docker inspection; generic Redis → `redis-development` plugin. |
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
| `skills/project-wiki-standard/SKILL.md` | `/project-wiki-standard` — the canonical structure of an Azure DevOps project wiki and the zero-duplication rule that keeps it usable: one place per fact, an answered question **migrates** to the page that owns it and is deleted, and constraints stay separate from the decisions taken in response. |
| `skills/worklog/SKILL.md` | `/worklog` — reconstructs what was done in a period from the session transcripts, estimates time per topic, then logs the hours on the right work items, reconciling hours already on an item that the audit does not know. The audit is never pruned: it is what closes a day, zero-hour days included, and what the reminder hook reads. Italian by design. |
| `skills/pr-review/SKILL.md` | `/pr-review [target] [effort] [focus]` — reviews a PR and posts **only genuine questions**; everything else stays in chat. Delegates to `code-reviewer`, fanning out to the specialists from `high`. Also owns receiving review findings: verify before implementing. |
| `skills/pr-create/SKILL.md` | Opening a PR on either platform: Italian imperative title, reviewer-sized body with a `Rilascio:` block naming every component the change forces a deploy of, protected-branch target read from the remote, the parent backlog item linked (never a Task). |
| `skills/branch-flow/SKILL.md` | Branch conventions on both platforms, isolated worktrees, and the finish menu once the work is complete — always squash and delete the source branch. |
| `skills/items-qa/SKILL.md` | `/items-qa` — drives a real browser against a running site to test work items against their acceptance criteria, reads the existing discussion first, and posts a verdict that explicitly is not an approval. |

**Environment and CI**

| Skill | Purpose |
|---|---|
| `skills/docker-dev-env/SKILL.md` | Aspire-first for the backend, compose for the rest; clients inside containers, healthchecks against readiness, deliberate volume resets, local secrets. |
| `skills/pipeline/SKILL.md` | Azure DevOps YAML with the house rules (scripts over tasks, no test stage), templates, versioning, variables and caching; the Ansible deploy; failures → `/fix-ci`. |

## Commands

The one-shot layer: the decision is already made, the command runs the sequence. Each declares its
own guardrails, and none of them merges, deploys, force-pushes or drops.

| Command | Does |
|---|---|
| `commands/item.md` | Reads a work item properly — acceptance criteria, parent, links, attachments, discussion — or lists your active ones. |
| `commands/fix-ci.md` | A red run: fetch only the failing step's log, isolate the error, and separate a code fault from a pipeline fault from an environment difference. |
| `commands/db.md` | Inspect the project's database: discover the engine and connection, run a query or describe a schema. Read-only by default. |
| `commands/logs.md` | Tail and filter the current service's logs, whichever way this project produces them. |
| `commands/docs-sync.md` | Runs `doc-keeper` on the repository's tech docs or wiki tree, against the working diff, a range or a full audit. |
| `commands/code-review.md` | `/code-review [scope] [effort] [focus]` — reviews the working diff and reports in chat only. |
| `commands/retro.md` | `/retro [session] [focus]` — retrospective on a session: classifies every friction event and proposes the environment fix (pointer, check, hook, skill, access). Proposes only. |
| `commands/commit.md` | A commit with a generated message, on the current, an existing or a new branch. Never pushes. |

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
| `agents/test-writer.md` | Discovers the repository's own test conventions, states them, then writes tests to match. Parallelisable over many classes; test files only. |
| `agents/db-analyst.md` | Read-only analysis of a query, plan or schema: the cause, the index that would change it, and the cost. May read through the database MCP servers, SELECT-only. Applies nothing. |
| `agents/doc-keeper.md` | Maintains code-derived and experience-derived docs against the source. Active only where the repository actually has a docs tree. |

## Hooks

The safety net: it fires whether or not you remembered. Every hook exits 0 on any internal error —
a broken hook must never block work — and each has a dependency-free test in `tools/`.

| Hook | Event | Does |
|---|---|---|
| `hooks/guard-shell.js` | `PreToolUse` | One entry point for every shell guard, sharing `hooks/lib/`. Confirms before a commit or push lands on the repository's default branch, and before an action with no undo — dropping or truncating, dropping a database through the EF tool, flushing a cache, tearing down volumes, pruning, deleting a volume, queue, cloud or cluster resource — **including when it is nested inside a `docker exec`, a `sqlcmd -Q` or a pipeline**, which a permission pattern cannot see. The same words in a comment, a path, a search pattern or a dry run are ignored. |
| `hooks/secret-scan.js` | `PreToolUse` | Blocks a write introducing a provider token, a cloud key, a private key block or a password-bearing connection string, naming the pattern and the line. Placeholders and variable references pass. |
| `hooks/format-on-edit.js` | `PostToolUse` | Formats only the file just written, and does nothing where the project has no such tooling configured. Exits at once on an extension no formatter owns. |
| `hooks/session-brief.js` | `SessionStart` | Five cached lines of orientation: branch and dirty state, last commit, upstream drift, PR, work item. No network call. |
| `hooks/worklog-pending.js` | `SessionStart` | Names the working days with activity under a mapped workspace root but no `/worklog` audit entry — current month, or current week where it reaches back — and caches the count for the statusline clock badge. Roots come from `CLAUDE_WORKSPACE_ROOTS`; unset means silence. |
| `hooks/ensure-edge-cdp.ps1` | `PreToolUse` | Before a `browser-use` tool call, makes sure Edge is running with its CDP port open, starting it if needed. Never blocks. |

## Configuration and tooling

| Path | Purpose |
|---|---|
| `CLAUDE.md` | User instructions: the routing and CLI rules, the review conventions, the writing rule, and the workspace-to-platform mapping (a template — fill in your own). |
| `settings.json` | Model and fallbacks, environment variables, permission allow/ask/deny rules (`Read` denies on secret-bearing **files** only, never on folders), the hooks, PowerShell as the default shell, enabled plugins, status line, UI preferences. |
| `statusline.js` | Folder — or, inside a linked worktree, the worktree under a tree icon — then git branch and dirty badges, context bar with token count, rate limits with weekly pacing, session cost, model, effort, PR badge, the unlogged-hours clock badge, vim mode. Names and branch are hyperlinks. |
| `install.ps1` | Idempotent install into the Claude config directory, plus `-Check` (drift and environment report, exit 1 on problems) and `-Pull` (import live edits back into the repo, whole skill folders included). |
| `tools/validate.mjs` | Dependency-free CI checks: JSON, front matter, cross-references, machine paths and secrets, the line caps, the body skeleton, reference reachability, pinned versions, declared command limits. |
| `tools/guard-shell.test.mjs` | One test file per hook entry point — this one plus four siblings — covering the true positives and, the part that matters, the false positives. |
| `evals/skill-triggering.md` | A `MUST` / `MUST NOT` case per skill and command. The `MUST NOT` rows are the borders between neighbouring assets. |
| `mcp/servers.example.json` | The MCP servers the skills fall back to, as a mergeable JSON block. Not installed by copying — see below. |
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
- **PowerShell 7** at `C:\Program Files\PowerShell\7\pwsh.exe` — hardcoded by `settings.json`, used by `ensure-edge-cdp.ps1` and the worklog scripts.
- **Microsoft Edge** with remote debugging allowed (`edge://inspect`) — only for the `browser-use` plugin, which attaches to Edge's CDP port rather than launching a browser.
- A **Nerd Font** in the terminal — the status line draws its badges with Nerd Font glyphs; without one you get replacement boxes.
- **`az` with the `azure-devops` extension** (`az extension add --name azure-devops`) — the whole ALM pillar depends on the extension specifically. **`gh`**, authenticated, for GitHub repositories.
- **`dotnet`** with the EF tool, **`docker`**, **`sqlcmd`**. The diagnostics skill installs the .NET diagnostic tools on demand.
- **Language servers** on `PATH`: `dotnet tool install -g csharp-ls` and `npm i -g typescript typescript-language-server`.
- **`psql` and `redis-cli` are deliberately not required**: every client recipe runs through a container.
- `settings.json` and the hooks are Windows and PowerShell oriented; adjust for macOS or Linux.

## Installation

```powershell
.\install.ps1            # install or update the Claude config directory, check prerequisites
.\install.ps1 -Check     # report drift and environment problems, write nothing (exit 1 if any)
.\install.ps1 -Pull      # bring changes made in the live config back into the repo
```

The installer discovers what the repo contains rather than working from a list, so a new asset needs
no change here. It asks before overwriting `CLAUDE.md` or `settings.json` (`-Force` skips the
prompt). Some settings are personal choices worth reviewing first: `"language": "Italian"`;
`model` / `effortLevel` / `alwaysThinkingEnabled` / `advisorModel`, which pick a capability *and* a
cost profile; `voice`, `remoteControlAtStartup` and the push notifications; and
`autoCompactEnabled: false` — auto-compaction is off on purpose, with the threshold kept at 70% for
whoever turns it back on.

Then restart Claude Code. `-Check` reports anything that exists only in the live config, which is
the state where a retired skill keeps firing next to its replacement.

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

Observability and database servers are **per project**, not per user: they point at one client's
Grafana or database, so they are registered `--scope local` from inside that project's folder. The
`grafana-*`, `sql-*` and `pg-*` entries in `mcp/servers.example.json` are templates for that — fill
the placeholders, keep credentials in environment variables, and grant the database ones only to
`db-analyst`'s read-only tools.

```powershell
claude mcp add --scope local grafana-<env> -e GRAFANA_URL=<url> -e GRAFANA_SERVICE_ACCOUNT_TOKEN=<token> -- <grafana-mcp-command>
```

**CLI first.** A skill reaches for an MCP server only for what the CLI does not have: reading a work
item discussion, attachments, PR comment threads, run logs, full-text search, and a project's work
item types and states. `azdo-cli` lists each one with the reason.

## Environment variables

| Variable | Who needs it | Value |
|---|---|---|
| `CLAUDE_HOOKS` | every hook in `settings.json` | The hooks directory inside your Claude config directory. Hooks run in *exec* form with no shell to expand variables, which is why the Node ones read it themselves. **Without it they fail silently** — by design they exit 0, so the only symptom is that nothing gets checked. `install.ps1` sets it at user level. |
| `CLAUDE_WORKSPACE_ROOTS` | `hooks/worklog-pending.js` | The workspace roots whose work is billable, `;`-separated — the same roots as the mapping in `CLAUDE.md`. Set in `settings.json` → `env`, empty in the template: **empty means the reminder never fires**. |
| `CLAUDE_WORKSPACE_NESTED` | `hooks/worklog-pending.js` | Folders under a root whose project is the subfolder below them (the per-subfolder shape of the mapping), `;`-separated, so the reminder labels `<root>/<project>`. Optional. |
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
workspace mapping in `CLAUDE.md`, in `CLAUDE_WORKSPACE_ROOTS` / `CLAUDE_WORKSPACE_NESTED` in
`settings.json`, and in `mcp/servers.example.json`.

Everything else is meant to be opinionated. If a pattern does not match your project, change the
skill — `skill-forge` tells you how to do it without breaking the contract, and the validator tells
you if you did.

## License

[MIT](LICENSE) © 2026 Davide Piccinini
