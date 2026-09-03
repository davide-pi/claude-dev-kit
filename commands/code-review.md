---
description: Review the working diff (or a given scope) and report findings in chat — never posts, never edits, never commits.
argument-hint: "[scope] [effort] [focus]"
---

Review a code change **locally** and report everything **in chat**. Nothing is posted anywhere, no
file is modified, no commit is created. For reviewing a PR on Azure DevOps or GitHub (and posting
the genuine questions on it) use the **`pr-review`** skill instead.

## Argument grammar

Parse "$ARGUMENTS"; order does not matter, all parts are optional.

- **scope** — what to review:
  - *(empty)* → the **working diff**: `git diff HEAD` plus `git diff --staged`. If both are empty,
    fall back to the last commit (`git show HEAD`) and say so.
  - **`<branch>`** → `git fetch origin <branch>` then `git diff origin/<branch>...HEAD` (the
    **remote** target, never a stale local one).
  - **`HEAD~<n>`** / **`<sha>`** / **`<sha>..<sha>`** → that range.
  - **one or more paths** → restrict the diff to them (or review the files as they stand if there is
    no diff there, saying that is what you did).
- **effort** — `low` | `medium` | `high` | `xhigh` | `max`; default **medium**.
- **focus** — `security` | `performance` | `completeness` | any other axis; restricts the review to
  that axis.

## Steps

1. **Resolve the scope** per the grammar and show one line stating what is under review (range,
   file count, insertions/deletions). If there is nothing to review, say so and stop.

2. **Establish the intent** — what this change was supposed to accomplish. In order: what the user
   asked for in this conversation; the branch's commit messages (`git log <base>..HEAD`); a linked
   work item or PR if one exists. If the intent stays unclear, **ask the user for one line** before
   reviewing — without it the completeness pass has nothing to compare against, and saying so beats
   guessing.

3. **Run the review through the subagents** (never inline unless one is unavailable), passing each
   the scope, the base branch, the intent, and the effort:
   - `low` / `medium` → **`code-reviewer`** alone.
   - `high` / `xhigh` / `max` → **`code-reviewer`**, **`review-security`** and
     **`review-performance`** spawned **in parallel in a single message**.
   - **focus** given → only the matching specialist (`security` → `review-security`,
     `performance` → `review-performance`), otherwise the generalist told to concentrate on that
     axis. A focus overrides the effort-based fan-out.

   **Pick each agent's model** per the "Review agents — model selection" convention in the global
   `CLAUDE.md`: default → omit `model`; "advanced" → the current session model explicitly;
   "agent {model}" → that exact model.

4. **Merge the outputs**: drop a specialist finding the generalist already reported at the same
   anchor for the same defect (keep the more specific category and the higher-confidence verdict);
   keep both when they describe different failures at the same line; sort by severity across agents.

5. **Report in chat, in Italian** — every word a person reads is Italian: the finding blocks and
   their one-line statements, the completeness notes, the verdict line and the closing question.
   Code, identifiers, suggested diffs and `file:line` anchors are pasted verbatim, never translated
   — and so are the **category slugs** the agents return (`correctness`, `security`, `performance`,
   `clean-code`): they are identifiers the three reviewers agree on and the owner greps for, so the
   column header is Italian while the value inside it is not.
   Report in this order — the **summary table comes last**, so it is what is still on screen when
   the report ends and the reader scrolls up only for the rows worth the detail:

   - **Rilievi** — one block each, numbered `1.`, `2.`, … in severity order: what breaks, the
     concrete failure scenario, the evidence (`file:line`), and the minimal fix. Group the
     `clean-code` items separately, after the correctness ones, keeping the same numbering.
   - **Completezza** — the intent points checked, which are covered, which are not.
   - **Tabella riassuntiva** — the **last block** of the report, one row per finding, same numbers
     and same order as the blocks above (so the row order *is* the severity order). The column
     headers are Italian, but three things inside the table are **never** translated: the `Verdetto`
     values `CONFIRMED`/`PLAUSIBLE`, the `Posizione` anchors, and the `Categoria` slugs — all three
     are identifiers the reader greps for and the agents agree on:

     | # | Categoria | Posizione | Rilievo | Verdetto |
     |---|-----------|-----------|---------|----------|
     | 1 | security | `src/Api/UsersController.cs:42` | id di route concatenato nel testo SQL | CONFIRMED |
     | 2 | clean-code | `src/Core/Mapper.cs:88` | duplica `MapAddress` e ne sta divergendo | CONFIRMED |

     Every finding gets a row, `clean-code` and minor ones included (last). Keep the `Rilievo` cell
     to one short line (~80 chars, no wrapping): it is a pointer to the block above, not a summary
     of it.
   - **Verdetto** — one line right under the table: `N rilievi (X CONFIRMED, Y PLAUSIBLE) ·
     security: N · completezza: N`, plus which agents ran at which effort.
   - Nothing found → say exactly that in Italian, list what was verified, and skip the table.

6. **Offer, do not act.** Close with **one short line, in Italian** — the one or two fixes worth
   applying — and ask whether to apply them. Keep it to that line so the table stays on screen.
   Apply nothing until the user says so; if they do, that is a normal edit — this command itself
   never writes.

## Guardrails

- Read-only: no edits, no staging, no `git commit`/`push`/`switch`/`stash`/`reset`, no posting to
  GitHub or Azure DevOps.
- Do not build, typecheck, or run tests to produce findings — CI does that, and compiler/linter
  errors are not findings.
- Do not invent findings to fill a quota. An honest "nothing wrong here, this is what I checked" is
  a valid result.
- Quality-only cleanups across the whole change are the **`/simplify`** job; this command hunts
  defects, regressions, security, completeness, and reports clean-code issues as a side channel.
