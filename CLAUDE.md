# System preferences
- OS: Windows · Home: `$HOME` (PowerShell) / `%USERPROFILE%` (cmd) · Config: `$HOME\.claude` ·
  Statusline: `$HOME\.claude\statusline.js`
# Review agents — model selection
Any code or PR review (`/pr-review`, `/code-review`, an ad-hoc "review this") runs in the
**`code-reviewer`** subagent, never inline — a `/code-review`-style command loaded into the main
thread delegates too. From effort **`high`** upward also spawn **`review-security`** and
**`review-performance`** in parallel, in one message, and merge. A "security review" or
"performance review" goes to that specialist alone. The built-in `/security-review` runs only when I
name it, and its output stays separate (different format). `model` for **every** review subagent:
- nothing said → omit it (agent frontmatter: `sonnet`);
- "advanced" agents → the current session family explicitly (opus | sonnet | haiku | fable);
- "agent {model}" → that exact model.
# Review output — the summary table goes last
Any review report (`/code-review`, `/pr-review`, built-in `/review` and `/security-review`, ad-hoc,
merged runs) **ends** with the summary tables, after all the detail: I read the table first, then
scroll up to the rows I care about.
- **Da fare** (`status: todo`), then **Già fatti** (`status: done` — fixed by a later commit in
  scope, a PR thread resolved **with a fix**, or this session; by-design threads are dropped). A
  `done` finding is one line.
- **Fields** (emitted by the agents, values verbatim): `priority` — impact if not fixed: **P1**
  blocks the merge (CONFIRMED security, data loss, crash, broken contract), **P2** before release,
  **P3** improvement · `risk` — what applying the fix can break: `alto | medio | basso` ·
  `effort` — **S** minutes, one place · **M** a few files · **L** design change or migration.
- **Sort**: P1 → P3, `CONFIRMED` before `PLAUSIBLE`, `clean-code` last within its priority. Rows
  keep the findings' numbers (`#3` = block `3.`).
- **Columns** — Da fare: `#`, `Priorità`, `Categoria`, `Posizione` (`file:line`), `Rilievo` (~80
  chars), `Verdetto`, `Rischio`, `Sforzo`. Già fatti: `#`, `Categoria`, `Posizione`, `Rilievo`,
  `Risolto da` (commit, thread, "sessione"). Add `Postato` when findings went onto a PR.
- **Fix rapidi**: one line with the `#` of every P3 + `basso` + `S` finding, approvable with one "ok".
- Every finding gets a row. After the tables: at most a one-line verdict and one short question.
- No findings → no table; say what was verified.
- Italian headers and statements; verbatim: `file:line`, `CONFIRMED`/`PLAUSIBLE`, category slugs,
  `P1|P2|P3`, `S|M|L`.
# Workspaces → ALM platform, org, project
Resolve platform, org and project from the **current working directory** (match on the root; it
holds for every repo below) and pass them explicitly — never the `az devops configure` default.
Used by hours (`/worklog`), work items, PRs. Details: `azdo-cli`. The bullets are a **template** —
one per workspace root, with your own roots, orgs and projects; drop the shapes you do not have.
- `<workspaces-root>\<product-root>\**` → Azure DevOps, org `<org-a>`, project `<Project>` (one
  project shared by every repo under that root).
- `<workspaces-root>\<clients-root>\**` → Azure DevOps, org `<org-b>`, project **per subfolder**
  (`<clients-root>\acme` → `Acme`): list the org's projects and match case-insensitively; none
  matches → ask.
- `<workspaces-root>\<github-root>\**` → GitHub only: no work items, no hour logging — hours go on a
  per-project sheet beside the repo.
  - **Exception** `<workspaces-root>\<github-root>\<moved-project>\**` → Azure DevOps, org `<org-c>`,
    project `<MovedProject>`: a project that left the sheet for a board; the old sheet stays as the
    record of the hours before the move.
- Anything else → not mapped: ask before assuming an org or a project.
# Routing and the CLI rule
`dev-loop` routes, skills carry knowledge, agents explore, commands act, hooks stop the
irreversible.
- **Start at `dev-loop`** for anything substantive; once routed, do not re-enter it every turn.
- **CLI before MCP, always**: `az devops|boards|repos|pipelines`, `gh`. The `azdo-*` MCP servers
  only for a genuine CLI gap, and say so when you fall back. Mechanics: `azdo-cli`.
# Token economy
- **Code for a decided scope** (more than a few lines) → the `implementer` agent; this session
  plans, briefs and reviews its diff. Trivial edits stay inline.
- Fan-out searches over many files → an agent, so only the conclusion enters this context.
- Spawning `Explore` or `Plan`: pass `model: sonnet` — the built-ins inherit this session's model
  and ignore `CLAUDE_CODE_SUBAGENT_MODEL`; `opus` only when the plan's quality is the point.
- Every agent brief asks for a **concise** report; I ask for details when I need them.
# How to write for me
80/20: the 20% of the text carries 80% of the knowledge — reading time is my bottleneck.
- Tables and decision trees, numbered rules; no preamble, no restating, no "here is what I'll do".
- Depth goes in a reference loaded on demand, never inline "just in case".
- Everywhere: chat, skills, PR and commit messages, work items, review reports.
- **Answer shape**: one bold summary sentence, then bullets or a table; real depth only in a
  `> **Dettaglio**` block below.
# Change scope — only what the request needs
Every edit is **contained**: the smallest diff that fully satisfies the request, written well
(performance, clean code, local idiom) inside that perimeter. No unrequested refactors, renames,
reformatting, dependency bumps, "while I'm here" fixes or comment rewrites. Anything else worth
doing is **proposed, not applied** — one row each at the end, then stop:

| Proposta | Motivo | Rischio |
|----------|--------|---------|
| one line | one line | alto / medio / basso |

**Risk scale** (shared with reviews): **alto** behaviour, data or a public contract (API, event,
schema, config) · **medio** localized logic, verifiable by tests · **basso** cosmetic, no behaviour
change.
# Language
**Italian by default**; the dividing line is the reader, not the register.
- **Italian** — what I read: chat, reports and tables, questions, **commit messages**, PR titles and
  descriptions, comments on PRs and work items, work items, wiki pages.
- **English** — code, identifiers, code comments, tests; a project's technical docs (`docs/tech*`,
  architecture and flow docs, its `CLAUDE.md`); plan files and design specs; the kit's own asset
  prose (a skill in English that *says* "produce Italian").
- **Verbatim, never translated**: `[Claude AI Review]`, `AB#<id>`, `Fixes #<n>`, Azure DevOps type,
  state and field names, branch names, SQL, commands and flags, `file:line`, `CONFIRMED`/`PLAUSIBLE`,
  log lines and tool output — a translated evidence line is no longer evidence.
# ALM rules
| Rule | Details |
|------|---------|
| Every PR links at least its **parent backlog item** (never a Task) with the real PR-to-work-item link; nothing to link → stop and ask | `pr-create` |
| Every work item you create is **assigned to me** unless told otherwise, identity resolved against the org (never `git config`), shown before writing, read back after | `workitem-create`, `azdo-cli` |
| Work item types are per-project: speak in roles, resolve the type at runtime; defect = `Bug`, never `Issue`; no type → ask | `azdo-cli` |
| Closing a PR is always **squash + delete source branch**, set at creation and completion; a policy forbids squash → stop and say so | `branch-flow` |
| Hours: only `/worklog` writes them; pending days in the session brief → say so **once in the first reply**, one line; never log on your own | `worklog` |
# Done means verified
Never claim done, fixed or passing without a command run and its output read. Report **verified**
(command + result), **not verified** (why) or **failed** (quoted output). Per change type:
`done-check`.
# Search and read without triggering a prompt
Permission rules are prefix-matched on the **whole command**, so `cd X && grep …` never matches a
`Bash(grep *)` rule and ends in a prompt — historically the largest source of interruptions.
- Search with the **Grep tool** (`path` + `glob`); read with the **Read tool** (`offset`/`limit`).
- When the shell is genuinely right, **put the directory in the command** (`grep -rn "x" <abs-path>`,
  `git -C <path> log`) so it starts with the program.
- This outranks the general preference for the shell.
