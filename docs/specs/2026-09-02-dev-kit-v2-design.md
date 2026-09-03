# claude-dev-kit v2 — Design

Status: approved 2026-09-02. Branch: `feature/dev-kit-v2`.

## 1. Goal

A solo developer plays every role: analyst, backend dev, DBA, frontend dev, reviewer, release
manager, doc writer, ops. The kit has to make one person cover all of them without re-deciding,
re-discovering or forgetting anything. Those are the three multipliers, in order:

| Multiplier        | What it needs                                         | Kit level                                 |
| ----------------- | ----------------------------------------------------- | ----------------------------------------- |
| Don't re-decide   | conventions written down once                         | **Knowledge** — skills                    |
| Don't re-discover | context found without burning the main context window | **Exploration** — agents                  |
| Don't forget      | steps that fire whether or not you remember them      | **Safety net** — hooks, gates, validation |

Plus the layer that ties them: **Routing** — given a task, which asset owns it.
A kit made only of skills covers one multiplier out of three. v1 was that kit; v2 adds the rest.

## 2. Principles (non-negotiable for every asset)

1. **80/20.** 20% of the text must carry 80% of the knowledge. Tables and decision trees over
   prose. Hard caps: `SKILL.md` at most 150 lines, each reference file at most 200 lines, a command
   at most 100 lines. Anything longer is split into references, never shrunk by dropping substance.
2. **Version-agnostic.** Assets carry patterns and idioms, never "in version N do X". Where a
   version genuinely changes the answer, the asset says **how to detect it** (project files,
   central package management, package manifests) or **where to verify it** (the `microsoft-docs`
   plugin, official docs) — it does not encode the answer.
3. **CLI before MCP.** Azure DevOps goes through `az devops`, `az boards`, `az repos`,
   `az pipelines`; GitHub through `gh`; the rest through `dotnet`, `docker`, `sqlcmd`, `npm`/`npx`.
   The Azure DevOps MCP servers stay a **documented fallback** for what the CLI cannot do, and every
   asset that can fall back says when.
4. **Opinionated on technique, anonymous on identity.** No placeholders for technical choices — real
   patterns, real libraries, real commands. Placeholders **only** for Azure DevOps org and project
   names, absolute machine paths, and e-mail addresses. The validator enforces this.
5. **Windows-native.** Examples in PowerShell 7. Use bash only where the Bash tool is genuinely the
   better instrument, and say so.
6. **No duplication of installed plugins.** See section 6. An asset that overlaps a plugin routes to
   it in one line instead of restating it.
7. **Italian by default, English for the code and for what the AI reads back** (revised
   2026-09-03). Everything an asset makes a **person** read is Italian: chat reports and their
   tables, questions, commit messages, pull request titles and descriptions, comments posted on a
   PR or into a work item, work items themselves, wiki pages. English is reserved for the code
   (source, identifiers, comments, test code), for a project's **technical documentation** tree and
   for **plan files and specs** — both are read back by a later session, which makes them AI-facing
   reference rather than prose — and for the instructional prose of the assets in this repository,
   which addresses the model and is public. So an asset is written in English and *says* "produce
   Italian". Machine identifiers are never translated: tags, `AB#` keywords, Azure DevOps type,
   state and field names, branch names, SQL, commands, `file:line`, verdict values, log lines.
   `worklog` is written in Italian throughout, by design.
8. **Say what an asset never does.** Every asset that could write, post or delete states its limits.

## 3. Asset contract

### Skills

Layout: a folder per skill holding `SKILL.md`, plus optional reference files and PowerShell scripts.

Front matter: `name` identical to the folder, and `description` (at most 1024 chars, third person)
stating **when** to use it and what it covers. A skill meant to fire only on an explicit command
**must** name its own slash trigger in the description — the validator checks it.

Fixed body skeleton, in this order:

- `# <name> — <one-line purpose>`
- **When** — 2 to 6 bullets of the situations that trigger it, then a "Not for:" line with what it
  explicitly excludes.
- **Decide** — the core: a decision tree or a rules table. This is the section that earns the skill.
- **Do** — copy-pasteable PowerShell. Real flags, no pseudo-commands.
- **Traps** — numbered, one line each, in the form: symptom, cause, fix.
- **References** — one line per reference file: the file name and the condition that sends you there.

Reference files are one topic each, self-contained, and never loaded unless the skill sends you
there. Scripts are PowerShell 7 and support a dry run wherever they write anything.

### Commands

Front matter: `description` and `argument-hint`. Body: the procedure in order, with the exact CLI
calls, then a `## Guardrails` section — the house style — or, for a short command, a single
**Never** line, stating what the command must not do (post, force-push, drop, deploy).
A command is the one-shot level: it assumes the decision is already made and it runs the sequence.

### Agents

Front matter: `name` matching the file, `description` saying when to spawn it, `tools` at least
privilege, and `model: sonnet` unless the job needs more. The body must define the **output
contract** — the exact shape the caller receives — and, for read-only agents, state that it never
edits, posts or commits. An agent no prose names is dead weight; the validator warns about it.

### Hooks

Node when the hook runs on every tool call (about 150 ms, against 500 ms for pwsh); pwsh when it
needs Windows APIs. Always exit 0 unless the block is deliberate. Read git state from disk rather
than shelling out. Every environment variable a hook uses is documented in the README.

### Every asset also gets

- a row in the README asset table;
- a case in the triggering evals: at least one MUST trigger and one MUST NOT trigger;
- no markdown link to a file that does not exist yet — in prose, name assets by bare name.

## 4. Routing

`dev-loop` is the entry point, and it replaces the ceremony the superpowers meta-skill injects into
every session: classify the work, then route.

| Work                                    | Route                                                                         |
| --------------------------------------- | ----------------------------------------------------------------------------- |
| Feasibility question                    | `dev-loop`, spike lane — cheapest probe, answer, throw the code away          |
| Bounded change in existing code         | domain skill, then `done-check`                                               |
| New subsystem or restructuring          | `plan-work`, then domain skills, then `done-check`                            |
| Bug, test failure, unexpected behaviour | `debug-systematic` first, always                                              |
| "Is this design right?"                 | `grill-me` — the red team, not `dev-loop`, which designs instead of attacking |
| Several independent pieces              | `delegate-agents`                                                             |
| Anything that ends in a commit          | `branch-flow`, then the commit or ship command                                |

## 5. Inventory

### 5.1 New process skills

These absorb the seven superpowers skills worth keeping, in a compact and Windows-native form.

| Skill              | Absorbs                                                  | Adds                                                                                              |
| ------------------ | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `dev-loop`         | the superpowers meta-skill, brainstorming                | Classification without a hard gate on trivial work; the routing table                             |
| `plan-work`        | writing-plans                                            | A plan file with verifiable tasks, sized to the change                                            |
| `debug-systematic` | systematic-debugging                                     | The four phases wired to real tools: .NET counters and traces, query plans, DevTools, broker logs |
| `done-check`       | verification-before-completion                           | A definition of done per change type, with the evidence each one requires                         |
| `delegate-agents`  | dispatching-parallel-agents, subagent-driven-development | Output contracts, no file ledger, no five-round fix loop                                          |
| `review-feedback`  | requesting and receiving code review                     | How to ask, and how to disagree with a reviewer without folding                                   |
| `test-strategy`    | test-driven-development                                  | Risk-based instead of dogmatic: what to test first when a repo has almost no tests                |
| `skill-forge`      | writing-skills                                           | Section 3 of this spec, as an executable procedure                                                |

The worktree and branch-finishing skills are absorbed into `branch-flow` in section 5.4.

### 5.2 New stack and ALM skills

| Skill                | Core content                                                                                                                                                            | Pri |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| `azdo-cli`           | The ALM foundation every other Azure DevOps asset calls: CLI configuration, multi-tenant auth, WIQL queries, boards/repos/pipelines verbs, MCP fallback rules           | P1  |
| `workitem-analyze`   | An item or epic becomes a plan of attack: read the acceptance criteria, locate the code, list the unknowns                                                              | P1  |
| `dotnet-backend`     | C# idioms and architecture: layered against Clean, controllers against minimal APIs, DI lifetimes, async and concurrency, errors and results, options and configuration | P1  |
| `dotnet-testing`     | xUnit, substitute-style mocking, fluent assertions, Testcontainers, ASP.NET integration tests, and adding tests to code that has none                                   | P1  |
| `dotnet-diagnostics` | Counters, traces and dumps, structured logging, OpenTelemetry, finding a slow query from the outside in                                                                 | P1  |
| `ef-core`            | Modelling, querying, migrations, and the cost model: N+1, tracking, split queries, projections; SQL Server and Npgsql providers                                         | P1  |
| `sql-server`         | T-SQL, index design, execution plans, deadlocks, the sqlcmd workflow, stored procedures                                                                                 | P1  |
| `typescript`         | Strict mode, narrowing, discriminated unions, anti-any discipline, the compiler options that matter                                                                     | P1  |
| `angular`            | Modern standalone and signal-based code **and** coexistence with module, NgRx and RxJS legacy; forms, interceptors, testing                                             | P1  |
| `react`              | Hooks discipline, local against server state, data fetching, the Vite and Tailwind setup, component testing                                                             | P1  |
| `docker-dev-env`     | Compose stacks for SQL Server, Postgres, Redis and RabbitMQ, plus Aspire; also the way to run the Postgres and Redis clients, which are not installed on this machine   | P1  |
| `postgres`           | The Npgsql client, running psql through docker, what differs from SQL Server, EXPLAIN, indexes, JSONB                                                                   | P2  |
| `redis-dotnet`       | The .NET client: multiplexer lifetime, key design, cache-aside, SignalR backplane, sync-over-async                                                                      | P2  |
| `rabbitmq`           | Exchange, queue and dead-letter topology, pub-sub, RPC and saga patterns, idempotency, poison messages, the management API                                              | P2  |
| `pipeline`           | Azure DevOps YAML, templates and semantic versioning; exists in the repo and needs a refresh plus a local install                                                       | P2  |

Depth is calibrated on the workspace scan: SQL Server is the database everywhere and Postgres is
secondary; Redis and RabbitMQ have a real client in one platform only; Angular spans three eras
(1.x legacy, module plus NgRx, standalone plus signals); React is Vite and Tailwind with local state
and no Redux or Zustand anywhere; controllers dominate and minimal APIs appear only in the newest
work; testing is solid in two repositories and nearly absent in the largest one.

### 5.3 New commands

| Command    | One shot                                                                                                           | Pri |
| ---------- | ------------------------------------------------------------------------------------------------------------------ | --- |
| `/ship`    | Working tree to branch if needed, commit, push, PR with a generated description, work-item link, item transitioned | P1  |
| `/status`  | Where you are: your open items, your PRs and the PRs awaiting you, dirty branches, red builds                      | P1  |
| `/item`    | Read an item with its acceptance criteria and discussion; the new form routes to work-item creation                | P1  |
| `/migrate` | EF Core migrations with guardrails: never drop, always show the generated SQL before applying                      | P1  |
| `/fix-ci`  | Red pipeline: fetch the logs, isolate the failing step, propose the fix                                            | P1  |
| `/db`      | Query and inspect the current project's database, read-only by default                                             | P2  |
| `/logs`    | Tail and filter the current service's logs, from compose, log files or the Aspire dashboard                        | P2  |
| `/queue`   | Broker state: queues, dead-letter depth, stuck messages                                                            | P2  |
| `/spike`   | Hypothesis to answer through a REPL or a throwaway script, then delete the code                                    | P2  |

### 5.4 Changes to existing assets

| Asset                                                    | Change                                                                                                                 |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `git-branching`, renamed `branch-flow`                   | Platform-aware for both Azure DevOps and GitHub; absorbs worktree usage and branch finishing                           |
| `pr-create`                                              | PR creation on Azure DevOps through the CLI, not only on GitHub                                                        |
| `pr-review`                                              | CLI-first for both platforms, MCP as a documented fallback                                                             |
| `workitem-create`                                        | Boards CLI first, MCP as fallback; today it is MCP-first                                                               |
| `worklog`                                                | The same CLI-first switch; stays Italian                                                                               |
| `items-qa`                                               | Split its 396 lines into a skill plus references, and publish it to the repo — today it exists only in the live config |
| `grill-me`                                               | Unchanged; routing clarifies it is the red team, not the design step                                                   |
| `code-reviewer`, `review-security`, `review-performance` | Unchanged                                                                                                              |
| `investigator`, `flow-tracer`                            | Install into the live config; they exist only in the repo                                                              |
| `tech-doc-keeper` and `wiki-keeper`                      | Merge into one doc-keeping agent, active only where the repo has a docs tree                                           |
| `pr-description`                                         | Install into the live config                                                                                           |
| The default-branch guard hook                            | Propagate the repo's fixed version over the stale local copy                                                           |
| `/code-review`, `/commit`, the browser hook              | Unchanged                                                                                                              |

### 5.5 New agents and hooks

| Asset                          | Purpose                                                                                                                                                       | Pri |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| `test-writer` agent            | Writes tests following the repository's existing patterns; run in parallel over many classes to close a test gap                                              | P1  |
| `db-analyst` agent             | Turns a schema or a query into index and plan analysis; read-only                                                                                             | P2  |
| Destructive-command guard hook | Confirm before dropping a database, removing a migration, DROP or TRUNCATE, flushing a cache, tearing down volumes, deleting cloud resources, purging a queue | P1  |
| Secret-scan hook               | Block a write that introduces a password-bearing connection string or a token-shaped literal                                                                  | P1  |
| Format-on-edit hook            | Format only the file just touched, so PRs carry no formatting noise                                                                                           | P2  |
| Session-brief hook             | At session start, five cached lines of context: branch, item, PRs, build                                                                                      | P2  |

### 5.6 Configuration and meta

| Item                                    | Change                                                                                                                                                                                                                          |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auto-mode environment block in settings | Twenty-two lines of one project's trust facts sit in user scope and therefore apply everywhere. Move them to that project's own local settings                                                                                  |
| Permission allow list                   | Add the commands used daily: the Azure DevOps CLI verbs, the GitHub CLI verbs, EF Core, formatting, compose, sqlcmd, npx, the test runners                                                                                      |
| Permission deny list                    | Add the destructive set the new hook confirms, so the two layers agree                                                                                                                                                          |
| Plugins                                 | Disable superpowers, now absorbed; uninstall the official code-review plugin, installed but disabled and superseded; decide the C# language-server plugin instead of leaving it half-wired                                      |
| Environment                             | The TypeScript language-server plugin is enabled but its binary is not on PATH, so it silently does nothing. Either install the binary or disable the plugin. The installer's check mode must report both language servers      |
| Installer                               | Handle the new asset set; the pull mode must pick up assets that exist only in the live config; the check mode reports the language-server binaries and the missing Postgres and Redis clients, whose expected answer is docker |
| Validator                               | New rules: the line caps from section 2, every reference file reachable from its skill, no hardcoded version numbers in skill prose, and declared limits in every command                                                          |
| Triggering evals                        | A case per new asset                                                                                                                                                                                                            |
| README                                  | Rewritten to the 80/20 rule: one asset table, the four levels, the plugin-coverage table — not the current wall of prose                                                                                                        |
| User instructions file                  | Add the routing table and the CLI-before-MCP rule; keep the review conventions                                                                                                                                                  |

## 6. What the kit deliberately does not write

| Area                                                              | Already covered by             | The kit's job                                 |
| ----------------------------------------------------------------- | ------------------------------ | --------------------------------------------- |
| Redis data modelling, clustering, search, security, observability | the Redis plugin, seven skills | Only the .NET client side                     |
| Microsoft and .NET API lookup, signatures, samples                | the Microsoft docs plugin      | Route to it for version-specific answers      |
| Modern web platform APIs and Core Web Vitals                      | the modern web guidance plugin | Framework-level guidance only                 |
| Visual and UX design                                              | the frontend design plugin     | Nothing                                       |
| Browser runtime debugging, accessibility, load metrics, heap      | the Chrome DevTools plugin     | Route to it from `debug-systematic`           |
| Cross-session memory                                              | the remember plugin            | Nothing                                       |
| Skill authoring machinery                                         | the skill-creator plugin       | `skill-forge` adds this kit's contract on top |

## 7. Execution

1. Write the implementation plan from this spec.
2. Fan out one authoring agent per pillar: process, ALM, backend, data and messaging, frontend, and
   commands with hooks and meta. Every agent receives sections 2 and 3 verbatim as its contract.
3. Run the validator and fix until it is clean.
4. Review every asset against sections 2 and 3 before installing anything.
5. Install into the live config, then verify with the installer's check mode.
6. One pull request, squash-merged, branch deleted.

## 8. Risks

| Risk                                             | Mitigation                                                                                          |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| Six agents produce six styles                    | Section 3 is a fixed skeleton, not a suggestion, and the review pass rejects deviations             |
| Dropping superpowers loses upstream improvements | The absorbed skills are small and now stack-aware, and the plugin can be re-enabled at any time     |
| A large kit rots                                 | Line caps, eval cases and the validator make rot visible, and `skill-forge` keeps new assets honest |
| Assets nobody uses                               | The priority split: P1 is what gets used daily, P2 waits for a real need                            |
