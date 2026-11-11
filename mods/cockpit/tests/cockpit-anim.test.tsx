import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { PANE, world } from './cockpit-world'
import type { World } from './cockpit-world'

// ── The animated cells are surface modules (`anim.tsx`) beside what they animate: present where something qualifies, absent on a quiet pane ──

type Cell = { props?: { module?: string; props?: { kind?: string } } }

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
  expect(await animKinds($, on, undefined)).toEqual([])
})

test('breathe: Given Claude is working, When the pane is drawn, Then the state glyph breathes', async ($, on) => {
  expect(await animKinds($, on, undefined, {}, async () => void (await $.turn.start({ text: 'go', turnId: 't1' })))).toEqual(['breathe'])
})
