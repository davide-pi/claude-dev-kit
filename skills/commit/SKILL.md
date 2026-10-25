---
name: commit
description: >-
  Use when about to run `git commit`, or the user says "commit" or "committa": writes the Italian
  message from the diff. Never pushes.
argument-hint: "[branch] | -b [new-branch] | -m \"message\""
allowed-tools: Bash(git add*), Bash(git commit*), Bash(git switch*), PowerShell(git add*), PowerShell(git commit*), PowerShell(git switch*)
---

# commit — one commit, the message generated from the diff

**Contract.** A commit on the intended branch and a four-field report · never pushes, amends,
rebases, forces or skips hooks · message and report in Italian; identifiers, paths, `AB#<id>`,
`Fixes #<n>` verbatim.

Arguments: `$ARGUMENTS`

## When

- `/commit`, "fai il commit", "committa", or any `git commit` you are about to run: the current changes,
  ready to record. Load this first, so the message is the Italian one generated from the diff.

Not for: naming or creating a branch for new work, worktrees, finishing a branch (`branch-flow`);
pushing or opening a PR (`pr-create`); deciding whether the change is done (the evidence row below).

## Decide

### Argument grammar

| Form | Target |
| --- | --- |
| empty | the current branch |
| `<name>` | the **existing** branch `<name>` (`git switch`, changes carried along); missing → stop and suggest `-b <name>` — a typo must not fork silently |
| `-b [name]` | a new branch from `HEAD` (`git switch -c`); no name → a short English kebab-case name from the summary (`fix/date-filter`) |
| `-m "message"` | this exact message; combinable with the above |

### Staging

| State | Commit |
| --- | --- |
| something already staged | only the staged changes |
| nothing staged | everything pending, new files included (`git add -A`) |
| nothing to commit | say so and stop |

List the files before committing, so unrelated work is seen. Target is the default branch → say so
in the report.

### Message

| Rule | Detail |
| --- | --- |
| Italian, imperative | `Aggiungi`, `Correggi`, `Sposta` — or the infinitive if `git log --oneline -10` shows the repo uses it; one convention per repo |
| subject | ~50–72 chars, what changed in which area, not how |
| body | only for several areas or a non-obvious why: a few `-m` bullet lines |
| banned | marketing words (`migliora`, `ottimizza`, `potenzia`, robust, seamless), an AI or tool footer |

### Evidence

The change type's evidence line (`skills/plan-work/references/evidence-by-stack.md`) seen in this
session → quote it in the report. Not seen → commit anyway, and the report says
`non verificato: <motivo>`, the checking command in the verdict table's Comando cell. This skill does not build or test.

## Do

```powershell
git status --short
git diff --staged --stat; git diff --stat
git log --oneline -10                          # the repo's subject style
git add -A                                     # only when nothing was staged
git commit -m "<subject>" -m "- <body line>"   # -m per paragraph: no heredoc, works in both shells
git log -1 --format="%h %s"
```

Report: branch · short hash · files count · the final message (+ the evidence line or
`non verificato`).

## Traps

1. A hook fails the commit → surface its output and stop; never `--no-verify`, never retry around it.
2. `git switch` refuses because of conflicts → report and stop; never force.
3. Unrelated files swept in by `git add -A` → the list was not shown → show it before committing.
4. "committa e pusha" → commit here; the push is a separate, explicit act (`pr-create`, `branch-flow`).
