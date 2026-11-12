---
name: code-review
description: >-
  Use when a diff, branch, commit range or PR needs review: /code-review [scope|pr] [effort] [focus];
  "fammi la review"; posts PR questions only when typed.
argument-hint: "[scope] [effort] [focus]"
---

# code-review — a change or PR reviewed by subagents, reported in chat

**Contract.** Findings, completeness and a summary in chat · posts tagged questions on a PR only under the posting gate; never approves, merges, votes or edits a PR, never edits, stages, commits or builds · report in the chat language; `file:line`, field values and code verbatim.

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
| effort | `low` · `medium` · `high` · `xhigh` · `max` | `high` |
| focus | `security` · `performance` · `completeness` · any axis | none |

### Who reviews — one message, every brief identical except `model`

| Request | Agents |
| --- | --- |
| `low`, `medium` | `code-reviewer` (frontmatter model) |
| `high`, `xhigh`, `max` | `code-reviewer` **A** (`model` omitted → sonnet) + `review-security` + `review-performance`; from `xhigh` also `code-reviewer` **B** (`model: opus`) |
| focus `security` / `performance` | that specialist alone — a focus overrides the effort |
| any other focus | `code-reviewer` alone, told the axis |

Every Agent call passes the requested effort as its `effort` parameter, not only in the brief.
"advanced" / "agent `<model>`" from the user: the model table in `references/report-format.md`. The brief
is built **once**, passed unchanged to A (and B); contents in `references/effort-and-fanout.md`. Never review inline unless no subagent can be spawned — then say so;
a missing specialist or second model is a degraded review, named in the verdict. 30+ files → offer
`/review-pair`, never launch it unasked.

### Intent — before spawning

The user's request → the branch's `git log <base>..HEAD` → the linked work item or PR with its
acceptance criteria. Still unclear → ask for one line; completeness cannot be judged without it.

### Merge

Same defect at the same anchor from A and B → `CONFIRMED`; one model only → `PLAUSIBLE`; a fixed one →
`status: done`, `Resolved by: session`: the full rules in `references/effort-and-fanout.md` § Merging.

### Report

One merged report in the chat language, exactly this skeleton; at chat `it` read the `At chat it:` line in `references/report-format.md`:

```text
Order: outcome line → Findings → Problems → Summary → footer (Verdict, Reply), the end. Never inside `> `
or a code fence.
Merge checklist, done by whoever writes the report (reviewer blocks are input, not output):
1. A block naming more than one defect → split it, one block per defect; renumber, keep each one's evidence.
2. Every file:line → Grep/Read the quoted code in the working tree and correct the line; note the
   corrections once in Verdict.
Findings (todo): after `---`, title `**Findings · n**` (a single one: no title, no `---`), one block each,
P1 → P3, CONFIRMED before PLAUSIBLE, clean-code last within its priority; `#F<n>` = finding number:
**#F<n> · <title>** — `file:line`
- Problem: what breaks and the scenario, one line
- Advice: the minimal fix, one line
- P1: one axis per line: `- Severity **P1** — why`, then Risk and Effort the same way
- P2, P3: one line: Severity P2: why · Risk low: why · Effort S: why
- To confirm: only a PLAUSIBLE finding (CONFIRMED writes nothing): what settles it
- Posted: only on a PR, thread or "chat only"
Problems · n (`#I`): after `---`; every Completeness gap (N points, covered N: partial, missing, wrong, scope creep) is one item, same shape.
Already done (done): rows in Findings, `#F<n> · <title>` — `file:line` — resolved by commit, thread or "session".
Summary · n: after `---`, 3+ items only, columns exactly:
| # | Item | Severity · Risk · Effort | For you |
One row per item, same order (`P1 · medium · M`, `ok F1`).
Footer: Verdict, criteria covered N of N, each agent, its model and effort (a blocked or missing worker is a gap); then
`Reply ok F3 F4 …`, the P1s and every P3 + low + S finding; apply nothing before the answer.
No findings → no sections: "nothing to report, verified: …".
```

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
- `references/code-reviewer-passes.md`, `references/review-security-checks.md`, `references/review-performance-checks.md` — the matching agent names the § it needs.
