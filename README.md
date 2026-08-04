# claude-dev-kit

A personal [Claude Code](https://docs.claude.com/en/docs/claude-code) toolkit: reusable **subagents**, **slash commands**, **skills**, **hooks**, **settings**, and a custom **status line**. The agents and skills are oriented toward a **.NET microservices backend** (RabbitMQ/EasyNetQ messaging, EF Core + SQL Server, Redis, .NET Aspire) with **Azure DevOps** as the ALM platform, but project-specific details are kept as placeholders so they can be adapted to any codebase.

## What's inside

| Path | Type | Purpose |
|------|------|---------|
| `CLAUDE.md` | User instructions | Machine preferences + the **review-agent model-selection** convention (every review runs in the `code-reviewer` subagent). Install as `~/.claude/CLAUDE.md`. |
| `agents/code-reviewer.md` | Subagent | Analysis-only, stack-agnostic reviewer covering **defects, regressions, security, clean code, and completeness of the change** (what the intent asked for but the diff never did), with a `low`→`max` effort ladder and a false-positive filter. Returns ranked findings with a `CONFIRMED`/`PLAUSIBLE` verdict, an anchor, and a ready-to-post question. Never posts, edits, or merges. Sonnet unless the caller overrides. |
| `agents/flow-tracer.md` | Subagent | Read-only cross-service flow tracer over a RabbitMQ/EasyNetQ bus (RPC + Pub/Sub + Sagas). Returns an ordered hop map with `file:line`. |
| `agents/investigator.md` | Subagent | Read-only code locator: turns a symptom into the exact `file:line` of the handler that owns it. |
| `agents/tech-doc-keeper.md` | Subagent | Maintains **code-derived** docs (`docs/technical/` + `CLAUDE.md`) — verifies, updates, creates, and removes docs against the source. |
| `agents/wiki-keeper.md` | Subagent | Maintains **experience-derived** docs (`docs/wiki/`) — known issues, operational procedures, and fundamentals. |
| `agents/review-security.md` | Subagent | Security specialist: works from the exposed surface inward (entry points, trust boundaries, taint source→sink, authz/IDOR, secrets, crypto, abuse) instead of hunk by hunk. Same output contract as `code-reviewer`, so results merge. |
| `agents/review-performance.md` | Subagent | Performance specialist: reasons about cost (complexity, N+1 and per-item I/O, allocations, blocking, caching, queries/indexes). Every finding must state a cost and the scale at which it bites — no cost, no finding. |
| `commands/code-review.md` | Slash command | `/code-review [scope] [effort] [focus]` — review the **working diff** locally and report in chat; fans out to the specialists from `high` upward. Never posts, edits, or commits. |
| `commands/commit.md` | Slash command | `/commit` — create a git commit with a generated message on the current, an existing, or a new branch. Commit only, never pushes. |
| `commands/pr-description.md` | Slash command | `/pr-description` — generate a structured PR description from the branch diff (Azure DevOps `AB#<id>` linking). |
| `skills/git-branching/SKILL.md` | Skill | Branching conventions for GitHub projects: protected `main`, `feature/*` + `fix/*` prefixes, kebab-case names, squash-merge flow. |
| `skills/pr-create/SKILL.md` | Skill | PR title/description conventions on GitHub (English, imperative, targets `main`). |
| `skills/pr-review/SKILL.md` | Skill | `/pr-review [target] [effort] [focus]` — review a PR on **Azure DevOps or GitHub** (platform detected from the remote) and post **only genuine questions** as inline comments (English, tagged `[Claude AI Review]`, scoped tag per specialist); everything else stays in chat. Delegates to `code-reviewer`, fanning out to the security and performance specialists from `high` upward. |
| `skills/workitem-create/SKILL.md` | Skill | `/workitem-create` — turn a description (and images) into complete Azure DevOps work items, after a Q&A pass and two confirmation tables. |
| `skills/worklog/SKILL.md` (+ `worklog.ps1`, `round.ps1`) | Skill | `/worklog` — reconstruct what was done in a period from Claude Code transcripts, estimate time per topic, then log the hours on the right Azure DevOps work items. |
| `skills/pipeline/SKILL.md` | Skill | CI/CD authoring conventions for Azure DevOps YAML pipelines/templates, `GitVersion.yml`, and GitHub Actions workflows. |
| `skills/ef-migration/SKILL.md` | Skill | Manage EF Core migrations via `dotnet ef` for SQL Server DbContexts, with design-time gotchas and an add-migration recipe. |
| `skills/grill-me/SKILL.md` | Skill | Interview / red-team a plan or design, walking every decision branch, then output a Decision Summary. |
| `hooks/ensure-browser.ps1` | Hook | `PreToolUse` for `mcp__claude-in-chrome__*`: makes sure a browser carrying the Claude extension is running (prefers the default browser) and waits for the handshake. Never blocks the tool call. |
| `hooks/guard-default-branch.js` | Hook | `PreToolUse` for `Bash`/`PowerShell`: asks for confirmation when a `git commit`/`push` would land on the repo's default branch (or a push targets it from elsewhere), which the `git-branching` convention forbids. Honours `git -C`, ignores `--dry-run` and commit-message text, and always exits 0. Node rather than PowerShell, and it reads `.git` directly instead of shelling out to `git`, because it runs before **every** shell tool call — ~150 ms instead of ~500 ms. |
| `settings.json` | Config | Model + fallbacks, env vars, permission allow/deny/ask rules, the browser hook, PowerShell as default shell, enabled plugins, status line, UI preferences. |
| `mcp/servers.example.json` | Config template | The user-scoped MCP servers the skills expect (Azure DevOps, Playwright). Not installed by copying — see [MCP servers](#mcp-servers). |
| `statusline.js` | Status line | Node.js status line: folder · git branch + dirty badges · context bar · rate limits · model · effort · PR badge · vim mode. |
| `install.ps1` | Installer | Idempotent install into `~/.claude`, plus `-Check` (drift + environment report, exit 1 on problems) and `-Pull` (import local edits back into the repo). |
| `tools/validate.mjs` | Validator | Dependency-free checks run by CI: JSON, front matter, cross-references, machine-specific paths and secrets, documented plugins and env vars. |
| `evals/skill-triggering.md` | Evals | Behavioural cases for skill/command triggering (`MUST` load vs `MUST NOT`), for spot-checks or `skill-creator` runs. CI warns when an asset has no case. |

## How the review flow fits together

Two entry points, one set of agents, one output contract:

```
/code-review  (working diff, chat only)     /pr-review  (Azure DevOps PR, posts questions)
            \                                          /
             └──────────► review subagents ◄───────────┘
                   code-reviewer            (always)
                   review-security          (effort >= high, or focus=security)
                   review-performance       (effort >= high, or focus=performance)
```

`low`/`medium` runs the generalist alone; from `high` the specialists are spawned in parallel and
their findings merged (same finding format, deduped by anchor, re-sorted by severity). A `focus`
argument narrows the run to a single axis.

The generalist carries a baseline on every axis — defects, regressions, security (secrets, unvalidated
input, missing authz), clean code, **completeness** (whether the change did everything its intent
implied), and **obvious cost** (N+1 shapes, nested loops over input-sized collections, unbounded
caches) — so no axis is left uncovered at `low`/`medium`. What the specialists add is depth the
baseline deliberately skips: a threat model per entry point, and cost sized against the real call
sites.

Claude Code's own **`/security-review`** skill is deliberately left outside this flow: it runs inline
in the main thread and does not use the shared finding format. Treat it as an independent second
opinion to run by name, not as a step of the review — `review-security` never invokes it, so findings
can never be double-counted.

## Requirements

- **Claude Code** (CLI, desktop, or IDE extension).
- **Node.js 18+** and **git** in `PATH` — for `statusline.js`, the `guard-default-branch` hook, `tools/validate.mjs`, and the `npx`-based MCP servers.
- **PowerShell 7** (`pwsh`) at `C:\Program Files\PowerShell\7\pwsh.exe` — used by the browser hook and the `worklog` scripts.
- The `.NET`-flavoured agents and `ef-migration` assume the `dotnet` CLI; the commands, `grill-me`, `git-branching`, and `pr-create` are stack-agnostic.
- `settings.json` and the hook are Windows/PowerShell-oriented (`defaultShell: powershell`); adjust for macOS/Linux.
- The Azure DevOps skills (`pr-review`, `workitem-create`, `worklog`, `pipeline`) need a connected Azure DevOps MCP server; `claude-in-chrome` skills need the Claude browser extension.

## Installation

Everything (except the MCP servers) lives under Claude Code's config directory. Install **user-wide** into `~/.claude/`, or **per-project** by copying into a repo's `.claude/`.

**User-wide (PowerShell 7 / Windows) — use the installer:**

```powershell
.\install.ps1            # install / update ~/.claude, set CLAUDE_HOOKS, check prerequisites
.\install.ps1 -Check     # report drift and environment problems, write nothing (exit 1 if any)
.\install.ps1 -Pull      # bring changes made in ~/.claude back into the repo
```

`install.ps1` is idempotent and asks before overwriting `CLAUDE.md` or `settings.json` (`-Force` skips the prompt). It deliberately **skips the project-scoped assets** (the .NET agents, `pr-description`, `ef-migration`, `pipeline`): those carry stack placeholders and belong in a project's own `.claude/`. Beyond copying files it verifies node 18+, git, `pwsh` at the path `settings.json` hardcodes, `CLAUDE_HOOKS`, which enabled plugins are actually installed, and which MCP servers are registered — and `-Check` also reports assets that exist only in `~/.claude`, so the repo never silently falls behind again.

**User-wide (bash / macOS / Linux):**

```bash
cp -r agents commands skills hooks statusline.js ~/.claude/
cp settings.json CLAUDE.md ~/.claude/   # review first — this overwrites your config
export CLAUDE_HOOKS="$HOME/.claude/hooks"   # add to your shell profile
```

> **Heads-up:** `settings.json` and `CLAUDE.md` replace your existing ones. Merge the parts you want (permissions, model, status line, hooks) rather than overwriting blindly.

Then restart Claude Code: the agents appear to the `Agent` tool, `/commit`, `/pr-description`, `/pr-review`, `/workitem-create`, `/worklog` become available, and the remaining skills trigger from their descriptions.

## Validation

Nothing here compiles, so a broken front matter, a hook pointing at a file that was never committed, or a machine-specific path in a public repo would only surface when Claude Code silently stops loading an asset. `tools/validate.mjs` (no dependencies, Node 18+) closes that gap and runs in CI on every push and PR:

```powershell
node tools/validate.mjs      # exit 1 on errors, 0 when only warnings remain
```

It checks that every JSON file parses; that hooks and the status line in `settings.json` reference files that exist in the repo; that agents/commands/skills have the front matter their loader needs (and that `name` matches the file or directory); that trigger-only skills name their own trigger in the description; that no absolute user path, e-mail, token-shaped string, or password-bearing connection string is committed; that cross-references and local markdown links resolve; and that every enabled plugin and every `$env:` variable the kit uses is documented in this README. The workflow additionally syntax-checks `statusline.js` and parses every `.ps1`.

## Environment variables

Two kinds: the ones **you must create on the machine**, and the ones `settings.json` already sets for every Claude Code session (listed for reference — no action needed).

### Must be created on a new machine

| Variable | Value | Why |
|----------|-------|-----|
| `CLAUDE_HOOKS` | `%USERPROFILE%\.claude\hooks` | Both `PreToolUse` hooks in `settings.json` resolve their script through it: `ensure-browser.ps1` (PowerShell) and `guard-default-branch.js` (Node). **Without it they fail silently** (both exit 0 by design, so the only symptoms are that no browser gets started and that commits on the protected branch stop being questioned). Set it at **User** level, not just in the current shell — `install.ps1` does it for you. Hooks run in *exec* form, with no shell to expand variables, which is why the Node one reads `process.env.CLAUDE_HOOKS` itself. |

### Optional / scenario-specific

| Variable | Used by | Notes |
|----------|---------|-------|
| `COLUMNS` | `statusline.js` | Terminal width for the context bar; falls back to a sane default when unset. |
| `ConnectionStrings__<Context>Database` | `ef-migration` skill | Only when a design-time factory needs a real connection string for `dotnet ef` (see the skill for the null-connection-string gotcha). Set per-invocation, not permanently. |
| `USERPROFILE`, `LOCALAPPDATA` | `worklog.ps1`, `ensure-browser.ps1` | Standard Windows variables — already present, listed so the dependency is explicit. |

### Set by `settings.json` (reference)

| Variable | Value | Effect |
|----------|-------|--------|
| `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` | `50` | Starts auto-compaction at 50% context usage. |
| `CLAUDE_CODE_DEBUG_LOG_LEVEL` | `warn` | Quieter debug log. |
| `CLAUDE_CODE_DISABLE_FAST_MODE` | `1` | Never fall back to fast mode. |
| `CLAUDE_CODE_DISABLE_MOUSE` / `..._MOUSE_CLICKS` | `0` / `1` | Mouse scroll on, click-to-position off (keeps terminal text selection usable). |
| `CLAUDE_CODE_DISABLE_NOTIFICATION_PRESENCE_CHECK` | `1` | Always send notifications, even when the terminal looks focused. |
| `CLAUDE_CODE_USE_POWERSHELL_TOOL` | `1` | Enables the dedicated PowerShell tool alongside Bash. |
| `FORCE_HYPERLINK` | `1` | Emits OSC 8 hyperlinks — needed by the clickable segments in `statusline.js`. |

## MCP servers

MCP servers are **not** stored in `~/.claude/`, so copying files does not install them: they live in `~/.claude.json` (user scope). Register them with the CLI (replace the placeholders):

```powershell
claude mcp add --scope user azdo-<org-alias> -- npx -y @azure-devops/mcp <your-azure-devops-org> -d core repositories work-items pipelines search
claude mcp add --scope user playwright      -- npx -y @playwright/mcp@latest --headless
```

Add one Azure DevOps entry per organization. The Azure DevOps skills discover the server **at runtime** (they look for the `mcp__<server>__repo_*` / `wit_*` tools and match the org from `git remote`), so any naming scheme works. `mcp/servers.example.json` holds the same definitions as a mergeable JSON block.

## Plugins

`settings.json` enables plugins from the official marketplace, but enabling only works once the marketplace is registered and the plugins are installed:

```
/plugin marketplace add anthropics/claude-plugins-official
/plugin install frontend-design
/plugin install remember
/plugin install microsoft-docs
/plugin install skill-creator
/plugin install chrome-devtools-mcp
/plugin install redis-development
/plugin install typescript-lsp
/plugin install superpowers
/plugin install modern-web-guidance
```

Other useful ones from the same marketplace, installed per need: `code-review`, `csharp-lsp`.

Note that a plugin shipping its own MCP server may need extra tooling on the machine (a `uvx`-launched server needs [uv](https://docs.astral.sh/uv/), an `npx`-launched one needs Node). `install.ps1 -Check` flags plugins that are enabled in `settings.json` but not actually installed — the state in which the plugin's tools silently do not exist.

## Adapting to your project

The agents and the `ef-migration` skill use **placeholders** where a real project name or path would go — replace them with yours:

- `<App>` — your solution/namespace prefix (e.g. `<App>.<Domain>.<Layer>`).
- `<Name>DbContext` / `<Context>` — your EF Core DbContext(s) and their projects.
- `docs/technical/` and `docs/wiki/` — the doc layout the keeper agents expect; create these (or point the agents at your own structure).

The messaging conventions (`RequestAsync`/`RespondAsync`, `PublishAsync`/`SubscribeAsync`, `*.Service` / `*.Business` / `*.ServiceContract` / `*.Events`) assume EasyNetQ on RabbitMQ — swap them for your stack's patterns if different.

## License

[MIT](LICENSE) © 2026 Davide Piccinini
