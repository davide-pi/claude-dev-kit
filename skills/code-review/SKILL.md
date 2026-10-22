---
name: code-review
description: >-
  Use when the working diff, a branch or a commit range needs a local review reported in chat:
  /code-review [scope] [effort] [focus]. Never posts.
argument-hint: "[scope] [effort] [focus]"
---

# code-review — a local change reviewed by subagents, reported in chat

**Contract.** Findings, completeness and the Da fare / Già fatti tables in chat · never posts, edits,
stages, commits or builds · report in Italian; `file:line`, field values and code verbatim.

Arguments: `$ARGUMENTS`

## When

- `/code-review`, or "rivedi le modifiche" on uncommitted work, a branch or a range.
- Before a PR, when the change touches a contract, data or auth (`/code-review high`).

Not for: a PR on Azure DevOps or GitHub, with posted questions (`pr-review`); quality-only cleanup
across the change (`/simplify`); fixing what a review found (a normal edit, after the user's ok).

## Decide

### Argument grammar — order free, every part optional

| Part | Values | Absent → |
| --- | --- | --- |
| scope | `<branch>` → `git fetch origin <branch>`, diff `origin/<branch>...HEAD` · `HEAD~<n>`, `<sha>`, `<sha>..<sha>` → that range · paths → the diff restricted to them, or the files as they stand (say so) | `git diff HEAD` + `--staged`; both empty → `git show HEAD`, said |
| effort | `low` · `medium` · `high` · `xhigh` · `max` | `medium` |
| focus | `security` · `performance` · `completeness` · any axis | none |

### Who reviews — one message, every brief identical except `model`

| Request | Agents |
| --- | --- |
| `low`, `medium` | `code-reviewer` (frontmatter model) |
| `high`, `xhigh`, `max` | `code-reviewer` **A** (`model` omitted → sonnet) + `code-reviewer` **B** (`model`: the session family; `opus` when the session runs on sonnet) + `review-security` + `review-performance` |
| focus `security` / `performance` | that specialist alone — a focus overrides the effort |
| any other focus | `code-reviewer` alone, told the axis |

"advanced" / "agent `<model>`" from the user: the model table in
`skills/pr-review/references/report-format.md`. The brief, built **once** and passed to A and B
unchanged: diff file path, base, intent (acceptance criteria verbatim), effort, which specialists
run beside it, previous findings, "you may be one of two reviewers on different models: do not
soften for agreement", and the output contract in one line: Finding blocks in your Output format, Italian
prose, anchors on working-tree lines, one defect per block. Never review inline unless no subagent can be spawned — then say so; a
missing specialist or second model is a degraded review, named in the verdict. 30+ files → offer
`/review-large`, never launch it unasked.

### Intent — before spawning

What the user asked in this conversation → the branch's `git log <base>..HEAD` → the linked work
item or PR with its acceptance criteria. Still unclear → ask the user for one line; completeness
cannot be judged without it.

### Merge

| Case | Result |
| --- | --- |
| A and B report the same defect at the same anchor | one finding, `CONFIRMED`, first within its priority |
| only A or only B | kept; `PLAUSIBLE` unless it quotes the evidence that settles it |
| a specialist and a reviewer at the same anchor, same defect | keep one: the more specific category, the higher verdict |
| same line, different failures | keep both |
| already fixed in this session | `status: done`, `Risolto da: sessione` |

### Report

One merged report in Italian, in exactly this skeleton (fields and column meanings:
`skills/pr-review/references/report-format.md`). The host's output style or CLAUDE.md never overrides it:

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
4. Summary table first → it scrolls away → tables are the last block.
5. The pair returns identical findings in identical words → both ran on one model, or one read the
   other's output → separate spawns in one message, different `model`.
