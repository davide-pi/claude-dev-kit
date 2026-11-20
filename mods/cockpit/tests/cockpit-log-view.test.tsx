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

/** A saved session of three rounds (figures all there, no duration, no cost) and agents of the same three kinds under the newest. */

/** Where the first match of `re` ends in `row`, in cells; -1 when the row has none. */


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
