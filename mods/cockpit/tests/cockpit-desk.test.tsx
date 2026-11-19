import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { deskHead } from '../hooks/desk-head'
import { deskLayout } from '../hooks/desk-layout'
import { deskUrgent } from '../hooks/desk-urgent'
import { bodyLimit, limitRows } from '../hooks/desk-view'
import { RETRO_DAYS } from '../hooks/pane-actions'
import { withoutSession } from '../hooks/session-data'
import { INITIAL } from '../hooks/state'
import { setLang, t } from '../hooks/strings'
import type { PaneActions } from '../hooks/view-kit'
import type { CockpitSnapshot } from '../types'
import { IT_FILE, measureWith, mountDesk, mountPane, roundHooks } from './cockpit-fixtures'
import { snap } from './cockpit-page-draw'
import { PANE, iso, rowTexts, settle, world } from './cockpit-world'

// ── T5: the desk tab in the snapshot, one retro day count ──

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

/** The `deskTab` of every snapshot a read answers, in order (the test's hooks cannot read the atom themselves). */
function watchDeskTab(on: On): (string | undefined)[] {
  const seen: (string | undefined)[] = []
  on('state.get', async (_, e, next) => {
    const answer = await next(e)
    const outer = isRecord(answer) ? answer.value : undefined
    const snap = isRecord(outer) ? outer.value : undefined
    if (isRecord(snap) && 'ctx' in snap) seen.push(typeof snap.deskTab === 'string' ? snap.deskTab : undefined)
    return answer
  })
  return seen
}

test('Given setTab(log), When the snapshot is read, Then deskTab is log', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  world(on)
  const seen = watchDeskTab(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await mountDesk($)
  // When
  await ui.press({ key: 'tab:log' })
  await settle()
  await ui.drawn()
  // Then
  expect(seen.at(-1)).toBe('log')
  await ui.unmount()
})

test('Given a desk tab, When a new session resets the snapshot, Then deskTab is undefined', () => {
  // Given
  const s = { ...INITIAL, deskTab: 'analysis' } as const
  // When
  const reset = withoutSession(s)
  // Then
  expect(reset.deskTab).toBeUndefined()
})

test('Given a log page, When a new session resets the snapshot, Then deskLogPage is undefined', () => {
  // Given
  const s = { ...INITIAL, deskLogPage: 2 }
  // When
  const reset = withoutSession(s)
  // Then
  expect(reset.deskLogPage).toBeUndefined()
})

test('Given retro(days), When handled, Then command.run receives the days count of RETRO_DAYS (15)', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const commands: string[] = []
  world(on, { commands })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mountPane($)
  await ui.press({ key: 'bar:retro' })
  // When
  await ui.press({ key: 'confirm:days' })
  await settle()
  // Then
  expect(RETRO_DAYS).toBe(15)
  expect(commands).toEqual(['/retro days 15'])
  await ui.unmount()
})

test('Given a refused command.run, When retro(days) is handled, Then nothing throws and confirm is cleared', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  on('command.run', { command: 'retro' }, () => {
    throw new Error('refused')
  })
  const ui = await mountPane($)
  await ui.press({ key: 'bar:retro' })
  expect(await ui.find({ key: 'confirm:days' })).toBeDefined()
  // When
  await ui.press({ key: 'confirm:days' })
  await settle()
  // Then
  expect(await ui.find({ key: 'confirm:days' })).toBeUndefined()
  await ui.unmount()
})

// ── T6: the desk shell, branched by surface ──

const propsOf = (el: unknown): Record<string, unknown> => (isRecord(el) && isRecord(el.props) ? el.props : {})
const childrenOf = (el: unknown): unknown[] => (isRecord(el) && Array.isArray(el.children) ? el.children : [])
const count = (el: unknown): number => 1 + childrenOf(el).reduce<number>((n, c) => n + count(c), 0)
const keyed = (el: unknown, key: string): unknown => (propsOf(el).key === key ? el : childrenOf(el).map(c => keyed(c, key)).find(f => f !== undefined))
const nodesOf = (el: unknown): unknown[] => [el, ...childrenOf(el).flatMap(nodesOf)]
const TABS = ['tab:now', 'tab:log', 'tab:analysis']

test('Given desktop, When the pane is drawn, Then the keys tab:now, tab:log, tab:analysis exist and the default tab is now', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  world(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  // When
  const ui = await mountDesk($)
  // Then
  const keys = (await ui.findAll({ type: 'Button' })).map(b => b.key)
  expect(keys).toEqual(expect.arrayContaining(TABS))
  const drawn = await ui.drawn()
  expect(keyed(drawn, 'desk:body:now')).toBeDefined()
  expect(keyed(drawn, 'desk:body:log')).toBeUndefined()
  // the active tab has its purple underline, the others a transparent one of the same size
  expect(JSON.stringify(keyed(drawn, 'desk:tab:now'))).toContain('#8B6CF6')
  expect(JSON.stringify(keyed(drawn, 'desk:tab:log'))).not.toContain('#8B6CF6')
  expect(JSON.stringify(keyed(drawn, 'desk:tab:log'))).toContain('transparent')
  await ui.unmount()
})

test('Given desktop, When tab:log is pressed and the pane redrawn, Then the log body shows and the element count of head and tab row is unchanged', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  world(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await mountDesk($)
  const before = childrenOf(await ui.drawn()).slice(0, 2).map(count)
  // When
  await ui.press({ key: 'tab:log' })
  await settle()
  // Then
  const drawn = await ui.drawn()
  expect(keyed(drawn, 'desk:body:log')).toBeDefined()
  expect(keyed(drawn, 'desk:body:now')).toBeUndefined()
  expect(childrenOf(drawn).slice(0, 2).map(count)).toEqual(before)
  expect(JSON.stringify(keyed(drawn, 'desk:tab:log'))).toContain('#8B6CF6')
  await ui.unmount()
})

test('Given desktop, When tab:log is pressed, Then the log tab draws its filter and rows in the body', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  world(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await mountDesk($)
  // When
  await ui.press({ key: 'tab:log' })
  await settle()
  // Then
  const body = keyed(await ui.drawn(), 'desk:body:log')
  expect(keyed(body, 'desk:log:filter')).toBeDefined()
  expect(keyed(body, 'desk:log')).toBeDefined()
  await ui.unmount()
})

test('Given desktop, When tab:analysis is pressed, Then the analysis buttons are drawn', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  world(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await mountDesk($)
  // When
  await ui.press({ key: 'tab:analysis' })
  await settle()
  // Then
  const keys = (await ui.findAll({ type: 'Button' })).map(b => b.key)
  expect(keys).toEqual(expect.arrayContaining(['analysis:compact', 'analysis:retro:session', 'analysis:retro:days']))
  expect(keyed(await ui.drawn(), 'desk:body:analysis')).toBeDefined()
  await ui.unmount()
})

for (const surface of ['terminal', 'vscode', 'mobile'] as const) {
  test(`Given ${surface}, When the pane is drawn, Then no tab key exists and the page is the terminal page`, { timeoutMs: 30_000 }, async ($, on) => {
    // Given
    world(on)
    await $.session.start({ cwd: '/', surface, isInteractive: true })
    // When
    const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 58 }, surface })
    // Then
    const keys = (await ui.findAll({ type: 'Button' })).map(b => b.key ?? '')
    expect(keys.filter(k => k.startsWith('tab:'))).toEqual([])
    expect(keys).toContain('bar:compact')
    expect(rowTexts(await ui.drawn()).some(r => /^CTX /.test(r))).toBe(true)
    await ui.unmount()
  })
}

test('Given desktop at two different bodyColumns, When drawn, Then the root Box spans the full width in both', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  world(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const widths: unknown[] = []
  const fixed: string[] = []
  // When
  for (const columns of [80, 150]) {
    const ui = await mountDesk($, columns)
    const drawn = await ui.drawn()
    widths.push(propsOf(drawn).width)
    // a fixed pixel width on the head's boxes or texts would overflow a narrow pane: only the Svgs and the 86px rail keep one
    fixed.push(...nodesOf(keyed(drawn, 'desk:head')).filter(n => isRecord(n) && n.type !== 'Svg' && typeof propsOf(n).width === 'number' && propsOf(n).width !== 86).map(n => String(propsOf(n).key)))
    await ui.unmount()
  }
  // Then
  expect(widths).toEqual(['100%', '100%'])
  expect(fixed).toEqual([])
})

test('Given bodyRows, When the body limit is read, Then it keeps at least 8 rows and a cut list ends with a more row', () => {
  // Given
  const rows = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']
  // When
  const [roomy, tight] = [bodyLimit(40), bodyLimit(5)]
  const cut = limitRows(rows, 8, n => `+${n}`)
  const whole = limitRows(rows.slice(0, 8), 8, n => `+${n}`)
  // Then
  expect(roomy).toBeGreaterThan(8)
  expect(tight).toBe(8)
  expect(cut).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', '+3'])
  expect(whole).toHaveLength(8)
})

// ── T6b: /cockpit close closes the pane ──

const cockpit = ($: Engine, args: string) => $.command.run({ command: 'cockpit', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 80 } })

test('Given the pane open, When /cockpit close runs, Then the pane is closed and the answer is the closed text', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const opened: string[] = []
  const closed: string[] = []
  world(on, { opened, closed })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await cockpit($, '')
  // When
  const ran = await cockpit($, 'close')
  // Then
  expect(ran.text).toBe(t().commandClosed)
  expect(closed).toEqual(['plugin'])
  expect(opened).toHaveLength(1)
})

test('Given the pane closed, When /cockpit close runs, Then nothing throws and the answer is the closed text', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  world(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  // When
  const ran = await cockpit($, 'close')
  // Then
  expect(ran.text).toBe(t().commandClosed)
})

test('Given /cockpit with no argument, When it runs, Then it opens as today', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const closed: string[] = []
  world(on, { closed })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  // When
  const ran = await cockpit($, '')
  // Then
  expect(ran.text).toBe(t().commandOpen)
  expect(closed).toEqual([])
})

test('Given any other argument, When /cockpit runs, Then it opens and the answer names the close form', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const closed: string[] = []
  world(on, { closed })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  // When
  const ran = await cockpit($, 'shut')
  // Then
  expect(ran.text).toBe(t().commandOpenHint)
  expect(ran.text).toContain('/cockpit close')
  expect(closed).toEqual([])
})

test('Given the Italian pane, When /cockpit chiudi runs, Then the pane is closed and the answer is the Italian closed text', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const closed: string[] = []
  world(on, { closed, files: IT_FILE })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  // When
  const ran = await cockpit($, 'chiudi')
  // Then
  expect(ran.text).toBe('cockpit chiuso')
  expect(closed).toEqual(['plugin'])
  setLang('en')
})

test('Given the Italian pane, When /cockpit close runs, Then the pane is closed', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const closed: string[] = []
  world(on, { closed, files: IT_FILE })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  // When
  const ran = await cockpit($, 'close')
  // Then
  expect(ran.text).toBe('cockpit chiuso')
  expect(closed).toEqual(['plugin'])
  setLang('en')
})

test('Given the English pane, When /cockpit chiudi runs, Then the pane is closed', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const closed: string[] = []
  world(on, { closed })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  // When
  const ran = await cockpit($, 'chiudi')
  // Then
  expect(ran.text).toBe(t().commandClosed)
  expect(closed).toEqual(['plugin'])
})

// ── T7: the head ──

const svgsOf = (el: unknown): string[] => [...(isRecord(el) && el.type === 'Svg' ? [String(propsOf(el).source ?? '')] : []), ...childrenOf(el).flatMap(svgsOf)]
const textOf = (el: unknown): string => (typeof el === 'string' ? el : childrenOf(el).map(textOf).join(''))
const headOf = async (ui: { drawn: () => Promise<unknown> }) => keyed(await ui.drawn(), 'desk:head')
const DONUT = /r="44"/

test('Given no rate data, When the head is drawn, Then the windows keep the same element count and show a dash', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  world(on, { rateLimits: [] })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  // When
  const ui = await mountDesk($)
  const head = await headOf(ui)
  // Then
  const windows = keyed(head, 'desk:windows')
  expect(childrenOf(windows)).toHaveLength(2)
  expect(svgsOf(windows)).toHaveLength(2)
  expect(textOf(windows)).toContain('—')
  await ui.unmount()
})

test('Given no context tokens, When the head is drawn, Then the donut has 0 fill', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  world(on, { isFresh: true })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  // When
  const ui = await mountDesk($)
  const donut = svgsOf(await headOf(ui)).find(s => DONUT.test(s)) ?? ''
  // Then
  // the track is drawn, no arc over it
  expect(donut).toMatch(DONUT)
  expect(donut).not.toContain('stroke-dasharray')
  await ui.unmount()
})

test('Given any two snapshots, When the head is drawn, Then its element count is the same', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  world(on, { rateLimits: [], isFresh: true })
  roundHooks(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await mountDesk($)
  const empty = count(await headOf(ui))
  // When
  await measureWith($, 40, [
    { kind: 'five_hour', percentUsed: 38, resetsAt: iso(2 * 3_600_000) },
    { kind: 'seven_day', percentUsed: 59, resetsAt: iso(3 * 86_400_000) },
  ])
  await settle()
  await ui.advance(0)
  // Then
  const full = await headOf(ui)
  expect(textOf(full)).toContain('62%')
  expect(count(full)).toBe(empty)
  await ui.unmount()
})

// ── T7b: the head's credit rows by layout size ──

const headSlots = new WeakMap<object, Map<string, { s: CockpitSnapshot; columns: number }>>()
let headCount = 0

/** Draws `deskHead` alone on the desktop surface for snapshot `s` at `columns`; the drawn head. */
async function drawHead($: Engine, on: On, s: CockpitSnapshot, columns: number): Promise<unknown> {
  const requestId = `head${headCount++}`
  const known = headSlots.get(on)
  const slots = known ?? new Map<string, { s: CockpitSnapshot; columns: number }>()
  slots.set(requestId, { s, columns })
  if (known === undefined) {
    headSlots.set(on, slots)
    on('ui.render', { component: 'Pane' }, ($$, e, next) => {
      const slot = slots.get(e.requestId ?? '')
      return slot === undefined || e.surface !== 'desktop' ? next(e) : deskHead($$.ui.resolve(e), slot.s, deskLayout(slot.columns, 30), urgentRecorder([]))
    })
  }
  const ui = await $.ui.mount({ ...PANE, requestId, surface: 'desktop' })
  const drawn = await ui.drawn()
  await ui.unmount()
  return drawn
}

const RATES = [
  { kind: 'five_hour', percentUsed: 38, resetsAt: iso(2 * 3_600_000) },
  { kind: 'seven_day', percentUsed: 59, resetsAt: iso(3 * 86_400_000) },
] as const
/** The Texts under `el` that no `wrap="truncate"` cuts, itself or a Text around it. */
const uncutTexts = (el: unknown, isCut = false): unknown[] => {
  if (!isRecord(el)) return []
  const cuts = el.type === 'Text' && propsOf(el).wrap === 'truncate'
  return [...(el.type === 'Text' && !isCut && !cuts ? [el] : []), ...childrenOf(el).flatMap(c => uncutTexts(c, isCut || cuts))]
}

test('Given a last-known credit reading, When the head is drawn, Then the percent has a ~ before it', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const s = snap({ rateLimits: [], lastRates: [...RATES] })
  // When
  const head = await drawHead($, on, s, 100)
  // Then
  expect(textOf(keyed(head, 'desk:window:five_hour'))).toContain('~62%')
})

test('Given a live credit reading, When the head is drawn, Then the percent has no ~', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const s = snap({ rateLimits: [...RATES] })
  // When
  const head = await drawHead($, on, s, 100)
  // Then
  expect(textOf(keyed(head, 'desk:window:five_hour'))).not.toContain('~')
})

for (const columns of [36, 80, 160]) {
  test(`Given ${columns} columns, When a credit row is drawn, Then it has its label, bar and pace lines, kept (empty) without data`, { timeoutMs: 30_000 }, async ($, on) => {
    // Given
    const [full, empty] = [snap({ rateLimits: [...RATES] }), snap({ rateLimits: [] })]
    // When
    const [a, b] = [await drawHead($, on, full, columns), await drawHead($, on, empty, columns)]
    // Then
    const [rowA, rowB] = [keyed(a, 'desk:window:five_hour'), keyed(b, 'desk:window:five_hour')]
    expect(count(rowA)).toBe(count(rowB))
    expect(textOf(keyed(rowA, 'desk:window:five_hour:label'))).toContain(t().desk.head.renews)
    expect(svgsOf(keyed(rowA, 'desk:window:five_hour:bar'))).toHaveLength(1)
    expect(keyed(rowA, 'desk:window:five_hour:pace')).toBeDefined()
    expect(svgsOf(keyed(rowA, 'desk:window:five_hour:pace'))).toHaveLength(0)
  })
}

test('Given any layout size, When the head is drawn, Then every Text of its state and gauges is cut with wrap truncate', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const s = snap({ rateLimits: [...RATES], claudeState: { kind: 'tool', tool: 'Bash' } })
  const loose: unknown[] = []
  // When
  for (const columns of [36, 80, 160]) {
    const head = await drawHead($, on, s, columns)
    for (const key of ['desk:state', 'desk:gauges']) loose.push(...uncutTexts(keyed(head, key)))
  }
  // Then
  expect(loose).toEqual([])
})

// ── T8: the URGENTE card ──

const urgentSlots = new WeakMap<object, Map<string, { s: CockpitSnapshot; calls: string[] }>>()
let urgentCount = 0

/** Actions that record the three the card presses, `name:args`. */
function urgentRecorder(calls: string[]): PaneActions {
  const noop = (): void => undefined
  return {
    compact: noop,
    retro: noop,
    ask: kind => void calls.push(`ask:${kind}`),
    answer: isYes => void calls.push(`answer:${isYes}`),
    worklog: scope => void calls.push(`worklog:${scope}`),
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

/** Draws `deskUrgent` alone on the desktop surface for snapshot `s`; one render hook per test, serving every draw. */
async function drawUrgent($: Engine, on: On, s: CockpitSnapshot, calls: string[] = []) {
  const requestId = `urgent${urgentCount++}`
  const known = urgentSlots.get(on)
  const slots = known ?? new Map<string, { s: CockpitSnapshot; calls: string[] }>()
  slots.set(requestId, { s, calls })
  if (known === undefined) {
    urgentSlots.set(on, slots)
    on('ui.render', { component: 'Pane' }, ($$, e, next) => {
      const slot = slots.get(e.requestId ?? '')
      return slot === undefined || e.surface !== 'desktop' ? next(e) : deskUrgent($$.ui.resolve(e), slot.s, urgentRecorder(slot.calls))
    })
  }
  return $.ui.mount({ ...PANE, requestId, surface: 'desktop' })
}

const buttonTexts = (el: unknown): string[] => [...(isRecord(el) && el.type === 'Button' ? [textOf(el)] : []), ...childrenOf(el).flatMap(buttonTexts)]

test('Given no blocking signal, When the card is drawn, Then it has the same element count as with one and shows the nothing-waiting text', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const calm = snap({ sessionId: 's-1' })
  const blocked = snap({ sessionId: 's-1', claudeState: { kind: 'waiting', since: calm.now - 600_000 } })
  // When
  const [a, b] = [await drawUrgent($, on, calm), await drawUrgent($, on, blocked)]
  const [calmCard, blockedCard] = [await a.drawn(), await b.drawn()]
  // Then
  expect(count(calmCard)).toBe(count(blockedCard))
  expect(textOf(calmCard)).toContain(t().desk.head.nothingWaiting)
  expect(textOf(blockedCard)).not.toContain(t().desk.head.nothingWaiting)
  expect(JSON.stringify(blockedCard)).toContain('#FF9A85')
  await a.unmount()
  await b.unmount()
})

test('Given worklog behind, When the desktop page is drawn, Then exactly one log-hours button is in the tree', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  world(on, { hasWorklog: true })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  // When
  const ui = await mountDesk($)
  await settle()
  // Then
  const drawn = await ui.drawn()
  expect(buttonTexts(drawn).filter(x => x === t().buttons.logHours)).toHaveLength(1)
  expect(textOf(keyed(drawn, 'desk:urgent:worklog'))).toContain(t().worklog.withoutHours(1))
  await ui.unmount()
})

test('Given the log-hours button pressed, When redrawn, Then the scope choice replaces the worklog line and no row is added', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  world(on, { hasWorklog: true })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await mountDesk($)
  const rowsBefore = childrenOf(keyed(await ui.drawn(), 'desk:urgent')).length
  // When
  await ui.press({ key: 'urgent:log' })
  await settle()
  // Then
  const card = keyed(await ui.drawn(), 'desk:urgent')
  expect(childrenOf(card)).toHaveLength(rowsBefore)
  expect(textOf(keyed(card, 'desk:urgent:worklog'))).toContain(t().confirmLog)
  const keys = (await ui.findAll({ type: 'Button' })).map(x => x.key)
  expect(keys).not.toContain('urgent:log')
  expect(keys).toEqual(expect.arrayContaining(['urgent:confirm:chat', 'urgent:confirm:day', 'urgent:confirm:no']))
  await ui.unmount()
})

test('Given the scope choice open, When each of its buttons is pressed, Then worklog(session), worklog(day) and answer(false) are called', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const calls: string[] = []
  const ui = await drawUrgent($, on, snap({ sessionId: 's-1', confirm: 'worklog' }), calls)
  // When
  for (const key of ['urgent:confirm:chat', 'urgent:confirm:day', 'urgent:confirm:no']) await ui.press({ plugin: 'test', key })
  // Then
  expect(calls).toEqual(['worklog:session', 'worklog:day', 'answer:false'])
  await ui.unmount()
})
