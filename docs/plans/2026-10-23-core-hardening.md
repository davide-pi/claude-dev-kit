# Plan: harden the impl-review-loop core (C1–C12)

Branch `refactor/kit-v3`. Source: critical review of the core + literature review (2026-10-23), all 12 changes approved.
Gates for every task: `node --test tools/*.test.mjs` (bash, repo root) and `node tools/validate.mjs`, both green.

## Decisions (former open questions, resolved with the recommended option)

1. C7 snapshot = new kit script `scripts/snapshot.ps1` using a throwaway index (`GIT_INDEX_FILE` = copy of the index
   under `<git-dir>/deliver/snap.index`, `git add -A`, `git write-tree`), output JSON `{ tree, files, churn }`.
   Not `git stash create` (no untracked files; "stash" is in the implementer's Never list), not `git add -N`
   (mutates the user's index). Own allow rule, like `perimeter.ps1`.
2. C5 "not reproduced" rejection: the next round's reviewers get the challenge first; withdraw closes it, keep
   stalls with `why: 'not-reproduced'`. Never sent back to the fixer.
3. C2 cap counts fix cycles only (rounds that end in FIX), as approved by the user ("3 giri" = three
   review→fix cycles); RECHECK and coverage reruns do not count (they are cheap after C11).
4. C6 widen answered by resolution `{ round, widen: [entries] }`, applied from that round on (earlier prompts stay
   byte-identical for resume); the session also rewrites `perimeter.md` with `perimeter.ps1` after the user's yes.
5. C7 post-OK check = CLI mode `node ~/.claude/hooks/scope-guard.js --check <head> [--dirty a,b]` (reuses the
   perimeter matching rule), own allow rule.
6. C4: M reviews cost more (Opus); README and the deliver table say so.

## Design summary

- **One source of git truth (C7; feeds C2, C3, C6, C10).** Every implementer/fixer run ends with
  `snapshot.ps1 -Since <previous tree | start head>` → `tree`, `files` (vs start.head + untracked − start.dirty),
  `churn` (insertions + deletions from `git diff --numstat <-Since> <tree>`; the shortstat text is localized). The workflow uses `snapshot.files` as `changed`; reviewers from round 2 run
  `git diff <prevTree> <tree>`.
- **New pure functions** (between `// --- pure:begin` / `// --- pure:end`, added to the test's destructure list in the
  same task): `reviewersFor`, `sizeFor`, `readReport`, `verifyGate`, `capLimit`, `findingHistory`, `churnGrowing`,
  `rejectionLedger`, `isNeverBlocking`, `unreviewedFiles` (extended), `coverageAction`, `recheckReviewers`, `idsToAsk`,
  `widenedFiles`, `deltaCommand`.
- **Missing fields at runtime:** no `verify` → `{ status: 'not-run' }` (stalls only when `args.verify` is set); no
  `filesReviewed` → nothing read; no `rejected`/`noticed` → empty; no `snapshot` → declared `files`, `churn: null`
  (never triggers the churn stall).
- **Args backward compatible:** `resolutions` entries gain `continue?: true`, `widen?: string[]`; `touches` honoured
  at M too; nothing removed.
- **Resume determinism:** cap, churn, history, widen derive only from agent results, `round`, `resolutions`. No
  `Date`/`Math.random`.

## Existing tests that flip on purpose

- `impl-review-loop.test.mjs` 232 `again({ category: 'security' })` → rematched (T1).
- 195 `sizes.M` → `opus:high`; 191 M with `touches` → specialists added (T2).
- 584 "size L with a specialist… STALL" → one rerun before STALL, reason `gap`; 568 `uncovered` same shape (T11).
- 136 implementer mock, 148 `review()` helper → gain `verify`, `snapshot`, `filesReviewed` (T3).
- `done-claim.test.mjs` 165–168, 180, 198–205 → helper `result(text)` carries the deciding line (T17).

## Phase 0 — groundwork

- [x] **T1 `sameFinding` without category (C2).** Files: `workflows/impl-review-loop.js`, `tools/impl-review-loop.test.mjs`.
  Drop the category comparison, except that a `scope` finding only matches another `scope` one (a revert request never folds into another finding); update header comment (85–88) and `dedupeFound` comment. Interface unchanged.
  Verify: new test `sameFinding: a re-categorised finding (correctness → regression) on the same spot is the same finding`
  fails first; flip line 232. Depends: none.
- [x] **T2 reviewers by size, size re-derived (C4, C10).** Same files. Pure `reviewersFor(size, touches)`: S = A Sonnet
  medium; M = A Opus high; L = A Sonnet high + B Opus high; security/performance specialists at M and L when `touches`.
  Pure `sizeFor(given, changedCount)`: 1 file keeps, 2–4 ≥ M, 5+ → L, only upward. Called each round; log
  `roundLog[i].size`. Verify: `sizeFor: 1 file keeps S, 3 files lifts S to M, 6 lifts M to L, never downgrades L`;
  `script: an S change that grows to 5 files is reviewed as L from the next round`; update the reviewers-by-size test.
  Depends: none.
- [x] **T3 schema fields + helpers (C1, C3, C5, C6, C7, C12).** Same files. IMPLEMENTATION: required
  `verify: { status: pass|fail|not-run, command, line }`, `snapshot: { tree, files[], churn }`,
  `rejected: [{ id, reason }]`, `noticed: [{ title, path, why }]` (evidence stays required). REVIEW: required
  `filesReviewed: string[]`. FINDING_IN: `causedByChange: boolean`, `confidence: CONFIRMED|PLAUSIBLE`. Pure
  `readReport(r)` fills defaults. Update mocks. Verify: `readReport: a report without verify is not-run, without
  rejected/noticed empty, without snapshot null`. Depends: none.

## Phase 1 — execution feedback (C1, C2 green→red)

- [x] **T4 verify gate.** Pure `verifyGate({ report, verifyCmd, toFixHadVerify, previous }) → { finding?, stall?, status }`:
  implementer `fail` → synthetic P1 `{ id: 'V<n>', path: '(verify)', category: 'verify' }` (always blocking) into
  round-1 `toFix`; fixer `fail` with a V finding in its toFix → STALL `verify-failed`; `pass` then `fail` → STALL
  `green-to-red`; `not-run` with `args.verify` → STALL `verify-not-run`; `pass` closes V findings. Reviewer prompt gets
  ``Verify (run by the implementer): `<command>` → <status>: <line>``. `result()` gains `verify`, `evidence`,
  `notVerified`. V ids never asked to reviewers. Verify: `verifyGate: …` unit test; `script: a red verify after
  implement goes to the fixer as V1 and the reviewers see the verify line`. Depends: T3.

## Phase 2 — classification

- [x] **T5 style never blocks; widen (C5 partial, C6).** `classify(f, files, { dirty, root, touched })`: `clean-code`,
  `convention` never blocking (`isNeverBlocking`); P1/P2 outside, non-scope, path in `touched` or `causedByChange` →
  `'widen'`. `decideRound` returns `widen`, any → STALL `why: 'widen'`. `accept` on widen → outOfScope accepted;
  `widenedFiles(files, resolutions, round)` applies widen from that round. Verify: classify unit test; `script: widen
  STALL, resumed with { round, widen } reaches OK and round-1 prompts are byte-identical`. Depends: T3 (T10 for
  `touched`; until then declared `changed`).
- [x] **T6 hunk-level scope + noticed (C12).** Reviewer perimeter rule gains "any hunk the brief does not require, even
  inside a perimeter file, is category `scope`". `decideRound` returns `scopeReverts`; recorded as
  `{ source: 'scope-revert', title, path, why }` proposals; `noticed` pushed as `{ source: 'noticed', … }`;
  `result().outOfScope = [...notes, ...noticed, ...outOfScope, ...proposals]`. Fixer prompt: revert scope hunks.
  Verify: `script: an unrequested hunk inside the perimeter is reverted by the fixer and listed as a scope-revert
  proposal; noticed items reach outOfScope`. Depends: T3.
- [x] **T7 false positives (C5).** Pure `rejectionLedger({ rejected, counts }) → { counts, challenge, notReproduced }`.
  Rejected id not counted fixed; next round CHALLENGE block (open = keep + why, closed = withdraw). `decideRound`
  inputs `challenged`, `rejections`, `notReproduced`: withdrawn → closed; kept not-reproduced → STALL
  `not-reproduced`; kept with count ≥ 2 → STALL `disputed`; kept count 1 → back to toFix with the reviewer's note.
  Fix prompt: PLAUSIBLE P1/P2 → REPRODUCE FIRST, else `rejected` reason 'not reproduced', no code change. Verify:
  decideRound challenge test; `script: the fix prompt asks to reproduce a PLAUSIBLE P2 first`. Depends: T3, T5.

## Phase 3 — termination and snapshots (C2, C7)

- [x] **T10 `scripts/snapshot.ps1` + delta from snapshots (C7.1).** New `scripts/snapshot.ps1 -Since <tree|sha> [-Start <sha>] [-Dirty 'a,b']`
  (`-Start` = the commit `files` is measured from, default HEAD; the workflow passes the start head; throwaway index, real index/worktree untouched, temp index removed, exit 2 on usage error), new
  `snapshot.test.mjs` under tools (skipped without pwsh, like `perimeter.test.mjs`), allow rules in `settings.json` next to
  the perimeter ones (PowerShell + Bash). Workflow: IMPL/FIX prompts end with the exact command (`SNAPSHOT_TEXT`);
  `changed` from `snapshot.files`; delta scope ``git diff <prevTree> <tree>`` via pure `deltaCommand(prevTree, tree, startHead)`;
  inline: first fixer `-Since` = startHead. Verify: `snapshot.ps1: a new untracked file and an edit appear in files;
  the real index is unchanged; churn counts the lines since -Since`; `script: round 2 reviewers get git diff t1 t2`.
  Depends: T3.
- [x] **T8 soft cap + history + continue.** `capLimit(extensions) = 3 * (1 + extensions)`, `extensions` = the `continue: true` resolutions
  given on a round that stalled on the cap; a FIX decision when the number of fix cycles already run `>= capLimit` → STALL `cap`
  (RECHECK/coverage reruns not counted) + `history = findingHistory(roundLog)` (only the ids that were tracked); every STALL carries
  `history`. Resume text lists `continue?`, `widen?`; header comment "soft cap 3, +3 per continue". Verify: `capLimit: 3, 6, 9`; `script:
  four rounds each finding a new P2 → STALL "cap" at round 4 (three fix cycles run) with history; resume { round: 4, continue: true }
  runs up to the next cap STALL at round 7 (six fix cycles)`. Depends: T7.
- [x] **T9 churn stall.** `fixChurns` from fixer snapshots (nulls skipped); `churnGrowing(churns)` = last 3 strictly increasing.
  The churn is judged at a round's decision, after its reviewers read the last fix, and only while that decision is still FIX: STALL
  `churn`; `roundLog[i].churn`. A resolution on that round works as on any other: `accept` closes the open ids (the fix was read),
  guidance/retry go to the fixer, `continue` only restarts the churn count (3 more fix cycles only when the cap was hit on that
  round too, reported then as `cap`). Verify: `churnGrowing: 10,20,30 true; 10,30,20 false; <3 or null false`; `script: churns 30,10,20,30
  with continue at round 4 → STALL "churn" at round 5; accept on round 5 ends OK after reviewers read git diff t4 t5`. Depends: T3, T10.

## Phase 4 — coverage and recheck (C3, C11)

- [x] **T11 coverage.** `unreviewedFiles(answers, reviewers, groups, pending, root, changed)`: group reviewer clears
  only assigned files listed in `filesReviewed`; whole reviewer clears listed `changed` files; specialist clears
  nothing; null = all unread. Pure `coverageAction({ unread, retried }) → ok|rerun|stall`; rerun only the owners of
  unread files, in full; stall `gap` + `stall.files`. Specialist null → STALL `gap` naming it. `gaps` entries per
  unread file. Verify: `unreviewedFiles: a group reviewer that omits a file from filesReviewed leaves it unread`;
  `script: a specialist that returns nothing is a STALL "gap"`; flip 584/568. Depends: T3, T10.
- [x] **T12 targeted RECHECK, closed re-asks (C11).** `mergeReviews` returns `answeredBy`; pure
  `recheckReviewers({ answers, reviewers, asked })` → keys to rerun; pure `idsToAsk({ tracked, known, lastFixFiles,
  skipped, root })` → open ids + closed ids only on files the last fix touched; accepted never. Verify:
  `recheckReviewers: L round where only B skipped F2 → only B reruns`; `idsToAsk: a closed finding on a file the last
  fix did not touch is not re-asked`; reviewer count per round asserted. Depends: T2, T10.

## Phase 5 — agent, skill, hook text

- [x] **T13 `agents/implementer.md` (C1, C5, C7, C9, C12).** Ground rule "Preserve existing code: fix the code itself,
  never wrap a broken path in a new guard or flag; delete dead code rather than wrap it". Verify step: status, command,
  deciding line. End step: run `snapshot.ps1` as the brief gives it. PLAUSIBLE → reproduce first, else `rejected`
  'not reproduced'; judged wrong → `rejected` with reason, no edit. Output gains `## Rejected`, `## Noticed`. Verify:
  validate clean; `script: the implement and fix prompts carry the snapshot command and the reproduce-first rule`.
  Depends: T4, T7, T10.
- [x] **T14 reviewer agents (C3, C5, C9, C12).** `code-reviewer.md`, `review-security.md`, `review-performance.md`;
  never touch the fenced Finding block or the one-defect rule (pinned by validate). Pass B: guard-wrapping instead of
  fixing → `regression`/`correctness`. Line 40: unrequested hunk even inside the perimeter → `scope`; `causedByChange`
  for an outside defect this change causes. All three: Input row for challenged findings (keep/withdraw), Output line
  "list every file you actually read under `filesReviewed`". Verify: validate clean; `script: reviewer prompts ask for
  filesReviewed and carry the CHALLENGE block`. Depends: T3, T7, T11.
- [x] **T15 `scope-guard.js --check` (C7.2).** Export pure `outsidePerimeter(paths, entries, dirty)`; CLI `--check <head>
  [--dirty a,b]`: `git diff --name-only <head>` + `git ls-files --others --exclude-standard` (execFileSync, no shell),
  active perimeter, prints outside files; exit 0 clean, 1 outside, 2 usage. Without `--check` reads stdin as before.
  Allow rules in `settings.json`. Verify: `outsidePerimeter: …` unit; `--check in a temp repo: an untracked file
  outside the perimeter exits 1 and is printed`. Depends: none.
- [x] **T16 `skills/deliver/SKILL.md` (≤ 120 lines, now 119) + `references/loop.md`.** Review cell M = "1 Opus high, +
  specialists when touched"; Do 3: `OK` → `scope-guard.js --check <head>`, outside → back to step 3; verdict line
  `Review: giro N, 0 P1/P2 aperti. Gap: <gaps, o nessuno>. Rischi residui: …`; `outOfScope` includes `noticed` and
  `scope-revert`. loop.md: size re-derived upward, touches M and L, STALL reasons (`cap` + history, `verify-failed`,
  `green-to-red`, `verify-not-run`, `churn`, `gap`, `widen`, `disputed`, `not-reproduced`), full resolutions shape,
  widen = `perimeter.ps1 -Files` after the user's yes, section "After OK: the mechanical scope check", snapshot allow
  rule. C13 (approved): on M and L, between analysis and the loop, list implicit requirements, edge cases and ambiguities;
  only a doubt that changes behaviour becomes a question, batched, each with a recommendation; on L `grill-me` runs on the
  plan by default (not only when the design is argued); S unchanged. Verify: validate (SKILL ≤ 120). Depends: T5, T8, T11, T15.
- [x] **T17 `hooks/done-claim.js` (C8).** `readTurn` arms on `Workflow`, `Agent`, `Task` tool_use (`DELEGATE_TOOLS`,
  count as an edit for ordering); collects `results` (all tool_result text, string or text blocks); `turnComplete`.
  Pure `verdictRows(message)`, `unprovenRows(rows, resultsText)`: a `fatto`/`failed` row's deciding line (normalised:
  whitespace collapsed, backslashes/backticks stripped, lowercase) must be a substring of the results; `non verificato`
  rows pass alone; any unproven row blocks, even after shell-ran; `!turnComplete` → log `tail-truncated`, no block.
  HONEST per row/line. **Transcript shape:** workflow results and agent hand-backs arrive as user-role
  task-notification / peer-message entries, not `tool_result` blocks; today `readTurn` stops at a peer message. The
  turn boundary must be the last genuine human prompt only, and `results` must include notification and peer-message
  text. A fixture mirrors the real shape: assistant tool_use Workflow → user entry with `<task-notification>` →
  assistant verdict. Verify: `a Workflow-only turn with a verdict row whose deciding line is not in any tool_result
  is blocked; the same line inside the Workflow result (JSON-escaped) is silent`; `a "non verificato" row does not
  excuse a fatto row without proof`; update 165–168, 180, 198–205. Depends: none.
- [x] **T18 README + full gate.** README lines 46, 120, 126, 190 (soft cap, verify gate, coverage, snapshots, widen,
  challenge flow, M = Opus; `snapshot.ps1` beside `perimeter.ps1`); workflow header/`meta.whenToUse` resolutions.
  Verify: full tests + validate green; no hits for "no round cap", "touches.*L only". Depends: T1–T17.

## Sequencing

T1, T2, T3, T15, T17 parallel-safe → T10 → T4, T5, T6, T7 → T8, T9 → T11, T12 → T13, T14, T16 → T18.
Commit per phase.

/goal all tasks ticked; `node --test tools/*.test.mjs` and `node tools/validate.mjs` exit 0.
