---
name: docs-sync
description: >-
  Use when the user types /docs-sync: runs doc-keeper on the repo's tech docs or wiki against the
  working diff, a range or an audit.
argument-hint: "[scope] [tech|wiki] [--audit]"
disable-model-invocation: true
---

# docs-sync — the repository's docs tree reconciled with the code, through doc-keeper

**Contract.** The `doc-keeper` report relayed, approvals collected · never touches source or
configuration, never creates a docs tree, never commits, pushes or publishes a wiki page · report in
Italian; paths and `file:line` verbatim.

Arguments: `$ARGUMENTS`

## When

- `/docs-sync` after a change that moved something the docs describe; `/docs-sync --audit` for drift
  and gaps independent of any diff.

Not for: a single README edit (a normal edit); creating a docs tree from nothing.

## Decide

### Argument grammar — order free, every part optional

| Part | Values | Absent → |
| --- | --- | --- |
| scope | `<branch>` → `git fetch origin <branch>`, diff `origin/<branch>...HEAD` · `HEAD~<n>`, `<sha>..<sha>` · paths (a docs or source area) | `git diff HEAD` + `--staged`; both empty → the last commit, said |
| tree | `tech` (`docs/`, `docs/tech*`, `architecture/`, `adr/`) · `wiki` (a `wiki/` folder, or the repo is a cloned project wiki) | whichever exists; both → ask |
| `--audit` | walk the whole tree or the given paths against the source | change-scoped |

### The spawn — one `doc-keeper`

| Field | Value |
| --- | --- |
| tree | the path found |
| mode | `change-scoped` (diff file) or `audit` (paths) |
| language | tech tree **English**; wiki pages **Italian**, one fact on one page |
| output | its fixed report, ≤ 40 lines |

No tree found → say so and stop. Empty diff and no `--audit` → nothing to sync, stop.

### After the report

Relay in Italian: tree, files verified / updated / created / removed, pending approvals
(experience-derived entries), gaps and hand-offs. Pending entries stay pending until the user
approves; then re-spawn `doc-keeper` with the approval.

## Do

```powershell
Get-ChildItem -Directory -Depth 1 | Where-Object Name -Match '^(docs?|wiki|adr|architecture)$'
git diff <range> --output=<scratchpad>/docs.diff
```

## Traps

1. The agent "fixes" a source file it found wrong → out of its tree → a hand-off in the report.
2. A claim it could not verify against the code written as fact → reported as unverified instead.
