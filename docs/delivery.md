# Delivery — how a change moves, and how this repository ships

The procedure lives in the skills; this page is the map. The details belong to `deliver`
(`skills/deliver/references/loop.md` holds the run, size and question rules) and `plan-work`.

## The path of a change

```
request ─► route (CLAUDE.md) ─► plan-work? ─► deliver ─► /commit ─► pr-create ─► branch-flow finish
                                               │
                     triage: scenario, size S/M/L, risk axes, perimeter, test matrix
                                               │
                     impl-review-loop: implementer → reviewers by size → fixes → OK | STALL
                                               │
                     scope-guard --check · tests by level · verdict table · perimeter closed
```

| Step | Owner | Leaves behind |
| --- | --- | --- |
| route | the table in `CLAUDE.md` | nothing |
| plan, when worth one | `plan-work` | a plan file in `docs/plans/`, ignored by git (below) |
| triage and perimeter | `deliver` | `<git dir>/deliver/perimeter.md`, per worktree, never committed |
| implement and review | `impl-review-loop` workflow | the diff; `findingsLog` for the session |
| close | `scripts/perimeter.ps1 -Close -FindingsLog` | one line in `<git dir>/deliver/findings.jsonl`, read by `session-brief.js` and `/retro` |
| commit, PR, finish | `/commit`, `pr-create`, `branch-flow` | an Italian commit and PR, squash merge, source branch deleted |

Three principles shape the loop (from `loop.md`): **one run per coherent request**, since a run has a large
fixed cost; **every check scales with the size**; and **only weighty doubts reach the owner** (anything
that changes what they see or use, a contract, data, cost or risk, or that goes against a decision they made).

## Plans are working files

A plan is a handoff between sessions, not documentation. `plan-work` writes it to `docs/plans/` and adds that
folder to the repository's `.git/info/exclude`, so it is never committed and leaves no trace in any repo's tree.
A decision that must outlive the work goes into the docs of the area it changes, or into the commit message.
In this repository `.gitignore` also lists `/docs/plans/`.

## Changing this repository

1. **Branch and worktree.** Never commit in the main clone: other sessions use it. One branch per change, in
   its own worktree (`branch-flow`).
2. **Gate**, from the worktree root:
   ```powershell
   node --test tools/*.test.mjs
   node tools/validate.mjs
   claude plugin test mods/cockpit      # when mods/cockpit changed
   ```
3. **Install and check** once the gate is green, so the live config runs the change straight away:
   ```powershell
   .\install.ps1 -Force
   .\install.ps1 -Check
   ```
4. **Commit** on the branch (`/commit`). Push and PR only when asked; the PR is squash-merged and the
   source branch deleted.
5. **Docs**: a change that moves a rule described in `docs/` or the README updates them in the same branch.
