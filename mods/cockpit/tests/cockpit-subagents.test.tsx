import { expect, test } from 'claude-code/testing'

import { spanText, spanWidth, textCells } from '../hooks/shared'
import { agentCosts } from '../hooks/signals'
import { agentCostDetails, agentCostRow, orderAgents, subagentDetails } from '../hooks/view-agents'
import {
  MIN,
  SPAWN,
  entry,
  fileOfSession,
  finishAgent,
  launchWorkflow,
  mountPane,
  openCockpit,
  paneRows,
  settleAll,
  spawnAgent,
  spawnWorkflowAgent,
  spawns,
  workflowLaunches,
} from './cockpit-fixtures'
import { NOW, dataOf, flagOf, rowTexts, world } from './cockpit-world'

/** The share of the session's tokens each Subagents row ends with, as `12%`, in the order the rows draw them. */
const shares = (rows: string[]) =>
  rows.flatMap(r => {
    const m = /^[◐✓✗■] .* (<?\d+%) +\S+$/.exec(r)
    return m ? [m[1] ?? ''] : []
  })

test('Subagents: a finished agent leaves the list after 2 minutes for HISTORY, collapsed by default, newest first, with its outcome', async ($, on) => {
  const writes = new Map<string, string>()
  const clock = world(on, { writes, listed: [{ id: 'a3', status: 'running' }] })
  spawns(on)
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  for (const type of ['one', 'two', 'three']) await spawnAgent($, type)
  await finishAgent($, 'a1')
  await clock.advance(5_000)
  await finishAgent($, 'a2', 'error')

  const ui = await mountPane($)
  await ui.press({ key: 'tab:agents' })
  // inside the two minutes the finished agents are listed as before, and there is no history yet
  expect(await ui.find({ key: 'agent:a1' })).toBeDefined()
  expect(await ui.find({ key: 'agent:a2' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^HISTORY · / })).toBeUndefined()

  await clock.advance(130_000)
  expect(await ui.find({ key: 'agent:a1' })).toBeUndefined()
  expect(await ui.find({ key: 'agent:a2' })).toBeUndefined()
  expect(await ui.find({ key: 'agent:a3' })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /^HISTORY · / }))?.text).toBe('HISTORY · 2')
  const keys = async () => (await ui.findAll({ type: 'Button' })).map(b => b.key ?? '').filter(k => k.startsWith('history:'))
  expect(await keys()).toEqual(['history:a2', 'history:a1'])
  expect((await ui.find({ key: 'history:a2' }))?.text).toMatch(/^✗ two +son 5\.5 +0 +5s$/)
  expect((await ui.find({ key: 'history:a1' }))?.text).toMatch(/^✓ one +son 5\.5 +0 +0s$/)
  expect(await ui.find({ key: 'history:more' })).toBeUndefined() // two rows: nothing to open
  await ui.unmount()

  // the state file carries it, so a resume or a reload finds it
  await clock.advance(3000)
  expect(dataOf(writes)?.history).toEqual([
    { id: 'a2', type: 'two', model: 'claude-sonnet-5-5', startedAt: NOW, endedAt: NOW + 5000, tokens: 0, isFailed: true, description: 'go' },
    { id: 'a1', type: 'one', model: 'claude-sonnet-5-5', startedAt: NOW, endedAt: NOW, tokens: 0, isFailed: false, description: 'go' },
  ])
})

test('Subagents: an agent the engine lists as killed or failed ends with ✗, one it no longer lists with ✓', async ($, on) => {
  const clock = world(on, {
    listed: [
      { id: 'a1', status: 'killed' },
      { id: 'a2', status: 'failed' },
    ],
  })
  spawns(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  for (const type of ['one', 'two', 'three']) await spawnAgent($, type)
  await openCockpit($)
  await clock.advance(30_000)
  const ui = await mountPane($)
  await ui.press({ key: 'tab:agents' })
  expect((await ui.find({ key: 'agent:a1' }))?.text).toMatch(/^✗ one/)
  expect((await ui.find({ key: 'agent:a2' }))?.text).toMatch(/^✗ two/)
  expect((await ui.find({ key: 'agent:a3' }))?.text).toMatch(/^✓ three/)
  await ui.unmount()
})

test('HISTORY shows the newest 5 and a `▸ +K` button opens the rest, `▾ −K` folds them again', async ($, on) => {
  const clock = world(on)
  spawns(on)
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  for (let n = 1; n <= 25; n++) await spawnAgent($, `agent-${n}`)
  for (let n = 1; n <= 25; n++) await finishAgent($, `a${n}`)
  await openCockpit($)
  await clock.advance(135_000)
  const ui = await mountPane($)
  await ui.press({ key: 'tab:agents' })
  const rows = async () => (await ui.findAll({ type: 'Button' })).filter(b => /^history:a/.test(b.key ?? '')).length
  expect((await ui.find({ type: 'Text', text: /^HISTORY · / }))?.text).toBe('HISTORY · 25')
  expect(await rows()).toBe(5)
  expect((await ui.find({ key: 'history:more' }))?.text).toBe('▸ +20')
  await ui.press({ key: 'history:more' })
  expect(await rows()).toBe(25)
  expect((await ui.find({ key: 'history:more' }))?.text).toBe('▾ −20')
  await ui.press({ key: 'history:more' })
  expect(await rows()).toBe(5)
  await ui.unmount()
})

test('HISTORY survives a reload: the session id reads its history from its state file; another id starts empty', async ($, on) => {
  let id = 's-1'
  world(on, { sessionId: () => id, stateFile: JSON.stringify({ open: false, tab: 'agents', history: [entry('a9', 'implementer', NOW - 30_000), entry('a8', 'reviewer', NOW - 90_000, true)] }) })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  let ui = await mountPane($)
  expect((await ui.find({ type: 'Text', text: /^HISTORY · / }))?.text).toBe('HISTORY · 2')
  expect((await ui.find({ key: 'history:a9' }))?.text).toMatch(/^✓ implementer +son 5\.5 +5\.4k +\d+% +1m00s$/)
  expect((await ui.find({ key: 'history:a8' }))?.text).toMatch(/^✗ reviewer/)
  await ui.unmount()

  id = 's-2'
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  ui = await mountPane($)
  expect(await ui.find({ type: 'Text', text: /^HISTORY · / })).toBeUndefined()
  await ui.unmount()
})

test('HISTORY: a /clear moves the finished agent still under 2 minutes into the ending session\'s history; the new session starts empty', async ($, on) => {
  let id = 's-1'
  const writes = new Map<string, string>()
  const clock = world(on, { sessionId: () => id, writes })
  spawns(on)
  on('turn.complete', () => ({ text: '' }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await spawnAgent($, 'old')
  await finishAgent($, 'a1')
  id = 's-2'
  await $.session.end({ reason: 'clear', sessionId: 's-1', resume: { id: 's-1' } })
  expect(fileOfSession(writes, 's-1')?.history).toEqual([{ id: 'a1', type: 'old', model: 'claude-sonnet-5-5', startedAt: NOW, endedAt: NOW, tokens: 0, isFailed: false, description: 'go' }])
  await clock.advance(135_000)
  const ui = await mountPane($)
  await ui.press({ key: 'tab:agents' })
  expect(await ui.find({ type: 'Text', text: /^HISTORY · / })).toBeUndefined()
  expect(await ui.find({ key: 'agent:a1' })).toBeUndefined()
  await ui.unmount()
  expect(fileOfSession(writes, 's-2')?.history).toEqual([])
})

test('Subagents: a reload of the same session id keeps the live agents, the finished one too until its 2 minutes pass', async ($, on) => {
  const clock = world(on, { listed: [{ id: 'a1', status: 'running' }] })
  spawns(on)
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await spawnAgent($, 'one')
  await spawnAgent($, 'two')
  await finishAgent($, 'a2')
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mountPane($)
  await ui.press({ key: 'tab:agents' })
  expect(await ui.find({ key: 'agent:a1' })).toBeDefined()
  expect(await ui.find({ key: 'agent:a2' })).toBeDefined()
  await clock.advance(135_000)
  expect(await ui.find({ key: 'agent:a1' })).toBeDefined()
  expect(await ui.find({ key: 'agent:a2' })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /^HISTORY · / }))?.text).toBe('HISTORY · 1')
  await ui.unmount()
})

test('HISTORY draws an interrupted agent as a dim ■, and a resume of the ended id brings its history back', async ($, on) => {
  const history = [{ ...entry('a1', 'running-one', NOW - 1000), isInterrupted: true }]
  world(on, { stateFile: JSON.stringify({ tab: 'agents', history }) })
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.end({ reason: 'resume', sessionId: 's-1', resume: { id: 's-1' } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mountPane($)
  expect((await ui.find({ key: 'history:a1' }))?.text).toMatch(/^■ running-one/)
  await ui.unmount()
})

test('HISTORY: entries a state file holds wrongly are left out, a file with no history means none', async ($, on) => {
  world(on, { stateFile: JSON.stringify({ tab: 'agents', history: [{ id: 'x' }, 'text', entry('a1', 'ok', NOW - 1000)] }) })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mountPane($)
  expect((await ui.find({ type: 'Text', text: /^HISTORY · / }))?.text).toBe('HISTORY · 1')
  await ui.unmount()
})

test('an agent row, live or in HISTORY, expands on a press and collapses on the next; the expansion has no model/effort/time row and no open-transcript button', async ($, on) => {
  const viewed: (string | undefined)[] = []
  const clock = world(on, { viewed, listed: [{ id: 'a2', status: 'running' }, { id: 'a3', status: 'running' }] })
  spawns(on)
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  for (const type of ['one', 'two', 'three']) await spawnAgent($, type)
  await finishAgent($, 'a1')
  await openCockpit($)
  await clock.advance(130_000)

  const ui = await mountPane($)
  await ui.press({ key: 'tab:agents' })
  const rows = async () => rowTexts(await ui.drawn())
  await ui.press({ key: 'agent:a3' }) // live: its description opens under it
  expect((await rows()).some(r => /^ +go$/.test(r))).toBe(true)
  expect(await ui.find({ key: 'open:a3' })).toBeUndefined()
  expect((await rows()).some(r => /^ +(sonnet|son 5\.5)/.test(r))).toBe(false) // no second row with the model, effort and time
  await ui.press({ key: 'agent:a3' })
  expect((await rows()).some(r => /^ +go$/.test(r))).toBe(false)
  await ui.press({ key: 'history:a1' })
  expect(await ui.find({ key: 'open:a1' })).toBeUndefined()
  expect(viewed).toEqual([])
  await ui.unmount()
})

test('a HISTORY row expanded shows the description kept in the state file; one without a description shows nothing extra', async ($, on) => {
  const withText = { ...entry('a1', 'reviewer', NOW - 1000), description: 'Review the orders filter' }
  world(on, { stateFile: JSON.stringify({ tab: 'agents', history: [withText, entry('a2', 'plain', NOW - 2000)] }) })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mountPane($)
  const rows = async () => rowTexts(await ui.drawn())
  await ui.press({ key: 'history:a1' })
  expect((await rows()).some(r => /^ +Review the orders filter$/.test(r))).toBe(true)
  await ui.press({ key: 'history:a1' })
  await ui.press({ key: 'history:a2' })
  expect((await rows()).some(r => /^ +Review/.test(r))).toBe(false)
  await ui.unmount()
})

test('orderAgents lists each level newest first, children right under their parent', () => {
  const a = (id: string, startedAt: number, parentId?: string) => ({ id, type: 't', status: 'running' as const, startedAt, tokens: 0, ...(parentId && { parentId }) })
  const out = orderAgents([a('old', 1), a('old-kid1', 2, 'old'), a('new', 5), a('old-kid2', 3, 'old'), a('new-kid', 6, 'new')])
  expect(out.map(r => `${r.depth}${r.agent.id}`)).toEqual(['0new', '1new-kid', '0old', '1old-kid2', '1old-kid1'])
})

test('Subagents: a row ends with the agent\'s share of the session tokens before its time, and stays within 30 and 58 columns', async ($, on) => {
  world(on, { listed: [{ id: 'a1', status: 'running' }] })
  spawns(on)
  on('turn.step', async function* (_, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: STEP_USAGE }
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await spawnAgent($, 'reviewer')
  for await (const chunk of $.turn.step({ turnId: 't', index: 0, model: 'claude-sonnet-5-5', messageCount: 1, agentId: 'a1' })) void chunk
  for (const width of [30, 58]) {
    const ui = await mountPane($, width)
    await ui.press({ key: 'tab:agents' })
    const row = rowTexts(await ui.drawn()).find(r => /^◐ /.test(r)) ?? ''
    expect(textCells(row)).toBeLessThanOrEqual(width)
    expect(row).toMatch(/ 1\.7k +100% +0s$/)
    await ui.unmount()
  }
})

// ── Agent lifecycle ──

test('workflow agents: a tick does not end an agent just because the engine does not list it; its own turn does', async ($, on) => {
  const clock = world(on) // $.agent.list() answers nothing: it never lists a workflow's agents
  spawns(on)
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await spawnWorkflowAgent($, 'wf_1', 1)
  await spawnWorkflowAgent($, 'wf_1', 2)
  await clock.advance(30_000) // two ticks
  const ui = await mountPane($)
  await ui.press({ key: 'tab:agents' })
  expect((await ui.find({ key: 'agent:a1' }))?.text).toMatch(/^◐ implementer/)
  expect((await ui.find({ key: 'agent:a2' }))?.text).toMatch(/^◐ implementer/)
  await finishAgent($, 'a1')
  await clock.advance(30_000)
  expect((await ui.find({ key: 'agent:a1' }))?.text).toMatch(/^✓ implementer/)
  expect((await ui.find({ key: 'agent:a2' }))?.text).toMatch(/^◐ implementer/)
  await ui.unmount()
})

test('workflow agents: an explicit failed or killed listing ends them', async ($, on) => {
  const clock = world(on, { listed: [{ id: 'a1', status: 'killed' }] })
  spawns(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await spawnWorkflowAgent($, 'wf_1', 1)
  await spawnWorkflowAgent($, 'wf_1', 2)
  await openCockpit($)
  await clock.advance(30_000)
  const ui = await mountPane($)
  await ui.press({ key: 'tab:agents' })
  expect((await ui.find({ key: 'agent:a1' }))?.text).toMatch(/^✗ implementer/)
  expect((await ui.find({ key: 'agent:a2' }))?.text).toMatch(/^◐ implementer/)
  await ui.unmount()
})

test('workflow agents: the end of their run (silence past the limit) ends the ones still running and closes the run; a step keeps it open', async ($, on) => {
  const instructions: (string | undefined)[] = []
  const clock = world(on, { instructions })
  spawns(on)
  workflowLaunches(on, 'release-notes')
  on('tool.call', { tool: 'Grep' }, () => ({ result: {} }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await launchWorkflow($, 'release-notes')
  await spawnWorkflowAgent($, 'wf_1', 1)
  await clock.advance(10 * 60_000)
  await $.tool.call({ tool: 'Grep', pattern: 'x', agentId: 'a1' }) // a step: the silence starts over
  await clock.advance(10 * 60_000)
  let ui = await mountPane($)
  await ui.press({ key: 'tab:agents' })
  expect((await ui.find({ key: 'agent:a1' }))?.text).toMatch(/^◐ implementer/)
  await ui.unmount()
  await clock.advance(6 * 60_000)
  ui = await mountPane($)
  await ui.press({ key: 'tab:agents' })
  expect((await ui.find({ key: 'agent:a1' }))?.text).toMatch(/^✓ implementer/)
  await ui.press({ key: 'bar:compact' })
  expect(instructions.at(-1)).not.toContain('Running workflow')
  await ui.unmount()
})

test('workflow agents: a run whose agents the listing ends closes with them, and a spawn after it reopens it', async ($, on) => {
  const instructions: (string | undefined)[] = []
  const clock = world(on, { instructions, listed: [{ id: 'a1', status: 'killed' }] })
  spawns(on)
  workflowLaunches(on, 'release-notes')
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await launchWorkflow($, 'release-notes')
  await spawnWorkflowAgent($, 'wf_1', 1)
  const ui = await mountPane($)
  await ui.press({ key: 'bar:compact' })
  expect(instructions.at(-1)).toContain('Running workflow: release-notes.')
  await clock.advance(30_000)
  await ui.press({ key: 'bar:compact' })
  expect(instructions.at(-1)).not.toContain('Running workflow')
  await spawnWorkflowAgent($, 'wf_1', 2)
  await ui.press({ key: 'bar:compact' })
  expect(instructions.at(-1)).toContain('Running workflow: release-notes.')
  await ui.unmount()
})

test('subagent rows: a tool call seen before its agent spawned does not make a stub that the spawn later fills', async ($, on) => {
  world(on, { listed: [{ id: 'a1', status: 'running' }] })
  spawns(on)
  on('tool.call', { tool: 'Grep' }, () => ({ result: {} }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Grep', pattern: 'Order', agentId: 'a1' })
  await $.agent.spawn({ ...SPAWN, subagentType: 'code-reviewer', description: 'Review the orders filter' })
  const ui = await mountPane($, 50)
  await ui.press({ key: 'tab:agents' })
  await ui.press({ key: 'agent:a1' })
  const rows = async () => rowTexts(await ui.drawn())
  expect((await rows()).find(r => /^ +Review the orders filter/.test(r))).toBeDefined()
  expect((await rows()).some(r => /last tool/.test(r))).toBe(false)
  // a call after the spawn is seen as before
  await $.tool.call({ tool: 'Grep', pattern: 'Order', agentId: 'a1' })
  expect((await rows()).some(r => /^ +last tool Grep$/.test(r))).toBe(true)
  await ui.unmount()
})

// ── Subagenti ──

const STEP_USAGE = { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 8000, cache_creation_input_tokens: 500, model: 'claude-sonnet-5-5' }

test('Subagenti: an agent block shows state, type, description, model, effort, share of the session tokens, time, the four counters per step and the tool running now, then the last one', async ($, on) => {
  const clock = world(on, { listed: [{ id: 'a1', status: 'running' }] })
  spawns(on)
  on('turn.step', async function* (_, e) {
    yield { kind: 'text', index: 0, text: 'x' }
    return { turnId: e.turnId, index: e.index, answer: 'x', toolUses: [], stopReason: 'end_turn', usage: STEP_USAGE }
  })
  on('turn.complete', () => ({ text: '' }))
  let release = () => {}
  const toolGate = new Promise<void>(resolve => void (release = resolve))
  on('tool.call', { tool: 'Read' }, async () => {
    await toolGate
    return { result: {} }
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'cockpit', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 80 } })
  await spawnAgent($, 'code-reviewer')
  const step = async (agentId?: string) => {
    for await (const chunk of $.turn.step({ turnId: 't', index: 0, model: 'claude-sonnet-5-5', effort: 'high', messageCount: 1, ...(agentId && { agentId }) })) void chunk
  }
  const ui = await mountPane($)
  await ui.press({ key: 'tab:agents' })
  const rows = async () => rowTexts(await ui.drawn())
  const facts = async () => {
    const m = /(\d+%) +(\d+s)$/.exec((await rows()).find(r => /^[◐✓] code-reviewer/.test(r)) ?? '')
    return m && `${m[1]} ${m[2]}`
  }
  const counters = /^ +in 1k {2}out 200 {2}cr 8k {2}cw 500$/

  // before any step the counters are not drawn: nothing is faked
  expect((await rows()).some(r => /^ +in /.test(r))).toBe(false)

  await step('a1')
  let now = await rows()
  // collapsed: one row, the model a word, the effort an icon, the tokens, their share of the session and the time; nothing else of the agent
  expect(now.find(r => /code-reviewer/.test(r))).toMatch(/^◐ code-reviewer +son 5\.5 +\u{F12A3} +1\.7k +100% +0s$/u)
  expect(now.some(r => counters.test(r) || /^ +go$/.test(r))).toBe(false)
  // a press expands it: what it was asked and the four counters; the next press collapses it
  await ui.press({ key: 'agent:a1' })
  now = await rows()
  expect(now.some(r => counters.test(r))).toBe(true)
  expect(now.some(r => /^ +go$/.test(r))).toBe(true)
  await ui.press({ key: 'agent:a1' })
  expect((await rows()).some(r => counters.test(r))).toBe(false)
  await ui.press({ key: 'agent:a1' })
  expect(await facts()).toBe('100% 0s')

  // the main loop's step counts in the session: the agent is half of it
  await step()
  expect(await facts()).toBe('50% 0s')

  // the elapsed time moves with the fast tier
  await clock.advance(2000)
  await settleAll()
  expect(await facts()).toBe('50% 2s')

  // the tool in flight, then the last one
  const call = $.tool.call({ tool: 'Read', file_path: '/a', agentId: 'a1' })
  await settleAll()
  expect((await rows()).some(r => /^ +▸ Read$/.test(r))).toBe(true)
  release()
  await call
  now = await rows()
  expect(now.some(r => /^ +▸ Read$/.test(r))).toBe(false)
  expect(now.some(r => /^ +last tool Read$/.test(r))).toBe(true)

  // the turn's end settles the counters on the turn's own total: the steps are not counted twice
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 'a1-t', agentId: 'a1', reason: 'answer', usage: STEP_USAGE })
  expect((await rows()).some(r => counters.test(r))).toBe(true)
  await ui.unmount()
})

test('Subagenti: the turn\'s own total replaces what its steps added, a turn that saw no step adds its own, and the share follows', async ($, on) => {
  world(on)
  spawns(on)
  on('turn.step', async function* (_, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: STEP_USAGE }
  })
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await spawnAgent($, 'one')
  await spawnAgent($, 'two')
  for await (const chunk of $.turn.step({ turnId: 't', index: 0, model: 'claude-sonnet-5-5', messageCount: 1, agentId: 'a1' })) void chunk
  // the engine's total for the turn is a little more than its steps summed: it wins
  const more = { ...STEP_USAGE, output_tokens: 300 }
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 'a1-t', agentId: 'a1', reason: 'answer', usage: more })
  // a2 saw no step: the turn's end alone gives its counters
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 'a2-t', agentId: 'a2', reason: 'answer', usage: STEP_USAGE })
  // 1800 and 1700 new tokens of 3500
  const ui = await mountPane($)
  await ui.press({ key: 'tab:agents' })
  await ui.press({ key: 'agent:a1' })
  await ui.press({ key: 'agent:a2' })
  const rows = rowTexts(await ui.drawn())
  expect(rows.filter(r => /^ +in 1k {2}out 300 {2}cr 8k {2}cw 500$/.test(r))).toHaveLength(1)
  expect(rows.filter(r => /^ +in 1k {2}out 200 {2}cr 8k {2}cw 500$/.test(r))).toHaveLength(1)
  expect(shares(rows)).toEqual(['51%', '49%'])
  await ui.unmount()
})

test('Subagenti: after a reload the share keeps the main loop\'s tokens and the agents\' cumulative count, which the state file persists next to the history', async ($, on) => {
  const writes = new Map<string, string>()
  world(on, { writes, stateFile: JSON.stringify({ open: false, tab: 'agents', mainTokens: 10_000, agentTokens: 5400, history: [entry('a9', 'implementer', NOW - 30_000)] }) })
  spawns(on)
  on('turn.step', async function* (_, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: STEP_USAGE }
  })
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await spawnAgent($, 'one')
  for await (const chunk of $.turn.step({ turnId: 't', index: 0, model: 'claude-sonnet-5-5', messageCount: 1, agentId: 'a1' })) void chunk
  // 1700 of 10000 + 5400 + 1700 new tokens
  const ui = await mountPane($)
  await ui.press({ key: 'tab:agents' })
  await ui.press({ key: 'agent:a1' })
  expect(shares(rowTexts(await ui.drawn()))).toEqual(['10%', '32%']) // the live row, then the history row
  await ui.unmount()
  // a main step is written, for the next reload
  for await (const chunk of $.turn.step({ turnId: 't2', index: 0, model: 'claude-sonnet-5-5', messageCount: 1 })) void chunk
  await settleAll()
  await $.session.end({ reason: 'clear', sessionId: 's-1', resume: { id: 's-1' } })
  const file = [...writes.entries()].find(([k]) => /cockpit-s-1\.json$/.test(k))
  expect(JSON.parse(file?.[1] ?? 'null')).toMatchObject({ mainTokens: 11_700 })
  // the agents' count is written too: the running agent (1700) joins the 5400 that left, as the ended session's file keeps it
  expect(JSON.parse(file?.[1] ?? 'null')).toMatchObject({ agentTokens: 7100 })
})

test('Subagenti: the elapsed time is refreshed by the fast tier only while this tab is selected', async ($, on) => {
  const clock = world(on, { listed: [{ id: 'a1', status: 'running' }] })
  spawns(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'cockpit', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 80 } })
  await spawnAgent($, 'code-reviewer')
  const ui = await mountPane($)
  const elapsed = async () => /(\d+s)$/.exec((await ui.find({ key: 'agent:a1' }))?.text ?? '')?.[1]
  await ui.press({ key: 'tab:agents' })
  await clock.advance(4000)
  await settleAll()
  expect(await elapsed()).toBe('4s')
  await ui.press({ key: 'tab:notes' })
  await clock.advance(4000) // Notes has no clock: the agent's time stands where it was
  await settleAll()
  await ui.press({ key: 'tab:agents' })
  expect(await elapsed()).toBe('4s')
  await clock.advance(2000)
  await settleAll()
  expect(await elapsed()).toBe('10s')
  await ui.unmount()
})

// ── Phase 2 follow-ups, third round ──

test('Subagenti: an agent that leaves the list joins a cumulative counter that the state file persists, so the share does not lean on the history (cut at 50)', async ($, on) => {
  const writes = new Map<string, string>()
  // 100k new tokens of agents that left earlier, none of them in the (empty) history
  const clock = world(on, { writes, listed: [{ id: 'a2', status: 'running' }], stateFile: JSON.stringify({ open: false, tab: 'agents', agentTokens: 100_000 }) })
  spawns(on)
  on('turn.step', async function* (_, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: STEP_USAGE }
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await openCockpit($)
  await spawnAgent($, 'one') // a1: not listed by the engine, it ends at the next tick
  await spawnAgent($, 'two') // a2 stays running
  for (const agentId of ['a1', 'a2']) for await (const chunk of $.turn.step({ turnId: 't', index: 0, model: 'claude-sonnet-5-5', messageCount: 1, agentId })) void chunk
  const flag = () => (flagOf(writes) as { agentTokens?: number }).agentTokens
  await clock.advance(30_000)
  await settleAll()
  expect(flag()).toBe(100_000) // a1 ended but is listed for two more minutes: not counted yet
  await clock.advance(120_000)
  await settleAll()
  await clock.advance(30_000) // the heartbeat after a1 left the list
  await settleAll()
  expect(flag()).toBe(101_700)
  const ui = await mountPane($)
  await ui.press({ key: 'tab:agents' })
  // 1700 of 100000 + 1700 + 1700 (the agent has run for minutes by now)
  await ui.press({ key: 'agent:a2' })
  expect(shares(rowTexts(await ui.drawn()))).toEqual(['2%', '2%']) // the live row, then the history row
  await ui.unmount()
})

test('Subagenti: the tool line (the one running, or the last) is cut to the width with an ellipsis, like the counters', () => {
  const tool = 'mcp__plugin_browser-use_browser-use__a_very_long_tool_name_indeed'
  const agent = { id: 'a1', type: 't', status: 'running' as const, startedAt: 0, tokens: 0 }
  for (const a of [{ ...agent, activeTools: [tool] }, { ...agent, status: 'done' as const, lastTool: tool }]) {
    const rows = subagentDetails(a, '  ', 30)
    expect(rows).toHaveLength(1)
    expect(spanWidth(rows[0] ?? [])).toBe(30)
    expect(spanText(rows[0] ?? [])).toMatch(/…$/)
  }
  // a short one is left whole
  expect(spanText(subagentDetails({ ...agent, lastTool: 'Read' }, '  ', 30)[0] ?? [])).toBe('  last tool Read')
})

// ── Phase 9: Subagents rows are one cut line each ──

test('Subagents: every row is one line cut to the width, at 40, 58 and 80 columns: the agent row with its fixed columns, then (expanded) the description, the warning and the tool', async ($, on) => {
  const clock = world(on, { listed: [{ id: 'a1', status: 'running' }] })
  spawns(on)
  on('tool.call', { tool: 'Grep' }, () => ({ result: {} }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.agent.spawn({ ...SPAWN, subagentType: 'a-code-reviewer-with-a-very-long-name-that-cannot-fit-a-row', description: 'Review the orders filter and every test around it, then report back', model: 'fable' })
  await $.tool.call({ tool: 'Grep', pattern: 'Order', agentId: 'a1' })
  await clock.advance(2 * MIN)
  for (const columns of [40, 58, 80]) {
    const width = Math.min(columns, 60) - 2
    const ui = await mountPane($, columns)
    await ui.press({ key: 'tab:agents' })
    const body = async () => {
      const rows = rowTexts(await ui.drawn())
      return rows.slice(rows.findIndex(r => r.startsWith('SUBAGENTS'))).filter(r => !/^─+$/.test(r))
    }
    // collapsed: the agent is exactly one row, as wide as the pane: the name cut with …, the model, effort, tokens and time in fixed columns
    const collapsed = await body()
    const row = collapsed.filter(r => /^◐ a-co/.test(r))
    expect(row).toHaveLength(1)
    expect(textCells(row[0] ?? '')).toBe(width)
    expect(row[0]).toMatch(/^◐ a-co[^ ]*… +son 5\.5 +\S* *\S+(?: +\d+%)? +2m00s$/)
    expect(collapsed.some(r => /Review the orders|last tool|⚠/.test(r))).toBe(false)

    // expanded: every row of the block is one line, none wider than the pane
    await ui.press({ key: 'agent:a1' })
    const expanded = await body()
    expect(expanded.length).toBeGreaterThan(collapsed.length + 2)
    for (const r of expanded) expect(textCells(r)).toBeLessThanOrEqual(width)
    expect(expanded.find(r => /^ +Review the orders/.test(r))).toMatch(/…$/)
    expect(expanded.filter(r => !/^◐ a-co/.test(r)).some(r => /son 5\.5/.test(r))).toBe(false) // no facts row: the model, effort and time are in the agent row
    expect(expanded.some(r => /^ +⚠ asked fable/.test(r))).toBe(true)
    expect(expanded.some(r => /^ +last tool Grep$/.test(r))).toBe(true)

    // every pressable row of the tab is one truncating Text
    const rowsOfAgent = (n: unknown): unknown[] => {
      const o = n as { type?: string; props?: { key?: string; wrap?: string }; children?: unknown[] } | null
      return o?.type === 'Button' && o.props?.key === 'agent:a1' ? (o.children ?? []) : (o?.children ?? []).flatMap(rowsOfAgent)
    }
    const inner = rowsOfAgent(await ui.drawn())[0] as { type?: string; props?: { wrap?: string } } | undefined
    expect(inner?.type).toBe('Text')
    expect(inner?.props?.wrap).toBe('truncate')
    await ui.press({ key: 'agent:a1' })
    await ui.unmount()
  }
})

test('Subagents: a description with line breaks stays on its one row, under the expanded agent', async ($, on) => {
  const clock = world(on, { listed: [{ id: 'a1', status: 'running' }] })
  spawns(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.agent.spawn({ ...SPAWN, subagentType: 'reviewer', description: 'Review the filter\r\n\n  then report', model: 'fable' })
  await clock.advance(MIN)
  const ui = await mountPane($, 58)
  await ui.press({ key: 'tab:agents' })
  await ui.press({ key: 'agent:a1' })
  const rows = rowTexts(await ui.drawn())
  expect(rows.filter(r => /Review the filter/.test(r))).toEqual(['  Review the filter then report'])
  expect(rows.some(r => /^then report/.test(r.trim()))).toBe(false)
  await ui.unmount()
})

test('Subagents: the history rows are one row each, the name cut by display width (wide characters count two cells), and expand like a live one', async ($, on) => {
  const at = { startedAt: NOW - 60_000, endedAt: NOW - 30_000, tokens: 1234, isFailed: false }
  world(on, { dataFile: JSON.stringify({ history: [{ id: 'h1', type: 'a-reviewer-with-an-extremely-long-name-indeed', ...at }, { id: 'h2', type: '日本語のとても長いレビューアの名前です', ...at }], prs: [] }) })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 40)
  await ui.press({ key: 'tab:agents' })
  const rows = rowTexts(await ui.drawn())
  for (const re of [/^✓ a-re/, /^✓ 日本/]) {
    const row = rows.find(r => re.test(r)) ?? ''
    expect(textCells(row)).toBe(38)
    expect(row).toMatch(/…/)
    expect(row).toMatch(/ +1\.2k +\d+% +30s$/)
  }
  await ui.unmount()
})

test('Subagents: every agent of the session is listed, no cap and no … +n, at 40, 58 and 80 columns', async ($, on) => {
  world(on)
  spawns(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  for (let n = 1; n <= 15; n++) await spawnAgent($, `ag${n}`)
  for (const columns of [40, 58, 80]) {
    const { rows } = await paneRows($, columns, 'agents')
    for (let n = 1; n <= 15; n++) expect([n, rows.some(r => r.startsWith(`◐ ag${n} `))]).toEqual([n, true])
    expect(rows.some(r => /^… \+\d+$/.test(r))).toBe(false)
  }
})

// ── Context: TOP AGENTS, one row per agent that expands on a press ──

const HIGH = '\u{F12A3}'
const USAGE = { input_tokens: 1000, output_tokens: 10, cache_read_input_tokens: 9000, cache_creation_input_tokens: 0, model: 'claude-sonnet-5-5' }

/** Two agents (a1 with a description and an effort, a2 with neither) ended; a3 keeps running so the ended ones leave the list after two minutes. */
async function endedAgents($: Parameters<typeof mountPane>[0], on: Parameters<typeof world>[0]) {
  const clock = world(on, { listed: [{ id: 'a3', status: 'running' }] })
  spawns(on)
  on('turn.step', async function* (_, e) {
    yield { kind: 'text', index: 0, text: 'x' }
    return { turnId: e.turnId, index: e.index, answer: 'x', toolUses: [], stopReason: 'end_turn', usage: USAGE }
  })
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.agent.spawn({ ...SPAWN, subagentType: 'reviewer', description: 'Review doc XYZ' })
  await $.agent.spawn({ ...SPAWN, subagentType: 'Explore' })
  await spawnAgent($, 'other')
  for await (const chunk of $.turn.step({ turnId: 't', index: 0, model: 'claude-sonnet-5-5', effort: 'high', messageCount: 1, agentId: 'a1' })) void chunk
  await clock.advance(65_000)
  for (const id of ['a1', 'a2']) await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: `${id}-t`, agentId: id, reason: 'answer', usage: USAGE })
  return clock
}

test('Context: a TOP AGENTS row is one line at 30 and 58 columns: name, model word, effort icon, $ and cache hit', async ($, on) => {
  const clock = await endedAgents($, on)
  for (let i = 0; i < 3; i++) await clock.advance(60_000)
  for (const width of [30, 58]) {
    const ui = await mountPane($, width)
    await ui.press({ key: 'tab:context' })
    const row = rowTexts(await ui.drawn()).find(r => r.includes(HIGH) && r.startsWith('review')) ?? ''
    expect(textCells(row)).toBeLessThanOrEqual(width)
    expect(row).toMatch(/\$\d/)
    expect(row.startsWith('review')).toBe(true) // the name keeps at least 5 visible characters, whatever the width
    if (width === 30) expect(row).not.toMatch(/cache/) // too narrow: the cache hit gives way to the name
    if (width === 58) expect(row).toMatch(/^reviewer +son 5\.5 +\S \$\d+\.\d+ {2}cache 90% *$/u)
    await ui.unmount()
  }
})

test('Context: a press on a TOP AGENTS row expands its description, tokens, time, outcome and share of the session cost; a second press collapses; the Agents tab is not opened', async ($, on) => {
  await endedAgents($, on)
  const ui = await mountPane($, 58)
  await ui.press({ key: 'tab:context' })
  const rows = async () => rowTexts(await ui.drawn())
  expect((await rows()).some(r => /Review doc XYZ/.test(r))).toBe(false)
  await ui.press({ key: 'cost:a1' })
  const open = await rows()
  const at = open.findIndex(r => /^reviewer /.test(r))
  expect(open[at + 1]).toBe('  Review doc XYZ')
  expect(open[at + 2]).toMatch(/^ {2}tokens /)
  expect(open[at + 3]).toMatch(/^ {2}time /)
  expect(open[at + 4]).toBe('  done')
  await ui.press({ key: 'cost:a1' })
  expect((await rows()).some(r => /Review doc XYZ/.test(r))).toBe(false)
  await ui.press({ key: 'cost:a1' })
  await ui.press({ key: 'tab:agents' })
  expect((await rows()).some(r => /Review doc XYZ/.test(r))).toBe(false) // the Agents tab's own rows stay collapsed
  await ui.unmount()
})

test('Context: a finished agent shows its effort and its duration through its event', async ($, on) => {
  const clock = await endedAgents($, on)
  for (let i = 0; i < 3; i++) await clock.advance(60_000)
  const ui = await mountPane($, 58)
  expect(await ui.find({ key: 'agent:a1' })).toBeUndefined() // gone from the list: everything below comes from the event
  await ui.press({ key: 'tab:context' })
  expect(rowTexts(await ui.drawn()).some(r => /^reviewer /.test(r) && r.includes(HIGH))).toBe(true)
  await ui.press({ key: 'cost:a1' })
  expect(rowTexts(await ui.drawn()).some(r => /^ {2}time 1m/.test(r))).toBe(true)
  await ui.unmount()
})

test('Context: a TOP AGENTS entry from an event without the newer fields renders, the missing rows left out', () => {
  const event = { at: 1, kind: 'agent' as const, id: 'old', text: 'Explore', tokens: 5, usd: 0.5 }
  const [old] = agentCosts([], [event])
  expect(old).toBeDefined()
  if (!old) return
  expect(textCells(spanText(agentCostRow(old, 40)))).toBeLessThanOrEqual(40)
  expect(agentCostDetails(old, 0, undefined, '  ', 40).map(spanText)).toEqual(['  tokens 5'])
})

test('TOP AGENTS: the cost column sits at the same cell in every row, with or without a cache hit, short or long name', () => {
  const base = { type: 'x', tokens: 10, usd: 1.5, model: 'claude-sonnet-5-5' }
  for (const width of [30, 44, 58]) {
    const rows = [
      { ...base, id: 'a', type: 'ab', hit: 90 },
      { ...base, id: 'b', type: 'a-very-long-agent-name-that-is-cut-to-fit-the-row', hit: 100 },
      { ...base, id: 'c', type: 'no-hit' },
    ].map(a => spanText(agentCostRow(a, width)))
    for (const r of rows) expect(textCells(r)).toBeLessThanOrEqual(width)
    expect(new Set(rows.map(r => textCells(r.slice(0, r.indexOf('$')))))).toHaveProperty('size', 1)
  }
})

test('HISTORY: a row keeps the agent\'s versioned model and effort icon', async ($, on) => {
  world(on, { dataFile: JSON.stringify({ history: [{ ...entry('a1', 'two', NOW - 1000), effort: 'high' }, entry('a2', 'old', NOW - 2000)], prs: [] }) })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 58)
  await ui.press({ key: 'tab:agents' })
  expect((await ui.find({ key: 'history:a1' }))?.text).toMatch(/^✓ two +son 5\.5 +\u{F12A3} /u)
  expect((await ui.find({ key: 'history:a2' }))?.text).toMatch(/^✓ old +son 5\.5 {2}/)
  await ui.unmount()
})

test('TOP AGENTS: every agent, 3 shown, `▸ +2` opens the other two and `▾ −2` folds them', async ($, on) => {
  world(on)
  spawns(on)
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  for (let n = 1; n <= 5; n++) await spawnAgent($, `ag${n}`)
  // output tokens (hence cost) by agent: a2 > a4 > a5 > a1 > a3, none in spawn order
  const output = [200_000, 500_000, 100_000, 400_000, 300_000]
  for (const [i, tokens] of output.entries())
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: `a${i + 1}-t`, agentId: `a${i + 1}`, reason: 'answer', usage: { ...USAGE, output_tokens: tokens } })
  const ui = await mountPane($, 58)
  await ui.press({ key: 'tab:context' })
  const rows = async () => (await ui.findAll({ type: 'Button' })).map(b => b.key ?? '').filter(k => /^cost:a/.test(k))
  expect(await rows()).toEqual(['cost:a2', 'cost:a4', 'cost:a5'])
  expect((await ui.find({ key: 'costAgents:more' }))?.text).toBe('▸ +2')
  await ui.press({ key: 'costAgents:more' })
  expect(await rows()).toEqual(['cost:a2', 'cost:a4', 'cost:a5', 'cost:a1', 'cost:a3'])
  expect((await ui.find({ key: 'costAgents:more' }))?.text).toBe('▾ −2')
  await ui.press({ key: 'costAgents:more' })
  expect(await rows()).toEqual(['cost:a2', 'cost:a4', 'cost:a5'])
  await ui.unmount()
})
