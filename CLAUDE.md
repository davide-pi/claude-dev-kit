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
