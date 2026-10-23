export const meta = {
  name: 'impl-review-loop',
  description: 'Implement a decided scope (or review one the session already made), review it by size, fix inside the perimeter and re-review the delta until no P1/P2 is open or a finding stalls',
  whenToUse: 'Launched by the deliver skill for every code change. args: { brief, perimeter: { files, behaviour?, exclusions? }, repoRoot, start?: { head, dirty }, size?, inline?, changed?, dirtyConfirmed?, verify?, stackSkill?, implementerEffort?, touches?, resolutions? }',
  phases: [
    { title: 'Implement', detail: 'the implementer agent, brief plus perimeter (skipped when the session edited inline)' },
    { title: 'Review', detail: 'reviewers by size, each previous finding marked closed or open, new ones listed apart' },
    { title: 'Fix', detail: 'the implementer fixes the open P1/P2 inside the perimeter only; the delta is re-reviewed' },
  ],
}

// This workflow exceeds the kit's `workflowSizeGuideline: "small"` (fewer than 5 agents) by design: one
// implementer, one to four reviewers per round, and no round cap. The "Large workflow" notice is expected.
//
// Who runs: `agent({ agentType })` takes the kit's typed agents (implementer, code-reviewer,
// review-security, review-performance); `model` and `effort` override the agent's own frontmatter per call.
//
// Rounds have NO cap. The loop ends in exactly two ways: no P1/P2 inside the perimeter is open (OK), or a
// finding stalls (STALL): still open after a fix, or closed earlier and open again (a closed finding
// re-reported under a new id, a shifted line or a reworded title counts). A reviewer that gives no verdict for
// an id is not a stall at first: only that id is asked again the next round; two rounds in a row without a
// verdict on it is the same finding unresolved, a STALL ('no-verdict'). `decideRound` makes the call in plain
// code, never a model. A subagent never
// asks the user: a stall returns to the caller (the deliver skill), which asks and relaunches with
// `resumeFromRunId` and `args.resolutions`.
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
// `resolutions: [{ round, accept?, guidance?, retry? }]` (round = the one each STALL reported). The agent
// calls before the decision are cached; the first changed call runs live. `accept` lists finding ids the
// user takes as a residual risk; `guidance` or `retry: true` sends the stalled findings to the fixer once
// more (guidance puts the user's direction in the brief). If the resume replays a cached null implementer
// result (a STALL on "the implementer returned nothing"), relaunch WITHOUT resumeFromRunId.
//
// Budget: every reviewer and fixer prompt carries a tool-call cap below the agent's own turn cap and asks for the
// structured result before it runs out. An agent() that throws anyway (turn cap, no StructuredOutput) is caught
// and read as an empty result, so the gap / no-verdict logic handles it and the run goes on.
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
// nothing) stays null.
const VERIFY_STATUSES = ['pass', 'fail', 'not-run']
const readReport = r => {
  if (!r || typeof r !== 'object') return null
  const list = v => (Array.isArray(v) ? v : [])
  return {
    ...r,
    verify: VERIFY_STATUSES.includes(r.verify?.status) ? r.verify : { ...r.verify, status: 'not-run' },
    snapshot: r.snapshot && typeof r.snapshot === 'object' ? r.snapshot : null,
    rejected: list(r.rejected),
    noticed: list(r.noticed),
    filesReviewed: list(r.filesReviewed),
  }
}

// The files nobody has read yet, carried between rounds: a group whose reviewer returned nothing adds its files, a
// group reviewer that answers removes them (it is asked for them in full), a whole-change reviewer that answered
// covers all. A round with a file still here must not conclude DONE.
//   answers    one entry per reviewer, null when it returned nothing      reviewers   [{ key, group?, whole? }]
// Only a reviewer flagged `whole` (a general reviewer over the whole change) covers all files: a specialist reads its own area only.
//   pending    the files still unread after the previous round
const unreviewedFiles = (answers, reviewers, groups, pending = []) => {
  if (answers.some((a, i) => a && reviewers[i].whole)) return []
  const left = new Set(pending)
  answers.forEach((a, i) => {
    if (reviewers[i].group === undefined) return
    groups[reviewers[i].group].forEach(f => (a ? left.delete(f) : left.add(f)))
  })
  return [...left]
}

// A finding is blocking when it is P1/P2 and inside the perimeter. A `scope` finding is a diff line the
// implementer put OUTSIDE the perimeter: it is ours to revert, so it blocks (P2 at least) - unless the file
// was already dirty before the start: that is the user's work, reported and never reverted. Any other finding
// outside the perimeter is "trovato altro"; P3 inside is minor. Neither blocks, neither is fixed here.
const classify = (f, files, { dirty = [], root = '' } = {}) => {
  const inside = inPerimeter(f.path, files, root)
  const scope = f.category === 'scope' && !isDirty(f.path, dirty, root)
  const priority = scope && !BLOCKING.has(f.priority) ? 'P2' : f.priority
  if (BLOCKING.has(priority) && (scope || inside)) return 'blocking'
  return inside ? 'minor' : 'outOfScope'
}

// Several reviewers, one verdict per previous finding: open if ANY reviewer says open. An id no reviewer
// answered has no verdict at all (it is asked again, not guessed). New findings are the union, de-duplicated
// with `sameFinding`; of two reports of the same defect the most severe is kept, different titles stay apart.
const mergeReviews = (reviews, root) => {
  const verdicts = {}
  const found = []
  for (const r of reviews) {
    for (const v of r.previous ?? []) {
      if (verdicts[v.id] !== 'open') verdicts[v.id] = v.status === 'closed' ? 'closed' : 'open'
    }
    for (const f of r.found ?? []) {
      const i = found.findIndex(g => sameFinding(f, g, root))
      if (i < 0) found.push(f)
      else if (rank(f) < rank(found[i])) found[i] = f
    }
  }
  return { verdicts, found }
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
//   files       the perimeter file list; dirty, root: see classify
//   resolution  { accept?: [ids], guidance?: string, retry?: true }  what the user decided after a stall
//   silent      { id: n }   rounds in a row each id got no verdict, up to the previous round
// Returns { action: 'DONE' | 'FIX' | 'RECHECK' | 'STALL', tracked, stalled, unanswered, silent, toFix, closed, minor, outOfScope }.
// RECHECK: nothing to fix and nothing stalled, but some open id got no verdict: review again, no fix. An id with
// no verdict in 2 rounds in a row is the same finding unresolved: stalled, why 'no-verdict'.
const decideRound = ({ tracked = {}, verdicts = {}, found = [], files = [], dirty = [], root = '', resolution, silent = {} } = {}) => {
  const accept = new Set(resolution?.accept ?? [])
  const guided = !!resolution?.guidance || resolution?.retry === true
  const next = {}
  const stalled = []
  const unanswered = []
  const nextSilent = {}
  const closed = []
  const toFix = []
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
  for (const f of found) {
    const kind = classify(f, files, { dirty, root })
    if (kind === 'minor') minor.push(f.id)
    else if (kind === 'outOfScope') outOfScope.push(f.id)
    else { fresh.push(f.id); next[f.id] = { status: 'open' } }
  }
  // After a stall the user may direct another attempt: the stalled findings go back to the fixer.
  if (stalled.length && guided) {
    for (const s of stalled) { next[s.id].status = 'open'; toFix.push(s.id) }
    stalled.length = 0
  }
  const out = { tracked: next, stalled, unanswered, silent: nextSilent, closed, minor, outOfScope }
  if (stalled.length) return { action: 'STALL', toFix: [], ...out }
  toFix.push(...fresh)
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

const perimeterText = [
  `PERIMETER (the only files you may change): ${files.join(', ')}`,
  perimeter.behaviour ? `Behaviour in scope: ${perimeter.behaviour}` : '',
  perimeter.exclusions ? `Explicitly out of scope: ${perimeter.exclusions}` : '',
  'Anything worth doing outside the perimeter is not touched: report it under Open questions, one line each.',
].filter(Boolean).join('\n')

// Work the user had in the tree before the change started: never the change's to touch or revert.
const dirtyText = dirty.length
  ? `Already modified before the change started${startHead ? ` (HEAD ${startHead})` : ''}, the user's own work: ${dirty.join(', ')}. Never change or revert those files; an out-of-perimeter edit there is reported, never reverted.`
  : ''

const budgetText = calls => `TOOL BUDGET: at most ${calls} tool calls in total, the structured-output call included. Read selectively, stop exploring after about ${calls - 10} and return the structured result before the budget runs out: a partial result beats none, and a run that ends without it is lost.`
const REVIEW_BUDGET = budgetText(25)
const FIX_BUDGET = budgetText(45)

const RULES = 'You are a subagent: never ask the user anything. A decision you cannot make goes under Open questions. Never commit, push, apply a migration, deploy or write through an MCP server.'

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
      items: { type: 'object', required: ['id', 'reason'], properties: { id: { type: 'string' }, reason: { type: 'string' } } },
    },
    noticed: {
      type: 'array',
      description: 'defects seen outside the perimeter, not touched',
      items: { type: 'object', required: ['title', 'path', 'why'], properties: { title: { type: 'string' }, path: { type: 'string' }, why: { type: 'string' } } },
    },
    notVerified: { type: 'string' },
    openQuestions: { type: 'array', items: { type: 'string', description: 'out-of-perimeter finding or guess, one line' } },
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
let unread = []                       // files whose group reviewer returned nothing and nobody else read: reviewed in full
const changed = new Set(inline ? strings(input.changed) : [])
const outOfScope = []
const minor = []
const gaps = []
const notes = []                      // the implementer's "found elsewhere" lines
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
const RESUME_AGAIN = 'Relaunch with the same args and resumeFromRunId, plus every resolution so far: resolutions: [{ round, accept?, guidance?, retry? }].'

const result = extra => ({
  rounds: round,
  open: Object.keys(tracked).filter(id => tracked[id].status === 'open').map(id => known[id]),
  accepted: Object.keys(tracked).filter(id => tracked[id].status === 'accepted').map(id => known[id]),
  outOfScope: [...notes, ...outOfScope],
  minor,
  gaps,
  files: [...changed],
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
    'Return your report through the structured output: scope, files changed, evidence, not verified, open questions.',
  ].filter(Boolean).join('\n\n'), { label: 'implement', phase: 'Implement', agentType: 'implementer', effort: implEffort, schema: IMPLEMENTATION })
  const impl = readReport(implRaw)
  if (!impl) {
    return result({ status: 'STALL', stall: { round: 0, findings: [], reason: `the implementer returned nothing (stopped or failed${why('implement')})` }, resume: RESUME_AGAIN })
  }
  addFiles(impl)
  ;(impl.openQuestions ?? []).forEach(q => notes.push({ source: 'implementer', text: q }))
}

let skipped = []                      // ids a reviewer gave no verdict for last round: only those are asked next
let silent = {}                       // id -> rounds in a row without a verdict

// A group reviewer is asked only for the previous findings anchored in its files; a whole reviewer for all of them.
const previousBlock = (mine = () => true) => {
  const all = skipped.length ? skipped : Object.keys(tracked)
  const ids = all.filter(mine)
  if (all.length && !ids.length) return 'PREVIOUS FINDINGS: none on your files (give no verdict).'
  const list = ids.map(id => `- ${id} [${tracked[id].status}] ${known[id].path}${known[id].line ? `:${known[id].line}` : ''} - ${known[id].title}: ${known[id].failure}`)
  if (skipped.length) return `PREVIOUS FINDINGS you skipped last round (give a verdict, closed or open, for each of these ids only; an id you skip again stalls the loop):\n${list.join('\n')}`
  return list.length
    ? `PREVIOUS FINDINGS (give a verdict, closed or open, for EVERY id, closed ones too; a closed one that is back is open; an id you skip is asked again):\n${list.join('\n')}`
    : 'PREVIOUS FINDINGS: none (first round: review the whole change).'
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
  if (groups.length < 2) return { size, groups, list: reviewers }
  return { size, groups, list: [...groups.map((g, i) => ({ ...first, key: `A${i + 1}`, group: i, whole: false })), ...rest] }
}
const shareText = (r, groups) => (r.group === undefined ? '' : [
  `Your share: review ONLY these files, the other reviewers hold the rest (this overrides the "hint" rule above): ${groups[r.group].join(', ')}.`,
  r.group === groups.length - 1 ? 'You also own any touched file git lists that is not in the declared list.' : '',
].filter(Boolean).join(' '))

// What each review reads: round 1 the files the change touched since the start point, later rounds the delta of the last fix.
// A group reviewer that owns files never read in full (its reviewer returned nothing earlier) reviews them whole; a
// whole-change reviewer does the same for every unread file, since its answer clears them all.
const scopeOfReview = (r, groups) => {
  const full = r.group !== undefined ? groups[r.group].filter(f => unread.includes(f)) : r.whole ? unread : []
  return scopeOfDelta() + (full.length ? `\nThese files have never been reviewed: review them IN FULL, as changed since ${startHead ? `commit ${startHead}` : 'the start'}, not just the delta: ${full.join(', ')}.` : '')
}
const scopeOfDelta = () => (lastFix
  ? `Review the DELTA of the last fix, judging each previous finding by reading the code as it is now. Files the fix changed: ${(lastFix.files ?? []).join(', ') || '(none reported)'}. What the fix says it did: ${lastFix.scope}\n${touchedByGit([...changed].join(', '))}`
  : `Review the change made${startHead ? ` since commit ${startHead}` : ' since the start'}. ${touchedByGit([...changed].join(', '))}`)

while (true) {
  round += 1
  phase('Review')
  const { size, groups, list: reviewers } = reviewersForRound()
  const answers = await parallel(reviewers.map(r => () => ask([
    scopeOfReview(r, groups),
    shareText(r, groups),
    `Intent: ${brief}`,
    perimeterText,
    dirtyText,
    'Perimeter rule: every changed line outside the perimeter, in the files the change touched, is a finding with category "scope" (priority P2), except in a file already modified before the start (reported as a normal finding, never "scope"). A defect in a file the change did not touch is a normal finding; it is reported, not fixed.',
    `Effort: ${r.effort}. ${size === 'L' && r.key.startsWith('A') ? 'You may be one of two reviewers on different models with this same brief: do not soften for agreement.' : ''}`,
    previousBlock(r.group === undefined ? undefined : id => groupOf(known[id].path, groups, repoRoot) === r.group),
    `${RULES} Report only P1/P2/P3 findings with a concrete failure; return the structured output: a verdict for every previous id, the new findings apart.`,
    REVIEW_BUDGET,
  ].filter(Boolean).join('\n\n'), { label: `R${round} ${r.key}`, phase: 'Review', agentType: r.agentType, model: r.model, effort: r.effort, schema: REVIEW })))
  const alive = answers.filter(Boolean).map(readReport)
  answers.forEach((a, i) => { if (!a) gaps.push(`round ${round}: reviewer ${reviewers[i].key} returned nothing${why(`R${round} ${reviewers[i].key}`)}`) })
  if (!alive.length) {
    return result({ status: 'STALL', stall: { round, findings: [], reason: 'no reviewer answered: nothing can be concluded' }, resume: RESUME_AGAIN })
  }

  const merged = mergeReviews(alive, repoRoot)
  const deduped = dedupeFound({ found: merged.found, known, tracked, verdicts: merged.verdicts, root: repoRoot })
  const found = deduped.found.map(f => ({ ...f, id: `F${nextId++}` }))
  found.forEach(f => { known[f.id] = f })
  const resolution = resolutions.find(r => Number(r.round) === round)
  const decision = decideRound({ tracked, verdicts: deduped.verdicts, found, files, dirty, root: repoRoot, resolution, silent })
  tracked = decision.tracked
  silent = decision.silent
  skipped = decision.action === 'RECHECK' ? decision.unanswered : []
  decision.minor.forEach(id => minor.push(known[id]))
  decision.outOfScope.forEach(id => outOfScope.push({ source: 'review', ...known[id] }))
  if (decision.unanswered.length) gaps.push(`round ${round}: no verdict for ${decision.unanswered.join(', ')}, asked again`)
  rounds.push({ round, size, reviewers: alive.length, new: found.map(f => f.id), rematched: deduped.rematched, closed: decision.closed, toFix: decision.toFix, stalled: decision.stalled, unanswered: decision.unanswered })
  log(`Round ${round}: ${found.length} new, ${decision.closed.length} closed, ${decision.toFix.length} to fix, ${decision.stalled.length} stalled, ${decision.unanswered.length} unanswered`)

  unread = unreviewedFiles(answers, reviewers, groups, unread)
  if (decision.action === 'DONE' && unread.length) {
    return result({ status: 'STALL', stall: { round, findings: [], reason: `no reviewer read these files (their group reviewer returned nothing): ${unread.join(', ')}` }, resume: RESUME_AGAIN })
  }
  if (decision.action === 'DONE') return result({ status: 'OK' })
  if (decision.action === 'STALL') {
    return result({
      status: 'STALL',
      stall: { round, findings: decision.stalled.map(s => ({ ...s, ...known[s.id] })) },
      resume: 'Ask the user: accept the risk, one more round, or a different approach. Relaunch with resumeFromRunId and ALL the resolutions so far: resolutions: [{ round, accept?: [ids], guidance?: "...", retry?: true }].',
    })
  }
  if (decision.action === 'RECHECK') continue

  phase('Fix')
  const fix = decision.toFix.map(id => `- ${id} [${known[id].priority}] ${known[id].path}${known[id].line ? `:${known[id].line}` : ''} - ${known[id].title}: ${known[id].failure}${known[id].fix ? ` (suggested: ${known[id].fix})` : ''}`).join('\n')
  const fixedRaw = await ask([
    'Fix exactly these review findings and nothing else. A "scope" finding means revert that change outside the perimeter: only an edit the change itself made, never the user\'s earlier work.',
    fix,
    `Intent: ${brief}`,
    resolution?.guidance ? `The user directs: ${resolution.guidance}` : '',
    perimeterText,
    dirtyText,
    input.stackSkill ? `Stack skill to load first: ${input.stackSkill}.` : '',
    input.verify ? `Verify with: ${input.verify}` : '',
    RULES,
    FIX_BUDGET,
    'Return your report through the structured output: scope, files changed, evidence, not verified, open questions.',
  ].filter(Boolean).join('\n\n'), { label: `fix R${round}`, phase: 'Fix', agentType: 'implementer', effort: implEffort, schema: IMPLEMENTATION })
  const fixed = readReport(fixedRaw)
  if (!fixed) {
    return result({ status: 'STALL', stall: { round, findings: [], reason: `the implementer returned nothing on the fix (stopped or failed${why(`fix R${round}`)})` }, resume: RESUME_AGAIN })
  }
  lastFix = fixed
  addFiles(fixed)
  ;(fixed.openQuestions ?? []).forEach(q => notes.push({ source: 'implementer', text: q }))
}
