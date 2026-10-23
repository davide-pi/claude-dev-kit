export const meta = {
  name: 'impl-review-loop',
  description: 'Implement a decided scope (or review one the session already made), review it by size, fix inside the perimeter and re-review the delta until no P1/P2 is open or a finding stalls',
  whenToUse: 'Launched by the deliver skill for every code change. args: { brief, perimeter: { files, behaviour?, exclusions? }, repoRoot, start?: { head, dirty }, size?, inline?, changed?, dirtyConfirmed?, verify?, stackSkill?, implementerEffort?, touches?, resolutions?: [{ round, accept?, guidance?, retry?, continue?, widen? }] } (one entry per stalled round, all of them on every relaunch with resumeFromRunId). After an OK the caller runs hooks/scope-guard.js --check.',
  phases: [
    { title: 'Implement', detail: 'the implementer agent, brief plus perimeter (skipped when the session edited inline)' },
    { title: 'Review', detail: 'reviewers by size, each previous finding marked closed or open, new ones listed apart' },
    { title: 'Fix', detail: 'the implementer fixes the open P1/P2 inside the perimeter only; the delta is re-reviewed' },
  ],
}

// This workflow exceeds the kit's `workflowSizeGuideline: "small"` (fewer than 5 agents) by design: one
// implementer, one to four reviewers per round, and a soft cap on fix cycles. The "Large workflow" notice is expected.
//
// Who runs: `agent({ agentType })` takes the kit's typed agents (implementer, code-reviewer,
// review-security, review-performance); `model` and `effort` override the agent's own frontmatter per call.
//
// Rounds: soft cap 3, +3 per continue. The loop ends in exactly two ways: no P1/P2 inside the perimeter is open
// (OK), or a finding stalls (STALL): still open after a fix, or closed earlier and open again (a closed finding
// re-reported under a new id, a shifted line or a reworded title counts). A reviewer that gives no verdict for
// an id is not a stall at first: only that id is asked again the next round, and only by the reviewers that
// skipped it (recheckReviewers); two rounds in a row without a verdict on it is the same finding unresolved, a
// STALL ('no-verdict'). `decideRound` makes the call in plain code, never a model. A subagent never
// asks the user: a stall returns to the caller (the deliver skill), which asks and relaunches with
// `resumeFromRunId` and `args.resolutions`.
//
// Cap and churn: only fix cycles (a round that ends in a fixer run) count. A FIX decision with `capLimit(resolutions)` cycles
// already run (3, plus 3 for every resolution `continue: true`) is a STALL 'cap'; RECHECK rounds and coverage reruns never count.
// Every STALL carries `history` (findingHistory): per finding the round it appeared, the fixes it went to, when it closed and
// when it came back. A fixer whose snapshot churn (lines inserted + deleted) grows strictly over three fixes in a row is a STALL
// 'churn' (churnGrowing; a report without a snapshot has no churn and is skipped). The churn is judged at a round's decision, after the
// reviewers have read the last fix: STALL 'churn' only when the churns are growing AND that decision is still FIX. A resolution on that round
// works like on any other: `accept` ends the open ids (the fix was read, so OK is honest), guidance / retry send them to the fixer, `continue`
// restarts the churn count. `continue` grants 3 more fix cycles only when the cap was hit on that round too (then the stall reads 'cap').
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
// `resolutions: [{ round, accept?, guidance?, retry?, continue?, widen? }]` (round = the one each STALL reported). The agent
// calls before the decision are cached; the first changed call runs live. `continue: true` adds 3 fix cycles to the soft cap
// when that round stalled on it, and restarts the churn count when it stalled on a 'churn'. `accept` lists finding ids the
// user takes as a residual risk; `guidance` or `retry: true` sends the stalled findings to the fixer once
// more (guidance puts the user's direction in the brief). `widen` lists perimeter entries the user adds after a
// 'widen' STALL, from that round on (widenedFiles: the reviewers of that round and the earlier prompts keep the old perimeter,
// so the replay is byte-identical). If the resume replays a cached null implementer
// result (a STALL on "the implementer returned nothing"), relaunch WITHOUT resumeFromRunId.
//
// After an OK the caller (deliver) runs `hooks/scope-guard.js --check <start.head>` as the mechanical scope check; the loop
// itself never runs it. Reviewers by size: see reviewersFor (the size is re-derived upward every round from the files changed).
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
// Budget: every implementer, reviewer and fixer prompt carries a tool-call cap below the agent's own turn cap and asks for the
// structured result before it runs out. An agent() that throws anyway (turn cap, no StructuredOutput) is caught
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
// not-run, no snapshot is null, no rejected / noticed / filesReviewed is empty. null (an agent that returned
// nothing) stays null. A snapshot counts only when it carries a tree (a non-empty string): without one it is no
// snapshot, whatever its files say, and the declared files are used.
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

// The soft cap on fix cycles: 3, and 3 more for every `continue: true` given on a round that stalled on the cap (`extensions`).
const FIX_CYCLES = 3
const capLimit = (extensions = 0) => FIX_CYCLES * (1 + (Number.isInteger(extensions) && extensions > 0 ? extensions : 0))

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

// Style findings never block, whatever their priority: a reviewer's taste is not a defect.
const NEVER_BLOCKING = new Set(['clean-code', 'convention'])
const isNeverBlocking = f => NEVER_BLOCKING.has(f?.category)

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
// A new blocking finding the user accepts (`resolution.accept`) is accepted at once: not fixed, which is how a cap or churn stall on
// fresh findings is resolved.
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
const IMPL_BUDGET = budgetText(120)
const REVIEW_BUDGET = budgetText(35)
const FIX_BUDGET = budgetText(80)

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
let fixCycles = 0                     // fixer runs so far: what the soft cap counts (never a RECHECK or a coverage rerun)
let capExtensions = 0                 // continues given on a round that stalled on the cap: each adds FIX_CYCLES to the limit
let fixChurns = []                    // the churn of each fixer snapshot that had one (a continue on a churn stall empties it)
let missing = new Set()               // specialists whose last answer was nothing
let nextRound = { only: null, coverage: false }   // the next round's reviewers: only these keys (a RECHECK or a coverage rerun), null = all
let coverageRetried = false           // a coverage rerun was scheduled and the files are still unread
const changed = new Set(inline ? strings(input.changed) : [])
const outOfScope = []
const minor = []
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
const takeReport = r => {
  takeFiles(r)
  lastReportTree = r.snapshot?.tree ?? ''
  if (lastReportTree) lastTree = lastReportTree
  lastReport = r
  for (const n of r.noticed) {
    if (n && typeof n === 'object' && !noticed.some(x => x.path === n.path && x.title === n.title)) noticed.push({ source: 'noticed', ...n })
  }
}
// The verify gate on a report, before it becomes the last one: a failing verify opens the V finding, a pass closes it.
// Returns the stall, if any.
const gateReport = (r, toFixHadVerify) => {
  const g = verifyGate({ report: r, verifyCmd: input.verify, toFixHadVerify, previous: lastReport?.verify.status, next: nextV })
  if (g.finding) { known[g.finding.id] = g.finding; nextV += 1; verifyOpen = [g.finding] }
  else if (g.status === 'pass') verifyOpen = []
  return g.stall
}
const RESOLUTIONS = 'resolutions: [{ round, accept?: [ids], guidance?: "...", retry?: true, continue?: true, widen?: ["path/or/dir/"] }]'
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
  gaps,
  files: [...changed],
  verify: lastReport?.verify ?? { status: 'not-run' },
  evidence: lastReport?.evidence ?? '',
  notVerified: lastReport?.notVerified ?? '',
  roundLog: rounds,
  ...extra,
})

if (!inline) {
  phase('Implement')
  const implRaw = await ask([
    brief,
    perimeterText,
    dirtyText,
    input.stackSkill ? `Stack skill to load first: ${input.stackSkill}.` : '',
    input.verify ? `Verify with: ${input.verify}` : '',
    RULES,
    REPORT_TEXT,
    IMPL_BUDGET,
    snapshotText(lastTree),
  ].filter(Boolean).join('\n\n'), { label: 'implement', phase: 'Implement', agentType: 'implementer', effort: implEffort, schema: IMPLEMENTATION })
  const impl = readReport(implRaw)
  if (!impl) {
    return result({ status: 'STALL', stall: { round: 0, findings: [], reason: `the implementer returned nothing (stopped or failed${why('implement')})` }, resume: RESUME_AGAIN })
  }
  const implStall = gateReport(impl, false)
  takeReport(impl)
  ;(impl.openQuestions ?? []).forEach(q => notes.push({ source: 'implementer', text: q }))
  if (implStall) return verifyStall(0, implStall)
}

let skipped = []                      // ids a reviewer gave no verdict for last round: only those are asked next
let silent = {}                       // id -> rounds in a row without a verdict

// The previous findings a reviewer is asked a verdict for: the ids it skipped last round, else every open one and the closed ones in a
// file the last fix touched (an accepted one never). A group reviewer gets the ones anchored in its files, a whole reviewer all.
const everyId = () => idsToAsk({ tracked, known, lastFixFiles: lastFix?.files ?? [], skipped, root: repoRoot })
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
// whole-change reviewer does the same for every unread file, since its answer clears them all.
const scopeOfReview = (r, groups) => {
  // A specialist whose last answer was nothing never read its area: it reviews the whole change, not the delta of a fix.
  if (missing.has(r.key) && r.group === undefined && !r.whole) return scopeOfChange()
  const full = r.group !== undefined ? groups[r.group].filter(f => unread.includes(f)) : r.whole ? unread : []
  return scopeOfDelta() + (full.length ? `\nThese files have never been reviewed: review them IN FULL, as changed since ${startHead ? `commit ${startHead}` : 'the start'}, not just the delta: ${full.join(', ')}.` : '')
}
// A delta that starts before the report that preceded the fix (that report had no snapshot of its own, or the session edited inline) is
// every change since then, the fix among them: it is not "the DELTA of the last fix".
const scopeOfChange = () => `Review the change made${startHead ? ` since commit ${startHead}` : ' since the start'}. ${touchedByGit([...changed].join(', '))}`
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
  const { only, coverage } = nextRound
  nextRound = { only: null, coverage: false }
  const picked = only ? everyone.filter(r => only.includes(r.key)) : everyone
  const reviewers = picked.length ? picked : everyone
  const askedMap = Object.fromEntries(reviewers.map(r => [r.key, askedIds(r, groups)]))
  // The reviewers are asked with the perimeter as it was BEFORE this round's resolution (a resume replays identical prompts).
  const reviewPerimeter = perimeterTextFor(widenedFiles(files, resolutions, round - 1), false)
  const answers = await parallel(reviewers.map(r => () => ask([
    scopeOfReview(r, groups),
    shareText(r, groups),
    `Intent: ${brief}`,
    verifyText(),
    reviewPerimeter,
    dirtyText,
    'Perimeter rule: any hunk the brief does not require, even inside a perimeter file, is a finding with category "scope" (priority P2), and so is every changed line outside the perimeter in the files the change touched; except in a file already modified before the start (reported as a normal finding, never "scope"). A defect in a file the change did not touch is a normal finding; it is reported, not fixed. A P1/P2 defect outside the perimeter that this change causes: set causedByChange to true.',
    `Effort: ${r.effort}. ${size === 'L' && r.key.startsWith('A') ? 'You may be one of two reviewers on different models with this same brief: do not soften for agreement.' : ''}`,
    previousBlock(r, groups),
    challengeBlock(r.group === undefined ? undefined : id => groupOf(known[id].path, groups, repoRoot) === r.group),
    `${RULES} Report only P1/P2/P3 findings with a concrete failure; return the structured output: a verdict for every previous id, the new findings apart, and under filesReviewed list every file you actually read.`,
    REVIEW_BUDGET,
  ].filter(Boolean).join('\n\n'), { label: `R${round} ${r.key}`, phase: 'Review', agentType: r.agentType, model: r.model, effort: r.effort, schema: REVIEW })))
  const alive = answers.map((a, i) => (a ? { ...readReport(a), key: reviewers[i].key } : null)).filter(Boolean)
  answers.forEach((a, i) => { if (!a) gaps.push(`round ${round}: reviewer ${reviewers[i].key} returned nothing${why(`R${round} ${reviewers[i].key}`)}`) })
  // The files this round's review had to read: round 1 every changed file, later the files of the last fix, a rerun none new.
  const owedNow = round === 1 ? expected : only ? [] : (lastFix?.files ?? [])
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
  const deduped = dedupeFound({ found: merged.found, known, tracked, verdicts: merged.verdicts, root: repoRoot })
  const found = deduped.found.map(f => ({ ...f, id: `F${nextId++}` }))
  found.forEach(f => { known[f.id] = f })
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
  const action = vIds.length && (decision.action === 'DONE' || decision.action === 'RECHECK') ? 'FIX' : decision.action
  const toFix = action === 'FIX' ? [...vIds, ...decision.toFix] : decision.toFix
  skipped = action === 'RECHECK' ? decision.unanswered : []
  decision.minor.forEach(id => minor.push(known[id]))
  decision.outOfScope.forEach(id => outOfScope.push({ source: 'review', ...known[id], ...(resolution?.accept?.includes(id) ? { accepted: true } : {}) }))
  if (decision.unanswered.length) gaps.push(`round ${round}: no verdict for ${decision.unanswered.join(', ')}, asked again`)
  // Two conditions can stop a FIX decision, each answered by the resolution of that round. The soft cap counts fix cycles only (a RECHECK or a
  // coverage rerun is not one): `continue` there grants 3 more. The churn is read HERE, after the reviewers have read the last fix: the last 3
  // fix churns strictly grow and the decision is still FIX; `continue` there resets the count (and nothing else). Guidance or a retry is the
  // user's "different approach" for either: it goes to the fixer (a cap stall: that one cycle). Accept ends the findings it names, like any round.
  // Both true at once: reported as the cap, and `continue` answers both.
  const limit = capLimit(capExtensions)
  const capHit = action === 'FIX' && fixCycles >= limit
  const churnHit = action === 'FIX' && churnGrowing(fixChurns)
  const redirected = !!resolution?.guidance || resolution?.retry === true
  const stopped = (capHit || churnHit) && !redirected && resolution?.continue !== true
  if (resolution?.continue === true) {
    if (capHit) capExtensions += 1
    if (churnHit) fixChurns = []
  }
  const churnTrend = `the last fixes changed ${fixChurns.slice(-3).join(', ')} lines, more each time`
  rounds.push({ round, size, reviewers: alive.length, new: found.filter(f => tracked[f.id]).map(f => f.id), rematched: deduped.rematched, closed: decision.closed, toFix: stopped ? [] : toFix, stalled: decision.stalled, unanswered: decision.unanswered, churn: null })
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
      continue
    }
    return result({ status: 'OK' })
  }
  if (stopped) {
    const why = capHit ? 'cap' : 'churn'
    const findings = toFix.map(id => ({ id, why, ...known[id] }))
    if (capHit) {
      return result({
        status: 'STALL',
        stall: {
          round,
          why,
          findings,
          reason: `soft cap: ${fixCycles} fix cycles run, the limit is ${limit} (resume with continue: true for ${FIX_CYCLES} more)${churnHit ? `; ${churnTrend}: they are not converging` : ''}`,
        },
        resume: `Ask the user: continue (${FIX_CYCLES} more fix cycles${churnHit ? ', and the churn count restarts' : ''}), accept the risk, or a different approach. Relaunch with resumeFromRunId and ALL the resolutions so far, adding { round: ${round}, continue: true } to go on, { round: ${round}, accept: [ids] } to accept the risk, or { round: ${round}, guidance: "..." } for a different approach (one more fix cycle): ${RESOLUTIONS}.`,
      })
    }
    return result({
      status: 'STALL',
      stall: { round, why, findings, reason: `the fixes change more each time (${fixChurns.slice(-3).join(', ')} lines): they are not converging` },
      resume: `Ask the user: continue, accept the risk, or a different approach. Relaunch with resumeFromRunId and ALL the resolutions so far, adding { round: ${round}, continue: true } to go on (it only restarts the churn count: no extra fix cycles), { round: ${round}, accept: [ids] } to accept the risk (the reviewers of this round have already read the last fix), or { round: ${round}, guidance: "..." } / { round: ${round}, retry: true } for another attempt: ${RESOLUTIONS}.`,
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
  const unproven = id => known[id].confidence === 'PLAUSIBLE'
  // A P1/P2 outside the perimeter that went to the fixer next to a revert of a hunk of the same file: the revert should remove it.
  const withRevert = id => known[id].category !== 'scope' && !inPerimeter(known[id].path, roundFiles, repoRoot) && toFix.some(o => known[o]?.category === 'scope' && rel(known[o].path, repoRoot) === rel(known[id].path, repoRoot))
  const fix = toFix.map(id => `- ${id} [${known[id].priority}] ${known[id].path}${known[id].line ? `:${known[id].line}` : ''} - ${known[id].title}: ${known[id].failure}${known[id].fix ? ` (suggested: ${known[id].fix})` : ''}${unproven(id) ? ' (PLAUSIBLE: REPRODUCE FIRST)' : ''}${withRevert(id) ? ' (outside the perimeter: revert the hunk of this file; this defect should disappear with it, do not edit anything else there)' : ''}${decision.kept.includes(id) ? ` (you rejected this finding and the reviewer kept it${merged.notes[id] ? `: ${merged.notes[id]}` : ''}; reproduce it, then fix it)` : ''}`).join('\n')
  fixCycles += 1
  const fixedRaw = await ask([
    'Fix exactly these review findings and nothing else. A "scope" finding means revert that hunk: a change the brief does not require, outside the perimeter or inside it, only an edit the change itself made, never the user\'s earlier work. Do not keep it in another form: the proposal is recorded for the user, so nothing is lost.',
    fix,
    toFix.some(id => unproven(id)) ? 'A finding marked PLAUSIBLE is not proven: REPRODUCE FIRST (a failing test or a run that shows the failure) before any edit. If you cannot reproduce it, change no code for it and list it under `rejected` with the reason "not reproduced"; a finding you judge wrong goes under `rejected` with your reason, no code change either. Mark each `rejected` entry with `kind`: "not-reproduced" when you could not make the failure happen, "wrong" when you judge the finding incorrect.' : '',
    vIds.length ? 'A finding whose id starts with V (path "(verify)", category verify) is the verify command failing: make it pass without weakening the check or changing what it runs.' : '',
    `Intent: ${brief}`,
    resolution?.guidance ? `The user directs: ${resolution.guidance}` : '',
    perimeterTextFor(roundFiles),
    dirtyText,
    input.stackSkill ? `Stack skill to load first: ${input.stackSkill}.` : '',
    input.verify ? `Verify with: ${input.verify}` : '',
    RULES,
    FIX_BUDGET,
    REPORT_TEXT,
    snapshotText(lastTree),
  ].filter(Boolean).join('\n\n'), { label: `fix R${round}`, phase: 'Fix', agentType: 'implementer', effort: implEffort, schema: IMPLEMENTATION })
  const fixed = readReport(fixedRaw)
  if (!fixed) {
    return result({ status: 'STALL', stall: { round, findings: [], reason: `the implementer returned nothing on the fix (stopped or failed${why(`fix R${round}`)})` }, resume: RESUME_AGAIN })
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
  toFix.filter(id => known[id]?.category === 'scope' && !rejectedIds.has(id)).forEach(id => {
    if (!proposals.some(p => p.path === known[id].path && p.title === known[id].title)) proposals.push({ source: 'scope-revert', title: known[id].title, path: known[id].path, why: known[id].failure })
  })
  // A finding the fixer rejected is not fixed: the next round's reviewers get it as a CHALLENGE (only the ones it was given).
  const ledger = rejectionLedger({ rejected: fixed.rejected.filter(r => toFix.includes(r?.id) && tracked[r.id]?.status === 'open'), counts: rejectionCounts })
  rejectionCounts = ledger.counts
  for (const c of ledger.challenge) challenged[c.id] = { reason: c.reason, count: c.count, notReproduced: ledger.notReproduced.includes(c.id) }
  lastFix = fixed
  ;(fixed.openQuestions ?? []).forEach(q => notes.push({ source: 'implementer', text: q }))
  if (fixStall) return verifyStall(round, fixStall)
  // The churn of this fix (lines inserted + deleted) is judged at the next round's decision, once the reviewers have read it.
  const churn = fixed.snapshot?.churn
  if (Number.isFinite(churn)) {
    fixChurns.push(churn)
    rounds[rounds.length - 1].churn = churn
  }
}
