import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { COLORS } from '../hooks/shared'
import { colorOf } from './cockpit-fixtures'
import { PANE, rowTexts, world } from './cockpit-world'
import type { World } from './cockpit-world'

// ── The CTX readout uses the bar's scale (1.1 x the autocompact threshold) where the engine reports one ──

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

test('CTX readout: with a threshold the percent and the window are those of the bar, 1.1 x the threshold', { timeoutMs: 30_000 }, async ($, on) => {
  const { row, warning } = await ctxRows($, on, 151_000, { autoCompactAt: 193_000 })
  expect(row).toMatch(/^CTX [▰▱]+ {2}71% {3}151K\/212K/)
  expect(warning).toBeUndefined()
})

test('CTX readout: the scaled percent stops at 100%', { timeoutMs: 30_000 }, async ($, on) => {
  const { row } = await ctxRows($, on, 300_000, { autoCompactAt: 193_000 })
  expect(row).toMatch(/^CTX [▰▱]+ 100% {3}300K\/212K/)
})

test('CTX readout: without a threshold it stays the window\'s own, /1M', { timeoutMs: 30_000 }, async ($, on) => {
  const { row } = await ctxRows($, on, 151_000)
  expect(row).toMatch(/^CTX [▰▱]+ {2}15% {3}151K\/1M/)
})

test('CTX readout: Given 200k of a 193k threshold (94% of the bar), When the pane is drawn, Then no warning row is drawn', { timeoutMs: 30_000 }, async ($, on) => {
  // Given / When
  const at = await ctxRows($, on, 200_000, { autoCompactAt: 193_000 })
  // Then
  expect(at.warning).toBeUndefined()
  expect(at.row).toMatch(/^CTX [▰▱]+ {2}94% /)
})

test('CTX readout: it keeps its cells, so the row is as wide with a threshold as without', { timeoutMs: 30_000 }, async ($, on) => {
  const { row } = await ctxRows($, on, 151_000, { autoCompactAt: 193_000 })
  expect([...row].length).toBe(48)
})

/** The colour of the CTX readout's percent after a measure of `tokens`. */
async function ctxColourOf($: Engine, on: On, tokens: number, options: World = {}) {
  world(on, options)
  on('session.measure', (_, e) => ({ changed: e.changed }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.measure({ context: { window: 1_000_000, tokens, percent: Math.round(tokens / 10_000) }, rateLimits: [], cost: { usd: 1 }, changed: ['context'] })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const color = colorOf(await ui.drawn(), /^ *\d+%$/) // the first percent drawn is the CTX readout's
  await ui.unmount()
  return color
}

for (const [tokens, color, name] of [
  [110_000, COLORS.green, 'green under 60%'],
  [120_000, COLORS.yellow, 'yellow from 60%'],
  [170_000, COLORS.yellow, 'yellow under 90%'],
  [180_000, COLORS.red, 'red from 90%'],
] as const) {
  test(`CTX colour: given a threshold of 200K, ${tokens / 1000}K reads ${name} of it`, async ($, on) => {
    expect(await ctxColourOf($, on, tokens, { autoCompactAt: 200_000 })).toBe(color)
  })
}

test('CTX colour: without a threshold it keeps the window\'s own colouring', { timeoutMs: 30_000 }, async ($, on) => {
  expect(await ctxColourOf($, on, 600_000)).toBe(COLORS.yellow) // 60% of 1M
})
