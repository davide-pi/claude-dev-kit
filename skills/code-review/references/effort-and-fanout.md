# Effort, fan-out and attribution

## Effort sets depth, the ladder sets who

Who is spawned and on which model: `report-format.md` § "Who reviews, on which model". Effort here is review
depth, written in the brief (the agent's "Effort → Passes" table); the agents' reasoning effort stays their own
default. It tells every agent how deep to go:

| Effort | Depth asked of each agent |
| --- | --- |
| `low` | a quick pass over a small, low-risk diff |
| `medium` | the default: defects, regressions, security basics, clean code, completeness |
| `high` | reviewer A plus both specialists, each on its own axis |
| `xhigh` | the full two-model pair plus both specialists, told to follow call paths out of the diff |
| `max` | the same, exhaustive: every touched path, every caller |

`[focus]` overrides the ladder: `security` → `review-security` alone, `performance` →
`review-performance` alone, anything else (`completeness`, `clean-code`, a subsystem) → the
generalist told to concentrate on that axis. Parallel agents go out **in a single message**.

## The package every agent receives

Identical for all of them — the two reviewers of the pair differ **only** in `model`, so they also
share the prompt-cache prefix:

1. **The scope** — the path of the one diff file in the scratchpad (generated files excluded at
   write time, and the package says so), the base branch, the files in play. Manifests
   (`package.json`, `*.csproj`) and migration `.cs` files are never excluded.
2. **The effort**, so depth is calibrated, not guessed.
3. **The intent** — PR title and body plus the linked items' text (Azure DevOps through `azdo-cli`;
   GitHub `gh pr view <n> --json closingIssuesReferences`, then `gh issue view <n> --json title,body`),
   acceptance criteria **verbatim**. No stated intent → say so in the brief, so the gap shows in the
   report instead of being filled in by the agent.
4. **Findings only** — no agent posts, edits or commits.
5. **Previous findings** on an incremental pass (`triage.md` § "Second passes"): anchor, question,
   thread state, so each can be marked `done` or re-reported `todo`.
6. **The specialists running beside it** — told to the generalists only: no dedicated security or
   performance pass, but they still report what their other passes surface.
7. For the pair: "you may be one of two reviewers on different models — report what you see, do not
   soften for agreement".
8. **The output contract in one line** — Finding blocks in the agent's Output format, Italian prose, anchors
   on working-tree lines, one defect per block.

## Merging

Merge before triage:

1. Same anchor, same defect, **two models** → one finding, `CONFIRMED`, sorted first.
2. Same anchor, same defect, one model plus a specialist → one finding: the more specific category,
   the higher-confidence verdict, the union of the questions, the specialist's tag.
3. One model only → `PLAUSIBLE`, unless it quotes evidence that settles it.
4. Same line, **different** failure → two findings.
5. Re-sort across agents in the `report-format.md` order, keep the **higher** priority on a
   conflict, number the survivors `1..n` — the chat report and the tables use that numbering.
6. Track which agent (and model) produced each survivor — it decides the tag.
7. Already fixed in this session → `status: done`, `Risolto da: sessione`.

## Attribution

| Producer | Tag on the PR |
| --- | --- |
| `code-reviewer` (either model) | `[Claude AI Review]` |
| `review-security` | `[Claude AI Review - security]` |
| `review-performance` | `[Claude AI Review - performance]` |
| a future distinctly-scoped reviewer | `[Claude AI Review - <its scope>]` |

## A subagent is unavailable

Apply its method inline, using the agent definition as the checklist, and say in chat that it ran
inline. A missing specialist or a missing second model is a degraded review: never report it as if
the full ladder had run.

## Traps

1. Agents spawned one after another → no parallelism, no shared cache → one message, several calls.
2. An agent gets the diff but not the intent → completeness cannot be judged → items 1–4 always.
3. The pair's briefs differ in more than `model` → disagreement measures the brief, not the model →
   build the brief once, pass it twice.
4. A specialist's finding posted with the generic tag → attribution lost in the merge → track the
   producer per survivor.
