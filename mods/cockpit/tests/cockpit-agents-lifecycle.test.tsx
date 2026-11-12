import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { orderAgents } from '../hooks/view-agents'
import { SPAWN, entry, fileOfSession, finishAgent, launchWorkflow, mountPane, openCockpit, settleAll, spawnAgent, spawnWorkflowAgent, spawns, workflowLaunches } from './cockpit-fixtures'
import { NOW, dataOf, rowTexts, world } from './cockpit-world'

type Ui = Awaited<ReturnType<typeof mountPane>>

/** The agents DONE lists, newest first, as `<icon> <type>`: the clock and the cost cells left out. */
const doneAgents = async (ui: Ui) =>
  rowTexts(await ui.drawn()).flatMap(r => {
    const m = /^[├└] \d\d:\d\d (?!→)(\S) (\S+)/u.exec(r)
    return m ? [`${m[1]} ${m[2]}`] : []
  })

/** A log entry of a finished agent, as the log keeps it. */
const logged = (id: string, type: string, at: number, isFailed = false) => ({ at, kind: 'agent', key: id, text: type, ms: 60_000, isFailed })

/** Starts a session in the test world. */
const start = ($: Engine) => $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

// Three spawns, two finishes and a mounted pane run near the 5 s default on a loaded machine.
test('agents: a finished agent leaves IN PROGRESS at once, DONE lists it with its outcome, and after 2 minutes the state file holds it as history', { timeoutMs: 15_000 }, async ($, on) => {
  const writes = new Map<string, string>()
  const clock = world(on, { writes, listed: [{ id: 'a3', status: 'running' }] })
  spawns(on)
  on('turn.complete', () => ({ text: '' }))
  await start($)
  for (const type of ['one', 'two', 'three']) await spawnAgent($, type)
  await finishAgent($, 'a1')
  await clock.advance(5_000)
  await finishAgent($, 'a2', 'error')

  const ui = await mountPane($)
  expect(await ui.find({ key: 'agent:a1' })).toBeUndefined()
  expect(await ui.find({ key: 'agent:a3' })).toBeDefined()
  expect(await doneAgents(ui)).toEqual(['󰅖 two', '󰄬 one'])
  // inside the two minutes the agents are still the live list's: no history yet
  expect(dataOf(writes)?.history ?? []).toEqual([])

  await clock.advance(130_000)
  expect(await doneAgents(ui)).toEqual(['󰅖 two', '󰄬 one'])
  expect(await ui.find({ key: 'agent:a3' })).toBeDefined()
  await ui.unmount()

  // the state file carries it, so a resume or a reload finds it
  await clock.advance(3000)
  expect(dataOf(writes)?.history).toEqual([
    { id: 'a2', type: 'two', model: 'claude-sonnet-5-5', startedAt: NOW, endedAt: NOW + 5000, tokens: 0, isFailed: true, description: 'go' },
    { id: 'a1', type: 'one', model: 'claude-sonnet-5-5', startedAt: NOW, endedAt: NOW, tokens: 0, isFailed: false, description: 'go' },
  ])
})

test('agents: one the engine lists as killed or failed ends with 󰅖, one it no longer lists with 󰄬', async ($, on) => {
  const clock = world(on, {
    listed: [
      { id: 'a1', status: 'killed' },
      { id: 'a2', status: 'failed' },
    ],
  })
  spawns(on)
  await start($)
  for (const type of ['one', 'two', 'three']) await spawnAgent($, type)
  await openCockpit($)
  await clock.advance(30_000)
  const ui = await mountPane($)
  expect(new Set(await doneAgents(ui))).toEqual(new Set(['󰅖 one', '󰅖 two', '󰄬 three']))
  await ui.unmount()
})

test('agents: DONE shows an open group with every agent it holds, and no `󰍟 +K` button while there are no more than 5 groups', async ($, on) => {
  const clock = world(on)
  spawns(on)
  on('turn.complete', () => ({ text: '' }))
  await start($)
  for (let n = 1; n <= 25; n++) await spawnAgent($, `agent-${n}`)
  for (let n = 1; n <= 25; n++) await finishAgent($, `a${n}`)
  await openCockpit($)
  await clock.advance(135_000)
  const ui = await mountPane($)
  expect(await doneAgents(ui)).toHaveLength(25)
  expect(await ui.find({ key: 'done:more' })).toBeUndefined()
  await ui.unmount()
})

test('agents: the history survives a reload (the session id reads its data file); another id starts empty', async ($, on) => {
  let id = 's-1'
  world(on, { sessionId: () => id, dataFile: JSON.stringify({ sessionLog: [logged('a8', 'reviewer', NOW - 90_000, true), logged('a9', 'implementer', NOW - 30_000)] }) })
  await start($)
  let ui = await mountPane($)
  expect(await doneAgents(ui)).toEqual(['󰄬 implementer', '󰅖 reviewer'])
  await ui.unmount()

  id = 's-2'
  await start($)
  ui = await mountPane($)
  expect(await doneAgents(ui)).toEqual([])
  expect(await ui.find({ type: 'Text', text: 'DONE' })).toBeUndefined()
  await ui.unmount()
})

test('agents: a /clear moves the finished agent still under 2 minutes into the ending session\'s history; the new session starts empty', async ($, on) => {
  let id = 's-1'
  const writes = new Map<string, string>()
  const clock = world(on, { sessionId: () => id, writes })
  spawns(on)
  on('turn.complete', () => ({ text: '' }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  await start($)
  await spawnAgent($, 'old')
  await finishAgent($, 'a1')
  id = 's-2'
  await $.session.end({ reason: 'clear', sessionId: 's-1', resume: { id: 's-1' } })
  expect(fileOfSession(writes, 's-1')?.history).toEqual([{ id: 'a1', type: 'old', model: 'claude-sonnet-5-5', startedAt: NOW, endedAt: NOW, tokens: 0, isFailed: false, description: 'go' }])
  await clock.advance(135_000)
  const ui = await mountPane($)
  expect(await doneAgents(ui)).toEqual([])
  expect(await ui.find({ key: 'agent:a1' })).toBeUndefined()
  await ui.unmount()
  expect(fileOfSession(writes, 's-2')?.history ?? []).toEqual([])
})

test('agents: a reload of the same session id keeps the live agents, the finished one too until its 2 minutes pass', async ($, on) => {
  const writes = new Map<string, string>()
  const clock = world(on, { writes, listed: [{ id: 'a1', status: 'running' }] })
  spawns(on)
  on('turn.complete', () => ({ text: '' }))
  await start($)
  await spawnAgent($, 'one')
  await spawnAgent($, 'two')
  await finishAgent($, 'a2')
  await start($)
  const ui = await mountPane($)
  expect(await ui.find({ key: 'agent:a1' })).toBeDefined()
  expect(await doneAgents(ui)).toEqual(['󰄬 two'])
  await clock.advance(135_000)
  expect(await ui.find({ key: 'agent:a1' })).toBeDefined()
  expect(await doneAgents(ui)).toEqual(['󰄬 two'])
  await ui.unmount()
  await clock.advance(3000)
  expect((dataOf(writes)?.history as { id: string }[]).map(h => h.id)).toEqual(['a2'])
})

test('agents: Given a data file from before agent entries, When the session resumes, Then LOG lists the finished agents of its history, an interrupted one left out', async ($, on) => {
  // Given
  const history = [{ ...entry('a1', 'running-one', NOW - 1000), isInterrupted: true }, entry('a2', 'finished-one', NOW - 2000)]
  world(on, { dataFile: JSON.stringify({ history }) })
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  // When
  await start($)
  await $.session.end({ reason: 'resume', sessionId: 's-1', resume: { id: 's-1' } })
  await start($)
  const ui = await mountPane($)
  // Then
  expect(await doneAgents(ui)).toEqual(['󰄬 finished-one'])
  await ui.unmount()
})

test('agents: entries a data file holds wrongly are left out, a file with no log means none', async ($, on) => {
  world(on, { dataFile: JSON.stringify({ sessionLog: [{ at: 1, kind: 'nope' }, 'text', logged('a1', 'ok', NOW - 1000)] }) })
  await start($)
  const ui = await mountPane($)
  expect(await doneAgents(ui)).toEqual(['󰄬 ok'])
  await ui.unmount()
})

test('orderAgents lists each level newest first, children right under their parent', () => {
  const a = (id: string, startedAt: number, parentId?: string) => ({ id, type: 't', status: 'running' as const, startedAt, tokens: 0, ...(parentId && { parentId }) })
  const out = orderAgents([a('old', 1), a('old-kid1', 2, 'old'), a('new', 5), a('old-kid2', 3, 'old'), a('new-kid', 6, 'new')])
  expect(out.map(r => `${r.depth}${r.agent.id}`)).toEqual(['0new', '1new-kid', '0old', '1old-kid2', '1old-kid1'])
})

// ── Workflow agents ──

test('workflow agents: a tick does not end an agent just because the engine does not list it; its own turn does', async ($, on) => {
  const clock = world(on) // $.agent.list() answers nothing: it never lists a workflow's agents
  spawns(on)
  on('turn.complete', () => ({ text: '' }))
  await start($)
  await spawnWorkflowAgent($, 'wf_1', 1)
  await spawnWorkflowAgent($, 'wf_1', 2)
  await clock.advance(30_000) // two ticks
  const ui = await mountPane($)
  expect((await ui.find({ key: 'agent:a1' }))?.text).toMatch(/^implementer/)
  expect((await ui.find({ key: 'agent:a2' }))?.text).toMatch(/^implementer/)
  await finishAgent($, 'a1')
  await clock.advance(30_000)
  expect(await ui.find({ key: 'agent:a1' })).toBeUndefined()
  expect((await ui.find({ key: 'agent:a2' }))?.text).toMatch(/^implementer/)
  expect(await doneAgents(ui)).toEqual(['󰄬 implementer'])
  await ui.unmount()
})

test('workflow agents: an explicit failed or killed listing ends them', async ($, on) => {
  const clock = world(on, { listed: [{ id: 'a1', status: 'killed' }] })
  spawns(on)
  await start($)
  await spawnWorkflowAgent($, 'wf_1', 1)
  await spawnWorkflowAgent($, 'wf_1', 2)
  await openCockpit($)
  await clock.advance(30_000)
  const ui = await mountPane($)
  expect(await ui.find({ key: 'agent:a1' })).toBeUndefined()
  expect((await ui.find({ key: 'agent:a2' }))?.text).toMatch(/^implementer/)
  expect(await doneAgents(ui)).toEqual(['󰅖 implementer'])
  await ui.unmount()
})

test('workflow agents: the end of their run (silence past the limit) ends the ones still running and closes the run; a step keeps it open', async ($, on) => {
  const instructions: (string | undefined)[] = []
  const clock = world(on, { instructions })
  spawns(on)
  workflowLaunches(on, 'release-notes')
  on('tool.call', { tool: 'Grep' }, () => ({ result: {} }))
  await start($)
  await launchWorkflow($, 'release-notes')
  await spawnWorkflowAgent($, 'wf_1', 1)
  await clock.advance(10 * 60_000)
  await $.tool.call({ tool: 'Grep', pattern: 'x', agentId: 'a1' }) // a step: the silence starts over
  await clock.advance(10 * 60_000)
  let ui = await mountPane($)
  expect((await ui.find({ key: 'agent:a1' }))?.text).toMatch(/^implementer/)
  await ui.unmount()
  await clock.advance(6 * 60_000)
  ui = await mountPane($)
  expect(await ui.find({ key: 'agent:a1' })).toBeUndefined()
  // the stall that closed the run is logged when it first held, beside the agent it ended
  expect(await doneAgents(ui)).toEqual(['󰄬 implementer', '󰏥 workflow'])
  await ui.press({ key: 'bar:compact' })
  expect(instructions.at(-1)).not.toContain('Running workflow')
  await ui.unmount()
})

test('workflow agents: a run whose agents the listing ends closes with them, and a spawn after it reopens it', async ($, on) => {
  const instructions: (string | undefined)[] = []
  const clock = world(on, { instructions, listed: [{ id: 'a1', status: 'killed' }] })
  spawns(on)
  workflowLaunches(on, 'release-notes')
  await start($)
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

test('agents: a tool call seen before its agent spawned does not make a stub that the spawn later fills', async ($, on) => {
  world(on, { listed: [{ id: 'a1', status: 'running' }] })
  spawns(on)
  on('tool.call', { tool: 'Grep' }, () => ({ result: {} }))
  await start($)
  await $.tool.call({ tool: 'Grep', pattern: 'Order', agentId: 'a1' })
  await $.agent.spawn({ ...SPAWN, subagentType: 'code-reviewer', description: 'Review the orders filter' })
  const ui = await mountPane($, 50)
  await ui.press({ key: 'agent:a1' })
  const rows = async () => rowTexts(await ui.drawn())
  expect((await rows()).find(r => /^ +Review the orders filter/.test(r))).toBeDefined()
  expect((await rows()).some(r => /last tool/.test(r))).toBe(false)
  // a call after the spawn is seen as before
  await $.tool.call({ tool: 'Grep', pattern: 'Order', agentId: 'a1' })
  expect((await rows()).some(r => /^ +last tool Grep$/.test(r))).toBe(true)
  await ui.unmount()
})

test('agents: IN PROGRESS shows the newest 5 and the button opens the rest, none capped away', async ($, on) => {
  world(on)
  spawns(on)
  await start($)
  for (let n = 1; n <= 15; n++) await spawnAgent($, `ag${n}`)
  const ui = await mountPane($, 58)
  const live = async () => (await ui.findAll({ type: 'Button' })).filter(b => /^agent:/.test(b.key ?? '')).length
  expect(await live()).toBe(5)
  expect((await ui.find({ key: 'inProgress:more' }))?.text).toBe('󰍟 +10')
  await ui.press({ key: 'inProgress:more' })
  expect(await live()).toBe(15)
  await settleAll()
  await ui.unmount()
})

test('flow: given a run silent past the limit, when the tick closes it, then no flow node is logged until another run replaces it, and then it is logged failed', { timeoutMs: 15_000 }, async ($, on) => {
  // Given
  const writes = new Map<string, string>()
  const clock = world(on, { writes })
  spawns(on)
  await start($)
  await openCockpit($)
  await spawnWorkflowAgent($, 'w1', 1)
  // When
  await clock.advance(16 * 60_000)
  await clock.advance(3000)
  const before = (dataOf(writes)?.sessionLog as Array<{ kind: string }> | undefined) ?? []
  await spawnWorkflowAgent($, 'w2', 1)
  await clock.advance(3000)
  const after = (dataOf(writes)?.sessionLog as Array<{ kind: string; key?: string; isFailed?: boolean }> | undefined) ?? []
  // Then
  expect(before.filter(e => e.kind === 'flow')).toEqual([])
  expect(after.filter(e => e.kind === 'flow')).toMatchObject([{ key: 'w1', isFailed: true }])
})
