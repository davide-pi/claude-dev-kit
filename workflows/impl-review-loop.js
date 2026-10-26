export const meta = {
  name: 'impl-review-loop',
  description: 'Implement a decided scope (or review one the session already made), review it by size, fix inside the perimeter and re-review the delta until no P1/P2 is open or a finding stalls',
  whenToUse: 'Launched by the deliver skill for every code change. args: { brief, request?, decisions?, perimeter: { files, behaviour?, exclusions? }, repoRoot, start?: { head, dirty }, size?, inline?, changed?, dirtyConfirmed?, verify?, stackSkill?, implementerEffort?, implementerModel?, cleanup?, risk?, touches?, preview?, resolutions?: [{ round, accept?, guidance?, retry?, answers?, widen? }] } (one entry per stalled round, all of them on every relaunch with resumeFromRunId). After an OK the caller runs hooks/scope-guard.js --check. The caller closes the perimeter with result.findingsLog (references/loop.md); a STALL is read from references/stall.md.',
  phases: [
    { title: 'Implement', detail: 'the implementer agent, brief plus perimeter (skipped when the session edited inline)' },
    { title: 'Review', detail: 'reviewers by size, each previous finding marked closed or open, new ones listed apart' },
    { title: 'Fix', detail: 'the implementer fixes the open P1/P2 inside the perimeter only; the delta is re-reviewed' },
  ],
}

// Contract: args in whenToUse; a STALL returns to the caller, which relaunches with resumeFromRunId and every resolution (stall.why names the kind).
// Everything between the markers is pure and run by tools/impl-review-loop.harness.mjs.

// --- pure:begin
const norm = p => String(p ?? '').replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase().replace(/^\/([a-z])\//, '$1:/')

const rel = (p, root) => {
  const x = norm(p)
  const r = norm(root).replace(/\/+$/, '')
  return r && x.startsWith(`${r}/`) ? x.slice(r.length + 1) : x
}

// The same rule as hooks/scope-guard.js (a test holds them together).
const entryRegex = entry => {
  const e = norm(entry.trim())
  const body = e.endsWith('/') ? `${e}**` : e
  const src = body.replace(/[.+^${}()|[\]]/g, '\\$&')
    .replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*').replace(/\?/g, '[^/]')
  return new RegExp(`^${src}$`)
}
const inPerimeter = (path, files, root) => {
  const p = rel(path, root)
  return !!p && !/^([a-z]:)?\//.test(p) && (files ?? []).some(f => entryRegex(f).test(p))
}
const isDirty = (path, dirty, root) => {
  const p = rel(path, root)
  return !!p && (dirty ?? []).some(d => { const x = rel(d, root); return x.endsWith('/') ? p.startsWith(x) : x === p })
}

const parseDirty = entry => String(entry ?? '').replace(/^[ MADRCUT?!]{2} /, '').trim()
  .split(' -> ').map(x => x.trim().replace(/^"(.*)"$/, '$1')).filter(Boolean)

// A reworded title must also sit within LINE_WINDOW lines, an identical one within 3x (two defects of one file can share a title).
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
  if ((a.category === 'scope') !== (b.category === 'scope')) return false
  const gap = Number.isFinite(a.line) && Number.isFinite(b.line) ? Math.abs(a.line - b.line) : 0
  return gap <= (plain(a.title) === plain(b.title) ? 3 * LINE_WINDOW : LINE_WINDOW) && sameTitle(a.title, b.title)
}
const rank = f => ({ P1: 1, P2: 2 })[f?.priority] ?? 3
const BLOCKING = new Set(['P1', 'P2'])

// Past this many files reviewer A splits into one reviewer per group, in order, so a group keeps its files while fixes only append.
const MAX_REVIEW_FILES = 8
const FINAL_READ_MIN_CHURN = 30   // a small review fix is already read by its finder and the watcher
const groupFiles = (list, max = MAX_REVIEW_FILES) => {
  const groups = []
  for (let i = 0; i < list.length; i += max) groups.push(list.slice(i, i + max))
  return groups.length ? groups : [[]]
}
const groupOf = (path, groups, root) => {
  const p = rel(path, root)
  const i = groups.findIndex(g => g.some(x => rel(x, root) === p))
  return i < 0 ? groups.length - 1 : i
}

const reviewersFor = (size, touches = []) => {
  const code = (key, model, effort) => ({ key, agentType: 'code-reviewer', model, effort, whole: true })
  const list = size === 'S' ? [code('A', 'sonnet', 'medium')] : size === 'M' ? [code('A', 'sonnet', 'high')] : [code('A', 'sonnet', 'high'), code('B', 'opus', 'high')]
  const specialist = (key, agentType) => (size !== 'S' && touches.includes(key) ? [{ key, agentType, model: 'sonnet', effort: key === 'performance' ? 'medium' : 'high' }] : [])
  return [...list, ...specialist('security', 'review-security'), ...specialist('performance', 'review-performance')]
}

// Size comes from the triage; the risk axes of the change only raise the floor (never down), the file count never does.
// logic is in almost every change, so it never counts toward the three axes that lift to L.
const SIZES = ['S', 'M', 'L']
const RISKS = ['logic', 'data', 'money', 'concurrency', 'contract', 'security', 'performance']
const FLOOR_M = ['data', 'money', 'concurrency', 'contract', 'security']
const riskAxes = (risk, touches) => [...new Set([...(Array.isArray(risk) ? risk : []), ...(Array.isArray(touches) ? touches : [])].filter(x => RISKS.includes(x)))]
const sizeFor = (given, axes = []) => {
  const floor = axes.filter(x => x !== 'logic').length >= 3 ? 'L' : axes.some(x => FLOOR_M.includes(x)) ? 'M' : 'S'
  return SIZES[Math.max(SIZES.indexOf(given), SIZES.indexOf(floor))]
}
// More files than the triage size implies: a signal for the verdict, never a bump of the size.
const sizeSignal = (size, count) => (size === 'S' && count > 1) || (size === 'M' && count > 6)
  ? `the change touches ${count} files, more than a size ${size} triage implies: the triage may have been too small`
  : ''

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
    remaining: list(r.remaining).filter(s => typeof s === 'string' && s.trim()),
  }
}

const deltaCommand = (prevTree, tree, startHead) => (tree ? `git diff ${prevTree || startHead || 'HEAD'} ${tree}` : '')

const verifyGate = ({ report, verifyCmd, toFixHadVerify = false, previous, next = 1 } = {}) => {
  const v = report?.verify ?? {}
  const status = VERIFY_STATUSES.includes(v.status) ? v.status : 'not-run'
  const seen = `\`${v.command ?? verifyCmd ?? '(no command)'}\` → ${status}${v.line ? `: ${v.line}` : ''}`
  if (status === 'pass') return { status }
  if (status === 'not-run') return verifyCmd || toFixHadVerify ? { status, stall: { why: 'verify-not-run', reason: `the verify command was not run: ${seen}` } } : { status }
  if (toFixHadVerify) return { status, stall: { why: 'verify-failed', reason: `the verify still fails after the fix: ${seen}` } }
  if (previous === 'pass') return { status, stall: { why: 'green-to-red', reason: `the verify was green and is red after the fix: ${seen}` } }
  return { status, finding: { id: `V${next}`, path: '(verify)', category: 'verify', priority: 'P1', title: 'the verify command fails', failure: seen, fix: 'make the verify command pass without weakening the check' } }
}

// A reviewer that returned nothing clears nothing; a specialist clears no file.
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

const coverageAction = ({ unread = [], retried = false } = {}) => (!unread.length ? 'ok' : retried ? 'stall' : 'rerun')

const coverageOwners = (unread, reviewers, groups, root = '') => {
  const keys = new Set()
  for (const f of unread) {
    const gi = groupOf(f, groups, root)
    const owners = groups.length > 1 ? reviewers.filter(r => r.group === gi) : reviewers.filter(r => r.whole)
    owners.forEach(r => keys.add(r.key))
  }
  return reviewers.filter(r => keys.has(r.key)).map(r => r.key)
}

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

const churnGrowing = churns => {
  const last = (Array.isArray(churns) ? churns : []).filter(Number.isFinite).slice(-3)
  return last.length === 3 && last[0] < last[1] && last[1] < last[2]
}

const notConverging = counts => {
  let low = Infinity
  let stuck = 0
  for (const c of (Array.isArray(counts) ? counts : []).filter(Number.isFinite)) {
    stuck = c < low ? 0 : stuck + 1
    low = Math.min(low, c)
  }
  return stuck >= 3
}

const isNeverBlocking = f => ['clean-code', 'convention'].includes(f?.category)

const isTouched = (path, touched, root) => {
  const p = rel(path, root)
  return !!p && (touched ?? []).some(t => rel(t, root) === p)
}

const widenedFiles = (files, resolutions, round) => {
  const list = [...(files ?? [])]
  for (const r of Array.isArray(resolutions) ? resolutions : []) {
    if (!(Number(r?.round) <= round) || !Array.isArray(r.widen)) continue
    for (const x of r.widen) if (typeof x === 'string' && x.trim() && !list.includes(x)) list.push(x)
  }
  return list
}

const cleanupCandidates = (minor, files, { root = '', touched = [] } = {}) =>
  (Array.isArray(minor) ? minor : []).filter(m => m.priority === 'P3' && m.category !== 'scope' && m.proposal !== true && inPerimeter(m.path, files, root) && !(m.causedByChange === false && !isTouched(m.path, touched, root)))

const readAnswers = resolution => (Array.isArray(resolution?.answers) ? resolution.answers : [])
  .filter(a => a && typeof a.text === 'string' && a.text.trim() && typeof a.answer === 'string' && a.answer.trim())
  .map(a => ({ text: a.text.trim(), answer: a.answer.trim() }))

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

const WATCHER = { key: 'S', agentType: 'code-reviewer', model: 'sonnet', effort: 'medium', whole: true }
const deltaReviewers = (everyone, finders = []) => {
  const has = new Set(everyone.map(r => r.key))
  const wanted = new Set(finders.flatMap(k => (has.has(k) ? [k] : everyone.filter(r => r.key[0] === k[0]).map(r => r.key))))
  const sonnet = everyone.find(r => r.whole && r.model === 'sonnet' && r.effort === 'medium')
  const list = everyone.filter(r => wanted.has(r.key) || r === sonnet)
  return sonnet ? list : [...list, WATCHER]
}
const findersOf = (finding, reviews, root) => (Array.isArray(reviews) ? reviews : []).filter(r => (r?.found ?? []).some(g => sameFinding(g, finding, root))).map(r => r.key)
// The size can change the panel under a key (A is a Sonnet high at M and L, the Opus is B at L): a key stands only while it names the same reviewer.
const finderKey = (raised, everyone) => {
  const same = r => r.agentType === raised.agentType && r.model === raised.model && r.effort === raised.effort
  if (!raised.model || everyone.some(r => r.key[0] === raised.key[0] && same(r))) return raised.key
  return [...everyone, WATCHER].find(same)?.key ?? raised.key
}

// The fix deltas each reader set saw: the final full read is owed only when a panel key missed one of them.
const finalReadOwed = (readers, panelKeys) => (Array.isArray(readers) ? readers : []).some(set => panelKeys.some(k => !set.has(k)))

// splice(-1, 1) would drop the last entry: an id that is not in the list removes nothing.
const removeById = (list, id) => {
  const at = list.findIndex(m => m.id === id)
  if (at >= 0) list.splice(at, 1)
  return at >= 0
}

// A file the snapshot reports as big becomes a P3 split proposal, once per path, never a finding to fix.
const growthProposals = big => {
  const seen = new Set()
  const out = []
  for (const b of Array.isArray(big) ? big : []) {
    if (!b || typeof b.file !== 'string' || !b.file.trim() || !Number.isFinite(b.start) || !Number.isFinite(b.now) || seen.has(norm(b.file))) continue
    seen.add(norm(b.file))
    out.push({
      source: 'growth', category: 'clean-code', priority: 'P3', proposal: true, path: b.file,
      title: `${b.file} is now ${b.now} lines (${b.start} at the start): propose a split`,
      why: b.now > 600 ? 'a file past 600 lines' : 'a file of 200 lines or more at the start that grew by 30% or more',
    })
  }
  return out
}

const findingsLog = ({ known = {}, tracked = {}, cleaned = [] } = {}) => Object.values(known)
  .filter(k => k.category !== 'verify')
  .map(k => ({ category: k.category, priority: k.priority, path: k.path, closed: tracked[k.id]?.status === 'closed' || cleaned.some(c => c.id === k.id) }))

// Only the user can widen the perimeter.
const classify = (f, files, { dirty = [], root = '', touched = [] } = {}) => {
  if (f.category === 'verify') return 'blocking'
  const inside = inPerimeter(f.path, files, root)
  if (isNeverBlocking(f)) return inside ? 'minor' : 'outOfScope'
  const scope = f.category === 'scope' && !isDirty(f.path, dirty, root)
  const priority = scope && !BLOCKING.has(f.priority) ? 'P2' : f.priority
  if (BLOCKING.has(priority) && (scope || inside)) return 'blocking'
  if (BLOCKING.has(priority) && f.category !== 'scope' && (f.causedByChange === true || isTouched(f.path, touched, root))) return 'widen'
  return inside ? 'minor' : 'outOfScope'
}

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

const recheckReviewers = ({ answers = [], reviewers = [], asked = {}, answeredBy = {} } = {}) => {
  const open = key => (asked[key] ?? []).filter(id => !answeredBy[id]?.length)
  const answeredAsked = id => reviewers.some((r, j) => answers[j] && (asked[r.key] ?? []).includes(id))
  return reviewers.filter((r, i) => (answers[i] ? open(r.key).length > 0 : open(r.key).some(id => !answeredAsked(id)))).map(r => r.key)
}

const idsToAsk = ({ tracked = {}, known = {}, lastFixFiles = [], skipped = [], root = '' } = {}) => {
  const live = id => tracked[id] && tracked[id].status !== 'accepted'
  if (skipped.length) return skipped.filter(live)
  return Object.keys(tracked).filter(id => live(id) && (tracked[id].status !== 'closed' || isTouched(known[id]?.path, lastFixFiles, root)))
}

// A rejection without `kind` is read from its free-text reason.
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
const strings = v => (Array.isArray(v) ? v.filter(x => typeof x === 'string' && x.trim()) : [])
const text = v => (typeof v === 'string' ? v.trim() : '')
const brief = text(input.brief)
const perimeter = input.perimeter ?? {}
const files = strings(perimeter.files)
const request = text(input.request)
const decisions = strings(input.decisions).map(d => d.trim())
const previewText = text(input.preview)
const repoRoot = text(input.repoRoot)
const inline = input.inline === true
const startHead = text(input.start?.head)
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
const implEffort = ['low', 'medium', 'high', 'xhigh', 'max'].includes(input.implementerEffort) ? input.implementerEffort : 'medium'
const implModel = ['haiku', 'sonnet', 'opus'].includes(input.implementerModel) ? input.implementerModel : undefined
const risk = riskAxes(input.risk, input.touches)
const resolutions = Array.isArray(input.resolutions) ? input.resolutions : []

const perimeterTextFor = (list, forWriter = true) => [
  `PERIMETER (the only files you may change): ${list.join(', ')}`,
  perimeter.behaviour ? `Behaviour in scope: ${perimeter.behaviour}` : '',
  perimeter.exclusions ? `Explicitly out of scope: ${perimeter.exclusions}` : '',
  forWriter ? 'Anything worth doing outside the perimeter is not touched: list it under noticed (title, path, why), one line each; Open questions holds only a guess you had to make and its alternative.' : '',
].filter(Boolean).join('\n')
const dirtyText = dirty.length
  ? `Already modified before the change started${startHead ? ` (HEAD ${startHead})` : ''}, the user's own work: ${dirty.join(', ')}. Never change or revert those files; an out-of-perimeter edit there is reported, never reverted.`
  : ''
const budgetText = calls => `TOOL BUDGET: at most ${calls} tool calls in total, the structured-output call included. Read selectively, stop exploring after about ${calls - 10} and return the structured result before the budget runs out: a partial result beats none, and a run that ends without it is lost.`
const decisionsText = decisions.length
  ? `Owner decisions (the owner's own words, binding; an edit of yours that would contradict one is not yours to make: list it under \`questions\`):\n${decisions.map(d => `- ${d}`).join('\n')}`
  : ''
const requestText = request
  ? `Owner request (verbatim):\n${request}\nJudge the change against BOTH the intent and the request: a point of the request that the intent drops or contradicts is a question for the owner, not a finding.`
  : ''
const ownerQuestionsText = request || decisions.length
  ? 'A hunk the owner\'s request or decisions asked for is never a "scope" finding. A brief that departs from the request, or an edit that contradicts one of the owner decisions, is no finding for the fixer: list it under `questions` as { text, default: what you would do, why }, never a finding for the fixer.'
  : ''
const answersText = at => {
  const list = resolutions.filter(r => Number(r?.round) < at).flatMap(readAnswers)
  return list.length ? `Owner answers so far (the owner's own words, binding; do not ask them again):\n${list.map(a => `- ${a.text} -> ${a.answer}`).join('\n')}` : ''
}
const LEAD = 'ok|okay|yes|sì|si|va bene(?: così)?|bene(?: così)?|perfetto|perfect|ottimo|looks good'
const PREVIEW_OK = new RegExp(`^\\s*(?:${LEAD})(?:[\\s,.;!-]+(?:${LEAD}|grazie|thanks?|thank you))*\\s*[.!]*\\s*$`, 'i')

// The agents start in the session's folder, which may be another repo.
const RULES = `REPOSITORY: ${repoRoot}. Every path in this prompt is relative to it; read and edit files only under it and run every command (verify, git, snapshot) with it as the working directory, never in your starting folder. You are a subagent: never ask the user anything. A decision you cannot make goes under Open questions. Never commit, push, apply a migration, deploy or write through an MCP server.`
const quote = s => `'${String(s).replace(/'/g, "''")}'`
const snapshotText = since => [
  'Last step, after the verify command and before the structured output: run this exactly with the PowerShell tool (the quoting of -Dirty is PowerShell\'s) and return the one JSON line it prints as `snapshot`, unchanged (the loop reads the files you changed from it):',
  ['pwsh -NoProfile -File ~/.claude/scripts/snapshot.ps1', `-Since ${since || startHead || 'HEAD'}`, startHead ? `-Start ${startHead}` : '', dirty.length ? `-Dirty ${quote(dirty.join(','))}` : ''].filter(Boolean).join(' '),
].join('\n')
// The implementer has no tool budget (its run is task-sized).
const writerTail = (budget, cleaning = false) => [
  input.stackSkill ? `Stack skill to load first: ${input.stackSkill}.` : '',
  input.verify ? `Verify with: ${input.verify}` : '',
  'Tests: while you work run only the test files your change touches (and the one you saw failing); run the verify command once, at the end, before reporting.',
  cleaning ? '' : 'Questions: a behaviour choice the owner would see (a contract, a default, an error policy) is not yours to make and not to guess: list it under `questions` as { text, default: what you would do, why }, and do the rest of the scope. An internal choice (naming, structure) is yours, not a question.',
  cleaning ? '' : 'Defaults: a non-trivial choice the brief did not state (a name or order the owner will see, a limit, a format) goes under `defaults` as { choice, alternative, path }: no question, no stall, the owner reads the list in the verdict. Only the weighty ones (what the owner sees or uses, a contract, data, a cost or risk, an owner decision) are `questions`; the rest of your choices are not reported.',
  RULES,
  budget ?? '',
  'Environment: when the verify fails for an environment reason (a missing file, tool or config), change no code for it: return verify.status fail and explain it in notVerified.',
  'Time: when the work is long, return the structured output before the turn budget runs out, with the work done so far and what is left under `openQuestions`: a partial report beats none, and a run that ends without it is lost.',
  'Return your report through the structured output: scope, files, evidence, verify {status, command, line}, snapshot as printed by the script, rejected, noticed, notVerified, openQuestions, remaining (the tasks or parts of the brief not done yet; empty when the work is complete).',
  snapshotText(lastTree),
]

const str = description => ({ type: 'string', ...(description ? { description } : {}) })
const arr = (items, description) => ({ type: 'array', items, ...(description ? { description } : {}) })
const obj = (required, properties) => ({ type: 'object', required, properties })
const QUESTION = obj(['text', 'default', 'why'], { text: str(), default: str('what you would do if not told otherwise'), why: str() })

const IMPLEMENTATION = obj(['scope', 'files', 'evidence', 'verify', 'snapshot', 'rejected', 'noticed'], {
  scope: str(),
  files: arr(str('absolute or repo-relative path of a file you changed')),
  evidence: str('the verify command and the output line that settles it, quoted; or why not run'),
  verify: obj(['status'], { status: { type: 'string', enum: VERIFY_STATUSES }, command: str('the verify command that ran'), line: str('the output line that settles it, quoted') }),
  snapshot: obj(['tree', 'files'], { tree: str(), files: arr(str()), churn: { type: 'integer' }, big: arr(obj(['file', 'start', 'now'], { file: str(), start: { type: 'integer' }, now: { type: 'integer' } }), 'as printed by the script') }),
  rejected: arr(obj(['id', 'reason'], {
    id: str(),
    reason: str(),
    kind: { type: 'string', enum: ['not-reproduced', 'wrong'], description: 'not-reproduced: you could not make the failure happen; wrong: you reproduced or read it and the finding is incorrect' },
  }), 'review findings you judged wrong or could not reproduce, left unchanged'),
  noticed: arr(obj(['title', 'path', 'why'], { title: str(), path: str(), why: str() }), 'things outside the request you saw and deliberately did not do (inside or outside the perimeter)'),
  notVerified: str(),
  remaining: arr(str(), 'tasks or parts of the brief not done yet, one line each; empty when the work is complete'),
  openQuestions: arr(str('a guess you had to make and its alternative, one line (out-of-perimeter proposals go under noticed)')),
  questions: arr(QUESTION, 'a behaviour choice the owner would see (never an internal one), left undecided: the run stops before review until it is answered'),
  defaults: arr(obj(['choice', 'alternative', 'path'], { choice: str(), alternative: str(), path: str() }), 'non-trivial choices the brief did not state, with the alternative: the owner reads them in the verdict (no stall)'),
})

const FINDING_IN = obj(['title', 'path', 'category', 'priority', 'failure'], {
  title: str(),
  path: str('repo-relative path of the anchor'),
  line: { type: 'integer' },
  category: { type: 'string', enum: ['correctness', 'regression', 'security', 'completeness', 'concurrency', 'performance', 'api-contract', 'convention', 'clean-code', 'scope'] },
  priority: { type: 'string', enum: ['P1', 'P2', 'P3'] },
  failure: str('inputs or state, then the wrong outcome'),
  fix: str(),
  causedByChange: { type: 'boolean', description: 'true when the change itself causes this defect, even outside the perimeter' },
  confidence: { type: 'string', enum: ['CONFIRMED', 'PLAUSIBLE'] },
  proposal: { type: 'boolean', description: 'true for a split proposal: a note for the closing table, never fixed' },
})

const REVIEW = obj(['previous', 'found', 'checked', 'filesReviewed'], {
  previous: arr(obj(['id', 'status'], { id: str(), status: { type: 'string', enum: ['closed', 'open'] }, note: str() }), 'one entry for EVERY previous finding id you were given, closed ones included'),
  found: arr(FINDING_IN, 'NEW defects only, never one that matches a previous id'),
  checked: str('passes run and what was read'),
  filesReviewed: arr(str(), 'every file you actually read'),
  questions: arr(QUESTION, 'for the owner, never for the fixer: the brief departs from the request, an edit contradicts an owner decision, or a hunk the owner asked for would be reverted; only when the answer changes behaviour, a public contract, data or security'),
  defaults: arr(obj(['choice', 'alternative', 'path'], { choice: str(), alternative: str(), path: str() }), 'an obvious choice you decided yourself instead of asking: the owner reads the list in the verdict (no stall)'),
})

const known = {}
const raisedBy = {}
const fixFiles = new Set()            // a cleanup pass is no review fix: its files are not here
const changed = new Set(inline ? strings(input.changed) : [])
const outOfScope = [], minor = [], cleaned = [], gaps = [], notes = [], noticed = [], proposals = [], defaults = [], rounds = [], failures = {}
let tracked = {}, nextId = 1, round = 0, nextV = 1, verifyOpen = [], lastReport = null
let lastFix = null, lastTree = '', lastReportTree = '', lastDelta = '', lastDeltaIsFix = false, lastDeltaBase = ''
let rejectionCounts = {}, challenged = {}, skipped = [], silent = {}
let unread = [], missing = new Set(), coverageRetried = false, cleanupDone = false, cleanupSent = []
let fixChurns = [], openCounts = [], afterFix = false
let nextRound = { only: null, coverage: false, final: false }
let finalReading = false, finalReadDone = false, round1Tree = ''
let fixReaders = [], lastFixIsReview = false, bigFiles = []   // fixReaders: per review fix, the panel keys that read its delta

const ask = async (prompt, opts) => {
  try { return await agent(prompt, opts) } catch (e) {
    failures[opts.label] = String(e?.message ?? e).slice(0, 200)
    log(`${opts.label}: agent failed: ${failures[opts.label]}`)
    return null
  }
}
const why = label => (failures[label] ? `: ${failures[label]}` : '')

// A declared dirty file is kept (the snapshot drops it) so the change's own edit of it is reviewed.
const takeFiles = r => {
  if (!Array.isArray(r.snapshot?.files)) return (r.files ?? []).forEach(f => changed.add(f))
  const declaredDirty = (r.files ?? []).filter(f => typeof f === 'string' && f && isDirty(f, dirty, repoRoot))
  const listed = [...r.snapshot.files.filter(f => typeof f === 'string' && f), ...declaredDirty]
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
  if (Array.isArray(r.snapshot?.big)) bigFiles = growthProposals(r.snapshot.big)
  takeNoticed(r)
}
const gateReport = (r, toFixHadVerify) => {
  const g = verifyGate({ report: r, verifyCmd: input.verify, toFixHadVerify, previous: lastReport?.verify.status, next: nextV })
  if (g.finding) { known[g.finding.id] = g.finding; nextV += 1; verifyOpen = [g.finding] }
  else if (g.status === 'pass') verifyOpen = []
  return g.stall
}
const absorb = r => {
  const stall = gateReport(r, false)
  takeReport(r)
  addNotes(r.openQuestions)
  return stall
}

const RESOLUTIONS = 'resolutions: [{ round, accept?: [ids], guidance?: "...", retry?: true, answers?: [{ text, answer }], widen?: ["path/or/dir/"] }]'
const RESUME_AGAIN = `Relaunch with the same args and resumeFromRunId, plus every resolution so far: ${RESOLUTIONS}.`
const answerResume = (at, first, tail = '') => `${first} Relaunch with resumeFromRunId and ALL the resolutions so far, adding { round: ${at}, answers: [{ text, answer }] } (in the same entry as that round's other resolution, if any), each text being the question's text unchanged (an answer whose text matches no question is ignored; while a question has no answer this stall comes back, so keep the answers already given in that entry): ${RESOLUTIONS}.${tail}`
const ASK_EACH = 'Ask the user each question (text, default, why), with your recommendation; when the user said not to be asked, apply every default and list it as an open decision in the closing table.'
const RESUME_FRESH = 'Relaunch with the same args WITHOUT resumeFromRunId: a resume replays the cached implementer report and stalls again.'
const stallAgain = (at, reason, extra = {}) => result({ status: 'STALL', stall: { round: at, findings: [], reason, ...extra }, resume: at === 0 ? RESUME_FRESH : RESUME_AGAIN })
const questionStall = (at, questions, reason, resume) => result({ status: 'STALL', stall: { round: at, why: 'question', findings: [], questions, reason }, resume })
const verifyStall = (at, s) => result({
  status: 'STALL',
  stall: { round: at, why: s.why, findings: verifyOpen.map(v => ({ id: v.id, why: s.why, ...v })), reason: s.reason },
  resume: `Ask the user: a different approach, a direction for the fixer, or no verify command. Relaunch with resumeFromRunId and ALL the resolutions so far, adding { round: ${at}, guidance: "..." } (retry alone replays the cached fixer report and stalls again); a stall at round 0 replays the cached implementer report: relaunch WITHOUT resumeFromRunId.`,
})
const verifyText = () => (lastReport
  ? `Verify (run by the implementer): \`${lastReport.verify.command ?? input.verify ?? '(no command reported)'}\` → ${lastReport.verify.status}${lastReport.verify.line ? `: ${lastReport.verify.line}` : ''}`
  : '')

const withHistory = r => (r.stall ? { ...r, stall: { ...r.stall, history: findingHistory(rounds) } } : r)
const sameText = (a, b) => !!plain(a) && plain(a) === plain(b)
const result = extra => withHistory({
  rounds: round,
  open: [...Object.keys(tracked).filter(id => tracked[id].status === 'open').map(id => known[id]), ...verifyOpen],
  accepted: Object.keys(tracked).filter(id => tracked[id].status === 'accepted').map(id => known[id]),
  outOfScope: [...notes.filter(q => !noticed.some(n => sameText(q.text, n.title) || sameText(q.text, n.why))), ...noticed, ...outOfScope, ...proposals, ...bigFiles],
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

const addNotes = qs => (qs ?? []).forEach(q => { if (!notes.some(n => sameText(n.text, q))) notes.push({ source: 'implementer', text: q }) })
const addQuestionNotes = qs => qs.forEach(q => notes.push({ source: 'implementer', text: `${q.text} (default: ${q.default ?? 'none given'}${q.why ? `; ${q.why}` : ''})` }))
const answersBlock = answers => `The owner answered your questions: apply each answer. Your first run's edits are already in the tree: continue from them, do not start over, and list in \`files\` only the files you change in this run.\n${answers.map(a => `- ${a.text} -> ${a.answer}`).join('\n')}`
// The first run is not a report: its tree stays the next -Since, so the delta keeps both runs.
const askWithQuestions = async (build, opts, at, resolution) => {
  const first = readReport(await ask(build(''), opts))
  if (!first?.questions.length) return { report: first }
  // The P3 cleanup never stops the run for the owner.
  if (opts.label.startsWith('cleanup')) {
    addQuestionNotes(first.questions)
    return { report: { ...first, questions: [] } }
  }
  const answers = readAnswers(resolution).filter(a => first.questions.some(q => plain(q.text) === plain(a.text)))
  const pending = first.questions.filter(q => !answers.some(a => plain(a.text) === plain(q.text)))
  if (pending.length) {
    return { stall: questionStall(at, pending, `${opts.label} left ${pending.length} behaviour question(s) for the owner: ${pending.map(q => q.text).join(' | ')}`, answerResume(at, ASK_EACH)) }
  }
  takeNoticed(first)
  takeDefaults(first)
  addNotes(first.openQuestions)
  const second = readReport(await ask(build(answersBlock(answers)), { ...opts, label: `${opts.label} (answers)` }))
  addQuestionNotes(second?.questions ?? [])
  if (!second) return { report: second }
  // First-run rejections stay in the report (the ids count as rejected) but are no CHALLENGE when the second run changed their file.
  const carried = first.rejected.filter(r => !second.rejected.some(s => s?.id === r?.id))
  const stale = new Set(carried.filter(r => isTouched(known[r?.id]?.path, second.files, repoRoot)).map(r => r?.id))
  const merged = [...new Set([...(Array.isArray(first.files) ? first.files : []), ...(Array.isArray(second.files) ? second.files : [])])]
  return { report: { ...second, files: merged, rejected: [...second.rejected, ...carried] }, stale }
}

// An implementer that stopped without a report may still have changed the tree: the files in the perimeter go to review.
const recoverChanges = async () => {
  const since = startHead || 'HEAD'
  const skip = dirty.length ? `, minus the files already modified before the start (${dirty.join(', ')}; an entry ending with "/" is a whole directory)` : ''
  const r = await ask([
    `List the files changed in the working tree since ${since}: \`git diff ${since} --name-only\` plus \`git ls-files -o --exclude-standard\`${skip}. Read only, change nothing; return them in \`files\`.`,
    RULES,
  ].join('\n\n'), { label: 'find the files to change', phase: 'Implement', agentType: 'Explore', schema: obj(['files'], { files: arr(str('repo-relative path')) }) })
  return strings(r?.files).filter(f => inPerimeter(f, files, repoRoot))
}

if (!inline) {
  phase('Implement')
  const implOpts = { label: 'implement the change', phase: 'Implement', agentType: 'implementer', effort: implEffort, ...(implModel && { model: implModel }), schema: IMPLEMENTATION }
  const buildImpl = extra => [brief, extra, decisionsText, perimeterTextFor(files), dirtyText, ...writerTail()].filter(Boolean).join('\n\n')
  const resolution0 = resolutions.find(r => Number(r?.round) === 0)
  const asked0 = await askWithQuestions(buildImpl, implOpts, 0, resolution0)
  if (asked0.stall) return asked0.stall
  let impl = asked0.report
  // A partial run is never reviewed: the implementer continues from its own edits (its -Since stays the start tree, so the delta covers every run).
  let continuations = 0
  // The implementer stops itself at 20 turns: a fresh one continues with a clean context, cheaper than one long run.
  while ((!impl || impl.remaining.length) && continuations < 4) {
    if (impl) { takeNoticed(impl); takeDefaults(impl); addNotes(impl.openQuestions) }
    continuations += 1
    const left = impl?.remaining ?? []
    const label = `implement the change (continued, ${continuations})`
    const next = readReport(await ask(buildImpl([
      'Your previous run stopped before finishing. The tree already holds its edits: continue from them, do not start over; first check what is done (`git diff`), then do what is left.',
      left.length ? `Left to do, by your own report:\n${left.map(s => `- ${s}`).join('\n')}` : '',
    ].filter(Boolean).join('\n')), { ...implOpts, label }))
    if (next) addQuestionNotes(next.questions)
    impl = next ?? impl
  }
  if (!impl || impl.remaining.length) {
    // A report lists its own files; only a missing one needs the probe.
    const done = impl ? strings(impl.files) : await recoverChanges()
    const todo = impl?.remaining ?? []
    return result({
      status: 'STALL',
      stall: {
        round: 0,
        why: 'incomplete',
        findings: [],
        reason: `the implementer did not finish after ${continuations} continuation(s): ${todo.length ? `left to do: ${todo.join(' | ')}` : `it returned no report (stopped or failed${why(`implement the change (continued, ${continuations})`)})`}${done.length ? `. Files already changed in the perimeter: ${done.join(', ')}` : ''}`,
      },
      resume: 'Relaunch with the same args WITHOUT resumeFromRunId (a resume replays the cached implementer reports), with a smaller scope (split the plan into sequential runs) or a higher implementerEffort; the edits already in the tree are kept.',
    })
  }
  const implStall = absorb(impl)
  if (implStall) return verifyStall(0, implStall)

  if (previewText && sizeFor(givenSize, risk) !== 'S') {
    const previewQuestion = {
      text: `Preview: show the owner ${previewText} (a screenshot or a sample of the output) and ask whether it is right; "ok" goes on to the review, any other answer is a direction for one more implementer pass`,
      default: 'ok',
      why: 'the owner sees or uses this output: better to confirm it before the review spends its tokens',
    }
    const said = readAnswers(resolution0).find(a => plain(a.text) === plain(previewQuestion.text))
    if (!said) {
      return questionStall(0, [previewQuestion], `the implementer is done: ${previewText} is to be shown to the owner before the review`,
        answerResume(0, `Take the screenshot or sample of ${previewText} and show it to the user with the question (text, default, why).`,
          ' A bare confirmation ("ok", "va bene", "perfetto", "ok grazie") goes on to the review; any other answer runs the implementer once more with it as its direction. The verdict carries a final screenshot of the same surface.'))
    }
    if (!PREVIEW_OK.test(said.answer)) {
      const again = readReport(await ask(buildImpl(answersBlock([said])), { ...implOpts, label: 'implement the change (preview feedback)' }))
      if (!again) return stallAgain(0, `the implementer returned nothing on the preview pass (stopped or failed${why('implement the change (preview feedback)')})`)
      addQuestionNotes(again.questions)
      const againStall = absorb(again)
      if (againStall) return verifyStall(0, againStall)
    }
  }
}

const everyId = () => idsToAsk({ tracked, known, lastFixFiles: finalReading ? [...fixFiles] : (lastFix?.files ?? []), skipped, root: repoRoot })
const askedIds = (r, groups) => (r.group === undefined ? everyId() : everyId().filter(id => groupOf(known[id].path, groups, repoRoot) === r.group))
const anchor = id => `${known[id].path}${known[id].line ? `:${known[id].line}` : ''}`
const previousBlock = (r, groups) => {
  const mineIds = askedIds(r, groups)
  const ids = mineIds.filter(id => !challenged[id])
  if (!everyId().length) {
    return Object.keys(tracked).length
      ? 'PREVIOUS FINDINGS: none to judge (the earlier ones are closed or accepted and the last fix did not touch them: give no verdict).'
      : 'PREVIOUS FINDINGS: none (first round: review the whole change).'
  }
  if (!ids.length) return mineIds.length
    ? 'PREVIOUS FINDINGS: none besides the CHALLENGE below (give a verdict for those ids only).'
    : 'PREVIOUS FINDINGS: none on your files (give no verdict).'
  const list = ids.map(id => `- ${id} [${tracked[id].status}] ${anchor(id)} - ${known[id].title}: ${known[id].failure}`)
  if (skipped.length) {
    const who = mineIds.length > ids.length ? 'for each of these ids and for each id of the CHALLENGE below' : 'for each of these ids only'
    return `PREVIOUS FINDINGS you skipped last round (give a verdict, closed or open, ${who}; an id you skip again stalls the loop):\n${list.join('\n')}`
  }
  return `PREVIOUS FINDINGS (give a verdict, closed or open, for EVERY id listed; a closed one that is back is open; an id you skip is asked again):\n${list.join('\n')}`
}
const challengeBlock = (mine = () => true) => {
  const list = Object.keys(challenged).filter(mine).map(id => `- ${id} [${known[id].priority}] ${anchor(id)} - ${known[id].title}: ${known[id].failure} | the fixer's reason: ${challenged[id].reason}`)
  return list.length
    ? `CHALLENGE (the fixer rejected these findings and left the code unchanged: judge each one yourself, reading the code and reproducing the failure when you can; give a verdict for each id in previous: closed = you withdraw it, open = you keep it, and put why in note; a "not reproduced" you can reproduce is kept, with the steps):\n${list.join('\n')}`
    : ''
}

const touchedByGit = () => `Find the files the change touched yourself: \`git diff ${startHead || 'HEAD'} --name-only\` plus the untracked files (\`git ls-files -o --exclude-standard\`)${dirty.length ? `, minus the files already modified before the start (${dirty.join(', ')}; an entry ending with "/" is a whole directory), except that a file in both is reviewed for the change's own edit only` : ''}. The list ${inline ? 'the session' : 'the implementer'} declared (${[...changed].join(', ') || 'none'}) is a hint, never the limit of the review.`

const reviewersForRound = () => {
  const seen = new Map()
  for (const f of changed) { const k = rel(f, repoRoot); if (!seen.has(k)) seen.set(k, f) }
  const expected = [...seen.values()]
  const groups = groupFiles(expected)
  const size = sizeFor(givenSize, risk)
  const signal = sizeSignal(size, seen.size)
  if (signal && !gaps.includes(signal)) gaps.push(signal)
  const reviewers = reviewersFor(size, risk)
  const [first, ...rest] = reviewers
  if (groups.length < 2) return { size, groups, list: reviewers, expected }
  return { size, groups, expected, list: [...groups.map((g, i) => ({ ...first, key: `A${i + 1}`, group: i, whole: false })), ...rest] }
}
const shareText = (r, groups) => (r.group === undefined ? '' : [
  `Your share: review ONLY these files, the other reviewers hold the rest (this overrides the "hint" rule above): ${groups[r.group].join(', ')}.`,
  r.group === groups.length - 1 ? 'You also own any touched file git lists that is not in the declared list.' : '',
].filter(Boolean).join(' '))

const scopeOfChange = () => `Review the change made${startHead ? ` since commit ${startHead}` : ' since the start'}. ${touchedByGit()}`
const scopeOfFinal = () => {
  const cmd = deltaCommand(round1Tree || startHead || 'HEAD', lastTree, startHead)
  return `FINAL FULL READ: the fixes of this run are done and the panel reads everything they changed since round 1, as one change, judging each previous finding by reading the code as it is now. Files the fixes changed: ${[...fixFiles].join(', ') || '(none reported)'}.${cmd ? ` ${round1Tree ? `The cumulative fix diff is \`${cmd}\`` : `No tree of round 1 exists (no snapshot before the first fix): \`${cmd}\` is the WHOLE change since the start, not only the fixes`} (the trees are snapshots of the working tree, untracked files included): run it first.` : ''}\n${touchedByGit()}`
}
const scopeOfDelta = () => {
  if (!lastFix) return scopeOfChange()
  const since = `changes since ${lastDeltaBase || startHead || 'HEAD'}`
  const fromHead = lastDelta && !lastDeltaIsFix   // the delta starts before the report that preceded the fix: it is not the fix alone
  return `Review the ${fromHead ? since : 'DELTA of the last fix'}, judging each previous finding by reading the code as it is now. Files the fix changed: ${(lastFix.files ?? []).join(', ') || '(none reported)'}.${lastDelta ? ` The ${fromHead ? `${since} are` : 'DELTA of the last fix is'} \`${lastDelta}\` (the trees are snapshots of the working tree, untracked files included): run it first.` : ''} What the fix says it did: ${lastFix.scope}\n${touchedByGit()}`
}
// The coverage rerun gives the rest of the unread files to their group reviewers.
const scopeOfReview = (r, groups) => {
  if (missing.has(r.key) && r.group === undefined && !r.whole) return scopeOfChange()
  const full = r.group !== undefined ? groups[r.group].filter(f => unread.includes(f)) : r.whole ? unread.slice(0, MAX_REVIEW_FILES) : []
  return (finalReading ? scopeOfFinal() : scopeOfDelta()) + (full.length ? `\nThese files have never been reviewed: review them IN FULL, as changed since ${startHead ? `commit ${startHead}` : 'the start'}, not just the delta: ${full.join(', ')}.` : '')
}

while (true) {
  round += 1
  phase('Review')
  const { size, groups, list: everyone, expected } = reviewersForRound()
  const { only, coverage, final } = nextRound
  nextRound = { only: null, coverage: false, final: false }
  finalReading = final
  if (round === 1) round1Tree = lastTree
  const finders = [...new Set(Object.keys(tracked).filter(id => tracked[id].status === 'open').flatMap(id => (raisedBy[id] ?? []).map(r => finderKey(r, everyone))))]
  const picked = only ? [...everyone, WATCHER].filter(r => only.includes(r.key))
    : round === 1 || final ? everyone
    : deltaReviewers(everyone, cleanupSent.length ? [...missing] : [...finders, ...missing])
  const reviewers = picked.length ? picked : everyone
  // What the owner reads in the agent list: which reviewer, its round, then its job; never the model or effort.
  const roleOf = r => (r.agentType === 'review-security' ? 'security' : r.agentType === 'review-performance' ? 'performance' : r.key === WATCHER.key ? 'check the fixes' : r.key === 'B' ? 'second opinion' : 'code')
  const labelOf = r => `reviewer ${r.key} · round ${round}${roleOf(r) === r.key ? '' : ` · ${roleOf(r)}`}${r.group === undefined ? '' : `, files ${r.group + 1}/${groups.length}`}${final ? ', final read' : ''}`
  const askedMap = Object.fromEntries(reviewers.map(r => [r.key, askedIds(r, groups)]))
  // Asked with the perimeter as it was BEFORE this round's resolution: a resume replays identical prompts.
  const reviewPerimeter = perimeterTextFor(widenedFiles(files, resolutions, round - 1), false)
  const answers = await parallel(reviewers.map(r => () => ask([
    scopeOfReview(r, groups),
    shareText(r, groups),
    `Intent: ${brief}`,
    round === 1 || final ? requestText : '',
    decisionsText,
    answersText(round),
    ownerQuestionsText,
    verifyText(),
    reviewPerimeter,
    dirtyText,
    'Perimeter rule: any hunk the brief does not require, even inside a perimeter file, is a finding with category "scope" (priority P2), and so is every changed line outside the perimeter in the files the change touched; except in a file already modified before the start (reported as a normal finding, never "scope"). A defect in a file the change did not touch is a normal finding; it is reported, not fixed. A P1/P2 defect outside the perimeter that this change causes: set causedByChange to true.',
    `Effort: ${r.effort}. ${size === 'L' && r.key.startsWith('A') ? 'You may be one of two reviewers on different models with this same brief: do not soften for agreement.' : ''}`,
    previousBlock(r, groups),
    challengeBlock(r.group === undefined ? undefined : id => groupOf(known[id].path, groups, repoRoot) === r.group),
    'Questions: return one only when the answer changes behaviour, a public contract, data or security; an obvious choice you decide yourself and list under `defaults` as { choice, alternative, path }: never a question.',
    `${RULES} Report only P1/P2/P3 findings with a concrete failure; return the structured output: a verdict for every previous id, the new findings apart, and under filesReviewed list every file you actually read.`,
    budgetText(35),
  ].filter(Boolean).join('\n\n'), { label: labelOf(r), phase: 'Review', agentType: r.agentType, model: r.model, effort: r.effort, schema: REVIEW })))
  const alive = answers.map((a, i) => (a ? { ...readReport(a), key: reviewers[i].key } : null)).filter(Boolean)
  alive.forEach(takeDefaults)
  if (lastFix && lastFixIsReview && !final && fixReaders.length) alive.forEach(a => fixReaders[fixReaders.length - 1].add(a.key))
  answers.forEach((a, i) => { if (!a) gaps.push(`round ${round}: reviewer ${reviewers[i].key} returned nothing${why(labelOf(reviewers[i]))}`) })
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
  if (!alive.length) {
    return coverage
      ? stallAgain(round, `no reviewer read these files (their reviewer returned nothing again): ${unread.join(', ')}`, { why: 'gap', files: unread })
      : stallAgain(round, 'no reviewer answered: nothing can be concluded')
  }

  const merged = mergeReviews(alive, repoRoot)
  // The reviewers' questions are for the owner, never the fixer.
  const routed = routeQuestions({ questions: reviewerQuestions(alive), resolutions, round })
  if (routed.pending.length) {
    return questionStall(round, routed.pending, `the reviewers left ${routed.pending.length} question(s) for the owner: ${routed.pending.map(q => q.text).join(' | ')}`,
      answerResume(round, ASK_EACH, ' The answers go to the fixer and to the later reviewers.'))
  }
  // An id whose file is still unread waits for the round that reads it.
  const cleanupWait = []
  for (const id of cleanupSent) {
    if (isTouched(known[id].path, unread, repoRoot)) { cleanupWait.push(id); continue }
    if (merged.found.some(g => sameFinding(g, known[id], repoRoot))) continue
    removeById(minor, id)
    cleaned.push(known[id])
  }
  cleanupSent = cleanupWait
  const deduped = dedupeFound({ found: merged.found, known, tracked, verdicts: merged.verdicts, root: repoRoot })
  const found = deduped.found.map(f => ({ ...f, id: `F${nextId++}` }))
  found.forEach(f => { known[f.id] = f; raisedBy[f.id] = findersOf(f, alive, repoRoot).map(k => { const r = reviewers.find(x => x.key === k); return { key: k, agentType: r?.agentType, model: r?.model, effort: r?.effort } }) })
  const resolution = resolutions.find(r => Number(r.round) === round)
  const roundFiles = widenedFiles(files, resolutions, round)
  const asked = challenged   // the challenges this decision judges; `challenged` below keeps only the unanswered ones
  const decision = decideRound({
    tracked, verdicts: deduped.verdicts, found, files: roundFiles, dirty, root: repoRoot, touched: [...changed], resolution, silent,
    challenged: Object.keys(asked), rejections: rejectionCounts, notReproduced: Object.keys(asked).filter(id => asked[id].notReproduced),
  })
  tracked = decision.tracked
  silent = decision.silent
  challenged = Object.fromEntries(Object.entries(asked).filter(([id]) => decision.unanswered.includes(id)))
  const vIds = verifyOpen.map(v => v.id)
  const action = (vIds.length || routed.answered.length) && (decision.action === 'DONE' || decision.action === 'RECHECK') ? 'FIX' : decision.action
  const toFix = action === 'FIX' ? [...vIds, ...decision.toFix] : decision.toFix
  skipped = action === 'RECHECK' ? decision.unanswered : []
  decision.minor.forEach(id => minor.push(known[id]))
  decision.outOfScope.forEach(id => outOfScope.push({ source: 'review', ...known[id], ...(resolution?.accept?.includes(id) ? { accepted: true } : {}) }))
  if (decision.unanswered.length) gaps.push(`round ${round}: no verdict for ${decision.unanswered.join(', ')}, asked again`)
  // Read after the reviewers have read the last fix; guidance or retry is the owner's "different approach".
  const churnHit = action === 'FIX' && churnGrowing(fixChurns)
  const redirected = !!resolution?.guidance || resolution?.retry === true
  const openNow = Object.values(tracked).filter(t => t.status === 'open').length + verifyOpen.length
  if (resolution?.guidance || resolution?.accept?.length) { openCounts = []; afterFix = false }
  if (afterFix && !decision.unanswered.length) { openCounts.push(openNow); afterFix = false }
  const stuckHit = action === 'FIX' && !churnHit && notConverging(openCounts)
  const stopWhy = churnHit ? 'churn' : stuckHit ? 'not-converging' : ''
  const stopped = !!stopWhy && !redirected
  let cleanupIds = []
  rounds.push({ round, size, reviewers: alive.length, new: found.filter(f => tracked[f.id]).map(f => f.id), rematched: deduped.rematched, closed: decision.closed, toFix: stopped ? [] : toFix, stalled: decision.stalled, unanswered: decision.unanswered, churn: null, ...(final ? { final: true } : {}) })
  log(`Round ${round}: ${found.length} new, ${decision.closed.length} closed, ${toFix.length} to fix, ${decision.stalled.length} stalled, ${decision.unanswered.length} unanswered`)

  if (action === 'DONE') {
    if (missing.size) {
      const keys = [...missing]
      return stallAgain(round, `the specialist reviewer(s) ${keys.join(', ')} returned nothing: their area was never reviewed`, { why: 'gap', reviewers: keys })
    }
    const cover = coverageAction({ unread, retried: coverageRetried })
    if (cover === 'stall') return stallAgain(round, `no reviewer read these files (a second run of their reviewer did not either): ${unread.join(', ')}`, { why: 'gap', files: unread })
    if (cover === 'rerun') {
      nextRound = { only: coverageOwners(unread, everyone, groups, repoRoot), coverage: true }
      coverageRetried = true
      openCounts = []
      continue
    }
    // The 0 of a DONE is no bar for later fix cycles.
    if (!finalReadDone && fixFiles.size && size !== 'S' && finalReadOwed(fixReaders, everyone.map(r => r.key)) && (fixChurns.length < fixReaders.length || fixChurns.reduce((n, c) => n + c, 0) > FINAL_READ_MIN_CHURN)) {
      finalReadDone = true
      nextRound = { only: null, coverage: false, final: true }
      openCounts = []
      continue
    }
    if (!cleanupDone && size !== 'S' && input.cleanup === true) cleanupIds = cleanupCandidates(minor, roundFiles, { root: repoRoot, touched: [...changed] }).map(m => m.id)
    if (!cleanupIds.length) return result({ status: 'OK' })
    cleanupDone = true
    openCounts = []
    rounds[rounds.length - 1].cleanup = cleanupIds
  }
  if (stopped) {
    return result({
      status: 'STALL',
      stall: {
        round, why: stopWhy, findings: toFix.map(id => ({ id, why: stopWhy, ...known[id] })),
        reason: stopWhy === 'churn'
          ? `the fixes change more each time (${fixChurns.slice(-3).join(', ')} lines): they are not converging`
          : `the open P1/P2 count after each fix round (${openCounts.join(', ')}) did not drop below its lowest in 3 fix rounds in a row: the fixes are not converging`,
      },
      resume: `Ask the user: accept the risk or a different approach. Relaunch with resumeFromRunId and ALL the resolutions so far, adding { round: ${round}, accept: [ids] } to accept the risk (the reviewers of this round have already read the last fix), or { round: ${round}, guidance: "..." } / { round: ${round}, retry: true } for another attempt: ${RESOLUTIONS}.`,
    })
  }
  if (action === 'STALL') {
    return result({
      status: 'STALL',
      stall: { round, findings: decision.stalled.map(s => ({ ...s, ...known[s.id], ...(asked[s.id] ? { rejected: asked[s.id].reason, reviewerNote: merged.notes[s.id] } : {}) })) },
      resume: `Ask the user: accept the risk, one more round, or a different approach; a "widen" finding asks to add its file to the perimeter (only on the user's yes: the session then rewrites perimeter.md with perimeter.ps1 -Files) or to accept it as out of scope. Relaunch with resumeFromRunId and ALL the resolutions so far: ${RESOLUTIONS}.`,
    })
  }
  if (action === 'RECHECK') {
    const stuck = Object.fromEntries(Object.entries(askedMap).map(([key, ids]) => [key, ids.filter(id => decision.unanswered.includes(id))]))
    nextRound = { only: recheckReviewers({ answers, reviewers, asked: stuck, answeredBy: merged.answeredBy }), coverage: false }
    continue
  }

  phase('Fix')
  const cleaning = cleanupIds.length > 0
  const sending = cleaning ? cleanupIds : toFix
  const unproven = id => !cleaning && known[id].confidence === 'PLAUSIBLE'
  const withRevert = id => known[id].category !== 'scope' && !inPerimeter(known[id].path, roundFiles, repoRoot) && sending.some(o => known[o]?.category === 'scope' && rel(known[o].path, repoRoot) === rel(known[id].path, repoRoot))
  const fix = sending.map(id => `- ${id} [${known[id].priority}] ${anchor(id)} - ${known[id].title}: ${known[id].failure}${known[id].fix ? ` (suggested: ${known[id].fix})` : ''}${unproven(id) ? ' (PLAUSIBLE: REPRODUCE FIRST)' : ''}${withRevert(id) ? ' (outside the perimeter: revert the hunk of this file; this defect should disappear with it, do not edit anything else there)' : ''}${decision.kept.includes(id) ? ` (you rejected this finding and the reviewer kept it${merged.notes[id] ? `: ${merged.notes[id]}` : ''}; reproduce it, then fix it)` : ''}`).join('\n')
  // `cleanup` stays the label's first word: askWithQuestions reads it.
  const fixOpts = { label: cleaning ? `cleanup of round ${round} minor findings` : `fix round ${round} findings`, phase: 'Fix', agentType: 'implementer', effort: implEffort, ...(implModel && { model: implModel }), schema: IMPLEMENTATION }
  const asked1 = await askWithQuestions(extra => [
    cleaning
      ? 'Cleanup pass, once: these minor review findings (P3) are inside the perimeter. Fix each one that is a safe, local change and nothing else; one you cannot fix without changing behaviour, or that needs a decision, goes under `rejected` with a one-line reason, no code change: never ask about it. No other edit.'
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
    cleaning ? decisionsText.replace(/: list it under `questions`/, ': skip it under `rejected`') : decisionsText,
    answersText(round),
    !cleaning && decisions.length ? 'A hunk an owner decision asked for is not reverted, whatever the finding says: list it under `questions` as { text, default, why }.' : '',
    perimeterTextFor(roundFiles),
    dirtyText,
    ...writerTail(budgetText(80), cleaning),
  ].filter(Boolean).join('\n\n'), fixOpts, round, resolution)
  if (asked1.stall) return asked1.stall
  const fixed = asked1.report
  if (!fixed) return stallAgain(round, `the implementer returned nothing on the fix (stopped or failed${why(fixOpts.label)})`)
  const fixStall = gateReport(fixed, vIds.length > 0 && !resolution?.guidance && resolution?.retry !== true)
  const treeBefore = lastTree
  lastDeltaIsFix = !!lastReportTree
  lastDeltaBase = treeBefore || startHead || 'HEAD'
  takeReport(fixed)
  lastDelta = deltaCommand(treeBefore, fixed.snapshot?.tree ?? '', startHead)
  const rejectedIds = new Set(fixed.rejected.map(r => r?.id))
  sending.filter(id => known[id]?.category === 'scope' && !rejectedIds.has(id)).forEach(id => {
    if (!proposals.some(p => p.path === known[id].path && p.title === known[id].title)) proposals.push({ source: 'scope-revert', title: known[id].title, path: known[id].path, why: known[id].failure })
  })
  const ledger = rejectionLedger({ rejected: fixed.rejected.filter(r => sending.includes(r?.id) && tracked[r.id]?.status === 'open' && !asked1.stale?.has(r.id)), counts: rejectionCounts })
  rejectionCounts = ledger.counts
  for (const c of ledger.challenge) challenged[c.id] = { reason: c.reason, count: c.count, notReproduced: ledger.notReproduced.includes(c.id) }
  lastFix = fixed
  lastFixIsReview = !cleaning
  if (!cleaning) fixReaders.push(new Set())
  if (!cleaning) (Array.isArray(fixed.files) ? fixed.files : []).forEach(f => fixFiles.add(f))
  addNotes(fixed.openQuestions)
  if (cleaning) cleanupSent = cleanupIds.filter(id => !rejectedIds.has(id))
  if (fixStall) return verifyStall(round, fixStall)
  if (!cleaning) {
    afterFix = true
    const churn = fixed.snapshot?.churn
    if (Number.isFinite(churn)) {
      fixChurns.push(churn)
      rounds[rounds.length - 1].churn = churn
    }
  }
}
