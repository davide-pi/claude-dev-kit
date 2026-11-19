import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { deskActions } from '../hooks/desk-analysis'
import { deskHead } from '../hooks/desk-head'
import { deskLayout } from '../hooks/desk-layout'
import { deskNow } from '../hooks/desk-now'
import { deskUrgent } from '../hooks/desk-urgent'
import { bodyLimit } from '../hooks/desk-view'
import { t } from '../hooks/strings'
import type { PaneActions } from '../hooks/view-kit'
import type { CockpitSnapshot } from '../types'
import { mountDesk } from './cockpit-fixtures'
import { snap } from './cockpit-page-draw'
import { PANE, iso, settle, world } from './cockpit-world'

// ── The desktop page laid out as the design board: action bar, credit rows, donut, empty states, tab underline ──

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null
const propsOf = (el: unknown): Record<string, unknown> => (isRecord(el) && isRecord(el.props) ? el.props : {})
const childrenOf = (el: unknown): unknown[] => (isRecord(el) && Array.isArray(el.children) ? el.children : [])
const nodes = (el: unknown): unknown[] => [el, ...childrenOf(el).flatMap(nodes)]
const keyed = (el: unknown, key: string): unknown => nodes(el).find(n => propsOf(n).key === key)
const textOf = (el: unknown): string => (typeof el === 'string' ? el : isRecord(el) && typeof el.text === 'string' ? el.text : childrenOf(el).map(textOf).join(''))
const ACTION_KEYS = ['analysis:compact', 'analysis:retro:session', 'analysis:retro:days']

/** Actions that record what the action bar presses, `name:args`. */
function recorder(calls: string[]): PaneActions {
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
    setLogPage: noop,
  }
}

type Part = 'actions' | 'head' | 'now' | 'urgent'
type Slot = { part: Part; s: CockpitSnapshot; columns: number; calls: string[] }
const SLOTS = new WeakMap<object, Map<string, Slot>>()
let counter = 0

/** Draws one part of the desk page alone on the desktop surface; one render hook per test serves every draw. */
async function drawPart($: Engine, on: On, part: Part, s: CockpitSnapshot, columns = 80, calls: string[] = []) {
  const requestId = `board${counter++}`
  const known = SLOTS.get(on)
  const slots = known ?? new Map<string, Slot>()
  slots.set(requestId, { part, s, columns, calls })
  if (known === undefined) {
    SLOTS.set(on, slots)
    on('ui.render', { component: 'Pane' }, ($$, e, next) => {
      const slot = slots.get(e.requestId ?? '')
      if (slot === undefined || e.surface !== 'desktop') return next(e)
      const ui = $$.ui.resolve(e)
      const layout = deskLayout(slot.columns, 30)
      const actions = recorder(slot.calls)
      if (slot.part === 'actions') return deskActions(ui, layout, actions)
      if (slot.part === 'head') return deskHead(ui, slot.s, layout, actions)
      if (slot.part === 'urgent') return deskUrgent(ui, slot.s, actions)
      return deskNow(ui, slot.s, layout, actions)
    })
  }
  return $.ui.mount({ ...PANE, requestId, props: { ...PANE.props, bodyColumns: columns }, surface: 'desktop' })
}

test('Given desktop, When each of the three tabs is drawn, Then the compact and both retro buttons are drawn once, in the bar after the body', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  world(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await mountDesk($)
  const seen: { keys: string[]; last: unknown }[] = []
  // When
  for (const tab of ['now', 'log', 'analysis']) {
    await ui.press({ key: `tab:${tab}` })
    await settle()
    const drawn = await ui.drawn()
    seen.push({ keys: (await ui.findAll({ type: 'Button' })).map(b => b.key ?? ''), last: propsOf(childrenOf(drawn).at(-1)).key })
  }
  // Then
  for (const { keys, last } of seen) {
    for (const key of ACTION_KEYS) expect(keys.filter(k => k === key)).toHaveLength(1)
    expect(last).toBe('desk:actions')
  }
  await ui.unmount()
})

test('Given the action bar, When each of its buttons is pressed, Then compact, retro(session) and retro(days) are called once each', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const calls: string[] = []
  const ui = await drawPart($, on, 'actions', snap(), 80, calls)
  // When
  for (const key of ACTION_KEYS) await ui.press({ plugin: 'test', key })
  // Then
  expect(calls).toEqual(['compact:', 'retro:session', 'retro:days'])
  expect(textOf(await ui.drawn())).toContain(t().desk.analysis.retro)
  await ui.unmount()
})

test('Given a 60-row pane at each size, When the body limit is read, Then the head and the action bar rows are kept out of it', () => {
  // Given
  const rows = 60
  // When
  const [narrow, medium, wide] = [bodyLimit(rows, 36), bodyLimit(rows, 80), bodyLimit(rows, 160)]
  // Then
  // medium: 18 head and tab rows, 3 for the action bar and its gap
  expect(medium).toBe(39)
  expect(narrow).toBeLessThan(medium)
  expect(wide).toBeLessThan(medium)
})

const RATES = [
  { kind: 'five_hour', percentUsed: 38, resetsAt: iso(2 * 3_600_000) },
  { kind: 'seven_day', percentUsed: 59, resetsAt: iso(3 * 86_400_000) },
] as const

for (const columns of [36, 80, 160]) {
  test(`Given ${columns} columns, When a credit row is drawn, Then the bar takes the whole row, the percent sits at its right end without the left word, and no forecast row exists`, { timeoutMs: 30_000 }, async ($, on) => {
    // Given
    const s = snap({ rateLimits: [...RATES] })
    // When
    const ui = await drawPart($, on, 'head', s, columns)
    const head = await ui.drawn()
    // Then
    const bar = keyed(head, 'desk:window:five_hour:bar')
    const [track, percent] = childrenOf(bar)
    expect(propsOf(track).flexGrow).toBe(1)
    expect(propsOf(track).minWidth).toBe(0)
    const svg = childrenOf(track)[0]
    expect(isRecord(svg) && svg.type).toBe('Svg')
    expect(propsOf(svg).width).toBeUndefined()
    expect(propsOf(svg).height).toBe(8)
    expect(String(propsOf(svg).alt)).toContain(t().desk.head.left)
    expect(propsOf(percent).flexShrink).toBe(0)
    expect(textOf(percent)).toContain('62%')
    expect(textOf(bar)).not.toContain(t().desk.head.left)
    expect(textOf(keyed(head, 'desk:window:five_hour:label'))).toContain(t().desk.head.renews)
    expect(keyed(head, 'desk:forecast')).toBeUndefined()
    expect(textOf(head)).not.toContain('→')
    await ui.unmount()
  })
}

test('Given a context reading, When the head is drawn, Then the short label sits above the donut, the percent alone is drawn over it and the tokens and cache sit centred under it', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const s = snap({ ctx: { tokens: 161_100, window: 216_000, percent: 75 }, cacheShare: 98 })
  // When
  const ui = await drawPart($, on, 'head', s)
  const context = keyed(await ui.drawn(), 'desk:context')
  // Then
  expect(propsOf(context).flexDirection).toBe('column')
  expect(propsOf(context).alignItems).toBe('center')
  const over = keyed(context, 'desk:context:over')
  expect(propsOf(over).position).toBe('absolute')
  expect(textOf(over)).not.toContain(t().desk.head.context)
  expect(textOf(context)).toContain(t().desk.head.contextShort)
  expect(textOf(over)).toMatch(/\d+%/)
  expect(textOf(context)).toContain(`${t().desk.head.cache} 98%`)
  const donut = nodes(context).find(n => isRecord(n) && n.type === 'Svg')
  expect(String(propsOf(donut).source).match(/<circle/g)?.length).toBeLessThanOrEqual(2)
  expect(String(propsOf(donut).source)).not.toContain('#7CC79A')
  await ui.unmount()
})

test('Given desktop, When the page is drawn, Then the open tab label is in the accent colour and the others are not', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  world(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  // When
  const ui = await mountDesk($)
  const tabs = keyed(await ui.drawn(), 'desk:tabs')
  // Then
  const colours = ['now', 'log', 'analysis'].map(tab => propsOf(nodes(keyed(tabs, `desk:tab:${tab}`)).find(n => isRecord(n) && n.type === 'Text')).color)
  expect(colours[0]).toBe('#8B6CF6')
  expect(colours.slice(1).includes('#8B6CF6')).toBe(false)
  await ui.unmount()
})

test('Given the head and the In progress tab, When drawn, Then the gauges card and every Now card carry a visible border', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const s = snap({ rateLimits: [...RATES] })
  // When
  const head = await drawPart($, on, 'head', s)
  const now = await drawPart($, on, 'now', s)
  const [h, n] = [await head.drawn(), await now.drawn()]
  // Then
  const cards = [keyed(h, 'desk:gauges'), keyed(n, 'now:request:prompt'), keyed(n, 'now:flow:card'), keyed(n, 'now:outside:list')]
  for (const card of cards) {
    expect(typeof propsOf(card).borderStyle).toBe('string')
    expect(propsOf(card).borderColor).toBeDefined()
  }
  await head.unmount()
  await now.unmount()
})

test('Given desktop, When the tab row is drawn, Then each tab underline Svg has a numeric pixel width matching its markup and a 2px height', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  world(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  // When
  const ui = await mountDesk($)
  const tabs = keyed(await ui.drawn(), 'desk:tabs')
  // Then
  const lines = nodes(tabs).filter(n => isRecord(n) && n.type === 'Svg')
  expect(lines).toHaveLength(3)
  for (const line of lines) {
    const { width, height, source } = propsOf(line)
    expect(typeof width).toBe('number')
    expect(height).toBe(2)
    expect(String(source)).toContain(`width="${String(width)}"`)
  }
  await ui.unmount()
})

test('Given an idle session with no flow and no agent, When the In progress tab is drawn, Then each section says it is empty in one dim line and no dash is drawn', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const s = snap({ claudeState: { kind: 'idle' } })
  // When
  const ui = await drawPart($, on, 'now', s)
  const body = await ui.drawn()
  // Then
  const N = t().desk.now
  expect(textOf(keyed(body, 'now:request'))).toContain(N.noRequest)
  expect(textOf(keyed(body, 'now:flow'))).toContain(N.noFlow)
  expect(textOf(keyed(body, 'now:outside'))).toContain(N.noAgents)
  expect(textOf(body)).not.toContain('—')
  await ui.unmount()
})

test('Given days without hours and no blocking notification, When the URGENT card is drawn, Then the worklog row comes right after the title and the hint shares the title row', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const s = snap({ sessionId: 's-1', worklog: { ...snap().worklog, pending: ['2026-11-16', '2026-11-17'] } })
  // When
  const ui = await drawPart($, on, 'urgent', s)
  const card = keyed(await ui.drawn(), 'desk:urgent')
  // Then
  const keys = childrenOf(card).map(c => propsOf(c).key)
  expect(keys[1]).toBe('desk:urgent:worklog')
  expect(textOf(keyed(card, 'desk:urgent:title'))).toContain(t().desk.head.urgentHint)
  expect(textOf(keyed(card, 'desk:urgent:worklog'))).toContain(t().worklog.withoutHours(2))
  await ui.unmount()
})
