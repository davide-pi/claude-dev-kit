# Posting, and the chat report

## Azure DevOps

CLI first for everything readable: the active PRs, the PR itself, its base branch and head commit,
and the linked work items. Verbs, auth and org/project resolution are `azdo-cli`'s job.

**Posting an inline thread has no dedicated CLI verb**, so it goes through the CLI's generic REST
invoke — again `azdo-cli` — with the connected Azure DevOps **MCP server as documented fallback**
when that is not available. Say in the chat report which of the two was used.

Whatever carries the call, one thread per question, and the payload always needs:

| Field | Value |
| --- | --- |
| file path | repo-relative, with a **leading `/`** |
| right-file start line / offset | 1-based, from the finding's anchor; a one-character span is fine |
| right-file end line / offset | the end of that span |
| status | **Active** — the thread is waiting for an answer |
| content | the tagged question |

Also true here:

- **Threads cannot be deleted.** A wrong comment can be closed (by-design / won't-fix) but not
  removed: tell the user it needs the web UI or a REST delete if they want it gone.
- Replying to an existing thread and resolving one are the same capability as creating: same route,
  same fallback.
- Never complete the PR, never change its description.

## GitHub

`gh` throughout, and it is stable enough to take literally. Post **one review carrying every
comment**, so the author gets a single notification instead of N:

```powershell
# payload.json
# {"commit_id":"<headRefOid>","event":"COMMENT","comments":[
#   {"path":"src/Foo.cs","line":42,"side":"RIGHT","body":"[Claude AI Review] ..."} ]}
gh api --method POST repos/{owner}/{repo}/pulls/<n>/reviews --input payload.json
```

- `event` is **always `COMMENT`** — never `APPROVE`, never `REQUEST_CHANGES`. Approving or blocking
  is a human decision.
- `line` is 1-based in the file **after** the change with `side: RIGHT`; `side: LEFT` for a deleted
  line (the anchor says which). Add `start_line` for a range.
- The line must belong to the PR diff. On a 422, retry that single comment as a file-level comment
  (`subject_type: file`, no `line`) rather than dropping the question.
- Reply in a thread:
  `gh api --method POST repos/{owner}/{repo}/pulls/<n>/comments/<comment-id>/replies -f body=...`
- A comment **can** be deleted here:
  `gh api --method DELETE repos/{owner}/{repo}/pulls/comments/<comment-id>` — say what was deleted.
- Resolving a thread is GraphQL-only (`resolveReviewThread`); if it fails, say so rather than
  leaving the thread open silently.
- Before a second pass: `gh api repos/{owner}/{repo}/pulls/<n>/comments --jq '.[].body'` and skip
  anything already carrying the tag.
- Report `gh` failures to the user instead of continuing quietly.

## The chat report — summary table last

In this order, so the table is what is still on screen when the report ends:

1. **Findings** — the full list, one block each, numbered `1.`, `2.`, … in severity order: what
   breaks, the concrete failure scenario, the evidence as `file:line`, the minimal fix, and the
   agent that found it. `clean-code` items grouped after the correctness ones, same numbering.
2. **Posted vs chat** — which findings became threads (thread ids on Azure DevOps, the review URL on
   GitHub) and, for each finding kept in chat, why. If nothing was posted, say so explicitly.
3. **Summary table** — the **last** block, one row per finding, same numbers and same order as the
   blocks above, so the row order *is* the severity order:

   | # | Category | Location | Finding | Verdict | Posted |
   |---|----------|----------|---------|---------|--------|
   | 1 | security | `src/Api/UsersController.cs:42` | route id concatenated into the SQL text | CONFIRMED | yes — thread 118 |
   | 2 | clean-code | `src/Core/Mapper.cs:88` | duplicates `MapAddress`, drifts from it | CONFIRMED | no — chat only |

   Every finding gets a row, `clean-code` and minor ones included, last. Keep the `Finding` cell to
   one short line (~80 chars, no wrapping): it points at the block above, it does not summarise it.
   `Posted` carries the thread id or comment link whenever the finding went onto the PR.
4. **Verdict** — one line under the table:
   `N findings (X posted, Y chat-only) · security: N · completeness: N`, plus which agents ran at
   which effort, and which interface posted. Nothing after it.

No findings at all → say exactly that, list what was verified, and **skip the table**.
