# Effort, fan-out and attribution

## The ladder

`[effort]` is the second argument of the trigger; default **medium**.

| Effort | Agents spawned | Reads as |
| --- | --- | --- |
| `low` | `code-reviewer` | a quick pass over a small, low-risk diff |
| `medium` | `code-reviewer` | the default: defects, regressions, security basics, clean code, completeness |
| `high` | `code-reviewer` + `review-security` + `review-performance` | three views of the same diff, in parallel |
| `xhigh` | the same three, told to go deeper and to follow call paths out of the diff | a release-blocking change |
| `max` | the same three, exhaustive: every touched path, every caller | the rare change nobody can afford to get wrong |

`[focus]` overrides the ladder: `security` → `review-security` alone, `performance` →
`review-performance` alone, anything else (`completeness`, `clean-code`, a subsystem name) → the
generalist told to concentrate on that axis. Spawn parallel agents **in a single message**, never
one after another.

## The package every agent receives

Identical for all of them, and never trimmed:

1. **The scope** — the diff (or how to produce it), the base branch, and the files in play.
2. **The effort**, so the agent calibrates depth rather than guessing.
3. **The intent of the change** — the PR title and body, plus the text of what the PR implements:
   the linked Azure DevOps work items (through `azdo-cli`) or the linked GitHub issues
   (`gh pr view <n> --json closingIssuesReferences`, then `gh issue view <n> --json title,body`).
   Fall back to the branch's commit messages when that text is thin.
4. **The instruction that it returns findings only** — no agent posts, edits, or commits.

The intent is what the completeness pass compares the diff against, so it is the one part that must
never be omitted. If there genuinely is no stated intent, say so when spawning: the gap then shows
up in the report instead of being silently filled in by the agent.

## Model selection

Follow the user's review-agent convention, for **every** review subagent:

| The request says | `model` parameter |
| --- | --- |
| nothing about a model | omit it — the agent runs on its own default |
| "advanced agents" | pass the current session model family explicitly |
| "agent \<model\>" | pass exactly that model |

## Merging overlapping findings

Three agents on one diff will collide. Merge before triage:

1. Same anchor, same defect → keep one: the **more specific category**, the **higher-confidence**
   verdict, the union of the questions.
2. Same line, **different** failure → keep both; they are two findings.
3. Re-sort everything by severity **across** agents, then number the surviving findings `1..n`.
   That numbering is what the chat report and the summary table both use.
4. Track which agent produced each survivor — it decides the tag.

## Attribution

| Producer | Tag on the PR |
| --- | --- |
| `code-reviewer` | `[Claude AI Review]` |
| `review-security` | `[Claude AI Review - security]` |
| `review-performance` | `[Claude AI Review - performance]` |
| any future distinctly-scoped reviewer | `[Claude AI Review - <its scope>]` |

There is no preset list beyond that: the scope name mirrors the reviewer actually used. When a
specialist and the generalist found the same defect, the surviving finding keeps the **specialist's**
tag — it carries more context.

## If a subagent is unavailable

Apply its method inline, using the agent definition as the checklist, and say in chat that it ran
inline rather than as a subagent. A missing specialist is a degraded review, not a skipped axis —
never report a high-effort review as if all three had run.

## Traps

1. Agents spawned sequentially → three round-trips and no parallelism → one message, several calls.
2. An agent gets the diff but not the intent → completeness cannot be judged → the package is all
   four parts or it is incomplete.
3. Both a specialist and the generalist report the same line → the report reads as two problems →
   merge first, triage second.
4. A specialist's finding is posted with the generic tag → attribution was lost in the merge → track
   the producer per surviving finding.
5. The session model is passed by default → cost with no benefit → omit `model` unless the request
   asked for something else.
