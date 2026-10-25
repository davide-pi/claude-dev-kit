import { expect, test } from 'claude-code/testing'

import { headerOf, mountPane, paneRows, settleAll } from './cockpit-fixtures'
import { NOW, flagOf, world } from './cockpit-world'

test('header: the Claude state follows turn.start, a thinking chunk, a tool in flight, a permission request, a notification and the turn end', async ($, on) => {
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
  const askGate = gate('ask')
  on('classic.PermissionRequest', async () => {
    await askGate
    return { decision: { behavior: 'allow' } }
  })
  on('classic.Notification', () => ({}))
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

  const call = $.tool.call({ tool: 'Bash', command: 'ls' })
  await settleAll()
  expect(await state()).toContain('Bash')
  gates.tool?.()
  await call
  expect(await state()).toContain('working')

  const ask = $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: {} })
  await settleAll()
  expect(await state()).toContain('waiting')
  gates.ask?.()
  await ask
  expect(await state()).toContain('working')

  await $.classic.Notification({ message: 'Claude needs your attention', notification_type: 'permission_prompt' })
  expect(await state()).toContain('waiting')

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

  await ui.press({ key: 'tab:insights' })
  await settleAll()
  reset()
  await clock.advance(3000) // t = 9 s: Insights has no clock and git is not due yet
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
  const askGate = gate('ask')
  on('tool.call', { tool: 'Bash' }, async () => {
    await bashGate
    return { result: {} }
  })
  on('tool.call', { tool: 'Read' }, async () => {
    await readGate
    return { result: {} }
  })
  on('classic.PermissionRequest', async () => {
    await askGate
    return { decision: { behavior: 'allow' } }
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const state = async () => headerOf((await paneRows($)).rows)[0] ?? ''
  await $.turn.start({ text: 'go', turnId: 't1' })

  const bash = $.tool.call({ tool: 'Bash', command: 'ls' })
  await settleAll()
  const read = $.tool.call({ tool: 'Read', file_path: '/a' })
  await settleAll()
  expect(await state()).toContain('Read')

  gates.read?.()
  await read
  // Bash is still in flight: not back to working, and the tool shown is the one left
  expect(await state()).toContain('Bash')

  const ask = $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: {} })
  await settleAll()
  expect(await state()).toContain('waiting')
  gates.ask?.()
  await ask
  expect(await state()).toContain('Bash')

  gates.bash?.()
  await bash
  expect(await state()).toContain('working')
})

test('header: a notification while idle does not switch to waiting; while working it does', async ($, on) => {
  world(on)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('classic.Notification', () => ({}))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const state = async () => headerOf((await paneRows($)).rows)[0] ?? ''
  const notify = () => $.classic.Notification({ message: 'Claude is waiting for your input', notification_type: 'idle_prompt' })

  await notify() // before any event the state reads as idle
  expect(await state()).toContain('ready')
  await $.turn.start({ text: 'go', turnId: 't1' })
  await notify()
  expect(await state()).toContain('waiting')
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  await notify()
  expect(await state()).toContain('ready')
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
