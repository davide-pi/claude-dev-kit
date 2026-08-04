---
name: pr-review
description: Review a pull request on Azure DevOps and post ONLY genuine questions/doubts as inline comments (English, tagged [Claude AI Review]); everything else is reported to the user in chat, never on the PR. Use when the user wants a PR reviewed and/or commented. Trigger: /pr-review [target] [effort].
---

# /pr-review — Review a PR, post only the questions

Review a pull request, then **triage** the findings: only genuine **questions/doubts**
(rarely, a critical "why") get posted on the PR as review discussion — **in English**.
Everything else (explanations, notes, confirmations, FYIs) is reported to the user **in
chat only**, never on the PR.

Platform: **Azure DevOps** (this skill does not post to GitHub yet).

## Golden rules (non-negotiable)

1. **A PR comment is a question, not an explanation.** Post a thread only when it needs an
   answer/decision from a human or another agent — it exists to drive discussion. Do NOT
   post standalone explanations, status updates, "nota", or "FYI". If a point just needs to
   be *understood*, it belongs in chat, or as a code comment if it truly needs to live in
   the code. Posting a critical/cryptic "why" as a PR comment is a rare exception.
2. **English only** for anything posted to the PR (threads, replies). The chat summary to
   the user may stay in the user's language (e.g. Italian).
3. **Tag every posted comment**: `[Claude AI Review]` by default; `[Claude AI Review - <agent>]`
   when a distinctly-scoped reviewer produced the finding (see Attribution).
4. **Never invent findings to fill a quota.** No questions → post nothing; say so in chat.

## Procedure

1. **Resolve the target PR.**
   - Argument may be a PR id, a branch name, or empty.
   - Empty → the active PR whose `sourceRefName` == the current branch. Find it with
     `repo_list_pull_requests_by_repo_or_project` (filter status Active, match source branch).
     If none exists, report it and stop (create the PR first, or the user names one).
   - A number → that PR id. A branch → its active PR.

2. **Resolve Azure DevOps coordinates.** From `git remote get-url origin`:
   - `https://{org}.visualstudio.com/{project}/_git/{repo}` or
     `https://dev.azure.com/{org}/{project}/_git/{repo}` → extract `org`, `project`, `repo`.
   - Pick the Azure DevOps MCP server connected **in this session** that serves that `org` —
     never assume its name: look at which `mcp__<server>__repo_*` tools actually exist. If two
     servers point at the same org they are equivalent → use the first. If no connected server
     matches the org, say so and ask the user which one to use.
   - Get the repository GUID with `repo_get_repo_by_name_or_id(project, repo)`; use the GUID
     as `repositoryId` for all subsequent calls (and pass `project`).

3. **Get the diff.** Diff against the **remote** target branch, never the local one — a stale
   local `master`/`main` makes `git diff master...HEAD` include already-merged commits that
   are not part of the PR. Run `git fetch origin <targetBranch>` first, then
   `git diff origin/<targetBranch>...HEAD` (targetBranch from the PR, usually `master`/`main`).
   Sanity-check with `git rev-list --left-right --count <targetBranch>...origin/<targetBranch>`;
   if the local branch is behind, the remote diff is the source of truth. Include uncommitted
   changes (`git diff HEAD`) if the review runs before a commit. Read the enclosing function of
   each hunk — bugs in unchanged lines of a touched function are in scope.

4. **Generate findings.** Spawn the **`code-reviewer`** subagent (Agent tool) at the requested
   effort (default: medium; `[effort]` arg = low|medium|high|xhigh|max), passing it the diff/scope,
   the target branch, **and the intent of the change**: the PR title and description, the title and
   description of the linked work items (from the PR object, then `wit_get_work_item`), and the
   branch's commit messages when that text is thin. The intent is what the subagent's completeness
   pass compares the diff against — never omit it; if there genuinely is none, say so when spawning
   so the gap is visible in its report. It carries its own review methodology — defects,
   regressions, security, clean code, completeness — and returns findings only: it never posts. **Pick its model** per the "Review agents — model selection" convention in the
   global CLAUDE.md: default → omit `model` (agent runs on Sonnet); "advanced" → pass the current
   session model explicitly; "agent {model}" → pass that exact model. If the subagent is
   unavailable, apply its method inline (see `agents/code-reviewer.md`: per-hunk scan including the
   enclosing function, removed-guard audit, cross-file caller/callee check, language pitfalls, plus
   reuse/simplification/efficiency/altitude cleanups).

5. **Triage every finding into exactly one bucket.** The subagent's `for the author` field is the
   default signal (`yes` → PR candidate, `no` → chat); override it only with a stated reason, and a
   `PLAUSIBLE` verdict is itself a hint that the point is a question, not a statement.
   - **POST to PR** — it is a real question/doubt needing an answer or decision, e.g.:
     - "Is X intended, or should it be Y?" / "Was dropping guard Z deliberate?"
     - a correctness concern whose resolution depends on info only the author/another agent has;
     - a **CONFIRMED `security`, `regression`, or `completeness`** finding — it does not stay in
       chat, but phrase it as the question the author has to answer ("This path builds the query by
       concatenation — is the input validated upstream?", "`Status.Archived` isn't handled in
       `Map()` — intentional?"), never as a lecture;
     - (rare) a critical/cryptic point where a short "why?" must be confirmed.
   - **REPORT in chat only** — everything else: explanations, confirmations, low-severity
     notes, cleanups you can just describe, findings you already resolved yourself.
   When unsure, default to **chat**, not the PR.

6. **Post the PR bucket** as inline threads, in **English**, status **Active** (it awaits an
   answer). Use `repo_create_pull_request_thread` with:
   - `filePath` = repo-relative path with leading `/` (the finding's `anchor` path, plus the slash);
   - `rightFileStartLine`/`rightFileStartOffset` (1-based) and `rightFileEndLine`/`rightFileEndOffset`
     to anchor the line (a 1-char span, e.g. start offset 1 / end offset 2, is fine);
   - `content` starting with the tag, then the question. Keep it short and answerable.
   - Include a ` ```suggestion ` block only when it fully fixes the issue.

7. **Report to the user in chat** (their language is fine): the full finding list, which ones
   were posted (with thread ids) and which were kept in chat and why. If nothing was posted,
   say so explicitly.

## Attribution

- Default tag: `[Claude AI Review]`.
- If the finding came from a **distinctly-scoped reviewer** — a subagent spawned with a
  specific focus (e.g. security, performance) or a review run explicitly under such a persona —
  tag `[Claude AI Review - <scope>]` (e.g. `[Claude AI Review - security]`). No preset list:
  the scope name mirrors the agent/persona actually used. Default flow (general review on the
  main thread) always uses the plain tag.

## Notes

- **No delete via MCP.** The Azure DevOps MCP can create threads and set status
  (`repo_update_pull_request_thread`) but cannot delete. To retract a posted comment, set it
  `Closed`/`WontFix` and tell the user it must be deleted from the web UI (or via REST) if they
  want it gone.
- Reply to an existing thread with `repo_reply_to_comment`; resolve with
  `repo_update_pull_request_thread` (`Fixed`/`Closed`/`ByDesign`).
- Do not edit the PR description or complete/merge the PR here — that is out of scope.
