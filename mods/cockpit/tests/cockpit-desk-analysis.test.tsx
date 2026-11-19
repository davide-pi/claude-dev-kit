import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { deskAnalysis } from '../hooks/desk-analysis'
import { deskLayout } from '../hooks/desk-layout'
import { RETRO_DAYS } from '../hooks/pane-actions'
import { t } from '../hooks/strings'
import type { PaneActions } from '../hooks/view-kit'
import type { CockpitSnapshot } from '../types'
import type { mountDesk } from './cockpit-fixtures'
import { agent, insights, snap } from './cockpit-page-draw'
import { PANE, rowTexts } from './cockpit-world'

// ── T11: the Analysis tab body, drawn on the desktop surface ──

type Mounted = Awaited<ReturnType<typeof mountDesk>>

type Slot = { s: CockpitSnapshot; columns: number; calls: string[] }
const SLOTS = new WeakMap<object, Map<string, Slot>>()
let counter = 0

/** Draws `deskAnalysis` as a pane of its own `columns` wide; `calls` records every action pressed, `name:args`. One render hook per test, serving every draw. */
async function drawAnalysis($: Engine, on: On, s: CockpitSnapshot, columns: number, calls: string[]): Promise<{ ui: Mounted; rows: string[] }> {
  const requestId = `analysis${counter++}`
  const known = SLOTS.get(on)
  const slots = known ?? new Map<string, Slot>()
  slots.set(requestId, { s, columns, calls })
  if (known === undefined) {
    SLOTS.set(on, slots)
    on('ui.render', { component: 'Pane' }, ($$, e, next) => {
      const slot = slots.get(e.requestId ?? '') ?? [...slots.values()].at(-1)
      return slot === undefined || e.surface !== 'desktop' ? next(e) : deskAnalysis($$.ui.resolve(e), slot.s, deskLayout(slot.columns, 30), recorder(slot.calls))
    })
  }
  const ui = await $.ui.mount({ ...PANE, requestId, props: { ...PANE.props, bodyColumns: columns, scroll: { offset: 0, bodyRows: 30 } }, surface: 'desktop' })
  return { ui, rows: rowTexts(await ui.drawn()).map(r => r.trimEnd()) }
}

/** Actions that record only the two the tab presses. */
function recorder(calls: string[]): PaneActions {
  {
    const noop = (): void => undefined
    return {
      compact: () => void calls.push('compact:'),
      retro: scope => void calls.push(`retro:${scope}`),
      ask: noop,
      answer: noop,
      worklog: noop,
      setTab: noop,
      toggleAgent: noop,
      toggleSignal: noop,
      toggleOpen: noop,
      setGroupOpen: noop,
      scrollTo: noop,
      setGroupsOpen: noop,
    }
  }
}

const FULL = () => snap({ cost: { usd: 10 }, agentSpend: { implementer: 4 }, agents: [agent('a1', 'implementer')], insights: insights({ rounds: 3, usd: 6, roundMs: 120_000, toolMs: 30_000, waitMs: 5_000 }) })

test('Given the compact button, When pressed, Then compact is called once', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const calls: string[] = []
  const { ui } = await drawAnalysis($, on, FULL(), 100, calls)
  // When
  await ui.press({ plugin: 'test', key: 'analysis:compact' })
  // Then
  expect(calls.filter(c => c.startsWith('compact'))).toEqual(['compact:'])
  await ui.unmount()
})

test('Given the 15 days button, When pressed, Then retro is called once with days', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const calls: string[] = []
  const { ui, rows } = await drawAnalysis($, on, FULL(), 100, calls)
  // When
  await ui.press({ plugin: 'test', key: 'analysis:retro:days' })
  // Then
  expect(rows.some(r => r.includes(String(RETRO_DAYS)))).toBe(true)
  expect(calls.filter(c => c.startsWith('retro'))).toEqual(['retro:days'])
  await ui.unmount()
})

test('Given the session button, When pressed, Then retro is called once with session', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const calls: string[] = []
  const { ui } = await drawAnalysis($, on, FULL(), 100, calls)
  // When
  await ui.press({ plugin: 'test', key: 'analysis:retro:session' })
  // Then
  expect(calls.filter(c => c.startsWith('retro'))).toEqual(['retro:session'])
  await ui.unmount()
})

test('Given no insights, When drawn, Then the sections keep their rows as with data', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const empty = await drawAnalysis($, on, snap(), 100, [])
  const full = await drawAnalysis($, on, FULL(), 100, [])
  // When
  const titles = [t().desk.analysis.time, t().desk.analysis.spend, t().desk.analysis.watch]
  // Then
  expect(empty.rows.length).toBe(full.rows.length)
  for (const title of titles) expect(empty.rows.some(r => r.includes(title))).toBe(true)
  await empty.ui.unmount()
  await full.ui.unmount()
})

test('Given a narrow and a wide pane, When drawn, Then both show the sections and the three buttons', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const narrow = await drawAnalysis($, on, FULL(), 40, [])
  const wide = await drawAnalysis($, on, FULL(), 140, [])
  // When
  const buttons = async (ui: Mounted) => (await ui.findAll({ type: 'Button' })).map(b => b.key ?? '').filter(k => k.startsWith('analysis:'))
  // Then
  for (const d of [narrow, wide]) expect(d.rows.some(r => r.includes(t().desk.analysis.spend))).toBe(true)
  expect(await buttons(narrow.ui)).toHaveLength(3)
  expect(await buttons(wide.ui)).toHaveLength(3)
  await narrow.ui.unmount()
  await wide.ui.unmount()
})
