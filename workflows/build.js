export const meta = {
  name: 'build',
  description: 'Deterministic build: dependency waves of implementers, serial gate-runner verifies with one retry, a suite run, then up to 3 fresh-reviewer rounds with per-file fixes',
  whenToUse: 'A decided scope split into tasks. args: { tasks: [{ id, files: [paths], criteria: [Given/When/Then], verify: "<command>", dependsOn: [ids], size: S|M|L, risk: [axes], mechanical: bool, tdd: bool (default true), red: bool (tests already written and proven red in an earlier run: skips the tests-only step and the red check), redLine: string (its red line) }], testCmd, risk: [axes], repoRoot, request, done: [ids already delivered by an earlier run, the only dependsOn ids allowed outside tasks], doneFiles: [paths an earlier run changed, still reviewed and fixed], baseline: bool (default true: testCmd must be green before any change; a relaunch passes false) }',
  phases: [
    { title: 'Implement', detail: 'per wave: a tests-only implementer first (red, unless tdd false or mechanical), then the implementers; model per task: haiku low when mechanical, opus when a high-risk axis or size L, else sonnet; parallel when files are disjoint, serial when they overlap' },
    { title: 'Verify', detail: 'per wave: the red check (must fail), then each task verify run serially by a gate-runner; one retry on red' },
    { title: 'Suite', detail: 'testCmd through a gate-runner: once before any change (baseline: red stops the run), once after the waves; zero tests is never green' },
    { title: 'Review', detail: 'a fresh code-reviewer per round on the whole uncommitted diff, plus a second opus reviewer on the sensitive axes (data, money, contract, security) when the run has one, max 3 rounds; findings stay inside the change, the rest goes to outside[] and is never fixed' },
    { title: 'Fix', detail: 'one implementer per file with open items, then the suite again' },
  ],
}

// Fresh reviewer per round, criterion -> test map and kept test cases adapted from mikeleg/skills `factory` (MIT).

const input = args ?? {}
const ROUNDS_MAX = 3
const HIGH_RISK = ['data', 'security', 'contract', 'money', 'concurrency']
// A run on one of these axes gets a second reviewer per round.
const SENSITIVE = ['data', 'money', 'contract', 'security']
const RANK = { haiku: 0, sonnet: 1, opus: 2 }
const TIER = { haiku: { model: 'haiku', effort: 'low' }, sonnet: { model: 'sonnet', effort: 'medium' }, opus: { model: 'opus', effort: 'medium' } }

const validate = () => {
  const errors = []
  const nonEmpty = s => typeof s === 'string' && s.trim() !== ''
  const strings = a => Array.isArray(a) && a.length > 0 && a.every(nonEmpty)
  if (!nonEmpty(input.repoRoot)) errors.push('repoRoot must be a non-empty string')
  if (!nonEmpty(input.testCmd)) errors.push('testCmd must be a non-empty string')
  if (!nonEmpty(input.request)) errors.push('request must be a non-empty string')
  if (input.risk !== undefined && !(Array.isArray(input.risk) && input.risk.every(nonEmpty))) errors.push('risk must be an array of strings')
  if (input.done !== undefined && !(Array.isArray(input.done) && input.done.every(nonEmpty))) errors.push('done must be an array of id strings')
  if (input.doneFiles !== undefined && !(Array.isArray(input.doneFiles) && input.doneFiles.every(nonEmpty))) errors.push('doneFiles must be an array of path strings')
  if (input.baseline !== undefined && typeof input.baseline !== 'boolean') errors.push('baseline must be a boolean')
  if (!Array.isArray(input.tasks) || !input.tasks.length) return [...errors, 'tasks must be a non-empty array']
  const ids = new Set()
  for (const [i, t] of input.tasks.entries()) {
    const at = `tasks[${i}]`
    if (!t || !nonEmpty(t.id)) { errors.push(`${at}.id must be a non-empty string`); continue }
    if (ids.has(t.id)) errors.push(`${at}.id "${t.id}" is duplicated`)
    ids.add(t.id)
    if (!strings(t.files)) errors.push(`${at}.files must be a non-empty array of paths`)
    if (!strings(t.criteria)) errors.push(`${at}.criteria must be a non-empty array of strings`)
    if (!nonEmpty(t.verify)) errors.push(`${at}.verify must be a non-empty string`)
    if (t.dependsOn !== undefined && !(Array.isArray(t.dependsOn) && t.dependsOn.every(nonEmpty))) errors.push(`${at}.dependsOn must be an array of id strings`)
    if (t.size !== undefined && !['S', 'M', 'L'].includes(t.size)) errors.push(`${at}.size must be S, M or L`)
    if (t.risk !== undefined && !(Array.isArray(t.risk) && t.risk.every(nonEmpty))) errors.push(`${at}.risk must be an array of strings`)
    for (const k of ['mechanical', 'tdd', 'red']) if (t[k] !== undefined && typeof t[k] !== 'boolean') errors.push(`${at}.${k} must be a boolean`)
    if (t.redLine !== undefined && typeof t.redLine !== 'string') errors.push(`${at}.redLine must be a string`)
  }
  const doneIds = Array.isArray(input.done) ? input.done : []
  for (const d of doneIds) if (ids.has(d)) errors.push(`done "${d}" is also a task in this call`)
  for (const [i, t] of input.tasks.entries()) {
    for (const d of Array.isArray(t?.dependsOn) ? t.dependsOn.filter(nonEmpty) : []) if (!ids.has(d) && !doneIds.includes(d)) errors.push(`tasks[${i}].dependsOn "${d}" is not in this call or in done`)
  }
  return errors
}

const argErrors = validate()
if (argErrors.length) return { status: 'error', errors: argErrors }

const repoRoot = input.repoRoot.trim()
const request = input.request.trim()
const callIds = new Set(input.tasks.map(t => t.id))
// A dependency id absent from this call is valid only when listed in args.done (finished in an earlier run): treated as done.
const assumedDone = []
const tasks = input.tasks.map(t => {
  const deps = t.dependsOn ?? []
  for (const d of deps.filter(d => !callIds.has(d))) {
    log(`${t.id}: dependency ${d} is not in this call, treated as already done`)
    if (!assumedDone.includes(d)) assumedDone.push(d)
  }
  return { ...t, dependsOn: deps.filter(d => callIds.has(d)) }
})
const byId = new Map(tasks.map(t => [t.id, t]))

// Waves: a task sits one level after its deepest dependency. A cycle never gets a level.
const waves = []
{
  const level = new Map()
  let pending = tasks.slice()
  while (pending.length) {
    const next = pending.filter(t => t.dependsOn.every(d => level.has(d)))
    if (!next.length) return { status: 'error', errors: [`dependsOn cycle among: ${pending.map(t => t.id).join(', ')}`] }
    for (const t of next) {
      const l = Math.max(-1, ...t.dependsOn.map(d => level.get(d))) + 1
      level.set(t.id, l)
      ;(waves[l] ??= []).push(t)
    }
    pending = pending.filter(t => !level.has(t.id))
  }
}

const state = Object.fromEntries(tasks.map(t => [t.id, 'pending']))
const stops = []
const changed = new Set()

const GATE = {
  type: 'object',
  required: ['exitCode', 'noTests', 'line'],
  properties: {
    exitCode: { type: 'integer', description: 'the exit code the command returned, zero or not (a compile error is a non-zero code); -1 only when it did not finish: a tool error, a timeout, killed' },
    noTests: { type: 'boolean', description: 'true when the output says no test matched or zero tests ran' },
    line: { type: 'string', description: 'the deciding output line, verbatim' },
  },
}
// 125-127: the shell could not run the command (not found, not executable), so it is no result.
const verdict = (exitCode, noTests, line) => {
  const ran = Number.isInteger(exitCode) && exitCode >= 0 && ![125, 126, 127].includes(exitCode)
  // Zero tests is never green: noTests is set only when a test runner said so, never for a build or a lint.
  return { exitCode, noTests, line, ran, green: ran && exitCode === 0 && !noTests }
}
const REVIEW = {
  type: 'object',
  required: ['findings', 'criteriaMap', 'lostTests'],
  properties: {
    findings: { type: 'array', items: { type: 'object', required: ['priority', 'file', 'summary'], properties: { priority: { type: 'string', enum: ['P1', 'P2', 'P3'] }, file: { type: 'string' }, line: { type: 'number' }, summary: { type: 'string' }, causedByChange: { type: 'boolean', description: 'true when this diff introduced the defect, e.g. a caller broken by a changed signature' } } } },
    outside: { type: 'array', items: { type: 'string', description: '`file:line — what`: a defect already there, in code the change does not touch, or an improvement nobody asked for' } },
    criteriaMap: { type: 'array', items: { type: 'object', required: ['task', 'criterion', 'gap'], properties: { task: { type: 'string' }, criterion: { type: 'string' }, test: { type: 'string', description: 'test title or file that covers it' }, gap: { type: 'boolean', description: 'true when no test covers the criterion' }, file: { type: 'string', description: 'file where the missing test belongs' } } } },
    lostTests: { type: 'array', items: { type: 'object', required: ['file', 'test'], properties: { file: { type: 'string' }, test: { type: 'string', description: 'existing test case removed or weakened' }, note: { type: 'string' } } } },
  },
}

const RULES = [
  'Never ask the user: if a decision is needed, change nothing more and reply `STOP: <question>`.',
  'A test you change keeps every case it covered.',
  'Edit in place; never commit, push or switch branch. Report in 10 lines or fewer.',
]
// A crashed or empty implementer is a stop, never a success. STOP may sit behind a list, quote, bold or code marker.
const stopOf = r => {
  if (r == null) return 'implementer returned nothing'
  if (typeof r !== 'string') return null
  const m = r.match(/^\s*(?:[-*>][ \t]*)?(?:\*\*|`)?STOP:(?:\*\*|`)?[ \t]*(.*)$/m)
  return m ? (m[1].trim() || 'unspecified') : null
}
// `/c/x` (Git Bash) is `c:/x`; the root is stripped case-insensitively, and `key` is the case-folded form for membership.
const drive = p => p.replace(/\\/g, '/').replace(/^\/([a-zA-Z])\//, '$1:/')
const rootRel = drive(repoRoot).replace(/\/+$/, '').toLowerCase() + '/'
const norm = f => {
  const p = drive(String(f))
  return (p.toLowerCase().startsWith(rootRel) ? p.slice(rootRel.length) : p).replace(/^(\.\/)+/, '')
}
const key = f => norm(f).toLowerCase()
const implement = (label, phaseName, lines, tier = TIER.sonnet) => agent(
  [`Repository: ${repoRoot}`, `Request: ${request}`, ...lines, ...RULES].join('\n'),
  { label, phase: phaseName, agentType: 'implementer', ...tier },
).catch(() => null)
// One table for the model: mechanical -> haiku; a high-risk axis (the task's own, else the call's) or size L -> opus; else sonnet.
const isHigh = t => (t.risk ?? input.risk ?? []).some(a => HIGH_RISK.includes(a)) || t.size === 'L'
const pick = t => (t.mechanical ? TIER.haiku : isHigh(t) ? TIER.opus : TIER.sonnet)
const floor = (input.risk ?? []).some(a => HIGH_RISK.includes(a)) ? TIER.opus : TIER.sonnet
const fixTier = file => tasks.filter(t => state[t.id] === 'done' && t.files.map(key).includes(key(file))).map(pick).reduce((a, b) => (RANK[b.model] > RANK[a.model] ? b : a), floor)
const tdd = t => t.tdd !== false && !t.mechanical
const stopTask = (t, question) => { state[t.id] = 'stop'; stops.push({ id: t.id, question }) }
const TESTS_ONLY = 'Tests only: write the tests for the criteria, plus the stubs they need to compile or load. Every test title and body is Given/When/Then (`// Given`, `// When`, `// Then`). Change no production behaviour.'
const rootPosix = repoRoot.replace(/\\/g, '/')
const sq = s => s.replace(/'/g, `'\\''`)
// `env -C <root> bash -c '<cmd>'` puts the whole command (a chain `a && b` too) in the repo root without a leading cd (a hook blocks it).
const gate = (label, phaseName, cmd) => agent(
  `Run \`${cmd}\` with ${rootPosix} as its working directory, in Bash as \`env -C '${sq(rootPosix)}' bash -c '${sq(cmd)}'\`, with the shell tool \`timeout: 600000\`: never start a command with cd (a hook blocks it). Read-only: change nothing. Return exitCode (the code the command exited with, zero or not: a non-zero exit, a compile error too, is a result, not a tool error; -1 only when the command did not finish: a tool error, a timeout, killed), noTests (true when the output says no test matched or zero tests ran) and line (the deciding output line, verbatim).`,
  { label, phase: phaseName, agentType: 'gate-runner', model: 'haiku', effort: 'low', schema: GATE },
).then(r => (r ? verdict(Number.isInteger(r.exitCode) ? r.exitCode : null, r.noTests === true, String(r.line ?? '')) : verdict(null, false, 'no result')), () => verdict(null, false, 'no result'))

const taskLines = t => [`Task ${t.id}. Files you own: ${t.files.join(', ')}`, `Criteria:\n${t.criteria.map(c => `- ${c}`).join('\n')}`, `Verify with: ${t.verify}`,
  ...(tdd(t) ? [] : ['test-first: no (mechanical / tdd false)']),
  ...(t.red ? [`The tests for the criteria are written and red${t.redLine ? ` (${t.redLine})` : ''}. Make them pass; never weaken or delete them.`] : [])]
const overlap = (a, b) => a.files.some(f => b.files.map(key).includes(key(f)))

const runSuite = async (label = 'suite') => {
  phase('Suite')
  const g = await gate(label, 'Suite', input.testCmd)
  return g.green ? 'green' : !g.ran ? `not run: ${g.line}` : g.noTests ? `not run: no test ran: ${g.line}` : `red: ${g.line}`
}
const taskOut = t => ({ id: t.id, state: state[t.id], red: t.red === true, ...(t.line ? { line: t.line } : {}), ...(t.redLine ? { redLine: t.redLine } : {}) })

// Baseline: a suite already red before any change would send fixers after failures this run did not cause.
if (input.baseline !== false) {
  const before = await runSuite('baseline')
  if (before !== 'green') {
    const why = before.startsWith('red: ') ? `is red before any change: ${before.slice(5)}` : `did not run before any change: ${before.slice(9)}`
    return { status: 'stop', tasks: tasks.map(taskOut), assumedDone, suite: before, rounds: 0, stops: [{ id: 'baseline', question: `the suite ${why} — fix it first or pass a narrower testCmd?${before.startsWith('not run: no test ran') ? ' No test exists yet: relaunch with baseline: false.' : ''}` }], openFindings: [], outside: [], filesChanged: [...new Set((input.doneFiles ?? []).map(norm))].sort() }
  }
}

for (const [w, wave] of waves.entries()) {
  const ready = []
  for (const t of wave) {
    const blocker = t.dependsOn.find(d => state[d] !== 'done')
    if (blocker) { state[t.id] = 'skipped'; log(`${t.id} skipped: ${blocker} is ${state[blocker]}`) } else ready.push(t)
  }
  if (!ready.length) continue

  // Batches of disjoint-file tasks: a batch runs in parallel, batches run one after the other.
  const batches = []
  for (const t of ready) {
    const batch = batches.find(b => b.every(o => !overlap(o, t)))
    if (batch) batch.push(t); else batches.push([t])
  }
  log(`wave ${w + 1}: ${ready.map(t => t.id).join(', ')} in ${batches.length} batch(es)`)
  phase('Implement')
  for (const batch of batches) {
    // Test-first: tests only, then the verify must fail; a verify that passes proves nothing (one more try, then stop).
    const first = batch.filter(t => tdd(t) && t.red !== true)
    // An implementer may edit the files of a task that later stops or fails: they count as changed.
    first.forEach(t => t.files.forEach(f => changed.add(norm(f))))
    const reds = await parallel(first.map(t => () => implement(`red ${t.id}`, 'Implement', [...taskLines(t), TESTS_ONLY], pick(t))))
    first.forEach((t, i) => { const q = stopOf(reds[i]); if (q !== null) stopTask(t, q) })
    for (const t of first.filter(x => state[x.id] !== 'stop')) {
      let g = await gate(`red verify ${t.id}`, 'Verify', t.verify)
      if (g.green) {
        const q = stopOf(await implement(`red ${t.id} (retry)`, 'Implement', [...taskLines(t), TESTS_ONLY, `The verify command passed before any change (${g.line}), so the tests prove nothing. Make them fail on the missing behaviour.`], pick(t)))
        if (q !== null) { stopTask(t, q); continue }
        g = await gate(`red verify ${t.id} (retry)`, 'Verify', t.verify)
      }
      if (g.green) stopTask(t, 'tests green before the change')
      else if (!g.ran) stopTask(t, `the red check did not run to completion: ${g.line}`)
      else if (g.noTests) stopTask(t, `the red check ran no test: ${g.line}`)
      else { t.red = true; t.redLine = g.line }
    }
    const live = batch.filter(t => state[t.id] !== 'stop')
    live.forEach(t => t.files.forEach(f => changed.add(norm(f))))
    const replies = await parallel(live.map(t => () => implement(`implement ${t.id}`, 'Implement', taskLines(t), pick(t))))
    live.forEach((t, i) => { const q = stopOf(replies[i]); if (q !== null) stopTask(t, q) })
  }

  // Only after every implementer of the wave: one verify at a time, never on the implementer's word.
  phase('Verify')
  for (const t of ready.filter(x => state[x.id] !== 'stop')) {
    let g = await gate(`verify ${t.id}`, 'Verify', t.verify)
    // A verify that ran no test needs a different command, not a code fix: no retry.
    if (g.ran && !g.green && !g.noTests) {
      const reply = await implement(`retry ${t.id}`, 'Implement', [...taskLines(t), `The verify command failed. Fix the code, not the test, and keep every case. Failing output: ${g.line}`], pick(t))
      const q = stopOf(reply)
      if (q !== null) { stopTask(t, q); continue }
      g = await gate(`verify ${t.id} (retry)`, 'Verify', t.verify)
    }
    state[t.id] = g.green ? 'done' : 'failed'
    if (!g.green) {
      t.line = !g.ran ? `the verify did not run to completion: ${g.line}` : g.noTests ? `the verify ran no test: ${g.line}` : g.line
      log(`${t.id} failed: ${t.line}`)
    }
  }
}

const allDone = tasks.every(t => state[t.id] === 'done')
let suite = await runSuite()
let rounds = 0
let open = []
const outside = new Set()

const openItems = r => {
  const items = []
  // No file (an unknown task id): the item stays open with no fixer.
  const firstFile = id => byId.get(id)?.files[0] ?? null
  // A finding on a file no task declares, this run did not change and no earlier run changed (doneFiles) is outside the perimeter: reported, never fixed.
  const inside = new Set([...tasks.flatMap(t => t.files), ...changed, ...(input.doneFiles ?? [])].map(key))
  // A fixer only for a file inside the change or a test file; any other stays open with no fixer, like causedByChange.
  const inFix = f => !!f && (inside.has(key(f)) || TEST_FILE.test(norm(f)))
  for (const f of r.findings ?? []) {
    if (f.priority !== 'P1' && f.priority !== 'P2') continue
    // Caused by this change, in a file no task owns: open with no fixer (file null), so the owner decides.
    if (f.file && !inside.has(key(f.file)) && f.causedByChange === true) items.push({ file: null, text: `${f.priority} ${norm(f.file)}${f.line ? `:${f.line}` : ''} ${f.summary}` })
    else if (f.file && !inside.has(key(f.file))) outside.add(`${norm(f.file)}${f.line ? `:${f.line}` : ''} — ${f.summary}`)
    else items.push({ file: f.file, text: `${f.priority} ${f.file}${f.line ? `:${f.line}` : ''} ${f.summary}` })
  }
  for (const o of r.outside ?? []) outside.add(String(o))
  // A gap of a task that is not done may sit in a test file its stopped tests-only step wrote: open, no fixer.
  for (const c of r.criteriaMap ?? []) if (c.gap) items.push({ file: byId.has(c.task) && state[c.task] !== 'done' ? null : inFix(c.file || firstFile(c.task)) ? c.file || firstFile(c.task) : null, text: `criterion without a test (${c.task}): ${c.criterion}` })
  for (const l of r.lostTests ?? []) items.push({ file: inFix(l.file) ? l.file : null, text: `existing test case lost or weakened in ${l.file}: ${l.test}${l.note ? ` (${l.note})` : ''}` })
  return items.map(it => ({ ...it, file: it.file ? norm(it.file) : null }))
}
// Files of stopped, failed or skipped tasks may hold frozen red tests: their findings get no fixer.
const TEST_FILE = /(^|[/._-])(tests?|spec)([/._-]|$)/i
const held = () => new Set(tasks.filter(t => state[t.id] !== 'done').flatMap(t => t.files.map(key)))
// One suite item, one fixer: the inside file the failing line names (the longest match), else the first changed test file, else the first changed file.
// A name matches only at a name boundary: never inside a longer file name (a.js in data.js); a leading directory is fine.
const atBoundary = (text, name) => {
  for (let i = text.indexOf(name); i >= 0; i = text.indexOf(name, i + 1)) {
    if (!/[a-z0-9_.-]/.test(text[i - 1] ?? ' ') && !/[a-z0-9_/-]/.test(text[i + name.length] ?? ' ') && !/^\.[a-z0-9]/.test(text.slice(i + name.length, i + name.length + 2))) return true
  }
  return false
}
const suiteFile = line => {
  const text = drive(line).toLowerCase()
  const named = [...new Set([...tasks.flatMap(t => t.files), ...changed, ...(input.doneFiles ?? [])].map(norm))].filter(f => atBoundary(text, f.toLowerCase())).sort((a, b) => b.length - a.length)[0]
  return named ?? [...changed].find(f => TEST_FILE.test(f)) ?? [...changed][0] ?? null
}
const fixStopped = new Set()

if (tasks.some(t => state[t.id] === 'done')) {
  const model = (input.risk ?? []).some(a => HIGH_RISK.includes(a)) || tasks.some(isHigh) ? 'opus' : 'sonnet'
  const criteria = tasks.filter(t => state[t.id] === 'done').map(t => `Task ${t.id} (files ${t.files.join(', ')}):\n${t.criteria.map(c => `- ${c}`).join('\n')}`).join('\n')
  const axes = SENSITIVE.filter(a => tasks.some(t => state[t.id] === 'done' && (t.risk ?? input.risk ?? []).includes(a)))
  const PERIMETER = 'Perimeter: findings only on what this change added or modified (the uncommitted diff), plus a defect elsewhere that this change causes (a file the change does not touch, e.g. a caller broken by a changed signature: a finding with causedByChange true, never fixed here). A defect that was already there, in code the change does not touch, or an improvement nobody asked for is NOT a finding: list it in `outside`, one line each (`file:line — what`); it is never fixed.'
  while (rounds < ROUNDS_MAX) {
    rounds++
    phase('Review')
    const head = [
      `Repository: ${repoRoot}`,
      `Review the whole uncommitted change: \`git -C "${rootPosix}" status\` and \`git diff HEAD\`, plus untracked files. You have not seen it before.`,
      `Request: ${request}`,
    ]
    const first = () => agent([
      ...head,
      `Suite (${input.testCmd}) result before this review: ${suite}`,
      `Criteria of the done tasks:\n${criteria}`,
      'Check that every added or rewritten test is Given/When/Then in its title and its body (`// Given`, `// When`, `// Then`): a test that is not is a P2 finding. Check that no pre-existing test case was deleted or weakened.',
      PERIMETER,
      'Return: findings (priority P1|P2|P3, file, line, summary); outside (strings); criteriaMap, one entry per criterion with the test that covers it, gap true when none does; lostTests, every existing test case the change removed or weakened.',
    ].join('\n\n'), { label: `review round ${rounds}`, phase: 'Review', agentType: 'code-reviewer', model, effort: 'high', schema: REVIEW }).catch(() => null)
    const second = () => agent([
      ...head.slice(0, 1), head[1].replace('Review the whole', 'Read the whole'), head[2],
      `Read the change only for these sensitive axes: ${axes.join(', ')}.`,
      PERIMETER,
      'Return: findings (priority P1|P2|P3, file, line, summary, causedByChange) limited to the sensitive axes; outside (strings); criteriaMap and lostTests empty.',
    ].join('\n\n'), { label: `review round ${rounds} (axes)`, phase: 'Review', agentType: 'code-reviewer', model: 'opus', effort: 'high', schema: REVIEW }).catch(() => null)
    const [r, r2] = axes.length ? await parallel([first, second]) : [await first(), null]
    if (!r) { open = [{ file: '-', text: `reviewer round ${rounds} returned nothing: the change is not reviewed` }]; break }
    let merged = r
    if (axes.length) {
      if (r2) {
        // One finding per file+line (no line: file + summary): the higher priority, the first reviewer's summary, causedByChange if either says so.
        const nk = f => f.line ? `${key(f.file ?? '')}:${f.line}` : `${key(f.file ?? '')}|${String(f.summary).trim().toLowerCase().replace(/\s+/g, ' ')}`
        const rank = p => ['P1', 'P2', 'P3'].indexOf(p) >= 0 ? ['P1', 'P2', 'P3'].indexOf(p) : 3
        const list = (r.findings ?? []).map(f => ({ ...f }))
        const at = new Map()
        list.forEach((f, i) => { if (!at.has(nk(f))) at.set(nk(f), i) })
        for (const f of r2.findings ?? []) {
          const i = at.get(nk(f))
          if (i === undefined) { at.set(nk(f), list.length); list.push({ ...f }); continue }
          if (rank(f.priority) < rank(list[i].priority)) list[i].priority = f.priority
          if (f.causedByChange === true) list[i].causedByChange = true
        }
        merged = { ...r, findings: list, outside: [...(r.outside ?? []), ...(r2.outside ?? [])] }
      } else {
        log(`review round ${rounds} (axes) returned nothing: reviewed by one reviewer`)
        merged = { ...r, outside: [...(r.outside ?? []), `review round ${rounds} (axes) — second reviewer returned nothing: the sensitive axes (${axes.join(', ')}) were reviewed once`] }
      }
    }
    open = openItems(merged)
    // A red suite is an open item even when the review is clean, but only when every task is done (else stopped tasks may have left frozen red tests).
    if (suite.startsWith('red: ') && allDone) open.push({ file: suiteFile(suite), text: `the suite (${input.testCmd}) is ${suite}` })
    const heldFiles = held()
    // A file whose fixer answered STOP waits for the owner: no relaunch in a later round.
    const fixable = open.filter(it => it.file && !heldFiles.has(key(it.file)) && !fixStopped.has(key(it.file)))
    if (!fixable.length || rounds === ROUNDS_MAX) break

    phase('Fix')
    // Grouped case-folded, so one file has one fixer; the first spelling seen names it.
    const byKey = new Map()
    for (const it of fixable) { const e = byKey.get(key(it.file)) ?? [it.file, []]; e[1].push(it.text); byKey.set(key(it.file), e) }
    const byFile = new Map(byKey.values())
    const replies = await parallel([...byFile].map(([file, texts]) => () => implement(
      `fix ${file}`, 'Fix', [`File you own: ${file}`, `Fix these review items, nothing else:\n${texts.map(x => `- ${x}`).join('\n')}`,
        'Fix only the listed findings in the file you own; anything else you notice goes in your report under Noticed, never in the code.',
        'Never edit an assertion of a test proven red; renaming it and its Given/When/Then comments are allowed.'], fixTier(file))))
    ;[...byFile.keys()].forEach((file, i) => {
      const q = stopOf(replies[i])
      if (q !== null) { fixStopped.add(key(file)); if (!stops.some(s => s.id === `fix:${file}`)) stops.push({ id: `fix:${file}`, question: q }) }
      else changed.add(norm(file))
    })
    suite = await runSuite()
  }
}

const status = allDone && suite === 'green' && !open.length && !stops.length ? 'ok' : tasks.some(t => state[t.id] === 'failed') ? 'failed' : stops.length ? 'stop' : 'failed'
return {
  status,
  tasks: tasks.map(taskOut),
  assumedDone,
  suite: suite.startsWith('red: ') && !allDone ? `${suite} (suite fix held back until the stopped tasks are resolved)` : suite,
  rounds,
  stops,
  openFindings: open.map(i => i.text),
  outside: outside.size > 10 ? [...[...outside].slice(0, 10), `+${outside.size - 10} more`] : [...outside],
  filesChanged: [...new Set([...changed, ...(input.doneFiles ?? []).map(norm)])].sort(),
}
