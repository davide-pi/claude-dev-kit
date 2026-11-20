import { expect, test } from 'claude-code/testing'

import { effortGlyph, textCells } from '../hooks/shared'
import { SESSION_LOG_KEEP } from '../hooks/timeline'
import { bashResult, gatedBash, mountLanes, mountPane,settleAll, spawnWorkflowAgent, spawns } from './cockpit-fixtures'
import { NOW, dataOf, rowTexts, world } from './cockpit-world'

const WIDE = 70

/** A pane drawn from a saved session: its rows and the drawn tree (for colours). */
async function drawn($: Parameters<Parameters<typeof test>[1]>[0], on: Parameters<typeof world>[0], data: object, columns = WIDE, lang?: 'it', press?: string) {
  world(on, { dataFile: JSON.stringify({ history: [], prs: [], ...data }), ...(lang === 'it' && { files: { 'cockpit.json': '{"lang":"it"}' } }) })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mountLanes($, columns)
  if (press !== undefined) await ui.press({ key: press })
  const root = await ui.drawn()
  await ui.unmount()
  return { rows: rowTexts(root).map(r => r.trimEnd()), root }
}

const PROMPT = 'fix the parser in the lexer module and then clean every helper it uses around the tree'

test('Given a flow whose agents all still run, When drawn, Then its node can open: it has an arrow, not a dash', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const clock = world(on)
  spawns(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await spawnWorkflowAgent($, 'wf_1', 0)
  await spawnWorkflowAgent($, 'wf_1', 1)
  await clock.advance(1000)
  await settleAll()
  // When
  const ui = await mountPane($, WIDE)
  const rows = rowTexts(await ui.drawn())
  await ui.unmount()
  // Then
  expect(rows.some(r => /^[▾▸] \d\d:\d\d flow/.test(r))).toBe(true)
})

type Pane = Awaited<ReturnType<typeof mountPane>>
const textOf = async (ui: Pane) => rowTexts(await ui.drawn()).map(r => r.trimEnd())


/** A spawn into run `wf_1` whose label names a loop round. */
const spawnInRun = ($: Parameters<Parameters<typeof test>[1]>[0], label: string, agentIndex: number) =>
  $.agent.spawn({
    tool_use_id: `wf-call-${agentIndex}`,
    prompt: 'go',
    description: label,
    subagentType: 'implementer',
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'claude-opus-5-5',
    background: true,
    fork: false,
    workflow: { runId: 'wf_1', agentIndex },
  })

test('Given a flow with agents of round 1 and 2, one running, and a commit by agent X, When drawn, Then R1 and R2 are toggle rows with the highest open, the agents come in start order with their battery, the commit sits under X and the running agent shows a spinner and its elapsed time', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const done = (key: string, type: string, label: string, ms: number, end: number) => ({ at: end, kind: 'agent', key, runId: 'wf_1', text: type, desc: label, model: 'claude-sonnet-5-5', effort: 'high', ms, usd: 0.2 })
  const log = [
    done('x1', 'implementer', 'implementer round 1', 60_000, NOW - 300_000),
    done('x2', 'reviewer', 'reviewer round 2', 50_000, NOW - 200_000),
    { at: NOW - 210_000, kind: 'commit', key: 'abc1234', text: 'fix the parser', agent: 'x2', runId: 'wf_1' },
  ]
  const clock = world(on, { dataFile: JSON.stringify({ history: [], prs: [], sessionLog: log }) })
  spawns(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await spawnInRun($, 'implementer round 2', 0)
  await clock.advance(3000)
  await settleAll()
  // When
  const ui = await mountPane($, 100)
  const before = await textOf(ui)
  const spinners = ((await ui.findAll({ type: 'Client' })) as { key?: string; props?: { props?: { kind?: string; cells?: { t: string }[] } } }[]).filter(c => c.props?.props?.kind === 'spin' && c.props.props.cells?.some(x => x.t === '\u{F1396}'))
  await ui.press({ key: 'flow:wf_1:R1' })
  const after = await textOf(ui)
  await ui.unmount()
  // Then
  const at = (rows: string[], re: RegExp) => rows.findIndex(r => re.test(r))
  expect(before.some(r => /▾ R2/.test(r))).toBe(true)
  expect(before.some(r => /▸ R1/.test(r))).toBe(true)
  // the tree rows start with a time; the flow header and the IN PROGRESS agent list name the type too
  const agentRow = /\d\d:\d\d \S+ implementer/
  expect(before.filter(r => agentRow.test(r))).toHaveLength(1)
  const [reviewer, commit, running] = [at(before, /reviewer/), at(before, /abc1234/), at(before, agentRow)]
  expect(reviewer).toBeGreaterThan(-1)
  expect(commit).toBe(reviewer + 1)
  expect(before[reviewer]).toMatch(/son ?5\.5/)
  expect(before[reviewer]).toContain(effortGlyph('high')?.icon)
  expect(running).toBeGreaterThan(commit)
  expect(before[running]).toContain('\u{F1396}')
  // the LOG row's icon is an animated cell (the flow agent shows once, under its flow: IN PROGRESS spins no second one)
  expect(spinners.length).toBeGreaterThanOrEqual(1)
  expect(before[running]).toMatch(/\d\dm\d\ds/)
  expect(before[running]).not.toContain('\u{F012C}')
  expect(after.some(r => /▾ R1/.test(r))).toBe(true)
  expect(after.filter(r => agentRow.test(r))).toHaveLength(2)
  expect(after.some(r => agentRow.test(r) &&r.includes(effortGlyph('high')?.icon ?? '?'))).toBe(true)
})

/** A saved session of three rounds (figures all there, no duration, no cost) and agents of the same three kinds under the newest. */

/** Where the first match of `re` ends in `row`, in cells; -1 when the row has none. */


test('Given a live flow whose name and progress do not fit a narrow pane, When drawn, Then the name is cut with an ellipsis and the progress stays whole', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const clock = world(on, { dataFile: JSON.stringify({ history: [], prs: [], sessionLog: [] }) })
  spawns(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await spawnWorkflowAgent($, 'wf_1', 0)
  await clock.advance(10_000)
  await settleAll()
  // When
  const ui = await mountPane($, 54)
  const rows = await textOf(ui)
  await ui.unmount()
  // Then
  const flowRow = rows.find(r => /^[▾▸-] \d\d:\d\d fl/.test(r)) ?? ''
  expect(flowRow).toMatch(/· 0\/1/)
  expect(flowRow).toMatch(/flow [^·]*… +· step 0 · 0\/1/)
})

// ── The flow agent's row: expandable, with its detail and its trail ──

const TASK = 'Fix the lexer'
const TRAIL = /\d\d:\d\d (?:\S )?(?:Grep|Bash) ?(.*?)\s*$/u

/** A live run whose implementer made a Grep and has a Bash in flight; `look` reads the pane while the Bash holds. */
async function withRunningAgent<T>($: Parameters<Parameters<typeof test>[1]>[0], on: Parameters<typeof world>[0], columns: number, look: (ui: Awaited<ReturnType<typeof mountPane>>) => Promise<T>) {
  const clock = world(on)
  spawns(on)
  on('tool.call', { tool: 'Grep' }, () => ({ result: {} }))
  const release = gatedBash(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await spawnWorkflowAgent($, 'wf_1', 1, TASK)
  await $.tool.call({ tool: 'Grep', pattern: 'Order', agentId: 'a1' })
  const inFlight = $.tool.call({ tool: 'Bash', command: 'hold', description: 'Hold on', agentId: 'a1' })
  await clock.advance(3000)
  await settleAll()
  const ui = await mountPane($, columns)
  const out = await look(ui)
  release('hold')
  await inFlight
  await ui.unmount().catch(() => undefined) // `look` may have unmounted it
  return out
}

test('Given a running flow agent under the live flow node, When its row is open by default, Then its task starts on its row and the trail (newest first) renders under it', { timeoutMs: 30_000 }, async ($, on) => {
  // Given / When
  const rows = await withRunningAgent($, on, 100, async ui => rowTexts(await ui.drawn()).map(r => r.trimEnd()))
  // Then
  const agent = rows.findIndex(r => /implementer/.test(r))
  const task = rows.findIndex((r, i) => i >= agent && r.includes('· Fix')) // the flow's own row, above, names the task as its phase too
  const trail = rows.map((r, i) => ({ i, m: TRAIL.exec(r) })).filter(x => x.m !== null)
  expect(agent).toBeGreaterThan(-1)
  expect(task).toBe(agent)
  expect(trail.map(x => x.m?.[1])).toEqual(['Hold on', 'Order'])
  expect(trail[0]?.i).toBeGreaterThan(agent)
})

test('Given a person closes the flow agent row, When IN PROGRESS re-renders, Then only the agent row shows and a new pane keeps it closed', { timeoutMs: 30_000 }, async ($, on) => {
  // Given / When
  const closed = await withRunningAgent($, on, 100, async ui => {
    await ui.press({ key: 'flow:wf_1:agent:a1' })
    const rows = rowTexts(await ui.drawn())
    await ui.unmount()
    const again = await mountPane($, 100)
    const rowsAgain = rowTexts(await again.drawn())
    await again.unmount()
    return { rows, rowsAgain }
  })
  // Then
  for (const rows of [closed.rows, closed.rowsAgain]) {
    expect(rows.some(r => /implementer/.test(r))).toBe(true)
    expect(rows.slice(rows.findIndex(r => /implementer/.test(r)) + 1).some(r => r.includes(TASK))).toBe(false)
    expect(rows.some(r => TRAIL.test(r))).toBe(false)
  }
})

test('Given a flow agent that spawns a subagent outside any run, When IN PROGRESS is drawn, Then the subagent is still listed', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  world(on)
  spawns(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await spawnWorkflowAgent($, 'wf_1', 0)
  await $.agent.spawn({ tool_use_id: 'child', prompt: 'go', description: 'look around', subagentType: 'Explore', provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', background: true, fork: false, parentAgentId: 'a1' } as never)
  await settleAll()
  // When
  const ui = await mountPane($, 100)
  const rows = rowTexts(await ui.drawn())
  await ui.unmount()
  // Then
  expect(rows.some(r => /Explore/.test(r))).toBe(true)
})

test('Given a narrow pane, When the open flow agent is drawn, Then no row is wider than the pane', { timeoutMs: 30_000 }, async ($, on) => {
  // Given / When
  const rows = await withRunningAgent($, on, 30, async ui => rowTexts(await ui.drawn()).map(r => r.trimEnd()))
  // Then
  expect(rows.some(r => r.includes('Hold'))).toBe(true)
  expect(rows.filter(r => textCells(r) > 30)).toEqual([])
})

test('Given an open flow agent with a trail, When drawn, Then its detail is on its row and the trail rows follow it directly, newest first', { timeoutMs: 30_000 }, async ($, on) => {
  // Given / When
  const rows = await withRunningAgent($, on, 100, async ui => rowTexts(await ui.drawn()).map(r => r.trimEnd()))
  // Then
  const agent = rows.findIndex(r => /implementer/.test(r))
  expect(rows[agent]).toContain('· Fix')
  expect(rows.some((r, i) => i > agent && r.includes(TASK))).toBe(false)
  expect(TRAIL.exec(rows[agent + 1] ?? '')?.[1]).toBe('Hold on')
  expect(TRAIL.exec(rows[agent + 2] ?? '')?.[1]).toBe('Order')
})

test('Given a narrow pane, When the open flow agent is drawn, Then its detail is cut on its row and the trail follows it directly', { timeoutMs: 30_000 }, async ($, on) => {
  // Given / When
  const rows = await withRunningAgent($, on, 40, async ui => rowTexts(await ui.drawn()).map(r => r.trimEnd()))
  // Then
  const agent = rows.findIndex(r => /impleme/.test(r))
  expect(agent).toBeGreaterThan(-1)
  expect(textCells(rows[agent] ?? '')).toBeLessThanOrEqual(40)
  expect(TRAIL.test(rows[agent + 1] ?? '')).toBe(true)
})

// ── The trimmed-entries row ──

const TRIMMED_LOG = [
  { at: NOW - 200_000, kind: 'round', n: 29, ms: 50_000, ctxPct: 30 },
  { at: NOW - 100_000, kind: 'round', n: 30, ms: 61_000, ctxPct: 42 },
]

for (const [what, logTrimmed] of [['no trimmed field', undefined], ['a negative one', -3], ['a NaN one', 'NaN']] as const) {
  test(`Given a data file with ${what}, When drawn, Then no trimmed row shows`, { timeoutMs: 30_000 }, async ($, on) => {
    // Given / When
    const { rows } = await drawn($, on, { sessionLog: TRIMMED_LOG, logTrimmed })
    // Then
    expect(rows.some(r => r.includes('trimmed'))).toBe(false)
  })
}

test('Given a stored log longer than SESSION_LOG_KEEP and a saved count, When the session loads and saves, Then the overflow adds to the saved count', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const stored = Array.from({ length: SESSION_LOG_KEEP + 5 }, (_, i) => ({ at: NOW - 1_000_000 + i, kind: 'test', text: `t${i}`, isFailed: true }))
  const writes = new Map<string, string>()
  world(on, { writes, dataFile: JSON.stringify({ history: [], prs: [], sessionLog: stored, logTrimmed: 10 }) })
  // When
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  // Then
  expect(dataOf(writes)?.logTrimmed).toBe(15)
})

test('Given a full session log, When a commit is logged by a tool call, Then the saved trimmed count grows by 1', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const full = Array.from({ length: SESSION_LOG_KEEP }, (_, i) => ({ at: NOW - 1_000_000 + i, kind: 'test', text: `t${i}`, isFailed: true }))
  const writes = new Map<string, string>()
  const clock = world(on, { writes, dataFile: JSON.stringify({ history: [], prs: [], sessionLog: full, logTrimmed: 2 }) })
  on('tool.call', { tool: 'Bash' }, () => bashResult('[main abc1234] fix'))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  // When
  await $.tool.call({ tool: 'Bash', command: 'git commit -m "fix"' })
  await clock.advance(5000)
  await settleAll()
  // Then
  expect(dataOf(writes)?.logTrimmed).toBe(3)
})

test('Given a session with a trimmed count, When another session is adopted, Then the count is that session own', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  let id = 's-1'
  const writes = new Map<string, string>()
  const files = { [`cockpit-data-s-1.json`]: JSON.stringify({ history: [], prs: [], sessionLog: TRIMMED_LOG, logTrimmed: 7 }), [`cockpit-data-s-2.json`]: JSON.stringify({ history: [], prs: [], sessionLog: TRIMMED_LOG }) }
  const clock = world(on, { writes, sessionId: () => id, files })
  on('tool.call', { tool: 'Bash' }, () => bashResult('[main abc1234] fix'))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  // When
  id = 's-2'
  await $.tool.call({ tool: 'Bash', command: 'git commit -m "fix"' })
  await clock.advance(5000)
  await settleAll()
  // Then
  const path = [...writes.keys()].find(k => /cockpit-data-s-2\.json$/.test(k)) ?? ''
  expect(JSON.parse(writes.get(path) ?? 'null')).not.toHaveProperty('logTrimmed')
})
