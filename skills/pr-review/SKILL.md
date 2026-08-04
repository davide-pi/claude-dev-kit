---
name: pr-review
description: Review a pull request on Azure DevOps or GitHub and post ONLY genuine questions/doubts as inline comments (English, tagged [Claude AI Review]); everything else is reported to the user in chat, never on the PR. Use when the user wants a PR reviewed and/or commented. Trigger: /pr-review [target] [effort] [focus].
---

# /pr-review — Review a PR, post only the questions

Review a pull request, then **triage** the findings: only genuine **questions/doubts**
(rarely, a critical "why") get posted on the PR as review discussion — **in English**.
Everything else (explanations, notes, confirmations, FYIs) is reported to the user **in
chat only**, never on the PR.

**Platform: Azure DevOps or GitHub.** Detect it from `git remote get-url origin` and follow the
matching branch at each step — everything else (the golden rules, the review itself, the triage) is
identical on both:

- `*.visualstudio.com` / `dev.azure.com` → **Azure DevOps**, via the connected Azure DevOps MCP.
- `github.com` → **GitHub**, via the `gh` CLI.
- anything else → say so and stop; review in chat only, post nothing.

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

1. **Resolve the target PR.** The argument may be a PR id, a branch name, or empty; empty means
   the open PR whose source branch is the current one. If none exists, report it and stop (create
   the PR first, or let the user name one).
   - **Azure DevOps** — `repo_list_pull_requests_by_repo_or_project`, filter status Active and
     match `sourceRefName`.
   - **GitHub** — `gh pr view --json number,title,body,headRefName,baseRefName,headRefOid,url` for
     the current branch, or `gh pr list --head <branch> --state open --json number,title` / `gh pr
     view <id> --json ...` for an explicit target. Keep `headRefOid`: posting inline comments needs
     that commit sha.

2. **Resolve the platform coordinates.** From `git remote get-url origin`:
   - **Azure DevOps** — `https://{org}.visualstudio.com/{project}/_git/{repo}` or
     `https://dev.azure.com/{org}/{project}/_git/{repo}` → extract `org`, `project`, `repo`. Pick
     the Azure DevOps MCP server connected **in this session** that serves that `org` — never assume
     its name: look at which `mcp__<server>__repo_*` tools actually exist. If two servers point at
     the same org they are equivalent → use the first. If no connected server matches the org, say
     so and ask the user which one to use. Get the repository GUID with
     `repo_get_repo_by_name_or_id(project, repo)`; use the GUID as `repositoryId` for all subsequent
     calls (and pass `project`).
   - **GitHub** — `{owner}/{repo}` from the remote (or `gh repo view --json nameWithOwner`). Check
     `gh auth status` first: without a working `gh` login nothing can be posted, so say so and fall
     back to a chat-only review.

3. **Get the diff.** Diff against the **remote** target branch, never the local one — a stale
   local `master`/`main` makes `git diff master...HEAD` include already-merged commits that
   are not part of the PR. Run `git fetch origin <targetBranch>` first, then
   `git diff origin/<targetBranch>...HEAD` (targetBranch from the PR, usually `master`/`main`).
   Sanity-check with `git rev-list --left-right --count <targetBranch>...origin/<targetBranch>`;
   if the local branch is behind, the remote diff is the source of truth. Include uncommitted
   changes (`git diff HEAD`) if the review runs before a commit. Read the enclosing function of
   each hunk — bugs in unchanged lines of a touched function are in scope.

4. **Generate findings (fan-out by effort).** Every agent gets the same package: the diff/scope, the
   target branch, the effort (default: medium; `[effort]` arg = low|medium|high|xhigh|max), and **the
   intent of the change** — the PR title and description, plus the text of whatever the PR is
   implementing (Azure DevOps: the linked work items via `wit_get_work_item`; GitHub: the linked
   issues, e.g. `gh pr view <n> --json closingIssuesReferences` or the `Fixes #<n>` references in the
   body, then `gh issue view <n> --json title,body`), and the branch's commit messages when that text
   is thin. The intent is what the completeness pass compares the diff against — never omit it; if
   there genuinely is none, say so when spawning so the gap shows up in the report.
   Every agent returns findings only: none of them ever posts.

   - `low` / `medium` → the generalist **`code-reviewer`** alone (defects, regressions, security
     basics, clean code, completeness).
   - `high` / `xhigh` / `max` → spawn **in parallel, in a single message**: `code-reviewer`,
     **`review-security`** (attacker's view: exposed surface, taint, authz, secrets) and
     **`review-performance`** (cost: complexity, per-item I/O, allocations, caching, queries).
   - `[focus]` given (`security` | `performance` | anything else, e.g. `completeness`) → spawn only
     the matching specialist, or the generalist told to concentrate on that axis when no specialist
     covers it. A focus overrides the effort-based fan-out.

   **Pick each agent's model** per the "Review agents — model selection" convention in the global
   CLAUDE.md: default → omit `model` (agents run on Sonnet); "advanced" → pass the current session
   model explicitly; "agent {model}" → pass that exact model.

   **Merge before triage:** drop a specialist finding the generalist already reported at the same
   anchor for the same defect (keep the more specific category and the higher-confidence verdict,
   union the questions); keep both when they describe different failures at the same line; re-sort
   everything by severity across agents. Track **which agent produced each surviving finding** — it
   drives the Attribution tag below.

   If a subagent is unavailable, apply its method inline (`agents/code-reviewer.md`,
   `agents/review-security.md`, `agents/review-performance.md`) and say in chat that it ran inline.

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

6. **Post the PR bucket** as inline comments, in **English**, each starting with its tag and then the
   question — short and answerable. Include a ` ```suggestion ` block only when it fully fixes the
   issue. Anchor from the finding's `anchor` field.

   - **Azure DevOps** — one thread per question with `repo_create_pull_request_thread`, status
     **Active** (it awaits an answer):
     - `filePath` = repo-relative path with leading `/` (the `anchor` path, plus the slash);
     - `rightFileStartLine`/`rightFileStartOffset` (1-based) and `rightFileEndLine`/`rightFileEndOffset`
       to anchor the line (a 1-char span, e.g. start offset 1 / end offset 2, is fine);
     - `content` = the tagged question.
   - **GitHub** — post **one review carrying all the comments**, so the author gets a single
     notification instead of N:

     ```bash
     # payload.json: {"commit_id":"<headRefOid>","event":"COMMENT","comments":[
     #   {"path":"src/Foo.cs","line":42,"side":"RIGHT","body":"[Claude AI Review] ..."}, ...]}
     gh api --method POST repos/{owner}/{repo}/pulls/<n>/reviews --input payload.json
     ```

     - `event` is **always `COMMENT`** — never `APPROVE` or `REQUEST_CHANGES`: approving or blocking
       is a human decision.
     - `line` is 1-based in the file **after** the change with `side: RIGHT`; use `side: LEFT` for a
       deleted line (the finding's `anchor` already says which). For a range add `start_line`.
     - The line must belong to the PR's diff. If GitHub rejects it (422), retry that one comment as a
       file-level comment (`subject_type: file`, no `line`) rather than dropping the question.
     - Report `gh` failures to the user instead of silently continuing.

7. **Report to the user in chat** (their language is fine): the full finding list, which ones
   were posted (with thread ids on Azure DevOps, the review URL on GitHub) and which were kept in
   chat and why. If nothing was posted, say so explicitly.

## Attribution

- Default tag: `[Claude AI Review]` — used for everything the generalist `code-reviewer` found.
- Findings produced by a **distinctly-scoped reviewer** carry its scope:
  `review-security` → `[Claude AI Review - security]`, `review-performance` →
  `[Claude AI Review - performance]`. No preset list beyond that: the scope name mirrors the
  agent/persona actually used, so a future specialist tags itself the same way.
- After a merge, the tag follows the finding that survived. If both a specialist and the generalist
  independently found the same defect, use the specialist's tag — it carries more context.

## Notes

**Azure DevOps**

- **No delete via MCP.** The MCP can create threads and set status
  (`repo_update_pull_request_thread`) but cannot delete. To retract a posted comment, set it
  `Closed`/`WontFix` and tell the user it must be deleted from the web UI (or via REST) if they
  want it gone.
- Reply to an existing thread with `repo_reply_to_comment`; resolve with
  `repo_update_pull_request_thread` (`Fixed`/`Closed`/`ByDesign`).

**GitHub**

- Reply in an existing thread with
  `gh api --method POST repos/{owner}/{repo}/pulls/<n>/comments/<comment-id>/replies -f body=...`.
- A comment **can** be removed here:
  `gh api --method DELETE repos/{owner}/{repo}/pulls/comments/<comment-id>` — so a wrong comment is
  retractable, unlike on Azure DevOps. Say what you deleted.
- Resolving a thread is GraphQL-only (`resolveReviewThread`); if the user asks for it and it fails,
  tell them rather than leaving the thread open silently.
- Before re-reviewing, check for your own earlier comments
  (`gh api repos/{owner}/{repo}/pulls/<n>/comments --jq '.[].body'` and look for the tag) and do not
  post the same question twice.

**Both**

- Do not edit the PR description or complete/merge the PR here — that is out of scope.
