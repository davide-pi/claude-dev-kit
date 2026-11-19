import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { deskUrgent } from '../hooks/desk-urgent'
import { signalsOf } from '../hooks/signals'
import type { PaneActions } from '../hooks/view-kit'
import { signalText } from '../hooks/view-kit'
import type { CockpitSnapshot } from '../types'
import { snap } from './cockpit-page-draw'
import { NOW, PANE } from './cockpit-world'

// ── The URGENTE card's blocking notification slots ──

type Node = { type?: unknown; props?: unknown; children?: unknown; text?: unknown }
const isNode = (v: unknown): v is Node => typeof v === 'object' && v !== null
const propsOf = (v: unknown): Record<string, unknown> => (isNode(v) && typeof v.props === 'object' && v.props !== null ? { ...v.props } : {})
const kids = (v: unknown): unknown[] => (isNode(v) && Array.isArray(v.children) ? v.children : [])
const nodes = (v: unknown): unknown[] => [v, ...kids(v).flatMap(nodes)]
const textOf = (v: unknown): string => (typeof v === 'string' ? v : isNode(v) && typeof v.text === 'string' ? v.text : kids(v).map(textOf).join(''))
const keyed = (root: unknown, key: string): unknown => nodes(root).find(n => propsOf(n).key === key)

const noop = (): void => undefined
const ACTIONS: PaneActions = {
  compact: noop,
  retro: noop,
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

const SLOTS = new WeakMap<object, Map<string, CockpitSnapshot>>()
let counter = 0

/** Draws `deskUrgent` alone on the desktop surface, one render hook per test serving every draw; the card's row count and text. */
async function drawCard($: Engine, on: On, s: CockpitSnapshot) {
  const requestId = `urgent${counter++}`
  const known = SLOTS.get(on)
  const slots = known ?? new Map<string, CockpitSnapshot>()
  slots.set(requestId, s)
  if (known === undefined) {
    SLOTS.set(on, slots)
    on('ui.render', { component: 'Pane' }, ($$, e, next) => {
      const slot = slots.get(e.requestId ?? '')
      return slot === undefined || e.surface !== 'desktop' ? next(e) : deskUrgent($$.ui.resolve(e), slot, ACTIONS)
    })
  }
  const ui = await $.ui.mount({ ...PANE, requestId, surface: 'desktop' })
  const card = keyed(await ui.drawn(), 'desk:urgent')
  await ui.unmount()
  return { rows: kids(card).length, text: textOf(card) }
}

/** A permission unanswered for ten minutes: one blocking notification. */
const waiting = { claudeState: { kind: 'waiting', since: NOW - 600_000 } } as const
/** A workflow run silent for an hour with an agent still out: the other blocking notification. */
const stalled = { workflowRun: { runId: 'wf_1', name: 'loop', phase: 'x', round: 1, lastAt: NOW - 3_600_000, agents: [{ id: 'a1', isDone: false }] } }

test('Given two blocking notifications, When the card is drawn, Then both show and no more row', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const s = snap({ sessionId: 's-1', ...waiting, ...stalled })
  const whats = signalsOf(s).map(sig => signalText(sig).what)
  // When
  const card = await drawCard($, on, s)
  // Then
  expect(whats).toHaveLength(2)
  for (const what of whats) expect(card.text).toContain(what)
  expect(card.text).not.toContain('+1')
})

test('Given none, one or two blocking notifications, When the card is drawn, Then it keeps the same number of rows', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const snaps = [snap({ sessionId: 's-1' }), snap({ sessionId: 's-1', ...waiting }), snap({ sessionId: 's-1', ...waiting, ...stalled })]
  // When
  const rows: number[] = []
  for (const s of snaps) rows.push((await drawCard($, on, s)).rows)
  // Then
  expect(rows[0]).toBeGreaterThan(0)
  expect(new Set(rows).size).toBe(1)
})
