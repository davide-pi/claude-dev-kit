import { expect, test } from 'claude-code/testing'

import {
  askPerson,
  callAs,
  gatedBash,
  headerOf,
  launchWorkflow,
  loadSkill,
  mountPane,
  paneRows,
  permissionChecks,
  settleAll,
  skillTool,
  workflowLaunches,
} from './cockpit-fixtures'
import { NOW, flagOf, world } from './cockpit-world'

test('header: the Claude state follows turn.start, a thinking chunk, a tool in flight, a permission ask and the turn end', async ($, on) => {
  world(on)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  const gates: Record<string, () => void> = {}
  const gate = (name: string) => new Promise<void>(resolve => void (gates[name] = resolve))
  const stepGate = gate('step')
  on('turn.step', async function* (_, e) {
    yield { kind: 'thinking', index: 0, text: 'hm' }
    await stepGate
    yield { kind: 'text', index: 1, text: 'ok' }
    return { turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  const toolGate = gate('tool')
  on('tool.call', { tool: 'Bash' }, async () => {
    await toolGate
    return { result: {} }
  })
  permissionChecks(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const state = async () => headerOf((await paneRows($)).rows)[0] ?? ''

  expect(await state()).toContain('ready')
  await $.turn.start({ text: 'go', turnId: 't1' })
  expect(await state()).toContain('working')

  const stream = $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 })
  await stream.next() // the thinking chunk
  expect(await state()).toContain('thinking')
  gates.step?.()
  for await (const chunk of stream) void chunk
  expect(await state()).toContain('working')

  const call = callAs($, 'c1', { tool: 'Bash', command: 'ls' })
  await settleAll()
  expect(await state()).toContain('Bash')
  // the engine finds a person has to answer: waiting until that call ends (approved and run, or refused)
  await askPerson($, 'c1')
  expect(await state()).toContain('waiting')
  gates.tool?.()
  await call
  expect(await state()).toContain('working')

  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  expect(await state()).toContain('ready')
})

test('header: a subagent\'s events do not move the Claude state', async ($, on) => {
  world(on)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: {} }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'go', turnId: 't1', agentId: 'a1' })
  await $.tool.call({ tool: 'Bash', command: 'ls', agentId: 'a1' })
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 'a1-t', agentId: 'a1', reason: 'answer' })
  expect(headerOf((await paneRows($)).rows)[0]).toContain('ready')
})

test('refresh tiers: fast 2 s while a tab with a clock is selected, medium 10 s for git whatever the tab while the pane is open, slow 30 s always, none while the pane is closed', async ($, on) => {
  const statusCalls: string[] = []
  const listCalls: string[] = []
  const clock = world(on, { statusCalls, listCalls })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(4000)
  expect(listCalls).toHaveLength(0) // the pane is closed: nothing to keep fresh at 2 s
  expect(statusCalls.length).toBe(1) // the one git read of the session start

  await $.command.run({ command: 'cockpit', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 80 } })
  const ui = await mountPane($, 50)
  const reset = () => {
    statusCalls.length = 0
    listCalls.length = 0
  }
  reset()
  await clock.advance(2000) // t = 6 s: the fast timer ticked once (Subagents has elapsed times)
  expect(listCalls.length).toBeGreaterThanOrEqual(1)
  expect(statusCalls).toHaveLength(0)

  await ui.press({ key: 'tab:history' })
  await settleAll()
  reset()
  await clock.advance(3000) // t = 9 s: Cronologia has no clock and git is not due yet
  expect(listCalls).toHaveLength(0)
  expect(statusCalls).toHaveLength(0)
  await clock.advance(1500) // t = 10.5 s: the medium timer ticked
  await settleAll()
  expect(statusCalls.length).toBeGreaterThanOrEqual(1)

  await ui.press({ key: 'tab:agents' })
  await settleAll()
  reset()
  await clock.advance(10_000) // t = 20.5 s: the medium timer ticked at 20 s: the header shows git on every tab
  await settleAll()
  expect(listCalls.length).toBeGreaterThanOrEqual(1)
  expect(statusCalls.length).toBeGreaterThanOrEqual(1)

  reset()
  await clock.advance(10_000) // t = 30.5 s: the slow timer ticked, whatever tab is selected
  await settleAll()
  expect(statusCalls.length).toBeGreaterThanOrEqual(1)
  await ui.unmount()
})

test('refresh tiers: the state file heartbeat stays fresh while the pane is open, at the slow tier', async ($, on) => {
  const writes = new Map<string, string>()
  const clock = world(on, { writes })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'cockpit', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 80 } })
  await clock.advance(30_000)
  await settleAll()
  const at = (flagOf(writes) as { at: number }).at
  expect(NOW + 30_000 - at).toBeLessThan(30_000)
  expect(at).toBeGreaterThan(NOW)
})

// ── Phase 2 follow-ups ──

test('header: parallel main tool calls keep the state on a tool until none is left, and a permission wait restores the tool held before', async ($, on) => {
  world(on)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  const gates: Record<string, () => void> = {}
  const gate = (name: string) => new Promise<void>(resolve => void (gates[name] = resolve))
  const bashGate = gate('bash')
  const readGate = gate('read')
  permissionChecks(on)
  on('tool.call', { tool: 'Bash' }, async () => {
    await bashGate
    return { result: {} }
  })
  on('tool.call', { tool: 'Read' }, async () => {
    await readGate
    return { result: {} }
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const state = async () => headerOf((await paneRows($)).rows)[0] ?? ''
  await $.turn.start({ text: 'go', turnId: 't1' })

  const bash = callAs($, 'cb', { tool: 'Bash', command: 'ls' })
  await settleAll()
  const read = callAs($, 'cr', { tool: 'Read', file_path: '/a' })
  await settleAll()
  expect(await state()).toContain('Read')

  // the person is asked about the Read: waiting until it ends, and then the state is on the tool still in flight
  await askPerson($, 'cr', 'Read')
  expect(await state()).toContain('waiting')
  gates.read?.()
  await read
  expect(await state()).toContain('Bash')

  gates.bash?.()
  await bash
  expect(await state()).toContain('working')
})

test('header: only a main-loop ask a person answers waits: a host approver, a subagent, an allow and a check with no call id do not', async ($, on) => {
  world(on)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  let verdict: 'ask' | 'allow' = 'ask'
  on('tool.check', () => ({ decision: verdict }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const state = async () => headerOf((await paneRows($)).rows)[0] ?? ''
  await $.turn.start({ text: 'go', turnId: 't1' })
  const check = (extra: Record<string, unknown>) => $.tool.check({ tool: 'Bash', input: {}, ...extra } as never)

  await check({ approver: 'host', tool_use_id: 'x1' })
  await check({ approver: 'person', tool_use_id: 'x2', agentId: 'a1' })
  await check({ approver: 'person' })
  expect(await state()).toContain('working')
  verdict = 'allow'
  await check({ approver: 'person', tool_use_id: 'x3' })
  expect(await state()).toContain('working')
  verdict = 'ask'
  await check({ approver: 'person', tool_use_id: 'x4' })
  expect(await state()).toContain('waiting')
  // a new turn forgets an ask whose call never ended (a crash, an interrupt)
  await $.turn.start({ text: 'again', turnId: 't2' })
  expect(await state()).toContain('working')
})

test('refresh tiers: the slow tick writes the heartbeat before the clock tick runs', async ($, on) => {
  const writes = new Map<string, string>()
  let hold: Promise<void> | undefined
  const clock = world(on, { writes, holdList: () => hold })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'cockpit', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 80 } })
  hold = new Promise<void>(() => {}) // the clock tick never gets its list of agents
  await clock.advance(30_000)
  await settleAll()
  expect((flagOf(writes) as { at: number }).at).toBe(NOW + 30_000)
})

test('turn.step: the main loop\'s chunks read the snapshot once per change of state, not once per chunk', async ($, on) => {
  let reads = 0
  world(on)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('state.get', (_, e, next) => {
    reads++
    return next(e)
  })
  on('turn.step', async function* (_, e) {
    for (let i = 0; i < (e.index === 2 ? 6 : 1); i++) yield { kind: 'text', index: i, text: 'x' }
    return { turnId: e.turnId, index: e.index, answer: 'x', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'go', turnId: 't1' })
  const run = async (index: number) => {
    const before = reads
    for await (const chunk of $.turn.step({ turnId: 't1', index, model: 'claude-opus-5-5', messageCount: 1 })) void chunk
    return reads - before
  }
  await run(0) // the first step also writes the model and the effort
  const one = await run(1)
  expect(await run(2)).toBe(one) // five more chunks of the same kind cost no read
})

test('events that really arrive: with the classic events never dispatched, skills, the wait for a person and the workflow name all still show', async ($, on) => {
  const instructions: (string | undefined)[] = []
  world(on, { instructions })
  permissionChecks(on)
  skillTool(on)
  workflowLaunches(on, 'release-notes')
  const release = gatedBash(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const state = async () => headerOf((await paneRows($)).rows)[0] ?? ''

  await loadSkill($, 'commit')
  await launchWorkflow($, 'release-notes')
  const call = callAs($, 'c1', { tool: 'Bash', command: 'rm x' })
  await settleAll()
  await askPerson($, 'c1')
  expect(await state()).toContain('waiting')
  release('rm x')
  await call
  expect(await state()).not.toContain('waiting')

  const ui = await mountPane($)
  await ui.press({ key: 'bar:compact' })
  expect(instructions[0]).toContain('Workflow in corso: release-notes.')
  await ui.unmount()
  expect((await paneRows($, 50, 'history')).rows.some(r => /commit/.test(r))).toBe(true)
})
