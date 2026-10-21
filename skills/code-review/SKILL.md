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
| `low`, `medium` | `code-reviewer` |
| `high`, `xhigh`, `max` | `code-reviewer` **A** + `code-reviewer` **B** on another model + `review-security` + `review-performance` |
| focus `security` / `performance` | that specialist alone — a focus overrides the effort |
| any other focus | `code-reviewer` alone, told the axis |

`model` per agent ("advanced", "agent `<model>`", A versus B): the table in the shared report format
below. The brief: diff file path, base, intent (acceptance criteria verbatim), effort, which
specialists run beside it, previous findings. Never review inline unless no subagent can be spawned
— then say so.

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

Shape, fields, sort, columns, Fix rapidi and the closing lines: `skills/pr-review/references/report-format.md`.
Order: **Rilievi** (one block per `todo`: what breaks, the scenario, `file:line`, the minimal fix;
`done` one line) · **Completezza** (`N punti — coperti N`, then each partial, missing or wrong point,
then scope creep) · tables last · `Verdetto` with the agents and efforts that ran · one line offering
the P1s and "ok" for the fix rapidi. Apply nothing until the user answers.

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
