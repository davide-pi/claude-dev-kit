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
- **Two tables, in this order**: **Da fare** (`status: todo`), then **Già fatti** (`status: done` —
  already resolved by a later commit in scope, by a PR thread resolved **with a fix**, or by a fix
  applied in this session; a thread closed as by-design is dropped, not `done`). A `done` finding is
  one line: no failure, no fix.
- **Per-finding fields** (the review agents emit them; values verbatim):
  - `priority` — impact if *not* fixed: **P1** blocks the merge (CONFIRMED security, data loss,
    crash, broken contract), **P2** fix before release, **P3** improvement (most `clean-code`).
  - `risk` — what *applying the fix* can break, on the "Change scope" scale: `alto | medio | basso`.
  - `effort` — **S** one place, minutes · **M** a few files · **L** design change or migration.
- **Sort order** (this replaces "severity order" everywhere): P1 → P3, then `CONFIRMED` before
  `PLAUSIBLE`, `clean-code` last within its priority. Rows keep the findings' numbers, so `#3` in a
  table is the block titled `3.` above it.
- **Columns** — Da fare: `#`, `Priorità`, `Categoria`, `Posizione` (`file:line`), `Rilievo` (~80
  chars, no wrapping), `Verdetto`, `Rischio`, `Sforzo`. Già fatti: `#`, `Categoria`, `Posizione`,
  `Rilievo`, `Risolto da` (commit, thread, or "sessione"). Add `Postato` whenever some findings went
  onto a PR.
- **Fix rapidi** — one line under the tables listing the `#` of every P3 + `basso` + `S` finding, so
  I can approve them all with a single "ok".
- Every reported finding gets a row — `clean-code` and low-priority ones included.
- After the tables: at most the one-line verdict and one short question about what to fix next.
  Nothing longer, or the tables scroll off screen.
- No findings → no table; say what was verified instead.
- The headers and the finding statements are **Italian**, like every report I read. Stay verbatim
  because I grep on them: the `file:line` anchor, `CONFIRMED`/`PLAUSIBLE`, the category slug, and
  the values `P1|P2|P3`, `S|M|L`.
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
  - **Exception** `<workspaces-root>\<github-root>\<moved-project>\**` → Azure DevOps, org
    `<org-c>`, project `<MovedProject>`: a project that left the sheet for a board. Work items and
    hours go there; the old sheet stays as the record of the hours tracked before the move.
- Any other workspace → not mapped. Ask before assuming an org or a project.
# Routing and the CLI rule
The kit is five levels: `dev-loop` routes, skills carry knowledge, agents explore, commands act, and
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
- **Answer shape**: one bold summary sentence first, then bullets or a table. Deeper explanation,
  only when genuinely needed, goes in a separate `> **Dettaglio**` block below — so I can find the
  point of interest before deciding whether to read on.
# Change scope — only what the request needs
Every edit is **contained**: the smallest diff that fully satisfies the request, written well
(performance, clean code, local idiom) **inside** that perimeter.
- No unrequested refactors, renames, reformatting, dependency bumps, "while I'm here" fixes or
  comment rewrites on code the request does not need to touch.
- Anything outside the perimeter you think is worth doing is **proposed, not applied**: list it at
  the end of the answer, one row each, and stop. I ask for details if I want them.

  | Proposta | Motivo | Rischio |
  |----------|--------|---------|
  | one line | one line | alto / medio / basso |

- **Risk scale** (shared with review findings): **alto** = can break behaviour, data or a public
  contract (API, event, schema, config); **medio** = touches logic, localized and verifiable by
  tests; **basso** = cosmetic or style only, no behaviour change.
# Language
**Italian by default.** English only for the code and for the text the AI itself reads back as
technical reference. The dividing line is the reader, not the register.
- **Italian** — everything I read as prose: chat answers, reports and their tables, questions;
  **commit messages**; pull request titles and descriptions; comments posted on a pull request or
  into a work item; work items (title, description, acceptance criteria); wiki pages.
- **English** — the code and what the AI consumes:
  - source code, identifiers, code comments, test code;
  - a project's **technical documentation** tree (`docs/tech*`, architecture maps, flow docs, a
    project's own `CLAUDE.md`) — it is written for the AI as much as for me;
  - **plan files and design specs**, for the same reason: a later session reads them back;
  - the instructional prose of this kit's own assets — a skill is written in English and *says*
    "produce Italian";
  - machine identifiers, always verbatim and never translated: `[Claude AI Review]`, `AB#<id>`,
    `Fixes #<n>`, Azure DevOps type, state and field names, branch names, SQL, commands and flags,
    `file:line` anchors, `CONFIRMED`/`PLAUSIBLE` verdicts, log lines and tool output.
An evidence line, a log line or a query that has been translated is no longer evidence: quote it.
# Resolving the organization and the project
Resolve both from the **current working directory** through the mapping above and pass them
explicitly — never trust the `az devops configure` default; unmapped → ask. Details: `azdo-cli`.
# Every pull request carries its parent work item
At least one, and it is the **parent backlog item**, never a Task; nothing to link → stop and ask.
Use the real PR-to-work-item link. Details: `pr-create`.
# Every work item created is assigned to me
Unless told otherwise, with the identity **resolved against the organization**, never from `git
config`; shown before writing, read back after. Details: `workitem-create`, `azdo-cli`.
# Hours are never forgotten
`/worklog` is the only asset that writes hours. When the session brief lists pending days, **say so
once in the first reply**, one line naming the days; never log hours on your own initiative.
Details: `worklog`.
# Closing a PR is always squash + delete source branch
No other merge strategy, ever: set it at creation and at completion; a policy forbidding squash →
stop and say so. Details: `branch-flow`.
# Work item types are per-project — speak in roles
Never hardcode a type name: speak in roles and resolve the real type at runtime; the defect role is
always `Bug`, never `Issue`; no type for a role → ask. Details: `azdo-cli`.
# Done means verified
Never claim done, fixed or passing without a command that was run and its output read. Report one
of three states: **verified** (the command and its result), **not verified** (and why it could not
be), **failed** (quote the output). The definition of done per change type is in `done-check`.
# Search and read without triggering a prompt
A permission rule is prefix-matched against the **whole command string**, so `cd <path> && grep …`
starts with `cd` and can never match a `Bash(grep *)` rule — no rule anyone adds will ever cover it.
Every command in that shape goes to the classifier instead, and a recursive read whose scope cannot
be resolved statically ends in a question. Across 50 sessions more than 500 commands had that shape:
it is the single largest source of interruptions.
- **Search with the Grep tool**, passing `path` and `glob`. Never `cd X && grep`.
- **Read with the Read tool**, using `offset`/`limit` for a slice instead of `sed -n` on a path
  reached by `cd`.
- When the shell genuinely is the right instrument, **put the directory in the command** —
  `grep -rn "x" <abs-path> --include=*.ts`, `git -C <path> log` — so the command starts with the
  program and a rule can match it.
- This outranks the general preference for the shell: the shell stops being the cheaper tool the
  moment it needs a prompt.
