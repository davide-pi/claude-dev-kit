import { expect, test } from 'claude-code/testing'

import { textCells } from '../hooks/shared'
import { SPAWN, entry, mountPane, spawnAgent, spawns } from './cockpit-fixtures'
import { NOW, rowTexts, world } from './cockpit-world'

// ── Agents: each row shows the agent's cost; the Context tab lists no agents ──

const USAGE = { input_tokens: 1000, output_tokens: 10, cache_read_input_tokens: 9000, cache_creation_input_tokens: 0, model: 'claude-sonnet-5-5' }

/** Two agents (a1 with a description and an effort, a2 with neither) ended; a3 keeps running so the ended ones stay listed for two minutes. */
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
  await $.agent.spawn({ ...SPAWN, subagentType: 'Explore', description: '' })
  await spawnAgent($, 'other')
  for await (const chunk of $.turn.step({ turnId: 't', index: 0, model: 'claude-sonnet-5-5', effort: 'high', messageCount: 1, agentId: 'a1' })) void chunk
  await clock.advance(5_000)
  for (const id of ['a1', 'a2']) await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: `${id}-t`, agentId: id, reason: 'answer', usage: USAGE })
  return clock
}

test('Context: no TOP AGENTS block and no cost buttons, whatever the agents did', async ($, on) => {
  await endedAgents($, on)
  const ui = await mountPane($, 58)
  await ui.press({ key: 'tab:context' })
  expect(rowTexts(await ui.drawn()).some(r => /TOP AGENTS|^reviewer .*\$\d/.test(r))).toBe(false)
  expect((await ui.findAll({ type: 'Button' })).some(b => /^cost/.test(b.key ?? ''))).toBe(false)
  await ui.unmount()
})

test('Agents: every live row carries the agent\'s cost in a fixed cell before its time, at 40 and 58 columns', async ($, on) => {
  await endedAgents($, on)
  for (const width of [40, 58]) {
    const ui = await mountPane($, width)
    await ui.press({ key: 'tab:agents' })
    const rows = rowTexts(await ui.drawn()).filter(r => /\$\d+\.\d+ +\d+s$/.test(r))
    expect(rows.length).toBeGreaterThanOrEqual(2)
    for (const r of rows) expect(textCells(r)).toBeLessThanOrEqual(width)
    // the cell ends at the same column in every row
    expect(new Set(rows.map(r => textCells(r.slice(0, r.search(/ +\d+s$/)))))).toHaveProperty('size', 1)
    await ui.unmount()
  }
})

test('HISTORY: a row shows the cost the entry kept', async ($, on) => {
  world(on, { dataFile: JSON.stringify({ history: [{ ...entry('a1', 'two', NOW - 1000), usd: 1.5 }], prs: [] }) })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 58)
  await ui.press({ key: 'tab:agents' })
  expect((await ui.find({ key: 'history:a1' }))?.text).toMatch(/\$1\.50/)
  await ui.unmount()
})

test('HISTORY: a row keeps the agent\'s versioned model and effort icon', async ($, on) => {
  world(on, { dataFile: JSON.stringify({ history: [{ ...entry('a1', 'two', NOW - 1000), effort: 'high' }, entry('a2', 'old', NOW - 2000)], prs: [] }) })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 58)
  await ui.press({ key: 'tab:agents' })
  expect((await ui.find({ key: 'history:a1' }))?.text).toMatch(/^󰄬 two +son 5\.5 +\u{F12A3} /u)
  expect((await ui.find({ key: 'history:a2' }))?.text).toMatch(/^󰄬 old +son 5\.5 {2}/)
  await ui.unmount()
})
