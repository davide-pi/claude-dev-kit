# claude-dev-kit

A personal [Claude Code](https://docs.claude.com/en/docs/claude-code) toolkit: reusable **subagents**, **slash commands**, **skills**, **settings**, and a custom **status line**. The agents and skills are oriented toward a **.NET microservices backend** (RabbitMQ/EasyNetQ messaging, EF Core + SQL Server, Redis, .NET Aspire), but the project-specific details are kept as placeholders so they can be adapted to any codebase.

## What's inside

| Path | Type | Purpose |
|------|------|---------|
| `agents/flow-tracer.md` | Subagent | Read-only cross-service flow tracer over a RabbitMQ/EasyNetQ bus (RPC + Pub/Sub + Sagas). Returns an ordered hop map with `file:line`. |
| `agents/investigator.md` | Subagent | Read-only code locator: turns a symptom into the exact `file:line` of the handler that owns it. |
| `agents/tech-doc-keeper.md` | Subagent | Maintains **code-derived** docs (`docs/technical/` + `CLAUDE.md`) — verifies, updates, creates, and removes docs against the source. |
| `agents/wiki-keeper.md` | Subagent | Maintains **experience-derived** docs (`docs/wiki/`) — known issues, operational procedures, and fundamentals. |
| `commands/commit.md` | Slash command | `/commit` — create a git commit with a generated message on the current, an existing, or a new branch. Commit only, never pushes. |
| `commands/pr-description.md` | Slash command | `/pr-description` — generate a structured PR description from the branch diff (Azure DevOps `AB#<id>` linking). |
| `skills/ef-migration/SKILL.md` | Skill | Manage EF Core migrations via `dotnet ef` for SQL Server DbContexts, with design-time gotchas and an add-migration recipe. |
| `skills/grill-me/SKILL.md` | Skill | Interview / red-team a plan or design, walking every decision branch, then output a Decision Summary. |
| `settings.json` | Config | Claude Code settings: model + fallbacks, permission allow/deny/ask rules, PowerShell default shell, plugins, and the status line. |
| `statusline.js` | Status line | Node.js status line: folder · git branch + dirty badges · context bar · rate limits · model · effort · PR badge · vim mode. |

## Requirements

- **Claude Code** (CLI, desktop, or IDE extension).
- **Node.js 18+** and **git** in `PATH` — for `statusline.js`.
- The `agents`/`skills` assume a **.NET** solution (`dotnet` CLI); the commands and `grill-me` are stack-agnostic.
- `settings.json` is Windows/PowerShell-oriented (`defaultShell: powershell`); adjust for macOS/Linux.

## Installation

Everything lives under Claude Code's config directory. Install **user-wide** (applies to all projects) by copying into `~/.claude/`, or **per-project** by copying into a repo's `.claude/`.

**User-wide (PowerShell / Windows):**

```powershell
$dst = "$HOME\.claude"
Copy-Item -Recurse -Force .\agents   $dst
Copy-Item -Recurse -Force .\commands $dst
Copy-Item -Recurse -Force .\skills   $dst
Copy-Item -Force .\statusline.js     $dst
# Review settings.json before overwriting your own:
Copy-Item -Force .\settings.json     $dst
```

**User-wide (bash / macOS / Linux):**

```bash
cp -r agents commands skills statusline.js ~/.claude/
cp settings.json ~/.claude/   # review first — this overwrites your settings
```

> **Heads-up:** `settings.json` replaces your existing Claude Code settings. Merge the parts you want (permissions, model, status line) rather than overwriting blindly if you already have a config.

After installing, agents appear to the `Agent` tool, `/commit` and `/pr-description` become available as slash commands, and the skills trigger automatically from their descriptions.

## Adapting to your project

The agents and the `ef-migration` skill use **placeholders** where a real project name or path would go — replace them with yours:

- `<App>` — your solution/namespace prefix (e.g. `<App>.<Domain>.<Layer>`).
- `<Name>DbContext` / `<Context>` — your EF Core DbContext(s) and their projects.
- `docs/technical/` and `docs/wiki/` — the doc layout the keeper agents expect; create these (or point the agents at your own structure).

The messaging conventions (`RequestAsync`/`RespondAsync`, `PublishAsync`/`SubscribeAsync`, `*.Service` / `*.Business` / `*.ServiceContract` / `*.Events`) assume EasyNetQ on RabbitMQ — swap them for your stack's patterns if different.

## License

[MIT](LICENSE) © 2026 Davide Piccinini
