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
| **Knowledge** | not re-deciding what was decided once | 33 skills, 114 reference files |
| **Exploration** | finding context without burning the main context window | 8 subagents |
| **Execution** | running a known sequence in one shot | 12 slash commands |
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
| `skills/dev-loop/SKILL.md` | Entry point: classifies a request (probe, bug, bounded change, subsystem, design attack, parallelisable, integration), routes it, then sizes the approval gate on the cost of being wrong rather than the size of the diff. |
| `skills/plan-work/SKILL.md` | A plan file with verifiable tasks, sized to the change — and when not to write one at all. |
| `skills/done-check/SKILL.md` | The completion gate: evidence before the claim, with a definition of done per change type and the exact command each one requires. |
| `skills/delegate-agents/SKILL.md` | Whether work is genuinely independent, how to write an output contract so N reports merge, and what never to delegate. |
| `skills/debug-systematic/SKILL.md` | Reproduce, isolate, explain, then fix — with a symptom-to-instrument table for .NET processes, query plans, brokers, pipelines and intermittent failures. |
| `skills/test-strategy/SKILL.md` | Risk-based: what earns a test first, later, or never, and how to add tests to code that has none through seams and characterization. |
| `skills/review-feedback/SKILL.md` | How to package a change for review, and how to receive a finding: verify before implementing, and reject a false positive with evidence. |
| `skills/skill-forge/SKILL.md` | How to add or change an asset of this kit: shape decision, front matter, caps, splitting, finish checklist. |
| `skills/grill-me/SKILL.md` | Red-team a plan: interview every branch of the decision tree, then a Decision Summary. |

**Backend .NET**

| Skill | Purpose |
|---|---|
| `skills/dotnet-backend/SKILL.md` | Layered against Clean Architecture, controllers against minimal APIs, DI lifetimes and captive dependencies, async discipline, errors and results, options and secrets. |
| `skills/dotnet-testing/SKILL.md` | xUnit and fixtures, substitutes against hand-written fakes, integration tests on the ASP.NET test host, a containerised database instead of the in-memory provider, and keeping the suite fast. |
| `skills/dotnet-diagnostics/SKILL.md` | Counters, traces and dumps, structured logging and cross-service correlation, OpenTelemetry, and getting from "the endpoint is slow" to the guilty call. |
| `skills/ef-core/SKILL.md` | Modelling, the query cost model (N+1 shapes, tracking, split queries, projections), migrations with guardrails, and SQL Server against Npgsql provider differences. |

**Data and messaging**

| Skill | Purpose |
|---|---|
| `skills/sql-server/SKILL.md` | Set-based and SARGable T-SQL, index design from a real query, execution plans, statistics and parameter sniffing, blocking and deadlocks, stored procedures, read-only inspection. |
| `skills/postgres/SKILL.md` | The Npgsql client, `EXPLAIN (ANALYZE, BUFFERS)`, index types, JSONB, VACUUM and bloat, and what differs from SQL Server when porting a query. |
| `skills/redis-dotnet/SKILL.md` | The .NET client only: multiplexer lifetime, timeouts and sync-over-async, cache-aside with stampede protection, SignalR backplane, batching, distributed locks. |
| `skills/rabbitmq/SKILL.md` | Topology chosen deliberately (exchanges, dead-letter, TTL), publish-subscribe against request-response against saga, idempotency, poison messages, operating the broker from the CLI and HTTP API. |

**Frontend**

| Skill | Purpose |
|---|---|
| `skills/typescript/SKILL.md` | Strictness, narrowing, discriminated unions, the anti-`any` ladder, and typing the boundary where untrusted data enters. |
| `skills/angular/SKILL.md` | The eras that coexist in one codebase — standalone with signals, module-based with RxJS and a Redux-style store — with the file-based test for which one you are in, both test harnesses, and an incremental migration ladder. |
| `skills/react/SKILL.md` | Hooks discipline, where state belongs, local against server state, fetching without a library and the threshold for adding one, forms, component testing. |

**Delivery and ALM.** CLI-first on both platforms; the MCP servers are a documented fallback for the
few capabilities the CLI genuinely lacks.

| Skill | Purpose |
|---|---|
| `skills/azdo-cli/SKILL.md` | The foundation everything else calls: configuration and defaults, auth including an organization on another tenant, WIQL, the boards, repos, PR and pipeline verbs, `az devops invoke` as the REST escape hatch, and the fallback rules. |
| `skills/workitem-analyze/SKILL.md` | An item or epic becomes an attack plan before any code: specified against assumed, where the code is, and the questions that must be answered first. Read-only. |
| `skills/user-story-standard/SKILL.md` | The company standard for **what an item says**: classifying a request as a User Story, Bug, Impediment or TECH, the exact body shape of each, and acceptance criteria in the mandatory `Dato che / Quando / Allora` form — plus the four coverage families behind them, and the rule that the criteria are never written together with the story, because what looks like one story usually contains three. |
| `skills/workitem-create/SKILL.md` | `/workitem-create` — a description and images become work items after a Q&A pass and two confirmation tables. Owns the **mechanism**; the content follows `user-story-standard`. |
| `skills/backlog-integration/SKILL.md` | `/backlog-integration` — turns a client meeting into real items on an existing board: pick the Epic and Feature that scope the session, take one point at a time, build a cart, then create everything in bulk with parents and assignees. Writes no hours. |
| `skills/project-wiki-standard/SKILL.md` | `/project-wiki-standard` — the canonical structure of an Azure DevOps project wiki and the zero-duplication rule that keeps it usable: one place per fact, an answered question **migrates** to the page that owns it and is deleted, and constraints stay separate from the decisions taken in response. |
| `skills/worklog/SKILL.md` | `/worklog` — reconstructs what was done in a period from the session transcripts, estimates time per topic, then logs the hours on the right work items. Italian by design. |
| `skills/pr-review/SKILL.md` | `/pr-review [target] [effort] [focus]` — reviews a PR and posts **only genuine questions**; everything else stays in chat. Delegates to `code-reviewer`, fanning out to the specialists from `high`. |
| `skills/pr-create/SKILL.md` | Opening a PR on either platform: English imperative title, reviewer-sized body, protected-branch target read from the remote, work item linked. |
| `skills/branch-flow/SKILL.md` | Branch conventions on both platforms, isolated worktrees, and the finish menu once the work is complete. |
| `skills/items-qa/SKILL.md` | `/items-qa` — drives a real browser against a running site to test work items against their acceptance criteria, reads the existing discussion first, and posts a verdict that explicitly is not an approval. |

**Environment and CI**

| Skill | Purpose |
|---|---|
| `skills/docker-dev-env/SKILL.md` | The local stack: compose for the four data services, a client inside a running container against a throwaway one, healthchecks against readiness, deliberate volume resets, and Aspire against driving compose by hand. |
| `skills/pipeline/SKILL.md` | Azure DevOps YAML: multi-stage shapes with templates, versioning from a config file, variables against groups against typed parameters, caching and artifacts, diagnosing a run from the CLI. |

## Commands

The one-shot layer: the decision is already made, the command runs the sequence. Each declares its
own guardrails, and none of them merges, deploys, force-pushes or drops.

| Command | Does |
|---|---|
| `commands/ship.md` | Working tree to a linked PR: branch, commit, push, PR with a generated description, work item transitioned. Stops before the merge. |
| `commands/status.md` | Where you stand: your open items, your PRs and those awaiting you, dirty or unpushed branches, red builds. Read-only. |
| `commands/item.md` | Reads a work item properly — acceptance criteria, parent, links, attachments, discussion — or lists your active ones. |
| `commands/migrate.md` | An EF Core migration with guardrails: resolve the context, generate, **show the SQL and stop**, apply on confirmation. |
| `commands/fix-ci.md` | A red run: fetch only the failing step's log, isolate the error, and separate a code fault from a pipeline fault from an environment difference. |
| `commands/db.md` | Inspect the project's database: discover the engine and connection, run a query or describe a schema. Read-only by default. |
| `commands/logs.md` | Tail and filter the current service's logs, whichever way this project produces them. |
| `commands/queue.md` | Broker state: queue depth, dead-letter, unacknowledged, and a non-destructive peek. Never purges. |
| `commands/spike.md` | Answer one question with throwaway code, then delete it. |
| `commands/code-review.md` | `/code-review [scope] [effort] [focus]` — reviews the working diff and reports in chat only. |
| `commands/commit.md` | A commit with a generated message, on the current, an existing or a new branch. Never pushes. |
| `commands/pr-description.md` | A structured PR description from the branch diff. Generates text only. |

## Subagents

Analysis and authoring on their own model boundary, so the main context window stays free. All
default to Sonnet; the caller can override.

| Agent | Does |
|---|---|
| `agents/code-reviewer.md` | Stack-agnostic review — defects, regressions, security, clean code, and whether the change did everything its intent implied — on a `low` to `max` effort ladder. Returns findings, posts nothing. |
| `agents/review-security.md` | Works from the exposed surface inward: entry points, trust boundaries, taint paths, authz, secrets. Same output contract, so results merge. |
| `agents/review-performance.md` | Reasons about cost: complexity, per-item I/O, allocations, blocking, caching, queries. No cost stated, no finding. |
| `agents/investigator.md` | Turns a symptom into the exact `file:line` that owns it. Read-only. |
| `agents/flow-tracer.md` | Traces a request across services over the message bus and returns an ordered hop map. Read-only. |
| `agents/test-writer.md` | Discovers the repository's own test conventions, states them, then writes tests to match. Parallelisable over many classes; test files only. |
| `agents/db-analyst.md` | Read-only analysis of a query, plan or schema: the cause, the index that would change it, and the cost. Applies nothing. |
| `agents/doc-keeper.md` | Maintains code-derived and experience-derived docs against the source. Active only where the repository actually has a docs tree. |

## Hooks

The safety net: it fires whether or not you remembered. Every hook exits 0 on any internal error —
a broken hook must never block work — and each has a dependency-free test in `tools/`.

| Hook | Event | Does |
|---|---|---|
| `hooks/guard-default-branch.js` | `PreToolUse` | Confirms before a commit or push lands on the repository's default branch. |
| `hooks/guard-destructive.js` | `PreToolUse` | Confirms before an action with no undo — dropping or truncating, dropping a database through the EF tool, flushing a cache, tearing down volumes, pruning, deleting a volume, queue, cloud or cluster resource — **including when it is nested inside a `docker exec`, a `sqlcmd -Q` or a pipeline**, which a permission pattern cannot see. The same words in a comment, a path, a search pattern or a dry run are ignored. |
| `hooks/secret-scan.js` | `PreToolUse` | Blocks a write introducing a provider token, a cloud key, a private key block or a password-bearing connection string, naming the pattern and the line. Placeholders and variable references pass. |
| `hooks/format-on-edit.ps1` | `PostToolUse` | Formats only the file just written, and does nothing where the project has no such tooling configured. |
| `hooks/session-brief.js` | `SessionStart` | Five cached lines of orientation: branch and dirty state, last commit, upstream drift, PR, work item. No network call. |
| `hooks/ensure-browser.ps1` | `PreToolUse` | Makes sure a browser carrying the Claude extension is running before a browser tool call. Never blocks. |

## Configuration and tooling

| Path | Purpose |
|---|---|
| `CLAUDE.md` | User instructions: the routing and CLI rules, the review conventions, the writing rule, and the workspace-to-platform mapping (a template — fill in your own). |
| `settings.json` | Model and fallbacks, environment variables, permission allow/ask/deny rules, the six hooks, PowerShell as the default shell, enabled plugins, status line, UI preferences. |
| `statusline.js` | Folder — or, inside a linked worktree, the worktree under a tree icon — then git branch and dirty badges, context bar, rate limits, model, effort, PR badge, vim mode. Names and branch are hyperlinks. |
| `install.ps1` | Idempotent install into the Claude config directory, plus `-Check` (drift and environment report, exit 1 on problems) and `-Pull` (import live edits back into the repo, whole skill folders included). |
| `tools/validate.mjs` | Dependency-free CI checks: JSON, front matter, cross-references, machine paths and secrets, the line caps, the body skeleton, reference reachability, pinned versions, declared command limits. |
| `tools/guard-default-branch.test.mjs` | One test file per hook — this one plus four siblings — covering the true positives and, the part that matters, the false positives. |
| `evals/skill-triggering.md` | A `MUST` / `MUST NOT` case per skill and command. The `MUST NOT` rows are the borders between neighbouring assets. |
| `mcp/servers.example.json` | The MCP servers the skills fall back to, as a mergeable JSON block. Not installed by copying — see below. |
| `docs/specs/` | The design specs the kit was built from, including the asset contract every asset obeys. |

## What the kit deliberately does not cover

Installed plugins already own these, so no asset restates them — they route to them in one line.

| Area | Owner |
|---|---|
| Redis data modelling, clustering, search, security, observability | `redis-development` |
| Microsoft and .NET API lookup, signatures, samples | `microsoft-docs` |
| Modern web-platform APIs, CSS features, Core Web Vitals | `modern-web-guidance` |
| Visual and UX design | `frontend-design` |
| Browser runtime debugging, accessibility, load metrics, heap | `chrome-devtools-mcp` |
| Cross-session memory | `remember` |
| Generic skill-authoring machinery | `skill-creator` |
| Semantic navigation in C# and TypeScript | `csharp-lsp`, `typescript-lsp` |

## Requirements

- **Claude Code** (CLI, desktop, or IDE extension).
- **Node.js 18+** and **git** on `PATH` — for the status line, the Node hooks, the validator and the tests.
- **PowerShell 7** at `C:\Program Files\PowerShell\7\pwsh.exe` — hardcoded by `settings.json`, used by two hooks and the worklog scripts.
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
prompt). Two settings are personal choices worth reviewing first: `"language": "Italian"`, and
`model` / `effortLevel` / `alwaysThinkingEnabled`, which pick a capability *and* a cost profile.

Then restart Claude Code. `-Check` reports anything that exists only in the live config, which is
the state where a retired skill keeps firing next to its replacement.

## Plugins

Register the marketplace once, then install each plugin and restart:

```
/plugin marketplace add anthropics/claude-plugins-official
/plugin install redis-development       # Redis, everything but the .NET client
/plugin install microsoft-docs          # live Microsoft and .NET documentation
/plugin install modern-web-guidance     # web platform, CSS, Core Web Vitals
/plugin install frontend-design         # visual and UX design
/plugin install chrome-devtools-mcp     # browser runtime debugging and auditing
/plugin install skill-creator           # generic skill authoring
/plugin install remember                # cross-session memory
/plugin install csharp-lsp              # C# semantic navigation (needs csharp-ls on PATH)
/plugin install typescript-lsp          # TypeScript semantic navigation
```

The `superpowers` plugin is deliberately **not** enabled: the seven of its skills worth keeping were
absorbed into the process skills above — compacted, made Windows-native and wired to this stack —
and enabling it alongside them puts two processes in competition for the same moment.

A plugin shipping its own MCP server may need extra tooling on the machine. `install.ps1 -Check`
flags plugins enabled in `settings.json` but not actually installed: the state in which their tools
silently do not exist.

## MCP servers

MCP servers do not live in the Claude config directory, so copying files does not install them.
Register them user-scoped, replacing the placeholder with your own organization:

```powershell
claude mcp add --scope user azdo-<org-alias> -- npx -y @azure-devops/mcp <your-org> -d core repositories work-items pipelines search
claude mcp add --scope user playwright      -- npx -y @playwright/mcp@latest --headless
```

One Azure DevOps entry per organization; the skills discover the server at runtime and match the
organization from the git remote, so any naming scheme works.

**CLI first.** A skill reaches for an MCP server only for what the CLI does not have: reading a work
item discussion, attachments, PR comment threads, run logs, full-text search, and a project's work
item types and states. `azdo-cli` lists each one with the reason.

## Environment variables

| Variable | Who needs it | Value |
|---|---|---|
| `CLAUDE_HOOKS` | every hook in `settings.json` | The hooks directory inside your Claude config directory. Hooks run in *exec* form with no shell to expand variables, which is why the Node ones read it themselves. **Without it they fail silently** — by design they exit 0, so the only symptom is that nothing gets checked. `install.ps1` sets it at user level. |
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
workspace mapping in `CLAUDE.md` and in `mcp/servers.example.json`.

Everything else is meant to be opinionated. If a pattern does not match your project, change the
skill — `skill-forge` tells you how to do it without breaking the contract, and the validator tells
you if you did.

## License

[MIT](LICENSE) © 2026 Davide Piccinini
