import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { PANE, rowTexts, world } from './cockpit-world'
import type { World } from './cockpit-world'

// ── The CTX readout uses the bar's scale (1.2 x the autocompact threshold) where the engine reports one ──

/** The CTX row and the warning line of a pane after a measure of `tokens` of a 1M window. */
async function ctxRows($: Engine, on: On, tokens: number, options: World = {}) {
  world(on, options)
  on('session.measure', (_, e) => ({ changed: e.changed }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.measure({ context: { window: 1_000_000, tokens, percent: Math.round(tokens / 10_000) }, rateLimits: [], cost: { usd: 1 }, changed: ['context'] })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const rows = rowTexts(await ui.drawn())
  await ui.unmount()
  return { row: rows.find(r => /^CTX /.test(r)) ?? '', warning: rows.find(r => /^󰀦/.test(r)) }
}

test('CTX readout: with a threshold the percent and the window are those of the bar, 1.2 x the threshold', async ($, on) => {
  const { row, warning } = await ctxRows($, on, 151_000, { autoCompactAt: 193_000 })
  expect(row).toMatch(/^CTX [▰▱]+ {2}65% {3}151K\/232K/)
  expect(warning).toBeUndefined()
})

test('CTX readout: the scaled percent stops at 100%', async ($, on) => {
  const { row } = await ctxRows($, on, 300_000, { autoCompactAt: 193_000 })
  expect(row).toMatch(/^CTX [▰▱]+ 100% {3}300K\/232K/)
})

test('CTX readout: without a threshold it stays the window\'s own, /1M', async ($, on) => {
  const { row } = await ctxRows($, on, 151_000)
  expect(row).toMatch(/^CTX [▰▱]+ {2}15% {3}151K\/1M/)
})

test('CTX readout: the warning prints the scaled percent, and the scale decides when it shows', async ($, on) => {
  // 200k of 231.6k is 86% of the bar, 20% of the window
  const at = await ctxRows($, on, 200_000, { autoCompactAt: 193_000 })
  expect(at.warning).toBe('󰀦 context at 86%')
})

test('CTX readout: it keeps its cells, so the row is as wide with a threshold as without', async ($, on) => {
  const { row } = await ctxRows($, on, 151_000, { autoCompactAt: 193_000 })
  expect([...row].length).toBe(48)
})
