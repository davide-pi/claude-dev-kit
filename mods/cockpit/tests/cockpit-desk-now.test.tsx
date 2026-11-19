import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { deskNow } from '../hooks/desk-now'
import { deskLayout } from '../hooks/desk-layout'
import type { DeskLayout } from '../hooks/desk-layout'
import { INITIAL } from '../hooks/state'
import { clockTime, duration } from '../hooks/shared'
import { t } from '../hooks/strings'
import type { PaneActions } from '../hooks/view-kit'
import type { CockpitAgent, CockpitSnapshot, CockpitWorkflowRun } from '../types'
import { NOW } from './cockpit-world'

type Node = { type?: string; props?: { key?: string; wrap?: string; flexDirection?: string }; children?: unknown[] }

const isNode = (x: unknown): x is Node => typeof x === 'object' && x !== null
const kids = (n: unknown): unknown[] => (isNode(n) ? (n.children ?? []) : [])
const NARROW = deskLayout(40, 30)
const WIDE = deskLayout(140, 30)

const snap = (over: Partial<CockpitSnapshot> = {}): CockpitSnapshot => ({ ...INITIAL, now: NOW, ...over })
const agent = (id: string, type: string, over: Partial<CockpitAgent> = {}): CockpitAgent => ({ id, type, status: 'running', startedAt: NOW - 62_000, tokens: 0, model: 'claude-sonnet-5-5', ...over })
const run = (over: Partial<CockpitWorkflowRun> = {}): CockpitWorkflowRun => ({ runId: 'r1', name: 'dev-loop', agents: [], ...over })

/** Every string leaf under `n`, in order. */
const texts = (n: unknown): string[] => (typeof n === 'string' ? [n] : kids(n).flatMap(texts))
/** Every node under `n` (itself included) that satisfies `by`. */
const find = (n: unknown, by: (x: Node) => boolean): Node[] => (isNode(n) ? [...(by(n) ? [n] : []), ...kids(n).flatMap(c => find(c, by))] : [])
/** The Texts under `n` that are not cut, neither themselves nor by a Text around them. */
const uncut = (n: unknown, isCut: boolean): Node[] => {
  if (!isNode(n)) return []
  const own = n.type === 'Text' && !isCut && n.props?.wrap !== 'truncate' ? [n] : []
  return [...own, ...kids(n).flatMap(c => uncut(c, isCut || (n.type === 'Text' && n.props?.wrap === 'truncate')))]
}
const section =(root: unknown, key: string): Node => find(root, x => x.props?.key === key)[0] ?? {}
/** Every action does nothing: the tab only draws. */
const NO_OP = (): void => undefined
const ACTIONS: PaneActions = { compact: NO_OP, ask: NO_OP, answer: NO_OP, retro: NO_OP, worklog: NO_OP, setTab: NO_OP, toggleAgent: NO_OP, toggleSignal: NO_OP, toggleOpen: NO_OP, setGroupOpen: NO_OP, scrollTo: NO_OP, setGroupsOpen: NO_OP, scrollBody: NO_OP }

type Draw = { s: CockpitSnapshot; layout: DeskLayout }
/** The draws each test's hook answers, by pane id; the hook is registered once, before the test's first call on `$`. */
const DRAWS = new WeakMap<object, Map<string, Draw>>()

/** Draws `deskNow` on the desktop surface, in a pane of its own id; the root of the drawn tree. */
async function drawNow($: Engine, on: On, s: CockpitSnapshot, layout: DeskLayout = NARROW): Promise<unknown> {
  let draws = DRAWS.get(on)
  if (draws === undefined) {
    const own = new Map<string, Draw>()
    draws = own
    DRAWS.set(on, own)
    // the Ui of the surface the pane is drawn on, resolved when the engine renders it
    on('ui.render', { component: 'Pane' }, ($$, e, nextHook) => {
      const draw = own.get(e.requestId ?? '')
      return draw === undefined || e.surface !== 'desktop' ? nextHook(e) : deskNow($$.ui.resolve(e), draw.s, draw.layout, ACTIONS)
    })
  }
  const requestId = `now${draws.size}`
  draws.set(requestId, { s, layout })
  const ui = await $.ui.mount({ plugin: 'test', component: 'Pane', requestId, props: { title: 'now', isFocused: false, bodyColumns: layout.columns, placement: 'dock', scroll: { offset: 0, bodyRows: layout.bodyRows }, view: {} }, surface: 'desktop' })
  return ui.drawn()
}

/** The text of the part keyed `key` under `root`, its string leaves joined. */
const line = (root: unknown, key: string): string => texts(section(root, key)).join('')
const N = t().desk.now

test('Given no workflow run, When drawn, Then the flow card keeps its two lines: the empty-state line and a blank one', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const s = snap()
  // When
  const root = await drawNow($, on, s)
  // Then
  expect(kids(section(root, 'now:flow'))).toHaveLength(2)
  expect(line(root, 'now:flow:name')).toBe(N.noFlow)
  expect(line(root, 'now:flow:steps').trim()).toBe('')
})

test('Given an idle session with no request, When drawn, Then the facts are blank and the card says there is no request', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const s = snap({ claudeState: { kind: 'idle' } })
  // When
  const root = await drawNow($, on, s)
  // Then
  expect(kids(section(root, 'now:request'))).toHaveLength(2)
  expect(line(root, 'now:request:facts').trim()).toBe('')
  expect(line(root, 'now:request:prompt')).toBe(N.noRequest)
})

test('Given an open request, When drawn, Then the round, start, length, cost and prompt show', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const since = NOW - 90_000
  const s = snap({ claudeState: { kind: 'working' }, roundPrompt: 'fix the login', roundStartedAt: since, sessionLog: [{ at: NOW - 7_200_000, kind: 'round', n: 6 }], cost: { usd: 3, startUsd: 2.5 } })
  // When
  const root = await drawNow($, on, s)
  // Then
  expect(line(root, 'now:request:facts')).toBe(`round 007 · ${clockTime(since)} · ${duration(90_000)} · $0.50`)
  expect(line(root, 'now:request:prompt')).toBe('fix the login')
})

test('Given a round that ended two hours ago and a prompt sent a minute ago, When drawn, Then the start is the prompt, not the end of the last round', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const s = snap({ claudeState: { kind: 'working' }, roundPrompt: 'next', roundStartedAt: NOW - 60_000, sessionLog: [{ at: NOW - 7_200_000, kind: 'round', n: 1 }] })
  // When
  const root = await drawNow($, on, s)
  // Then
  expect(line(root, 'now:request:facts')).toContain(`${clockTime(NOW - 60_000)} · ${duration(60_000)}`)
})

test('Given an open request with no roundStartedAt, When drawn, Then the start falls back to the last round entry', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const s = snap({ claudeState: { kind: 'working' }, sessionLog: [{ at: NOW - 90_000, kind: 'round', n: 1 }] })
  // When
  const root = await drawNow($, on, s)
  // Then
  expect(line(root, 'now:request:facts')).toContain(`${clockTime(NOW - 90_000)} · ${duration(90_000)}`)
})

test('Given an open request with no earlier round, When drawn, Then the missing start reads as the dash', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const s = snap({ claudeState: { kind: 'thinking' } })
  // When
  const root = await drawNow($, on, s)
  // Then
  expect(line(root, 'now:request:facts')).toBe('round 001 · — · — · —')
})

test('Given an agent with a runId, When drawn, Then it is not listed among the agents outside the flow', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const s = snap({ agents: [agent('a1', 'implementer', { runId: 'r1' }), agent('a2', 'Plan')], workflowRun: run({ agents: [{ id: 'a1', isDone: false }] }) })
  // When
  const root = await drawNow($, on, s)
  // Then
  const outside = texts(section(root, 'now:outside')).join(' ')
  expect(outside).toContain('Plan')
  expect(outside).not.toContain('implementer')
})

test('Given an agent the run lists by id only, When drawn, Then it is not listed outside the flow either', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const s = snap({ agents: [agent('a1', 'implementer')], workflowRun: run({ agents: [{ id: 'a1', isDone: false }] }) })
  // When
  const root = await drawNow($, on, s)
  // Then
  expect(texts(section(root, 'now:outside')).join(' ')).not.toContain('implementer')
})

test('Given no agent outside the flow, When drawn, Then the section says so in one line', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const s = snap({ agents: [agent('a1', 'implementer', { status: 'done', endedAt: NOW - 1_000 })] })
  // When
  const root = await drawNow($, on, s)
  // Then
  expect(texts(section(root, 'now:outside'))).toEqual(['AGENTS OUTSIDE THE FLOW', N.noAgents])
})

test('Given a live run on its second cycle, When drawn, Then the name, the cycle and the step segments show', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const agents = [
    { id: 'w1', isDone: true, label: 'B1 · T1 · implement' },
    { id: 'w2', isDone: true, label: 'B1 · T1 · reader A' },
    { id: 'w3', isDone: false, label: 'B2 · T2 · implement' },
  ]
  const s = snap({ workflowRun: run({ agents, round: 2, tasks: [{ id: 'T1', title: '', dependsOn: [] }, { id: 'T2', title: '', dependsOn: [] }] }) })
  // When
  const root = await drawNow($, on, s)
  // Then
  expect(line(root, 'now:flow:name')).toBe('dev-loop · cycle 2/2')
  expect(line(root, 'now:flow:steps')).toBe('step implement')
})

test('Given a run that ended, When drawn, Then the flow card is empty again', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const s = snap({ workflowRun: run({ endedAt: NOW - 5_000, agents: [{ id: 'w1', isDone: true, label: 'B1 · T1 · implement' }] }) })
  // When
  const root = await drawNow($, on, s)
  // Then
  expect(line(root, 'now:flow:name')).toBe(N.noFlow)
  expect(line(root, 'now:flow:steps').trim()).toBe('')
})

test('Given a one-column layout, When drawn, Then the three sections stack in a column', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const s = snap()
  // When
  const root = await drawNow($, on, s, NARROW)
  // Then
  const body = section(root, 'now:body')
  expect(body.props?.flexDirection).toBe('column')
  expect(kids(body).map(c => (isNode(c) ? c.props?.key : undefined))).toEqual(['now:request', 'now:flow', 'now:outside'])
})

test('Given a two-column layout, When drawn, Then the request and the flow sit left and the agents right', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const s = snap()
  // When
  const root = await drawNow($, on, s, WIDE)
  // Then
  const body = section(root, 'now:body')
  expect(WIDE.nowColumns).toBe(2)
  const [left, right] = kids(body)
  expect(kids(left).map(c => (isNode(c) ? c.props?.key : undefined))).toEqual(['now:request', 'now:flow'])
  expect(kids(right).map(c => (isNode(c) ? c.props?.key : undefined))).toEqual(['now:outside'])
})

test('Given an empty and a busy session in one layout, When drawn, Then the sections and their row counts match', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const empty = snap()
  const busy = snap({ claudeState: { kind: 'working' }, roundPrompt: 'x', workflowRun: run({ agents: [{ id: 'w1', isDone: false, label: 'B1 · T1 · implement' }], round: 1 }), agents: [agent('a1', 'implementer', { runId: 'r1' })] })
  // When
  const a = await drawNow($, on, empty)
  const b = await drawNow($, on, busy)
  // Then
  for (const key of ['now:request', 'now:flow', 'now:outside']) expect(kids(section(a, key)).length).toBe(kids(section(b, key)).length)
})

test('Given a prompt and an agent description far wider than the pane, When drawn, Then every Text is cut, not wrapped', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const long = 'x'.repeat(400)
  const s = snap({ claudeState: { kind: 'working' }, roundPrompt: long, agents: [agent('a1', 'Plan', { description: long })] })
  // When
  const root = await drawNow($, on, s)
  // Then
  expect(uncut(root, false).filter(x => texts(x).join('').includes(long))).toEqual([])
  expect(find(root, x => x.type === 'Text' && texts(x).join('').includes(long)).length).toBeGreaterThan(0)
})

test('Given more agents than the pane has rows, When drawn, Then the list is cut and a +n row ends it', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const s = snap({ agents: Array.from({ length: 12 }, (_, i) => agent(`a${i}`, `Agent${i}`)) })
  // When
  const root = await drawNow($, on, s, deskLayout(40, 8))
  // Then
  const list = section(root, 'now:outside:list')
  expect(kids(list)).toHaveLength(3 + 1)
  expect(texts(kids(list).at(-1))).toEqual(['+9'])
})
