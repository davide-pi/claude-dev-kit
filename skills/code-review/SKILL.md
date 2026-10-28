---
name: code-review
description: >-
  Use when a diff, branch, commit range or PR needs review: /code-review [scope|pr] [effort] [focus];
  posts PR questions only when typed.
argument-hint: "[scope] [effort] [focus]"
---

# code-review — a change or PR reviewed by subagents, reported in chat

**Contract.** Findings, completeness and the Da fare / Già fatti tables in chat · posts tagged questions on a PR only under the posting gate; never approves, merges, votes or edits a PR, never edits, stages, commits or builds · report in Italian; `file:line`, field values and code verbatim.

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
`/review-large`, never launch it unasked.

### Intent — before spawning

The user's request → the branch's `git log <base>..HEAD` → the linked work item or PR with its
acceptance criteria. Still unclear → ask for one line; completeness cannot be judged without it.

### Merge

Same defect at the same anchor from A and B → `CONFIRMED`; one model only → `PLAUSIBLE`; a fixed one →
`status: done`, `Risolto da: sessione`: the full rules in `references/effort-and-fanout.md` § Merging.

### Report

One merged report in Italian, in exactly this skeleton (fields and column meanings:
`references/report-format.md`):

```text
Order: Rilievi → Completezza → Da fare → Già fatti → Fix rapidi → Verdetto. Tables last; after
Verdetto at most one short question.
Merge checklist, done by whoever writes the report (reviewer blocks are input, not output):
1. A block naming more than one defect → split it, one block per defect; renumber, keep each one's evidence.
2. Every file:line → Grep/Read the quoted code in the working tree and correct the line; note the
   corrections once in Verdetto.
Rilievi: a full block per P1/P2 todo (what breaks, scenario, file:line, minimal fix), one defect per
block; the P3s under one "Miglioramenti" block, one line each.
Completezza: N punti — coperti N, then each partial, missing or wrong point, and scope creep.
Da fare (status: todo), columns exactly:
| # | Priorità | Categoria | Posizione | Rilievo | Verdetto | Rischio | Sforzo |
Già fatti (status: done, one line each), columns exactly:
| # | Categoria | Posizione | Rilievo | Risolto da |
Sort: P1 → P3, CONFIRMED before PLAUSIBLE, clean-code last within its priority; rows keep the finding
numbers; every finding gets a row. Posizione = file:line, Rilievo ~80 chars, Risolto da = commit,
thread or "sessione". Findings posted on a PR add a "Postato" column to both tables.
Fix rapidi: #n, #n — every P3 + basso + S finding, one "ok" applies them.
Verdetto: one line naming each agent, its model and effort; a blocked or missing worker is a gap.
No findings → no tables: "nulla da segnalare, verificato: …".
```

Close with one line offering the P1s and "ok" for the fix rapidi. Apply nothing until the user answers.

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
3. Findings invented to fill the report → "nulla da segnalare, verificato: …" is a valid result.
4. At `xhigh`+ the pair returns identical findings in identical words → both ran on one model, or one read the
   other's output → separate spawns in one message, different `model`.

## References

- `references/pr-mode.md` — scope is a PR: golden rules, platform table, triage, steps.
- `references/effort-and-fanout.md` — the package every agent gets, effort depth, merging, tags.
- `references/triage.md` — PR or chat, phrasing a question, second passes, verifying a finding.
- `references/posting.md` — posting per platform, replying, resolving; threads cannot be deleted.
- `references/report-format.md` — report fields, column meanings, the model table.
- `references/code-reviewer-passes.md`, `references/review-security-checks.md`, `references/review-performance-checks.md` — the matching agent names the § it needs; not opened from here.
