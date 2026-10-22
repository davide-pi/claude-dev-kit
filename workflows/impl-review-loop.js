export const meta = {
  name: 'impl-review-loop',
  description: 'Implement a decided scope, review it by size, fix inside the perimeter and re-review the delta until no P1/P2 is open or a finding stalls',
  whenToUse: 'Launched by the deliver skill for every code change. args: { brief, perimeter: { files, behaviour?, exclusions? }, size?, verify?, stackSkill?, implementerEffort?, touches?, resolutions? }',
  phases: [
    { title: 'Implement', detail: 'the implementer agent, brief plus perimeter' },
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
// finding stalls (STALL): still open after a fix, or closed earlier and open again. `decideRound` makes that
// call in plain code, never a model. A subagent never asks the user: a stall returns to the caller (the
// deliver skill), which asks and relaunches with `resumeFromRunId` and `args.resolutions`.
//
// Resume: relaunch with the same script and args plus `resolutions: [{ round, accept?, guidance? }]`
// (the round the STALL reports). The agent calls before that decision are cached; the first changed
// call runs live. `accept` lists finding ids the user takes as a residual risk; `guidance` makes the
// stalled findings one more fix attempt, with the user's direction in the brief (another round, or a
// different approach).
//
// The pure functions sit between the markers below. tools/impl-review-loop.test.mjs extracts that block
// and runs it: keep it free of agent(), log() and phase().

// --- pure:begin
const norm = p => String(p ?? '').replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase()

// A perimeter entry: a file, a directory (ends with "/") or a glob ("*" inside a segment, "**" across them).
// Matched case-insensitively, on the path or on its tail when the reviewer wrote an absolute path.
const entryRegex = entry => {
  const e = norm(entry)
  const body = e.endsWith('/') ? `${e}**` : e
  const src = body.replace(/[.+^${}()|[\]]/g, '\\$&')
    .replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*').replace(/\?/g, '[^/]')
  return new RegExp(`(^|/)${src}$`)
}
const inPerimeter = (path, files) => {
  const p = norm(path)
  return !!p && (files ?? []).some(f => entryRegex(f).test(p))
}

const BLOCKING = new Set(['P1', 'P2'])

// A finding is blocking when it is P1/P2 and inside the perimeter. A `scope` finding is a diff line the
// implementer put OUTSIDE the perimeter: it is ours to revert, so it blocks (P2 at least). Any other finding
// outside the perimeter is "trovato altro"; P3 inside is minor. Neither blocks, neither is fixed here.
const classify = (f, files) => {
  const scope = f.category === 'scope'
  const priority = scope && !BLOCKING.has(f.priority) ? 'P2' : f.priority
  if (BLOCKING.has(priority) && (scope || inPerimeter(f.path, files))) return 'blocking'
  return inPerimeter(f.path, files) ? 'minor' : 'outOfScope'
}

// Several reviewers, one verdict per previous finding: open if ANY reviewer says open (a missing verdict
// from every reviewer counts as none). New findings are the union, de-duplicated on path, line and category.
const mergeReviews = reviews => {
  const verdicts = {}
  const found = []
  const seen = new Set()
  for (const r of reviews) {
    for (const v of r.previous ?? []) {
      if (verdicts[v.id] !== 'open') verdicts[v.id] = v.status === 'closed' ? 'closed' : 'open'
    }
    for (const f of r.found ?? []) {
      const key = `${norm(f.path)}:${f.line ?? ''}|${f.category}`
      if (seen.has(key)) continue
      seen.add(key)
      found.push(f)
    }
  }
  return { verdicts, found }
}

// The whole round decision.
//   tracked     { id: { status: 'open' | 'closed' | 'accepted' } }  the blocking findings so far
//   verdicts    { id: 'open' | 'closed' }                            this round's marks on earlier findings
//   found       [{ id, path, category, priority, ... }]              this round's NEW findings (ids assigned)
//   files       the perimeter file list
//   resolution  { accept?: [ids], guidance?: string } | undefined    what the user decided after a stall
// Returns { action: 'DONE' | 'FIX' | 'STALL', tracked, stalled, toFix, closed, minor, outOfScope }.
const decideRound = ({ tracked = {}, verdicts = {}, found = [], files = [], resolution } = {}) => {
  const accept = new Set(resolution?.accept ?? [])
  const guided = !!resolution?.guidance
  const next = {}
  const stalled = []
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
    } else {
      stalled.push({ id, why: verdict === 'open' ? 'still-open' : 'no-verdict' })
    }
  }
  const minor = []
  const outOfScope = []
  const fresh = []
  for (const f of found) {
    const kind = classify(f, files)
    if (kind === 'minor') minor.push(f.id)
    else if (kind === 'outOfScope') outOfScope.push(f.id)
    else { fresh.push(f.id); next[f.id] = { status: 'open' } }
  }
  // After a stall the user may direct another attempt: the stalled findings go back to the fixer.
  if (stalled.length && guided) {
    for (const s of stalled) { next[s.id].status = 'open'; toFix.push(s.id) }
    stalled.length = 0
  }
  if (stalled.length) return { action: 'STALL', tracked: next, stalled, toFix: [], closed, minor, outOfScope }
  toFix.push(...fresh)
  return { action: toFix.length ? 'FIX' : 'DONE', tracked: next, stalled, toFix, closed, minor, outOfScope }
}
// --- pure:end

const input = typeof args === 'string' ? { brief: args } : (args ?? {})
const brief = typeof input.brief === 'string' ? input.brief.trim() : ''
const perimeter = input.perimeter ?? {}
const files = Array.isArray(perimeter.files) ? perimeter.files.filter(f => typeof f === 'string' && f.trim()) : []
if (!brief || !files.length) {
  return 'impl-review-loop: args.brief and args.perimeter.files are required, e.g. { brief: "...", perimeter: { files: ["src/Orders/OrdersQuery.cs"], behaviour: "...", exclusions: "..." }, size: "M" }'
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
const changed = new Set()
const outOfScope = []
const minor = []
const gaps = []
const notes = []                      // the implementer's "found elsewhere" lines
const rounds = []

const addFiles = r => (r?.files ?? []).forEach(f => changed.add(f))

phase('Implement')
const impl = await agent([
  brief,
  perimeterText,
  input.stackSkill ? `Stack skill to load first: ${input.stackSkill}.` : '',
  input.verify ? `Verify with: ${input.verify}` : '',
  RULES,
  'Return your report through the structured output: scope, files changed, evidence, not verified, open questions.',
].filter(Boolean).join('\n\n'), { label: 'implement', phase: 'Implement', agentType: 'implementer', effort: implEffort, schema: IMPLEMENTATION })
if (!impl) return { status: 'STALL', rounds: 0, reason: 'the implementer returned nothing (stopped or failed)', open: [], outOfScope: [], minor: [], files: [] }
addFiles(impl)
;(impl.openQuestions ?? []).forEach(q => notes.push({ source: 'implementer', text: q }))

const previousBlock = () => {
  const list = Object.keys(tracked).map(id => `- ${id} [${tracked[id].status}] ${known[id].path}${known[id].line ? `:${known[id].line}` : ''} - ${known[id].title}: ${known[id].failure}`)
  return list.length
    ? `PREVIOUS FINDINGS (give a verdict, closed or open, for EVERY id, closed ones too; a closed one that is back is open):\n${list.join('\n')}`
    : 'PREVIOUS FINDINGS: none (first round: review the whole diff).'
}

let round = 0
while (true) {
  round += 1
  phase('Review')
  const answers = await parallel(REVIEWERS.map(r => () => agent([
    `Review the working diff of the change below${round > 1 ? ', limited to the delta of the last fix: judge each previous finding by reading the code as it is now' : ''}.`,
    `Intent: ${brief}`,
    perimeterText,
    'Perimeter rule: every diff line outside the perimeter is a finding with category "scope" (priority P2). A defect in a file the change did not touch is a normal finding; it is reported, not fixed.',
    `Effort: ${r.effort}. ${size === 'L' && r.key === 'A' ? 'You may be one of two reviewers on different models with this same brief: do not soften for agreement.' : ''}`,
    previousBlock(),
    `${RULES} Report only P1/P2/P3 findings with a concrete failure; return the structured output: a verdict for every previous id, the new findings apart.`,
  ].join('\n\n'), { label: `R${round} ${r.key}`, phase: 'Review', agentType: r.agentType, model: r.model, effort: r.effort, schema: REVIEW })))
  const alive = answers.filter(Boolean)
  answers.forEach((a, i) => { if (!a) gaps.push(`round ${round}: reviewer ${REVIEWERS[i].key} returned nothing`) })
  if (!alive.length) {
    return { status: 'STALL', rounds: round, reason: 'no reviewer answered: nothing can be concluded', open: [], outOfScope, minor, gaps, files: [...changed] }
  }

  const merged = mergeReviews(alive)
  const found = merged.found.map(f => ({ ...f, id: `F${nextId++}` }))
  found.forEach(f => { known[f.id] = f })
  const resolution = resolutions.find(r => r.round === round)
  const decision = decideRound({ tracked, verdicts: merged.verdicts, found, files, resolution })
  tracked = decision.tracked
  decision.minor.forEach(id => minor.push(known[id]))
  decision.outOfScope.forEach(id => outOfScope.push({ source: 'review', ...known[id] }))
  rounds.push({ round, reviewers: alive.length, new: found.map(f => f.id), closed: decision.closed, toFix: decision.toFix, stalled: decision.stalled })
  log(`Round ${round}: ${found.length} new, ${decision.closed.length} closed, ${decision.toFix.length} to fix, ${decision.stalled.length} stalled`)

  const accepted = Object.keys(tracked).filter(id => tracked[id].status === 'accepted').map(id => known[id])
  const result = extra => ({
    rounds: round,
    open: Object.keys(tracked).filter(id => tracked[id].status === 'open').map(id => known[id]),
    accepted,
    outOfScope: [...notes, ...outOfScope],
    minor,
    gaps,
    files: [...changed],
    roundLog: rounds,
    ...extra,
  })
  if (decision.action === 'DONE') return result({ status: 'OK' })
  if (decision.action === 'STALL') {
    return result({
      status: 'STALL',
      stall: { round, findings: decision.stalled.map(s => ({ ...s, ...known[s.id] })) },
      resume: 'Ask the user: accept the risk, one more round, or a different approach. Relaunch with resumeFromRunId and resolutions: [{ round, accept?: [ids], guidance?: "..." }].',
    })
  }

  phase('Fix')
  const fix = decision.toFix.map(id => `- ${id} [${known[id].priority}] ${known[id].path}${known[id].line ? `:${known[id].line}` : ''} - ${known[id].title}: ${known[id].failure}${known[id].fix ? ` (suggested: ${known[id].fix})` : ''}`).join('\n')
  const lastFix = await agent([
    'Fix exactly these review findings and nothing else. A "scope" finding means revert that change outside the perimeter.',
    fix,
    resolution?.guidance ? `The user directs: ${resolution.guidance}` : '',
    perimeterText,
    input.verify ? `Verify with: ${input.verify}` : '',
    RULES,
    'Return your report through the structured output: scope, files changed, evidence, not verified, open questions.',
  ].filter(Boolean).join('\n\n'), { label: `fix R${round}`, phase: 'Fix', agentType: 'implementer', effort: implEffort, schema: IMPLEMENTATION })
  if (!lastFix) {
    return result({ status: 'STALL', stall: { round, findings: [], reason: 'the implementer returned nothing on the fix (stopped or failed)' }, resume: 'Relaunch with resumeFromRunId.' })
  }
  addFiles(lastFix)
  ;(lastFix.openQuestions ?? []).forEach(q => notes.push({ source: 'implementer', text: q }))
}
