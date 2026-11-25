import { expect, test } from 'claude-code/testing'

import { paneView } from '../hooks/view'
import { mountPane, settleAll, spawnAgent, spawnWorkflowAgent, spawns } from './cockpit-fixtures'
import { WIDTH, draw, insights, keysOf, snap } from './cockpit-page-draw'
import { rowTexts, world } from './cockpit-world'

// ── IN PROGRESS: a flow's running agent shows once, under its flow ──

test('in progress: Given a live run with a running implementer carrying its run id, When drawn, Then the run shows in the flow section and the implementer is not listed outside it', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const clock = world(on)
  spawns(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await spawnWorkflowAgent($, 'wf_1', 1)
  await clock.advance(3000)
  await settleAll()
  // When
  const ui = await mountPane($, 100)
  const rows = rowTexts(await ui.drawn())
  const flat = await ui.find({ key: 'agent:a1' })
  await ui.unmount()
  // Then
  expect(rows.some(r => /^◆ wf_1/.test(r))).toBe(true)
  expect(rows.filter(r => /implementer/.test(r))).toHaveLength(0)
  expect(flat).toBeUndefined()
})

test('in progress: Given a running agent with no workflow run, When drawn, Then it is still in the flat agent list', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  world(on)
  spawns(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await spawnAgent($, 'reviewer')
  // When
  const ui = await mountPane($, 100)
  const flat = await ui.find({ key: 'agent:a1' })
  await ui.unmount()
  // Then
  expect(flat).toBeDefined()
})

test('in progress: Given a running agent whose run id names a run that is not the live one, When drawn, Then it is still listed and the live run\'s agent is not', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const clock = world(on)
  spawns(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await spawnWorkflowAgent($, 'w1', 1)
  await spawnWorkflowAgent($, 'w2', 1)
  await clock.advance(3000)
  await settleAll()
  // When
  const ui = await mountPane($, 100)
  const replaced = await ui.find({ key: 'agent:a1' })
  const live = await ui.find({ key: 'agent:a2' })
  await ui.unmount()
  // Then
  expect(replaced).toBeDefined()
  expect(live).toBeUndefined()
})

test('page: with eight notifications at 40 rows the footer buttons are still drawn, and the rows stay within the pane', { timeoutMs: 30_000 }, async ($, on) => {
  const reads = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`/src/f${i}.ts`, 4]))
  const s = snap({ insights: insights({ reads }), cost: { usd: 1 } })
  const { ui, rows } = await draw($, on, s, k => [[paneView({ ...k.ui, Client: undefined }, k.s, WIDTH, 40, k.actions)]])
  expect((await keysOf(ui, /^bar:compact$/)).length).toBe(1)
  expect(rows.length).toBeLessThanOrEqual(40)
})
