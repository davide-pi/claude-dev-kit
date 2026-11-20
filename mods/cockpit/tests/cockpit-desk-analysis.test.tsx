import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { deskAnalysis } from '../hooks/desk-analysis'
import { deskLayout } from '../hooks/desk-layout'
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
      scrollBody: noop,
    }
  }
}

const FULL = () => snap({ cost: { usd: 10 }, agentSpend: { implementer: 4 }, agents: [agent('a1', 'implementer')], insights: insights({ rounds: 3, usd: 6, roundMs: 120_000, toolMs: 30_000, waitMs: 5_000 }) })

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

test('Given no insights and no notification, When the Analysis tab is drawn, Then the time and watch sections each say so in one dim line and keep their rows', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const s = snap()
  // When
  const { ui } = await drawAnalysis($, on, s, 100, [])
  const drawn = await ui.drawn()
  // Then
  for (const [key, rows] of [['analysis:time', 3], ['analysis:watch', 2]] as const) {
    const section = find(drawn, key)
    expect(kids(section)).toHaveLength(1 + rows)
    expect(textOf(kids(section)[1])).toBe(t().desk.analysis.none)
  }
  await ui.unmount()
})

test('Given insights and spend, When the Analysis tab is drawn, Then a time row is its label left and its value right, and a spend row has a share bar and no check icon', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const s = FULL()
  // When
  const { ui } = await drawAnalysis($, on, s, 100, [])
  const drawn = await ui.drawn()
  // Then
  const rounds = kids(find(drawn, 'time:rounds'))
  expect(rounds).toHaveLength(2)
  expect(propsOf(rounds[0]).flexGrow).toBe(1)
  expect(textOf(rounds[0])).toBe(t().desk.analysis.rounds)
  expect(textOf(rounds[1])).toBe('02m00s')
  const spend = find(drawn, 'analysis:spend')
  const sources = svgSources(spend)
  expect(sources.length).toBeGreaterThan(0)
  expect(sources.every(src => src.includes('width="84" height="6"'))).toBe(true)
  expect(sources.some(src => src.includes('M3 8.5l3.2 3.2L13 4.8'))).toBe(false)
  expect(textOf(find(drawn, 'spend:title'))).toContain('$10')
  await ui.unmount()
})

test('Given the Analysis tab, When drawn, Then every section card carries a visible border', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const s = FULL()
  // When
  const { ui } = await drawAnalysis($, on, s, 100, [])
  const drawn = await ui.drawn()
  // Then
  for (const key of ['analysis:time', 'analysis:spend', 'analysis:watch']) {
    expect(typeof propsOf(find(drawn, key)).borderStyle).toBe('string')
    expect(propsOf(find(drawn, key)).borderColor).toBeDefined()
  }
  await ui.unmount()
})

const failing = (names: string[]) => snap({ insights: insights({ failedCmds: Object.fromEntries(names.map(n => [n, 3])) }) })

type Node = { type?: unknown; props?: unknown; children?: unknown; text?: unknown }
const isNode = (v: unknown): v is Node => typeof v === 'object' && v !== null
const kids = (v: unknown): unknown[] => (isNode(v) && Array.isArray(v.children) ? v.children : [])
const propsOf = (v: unknown): Record<string, unknown> => (isNode(v) && typeof v.props === 'object' && v.props !== null ? { ...v.props } : {})
const all = (v: unknown): unknown[] => [v, ...kids(v).flatMap(all)]
const svgSources = (v: unknown): string[] => all(v).flatMap(n => (isNode(n) && n.type === 'Svg' ? [String(propsOf(n).source)] : []))
const keyOf = (v: unknown): unknown => (isNode(v) && typeof v.props === 'object' && v.props !== null && 'key' in v.props ? v.props.key : undefined)
const textOf = (v: unknown): string => (typeof v === 'string' ? v : isNode(v) && typeof v.text === 'string' ? v.text : kids(v).map(textOf).join(''))
const find = (v: unknown, key: string): unknown => (keyOf(v) === key ? v : kids(v).map(k => find(k, key)).find(x => x !== undefined))
/** The rows of the watch section under its title, as text. */
const watchRows = async (ui: Mounted): Promise<string[]> => kids(find(await ui.drawn(), 'analysis:watch')).slice(1).map(textOf)

test('Given five notifications, When the Analysis tab is drawn, Then the watch section shows one and a +4 row in its two rows', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const s = failing(['cmd-a', 'cmd-b', 'cmd-c', 'cmd-d', 'cmd-e'])
  // When
  const five = await drawAnalysis($, on, s, 100, [])
  const rows = await watchRows(five.ui)
  // Then
  expect(rows).toHaveLength(2)
  expect(rows.filter(r => /cmd-[a-e]/.test(r))).toHaveLength(1)
  expect(rows[1]?.trim()).toBe('+4')
  await five.ui.unmount()
})

test('Given exactly two notifications, When the Analysis tab is drawn, Then both show and no more row', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const s = failing(['cmd-a', 'cmd-b'])
  // When
  const two = await drawAnalysis($, on, s, 100, [])
  const rows = await watchRows(two.ui)
  // Then
  expect(rows).toHaveLength(2)
  expect(rows.filter(r => /cmd-[ab]/.test(r))).toHaveLength(2)
  expect(rows.some(r => /^\+\d+$/.test(r.trim()))).toBe(false)
  await two.ui.unmount()
})

test('Given a narrow and a wide pane, When drawn, Then both show the sections and no button: the actions live in the page bar', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const narrow = await drawAnalysis($, on, FULL(), 40, [])
  const wide = await drawAnalysis($, on, FULL(), 140, [])
  // When
  const buttons = async (ui: Mounted) => (await ui.findAll({ type: 'Button' })).map(b => b.key ?? '').filter(k => k.startsWith('analysis:'))
  // Then
  for (const d of [narrow, wide]) expect(d.rows.some(r => r.includes(t().desk.analysis.spend))).toBe(true)
  expect(await buttons(narrow.ui)).toHaveLength(0)
  expect(await buttons(wide.ui)).toHaveLength(0)
  await narrow.ui.unmount()
  await wide.ui.unmount()
})

test('Given spend, When the Analysis tab is drawn narrow, medium and wide, Then every spend row keeps its percent in a 4-cell non-shrinking column', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const s = FULL()
  const all = (v: unknown): unknown[] => [v, ...kids(v).flatMap(all)]
  for (const columns of [40, 80, 120]) {
    // When
    const { ui } = await drawAnalysis($, on, s, columns, [])
    const drawn = await ui.drawn()
    await ui.unmount()
    // Then
    const pcts = all(drawn).filter(n => /^spend:.+:pct$/.test(String(propsOf(n).key)))
    expect(pcts.length).toBeGreaterThan(0)
    expect(pcts.every(n => propsOf(n).width === 4 && propsOf(n).flexShrink === 0 && /^\s*\d+%$/.test(textOf(n)))).toBe(true)
  }
})
