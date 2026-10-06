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

1. **Resolve the scope** per the grammar and write the diff **once** to the scratchpad, excluding
   generated files: `git diff <range> --output=<scratchpad>/review.diff -- ':/' ':!*.lock'
   ':!package-lock.json' ':!*.min.*' ':!*dist/*' ':!*__snapshots__/*' ':!*.Designer.cs'
   ':!*ModelSnapshot.cs' ':!*.g.cs'`. Show one line: range, file count, +/−, files excluded. Nothing
   to review → say so and stop.

2. **Establish the intent** — what this change was supposed to accomplish. In order: what the user
   asked for in this conversation; the branch's commit messages (`git log <base>..HEAD`); a linked
   work item or PR if one exists. If the intent stays unclear, **ask the user for one line** before
   reviewing — without it the completeness pass has nothing to compare against, and saying so beats
   guessing.

3. **Run the review through the subagents** (never inline unless one is unavailable), passing each
   the **diff file path**, the base branch, the intent, the effort, and "lockfiles excluded":
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
   keep both when they describe different failures at the same line. A finding already fixed in this
   session becomes `status: done` (`Risolto da: sessione`). Sort per the global `CLAUDE.md`.

5. **Report in chat, in Italian**, exactly in the shape of the global `CLAUDE.md` § "Review output"
   (two tables Da fare / Già fatti, the fields, the sort order, the verbatim values). Order:
   - **Rilievi** — one block per `todo` finding, numbered in sort order: what breaks, the failure
     scenario, the evidence (`file:line`), the minimal fix. `done` ones: one line each.
   - **Completezza** — the intent points checked, which are covered, which are not.
   - **Tabelle** Da fare, then Già fatti — the **last** blocks, so they stay on screen.
   - **Fix rapidi** and **Verdetto** — one line each: `N rilievi (X da fare, Y già fatti · P1: N) ·
     security: N · completezza: N`, plus which agents ran at which effort.
   - Nothing found → say so, list what was verified, skip the tables.

6. **Offer, do not act.** One short Italian line: the P1s worth applying and "ok" for the fix rapidi.
   Apply nothing until the user says so; if they do, that is a normal edit — this command never
   writes.

## Guardrails

- Read-only: no edits, no staging, no `git commit`/`push`/`switch`/`stash`/`reset`, no posting to
  GitHub or Azure DevOps.
- Do not build, typecheck, or run tests to produce findings — CI does that, and compiler/linter
  errors are not findings.
- Do not invent findings to fill a quota. An honest "nothing wrong here, this is what I checked" is
  a valid result.
- Quality-only cleanups across the whole change are the **`/simplify`** job; this command hunts
  defects, regressions, security, completeness, and reports clean-code issues as a side channel.
