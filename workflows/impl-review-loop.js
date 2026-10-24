export const meta = {
  name: 'impl-review-loop',
  description: 'Implement a decided scope (or review one the session already made), review it by size, fix inside the perimeter and re-review the delta until no P1/P2 is open or a finding stalls',
  whenToUse: 'Launched by the deliver skill for every code change. args: { brief, request?, decisions?, perimeter: { files, behaviour?, exclusions? }, repoRoot, start?: { head, dirty }, size?, inline?, changed?, dirtyConfirmed?, verify?, stackSkill?, implementerEffort?, touches?, preview?, resolutions?: [{ round, accept?, guidance?, retry?, answers?, widen? }] } (one entry per stalled round, all of them on every relaunch with resumeFromRunId). After an OK the caller runs hooks/scope-guard.js --check. When the run ends (OK, or a STALL the owner gives up on; never on a relaunch) the caller appends result.findingsLog to the findings log, one line per run.',
  phases: [
    { title: 'Implement', detail: 'the implementer agent, brief plus perimeter (skipped when the session edited inline)' },
    { title: 'Review', detail: 'reviewers by size, each previous finding marked closed or open, new ones listed apart' },
    { title: 'Fix', detail: 'the implementer fixes the open P1/P2 inside the perimeter only; the delta is re-reviewed' },
  ],
}

// This workflow exceeds the kit's `workflowSizeGuideline: "small"` (fewer than 5 agents) by design: one
// implementer, the panel of the size (up to four reviewers, a delta round up to five with the Sonnet), and a convergence stop on the fixes. The "Large workflow" notice is expected.
//
// Who runs: `agent({ agentType })` takes the kit's typed agents (implementer, code-reviewer,
// review-security, review-performance); `model` and `effort` override the agent's own frontmatter per call.
//
// One run per coherent request (P-run): one implementer works through every plan task of the request in order, testing after each one,
// and the reviewers read the whole diff once. A run costs a fixed ~350k subagent tokens whatever its size, so the caller (deliver) splits only
// past about 15 files or for areas that share nothing (other reviewers, other verify), sequentially in the same worktree. The implement
// prompt carries no tool-call budget for that reason; the reviewers and the fixers do (their work is bounded by the findings).
//
// Every check scales with the size (P-size): S one Sonnet reviewer, no final full read, no preview; M and L as below. A doubt or a choice
// reaches the owner only when it weighs (P-weight): what the owner sees or uses, a contract or data, a cost or a risk, an owner decision.
// The rest is decided by the agents (`defaults` for the non-trivial ones) and not reported. Nothing here adds a hook or a new `stall.why`:
// every addition is an arg (`request`, `decisions`, `preview`), an output field (`defaults`, `findingsLog`, the reviewers' `questions`), a
// prompt line, or the existing `question` stall.
//
// The owner's words: `request` (the owner's messages, verbatim) goes beside the brief to the round-1 reviewers and the final full read, who
// judge the change against BOTH; `decisions` (one line each, only those touching the perimeter) go to the implementer, the fixer and every
// reviewer. A brief that departs from the request, an edit that contradicts a decision, or a hunk the owner asked for that would be reverted
// as `scope` is no finding: the reviewer lists it under `questions` (REVIEW schema), which is a STALL 'question' at that round (before any
// fix). The answers of that round (`answers: [{ text, answer }]`, matched by the exact text of the question, trim and case aside: an answer whose text matches no question is ignored; the stall comes back while a question has no answer) go to the fixer, which runs once even with nothing else
// to fix, and to the later reviewers; a question answered in an earlier round is never asked again. A fixer or implementer that would
// contradict a decision asks the same way. `accept` of a P1/P2 is the owner's alone: the caller never applies it as a default.
//
// Defaults (W4): the implementer and the fixer report `defaults: [{ choice, alternative, path }]` for non-trivial choices the brief did
// not state; no stall, the result lists them (once each) and the caller shows them in the verdict.
//
// Preview (W5): with `args.preview` (the owner-visible surface, named by the caller) an M or L change stops after the implementer with a
// STALL 'question' at round 0 carrying what to show; the caller takes the screenshot or sample and asks. A bare confirmation ("ok", "va bene", "perfetto", "ok grazie") goes on to the
// review, any other answer runs the implementer once more ('implement (preview)') with it as direction. S and `inline` never stop.
//
// Growth (W8): round 1 and the final read tell the reviewers to run `git diff --numstat <start head>` and to propose a split (a P3 finding with
// `proposal: true`) for a file past 600 lines, or a file of 200+ lines at the start that grew by 30% (a new or small file is no proposal); a proposal never blocks and is never fixed (not a cleanup candidate): it is for the table.
//
// Findings log (W12): the workflow cannot write files (and has no clock), so `result().findingsLog` is `{ size, rounds, findings: [{ category,
// priority, path, closed }] }` (cumulative: every finding ever seen) and the caller appends it, with `at`, `run` and `minutes`, as one line of
// <git-dir>/deliver/findings.jsonl when the run ends (OK, or a STALL the owner gives up on), never on a relaunch: one line per run.
//
// Rounds: there is no cap on them. The loop ends in exactly two ways: no P1/P2 inside the perimeter is open
// (OK), or a finding stalls (STALL): still open after a fix, closed earlier and open again (a closed finding
// re-reported under a new id, a shifted line or a reworded title counts), or the fixes do not converge (below). A reviewer that gives no verdict for
// an id is not a stall at first: only that id is asked again the next round, and only by the reviewers that
// skipped it (recheckReviewers); two rounds in a row without a verdict on it is the same finding unresolved, a
// STALL ('no-verdict'). `decideRound` makes the call in plain code, never a model. A subagent never
// asks the user: a stall returns to the caller (the deliver skill), which asks and relaunches with
// `resumeFromRunId` and `args.resolutions`.
//
// Convergence and churn: a fix round that closes none of the findings it was sent needs no stall of its own: each sent id that gets a
// verdict and is still open is already a STALL ('still-open'; after a rejection 'not-reproduced', or 'disputed' once rejected twice; a
// rejection the reviewers keep once goes back to the fixer with their note), and one with no verdict follows the no-verdict rule. A fix round
// that closes some and opens others is progress as long as the open count falls: the rounds have no cap, but a loop where every fix closes one
// P1/P2 and the reviewers open another never ends by itself. So the count of open P1/P2 (plus the open V finding) is read at the decision after each fix
// round: STALL 'not-converging' when it did not drop below the lowest count of the fix rounds before it for 3 fix rounds in a row
// (notConverging; the first fix round only sets the bar; a decision with a finding still without a verdict is not read, the
// cleanup pass is no fix round). A resolution `guidance` or `accept` on a round restarts that count; `retry` does not; it also restarts when a DONE starts the final full read, the cleanup pass or a coverage rerun (its 0 is no bar).
// Every STALL carries `history` (findingHistory): per finding the round it appeared, the fixes it went to, when it closed and
// when it came back. A fixer whose snapshot churn (lines inserted + deleted) grows strictly over three fixes in a row is a STALL
// 'churn' (churnGrowing; a report without a snapshot has no churn and is skipped; the cleanup pass is no fix cycle and has none). The churn
// is judged at a round's decision, after the reviewers have read the last fix: STALL 'churn' only when the churns are growing AND that
// decision is still FIX (churn comes first when both stalls apply). A resolution on a churn or not-converging round works like on any other: `accept` ends the open ids (the fix was
// read, so OK is honest), guidance / retry send them to the fixer. A `continue` from an older caller is ignored.
//
// P3 cleanup: a round that would end OK (no gap, nothing unread) with P3 findings inside the perimeter (cleanupCandidates: priority P3, not a `scope`
// hunk, not one the change does not cause in a file it did not touch) first runs ONE fix pass on them (label `cleanup R<n>`), then one
// review of that delta. Its new P1/P2 go through the normal loop; its P3s are only reported (`minor`), a second cleanup never runs. The
// findings it fixed (not rejected) move from `minor` to `cleaned` only once that delta review has read them: a delta finding that matches one
// leaves it in `minor`. They are never tracked, so they stay out of `history` and `toFix`.
//
// Questions: the implementer, the fixer and (see "The owner's words") the reviewers may return `questions: [{ text, default, why }]`, a behaviour choice the owner would see (a
// contract, a default, an error policy; never an internal one). Any question is a STALL 'question' before the review (a reviewers' one: before the fix), carrying them (`stall.questions`,
// at round 0 for the implementer, else at the round the fix or the review belongs to). The caller asks the user (or, when the user said not to be asked,
// applies each default and lists it as an open decision) and relaunches with `{ round, answers: [{ text, answer }] }` in the entry of that round;
// the answers reach the implementer as guidance in a second run of it (its first run's edits are already in the tree; its `noticed`, `openQuestions`
// and `rejected` are kept, see askWithQuestions). Questions that run
// asks again are not stalled twice: they go to `outOfScope` as open decisions (source 'implementer').
//
// Coverage: an answering reviewer clears only the files it lists in `filesReviewed` (a group reviewer its own group's, a general
// reviewer any listed one, a specialist none). A round that would end in OK with files nobody read reruns, once, only the owners
// of those files, which review them in full (coverageAction); read nothing the second time: STALL 'gap' with `stall.files`. A
// specialist (security, performance) that returned nothing is a STALL 'gap' naming it. Round 1 owes every changed file, later
// rounds the files of the last fix plus what was still unread.
//
// Start point: deliver records HEAD and the files already dirty before the change (`args.start`; a
// `git status --porcelain` line is tolerated, a trailing "/" entry is a directory). The reviewer derives the
// files the change touched from git (`git diff <head> --name-only` plus untracked, minus the dirty ones): the
// implementer's declared list is a hint only. Files dirty at the start are the user's and are never
// reverted (an edit of the change there, outside the perimeter, is reported, not reverted), and a perimeter
// file already dirty is refused unless `dirtyConfirmed`. `inline: true` skips the implementer: the session
// edited `changed` itself and only the review loop runs (fixes still go to the implementer).
//
// Resume: relaunch with the same script and args plus ALL the resolutions so far,
// `resolutions: [{ round, accept?, guidance?, retry?, answers?, widen? }]` (round = the one each STALL reported). The agent
// calls before the decision are cached; the first changed call runs live. `answers` ([{ text, answer }]) answer a 'question' stall. `accept` lists finding ids the
// user takes as a residual risk; `guidance` or `retry: true` sends the stalled findings to the fixer once
// more (guidance puts the user's direction in the brief). `widen` lists perimeter entries the user adds after a
// 'widen' STALL, from that round on (widenedFiles: the reviewers of that round and the earlier prompts keep the old perimeter,
// so the replay is byte-identical). If the resume replays a cached null implementer
// result (a STALL on "the implementer returned nothing"), relaunch WITHOUT resumeFromRunId.
//
// After an OK the caller (deliver) runs `hooks/scope-guard.js --check <start.head>` as the mechanical scope check; the loop
// itself never runs it. Reviewers by size: see reviewersFor (the size is re-derived upward every round from the files changed).
//
// Who reviews which round (W6, W7): round 1 the full panel of the size. A delta round (a round after a fix) only the reviewers that
// raised the findings still open (raisedBy, a specialist that returned nothing too) plus ONE Sonnet at medium effort (WATCHER, key 'S', a
// whole-change reviewer: it also reads the files nobody has read, at most MAX_REVIEW_FILES of them in full, the rest is left to the coverage
// rerun; at S the one reviewer is that Sonnet already). A finder is asked under finderKey: the reviewer it was, whatever key the size gives it now. The first round that would
// end OK after a review fix ran (not a cleanup pass; never at S) is not the end: once, the full panel (on M the one Opus) reads the
// cumulative fix diff since round 1, labelled '(final)', with the request and the growth check; its new P1/P2 go through the normal loop,
// whose later delta rounds are not followed by a second full read. Then comes the cleanup pass, and its delta is read by the Sonnet alone
// (no finders: the cleanup findings are untracked). A review fix born from that delta (a P1/P2 it found) still schedules the final full read, once per run, after the cleanup. A RECHECK or a coverage rerun names its own reviewers, the Sonnet among them.
//
// Classification (classify): clean-code and convention never block. A P1/P2 outside the perimeter in a file the change touched
// (the snapshot's `files`), or that the reviewer says the change causes (`causedByChange`), is a 'widen': a STALL the fixer never
// sees. Any hunk the brief does not require, inside a perimeter file too, is category 'scope': the fixer reverts it and it is
// listed in `outOfScope` as { source: 'scope-revert', title, path, why }, next to the `noticed` items of the implementer and the
// fixer ({ source: 'noticed', ... }). Except when the same round has a blocking scope finding on that file: the P1/P2 is tracked as a normal
// blocking finding and goes to the fixer with the revert; the next round's reviewers judge it (closed by the revert, or still open).
//
// Rejections: a fixer that judges a finding wrong, or cannot reproduce a PLAUSIBLE one, lists it under `rejected` ({ id, reason, kind:
// 'not-reproduced' | 'wrong' }) and changes no code (rejectionLedger). A scope-revert proposal is recorded only after the fixer's
// report, for the scope findings it was given and did not reject. The next round's reviewers get it as a CHALLENGE: closed withdraws it, open keeps it with a note. Kept
// and never reproduced: STALL 'not-reproduced'; kept after two rejections: STALL 'disputed'; kept once: back to the fixer
// with the reviewer's note.
//
// Budget: every reviewer and fixer prompt carries a tool-call cap below the agent's own turn cap and asks for the structured result
// before it runs out (the implementer's does not: its run is task-sized). The implementer runs only the test files it touches while it
// works and the verify command once, at the end. An agent() that throws anyway (turn cap, no StructuredOutput) is caught
// and read as an empty result, so the gap / no-verdict logic handles it and the run goes on.
//
// Snapshots: every implementer and fixer prompt ends with `scripts/snapshot.ps1 -Since <previous tree | start head>
// -Start <start head> -Dirty <start.dirty>`, which prints { tree, files, churn } from a throwaway git index (the
// user's index and tree are never touched). The `files` of the report are the changed files (a report without a
// snapshot falls back to its declared files); from round 2 the reviewers get the delta as `git diff <prev tree> <tree>`
// (deltaCommand). With `inline: true` the first fixer measures from the start head.
//
// Verify gate (verifyGate): the report's `verify` { status, command, line } decides. A failing verify is a synthetic P1
// finding `V<n>` (category 'verify', always blocking, never asked to a reviewer) that heads the fixer's list and keeps
// the loop from ending until a verify passes. STALL reasons: 'verify-failed' (the fixer could not make it pass),
// 'green-to-red' (a pass, then a fail), 'verify-not-run' (args.verify is set and the run did not do it, or it left a V
// open). The reviewers are told the verify result; `result()` carries `verify`, `evidence` and `notVerified`.
//
// The pure functions sit between the markers below. tools/impl-review-loop.test.mjs extracts that block
// and runs it: keep it free of agent(), log() and phase().

// --- pure:begin
// Git Bash writes a drive as "/c/...", a reviewer or the harness as "C:\...": both become "c:/...".
const norm = p => String(p ?? '').replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase().replace(/^\/([a-z])\//, '$1:/')

// A path as repo-relative as it can be made: the repo root is stripped from an absolute one.
const rel = (p, root) => {
  const x = norm(p)
  const r = norm(root).replace(/\/+$/, '')
  return r && x.startsWith(`${r}/`) ? x.slice(r.length + 1) : x
}
const isAbsolute = p => /^([a-z]:)?\//.test(p)

// A perimeter entry: a file, a directory (ends with "/") or a glob ("*" inside a segment, "**" across them).
// The SAME rule as hooks/scope-guard.js (a test holds them together): anchored at the repo root, case-insensitive.
const entryRegex = entry => {
  const e = norm(entry.trim())
  const body = e.endsWith('/') ? `${e}**` : e
  const src = body.replace(/[.+^${}()|[\]]/g, '\\$&')
    .replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*').replace(/\?/g, '[^/]')
  return new RegExp(`^${src}$`)
}
const inPerimeter = (path, files, root) => {
  const p = rel(path, root)
  return !!p && !isAbsolute(p) && (files ?? []).some(f => entryRegex(f).test(p))
}
// A dirty entry ending with "/" is a collapsed untracked directory: it protects every file under it.
const isDirty = (path, dirty, root) => {
  const p = rel(path, root)
  return !!p && (dirty ?? []).some(d => { const x = rel(d, root); return x.endsWith('/') ? p.startsWith(x) : x === p })
}

// start.dirty as the caller recorded it, tolerant of `git status --porcelain` lines: the "XY " prefix, the
// quotes, a rename "old -> new" (both ends are dirty). Plain paths pass through.
const parseDirty = entry => String(entry ?? '').replace(/^[ MADRCUT?!]{2} /, '').trim()
  .split(' -> ').map(x => x.trim().replace(/^"(.*)"$/, '$1')).filter(Boolean)

// The same finding seen again, possibly on a shifted line, re-categorised or under a reworded title: same file
// (a `scope` finding only matches another `scope` one) and a similar title (Jaccard >= 0.5 on the words left once IT/EN stopwords and words under 3 letters are
// dropped). A reworded title must also sit within LINE_WINDOW lines, an identical one within 3x that (two
// distinct defects of one file can share a title); a finding without a line has no distance to check.
const LINE_WINDOW = 10
const STOPWORDS = new Set(['non', 'per', 'con', 'del', 'della', 'dei', 'delle', 'nel', 'nella', 'che', 'una', 'uno', 'gli', 'dal', 'alla', 'sul',
  'manca', 'mancano', 'senza', 'the', 'not', 'and', 'for', 'with', 'without', 'missing', 'does', 'from', 'when', 'that', 'this', 'are', 'but'])
const words = t => new Set(String(t ?? '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w => w.length >= 3 && !STOPWORDS.has(w)))
const plain = t => String(t ?? '').trim().toLowerCase()
const sameTitle = (a, b) => {
  const x = words(a), y = words(b)
  if (!x.size || !y.size) return plain(a) === plain(b)
  const shared = [...x].filter(w => y.has(w)).length
  return shared / (x.size + y.size - shared) >= 0.5
}
const sameFinding = (a, b, root) => {
  if (rel(a.path, root) !== rel(b.path, root)) return false
  if ((a.category === 'scope') !== (b.category === 'scope')) return false   // a revert request never folds into another finding
  const gap = Number.isFinite(a.line) && Number.isFinite(b.line) ? Math.abs(a.line - b.line) : 0
  return gap <= (plain(a.title) === plain(b.title) ? 3 * LINE_WINDOW : LINE_WINDOW) && sameTitle(a.title, b.title)
}
const RANK = { P1: 1, P2: 2, P3: 3 }
const rank = f => RANK[f?.priority] ?? 3

const BLOCKING = new Set(['P1', 'P2'])

// Reviewer A reads at most MAX_REVIEW_FILES files: past that it fans out into one reviewer per group, in order,
// so a group keeps its files while later fixes only append. A list within the limit stays one group.
const MAX_REVIEW_FILES = 8
const groupFiles = (list, max = MAX_REVIEW_FILES) => {
  const groups = []
  for (let i = 0; i < list.length; i += max) groups.push(list.slice(i, i + max))
  return groups.length ? groups : [[]]
}
// The group that owns a path (a finding's anchor): the one listing it, else the last (it also owns the stray files).
const groupOf = (path, groups, root) => {
  const p = rel(path, root)
  const i = groups.findIndex(g => g.some(x => rel(x, root) === p))
  return i < 0 ? groups.length - 1 : i
}

// Reviewers by size: S one Sonnet at medium, M one Opus at high, L Sonnet and Opus at high; at M and L also the
// specialists for what the change touches. Only a reviewer flagged `whole` reads the whole change.
const reviewersFor = (size, touches = []) => {
  const code = (key, model, effort) => ({ key, agentType: 'code-reviewer', model, effort, whole: true })
  const list = size === 'S' ? [code('A', 'sonnet', 'medium')]
    : size === 'M' ? [code('A', 'opus', 'high')]
    : [code('A', 'sonnet', 'high'), code('B', 'opus', 'high')]
  if (size !== 'S' && touches.includes('security')) list.push({ key: 'security', agentType: 'review-security', model: 'sonnet', effort: 'high' })
  if (size !== 'S' && touches.includes('performance')) list.push({ key: 'performance', agentType: 'review-performance', model: 'sonnet', effort: 'high' })
  return list
}

// The size the change has now, from the files it is known to touch: one file keeps the given size, 2-4 are at
// least M, 5 or more are L. Only upward: a change that shrinks again is not reviewed lighter.
const SIZES = ['S', 'M', 'L']
const sizeFor = (given, changedCount) => {
  const floor = changedCount >= 5 ? 'L' : changedCount >= 2 ? 'M' : 'S'
  return SIZES[Math.max(SIZES.indexOf(given), SIZES.indexOf(floor))]
}

// An agent report as the loop reads it, the fields a report may lack filled with their default: no verify is
// not-run, no snapshot is null, no rejected / noticed / questions / filesReviewed is empty. null (an agent that returned
// nothing) stays null. A snapshot counts only when it carries a tree (a non-empty string): without one it is no
// snapshot, whatever its files say, and the declared files are used. `defaults` keeps the entries that name a choice.
const VERIFY_STATUSES = ['pass', 'fail', 'not-run']
const readReport = r => {
  if (!r || typeof r !== 'object') return null
  const list = v => (Array.isArray(v) ? v : [])
  return {
    ...r,
    verify: VERIFY_STATUSES.includes(r.verify?.status) ? r.verify : { ...r.verify, status: 'not-run' },
    snapshot: r.snapshot && typeof r.snapshot === 'object' && typeof r.snapshot.tree === 'string' && r.snapshot.tree ? r.snapshot : null,
    rejected: list(r.rejected),
    noticed: list(r.noticed),
    questions: list(r.questions).filter(q => q && typeof q.text === 'string' && q.text.trim()),
    defaults: list(r.defaults).filter(d => d && typeof d.choice === 'string' && d.choice.trim()),
    filesReviewed: list(r.filesReviewed),
  }
}

// The command that shows what a fix changed: the diff between two snapshot trees (scripts/snapshot.ps1). Without an
// earlier snapshot it starts at the start head (HEAD when none was recorded); without a tree there is nothing to show.
const deltaCommand = (prevTree, tree, startHead) => (tree ? `git diff ${prevTree || startHead || 'HEAD'} ${tree}` : '')

// What a verify result means for the loop, from an implementer or fixer report (readReport'd).
//   verifyCmd       args.verify: when set, a report that did not run it is a stall
//   toFixHadVerify  this report is a fixer's and its toFix held a V finding
//   previous        the verify status before this run ('pass' | 'fail' | 'not-run' | undefined)
//   next            the number of a new V finding
// Returns { status, finding?, stall? }. A fail is a synthetic P1 `V<n>` (category 'verify': always blocking, never
// asked to a reviewer); a fail the fixer could not turn green, or a green turned red, stalls with `why`
// 'verify-failed' / 'green-to-red'; not-run stalls 'verify-not-run' with a verify command, or when it left a V
// finding unfixed (it could never be closed). The caller closes the
// V findings on a pass.
const verifyGate = ({ report, verifyCmd, toFixHadVerify = false, previous, next = 1 } = {}) => {
  const v = report?.verify ?? {}
  const status = VERIFY_STATUSES.includes(v.status) ? v.status : 'not-run'
  const seen = `\`${v.command ?? verifyCmd ?? '(no command)'}\` → ${status}${v.line ? `: ${v.line}` : ''}`
  if (status === 'pass') return { status }
  if (status === 'not-run') return verifyCmd || toFixHadVerify ? { status, stall: { why: 'verify-not-run', reason: `the verify command was not run: ${seen}` } } : { status }
  if (toFixHadVerify) return { status, stall: { why: 'verify-failed', reason: `the verify still fails after the fix: ${seen}` } }
  if (previous === 'pass') return { status, stall: { why: 'green-to-red', reason: `the verify was green and is red after the fix: ${seen}` } }
  return {
    status,
    finding: {
      id: `V${next}`, path: '(verify)', category: 'verify', priority: 'P1',
      title: 'the verify command fails', failure: seen, fix: 'make the verify command pass without weakening the check',
    },
  }
}

// The files nobody has read yet, carried between rounds. A round owes the files still unread (`pending`) plus `changed`, the files
// its review must read (round 1 every changed file, later the files of the last fix); a file is read only when an answering
// reviewer lists it in `filesReviewed`: a group reviewer clears just the files of its own group, a reviewer flagged `whole` (a
// general reviewer over the whole change) any file it lists, a specialist none (it reads its own area only). A reviewer that
// returned nothing (null) clears nothing, so all its files stay unread. A round with a file still here must not conclude DONE.
//   answers    one entry per reviewer, null when it returned nothing      reviewers   [{ key, group?, whole? }]
//   pending    the files still unread after the previous round            groups, root   see groupOf
const unreviewedFiles = (answers, reviewers, groups, pending = [], root = '', changed = []) => {
  const owed = new Map()
  for (const f of [...pending, ...changed]) if (!owed.has(rel(f, root))) owed.set(rel(f, root), f)
  const read = new Set()
  answers.forEach((a, i) => {
    const r = reviewers[i]
    if (!a || !r || (r.group === undefined && !r.whole)) return
    const listed = new Set((Array.isArray(a.filesReviewed) ? a.filesReviewed : []).map(f => rel(f, root)))
    for (const [key, f] of owed) {
      if (listed.has(key) && (r.group === undefined || groupOf(f, groups, root) === r.group)) read.add(key)
    }
  })
  return [...owed].filter(([key]) => !read.has(key)).map(([, f]) => f)
}

// What to do with the files still unread when a round would conclude: nothing (ok), run their owners once more (rerun), or, when
// that rerun already happened and they are still unread, give up (stall 'gap').
const coverageAction = ({ unread = [], retried = false } = {}) => (!unread.length ? 'ok' : retried ? 'stall' : 'rerun')

// The reviewers to rerun for the unread files: the group reviewer owning each file; without groups every whole reviewer (a
// specialist owns no file). In reviewer order.
const coverageOwners = (unread, reviewers, groups, root = '') => {
  const keys = new Set()
  for (const f of unread) {
    const gi = groupOf(f, groups, root)
    const owners = groups.length > 1 ? reviewers.filter(r => r.group === gi) : reviewers.filter(r => r.whole)
    owners.forEach(r => keys.add(r.key))
  }
  return reviewers.filter(r => keys.has(r.key)).map(r => r.key)
}

// What happened to each finding, from the round log (a round's `new`, `closed`, `toFix` and `rematched` ids): the round it first
// appeared, the rounds it went to the fixer, the round it closed (the last one), the rounds it came back.
const findingHistory = roundLog => {
  const byId = new Map()
  const entryOf = (id, round) => {
    if (!byId.has(id)) byId.set(id, { id, firstRound: round, fixedIn: [], closedIn: null, rematchedIn: [] })
    return byId.get(id)
  }
  for (const r of Array.isArray(roundLog) ? roundLog : []) {
    for (const id of r.new ?? []) entryOf(id, r.round)
    for (const id of r.toFix ?? []) entryOf(id, r.round).fixedIn.push(r.round)
    for (const id of r.closed ?? []) entryOf(id, r.round).closedIn = r.round
    for (const id of r.rematched ?? []) entryOf(id, r.round).rematchedIn.push(r.round)
  }
  return [...byId.values()]
}

// The fixers' churn (lines inserted + deleted per fix): a fix that changes more each time is not converging. True when the last 3
// known churns strictly increase; a fix without a snapshot has no churn (null) and is skipped.
const churnGrowing = churns => {
  const last = (Array.isArray(churns) ? churns : []).filter(Number.isFinite).slice(-3)
  return last.length === 3 && last[0] < last[1] && last[1] < last[2]
}

// The count of open P1/P2 (plus the open V finding) after each fix round, oldest first: a fix round that did not drop below the lowest count of the
// fix rounds before it made no progress (the first one has none before it and only sets the bar). stuckFixRounds is the length of the
// run of such rounds that ends the list; notConverging is true from NOT_CONVERGING_ROUNDS of them in a row.
const NOT_CONVERGING_ROUNDS = 3
const stuckFixRounds = counts => {
  let low = Infinity
  let stuck = 0
  for (const c of (Array.isArray(counts) ? counts : []).filter(Number.isFinite)) {
    stuck = c < low ? 0 : stuck + 1
    low = Math.min(low, c)
  }
  return stuck
}
const notConverging = counts => stuckFixRounds(counts) >= NOT_CONVERGING_ROUNDS

// Style findings never block, whatever their priority: a reviewer's taste is not a defect. A split proposal (`proposal: true`, the growth
// check of the reviewers: only a P3 clean-code finding can be one, on any other the flag is ignored) is a note for the closing table: it never blocks and is never fixed.
const NEVER_BLOCKING = new Set(['clean-code', 'convention'])
const isNeverBlocking = f => NEVER_BLOCKING.has(f?.category) || (f?.proposal === true && f.category === 'clean-code' && f.priority === 'P3')

const isTouched = (path, touched, root) => {
  const p = rel(path, root)
  return !!p && (touched ?? []).some(t => rel(t, root) === p)
}

// The perimeter entries the user added when a stall asked to widen it: every resolution `{ round, widen: [entries] }`
// counts from its round on (a round below it keeps the perimeter it was asked with, so a resume replays identical prompts).
const widenedFiles = (files, resolutions, round) => {
  const list = [...(files ?? [])]
  for (const r of Array.isArray(resolutions) ? resolutions : []) {
    if (!(Number(r?.round) <= round) || !Array.isArray(r.widen)) continue
    for (const x of r.widen) if (typeof x === 'string' && x.trim() && !list.includes(x)) list.push(x)
  }
  return list
}

// The minor findings the cleanup pass (one FIX before DONE) may fix: P3 only (a style finding of a higher priority is minor too, and stays so),
// inside the perimeter, never a `scope` hunk (that is a revert, not a cleanup) and never one the reviewer says the change does not cause in a
// file the change did not touch, nor a split proposal.
const cleanupCandidates = (minor, files, { root = '', touched = [] } = {}) =>
  (Array.isArray(minor) ? minor : []).filter(m => m.priority === 'P3' && m.category !== 'scope' && m.proposal !== true && inPerimeter(m.path, files, root) && !(m.causedByChange === false && !isTouched(m.path, touched, root)))

// The answers a resolution carries for a 'question' stall: [{ text, answer }], entries without both texts dropped.
const readAnswers = resolution => (Array.isArray(resolution?.answers) ? resolution.answers : [])
  .filter(a => a && typeof a.text === 'string' && a.text.trim() && typeof a.answer === 'string' && a.answer.trim())
  .map(a => ({ text: a.text.trim(), answer: a.answer.trim() }))

// The questions the reviewers of a round left for the owner (a brief that departs from the request, an edit that contradicts an owner
// decision, a hunk the owner asked for): one per text, in reviewer order. `answers` are in the resolution of that round; a question the
// owner answered in an EARLIER round is settled and never asked again, one answered in this round is `answered`, the rest is `pending`.
const reviewerQuestions = reviews => {
  const seen = new Set()
  const out = []
  for (const r of Array.isArray(reviews) ? reviews : []) {
    for (const q of r?.questions ?? []) {
      if (!q || typeof q.text !== 'string' || seen.has(plain(q.text))) continue
      seen.add(plain(q.text))
      out.push({ ...q, text: q.text.trim() })
    }
  }
  return out
}
const routeQuestions = ({ questions = [], resolutions = [], round = 0 } = {}) => {
  const entries = (Array.isArray(resolutions) ? resolutions : []).filter(r => Number(r?.round) <= round)
  const now = readAnswers(entries.find(r => Number(r.round) === round))
  const pending = []
  const answered = []
  for (const q of questions) {
    const hit = now.find(a => plain(a.text) === plain(q.text))
    if (hit) answered.push(hit)
    else if (!entries.some(r => Number(r.round) < round && readAnswers(r).some(a => plain(a.text) === plain(q.text)))) pending.push(q)
  }
  return { pending, answered }
}

// The reviewers of a delta round: the ones that raised the findings still open (`finders`, their keys) plus one Sonnet at medium effort. When
// the panel already holds a whole-change Sonnet at medium (size S: the one reviewer) that is the Sonnet; else WATCHER is added. A finder key
// the panel no longer has (reviewer A before it split into one per group) stands for every reviewer of that letter.
const WATCHER = { key: 'S', agentType: 'code-reviewer', model: 'sonnet', effort: 'medium', whole: true }
const deltaReviewers = (everyone, finders = []) => {
  const has = new Set(everyone.map(r => r.key))
  const wanted = new Set(finders.flatMap(k => (has.has(k) ? [k] : everyone.filter(r => r.key[0] === k[0]).map(r => r.key))))
  const sonnet = everyone.find(r => r.whole && r.model === 'sonnet' && r.effort === 'medium')
  const list = everyone.filter(r => wanted.has(r.key) || r === sonnet)
  return sonnet ? list : [...list, WATCHER]
}
// The keys of the reviewers whose report holds this finding (the same one, see sameFinding): who raised it.
const findersOf = (finding, reviews, root) => (Array.isArray(reviews) ? reviews : []).filter(r => (r?.found ?? []).some(g => sameFinding(g, finding, root))).map(r => r.key)
// The key a finder is asked under in a later round. `raised` is { key, agentType, model, effort } as the reviewer was when it raised the finding:
// the size can change the panel under a key ('A' is the Opus at M and the Sonnet at L), so the key stands only while it names the same reviewer;
// else the reviewer that is now the same one (model, agent, effort), else the key as it was.
const finderKey = (raised, everyone) => {
  const same = r => r.agentType === raised.agentType && r.model === raised.model && r.effort === raised.effort
  if (!raised.model || everyone.some(r => r.key[0] === raised.key[0] && same(r))) return raised.key
  return everyone.find(same)?.key ?? raised.key
}

// The line the caller appends to <git-dir>/deliver/findings.jsonl (the workflow cannot write files): one entry per finding ever listed but
// the verify one; `closed` is a finding the reviewers closed or the cleanup pass fixed.
const findingsLog = ({ known = {}, tracked = {}, cleaned = [] } = {}) => Object.values(known)
  .filter(k => k.category !== 'verify')
  .map(k => ({ category: k.category, priority: k.priority, path: k.path, closed: tracked[k.id]?.status === 'closed' || cleaned.some(c => c.id === k.id) }))

// A finding is blocking when it is P1/P2 and inside the perimeter (a `verify` one always is). A `scope` finding is a diff hunk
// the brief does not require (outside the perimeter, or inside it): it is ours to revert, so it blocks (P2 at least) - unless the file
// was already dirty before the start: that is the user's work, reported and never reverted. A style finding (clean-code, convention)
// never blocks. A P1/P2 outside the perimeter is a 'widen' when the change touched that file (`touched`, from the snapshot) or
// the reviewer says the change causes it: only the user can widen the perimeter, so it stalls. Any other finding
// outside the perimeter is "trovato altro"; P3 inside is minor. Neither blocks, neither is fixed here.
const classify = (f, files, { dirty = [], root = '', touched = [] } = {}) => {
  if (f.category === 'verify') return 'blocking'   // the synthetic finding of a failing verify command
  const inside = inPerimeter(f.path, files, root)
  if (isNeverBlocking(f)) return inside ? 'minor' : 'outOfScope'
  const scope = f.category === 'scope' && !isDirty(f.path, dirty, root)
  const priority = scope && !BLOCKING.has(f.priority) ? 'P2' : f.priority
  if (BLOCKING.has(priority) && (scope || inside)) return 'blocking'
  if (BLOCKING.has(priority) && f.category !== 'scope' && (f.causedByChange === true || isTouched(f.path, touched, root))) return 'widen'
  return inside ? 'minor' : 'outOfScope'
}

// Several reviewers, one verdict per previous finding: open if ANY reviewer says open. An id no reviewer
// answered has no verdict at all (it is asked again, not guessed). New findings are the union, de-duplicated
// with `sameFinding`; of two reports of the same defect the most severe is kept, different titles stay apart.
// `notes` holds, per id, what the reviewers said when they kept it open (a kept challenge goes back to the fixer with it);
// `answeredBy`, per id, the reviewers that gave it a verdict (their `key`, else their position), for recheckReviewers.
const mergeReviews = (reviews, root) => {
  const verdicts = {}
  const notes = {}
  const answeredBy = {}
  const found = []
  for (const [n, r] of reviews.entries()) {
    for (const v of r.previous ?? []) {
      const who = r.key ?? n
      if (!(answeredBy[v.id] ??= []).includes(who)) answeredBy[v.id].push(who)
      if (verdicts[v.id] !== 'open') verdicts[v.id] = v.status === 'closed' ? 'closed' : 'open'
      if (v.status !== 'closed' && v.note) notes[v.id] = notes[v.id] ? `${notes[v.id]}; ${v.note}` : v.note
    }
    for (const f of r.found ?? []) {
      const i = found.findIndex(g => sameFinding(f, g, root))
      if (i < 0) found.push(f)
      else if (rank(f) < rank(found[i])) found[i] = f
    }
  }
  return { verdicts, found, notes, answeredBy }
}

// The reviewers to ask again after a RECHECK: only the ones that were asked an id nobody gave a verdict for. The ones that answered
// it are not asked again, nor those never asked it (a group reviewer of another group).
//   answers   one entry per reviewer, null when it returned nothing   reviewers   [{ key }]
//   asked     { key: [ids] } the unanswered ids each reviewer was asked   answeredBy   see mergeReviews
// A reviewer that returned nothing is a gap (coverage), not a skip: it is rerun only for an id no reviewer that answered was asked, so
// the ones that skipped and the null ones that were the only ones asked an id are rerun together (in reviewer order).
const recheckReviewers = ({ answers = [], reviewers = [], asked = {}, answeredBy = {} } = {}) => {
  const open = key => (asked[key] ?? []).filter(id => !answeredBy[id]?.length)
  const answeredAsked = id => reviewers.some((r, j) => answers[j] && (asked[r.key] ?? []).includes(id))
  return reviewers.filter((r, i) => (answers[i] ? open(r.key).length > 0 : open(r.key).some(id => !answeredAsked(id)))).map(r => r.key)
}

// The previous findings a round asks its reviewers about: the open ones, the closed ones only on a file the last fix touched (a
// closed finding elsewhere cannot have come back through that fix, and a reviewer that finds it again reports it as a new one
// that dedupeFound matches), never an accepted one. After a RECHECK only the `skipped` ids.
//   tracked { id: { status } }   known { id: finding }   lastFixFiles  the files the last fix changed
const idsToAsk = ({ tracked = {}, known = {}, lastFixFiles = [], skipped = [], root = '' } = {}) => {
  const live = id => tracked[id] && tracked[id].status !== 'accepted'
  if (skipped.length) return skipped.filter(live)
  return Object.keys(tracked).filter(id => live(id) && (tracked[id].status !== 'closed' || isTouched(known[id]?.path, lastFixFiles, root)))
}

// The findings a fixer rejected (judged wrong, or not reproduced) and left unchanged. A rejected id is not counted as fixed: the
// next round's reviewers get it as a CHALLENGE (closed = they withdraw it, open = they keep it and say why).
//   rejected  [{ id, reason, kind? }] from one fixer report       counts  { id: n } rejections so far (never mutated)
// Returns { counts, challenge: [{ id, reason, count }], notReproduced: [ids rejected as not reproduced] }. `kind` ('not-reproduced' |
// 'wrong') says which; a rejection without it is read from the reason (the free text of the older reports).
const NOT_REPRODUCED = /^\s*(not reproduced|(cannot|could not|can't|couldn't) reproduce)/i
const isNotReproduced = r => (r.kind === 'not-reproduced' || r.kind === 'wrong' ? r.kind === 'not-reproduced' : NOT_REPRODUCED.test(r.reason ?? ''))
const rejectionLedger = ({ rejected = [], counts = {} } = {}) => {
  const next = { ...counts }
  const challenge = []
  const notReproduced = []
  for (const r of rejected) {
    if (typeof r?.id !== 'string' || !r.id || challenge.some(c => c.id === r.id)) continue
    next[r.id] = (next[r.id] ?? 0) + 1
    challenge.push({ id: r.id, reason: String(r.reason ?? ''), count: next[r.id] })
    if (isNotReproduced(r)) notReproduced.push(r.id)
  }
  return { counts: next, challenge, notReproduced }
}

// A finding listed again under a new id is the known finding (same file, a line within
// LINE_WINDOW, a similar title): when that one is tracked its verdict becomes open (a closed one back is a
// STALL); when it was only recorded as minor / out of scope it is dropped. A new one MORE severe than the
// known one (a P2 on a known P3, a P1 on an accepted P2) is fresh, tracked or not. A different defect on the
// same spot is fresh too.
//   known { id: finding }   every finding ever listed       tracked { id: { status } }
const dedupeFound = ({ found = [], known = {}, tracked = {}, verdicts = {}, root = '' } = {}) => {
  const next = { ...verdicts }
  const fresh = []
  const rematched = []
  for (const f of found) {
    const hits = Object.entries(known).filter(([, k]) => sameFinding(f, k, root) && rank(f) >= rank(k))
    const hit = hits.find(([id]) => tracked[id]) ?? hits[0]
    if (!hit) { fresh.push(f); continue }
    const [id] = hit
    if (tracked[id]) { next[id] = 'open'; rematched.push(id) }
  }
  return { found: fresh, verdicts: next, rematched }
}

// The whole round decision.
//   tracked     { id: { status: 'open' | 'closed' | 'accepted' } }  the blocking findings so far
//   verdicts    { id: 'open' | 'closed' }                            this round's marks on earlier findings
//   found       [{ id, path, category, priority, ... }]              this round's NEW findings (ids assigned)
//   files       the perimeter file list (widened by the user's resolutions, see widenedFiles); dirty, root, touched: see classify
//   resolution  { accept?: [ids], guidance?: string, retry?: true }  what the user decided after a stall
//   silent      { id: n }   rounds in a row each id got no verdict, up to the previous round
//   challenged  [ids] the fixer rejected last round and the reviewers were asked to keep or withdraw
//   rejections  { id: n }   how many times the fixer rejected each id       notReproduced  [ids] rejected as "not reproduced"
// Returns { action: 'DONE' | 'FIX' | 'RECHECK' | 'STALL', tracked, stalled, unanswered, silent, toFix, closed, minor, outOfScope,
//   widen, kept }.
// RECHECK: nothing to fix and nothing stalled, but some open id got no verdict: review again, no fix. An id with
// no verdict in 2 rounds in a row is the same finding unresolved: stalled, why 'no-verdict'.
// A challenged id the reviewers close is withdrawn (closed). One they keep open is: a stall 'not-reproduced' when the fixer could not
// reproduce it, a stall 'disputed' when the fixer rejected it twice or more, else back to the fixer (`kept`, count 1).
// A 'widen' finding (see classify) is a stall 'widen' that guidance never sends to the fixer; accepting it makes it out of scope.
// Except when the same round has a blocking scope finding on the same file: the unrequested hunk is reverted, and the P1/P2 is
// tracked and sent to the fixer with it like any blocking finding (it should disappear with the hunk); the next round's reviewers judge
// it as a previous id: closed if the revert removed it, still open otherwise (a normal 'still-open' stall).
// A new blocking finding the user accepts (`resolution.accept`) is accepted at once: not fixed, which is how a churn
// stall on fresh findings is resolved.
const decideRound = ({ tracked = {}, verdicts = {}, found = [], files = [], dirty = [], root = '', touched = [], resolution, silent = {}, challenged = [], rejections = {}, notReproduced = [] } = {}) => {
  const accept = new Set(resolution?.accept ?? [])
  const guided = !!resolution?.guidance || resolution?.retry === true
  const next = {}
  const stalled = []
  const unanswered = []
  const nextSilent = {}
  const closed = []
  const toFix = []
  const kept = []
  const widen = []
  const asked = new Set(challenged)
  for (const [id, t] of Object.entries(tracked)) {
    next[id] = { ...t }
    if (t.status === 'accepted') continue
    const verdict = verdicts[id]
    if (t.status === 'closed') {
      if (verdict !== 'open') continue
      if (accept.has(id)) { next[id].status = 'accepted'; continue }
      stalled.push({ id, why: 'reappeared' })
    } else if (verdict === 'closed') {
      next[id].status = 'closed'
      closed.push(id)
    } else if (accept.has(id)) {
      next[id].status = 'accepted'
    } else if (verdict === 'open' && asked.has(id)) {
      if (notReproduced.includes(id)) stalled.push({ id, why: 'not-reproduced' })
      else if ((rejections[id] ?? 0) >= 2) stalled.push({ id, why: 'disputed' })
      else kept.push(id)
    } else if (verdict === 'open') {
      stalled.push({ id, why: 'still-open' })
    } else if ((silent[id] ?? 0) + 1 >= 2) {
      stalled.push({ id, why: 'no-verdict' })
    } else {
      unanswered.push(id)
      nextSilent[id] = (silent[id] ?? 0) + 1
    }
  }
  const minor = []
  const outOfScope = []
  const fresh = []
  const kinds = found.map(f => classify(f, files, { dirty, root, touched }))
  // A P1/P2 outside the perimeter on a file that also has an unrequested hunk to revert (a blocking scope finding of this round, not
  // accepted) is tracked like any blocking finding: it goes to the fixer with the revert, and the next round's reviewers judge it.
  const revertFiles = new Set(found.filter((f, i) => kinds[i] === 'blocking' && f.category === 'scope' && !accept.has(f.id)).map(f => rel(f.path, root)))
  for (const [i, f] of found.entries()) {
    const kind = kinds[i] === 'widen' && revertFiles.has(rel(f.path, root)) ? 'blocking' : kinds[i]
    if (kind === 'minor') minor.push(f.id)
    else if (kind === 'outOfScope') outOfScope.push(f.id)
    else if (kind === 'widen') (accept.has(f.id) ? outOfScope : widen).push(f.id)
    else if (accept.has(f.id)) next[f.id] = { status: 'accepted' }
    else {
      fresh.push(f.id)
      next[f.id] = { status: 'open' }
    }
  }
  // After a stall the user may direct another attempt: the stalled findings go back to the fixer.
  if (stalled.length && guided) {
    for (const s of stalled) { next[s.id].status = 'open'; toFix.push(s.id) }
    stalled.length = 0
  }
  stalled.push(...widen.map(id => ({ id, why: 'widen' })))
  const out = { tracked: next, stalled, unanswered, silent: nextSilent, closed, minor, outOfScope, widen, kept }
  if (stalled.length) return { action: 'STALL', toFix: [], ...out }
  toFix.push(...kept, ...fresh)
  return { action: toFix.length ? 'FIX' : unanswered.length ? 'RECHECK' : 'DONE', toFix, ...out }
}
// --- pure:end

const input = typeof args === 'string' ? { brief: args } : (args ?? {})
const brief = typeof input.brief === 'string' ? input.brief.trim() : ''
const perimeter = input.perimeter ?? {}
const strings = v => (Array.isArray(v) ? v.filter(x => typeof x === 'string' && x.trim()) : [])
const files = strings(perimeter.files)
const request = typeof input.request === 'string' ? input.request.trim() : ''       // the owner's own messages, verbatim, beside the brief
const decisions = strings(input.decisions).map(d => d.trim())                       // the owner's decisions that touch the perimeter, one line each
const previewText = typeof input.preview === 'string' ? input.preview.trim() : ''  // the owner-visible surface to show after the implementer (M, L)
const repoRoot = typeof input.repoRoot === 'string' ? input.repoRoot.trim() : ''
const inline = input.inline === true
const startHead = typeof input.start?.head === 'string' ? input.start.head.trim() : ''
const dirty = strings(input.start?.dirty).flatMap(parseDirty)
if (!brief || !files.length) {
  return 'impl-review-loop: args.brief and args.perimeter.files are required, e.g. { brief: "...", perimeter: { files: ["src/Orders/OrdersQuery.cs"], behaviour: "...", exclusions: "..." }, repoRoot: "<git rev-parse --show-toplevel>", start: { head, dirty: [] }, size: "M" }'
}
if (!repoRoot) return 'impl-review-loop: args.repoRoot is required (the output of `git rev-parse --show-toplevel`): perimeter paths are matched from the repo root.'
if (inline && !strings(input.changed).length) return 'impl-review-loop: inline: true needs args.changed, the files the session edited.'
const dirtyInPerimeter = dirty.filter(d => inPerimeter(d, files, repoRoot))
if (dirtyInPerimeter.length && input.dirtyConfirmed !== true) {
  return `impl-review-loop: perimeter file(s) already modified before the start: ${dirtyInPerimeter.join(', ')}. Ask the user, then relaunch with dirtyConfirmed: true (or change the perimeter).`
}
const givenSize = SIZES.includes(input.size) ? input.size : 'M'
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']
const implEffort = EFFORTS.includes(input.implementerEffort) ? input.implementerEffort : 'medium'
const touches = Array.isArray(input.touches) ? input.touches : []
const resolutions = Array.isArray(input.resolutions) ? input.resolutions : []

// The perimeter as a prompt block, for a list of entries: the declared files, or those widened by the user's resolutions.
const perimeterTextFor = (list, forWriter = true) => [
  `PERIMETER (the only files you may change): ${list.join(', ')}`,
  perimeter.behaviour ? `Behaviour in scope: ${perimeter.behaviour}` : '',
  perimeter.exclusions ? `Explicitly out of scope: ${perimeter.exclusions}` : '',
  forWriter ? 'Anything worth doing outside the perimeter is not touched: list it under noticed (title, path, why), one line each; Open questions holds only a guess you had to make and its alternative.' : '',
].filter(Boolean).join('\n')
const perimeterText = perimeterTextFor(files)

// Work the user had in the tree before the change started: never the change's to touch or revert.
const dirtyText = dirty.length
  ? `Already modified before the change started${startHead ? ` (HEAD ${startHead})` : ''}, the user's own work: ${dirty.join(', ')}. Never change or revert those files; an out-of-perimeter edit there is reported, never reverted.`
  : ''

const budgetText = calls => `TOOL BUDGET: at most ${calls} tool calls in total, the structured-output call included. Read selectively, stop exploring after about ${calls - 10} and return the structured result before the budget runs out: a partial result beats none, and a run that ends without it is lost.`
const REVIEW_BUDGET = budgetText(35)
const FIX_BUDGET = budgetText(80)
const TESTS_TEXT = 'Tests: while you work run only the test files your change touches (and the one you saw failing); run the verify command once, at the end, before reporting.'
const QUESTIONS_TEXT = 'Questions: a behaviour choice the owner would see (a contract, a default, an error policy) is not yours to make and not to guess: list it under `questions` as { text, default: what you would do, why }, and do the rest of the scope. An internal choice (naming, structure) is yours, not a question.'
const DEFAULTS_TEXT = 'Defaults: a non-trivial choice the brief did not state (a name or order the owner will see, a limit, a format) goes under `defaults` as { choice, alternative, path }: no question, no stall, the owner reads the list in the verdict. Only the weighty ones (what the owner sees or uses, a contract, data, a cost or risk, an owner decision) are `questions`; the rest of your choices are not reported.'

// The owner's own words: the decisions bind every agent; the request is read by the round-1 reviewers and the final full read beside the brief.
const decisionsText = decisions.length
  ? `Owner decisions (the owner's own words, binding; an edit of yours that would contradict one is not yours to make: list it under \`questions\`):\n${decisions.map(d => `- ${d}`).join('\n')}`
  : ''
const requestText = request
  ? `Owner request (verbatim):\n${request}\nJudge the change against BOTH the intent and the request: a point of the request that the intent drops or contradicts is a question for the owner, not a finding.`
  : ''
const ownerQuestionsText = request || decisions.length
  ? 'A hunk the owner\'s request or decisions asked for is never a "scope" finding. A brief that departs from the request, or an edit that contradicts one of the owner decisions, is no finding for the fixer: list it under `questions` as { text, default: what you would do, why }, never a finding for the fixer.'
  : ''
const REVERT_DECISIONS_TEXT = decisions.length ? 'A hunk an owner decision asked for is not reverted, whatever the finding says: list it under `questions` as { text, default, why }.' : ''
// What the owner answered to the questions of the rounds before `at` (reviewers' and fixers', in the resolutions): binding, never asked again.
const answersText = at => {
  const list = resolutions.filter(r => Number(r?.round) < at).flatMap(readAnswers)
  return list.length ? `Owner answers so far (the owner's own words, binding; do not ask them again):\n${list.map(a => `- ${a.text} -> ${a.answer}`).join('\n')}` : ''
}
// Round 1 and the final full read: a file that grew past 600 lines or by 30% is a split proposal for the closing table, never fixed here.
const GROWTH_TEXT = `Growth check (pass G): for each file the change touched run \`git diff --numstat ${startHead || 'HEAD'}\` and count its lines now; note lines at start -> now (+%). A file past 600 lines, or one that had 200 lines or more at the start and grew by 30%, is a P3 \`clean-code\` finding with \`proposal: true\` (a new file or a small one is no proposal): a split proposal for the closing table, never fixed here.`
// A bare confirmation, courtesy words included ("ok grazie", "perfetto", "ok, va bene così"); anything else ("ok ma...") is a direction.
const CONFIRM = '(?:ok|okay|yes|sì|si|va bene|bene|perfetto|perfect|ottimo|grazie|thanks?|thank you|così|looks good)'
const PREVIEW_OK = new RegExp(`^\\s*${CONFIRM}(?:[\\s,.;!-]+${CONFIRM})*\\s*[.!]*\\s*$`, 'i')

// The agents start in the session's folder, which may be another repo or no repo at all: the repo is named in
// every prompt, or relative paths, the verify command and snapshot.ps1 land in the wrong place.
const RULES = `REPOSITORY: ${repoRoot}. Every path in this prompt is relative to it; read and edit files only under it and run every command (verify, git, snapshot) with it as the working directory, never in your starting folder. You are a subagent: never ask the user anything. A decision you cannot make goes under Open questions. Never commit, push, apply a migration, deploy or write through an MCP server.`
const REPORT_TEXT = 'Return your report through the structured output: scope, files, evidence, verify {status, command, line}, snapshot as printed by the script, rejected, noticed, notVerified, openQuestions.'

// The last step of every implementer and fixer run: scripts/snapshot.ps1 snapshots the working tree (throwaway index,
// nothing of the user's touched). -Since is the tree of the previous snapshot, the start head the first time;
// -Start is the start head (the base of `files`), -Dirty the files the user had modified before the start.
const quote = s => `'${String(s).replace(/'/g, "''")}'`
const snapshotText = since => [
  'Last step, after the verify command and before the structured output: run this exactly with the PowerShell tool (the quoting of -Dirty is PowerShell\'s) and return the one JSON line it prints as `snapshot`, unchanged (the loop reads the files you changed from it):',
  ['pwsh -NoProfile -File ~/.claude/scripts/snapshot.ps1', `-Since ${since || startHead || 'HEAD'}`, startHead ? `-Start ${startHead}` : '', dirty.length ? `-Dirty ${quote(dirty.join(','))}` : ''].filter(Boolean).join(' '),
].join('\n')

const IMPLEMENTATION = {
  type: 'object',
  required: ['scope', 'files', 'evidence', 'verify', 'snapshot', 'rejected', 'noticed'],
  properties: {
    scope: { type: 'string' },
    files: { type: 'array', items: { type: 'string', description: 'absolute or repo-relative path of a file you changed' } },
    evidence: { type: 'string', description: 'the verify command and the output line that settles it, quoted; or why not run' },
    verify: {
      type: 'object',
      required: ['status'],
      properties: {
        status: { type: 'string', enum: ['pass', 'fail', 'not-run'] },
        command: { type: 'string', description: 'the verify command that ran' },
        line: { type: 'string', description: 'the output line that settles it, quoted' },
      },
    },
    snapshot: {
      type: 'object',
      required: ['tree', 'files'],
      properties: {
        tree: { type: 'string' },
        files: { type: 'array', items: { type: 'string' } },
        churn: { type: 'integer' },
      },
    },
    rejected: {
      type: 'array',
      description: 'review findings you judged wrong or could not reproduce, left unchanged',
      items: {
        type: 'object',
        required: ['id', 'reason'],
        properties: {
          id: { type: 'string' },
          reason: { type: 'string' },
          kind: { type: 'string', enum: ['not-reproduced', 'wrong'], description: 'not-reproduced: you could not make the failure happen; wrong: you reproduced or read it and the finding is incorrect' },
        },
      },
    },
    noticed: {
      type: 'array',
      description: 'things outside the request you saw and deliberately did not do (inside or outside the perimeter)',
      items: { type: 'object', required: ['title', 'path', 'why'], properties: { title: { type: 'string' }, path: { type: 'string' }, why: { type: 'string' } } },
    },
    notVerified: { type: 'string' },
    openQuestions: { type: 'array', items: { type: 'string', description: 'a guess you had to make and its alternative, one line (out-of-perimeter proposals go under noticed)' } },
    questions: {
      type: 'array',
      description: 'a behaviour choice the owner would see (never an internal one), left undecided: the run stops before review until it is answered',
      items: {
        type: 'object',
        required: ['text', 'default', 'why'],
        properties: { text: { type: 'string' }, default: { type: 'string', description: 'what you would do if not told otherwise' }, why: { type: 'string' } },
      },
    },
    defaults: {
      type: 'array',
      description: 'non-trivial choices the brief did not state, with the alternative: the owner reads them in the verdict (no stall)',
      items: {
        type: 'object',
        required: ['choice', 'alternative', 'path'],
        properties: { choice: { type: 'string' }, alternative: { type: 'string' }, path: { type: 'string' } },
      },
    },
  },
}

const FINDING_IN = {
  type: 'object',
  required: ['title', 'path', 'category', 'priority', 'failure'],
  properties: {
    title: { type: 'string' },
    path: { type: 'string', description: 'repo-relative path of the anchor' },
    line: { type: 'integer' },
    category: {
      type: 'string',
      enum: ['correctness', 'regression', 'security', 'completeness', 'concurrency', 'performance', 'api-contract', 'convention', 'clean-code', 'scope'],
    },
    priority: { type: 'string', enum: ['P1', 'P2', 'P3'] },
    failure: { type: 'string', description: 'inputs or state, then the wrong outcome' },
    fix: { type: 'string' },
    causedByChange: { type: 'boolean', description: 'true when the change itself causes this defect, even outside the perimeter' },
    confidence: { type: 'string', enum: ['CONFIRMED', 'PLAUSIBLE'] },
    proposal: { type: 'boolean', description: 'true for a split proposal (a file past 600 lines or +30%): a note for the closing table, never fixed' },
  },
}

const REVIEW = {
  type: 'object',
  required: ['previous', 'found', 'checked', 'filesReviewed'],
  properties: {
    previous: {
      type: 'array',
      description: 'one entry for EVERY previous finding id you were given, closed ones included',
      items: {
        type: 'object',
        required: ['id', 'status'],
        properties: { id: { type: 'string' }, status: { type: 'string', enum: ['closed', 'open'] }, note: { type: 'string' } },
      },
    },
    found: { type: 'array', description: 'NEW defects only, never one that matches a previous id', items: FINDING_IN },
    checked: { type: 'string', description: 'passes run and what was read' },
    filesReviewed: { type: 'array', items: { type: 'string' }, description: 'every file you actually read' },
    questions: {
      type: 'array',
      description: 'for the owner, never for the fixer: the brief departs from the request, an edit contradicts an owner decision, or a hunk the owner asked for would be reverted',
      items: {
        type: 'object',
        required: ['text', 'default', 'why'],
        properties: { text: { type: 'string' }, default: { type: 'string', description: 'what you would do if not told otherwise' }, why: { type: 'string' } },
      },
    },
  },
}

const known = {}                      // id -> finding, every finding ever listed
let tracked = {}
let nextId = 1
let round = 0
let lastFix = null                    // the implementer's last fix report: the delta the next review looks at
let lastTree = ''                     // the tree of the last snapshot: the next run's -Since (empty until a report brings one)
let lastReportTree = ''               // the tree of the previous report alone: empty when that report had no snapshot
let lastDelta = ''                    // `git diff <tree before the last fix> <tree after>`, empty when the fix gave no snapshot
let lastDeltaIsFix = false            // the delta starts at the snapshot of the report just before the fix (the fix alone); false: it starts earlier
let lastDeltaBase = ''                // what the delta starts at: the tree before the fix, else the start head
let rejectionCounts = {}              // id -> times the fixer rejected it
let challenged = {}                   // id -> { reason, count, notReproduced }: rejected by the fixer, the reviewers keep or withdraw it
let lastReport = null                 // the last implementer / fixer report: its verify, evidence and notVerified
let verifyOpen = []                   // the V finding of a failing verify, open until a verify passes
let nextV = 1
let unread = []                       // files nobody listed in filesReviewed (their reviewer returned nothing or left them out): reviewed in full
let cleanupDone = false               // the one P3 cleanup pass ran (never a second one)
let fixChurns = []                    // the churn of each fixer snapshot that had one
let openCounts = []                   // the open P1/P2 (+ V) count read at the decision after each fix round (notConverging)
let afterFix = false                  // a fix round ran and its count is not read yet
let cleanupSent = []                  // the minor findings the cleanup fixer did not reject: cleaned once the delta review has read them
let missing = new Set()               // specialists whose last answer was nothing
let nextRound = { only: null, coverage: false, final: false }   // the next round's reviewers: only these keys (a RECHECK or a coverage rerun), null = all; final: the full read
let finalReading = false              // this round is the final full read (the whole panel, on the cumulative fix diff)
let finalReadDone = false             // the final full read was scheduled (once per run)
let round1Tree = ''                   // the tree the round-1 reviewers read: the base of the cumulative fix diff
const fixFiles = new Set()            // the files the review fixes changed (a cleanup pass is no review fix): a final read is owed only when there are some
const raisedBy = {}                   // id -> { key, agentType, model, effort } of the reviewers that raised it: the delta rounds ask those (finderKey), plus the Sonnet
const defaults = []                   // what the implementer and fixers chose without being told: { choice, alternative, path }
let coverageRetried = false           // a coverage rerun was scheduled and the files are still unread
const changed = new Set(inline ? strings(input.changed) : [])
const outOfScope = []
const minor = []
const cleaned = []                    // the minor findings the cleanup pass fixed (it did not reject them)
const gaps = []
const notes = []                      // the implementer's "found elsewhere" lines
const noticed = []                    // what an implementer or fixer saw and deliberately did not do: { source: 'noticed', title, path, why }
const proposals = []                  // a hunk the brief did not ask for, reverted: { source: 'scope-revert', title, path, why }
const rounds = []

const failures = {}                   // label -> why an agent() threw
// An agent() that throws (turn cap, no StructuredOutput) is an empty result, like a stopped one.
const ask = async (prompt, opts) => {
  try { return await agent(prompt, opts) } catch (e) {
    failures[opts.label] = String(e?.message ?? e).slice(0, 200)
    log(`${opts.label}: agent failed: ${failures[opts.label]}`)
    return null
  }
}
const why = label => (failures[label] ? `: ${failures[label]}` : '')

const addFiles = r => (r?.files ?? []).forEach(f => changed.add(f))
// The files the change touched are the last snapshot's list (against the start point, minus the user's dirty files),
// plus the declared files that were already dirty: the snapshot leaves exactly those out, and the implementer's edit of
// the user's file still has to be reviewed. The ones known keep their place (reviewer groups are made in order), the ones
// gone drop, new ones append; a dirty file already in changed stays. No snapshot list (no snapshot, or files not an array): the
// declared files are added and nothing is dropped. A snapshot whose files is an empty array is a real empty change.
const takeFiles = r => {
  if (!Array.isArray(r.snapshot?.files)) return addFiles(r)
  const snap = r.snapshot.files.filter(f => typeof f === 'string' && f)
  const declaredDirty = (r.files ?? []).filter(f => typeof f === 'string' && f && isDirty(f, dirty, repoRoot))
  const listed = [...snap, ...declaredDirty]
  const keep = new Set(listed.map(f => rel(f, repoRoot)))
  for (const f of [...changed]) if (!keep.has(rel(f, repoRoot)) && !isDirty(f, dirty, repoRoot)) changed.delete(f)
  const have = new Set([...changed].map(f => rel(f, repoRoot)))
  listed.forEach(f => { if (!have.has(rel(f, repoRoot))) { changed.add(f); have.add(rel(f, repoRoot)) } })
}
const takeNoticed = r => {
  for (const n of r.noticed) {
    if (n && typeof n === 'object' && !noticed.some(x => x.path === n.path && x.title === n.title)) noticed.push({ source: 'noticed', ...n })
  }
}
const takeDefaults = r => {
  for (const d of r.defaults) if (!defaults.some(x => plain(x.choice) === plain(d.choice) && plain(x.path) === plain(d.path))) defaults.push(d)
}
const takeReport = r => {
  takeDefaults(r)
  takeFiles(r)
  lastReportTree = r.snapshot?.tree ?? ''
  if (lastReportTree) lastTree = lastReportTree
  lastReport = r
  takeNoticed(r)
}
// The verify gate on a report, before it becomes the last one: a failing verify opens the V finding, a pass closes it.
// Returns the stall, if any.
const gateReport = (r, toFixHadVerify) => {
  const g = verifyGate({ report: r, verifyCmd: input.verify, toFixHadVerify, previous: lastReport?.verify.status, next: nextV })
  if (g.finding) { known[g.finding.id] = g.finding; nextV += 1; verifyOpen = [g.finding] }
  else if (g.status === 'pass') verifyOpen = []
  return g.stall
}
const RESOLUTIONS = 'resolutions: [{ round, accept?: [ids], guidance?: "...", retry?: true, answers?: [{ text, answer }], widen?: ["path/or/dir/"] }]'
const RESUME_AGAIN = `Relaunch with the same args and resumeFromRunId, plus every resolution so far: ${RESOLUTIONS}.`
const verifyStall = (at, s) => result({
  status: 'STALL',
  stall: { round: at, why: s.why, findings: verifyOpen.map(v => ({ id: v.id, why: s.why, ...v })), reason: s.reason },
  resume: `Ask the user: a different approach, a direction for the fixer, or no verify command. Relaunch with resumeFromRunId and ALL the resolutions so far, adding { round: ${at}, guidance: "..." } (retry alone replays the cached fixer report and stalls again); a stall at round 0 replays the cached implementer report: relaunch WITHOUT resumeFromRunId.`,
})
// What the implementer or the fixer said about the verify command, for the reviewers.
const verifyText = () => (lastReport
  ? `Verify (run by the implementer): \`${lastReport.verify.command ?? input.verify ?? '(no command reported)'}\` → ${lastReport.verify.status}${lastReport.verify.line ? `: ${lastReport.verify.line}` : ''}`
  : '')

// Every STALL carries the history of the findings so far (what each was and what happened to it).
const withHistory = r => (r.stall ? { ...r, stall: { ...r.stall, history: findingHistory(rounds) } } : r)
// A `noticed` item the implementer also wrote under openQuestions (same text as its title or why) is listed once,
// as the structured item: it keeps the path and the why.
const sameText = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase() && !!String(a ?? '').trim()
const result = extra => withHistory({
  rounds: round,
  open: [...Object.keys(tracked).filter(id => tracked[id].status === 'open').map(id => known[id]), ...verifyOpen],
  accepted: Object.keys(tracked).filter(id => tracked[id].status === 'accepted').map(id => known[id]),
  outOfScope: [...notes.filter(q => !noticed.some(n => sameText(q.text, n.title) || sameText(q.text, n.why))), ...noticed, ...outOfScope, ...proposals],
  minor,
  cleaned,
  gaps,
  files: [...changed],
  verify: lastReport?.verify ?? { status: 'not-run' },
  evidence: lastReport?.evidence ?? '',
  notVerified: lastReport?.notVerified ?? '',
  roundLog: rounds,
  defaults,
  findingsLog: { size: rounds.length ? rounds[rounds.length - 1].size : givenSize, rounds: round, findings: findingsLog({ known, tracked, cleaned }) },
  ...(previewText ? { preview: previewText } : {}),
  ...extra,
})

// A report that holds questions stops the run before review (STALL 'question'), unless the resolution of that round carries the answers:
// then the same call runs once more with them as guidance (`build(extra)` is the prompt; the first call is the one a resume replays from the
// cache). The questioning run is not taken as a report (the tree before it stays the next -Since, so the delta keeps both runs): its `noticed`
// items go to `noticed`, its `openQuestions` to the notes (each only when not already there, see sameText), and its `rejected` ones are merged into the second
// run's report (the second run's own entry wins for an id), each a CHALLENGE only when the second run did not change the file of the finding it rejects.
// Returns { report } (null: it returned nothing) or { stall } (the result to return).
const addNotes = qs => (qs ?? []).forEach(q => { if (!notes.some(n => sameText(n.text, q))) notes.push({ source: 'implementer', text: q }) })
const answersBlock = answers => `The owner answered your questions: apply each answer. Your first run's edits are already in the tree: continue from them, do not start over, and list in \`files\` only the files you change in this run.\n${answers.map(a => `- ${a.text} -> ${a.answer}`).join('\n')}`
const askWithQuestions = async (build, opts, at, resolution) => {
  const first = readReport(await ask(build(''), opts))
  if (!first?.questions.length) return { report: first }
  // Only the answers to THESE questions count: the entry of a round may also hold the answers to a reviewer's question or to the preview.
  const answers = readAnswers(resolution).filter(a => first.questions.some(q => plain(q.text) === plain(a.text)))
  const pending = first.questions.filter(q => !answers.some(a => plain(a.text) === plain(q.text)))
  if (pending.length) {
    return {
      stall: result({
        status: 'STALL',
        stall: { round: at, why: 'question', findings: [], questions: pending, reason: `${opts.label} left ${pending.length} behaviour question(s) for the owner: ${pending.map(q => q.text).join(' | ')}` },
        resume: `Ask the user each question (text, default, why), with your recommendation; when the user said not to be asked, apply every default and list it as an open decision in the closing table. Relaunch with resumeFromRunId and ALL the resolutions so far, adding { round: ${at}, answers: [{ text, answer }] } (in the same entry as that round's other resolution, if any), each text being the question's text unchanged (an answer whose text matches no question is ignored; while a question has no answer this stall comes back, so keep the answers already given in that entry): ${RESOLUTIONS}.`,
      }),
    }
  }
  takeNoticed(first)
  takeDefaults(first)
  addNotes(first.openQuestions)
  const second = readReport(await ask(build(answersBlock(answers)), { ...opts, label: `${opts.label} (answers)` }))
  ;(second?.questions ?? []).forEach(q => notes.push({ source: 'implementer', text: `${q.text} (default: ${q.default ?? 'none given'}${q.why ? `; ${q.why}` : ''})` }))
  if (!second) return { report: second }
  // `stale`: first-run rejections whose file the second run changed. They stay in the report (so the ids count as rejected) but are no CHALLENGE.
  const carried = first.rejected.filter(r => !second.rejected.some(s => s?.id === r?.id))
  const stale = new Set(carried.filter(r => isTouched(known[r?.id]?.path, second.files, repoRoot)).map(r => r?.id))
  // `files` of the merged report covers both runs (the delta does); only `stale` looks at the second run's own files.
  const files = [...new Set([...(Array.isArray(first.files) ? first.files : []), ...(Array.isArray(second.files) ? second.files : [])])]
  return { report: { ...second, files, rejected: [...second.rejected, ...carried] }, stale }
}

if (!inline) {
  phase('Implement')
  const implOpts = { label: 'implement', phase: 'Implement', agentType: 'implementer', effort: implEffort, schema: IMPLEMENTATION }
  const buildImpl = extra => [
    brief,
    extra,
    decisionsText,
    perimeterText,
    dirtyText,
    input.stackSkill ? `Stack skill to load first: ${input.stackSkill}.` : '',
    input.verify ? `Verify with: ${input.verify}` : '',
    TESTS_TEXT,
    QUESTIONS_TEXT,
    DEFAULTS_TEXT,
    RULES,
    REPORT_TEXT,
    snapshotText(lastTree),
  ].filter(Boolean).join('\n\n')
  const resolution0 = resolutions.find(r => Number(r?.round) === 0)
  const asked0 = await askWithQuestions(buildImpl, implOpts, 0, resolution0)
  if (asked0.stall) return asked0.stall
  const impl = asked0.report
  if (!impl) {
    return result({ status: 'STALL', stall: { round: 0, findings: [], reason: `the implementer returned nothing (stopped or failed${why('implement')})` }, resume: RESUME_AGAIN })
  }
  const implStall = gateReport(impl, false)
  takeReport(impl)
  addNotes(impl.openQuestions)
  if (implStall) return verifyStall(0, implStall)

  // Preview (M, L, an owner-visible output named in `args.preview`): the run stops with a `question` stall before the review. The caller
  // shows the surface (screenshot, sample) and asks; "ok" goes on, any other answer is a direction for one more implementer pass.
  if (previewText && sizeFor(givenSize, changed.size) !== 'S') {
    const previewQuestion = {
      text: `Preview: show the owner ${previewText} (a screenshot or a sample of the output) and ask whether it is right; "ok" goes on to the review, any other answer is a direction for one more implementer pass`,
      default: 'ok',
      why: 'the owner sees or uses this output: better to confirm it before the review spends its tokens',
    }
    const said = readAnswers(resolution0).find(a => plain(a.text) === plain(previewQuestion.text))
    if (!said) {
      return result({
        status: 'STALL',
        stall: { round: 0, why: 'question', findings: [], questions: [previewQuestion], reason: `the implementer is done: ${previewText} is to be shown to the owner before the review` },
        resume: `Take the screenshot or sample of ${previewText}, show it to the user with the question (text, default, why) and relaunch with resumeFromRunId and ALL the resolutions so far, adding { round: 0, answers: [{ text, answer }] } (in the same entry as that round's other answers, if any): ${RESOLUTIONS}. a bare confirmation ("ok", "va bene", "perfetto", "ok grazie") goes on to the review; any other answer runs the implementer once more with it as its direction. The verdict carries a final screenshot of the same surface.`,
      })
    }
    if (!PREVIEW_OK.test(said.answer)) {
      const again = readReport(await ask(buildImpl(answersBlock([said])), { ...implOpts, label: 'implement (preview)' }))
      if (!again) {
        return result({ status: 'STALL', stall: { round: 0, findings: [], reason: `the implementer returned nothing on the preview pass (stopped or failed${why('implement (preview)')})` }, resume: RESUME_AGAIN })
      }
      again.questions.forEach(q => notes.push({ source: 'implementer', text: `${q.text} (default: ${q.default ?? 'none given'}${q.why ? `; ${q.why}` : ''})` }))
      const againStall = gateReport(again, false)
      takeReport(again)
      addNotes(again.openQuestions)
      if (againStall) return verifyStall(0, againStall)
    }
  }
}

let skipped = []                      // ids a reviewer gave no verdict for last round: only those are asked next
let silent = {}                       // id -> rounds in a row without a verdict

// The previous findings a reviewer is asked a verdict for: the ids it skipped last round, else every open one and the closed ones in a
// file the last fix touched (an accepted one never). A group reviewer gets the ones anchored in its files, a whole reviewer all.
const everyId = () => idsToAsk({ tracked, known, lastFixFiles: finalReading ? [...fixFiles] : (lastFix?.files ?? []), skipped, root: repoRoot })
const askedIds = (r, groups) => (r.group === undefined ? everyId() : everyId().filter(id => groupOf(known[id].path, groups, repoRoot) === r.group))
const previousBlock = (r, groups) => {
  const mineIds = askedIds(r, groups)
  const ids = mineIds.filter(id => !challenged[id])    // a challenged id is answered in the CHALLENGE block
  if (!everyId().length) {
    return Object.keys(tracked).length
      ? 'PREVIOUS FINDINGS: none to judge (the earlier ones are closed or accepted and the last fix did not touch them: give no verdict).'
      : 'PREVIOUS FINDINGS: none (first round: review the whole change).'
  }
  if (!ids.length) return mineIds.length
    ? 'PREVIOUS FINDINGS: none besides the CHALLENGE below (give a verdict for those ids only).'
    : 'PREVIOUS FINDINGS: none on your files (give no verdict).'
  const list = ids.map(id => `- ${id} [${tracked[id].status}] ${known[id].path}${known[id].line ? `:${known[id].line}` : ''} - ${known[id].title}: ${known[id].failure}`)
  if (skipped.length) {
    const who = mineIds.length > ids.length ? 'for each of these ids and for each id of the CHALLENGE below' : 'for each of these ids only'
    return `PREVIOUS FINDINGS you skipped last round (give a verdict, closed or open, ${who}; an id you skip again stalls the loop):\n${list.join('\n')}`
  }
  return `PREVIOUS FINDINGS (give a verdict, closed or open, for EVERY id listed; a closed one that is back is open; an id you skip is asked again):\n${list.join('\n')}`
}

// The findings the fixer rejected and left unchanged: the reviewers keep them (open, with the reason) or withdraw them (closed).
// A group reviewer gets the ones anchored in its files.
const challengeBlock = (mine = () => true) => {
  const list = Object.keys(challenged).filter(mine).map(id => `- ${id} [${known[id].priority}] ${known[id].path}${known[id].line ? `:${known[id].line}` : ''} - ${known[id].title}: ${known[id].failure} | the fixer's reason: ${challenged[id].reason}`)
  return list.length
    ? `CHALLENGE (the fixer rejected these findings and left the code unchanged: judge each one yourself, reading the code and reproducing the failure when you can; give a verdict for each id in previous: closed = you withdraw it, open = you keep it, and put why in note; a "not reproduced" you can reproduce is kept, with the steps):\n${list.join('\n')}`
    : ''
}

// The files the change touched come from git, not from what the implementer declared: that list is a hint.
const touchedByGit = (declared) => `Find the files the change touched yourself: \`git diff ${startHead || 'HEAD'} --name-only\` plus the untracked files (\`git ls-files -o --exclude-standard\`)${dirty.length ? `, minus the files already modified before the start (${dirty.join(', ')}; an entry ending with "/" is a whole directory), except that a file in both is reviewed for the change's own edit only` : ''}. The list ${inline ? 'the session' : 'the implementer'} declared (${declared || 'none'}) is a hint, never the limit of the review.`

// The reviewers of this round, by the size the change has now (sizeFor), reviewer A as one reviewer per group of at
// most MAX_REVIEW_FILES of the files the change is known to touch.
const reviewersForRound = () => {
  // One entry per file however it was declared (absolute or relative, any case): the first spelling, at its first place.
  const seen = new Map()
  for (const f of changed) { const k = rel(f, repoRoot); if (!seen.has(k)) seen.set(k, f) }
  const groups = groupFiles([...seen.values()])
  const size = sizeFor(givenSize, seen.size)
  const reviewers = reviewersFor(size, touches)
  const [first, ...rest] = reviewers
  const expected = [...seen.values()]
  if (groups.length < 2) return { size, groups, list: reviewers, expected }
  return { size, groups, expected, list: [...groups.map((g, i) => ({ ...first, key: `A${i + 1}`, group: i, whole: false })), ...rest] }
}
const shareText = (r, groups) => (r.group === undefined ? '' : [
  `Your share: review ONLY these files, the other reviewers hold the rest (this overrides the "hint" rule above): ${groups[r.group].join(', ')}.`,
  r.group === groups.length - 1 ? 'You also own any touched file git lists that is not in the declared list.' : '',
].filter(Boolean).join(' '))

// What each review reads: round 1 the files the change touched since the start point, later rounds the delta of the last fix.
// A group reviewer that owns files never read in full (its reviewer returned nothing earlier) reviews them whole; a
// whole-change reviewer does the same for the unread files, at most MAX_REVIEW_FILES of them (the rest stays unread: the coverage rerun
// asks the group reviewers that own it, so no single reviewer is given more than it can read).
const scopeOfReview = (r, groups) => {
  // A specialist whose last answer was nothing never read its area: it reviews the whole change, not the delta of a fix.
  if (missing.has(r.key) && r.group === undefined && !r.whole) return scopeOfChange()
  const full = r.group !== undefined ? groups[r.group].filter(f => unread.includes(f)) : r.whole ? unread.slice(0, MAX_REVIEW_FILES) : []
  return (finalReading ? scopeOfFinal() : scopeOfDelta()) + (full.length ? `\nThese files have never been reviewed: review them IN FULL, as changed since ${startHead ? `commit ${startHead}` : 'the start'}, not just the delta: ${full.join(', ')}.` : '')
}
// A delta that starts before the report that preceded the fix (that report had no snapshot of its own, or the session edited inline) is
// every change since then, the fix among them: it is not "the DELTA of the last fix".
const scopeOfChange = () => `Review the change made${startHead ? ` since commit ${startHead}` : ' since the start'}. ${touchedByGit([...changed].join(', '))}`
// The final full read: the whole panel reads what the review fixes changed since round 1, as one change.
const scopeOfFinal = () => {
  const cmd = deltaCommand(round1Tree || startHead || 'HEAD', lastTree, startHead)
  return `FINAL FULL READ: the fixes of this run are done and the panel reads everything they changed since round 1, as one change, judging each previous finding by reading the code as it is now. Files the fixes changed: ${[...fixFiles].join(', ') || '(none reported)'}.${cmd ? ` ${round1Tree ? `The cumulative fix diff is \`${cmd}\`` : `No tree of round 1 exists (no snapshot before the first fix): \`${cmd}\` is the WHOLE change since the start, not only the fixes`} (the trees are snapshots of the working tree, untracked files included): run it first.` : ''}\n${touchedByGit([...changed].join(', '))}`
}
const scopeOfDelta = () => {
  if (!lastFix) return scopeOfChange()
  const since = `changes since ${lastDeltaBase || startHead || 'HEAD'}`
  const fromHead = lastDelta && !lastDeltaIsFix
  return `Review the ${fromHead ? since : 'DELTA of the last fix'}, judging each previous finding by reading the code as it is now. Files the fix changed: ${(lastFix.files ?? []).join(', ') || '(none reported)'}.${lastDelta ? ` The ${fromHead ? `${since} are` : 'DELTA of the last fix is'} \`${lastDelta}\` (the trees are snapshots of the working tree, untracked files included): run it first.` : ''} What the fix says it did: ${lastFix.scope}\n${touchedByGit([...changed].join(', '))}`
}

while (true) {
  round += 1
  phase('Review')
  const { size, groups, list: everyone, expected } = reviewersForRound()
  const { only, coverage, final } = nextRound
  nextRound = { only: null, coverage: false, final: false }
  finalReading = final
  if (round === 1) round1Tree = lastTree
  // Round 1 and the final read: the whole panel. A delta round: the reviewers that raised the open findings (and a specialist that returned
  // nothing) plus one Sonnet at medium; the delta of a cleanup pass: that Sonnet alone. A RECHECK or a coverage rerun names its own reviewers.
  const finders = [...new Set(Object.keys(tracked).filter(id => tracked[id].status === 'open').flatMap(id => (raisedBy[id] ?? []).map(r => finderKey(r, everyone))))]
  const picked = only ? [...everyone, WATCHER].filter(r => only.includes(r.key))
    : round === 1 || final ? everyone
    : deltaReviewers(everyone, cleanupSent.length ? [...missing] : [...finders, ...missing])
  const reviewers = picked.length ? picked : everyone
  const labelOf = r => `R${round} ${r.key}${final ? ' (final)' : ''}`
  const askedMap = Object.fromEntries(reviewers.map(r => [r.key, askedIds(r, groups)]))
  // The reviewers are asked with the perimeter as it was BEFORE this round's resolution (a resume replays identical prompts).
  const reviewPerimeter = perimeterTextFor(widenedFiles(files, resolutions, round - 1), false)
  const answers = await parallel(reviewers.map(r => () => ask([
    scopeOfReview(r, groups),
    shareText(r, groups),
    `Intent: ${brief}`,
    round === 1 || final ? requestText : '',
    decisionsText,
    answersText(round),
    ownerQuestionsText,
    round === 1 || final ? GROWTH_TEXT : '',
    verifyText(),
    reviewPerimeter,
    dirtyText,
    'Perimeter rule: any hunk the brief does not require, even inside a perimeter file, is a finding with category "scope" (priority P2), and so is every changed line outside the perimeter in the files the change touched; except in a file already modified before the start (reported as a normal finding, never "scope"). A defect in a file the change did not touch is a normal finding; it is reported, not fixed. A P1/P2 defect outside the perimeter that this change causes: set causedByChange to true.',
    `Effort: ${r.effort}. ${size === 'L' && r.key.startsWith('A') ? 'You may be one of two reviewers on different models with this same brief: do not soften for agreement.' : ''}`,
    previousBlock(r, groups),
    challengeBlock(r.group === undefined ? undefined : id => groupOf(known[id].path, groups, repoRoot) === r.group),
    `${RULES} Report only P1/P2/P3 findings with a concrete failure; return the structured output: a verdict for every previous id, the new findings apart, and under filesReviewed list every file you actually read.`,
    REVIEW_BUDGET,
  ].filter(Boolean).join('\n\n'), { label: labelOf(r), phase: 'Review', agentType: r.agentType, model: r.model, effort: r.effort, schema: REVIEW })))
  const alive = answers.map((a, i) => (a ? { ...readReport(a), key: reviewers[i].key } : null)).filter(Boolean)
  answers.forEach((a, i) => { if (!a) gaps.push(`round ${round}: reviewer ${reviewers[i].key} returned nothing${why(labelOf(reviewers[i]))}`) })
  // The files this round's review had to read: round 1 every changed file, later the files of the last fix, a rerun none new.
  const owedNow = round === 1 ? expected : only ? [] : final ? [...fixFiles] : (lastFix?.files ?? [])
  const wasUnread = new Set(unread.map(f => rel(f, repoRoot)))
  unread = unreviewedFiles(answers, reviewers, groups, unread, repoRoot, owedNow)
  unread.filter(f => !wasUnread.has(rel(f, repoRoot))).forEach(f => gaps.push(`round ${round}: ${f} was not read by its reviewer (not in filesReviewed)`))
  if (!unread.length) coverageRetried = false
  answers.forEach((a, i) => {
    const r = reviewers[i]
    if (r.group !== undefined || r.whole) return
    if (a) missing.delete(r.key)
    else missing.add(r.key)
  })
  if (!alive.length && coverage) {
    return result({ status: 'STALL', stall: { round, why: 'gap', files: unread, findings: [], reason: `no reviewer read these files (their reviewer returned nothing again): ${unread.join(', ')}` }, resume: RESUME_AGAIN })
  }
  if (!alive.length) {
    return result({ status: 'STALL', stall: { round, findings: [], reason: 'no reviewer answered: nothing can be concluded' }, resume: RESUME_AGAIN })
  }

  const merged = mergeReviews(alive, repoRoot)
  // A question of the reviewers (the brief departs from the request, an edit contradicts an owner decision, a hunk the owner asked for) is for
  // the owner, never for the fixer: STALL 'question' at this round until it is answered; the answers of this round reach the fixer below.
  const routed = routeQuestions({ questions: reviewerQuestions(alive), resolutions, round })
  if (routed.pending.length) {
    return result({
      status: 'STALL',
      stall: { round, why: 'question', findings: [], questions: routed.pending, reason: `the reviewers left ${routed.pending.length} question(s) for the owner: ${routed.pending.map(q => q.text).join(' | ')}` },
      resume: `Ask the user each question (text, default, why), with your recommendation; when the user said not to be asked, apply every default and list it as an open decision in the closing table. Relaunch with resumeFromRunId and ALL the resolutions so far, adding { round: ${round}, answers: [{ text, answer }] } (in the same entry as that round's other resolution, if any): ${RESOLUTIONS}. The answers go to the fixer and to the later reviewers.`,
    })
  }
  // The delta review of the cleanup pass has read what the cleanup changed: a finding it reports again (never tracked, so it comes back as a
  // new one) is still there and stays in `minor`; the rest is cleaned.
  // An id whose file is still unread waits for the round that reads it.
  const cleanupWait = []
  for (const id of cleanupSent) {
    if (isTouched(known[id].path, unread, repoRoot)) { cleanupWait.push(id); continue }
    if (merged.found.some(g => sameFinding(g, known[id], repoRoot))) continue
    minor.splice(minor.findIndex(m => m.id === id), 1)
    cleaned.push(known[id])
  }
  cleanupSent = cleanupWait
  const deduped = dedupeFound({ found: merged.found, known, tracked, verdicts: merged.verdicts, root: repoRoot })
  const found = deduped.found.map(f => ({ ...f, id: `F${nextId++}` }))
  found.forEach(f => { known[f.id] = f; raisedBy[f.id] = findersOf(f, alive, repoRoot).map(k => { const r = reviewers.find(x => x.key === k); return { key: k, agentType: r?.agentType, model: r?.model, effort: r?.effort } }) })
  const resolution = resolutions.find(r => Number(r.round) === round)
  const roundFiles = widenedFiles(files, resolutions, round)
  const asked = challenged
  const decision = decideRound({
    tracked, verdicts: deduped.verdicts, found, files: roundFiles, dirty, root: repoRoot, touched: [...changed], resolution, silent,
    challenged: Object.keys(asked), rejections: rejectionCounts, notReproduced: Object.keys(asked).filter(id => asked[id].notReproduced),
  })
  tracked = decision.tracked
  silent = decision.silent
  challenged = Object.fromEntries(Object.entries(asked).filter(([id]) => decision.unanswered.includes(id)))   // answered: the challenge is over
  // An open V finding (a failing verify) is always fixed: it turns a DONE or a RECHECK into a FIX, and heads the toFix list.
  const vIds = verifyOpen.map(v => v.id)
  // An answer of the owner to a reviewers' question also turns a DONE or a RECHECK into a FIX: the fixer applies it (nothing else to fix needed).
  const action = (vIds.length || routed.answered.length) && (decision.action === 'DONE' || decision.action === 'RECHECK') ? 'FIX' : decision.action
  const toFix = action === 'FIX' ? [...vIds, ...decision.toFix] : decision.toFix
  skipped = action === 'RECHECK' ? decision.unanswered : []
  decision.minor.forEach(id => minor.push(known[id]))
  decision.outOfScope.forEach(id => outOfScope.push({ source: 'review', ...known[id], ...(resolution?.accept?.includes(id) ? { accepted: true } : {}) }))
  if (decision.unanswered.length) gaps.push(`round ${round}: no verdict for ${decision.unanswered.join(', ')}, asked again`)
  // The churn is read HERE, after the reviewers have read the last fix: the last 3 fix churns strictly grow and the decision is still FIX.
  // Guidance or a retry is the user's "different approach": it goes to the fixer. Accept ends the findings it names, like any round.
  const churnHit = action === 'FIX' && churnGrowing(fixChurns)
  const redirected = !!resolution?.guidance || resolution?.retry === true
  // The open count after the fix, read here too: a guidance or an accept on this round restarts it, a decision with a finding still without a verdict waits.
  const openNow = Object.values(tracked).filter(t => t.status === 'open').length + verifyOpen.length
  if (resolution?.guidance || resolution?.accept?.length) { openCounts = []; afterFix = false }
  if (afterFix && !decision.unanswered.length) { openCounts.push(openNow); afterFix = false }
  const stuckHit = action === 'FIX' && !churnHit && notConverging(openCounts)
  const stopWhy = churnHit ? 'churn' : stuckHit ? 'not-converging' : ''
  const stopped = !!stopWhy && !redirected
  let cleanupIds = []                 // the minor findings the P3 cleanup pass sends to the fixer this round (only on a DONE decision)
  rounds.push({ round, size, reviewers: alive.length, new: found.filter(f => tracked[f.id]).map(f => f.id), rematched: deduped.rematched, closed: decision.closed, toFix: stopped ? [] : toFix, stalled: decision.stalled, unanswered: decision.unanswered, churn: null, ...(final ? { final: true } : {}) })
  log(`Round ${round}: ${found.length} new, ${decision.closed.length} closed, ${toFix.length} to fix, ${decision.stalled.length} stalled, ${decision.unanswered.length} unanswered`)

  if (action === 'DONE') {
    if (missing.size) {
      const keys = [...missing]
      return result({ status: 'STALL', stall: { round, why: 'gap', reviewers: keys, findings: [], reason: `the specialist reviewer(s) ${keys.join(', ')} returned nothing: their area was never reviewed` }, resume: RESUME_AGAIN })
    }
    const cover = coverageAction({ unread, retried: coverageRetried })
    if (cover === 'stall') {
      return result({ status: 'STALL', stall: { round, why: 'gap', files: unread, findings: [], reason: `no reviewer read these files (a second run of their reviewer did not either): ${unread.join(', ')}` }, resume: RESUME_AGAIN })
    }
    if (cover === 'rerun') {
      nextRound = { only: coverageOwners(unread, everyone, groups, repoRoot), coverage: true }
      coverageRetried = true
      openCounts = []
      continue
    }
    // A review fix ran and the panel has not read the whole of it: once, the full panel reads the cumulative fix diff since round 1 (never at S,
    // whose one reviewer reads every round). It comes before the cleanup pass, which has its own delta review.
    if (!finalReadDone && fixFiles.size && size !== 'S') {
      finalReadDone = true
      nextRound = { only: null, coverage: false, final: true }
      openCounts = []                 // the 0 of this DONE is no bar for the fix cycles after the final read
      continue
    }
    // One P3 cleanup pass on the minor findings inside the perimeter, then one review of its delta: the Fix phase below runs it.
    if (!cleanupDone) cleanupIds = cleanupCandidates(minor, roundFiles, { root: repoRoot, touched: [...changed] }).map(m => m.id)
    if (!cleanupIds.length) return result({ status: 'OK' })
    cleanupDone = true
    openCounts = []                   // the 0 of this DONE is no bar for the fix cycles after the cleanup delta
    rounds[rounds.length - 1].cleanup = cleanupIds
  }
  if (stopped) {
    const findings = toFix.map(id => ({ id, why: stopWhy, ...known[id] }))
    return result({
      status: 'STALL',
      stall: {
        round, why: stopWhy, findings,
        reason: stopWhy === 'churn'
          ? `the fixes change more each time (${fixChurns.slice(-3).join(', ')} lines): they are not converging`
          : `the open P1/P2 count after each fix round (${openCounts.join(', ')}) did not drop below its lowest in ${NOT_CONVERGING_ROUNDS} fix rounds in a row: the fixes are not converging`,
      },
      resume: `Ask the user: accept the risk or a different approach. Relaunch with resumeFromRunId and ALL the resolutions so far, adding { round: ${round}, accept: [ids] } to accept the risk (the reviewers of this round have already read the last fix), or { round: ${round}, guidance: "..." } / { round: ${round}, retry: true } for another attempt: ${RESOLUTIONS}.`,
    })
  }
  if (action === 'STALL') {
    return result({
      status: 'STALL',
      stall: {
        round,
        findings: decision.stalled.map(s => ({
          ...s, ...known[s.id], ...(asked[s.id] ? { rejected: asked[s.id].reason, reviewerNote: merged.notes[s.id] } : {}),
        })),
      },
      resume: `Ask the user: accept the risk, one more round, or a different approach; a "widen" finding asks to add its file to the perimeter (only on the user's yes: the session then rewrites perimeter.md with perimeter.ps1 -Files) or to accept it as out of scope. Relaunch with resumeFromRunId and ALL the resolutions so far: ${RESOLUTIONS}.`,
    })
  }
  if (action === 'RECHECK') {
    // Only the reviewers that were asked an id nobody gave a verdict for are asked again.
    const stuck = Object.fromEntries(Object.entries(askedMap).map(([key, ids]) => [key, ids.filter(id => decision.unanswered.includes(id))]))
    nextRound = { only: recheckReviewers({ answers, reviewers, asked: stuck, answeredBy: merged.answeredBy }), coverage: false }
    continue
  }

  phase('Fix')
  const cleaning = cleanupIds.length > 0
  const sending = cleaning ? cleanupIds : toFix
  const unproven = id => !cleaning && known[id].confidence === 'PLAUSIBLE'
  // A P1/P2 outside the perimeter that went to the fixer next to a revert of a hunk of the same file: the revert should remove it.
  const withRevert = id => known[id].category !== 'scope' && !inPerimeter(known[id].path, roundFiles, repoRoot) && sending.some(o => known[o]?.category === 'scope' && rel(known[o].path, repoRoot) === rel(known[id].path, repoRoot))
  const fix = sending.map(id => `- ${id} [${known[id].priority}] ${known[id].path}${known[id].line ? `:${known[id].line}` : ''} - ${known[id].title}: ${known[id].failure}${known[id].fix ? ` (suggested: ${known[id].fix})` : ''}${unproven(id) ? ' (PLAUSIBLE: REPRODUCE FIRST)' : ''}${withRevert(id) ? ' (outside the perimeter: revert the hunk of this file; this defect should disappear with it, do not edit anything else there)' : ''}${decision.kept.includes(id) ? ` (you rejected this finding and the reviewer kept it${merged.notes[id] ? `: ${merged.notes[id]}` : ''}; reproduce it, then fix it)` : ''}`).join('\n')
  const fixOpts = { label: `${cleaning ? 'cleanup' : 'fix'} R${round}`, phase: 'Fix', agentType: 'implementer', effort: implEffort, schema: IMPLEMENTATION }
  const asked1 = await askWithQuestions(extra => [
    cleaning
      ? 'Cleanup pass, once: these minor review findings (P3) are inside the perimeter. Fix each one that is a safe, local change and nothing else; one you cannot fix without changing behaviour, or that needs a decision, goes under `rejected` with the reason, no code change. No other edit.'
      : sending.length
        ? 'Fix exactly these review findings and nothing else. A "scope" finding means revert that hunk: a change the brief does not require, outside the perimeter or inside it, only an edit the change itself made, never the user\'s earlier work. Do not keep it in another form: the proposal is recorded for the user, so nothing is lost.'
        : 'No review finding is open: Apply the owner\'s answers below and nothing else.',
    fix,
    routed.answered.length ? `The owner answered the reviewers' questions: apply each answer; an answer that keeps the code as it is needs no edit, say so in \`scope\`.\n${routed.answered.map(a => `- ${a.text} -> ${a.answer}`).join('\n')}` : '',
    extra,
    sending.some(id => unproven(id)) ? 'A finding marked PLAUSIBLE is not proven: REPRODUCE FIRST (a failing test or a run that shows the failure) before any edit. If you cannot reproduce it, change no code for it and list it under `rejected` with the reason "not reproduced"; a finding you judge wrong goes under `rejected` with your reason, no code change either. Mark each `rejected` entry with `kind`: "not-reproduced" when you could not make the failure happen, "wrong" when you judge the finding incorrect.' : '',
    vIds.length ? 'A finding whose id starts with V (path "(verify)", category verify) is the verify command failing: make it pass without weakening the check or changing what it runs.' : '',
    `Intent: ${brief}`,
    resolution?.guidance ? `The user directs: ${resolution.guidance}` : '',
    decisionsText,
    answersText(round),
    REVERT_DECISIONS_TEXT,
    perimeterTextFor(roundFiles),
    dirtyText,
    input.stackSkill ? `Stack skill to load first: ${input.stackSkill}.` : '',
    input.verify ? `Verify with: ${input.verify}` : '',
    TESTS_TEXT,
    QUESTIONS_TEXT,
    DEFAULTS_TEXT,
    RULES,
    FIX_BUDGET,
    REPORT_TEXT,
    snapshotText(lastTree),
  ].filter(Boolean).join('\n\n'), fixOpts, round, resolution)
  if (asked1.stall) return asked1.stall
  const fixed = asked1.report
  if (!fixed) {
    return result({ status: 'STALL', stall: { round, findings: [], reason: `the implementer returned nothing on the fix (stopped or failed${why(fixOpts.label)})` }, resume: RESUME_AGAIN })
  }
  // A resolution at this round (guidance, retry) is one more attempt: a fix that fails again then opens a new V finding instead of stalling.
  const fixStall = gateReport(fixed, vIds.length > 0 && !resolution?.guidance && resolution?.retry !== true)
  const treeBefore = lastTree
  lastDeltaIsFix = !!lastReportTree      // the delta is the fix alone only when the report before it had a snapshot of its own
  lastDeltaBase = treeBefore || startHead || 'HEAD'
  takeReport(fixed)
  lastDelta = deltaCommand(treeBefore, fixed.snapshot?.tree ?? '', startHead)
  // A hunk the brief did not ask for is proposed to the user once the fixer has reverted it, never when it rejected the finding.
  const rejectedIds = new Set(fixed.rejected.map(r => r?.id))
  // Every scope finding the fixer was given counts, fresh, kept after a rejection or sent back with guidance, once per hunk.
  sending.filter(id => known[id]?.category === 'scope' && !rejectedIds.has(id)).forEach(id => {
    if (!proposals.some(p => p.path === known[id].path && p.title === known[id].title)) proposals.push({ source: 'scope-revert', title: known[id].title, path: known[id].path, why: known[id].failure })
  })
  // A finding the fixer rejected is not fixed: the next round's reviewers get it as a CHALLENGE (only the ones it was given).
  const ledger = rejectionLedger({ rejected: fixed.rejected.filter(r => sending.includes(r?.id) && tracked[r.id]?.status === 'open' && !asked1.stale?.has(r.id)), counts: rejectionCounts })
  rejectionCounts = ledger.counts
  for (const c of ledger.challenge) challenged[c.id] = { reason: c.reason, count: c.count, notReproduced: ledger.notReproduced.includes(c.id) }
  lastFix = fixed
  if (!cleaning) (Array.isArray(fixed.files) ? fixed.files : []).forEach(f => fixFiles.add(f))
  addNotes(fixed.openQuestions)
  if (cleaning) cleanupSent = cleanupIds.filter(id => !rejectedIds.has(id))
  if (fixStall) return verifyStall(round, fixStall)
  // The churn and the open count of this fix are judged at the next round's decision, once the reviewers have read it. The cleanup is no fix cycle.
  const churn = fixed.snapshot?.churn
  if (!cleaning) afterFix = true
  if (!cleaning && Number.isFinite(churn)) {
    fixChurns.push(churn)
    rounds[rounds.length - 1].churn = churn
  }
}
