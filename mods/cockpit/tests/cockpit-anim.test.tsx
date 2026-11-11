import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { PANE, world } from './cockpit-world'
import type { World } from './cockpit-world'

// ── The animated cells are surface modules (`anim.tsx`) beside what they animate: present where something qualifies, absent on a quiet pane ──

type Cell = { props?: { module?: string; props?: { kind?: string } } }

/** Credits in the green: the default world's 7d window is red, which beats. */
const QUIET: World = { rateLimits: [{ kind: 'five_hour', percentUsed: 10 }, { kind: 'seven_day', percentUsed: 10 }] }

/** The kinds of animated cell a pane draws after a measure of `tokens` (none: no measure), in order. */
async function animKinds($: Engine, on: On, tokens: number | undefined, options: World = {}, before?: () => Promise<void>) {
  world(on, options)
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  if (tokens !== undefined) await $.session.measure({ context: { window: 1_000_000, tokens, percent: Math.round(tokens / 10_000) }, rateLimits: [], cost: { usd: 1 }, changed: ['context'] })
  await before?.()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const kinds = ((await ui.findAll({ type: 'Client' })) as Cell[]).filter(c => c.props?.module?.endsWith('anim.tsx')).map(c => c.props?.props?.kind)
  await ui.unmount()
  return kinds
}

test('pulse: Given a threshold of 193k, When the context is at 145k (75%), Then a pulse sits beside the compact button', async ($, on) => {
  expect(await animKinds($, on, 145_000, { autoCompactAt: 193_000 })).toContain('pulse')
})

test('pulse: Given a threshold of 193k, When the context is at 144k (below 75%), Then no pulse is drawn', async ($, on) => {
  expect(await animKinds($, on, 144_000, { autoCompactAt: 193_000 })).not.toContain('pulse')
})

test('idle: Given a quiet pane (ready, nothing new, nothing running), When it is drawn, Then it holds no animated cell', async ($, on) => {
  // the default world's 7d window is red and beats: a quiet pane has green credits
  expect(await animKinds($, on, undefined, QUIET)).toEqual([])
})

type BeatCell = { props?: { module?: string; props?: { kind?: string; speed?: string; cells?: { t: string }[] } } }

/** The beating percent figures a pane draws after a measure: the speed and the text of each, in order. */
async function beats($: Engine, on: On, tokens: number, usedFiveHour: number | undefined, options: World = {}) {
  world(on, options)
  on('session.measure', (_, e) => ({ changed: e.changed }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const rateLimits = usedFiveHour === undefined ? [] : [{ kind: 'five_hour' as const, percentUsed: usedFiveHour }]
  await $.session.measure({ context: { window: 1_000_000, tokens, percent: Math.round(tokens / 10_000) }, rateLimits, cost: { usd: 1 }, changed: ['context'] })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const cells = ((await ui.findAll({ type: 'Client' })) as BeatCell[]).filter(c => c.props?.props?.kind === 'beat')
  await ui.unmount()
  return cells.map(c => ({ speed: c.props?.props?.speed, text: c.props?.props?.cells?.map(x => x.t).join('') }))
}

test('beat: Given a threshold of 200k, When the context is red (180k, 90%), Then its percent is a fast beat cell', async ($, on) => {
  // Given / When
  const found = await beats($, on, 180_000, undefined, { autoCompactAt: 200_000 })
  // Then
  expect(found).toEqual([{ speed: 'fast', text: ' 82%' }])
})

test('beat: Given a threshold of 200k, When the context is orange (170k), Then its percent is a slow beat cell', async ($, on) => {
  // Given / When
  const found = await beats($, on, 170_000, undefined, { autoCompactAt: 200_000 })
  // Then
  expect(found.map(f => f.speed)).toEqual(['slow'])
})

test('beat: Given a threshold of 200k, When the context is green (110k), Then no beat cell is drawn', async ($, on) => {
  // Given / When
  const found = await beats($, on, 110_000, undefined, { autoCompactAt: 200_000 })
  // Then
  expect(found).toEqual([])
})

test('beat: Given a 5h window with 85% used (red), When the pane is drawn, Then its percent is a fast beat cell', async ($, on) => {
  // Given / When
  const found = await beats($, on, 110_000, 85)
  // Then
  expect(found).toEqual([{ speed: 'fast', text: '15%' }])
})

test('beat: Given a 5h window with 50% used (yellow), When the pane is drawn, Then its percent is a slow beat cell', async ($, on) => {
  // Given / When
  const found = await beats($, on, 110_000, 50)
  // Then
  expect(found).toEqual([{ speed: 'slow', text: '50%' }])
})

test('beat: Given a 5h window with 30% used (green), When the pane is drawn, Then no beat cell is drawn', async ($, on) => {
  // Given / When
  const found = await beats($, on, 110_000, 30)
  // Then
  expect(found).toEqual([])
})

test('breathe: Given Claude is working, When the pane is drawn, Then the state glyph breathes', async ($, on) => {
  expect(await animKinds($, on, undefined, QUIET, async () => void (await $.turn.start({ text: 'go', turnId: 't1' })))).toEqual(['breathe'])
})
