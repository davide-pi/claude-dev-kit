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
| `commands/commit.md` | Slash command | `/commit` — create a git commit with a generated message on the current, an existing, or a new branch. Commit only, never pushes. |
| `commands/pr-description.md` | Slash command | `/pr-description` — generate a structured PR description from the branch diff (Azure DevOps `AB#<id>` linking). |
| `skills/git-branching/SKILL.md` | Skill | Branching conventions for GitHub projects: protected `main`, `feature/*` + `fix/*` prefixes, kebab-case names, squash-merge flow. |
| `skills/pr-create/SKILL.md` | Skill | PR title/description conventions on GitHub (English, imperative, targets `main`). |
| `skills/pr-review/SKILL.md` | Skill | `/pr-review` — review an Azure DevOps PR and post **only genuine questions** as inline threads (English, tagged `[Claude AI Review]`); everything else stays in chat. Delegates the analysis to `code-reviewer`. |
| `skills/workitem-create/SKILL.md` | Skill | `/workitem-create` — turn a description (and images) into complete Azure DevOps work items, after a Q&A pass and two confirmation tables. |
| `skills/worklog/SKILL.md` (+ `worklog.ps1`, `round.ps1`) | Skill | `/worklog` — reconstruct what was done in a period from Claude Code transcripts, estimate time per topic, then log the hours on the right Azure DevOps work items. |
| `skills/pipeline/SKILL.md` | Skill | CI/CD authoring conventions for Azure DevOps YAML pipelines/templates, `GitVersion.yml`, and GitHub Actions workflows. |
| `skills/ef-migration/SKILL.md` | Skill | Manage EF Core migrations via `dotnet ef` for SQL Server DbContexts, with design-time gotchas and an add-migration recipe. |
| `skills/grill-me/SKILL.md` | Skill | Interview / red-team a plan or design, walking every decision branch, then output a Decision Summary. |
| `hooks/ensure-browser.ps1` | Hook | `PreToolUse` for `mcp__claude-in-chrome__*`: makes sure a browser carrying the Claude extension is running (prefers the default browser) and waits for the handshake. Never blocks the tool call. |
| `settings.json` | Config | Model + fallbacks, env vars, permission allow/deny/ask rules, the browser hook, PowerShell as default shell, enabled plugins, status line, UI preferences. |
| `mcp/servers.example.json` | Config template | The user-scoped MCP servers the skills expect (Azure DevOps, Playwright). Not installed by copying — see [MCP servers](#mcp-servers). |
| `statusline.js` | Status line | Node.js status line: folder · git branch + dirty badges · context bar · rate limits · model · effort · PR badge · vim mode. |

## Requirements

- **Claude Code** (CLI, desktop, or IDE extension).
- **Node.js 18+** and **git** in `PATH` — for `statusline.js` and the `npx`-based MCP servers.
- **PowerShell 7** (`pwsh`) at `C:\Program Files\PowerShell\7\pwsh.exe` — used by the browser hook and the `worklog` scripts.
- The `.NET`-flavoured agents and `ef-migration` assume the `dotnet` CLI; the commands, `grill-me`, `git-branching`, and `pr-create` are stack-agnostic.
- `settings.json` and the hook are Windows/PowerShell-oriented (`defaultShell: powershell`); adjust for macOS/Linux.
- The Azure DevOps skills (`pr-review`, `workitem-create`, `worklog`, `pipeline`) need a connected Azure DevOps MCP server; `claude-in-chrome` skills need the Claude browser extension.

## Installation

Everything (except the MCP servers) lives under Claude Code's config directory. Install **user-wide** by copying into `~/.claude/`, or **per-project** by copying into a repo's `.claude/`.

**User-wide (PowerShell / Windows):**

```powershell
$dst = "$HOME\.claude"
Copy-Item -Recurse -Force .\agents   $dst
Copy-Item -Recurse -Force .\commands $dst
Copy-Item -Recurse -Force .\skills   $dst
Copy-Item -Recurse -Force .\hooks    $dst
Copy-Item -Force .\statusline.js     $dst
# Review these two before overwriting your own:
Copy-Item -Force .\settings.json     $dst
Copy-Item -Force .\CLAUDE.md         $dst

# Required by the browser hook in settings.json (user-level, persists across sessions):
[Environment]::SetEnvironmentVariable('CLAUDE_HOOKS', "$HOME\.claude\hooks", 'User')
```

**User-wide (bash / macOS / Linux):**

```bash
cp -r agents commands skills hooks statusline.js ~/.claude/
cp settings.json CLAUDE.md ~/.claude/   # review first — this overwrites your config
export CLAUDE_HOOKS="$HOME/.claude/hooks"   # add to your shell profile
```

> **Heads-up:** `settings.json` and `CLAUDE.md` replace your existing ones. Merge the parts you want (permissions, model, status line, hooks) rather than overwriting blindly.

Then restart Claude Code: the agents appear to the `Agent` tool, `/commit`, `/pr-description`, `/pr-review`, `/workitem-create`, `/worklog` become available, and the remaining skills trigger from their descriptions.

## Environment variables

Two kinds: the ones **you must create on the machine**, and the ones `settings.json` already sets for every Claude Code session (listed for reference — no action needed).

### Must be created on a new machine

| Variable | Value | Why |
|----------|-------|-----|
| `CLAUDE_HOOKS` | `%USERPROFILE%\.claude\hooks` | The `PreToolUse` hook in `settings.json` invokes `$env:CLAUDE_HOOKS\ensure-browser.ps1`. **Without it the hook fails silently** (it exits 0 by design, so the only symptom is that no browser gets started). Set it at **User** level, not just in the current shell. |

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

## Adapting to your project

The agents and the `ef-migration` skill use **placeholders** where a real project name or path would go — replace them with yours:

- `<App>` — your solution/namespace prefix (e.g. `<App>.<Domain>.<Layer>`).
- `<Name>DbContext` / `<Context>` — your EF Core DbContext(s) and their projects.
- `docs/technical/` and `docs/wiki/` — the doc layout the keeper agents expect; create these (or point the agents at your own structure).

The messaging conventions (`RequestAsync`/`RespondAsync`, `PublishAsync`/`SubscribeAsync`, `*.Service` / `*.Business` / `*.ServiceContract` / `*.Events`) assume EasyNetQ on RabbitMQ — swap them for your stack's patterns if different.

## License

[MIT](LICENSE) © 2026 Davide Piccinini
