import { expect, test } from 'claude-code/testing'

import { deskLayout } from '../hooks/desk-layout'
import { mountDesk } from './cockpit-fixtures'
import { PANE, settle, world } from './cockpit-world'

// ── T12: the desktop page at every layout size, and the terminal page without it ──

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null
const propsOf = (el: unknown): Record<string, unknown> => (isRecord(el) && isRecord(el.props) ? el.props : {})
const childrenOf = (el: unknown): unknown[] => (isRecord(el) && Array.isArray(el.children) ? el.children : [])
const nodes = (el: unknown): unknown[] => [el, ...childrenOf(el).flatMap(nodes)]
const keysOf = (el: unknown): string[] => nodes(el).flatMap(n => {
  const key = propsOf(n).key
  return typeof key === 'string' ? [key] : []
})
/** The `width` of the context donut's Svg (the one whose source draws the r=44 ring). */
const donutWidth = (el: unknown): unknown => {
  const donut = nodes(el).find(n => isRecord(n) && n.type === 'Svg' && String(propsOf(n).source).includes('r="44"'))
  return propsOf(donut).width
}

const SIZES = [
  [36, 'narrow', 72],
  [80, 'medium', 96],
  [160, 'wide', 120],
] as const

for (const [columns, size, gauge] of SIZES) {
  test(`Given bodyColumns ${columns}, When each of the three tabs is drawn, Then nothing throws and the layout is ${size}`, { timeoutMs: 30_000 }, async ($, on) => {
    // Given
    world(on)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    const ui = await mountDesk($, columns)
    // When
    const now = await ui.drawn()
    await ui.press({ key: 'tab:log' })
    await settle()
    const log = await ui.drawn()
    await ui.press({ key: 'tab:analysis' })
    await settle()
    const analysis = await ui.drawn()
    // Then
    expect(deskLayout(columns, 30).size).toBe(size)
    expect(keysOf(now)).toContain('desk:body:now')
    expect(keysOf(log)).toContain('desk:body:log')
    expect(keysOf(analysis)).toContain('desk:body:analysis')
    for (const drawn of [now, log, analysis]) expect(donutWidth(drawn)).toBe(gauge)
    await ui.unmount()
  })
}

test('Given terminal, When the pane is drawn, Then no desk key exists', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  // When
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  // Then
  expect(keysOf(await ui.drawn()).filter(k => k.startsWith('desk:'))).toEqual([])
  await ui.unmount()
})
