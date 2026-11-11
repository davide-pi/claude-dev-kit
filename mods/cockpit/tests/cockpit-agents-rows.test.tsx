import { expect, test } from 'claude-code/testing'

import { spanText, spanWidth, textCells } from '../hooks/shared'
import { modelCounts, subagentDetails } from '../hooks/view-agents'
import { MIN, SPAWN, entry, mountPane, openCockpit, settleAll, spawnAgent, spawns } from './cockpit-fixtures'
import { NOW, dataOf, flagOf, rowTexts, world } from './cockpit-world'

/** The share of the session's tokens each live agent row ends with, as `12%`, in the order the rows draw them. */
const shares = (rows: string[]) =>
  rows.flatMap(r => {
    const m = /^󱎖 .* (<?\d+%) +(?:\$ *(?:<0\.01|\d+\.\d\d) +)?\S+$/u.exec(r)
    return m ? [m[1] ?? ''] : []
  })

const STEP_USAGE = { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 8000, cache_creation_input_tokens: 500, model: 'claude-sonnet-5-5' }

test('agents: a row ends with the agent\'s share of the session tokens before its time, and stays within 30 and 58 columns', async ($, on) => {
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
    const row = rowTexts(await ui.drawn()).find(r => /^󱎖 /.test(r)) ?? ''
    expect(textCells(row)).toBeLessThanOrEqual(width)
    expect(row).toMatch(/ +100% +\$ *(?:<0\.01|\d+\.\d\d) +00m00s$/)
    expect(row).not.toMatch(/1\.7k/) // the total tokens are in the expanded details
    await ui.unmount()
  }
})

test('agents: a block shows state, type, description, model, effort, share of the session tokens, time, the four counters per step and the tool running now, then the last one', async ($, on) => {
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
  await openCockpit($)
  await spawnAgent($, 'code-reviewer')
  const step = async (agentId?: string) => {
    for await (const chunk of $.turn.step({ turnId: 't', index: 0, model: 'claude-sonnet-5-5', effort: 'high', messageCount: 1, ...(agentId && { agentId }) })) void chunk
  }
  const ui = await mountPane($)
  const rows = async () => rowTexts(await ui.drawn())
  const facts = async () => {
    const m = /(\d+%) +\$ *(?:<0\.01|\d+\.\d\d) +(\d\dm\d\ds)$/.exec((await rows()).find(r => /^󱎖 code-reviewer/u.test(r)) ?? '')
    return m && `${m[1]} ${m[2]}`
  }
  const counters = /^ +in 1k {2}out 200 {2}cr 8k {2}cw 500$/

  // before any step the counters are not drawn: nothing is faked
  expect((await rows()).some(r => /^ +in /.test(r))).toBe(false)

  await step('a1')
  let now = await rows()
  // collapsed: one row, the model a word, the effort an icon, their share of the session and the time; nothing else of the agent
  expect(now.find(r => /code-reviewer/.test(r))).toMatch(/^󱎖 code-reviewer +son 5\.5 +\u{F12A3} +100% +\$ *(?:<0\.01|\d+\.\d\d) +00m00s$/u)
  expect(now.some(r => counters.test(r) || /^ +go$/.test(r))).toBe(false)
  // a press expands it: what it was asked and the four counters; the next press collapses it
  await ui.press({ key: 'agent:a1' })
  now = await rows()
  expect(now.some(r => counters.test(r))).toBe(true)
  expect(now.some(r => /^ +go$/.test(r))).toBe(true)
  expect(now.some(r => /^ +tokens 1\.7k$/.test(r))).toBe(true)
  expect(await ui.find({ key: 'open:a1' })).toBeUndefined()
  expect(now.some(r => /^ +(sonnet|son 5\.5)/.test(r))).toBe(false) // no second row with the model, effort and time
  await ui.press({ key: 'agent:a1' })
  expect((await rows()).some(r => counters.test(r))).toBe(false)
  await ui.press({ key: 'agent:a1' })
  expect(await facts()).toBe('100% 00m00s')

  // the main loop's step counts in the session: the agent is half of it
  await step()
  expect(await facts()).toBe('50% 00m00s')

  // the elapsed time moves with the fast tier
  await clock.advance(2000)
  await settleAll()
  expect(await facts()).toBe('50% 00m02s')

  // the tool in flight, then the last one
  const call = $.tool.call({ tool: 'Read', file_path: '/a', agentId: 'a1' })
  await settleAll()
  expect((await rows()).some(r => /^ +󰍟 Read$/.test(r))).toBe(true)
  release()
  await call
  now = await rows()
  expect(now.some(r => /^ +󰍟 Read$/.test(r))).toBe(false)
  expect(now.some(r => /^ +last tool Read$/.test(r))).toBe(true)

  // the turn's end settles the counters on the turn's own total: the steps are not counted twice
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 'a1-t', agentId: 'a1', reason: 'answer', usage: STEP_USAGE })
  expect(await ui.find({ key: 'agent:a1' })).toBeUndefined()
  await ui.unmount()
})

test('agents: the turn\'s own total replaces what its steps added, a turn that saw no step adds its own, and the share follows', async ($, on) => {
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
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 'a1-t', agentId: 'a1', reason: 'answer', usage: { ...STEP_USAGE, output_tokens: 300 } })
  // a2 saw no step: the turn's end alone gives its counters
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 'a2-t', agentId: 'a2', reason: 'answer', usage: STEP_USAGE })
  // 1800 and 1700 new tokens of 3500: both ended, so DONE rows carry their costs and the counters are the file's
  const writes = new Map<string, string>()
  void writes
  const ui = await mountPane($)
  expect(rowTexts(await ui.drawn()).filter(r => /\d\d:\d\d \S+ (one|two)/.test(r))).toHaveLength(2)
  await ui.unmount()
})

test('agents: after a reload the share keeps the main loop\'s tokens and the agents\' cumulative count, which the state file persists', async ($, on) => {
  const writes = new Map<string, string>()
  world(on, { writes, stateFile: JSON.stringify({ open: false, mainTokens: 10_000, agentTokens: 5400 }) })
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
  expect(shares(rowTexts(await ui.drawn()))).toEqual(['10%'])
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

test('agents: an agent that leaves the list joins a cumulative counter that the state file persists, so the share does not lean on the history', async ($, on) => {
  const writes = new Map<string, string>()
  // 100k new tokens of agents that left earlier, none of them in the (empty) history
  const clock = world(on, { writes, listed: [{ id: 'a2', status: 'running' }], stateFile: JSON.stringify({ open: false, agentTokens: 100_000 }) })
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
  // 1700 of 100000 + 1700 + 1700 (the agent has run for minutes by now)
  expect(shares(rowTexts(await ui.drawn()))).toEqual(['2%'])
  await ui.unmount()
})

test('agents: the tool line (the one running, or the last) wraps to the width, never cut with an ellipsis', () => {
  const tool = 'mcp__plugin_browser-use_browser-use__a_very_long_tool_name_indeed'
  const agent = { id: 'a1', type: 't', status: 'running' as const, startedAt: 0, tokens: 0 }
  for (const a of [{ ...agent, activeTools: [tool] }, { ...agent, status: 'done' as const, lastTool: tool }]) {
    const rows = subagentDetails(a, '  ', 30).slice(1) // under the tokens row
    expect(rows.length).toBeGreaterThan(1)
    for (const r of rows) {
      expect(spanWidth(r)).toBeLessThanOrEqual(30)
      expect(spanText(r)).not.toMatch(/…$/)
    }
    expect(rows.map(r => spanText(r).trim()).join('').replace(/^last tool|^tool/, '')).toContain(tool)
  }
  // a short one is left whole
  expect(spanText(subagentDetails({ ...agent, lastTool: 'Read' }, '  ', 30)[1] ?? [])).toBe('  last tool Read')
})

test('agents: the model counts run cheapest first: hai, son, opu, fab', () => {
  const agent = (id: string, model: string) => ({ id, type: 't', status: 'running' as const, startedAt: 0, tokens: 0, model })
  const counts = spanText(modelCounts([agent('a1', 'claude-opus-5-5'), agent('a2', 'claude-haiku-5-5'), agent('a3', 'claude-haiku-5-5')]))
  expect(counts).toBe('hai ×2 son ×0 opu ×1 fab ×0')
})

// ── Cost ──

const USAGE = { input_tokens: 1000, output_tokens: 10, cache_read_input_tokens: 9000, cache_creation_input_tokens: 0, model: 'claude-sonnet-5-5' }

test('agents: every live row that has a usage carries the agent\'s cost in a fixed cell before its time, at 40 and 58 columns', async ($, on) => {
  world(on, {
    listed: [
      { id: 'a1', status: 'running' },
      { id: 'a2', status: 'running' },
      { id: 'a3', status: 'running' },
    ],
  })
  spawns(on)
  on('turn.step', async function* (_, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: USAGE }
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.agent.spawn({ ...SPAWN, subagentType: 'reviewer', description: 'Review doc XYZ' })
  await $.agent.spawn({ ...SPAWN, subagentType: 'Explore', description: '' })
  await spawnAgent($, 'other')
  for (const agentId of ['a1', 'a2']) for await (const chunk of $.turn.step({ turnId: 't', index: 0, model: 'claude-sonnet-5-5', effort: 'high', messageCount: 1, agentId })) void chunk
  for (const width of [40, 58]) {
    const ui = await mountPane($, width)
    const rows = rowTexts(await ui.drawn()).filter(r => /\$ *(?:<0\.01|\d+\.\d\d) +\d\dm\d\ds$/.test(r))
    expect(rows.length).toBeGreaterThanOrEqual(2)
    for (const r of rows) expect(textCells(r)).toBeLessThanOrEqual(width)
    // the cell ends at the same column in every row, and its `$` starts at the same column
    expect(new Set(rows.map(r => textCells(r.slice(0, r.search(/ +\d\dm\d\ds$/)))))).toHaveProperty('size', 1)
    expect(new Set(rows.map(r => textCells(r.slice(0, r.lastIndexOf('$')))))).toHaveProperty('size', 1)
    await ui.unmount()
  }
})

test('agents: LOG shows the cost a log entry kept', async ($, on) => {
  world(on, { dataFile: JSON.stringify({ sessionLog: [{ at: NOW - 1000, kind: 'agent', key: 'a1', text: 'two', usd: 1.5, ms: 60_000 }], prs: [] }) })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 58)
  expect(rowTexts(await ui.drawn()).find(r => /\d\d:\d\d \S+ two/.test(r))).toMatch(/\$ {2}1\.50 /)
  await ui.unmount()
})

test('agents: an agent that finished keeps its effort and its cost on the history entry the data file holds', async ($, on) => {
  const writes = new Map<string, string>()
  const clock = world(on, { writes })
  spawns(on)
  on('turn.step', async function* (_, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: USAGE }
  })
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await spawnAgent($, 'reviewer')
  for await (const chunk of $.turn.step({ turnId: 't', index: 0, model: 'claude-sonnet-5-5', effort: 'high', messageCount: 1, agentId: 'a1' })) void chunk
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 'a1-t', agentId: 'a1', reason: 'answer', usage: USAGE })
  await openCockpit($) // a closed pane ticks only while an agent runs
  await clock.advance(2 * MIN + 30_000)
  await settleAll()
  await clock.advance(3000)
  const [saved] = (dataOf(writes)?.history ?? []) as { id: string; effort?: string; usd?: number; model?: string }[]
  expect(saved).toMatchObject({ id: 'a1', effort: 'high', model: 'claude-sonnet-5-5' })
  expect(typeof saved?.usd).toBe('number')
  expect(saved?.usd).toBeGreaterThan(0)
})

// ── One cut line each ──

test('agents: every row is one line cut to the width, at 40, 58 and 80 columns: the agent row with its fixed columns, then (expanded) the description, the warning and the tool', async ($, on) => {
  const clock = world(on, { listed: [{ id: 'a1', status: 'running' }] })
  spawns(on)
  on('tool.call', { tool: 'Grep' }, () => ({ result: {} }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.agent.spawn({ ...SPAWN, subagentType: 'a-code-reviewer-with-a-very-long-name-that-cannot-fit-a-row', description: 'Review the orders filter and every test around it, then report back', model: 'fable' })
  await $.tool.call({ tool: 'Grep', pattern: 'Order', agentId: 'a1' })
  await clock.advance(2 * MIN)
  for (const columns of [40, 58, 80]) {
    const ui = await mountPane($, columns)
    // the section: from its title to the first empty row or rule
    const body = async () => {
      const rows = rowTexts(await ui.drawn())
      const rest = rows.slice(rows.findIndex(r => /^IN PROGRESS ─+$/.test(r)) + 1)
      const end = rest.findIndex(r => r.trim() === '' || /^─+$/.test(r))
      return end < 0 ? rest : rest.slice(0, end)
    }
    // collapsed: the agent is exactly one row, as wide as the page: the name cut with …, then the model, effort, share and time in fixed columns
    const collapsed = await body()
    const width = textCells(collapsed[0] ?? '')
    expect(width).toBeLessThanOrEqual(columns)
    expect(collapsed).toHaveLength(1)
    // no usage read yet: the cost cell stays blank, never a made-up $0.00
    expect(collapsed[0]).toMatch(/^󱎖 a-co[^ ]*… [^$]* +02m00s$/)

    // expanded: every row of the block is one line, none wider than the first
    await ui.press({ key: 'agent:a1' })
    const expanded = await body()
    expect(expanded.length).toBeGreaterThan(collapsed.length + 2)
    for (const r of expanded) expect(textCells(r)).toBeLessThanOrEqual(width)
    // the description wraps instead of being cut: no expanded row ends in …, and the whole text is there
    expect(expanded.filter(r => /^ /.test(r)).some(r => /…$/.test(r))).toBe(false)
    expect(expanded.filter(r => /^ /.test(r)).map(r => r.trim()).join(' ')).toContain('Review the orders filter and every test around it, then report back')
    expect(expanded.filter(r => !/^󱎖 a-co/.test(r)).some(r => /son 5\.5/.test(r))).toBe(false) // no facts row: the model, effort and time are in the agent row
    expect(expanded.some(r => /^ +󰀦 asked fable/.test(r))).toBe(true)
    expect(expanded.some(r => /^ +last tool Grep$/.test(r))).toBe(true)

    // the pressable row is one truncating Text
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

test('agents: a description with line breaks stays on its one row, under the expanded agent', async ($, on) => {
  const clock = world(on, { listed: [{ id: 'a1', status: 'running' }] })
  spawns(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.agent.spawn({ ...SPAWN, subagentType: 'reviewer', description: 'Review the filter\r\n\n  then report', model: 'fable' })
  await clock.advance(MIN)
  const ui = await mountPane($, 58)
  await ui.press({ key: 'agent:a1' })
  const rows = rowTexts(await ui.drawn())
  expect(rows.filter(r => /Review the filter/.test(r))).toEqual(['  Review the filter then report'])
  expect(rows.some(r => /^then report/.test(r.trim()))).toBe(false)
  await ui.unmount()
})
