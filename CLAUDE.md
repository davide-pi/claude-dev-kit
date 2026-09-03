# System preferences
- OS: Windows
- Home directory: `$HOME` (PowerShell) / `%USERPROFILE%` (cmd)
- Claude configurations: `$HOME\.claude`
- Statusline file: `$HOME\.claude\statusline.js`
# Review agents — model selection
Applies to **any code review or PR review** (`/pr-review`, `/code-review`, or an ad-hoc "review this
code/PR" request). Run the review analysis in the **`code-reviewer`** subagent (via the Agent tool)
so it executes on its own model boundary and keeps the main session model free for orchestration.
From effort **`high`** upward — or when the request is explicitly about one axis — also spawn the
specialists **`review-security`** and **`review-performance`** in parallel, in a single message, and
merge their findings. The model rule below applies to **every** review subagent:
- **Default** (no model mentioned) → omit the `model` param; it falls to the agent's `sonnet` frontmatter.
- **"advanced" agents** (e.g. "usa agent avanzati") → pass the **current session model explicitly**
  (the family shown in your system prompt's "You are powered by …" line: opus | sonnet | haiku | fable).
- **"agent {model}"** (e.g. "agent opus", "agent haiku", "agent sonnet", "agent fable") → pass that
  exact model.
A `/code-review`-style command loads inline into the main thread, so honor this convention by
delegating its analysis to the review subagents rather than reviewing inline. They are
self-contained — they do not need any review skill to be installed.
A request phrased as "security review" or "performance review" is still a review: it goes through
`review-security` / `review-performance`, not inline. The built-in `/security-review` skill is a
separate second opinion — run it only when I ask for it **by name**, and keep its output separate
since it does not use the subagents' finding format.
# Review output — the summary table goes last
Applies to the chat report of **any** review (`/code-review`, `/pr-review`, the built-in `/review`
and `/security-review`, an ad-hoc "review this", a merged multi-agent run): the report **ends** with
a compact summary table, one row per finding, placed **after** all the detail. That is how I read a
review — the table first, then I scroll up only to the rows I care about — so a table at the top, or
buried in the middle, defeats the purpose.
- Rows keep the findings' numbers and their order, so the row order **is** the severity order and
  `#3` in the table is the block titled `3.` above it.
- Minimum columns: `#`, category, `file:line`, a one-line statement of the finding (~80 chars, no
  wrapping), and the `CONFIRMED`/`PLAUSIBLE` verdict. Add a `Posted` column whenever some findings
  went onto a PR, so I can see at a glance what the author already sees.
- Every reported finding gets a row — `clean-code` and low-severity ones included, last.
- After the table: at most the one-line verdict and one short question about what to fix next.
  Nothing longer, or the table scrolls off screen.
- No findings → no table; say what was verified instead.
# Workspaces → ALM platform, org, project
Maps a working directory to the platform, organization and project the work belongs to. Use it
whenever something has to land in the right place — hours (`/worklog`), work items
(`/workitem-create`), PRs (`/pr-review`) — instead of asking. Match on the **root** of the path:
the mapping holds for every subfolder and repository below it. The bullets below are a **template**
— replace the placeholders with your own roots, orgs and projects, one bullet per workspace root,
and drop the shapes you do not have.
- `<workspaces-root>\<product-root>\**` → Azure DevOps, org `<org-a>`, project `<Project>` — one
  single project shared by every repo under that root.
- `<workspaces-root>\<clients-root>\**` → Azure DevOps, org `<org-b>`; the project is **per
  subfolder** and named after it (`<clients-root>\acme` → project `Acme`). Folders are lowercase
  while the projects keep their own casing, so resolve the exact name at runtime by listing the
  org's projects and matching case-insensitively; ask if none matches.
- `<workspaces-root>\<github-root>\**` → GitHub only, no Azure DevOps: no work items and no hour
  logging there — hours go on a dedicated per-project sheet next to the repo.
- Any other workspace → not mapped. Ask before assuming an org or a project.
# Routing and the CLI rule
The kit is four levels: `dev-loop` routes, skills carry knowledge, agents explore, commands act, and
hooks stop the irreversible. Two rules decide which one you use:
- **Start at `dev-loop`** for anything substantive — it classifies the request and names the asset
  that owns it. Once the work is routed, do not re-enter it on every turn.
- **CLI before MCP, always.** Azure DevOps goes through `az devops` / `az boards` / `az repos` /
  `az pipelines`; GitHub through `gh`. The Azure DevOps MCP servers are the **fallback** for what the
  CLI genuinely cannot do — try the CLI first every time, and say so when you fall back. The
  `azdo-cli` skill owns the mechanics; nothing else restates them.
# How to write for me
80/20: the 20% of the text has to carry 80% of the knowledge. This is not a style preference — I do
many things at once and reading time is my bottleneck, so a long answer that "covers everything"
costs me more than it gives.
- Tables and decision trees instead of paragraphs; numbered rules instead of narrative.
- No preamble, no restating what I just said, no summary of what you are about to do.
- Depth goes in a reference file loaded on demand, never inline "just in case".
- Applies to everything: chat answers, skills, PR and commit messages, work items, review reports.
# Language
Italian for everything a person reads as prose; English for everything tied to the code. The line is
not about audience politeness, it is about where the text lives.
- **Italian**: work items (title, description, acceptance criteria), pull request titles and
  descriptions, comments posted on a pull request, verdict comments posted into a work item, wiki
  pages, and chat.
- **English**: source code, identifiers, code comments, **commit messages** (they belong to the
  repository history), and the instructional prose of this kit's own assets — a skill tells the
  model what to do in English, even when what it produces is Italian.
# Resolving the organization and the project
Never hardcode an Azure DevOps organization or project, and **never trust the `az devops configure`
default** — it may still point at the previous session's client, which is how work lands in the
wrong customer's board. Resolve both from the **current working directory** through the workspace
mapping above, pass them explicitly on every command, and ask when the path is not mapped.
