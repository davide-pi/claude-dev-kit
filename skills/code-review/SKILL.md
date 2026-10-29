---
name: code-review
description: >-
  Use when a diff, branch, commit range or PR needs review: /code-review [scope|pr] [effort] [focus];
  "fammi la review"; posts PR questions only when typed.
argument-hint: "[scope] [effort] [focus]"
---

# code-review — a change or PR reviewed by subagents, reported in chat

**Contract.** Findings, completeness and the To do / Already done tables in chat · posts tagged questions on a PR only under the posting gate; never approves, merges, votes or edits a PR, never edits, stages, commits or builds · report in the chat language; `file:line`, field values and code verbatim.

Arguments: `$ARGUMENTS`

## When

- `/code-review`, or "rivedi le modifiche" on uncommitted work, a branch or a range; before a PR that
  touches a contract, data or auth (`/code-review high`).
- `/code-review <pr-id|url>`, or "rivedi la PR": PR mode.

Not for: quality-only cleanup across the change (`/simplify`); fixing what a review found (a normal edit, after the user's ok).

## Decide

| Posting gate | Rule |
| --- | --- |
| PR mode writes on the PR (thread, reply, resolve) **only** when the owner typed `/code-review <pr-id\|url>` this turn | reached any other way (model-invoked, "rivedi la PR") → the questions go to chat and the owner's ok comes first |

### Argument grammar — order free, every part optional

| Part | Values | Absent → |
| --- | --- | --- |
| scope | `<branch>` → `git fetch origin <branch>`, diff `origin/<branch>...HEAD` · `HEAD~<n>`, `<sha>`, `<sha>..<sha>` → that range · paths → the diff restricted to them, or the files as they stand (say so) · a PR id or URL → **PR mode**: read it via `gh`/`azdo-cli`, same fan-out, post only genuine tagged questions (`references/pr-mode.md`) | `git diff HEAD` + `--staged`; both empty → `git show HEAD`, said |
| effort | `low` · `medium` · `high` · `xhigh` · `max` | `medium` |
| focus | `security` · `performance` · `completeness` · any axis | none |

### Who reviews — one message, every brief identical except `model`

| Request | Agents |
| --- | --- |
| `low`, `medium` | `code-reviewer` (frontmatter model) |
| `high`, `xhigh`, `max` | `code-reviewer` **A** (`model` omitted → sonnet) + `review-security` + `review-performance`; from `xhigh` also `code-reviewer` **B** (`model: opus`) |
| focus `security` / `performance` | that specialist alone — a focus overrides the effort |
| any other focus | `code-reviewer` alone, told the axis |

Every Agent call passes the requested effort as its `effort` parameter, never only in the brief text.
"advanced" / "agent `<model>`" from the user: the model table in `references/report-format.md`. The brief
is built **once** and passed to A (and B, from `xhigh`) unchanged; its contents are in
`references/effort-and-fanout.md`. Never review inline unless no subagent can be spawned — then say so;
a missing specialist or second model is a degraded review, named in the verdict. 30+ files → offer
`/review-large` (two whole-change reviewers, A on Sonnet + B on Opus), never launch it unasked.

### Intent — before spawning

The user's request → the branch's `git log <base>..HEAD` → the linked work item or PR with its
acceptance criteria. Still unclear → ask for one line; completeness cannot be judged without it.

### Merge

Same defect at the same anchor from A and B → `CONFIRMED`; one model only → `PLAUSIBLE`; a fixed one →
`status: done`, `Resolved by: session`: the full rules in `references/effort-and-fanout.md` § Merging.

### Report

One merged report in the chat language, in exactly this skeleton (English labels; at chat `it` read the
equivalents on the `At chat it:` line after the skeleton in `references/report-format.md` first, with the field meanings):

```text
Order: Findings → Completeness → To do → Already done → Quick fixes → Verdict. Tables last; after
Verdict at most one short question.
Merge checklist, done by whoever writes the report (reviewer blocks are input, not output):
1. A block naming more than one defect → split it, one block per defect; renumber, keep each one's evidence.
2. Every file:line → Grep/Read the quoted code in the working tree and correct the line; note the
   corrections once in Verdict.
Findings: a full block per P1/P2 todo (what breaks, scenario, file:line, minimal fix), one defect per
block; the P3s under one "Improvements" block, one line each.
Completeness: N points — covered N, then each partial, missing or wrong point, and scope creep.
To do (status: todo), columns exactly:
| # | Priority | Category | Location | Finding | Verdict | Risk | Effort |
Already done (status: done, one line each), columns exactly:
| # | Category | Location | Finding | Resolved by |
Sort: P1 → P3, CONFIRMED before PLAUSIBLE, clean-code last within its priority; rows keep the finding
numbers; every finding gets a row. Location = file:line, Finding ~80 chars, Resolved by = commit,
thread or "session". Findings posted on a PR add a "Posted" column to both tables.
Quick fixes: #n, #n — every P3 + low + S finding, one "ok" applies them.
Verdict: one line naming each agent, its model and effort; a blocked or missing worker is a gap.
No findings → no tables: "nothing to report, verified: …".
```

Close with one line offering the P1s and "ok" for the quick fixes. Apply nothing until the user answers.

## Do

```powershell
# the diff once, generated files out; every agent reads this file
git diff <range> --output=<scratchpad>/review.diff -- ':/' ':!*.lock' ':!package-lock.json' `
  ':!*.min.*' ':!*dist/*' ':!*__snapshots__/*' ':!*.Designer.cs' ':!*ModelSnapshot.cs' ':!*.g.cs'
git diff <range> --stat -- ':/'
```

Show one line before spawning: range, files, `+/−`, what was excluded. Nothing to review → say so
and stop.

## Traps

1. A/B briefs differ in more than `model` → disagreement measures the brief, not the models → copy
   one brief.
2. Compiler or linter errors reported as findings → CI owns them → no build, no test run.
3. Findings invented to fill the report → "nothing to report, verified: …" is a valid result.
4. At `xhigh`+ the pair returns identical findings in identical words → both ran on one model, or one read the
   other's output → separate spawns in one message, different `model`.

## References

- `references/pr-mode.md` — scope is a PR: golden rules, platform table, triage, steps.
- `references/effort-and-fanout.md` — the package every agent gets, effort depth, merging, tags.
- `references/triage.md` — PR or chat, phrasing a question, second passes, verifying a finding.
- `references/posting.md` — posting per platform, replying, resolving; threads cannot be deleted.
- `references/report-format.md` — fields; the `finding-format` skill — the verdict line.
- `references/code-reviewer-passes.md`, `references/review-security-checks.md`, `references/review-performance-checks.md` — the matching agent names the § it needs; not opened from here.
