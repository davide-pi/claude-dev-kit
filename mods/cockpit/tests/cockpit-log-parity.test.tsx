import { expect, test } from 'claude-code/testing'

import { deskLayout } from '../hooks/desk-layout'
import { deskLog } from '../hooks/desk-log'
import { logRowsOf } from '../hooks/log-rows'
import type { PaneActions } from '../hooks/view-kit'
import { laneBlocks } from '../hooks/view-lanes'
import type { CockpitLogEntry, CockpitSnapshot } from '../types'
import { PAGE, draw, snap } from './cockpit-page-draw'
import { NOW } from './cockpit-world'

type Node = { type?: unknown; props?: unknown; children?: unknown; text?: unknown }
const isNode = (v: unknown): v is Node => typeof v === 'object' && v !== null
const kids = (v: unknown): unknown[] => (isNode(v) && Array.isArray(v.children) ? v.children : [])
const nodes = (v: unknown): unknown[] => [v, ...kids(v).flatMap(nodes)]
const textOf = (v: unknown): string => (typeof v === 'string' ? v : isNode(v) && typeof v.text === 'string' ? v.text : kids(v).map(textOf).join(''))
const keyOf = (v: unknown): string => {
  const k = isNode(v) && isNode(v.props) ? (v.props as Record<string, unknown>).key : undefined
  return typeof k === 'string' ? k : ''
}

const log: CockpitLogEntry[] = [
  { at: NOW - 100_000, kind: 'round', n: 1, prompt: 'first' },
  { at: NOW - 90_000, kind: 'round', n: 2, prompt: 'second' },
  { at: NOW - 80_000, kind: 'flow', key: 'run1', text: 'build', round: 1, endRound: 2, lane: 0 },
  { at: NOW - 70_000, kind: 'commit', round: 2, key: 'abc1234', text: 'fix' },
]

test('Given one snapshot, When the desktop Log and the terminal Log tab are drawn, Then both draw the rows of logRowsOf, in the same order', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const s: CockpitSnapshot = snap({ sessionLog: log })
  const model = logRowsOf(s)
  const actions = new Proxy({}, { get: () => () => undefined }) as PaneActions
  on('ui.render', { component: 'Pane' }, ($$, e, next) => (e.requestId === 'desk-log' && e.surface === 'desktop' ? deskLog($$.ui.resolve(e), s, deskLayout(100, 30), actions) : next(e)))
  // When
  const term = await draw($, on, s, laneBlocks)
  await term.ui.unmount()
  const desk = await $.ui.mount({ ...PAGE, requestId: 'desk-log', surface: 'desktop' })
  const deskRows = nodes(await desk.drawn()).filter(n => /^desk:log:row:/.test(keyOf(n)) && !keyOf(n).endsWith(':time')).map(n => ({ key: keyOf(n), text: textOf(kids(n).at(-1)).trim() }))
  await desk.unmount()
  const termRows = term.rows.filter(r => r.trim() !== '').slice(1)
  // Then
  expect(model.length).toBeGreaterThan(3)
  expect(deskRows.map(r => r.key)).toEqual(model.map(r => `desk:log:row:${r.key}`))
  expect(termRows.length).toBe(model.length)
  deskRows.forEach((r, i) => expect(termRows[i]?.endsWith(r.text)).toBe(true))
})
