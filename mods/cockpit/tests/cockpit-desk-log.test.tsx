import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { deskLayout } from '../hooks/desk-layout'
import { deskLog } from '../hooks/desk-log'
import { clockTime } from '../hooks/shared'
import { t } from '../hooks/strings'
import type { PaneActions } from '../hooks/view-kit'
import { signalText } from '../hooks/view-kit'
import type { CockpitLogEntry, CockpitSnapshot } from '../types'
import { PAGE, snap } from './cockpit-page-draw'
import { NOW } from './cockpit-world'

type Node = { type?: unknown; props?: unknown; children?: unknown; text?: unknown }
const isNode = (v: unknown): v is Node => typeof v === 'object' && v !== null
const propsOf = (v: unknown): Record<string, unknown> => (isNode(v) && typeof v.props === 'object' && v.props !== null ? { ...v.props } : {})
const kids = (v: unknown): unknown[] => (isNode(v) && Array.isArray(v.children) ? v.children : [])

/** Every node of the drawn tree, in drawing order. */
const nodes = (v: unknown): unknown[] => [v, ...kids(v).flatMap(nodes)]
/** The text a node draws. */
const textOf = (v: unknown): string => (typeof v === 'string' ? v : isNode(v) && typeof v.text === 'string' ? v.text : kids(v).map(textOf).join(''))
const keyOf = (v: unknown): string => {
  const k = propsOf(v).key
  return typeof k === 'string' ? k : ''
}
const svgs = (root: unknown): Record<string, unknown>[] => nodes(root).filter(n => isNode(n) && n.type === 'Svg').map(propsOf)
/** The log rows (not the filter), in drawing order: their key and text. */
const logRows = (root: unknown) => nodes(root).filter(n => /^desk:log:(row|empty|more)/.test(keyOf(n)) && !keyOf(n).endsWith(':time')).map(n => ({ key: keyOf(n), text: textOf(kids(n).at(-1)) }))

/** Draws `deskLog` alone in a desktop pane; `calls` records every action pressed, `name:args`. */
async function drawLog($: Engine, on: On, s: CockpitSnapshot, bodyRows = 30) {
  const calls: string[] = []
  const rec = (name: string) => (...args: unknown[]) => void calls.push(`${name}:${args.join(',')}`)
  const actions: PaneActions = {
    compact: rec('compact'),
    setTab: rec('setTab'),
    toggleAgent: rec('toggleAgent'),
    toggleOpen: rec('toggleOpen'),
    setGroupOpen: rec('setGroupOpen'),
    scrollTo: rec('scrollTo'),
    setGroupsOpen: rec('setGroupsOpen'),
  }
  on('ui.render', { component: 'Pane' }, ($$, e, next) => {
    if (e.requestId !== 'desk-log' || e.surface !== 'desktop') return next(e)
    return deskLog($$.ui.resolve(e), s, deskLayout(100, bodyRows), actions)
  })
  const ui = await $.ui.mount({ ...PAGE, requestId: 'desk-log', surface: 'desktop' })
  return { ui, root: await ui.drawn(), calls }
}

const round = (n: number, over: Partial<CockpitLogEntry> = {}): CockpitLogEntry => ({ at: NOW - 100_000 + n * 1000, kind: 'round', n, prompt: `prompt ${n}`, ...over })
const flow = (runId: string, over: Partial<CockpitLogEntry> = {}): CockpitLogEntry => ({ at: NOW - 50_000, kind: 'flow', key: runId, text: runId, ...over })
/** A rail cell's line in the first lane: top half, bottom half or the whole row. */
const LANE0 = { start: '<line x1="21" y1="14" x2="21" y2="28"', through: '<line x1="21" y1="0" x2="21" y2="28"', end: '<line x1="21" y1="0" x2="21" y2="14"' }

test('Given six open flows, When the log is drawn, Then every rail Svg has width 86', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const flows = [0, 1, 2, 3, 4, 5].map(lane => flow(`run${lane}`, { round: 1, endRound: 2, lane }))
  const s = snap({ sessionLog: [round(1), round(2), ...flows] })
  // When
  const { ui, root } = await drawLog($, on, s)
  // Then
  const rails = svgs(root)
  expect(rails.length).toBe(logRows(root).length)
  expect(rails.length).toBeGreaterThan(6)
  expect(rails.every(r => r.width === 86)).toBe(true)
  expect(rails.every(r => typeof r.source === 'string' && r.source.includes('width="86"'))).toBe(true)
  await ui.unmount()
})

test('Given Importanti, When the log is drawn, Then rows that Tutto shows are hidden', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const log: CockpitLogEntry[] = [round(1), { at: NOW - 98_500, kind: 'test', round: 1, text: 'npm test', isFailed: false }]
  const passed = t().page.events.test('npm test', false)
  // When
  const important = await drawLog($, on, snap({ sessionLog: log, openKeys: [] }))
  await important.ui.press({ key: 'desk:log:all' })
  await important.ui.unmount()
  // Then
  expect(logRows(important.root).some(r => r.text.includes(passed))).toBe(false)
  expect(logRows(important.root).some(r => r.text.includes('#1'))).toBe(true)
  // the same ALL_KEY the terminal log toggles: one filter for both pages
  expect(important.calls).toEqual(['toggleOpen:log:all'])
})

test('Given Tutto, When the log is drawn, Then the ok test row shows and the one button switches back to Importanti', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const log: CockpitLogEntry[] = [round(1), { at: NOW - 98_500, kind: 'test', round: 1, text: 'npm test', isFailed: false }]
  const passed = t().page.events.test('npm test', false)
  // When
  const all = await drawLog($, on, snap({ sessionLog: log, openKeys: ['log:all'] }))
  await all.ui.press({ key: 'desk:log:important' })
  await all.ui.unmount()
  // Then
  expect(logRows(all.root).some(r => r.text.includes(`#1 ${passed}`))).toBe(true)
  expect(all.calls).toEqual(['toggleOpen:log:all'])
})

test('Given a pre-v3 log, When the log is drawn, Then round headers show and one unattributed group holds the rest, last', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const log: CockpitLogEntry[] = [
    { at: NOW - 90_000, kind: 'round', prompt: 'first' },
    { at: NOW - 80_000, kind: 'commit', key: 'abc1234', text: 'fix' },
    { at: NOW - 70_000, kind: 'round', prompt: 'second' },
  ]
  // When
  const { ui, root } = await drawLog($, on, snap({ sessionLog: log }))
  await ui.unmount()
  // Then
  const rows = logRows(root).map(r => r.text)
  expect(rows).toEqual(['#2 second', '#1 first', t().desk.log.unattributed, t().page.events.commit('abc1234', 'fix')])
})

test('Given an empty log, When the log is drawn, Then an empty state shows and nothing throws', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const s = snap({ sessionLog: [] })
  // When
  const { ui, root } = await drawLog($, on, s)
  await ui.unmount()
  // Then
  expect(logRows(root)).toEqual([{ key: 'desk:log:empty', text: t().desk.log.empty }])
  expect(svgs(root).map(r => r.width)).toEqual([86])
})

test('Given a flow spanning three rounds, When the log is drawn, Then its lane draws start, through and end top to bottom', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const s = snap({ sessionLog: [round(1), round(2), round(3), flow('loop', { round: 1, endRound: 3, lane: 0 })] })
  // When
  const { ui, root } = await drawLog($, on, s)
  await ui.unmount()
  // Then
  const rails = svgs(root).map(r => String(r.source))
  expect(logRows(root).map(r => r.text)).toEqual(['#3 prompt 3', '#2 prompt 2', '#1 prompt 1', `#1 loop ${t().desk.log.flow}`])
  expect(rails[0]).toContain(LANE0.start)
  expect(rails[1]).toContain(LANE0.through)
  expect(rails[2]).toContain(LANE0.through)
  expect(rails[3]).toContain(LANE0.end)
})

test('Given a flow with no lane, When the log is drawn, Then its row carries its chip and its rail no lane column', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const s = snap({ sessionLog: [round(1), flow('nolane', { round: 1 })] })
  // When
  const { ui, root } = await drawLog($, on, s)
  await ui.unmount()
  // Then
  const rows = logRows(root)
  expect(rows.map(r => r.text)).toEqual(['#1 prompt 1', `#1 nolane ${t().desk.log.flow}`])
  expect(svgs(root).every(r => !String(r.source).includes('x1="21"'))).toBe(true)
})

/** The position hint under the rows: its text, `undefined` when it is not drawn. */
const hintOf = (root: unknown): string | undefined => {
  const n = nodes(root).find(x => keyOf(x) === 'desk:log:hint')
  return n === undefined ? undefined : textOf(n).trim()
}

test('Given more rows than bodyRows, When the log is drawn, Then the filter, the newest rows and the position hint fit bodyRows cells, with no pager', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const s = snap({ sessionLog: Array.from({ length: 12 }, (_, i) => round(i + 1)) })
  // When
  const { ui, root } = await drawLog($, on, s, 8)
  const buttons = await ui.findAll({ type: 'Button' })
  await ui.unmount()
  // Then
  const rows = logRows(root)
  // the filter takes 2 cells and the hint 1; a row is its 28px rail tall, 1.4 cells of the desktop's code font
  expect(2 + 1 + rows.length * 1.4).toBeLessThanOrEqual(8)
  expect(rows.map(r => r.text)).toEqual(['#12 prompt 12', '#11 prompt 11', '#10 prompt 10'])
  expect(hintOf(root)).toBe('1–3 / 12')
  expect(buttons.map(b => b.key).filter(k => /more|top/.test(String(k)))).toEqual([])
})

test('Given rows that fit, When the log is drawn, Then the hint row is still drawn, empty, so nothing shifts', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const s = snap({ sessionLog: [round(1), round(2)] })
  // When
  const { ui, root } = await drawLog($, on, s, 8)
  await ui.unmount()
  // Then
  expect(hintOf(root)).toBe('')
})

test('Given a round with no prompt text, When the log is drawn, Then its row reads a dim placeholder', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const s = snap({ sessionLog: [round(1), round(2, { prompt: '' })] })
  // When
  const { ui, root } = await drawLog($, on, s)
  await ui.unmount()
  // Then
  expect(logRows(root)[0]?.text).toBe(`#2 ${t().desk.log.noPrompt}`)
})

test('Given exactly as many rows as bodyRows holds, When the log is drawn, Then every row shows and no more row', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const s = snap({ sessionLog: Array.from({ length: 4 }, (_, i) => round(i + 1)) })
  // When
  const { ui, root } = await drawLog($, on, s, 9)
  await ui.unmount()
  // Then
  expect(logRows(root).map(r => r.text)).toEqual(['#4 prompt 4', '#3 prompt 3', '#2 prompt 2', '#1 prompt 1'])
})

test('Given a log with rounds, events and a flow, When the log is drawn, Then no Box is given a height of more than two cells', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const log: CockpitLogEntry[] = [round(1), round(2), { at: NOW - 98_500, kind: 'commit', round: 1, key: 'abc1234', text: 'fix' }, flow('loop', { round: 1, endRound: 2, lane: 0 })]
  // When
  const { ui, root } = await drawLog($, on, snap({ sessionLog: log }))
  await ui.unmount()
  // Then
  const heights = nodes(root)
    .filter(n => isNode(n) && n.type === 'Box')
    .map(n => propsOf(n).height)
    .filter(h => typeof h === 'number')
  expect(heights.every(h => typeof h === 'number' && h <= 2)).toBe(true)
  expect(svgs(root).every(r => r.height === 28 && r.width === 86)).toBe(true)
})

test('Given a logged signal without text, When the log is drawn, Then its row reads the notification and not its raw key', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const log: CockpitLogEntry[] = [round(1), { at: NOW - 98_500, kind: 'signal', round: 1, key: 'permissionWait:12345', severity: 'block', n: 90_000 }]
  const what = signalText({ kind: 'permissionWait', key: '12345', n: 90_000 }).what
  // When
  const { ui, root } = await drawLog($, on, snap({ sessionLog: log }))
  await ui.unmount()
  // Then
  const texts = logRows(root).map(r => r.text)
  expect(texts).toContain(`#1 ${what}`)
  expect(texts.some(x => x.includes('permissionWait'))).toBe(false)
})

test('Given a logged agent, When the log is drawn, Then its row reads its type and task, not its kind or id', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const log: CockpitLogEntry[] = [round(1), { at: NOW - 98_500, kind: 'agent', round: 1, key: 'agent-7f3', text: 'implementer', desc: 'fix rows' }]
  // When
  const { ui, root } = await drawLog($, on, snap({ sessionLog: log }))
  await ui.unmount()
  // Then
  const texts = logRows(root).map(r => r.text)
  expect(texts).toContain('#1 implementer fix rows')
  expect(texts.some(x => x.includes('agent-7f3'))).toBe(false)
})

test('Given a round with an event and a flow launch, When the log is drawn, Then each row has a 5-cell non-shrinking time column, HH:MM where the row has a time and blank on the flow launch', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const s = snap({ sessionLog: [round(1), { at: NOW - 90_000, kind: 'agent', round: 1, text: 'tester' }, flow('wf_1', { round: 1, lane: 0 })] })
  // When
  const { ui, root } = await drawLog($, on, s)
  await ui.unmount()
  // Then
  const times = nodes(root).filter(n => keyOf(n).startsWith('desk:log:row:') && keyOf(n).endsWith(':time'))
  expect(times.length).toBeGreaterThanOrEqual(2)
  expect(times.every(n => propsOf(n).width === 5 && propsOf(n).flexShrink === 0)).toBe(true)
  const byRow = Object.fromEntries(times.map(n => [keyOf(n).replace(/^desk:log:row:|:time$/g, ''), textOf(n).trim()]))
  expect(byRow['round:1']).toBe(clockTime(NOW - 100_000 + 1000))
  expect(byRow['flow:wf_1']).toBe('')
})

