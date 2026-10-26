import { expect, test } from 'claude-code/testing'

import { spanText, textCells } from '../hooks/shared'
import { agentCosts } from '../hooks/signals'
import { agentCostDetails, agentCostRow } from '../hooks/view-agents'
import { SPAWN, entry, mountPane, spawnAgent, spawns } from './cockpit-fixtures'
import { NOW, rowTexts, world } from './cockpit-world'

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
