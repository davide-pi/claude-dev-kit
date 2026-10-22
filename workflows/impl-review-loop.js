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
// re-reported under a new id counts). A reviewer that gives no verdict for an id is not a stall: the id is
// asked again the next round. `decideRound` makes the call in plain code, never a model. A subagent never
// asks the user: a stall returns to the caller (the deliver skill), which asks and relaunches with
// `resumeFromRunId` and `args.resolutions`.
//
// Start point: deliver records HEAD and the files already dirty before the change (`args.start`). Only the
// files the implementer reports changed are reviewed, files dirty at the start are the user's and are never
// reverted (an edit of the change there, outside the perimeter, is reported, not reverted), and a perimeter
// file already dirty is refused unless `dirtyConfirmed`. `inline: true` skips the implementer: the session
// edited `changed` itself and only the review loop runs (fixes still go to the implementer).
//
// Resume: relaunch with the same script and args plus ALL the resolutions so far,
// `resolutions: [{ round, accept?, guidance?, retry? }]` (round = the one each STALL reported). The agent
// calls before the decision are cached; the first changed call runs live. `accept` lists finding ids the
// user takes as a residual risk; `guidance` or `retry: true` sends the stalled findings to the fixer once
// more (guidance puts the user's direction in the brief).
//
// The pure functions sit between the markers below. tools/impl-review-loop.test.mjs extracts that block
// and runs it: keep it free of agent(), log() and phase().

// --- pure:begin
const norm = p => String(p ?? '').replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase()

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
const isDirty = (path, dirty, root) => {
  const p = rel(path, root)
  return !!p && (dirty ?? []).some(d => rel(d, root) === p)
}

// The identity of a finding across rounds and ids: where it is and what kind it is.
const keyOf = (f, root) => `${rel(f.path, root)}:${f.line ?? ''}|${String(f.category ?? '').toLowerCase()}`

const BLOCKING = new Set(['P1', 'P2'])

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
// on the finding key.
const mergeReviews = (reviews, root) => {
  const verdicts = {}
  const found = []
  const seen = new Set()
  for (const r of reviews) {
    for (const v of r.previous ?? []) {
      if (verdicts[v.id] !== 'open') verdicts[v.id] = v.status === 'closed' ? 'closed' : 'open'
    }
    for (const f of r.found ?? []) {
      const key = keyOf(f, root)
      if (seen.has(key)) continue
      seen.add(key)
      found.push(f)
    }
  }
  return { verdicts, found }
}

// A finding listed again under a new id is the known finding: when that one is tracked its verdict becomes
// open (a closed one back is a STALL); when it was only recorded as minor / out of scope it is dropped.
//   known { id: finding }   every finding ever listed       tracked { id: { status } }
const dedupeFound = ({ found = [], known = {}, tracked = {}, verdicts = {}, root = '' } = {}) => {
  const byKey = {}
  for (const [id, k] of Object.entries(known)) if (!(keyOf(k, root) in byKey)) byKey[keyOf(k, root)] = id
  const next = { ...verdicts }
  const fresh = []
  const rematched = []
  for (const f of found) {
    const id = byKey[keyOf(f, root)]
    if (!id) { fresh.push(f); continue }
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
// Returns { action: 'DONE' | 'FIX' | 'RECHECK' | 'STALL', tracked, stalled, unanswered, toFix, closed, minor, outOfScope }.
// RECHECK: nothing to fix and nothing stalled, but some open id got no verdict: review again, no fix.
const decideRound = ({ tracked = {}, verdicts = {}, found = [], files = [], dirty = [], root = '', resolution } = {}) => {
  const accept = new Set(resolution?.accept ?? [])
  const guided = !!resolution?.guidance || resolution?.retry === true
  const next = {}
  const stalled = []
  const unanswered = []
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
    } else {
      unanswered.push(id)
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
  const out = { tracked: next, stalled, unanswered, closed, minor, outOfScope }
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
const dirty = strings(input.start?.dirty)
if (!brief || !files.length) {
  return 'impl-review-loop: args.brief and args.perimeter.files are required, e.g. { brief: "...", perimeter: { files: ["src/Orders/OrdersQuery.cs"], behaviour: "...", exclusions: "..." }, repoRoot: "<git rev-parse --show-toplevel>", start: { head, dirty: [] }, size: "M" }'
}
if (!repoRoot) return 'impl-review-loop: args.repoRoot is required (the output of `git rev-parse --show-toplevel`): perimeter paths are matched from the repo root.'
if (inline && !strings(input.changed).length) return 'impl-review-loop: inline: true needs args.changed, the files the session edited.'
const dirtyInPerimeter = dirty.filter(d => inPerimeter(d, files, repoRoot))
if (dirtyInPerimeter.length && input.dirtyConfirmed !== true) {
  return `impl-review-loop: perimeter file(s) already modified before the start: ${dirtyInPerimeter.join(', ')}. Ask the user, then relaunch with dirtyConfirmed: true (or change the perimeter).`
}
const size = ['S', 'M', 'L'].includes(input.size) ? input.size : 'M'
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']
const implEffort = EFFORTS.includes(input.implementerEffort) ? input.implementerEffort : 'medium'
const touches = Array.isArray(input.touches) ? input.touches : []
const resolutions = Array.isArray(input.resolutions) ? input.resolutions : []

// Reviewers by size: S one Sonnet at medium, M one Sonnet at high, L Sonnet and Opus at high plus the
// specialists for what the change touches.
const REVIEWERS = [{ key: 'A', agentType: 'code-reviewer', model: 'sonnet', effort: size === 'S' ? 'medium' : 'high' }]
if (size === 'L') {
  REVIEWERS.push({ key: 'B', agentType: 'code-reviewer', model: 'opus', effort: 'high' })
  if (touches.includes('security')) REVIEWERS.push({ key: 'security', agentType: 'review-security', model: 'sonnet', effort: 'high' })
  if (touches.includes('performance')) REVIEWERS.push({ key: 'performance', agentType: 'review-performance', model: 'sonnet', effort: 'high' })
}

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

const RULES = 'You are a subagent: never ask the user anything. A decision you cannot make goes under Open questions. Never commit, push, apply a migration, deploy or write through an MCP server.'

const IMPLEMENTATION = {
  type: 'object',
  required: ['scope', 'files', 'evidence'],
  properties: {
    scope: { type: 'string' },
    files: { type: 'array', items: { type: 'string', description: 'absolute or repo-relative path of a file you changed' } },
    evidence: { type: 'string', description: 'the verify command and the output line that settles it, quoted; or why not run' },
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
  },
}

const REVIEW = {
  type: 'object',
  required: ['previous', 'found', 'checked'],
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
  },
}

const known = {}                      // id -> finding, every finding ever listed
let tracked = {}
let nextId = 1
let round = 0
let lastFix = null                    // the implementer's last fix report: the delta the next review looks at
const changed = new Set(inline ? strings(input.changed) : [])
const outOfScope = []
const minor = []
const gaps = []
const notes = []                      // the implementer's "found elsewhere" lines
const rounds = []

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
  const impl = await agent([
    brief,
    perimeterText,
    dirtyText,
    input.stackSkill ? `Stack skill to load first: ${input.stackSkill}.` : '',
    input.verify ? `Verify with: ${input.verify}` : '',
    RULES,
    'Return your report through the structured output: scope, files changed, evidence, not verified, open questions.',
  ].filter(Boolean).join('\n\n'), { label: 'implement', phase: 'Implement', agentType: 'implementer', effort: implEffort, schema: IMPLEMENTATION })
  if (!impl) {
    return result({ status: 'STALL', stall: { round: 0, findings: [], reason: 'the implementer returned nothing (stopped or failed)' }, resume: RESUME_AGAIN })
  }
  addFiles(impl)
  ;(impl.openQuestions ?? []).forEach(q => notes.push({ source: 'implementer', text: q }))
}

const previousBlock = () => {
  const list = Object.keys(tracked).map(id => `- ${id} [${tracked[id].status}] ${known[id].path}${known[id].line ? `:${known[id].line}` : ''} - ${known[id].title}: ${known[id].failure}`)
  return list.length
    ? `PREVIOUS FINDINGS (give a verdict, closed or open, for EVERY id, closed ones too; a closed one that is back is open; an id you skip is asked again):\n${list.join('\n')}`
    : 'PREVIOUS FINDINGS: none (first round: review the whole change).'
}

// What each review reads: round 1 the files the change touched since the start point, later rounds the delta of the last fix.
const scopeOfReview = () => (lastFix
  ? `Review the DELTA of the last fix, judging each previous finding by reading the code as it is now. Files the fix changed: ${(lastFix.files ?? []).join(', ') || '(none reported)'}. What the fix says it did: ${lastFix.scope}`
  : `Review the change made${startHead ? ` since commit ${startHead}` : ' since the start'}, only in the files ${inline ? 'the session' : 'the implementer'} reported changed: ${[...changed].join(', ') || '(none reported)'}.`)

while (true) {
  round += 1
  phase('Review')
  const answers = await parallel(REVIEWERS.map(r => () => agent([
    scopeOfReview(),
    `Intent: ${brief}`,
    perimeterText,
    dirtyText,
    'Perimeter rule: every changed line outside the perimeter, in the files the change touched, is a finding with category "scope" (priority P2), except in a file already modified before the start (reported as a normal finding, never "scope"). A defect in a file the change did not touch is a normal finding; it is reported, not fixed.',
    `Effort: ${r.effort}. ${size === 'L' && r.key === 'A' ? 'You may be one of two reviewers on different models with this same brief: do not soften for agreement.' : ''}`,
    previousBlock(),
    `${RULES} Report only P1/P2/P3 findings with a concrete failure; return the structured output: a verdict for every previous id, the new findings apart.`,
  ].join('\n\n'), { label: `R${round} ${r.key}`, phase: 'Review', agentType: r.agentType, model: r.model, effort: r.effort, schema: REVIEW })))
  const alive = answers.filter(Boolean)
  answers.forEach((a, i) => { if (!a) gaps.push(`round ${round}: reviewer ${REVIEWERS[i].key} returned nothing`) })
  if (!alive.length) {
    return result({ status: 'STALL', stall: { round, findings: [], reason: 'no reviewer answered: nothing can be concluded' }, resume: RESUME_AGAIN })
  }

  const merged = mergeReviews(alive, repoRoot)
  const deduped = dedupeFound({ found: merged.found, known, tracked, verdicts: merged.verdicts, root: repoRoot })
  const found = deduped.found.map(f => ({ ...f, id: `F${nextId++}` }))
  found.forEach(f => { known[f.id] = f })
  const resolution = resolutions.find(r => Number(r.round) === round)
  const decision = decideRound({ tracked, verdicts: deduped.verdicts, found, files, dirty, root: repoRoot, resolution })
  tracked = decision.tracked
  decision.minor.forEach(id => minor.push(known[id]))
  decision.outOfScope.forEach(id => outOfScope.push({ source: 'review', ...known[id] }))
  if (decision.unanswered.length) gaps.push(`round ${round}: no verdict for ${decision.unanswered.join(', ')}, asked again`)
  rounds.push({ round, reviewers: alive.length, new: found.map(f => f.id), rematched: deduped.rematched, closed: decision.closed, toFix: decision.toFix, stalled: decision.stalled, unanswered: decision.unanswered })
  log(`Round ${round}: ${found.length} new, ${decision.closed.length} closed, ${decision.toFix.length} to fix, ${decision.stalled.length} stalled, ${decision.unanswered.length} unanswered`)

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
  const fixed = await agent([
    'Fix exactly these review findings and nothing else. A "scope" finding means revert that change outside the perimeter: only an edit the change itself made, never the user\'s earlier work.',
    fix,
    resolution?.guidance ? `The user directs: ${resolution.guidance}` : '',
    perimeterText,
    dirtyText,
    input.verify ? `Verify with: ${input.verify}` : '',
    RULES,
    'Return your report through the structured output: scope, files changed, evidence, not verified, open questions.',
  ].filter(Boolean).join('\n\n'), { label: `fix R${round}`, phase: 'Fix', agentType: 'implementer', effort: implEffort, schema: IMPLEMENTATION })
  if (!fixed) {
    return result({ status: 'STALL', stall: { round, findings: [], reason: 'the implementer returned nothing on the fix (stopped or failed)' }, resume: RESUME_AGAIN })
  }
  lastFix = fixed
  addFiles(fixed)
  ;(fixed.openQuestions ?? []).forEach(q => notes.push({ source: 'implementer', text: q }))
}
