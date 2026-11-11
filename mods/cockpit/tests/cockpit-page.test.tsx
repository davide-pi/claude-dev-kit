import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { emptyInsights } from '../hooks/insights'
import { clockTime, costCell } from '../hooks/shared'
import { INITIAL } from '../hooks/state'
import { setLang } from '../hooks/strings'
import { andamentoBlocks, attentionBlocks, doneBlocks, inProgressBlocks } from '../hooks/view-page'
import { makeKit } from '../hooks/view-tabs'
import type { Block, Kit, PaneActions } from '../hooks/view-tabs'
import type { CockpitAgent, CockpitSnapshot } from '../types'
import { NOW, rowTexts } from './cockpit-world'

const WIDTH = 60
const PAGE = {
  plugin: 'test',
  component: 'Pane',
  requestId: 'page',
  props: { title: 'page', isFocused: false, bodyColumns: WIDTH, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
  surface: 'terminal',
} as const

const snap = (over: Partial<CockpitSnapshot> = {}): CockpitSnapshot => ({ ...INITIAL, now: NOW, ...over })
const agent = (id: string, type: string, over: Partial<CockpitAgent> = {}): CockpitAgent => ({ id, type, status: 'running', startedAt: NOW - 62_000, tokens: 0, model: 'claude-sonnet-5-5', ...over })
const insights = (over: object = {}) => ({ ...emptyInsights(), ...over })

/** The keys of the drawn Buttons that match `re`. */
const keysOf = async (ui: Awaited<ReturnType<Engine['ui']['mount']>>, re: RegExp) => (await ui.findAll({ type: 'Button' })).map(b => b.key ?? '').filter(k => re.test(k))

const flat = (b: readonly unknown[]): unknown[] => b.flatMap(x => (Array.isArray(x) ? flat(x) : [x]))

type Slot = { s: CockpitSnapshot; build: (k: Kit) => Block[]; calls: string[] }
type Draws = { slots: Map<string, Slot>; next: number }
const DRAWS = new WeakMap<object, Draws>()

/** Draws what a section builder returns in a pane of its own; `calls` records every action the page presses, `name:args`. */
async function draw($: Engine, on: On, s: CockpitSnapshot, build: (k: Kit) => Block[], calls: string[] = []) {
  // one hook per test, registered before the first call on `$`; each draw is a pane of its own id
  let d = DRAWS.get(on)
  if (d === undefined) {
    const own: Draws = { slots: new Map(), next: 0 }
    d = own
    DRAWS.set(on, own)
    on('ui.render', { component: 'Pane' }, ($$, e, next) => {
      const slot = own.slots.get(e.requestId ?? '')
      if (slot === undefined) return next(e)
      const ui = $$.ui.resolve(e)
      const { Box } = ui
      const actions = new Proxy({}, { get: (_, name) => (...args: unknown[]) => void slot.calls.push(`${String(name)}:${args.join(',')}`) }) as PaneActions
      return <Box flexDirection="column">{flat(slot.build(makeKit(ui, slot.s, WIDTH, actions))) as never}</Box>
    })
  }
  const requestId = `page${d.next++}`
  d.slots.set(requestId, { s, build, calls })
  const ui = await $.ui.mount({ ...PAGE, requestId })
  const rows = rowTexts(await ui.drawn()).map(r => r.trimEnd())
  return { ui, rows }
}

const SINCE = NOW - 120_000
const WAITING = { kind: 'waiting', since: SINCE } as const

// ── ATTENZIONE ──

test('attention: nothing to do is one row, never an empty section', async ($, on) => {
  const { rows } = await draw($, on, snap(), attentionBlocks)
  expect(rows).toEqual(['', 'ATTENTION', '✓ nothing to do'])
})

test('attention: blocking first, then cost, then the rest; each row says what and what to do', async ($, on) => {
  const s = snap({ agents: [agent('a1', 'Explore', { model: 'claude-opus-5-5' })], insights: insights({ failedCmds: { 'npm test': 3 } }), claudeState: WAITING })
  const { rows } = await draw($, on, s, attentionBlocks)
  expect(rows).toEqual([
    '',
    'ATTENTION',
    '! permission waiting for 120s',
    '  → answer the request in the terminal',
    '󰍟 Opus on a read-only agent (Explore)',
    '  → set model sonnet or haiku for this agent type',
    '󰍟 command failed 3 times: npm test',
    '  → read the error and fix the cause instead of rerunning',
  ])
})

test('attention: a pressed row says why and what to do; the press toggles that signal', async ($, on) => {
  const calls: string[] = []
  const id = `permissionWait:${SINCE}`
  const { rows, ui } = await draw($, on, snap({ claudeState: WAITING, signalOpen: id }), attentionBlocks, calls)
  expect(rows).toEqual(['', 'ATTENTION', '! permission waiting for 120s', '  why: the work is stopped until you answer', '  what to do: answer the request in the terminal'])
  await ui.press({ key: `signal:${id}` })
  expect(calls).toEqual([`toggleSignal:${id}`])
})

test('attention: the worklog behind is a row with log hours; up to date it is no row', async ($, on) => {
  const calls: string[] = []
  const behind = snap({ sessionId: 's-1', worklog: { pending: ['2026-10-20'], underTarget: [] } })
  const { rows, ui } = await draw($, on, behind, attentionBlocks, calls)
  expect(rows.slice(0, 2)).toEqual(['', 'ATTENTION'])
  expect(rows).not.toContain('✓ nothing to do')
  expect((await ui.find({ key: 'worklog:days' }))?.text).toBe('▸ worklog · 1 day behind')
  expect((await ui.find({ key: 'attention:worklog' }))?.text).toBe('log hours')
  await ui.press({ key: 'attention:worklog' })
  expect(calls).toEqual(['ask:worklog'])

  const open = await draw($, on, { ...behind, openKeys: ['worklog:days'] }, attentionBlocks)
  expect(open.rows.some(r => /^ {2}worklog: 1d to log/.test(r))).toBe(true)

  const noSkill = await draw($, on, { ...behind, isWorklogSkillMissing: true }, attentionBlocks)
  expect(await noSkill.ui.find({ key: 'attention:worklog' })).toBeUndefined()
})

test('attention: at most five rows, the rest behind the toggle', async ($, on) => {
  const reads = Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`/src/f${i}.ts`, 3]))
  const calls: string[] = []
  const closed = await draw($, on, snap({ insights: insights({ reads }) }), attentionBlocks, calls)
  expect((await keysOf(closed.ui, /^signal:/)).length).toBe(5)
  expect((await closed.ui.find({ key: 'attention:more' }))?.text).toBe('󰍟 +2')
  await closed.ui.press({ key: 'attention:more' })
  expect(calls).toEqual(['toggleOpen:attention'])
  const open = await draw($, on, snap({ insights: insights({ reads }), openKeys: ['attention'] }), attentionBlocks)
  expect((await keysOf(open.ui, /^signal:/)).length).toBe(7)
  expect((await open.ui.find({ key: 'attention:more' }))?.text).toBe('󰍝 −2')
})

// ── ANDAMENTO ──

const BAR = 51
const bar = (n: number) => '▰'.repeat(n)

test('andamento: hidden before the first round', async ($, on) => {
  expect((await draw($, on, snap(), andamentoBlocks)).rows).toEqual([])
  expect((await draw($, on, snap({ insights: insights() }), andamentoBlocks)).rows).toEqual([])
})

test('andamento: main loop only: $/prompt flat, the spend bar is all main, the context bar by tool', async ($, on) => {
  const s = snap({ cost: { usd: 10 }, insights: insights({ rounds: 3, usd: 6, byTool: { Read: 60_000, Bash: 30_000, Edit: 10_000 } }) })
  const { rows } = await draw($, on, s, andamentoBlocks)
  expect(rows).toEqual([
    '',
    'TREND',
    '$2.00/prompt →',
    'agents 0%',
    `spend    ${bar(BAR)}`,
    '         ■ main 100%',
    `context  ${bar(31 + 15 + 5)}`,
    '         ■ Read 60%  ■ Bash 30%  ■ Edit 10%',
  ])
})

test('andamento: main and two agent types over the target: arrow up, agents share, turns to compact, top three tools and other', async ($, on) => {
  const s = snap({
    cost: { usd: 10 },
    agentSpend: { implementer: 3, reviewer: 1 },
    costTarget: 1.5,
    ctx: { tokens: 120_000 },
    ctxSamples: [100_000, 110_000, 120_000],
    autoCompactAt: 150_000,
    insights: insights({ rounds: 3, usd: 6, byTool: { Read: 60_000, Bash: 20_000, Edit: 10_000, Grep: 6_000, Glob: 4_000 } }),
  })
  const { rows } = await draw($, on, s, andamentoBlocks)
  expect(rows).toEqual([
    '',
    'TREND',
    '$2.00/prompt ↑ target $1.50',
    'agents 40% · compact in ~3 turns',
    `spend    ${bar(BAR)}`,
    '         ■ main 60%  ■ implementer 30%  ■ reviewer 10%',
    `context  ${bar(BAR)}`,
    '         ■ Read 60%  ■ Bash 20%  ■ Edit 10%  ■ other 10%',
  ])
  const down = await draw($, on, { ...s, costTarget: 3 }, andamentoBlocks)
  expect(down.rows[2]).toBe('$2.00/prompt ↓ target $3.00')
})

// ── IN CORSO ──

test('in progress: hidden when nothing runs and no task is open', async ($, on) => {
  expect((await draw($, on, snap(), inProgressBlocks)).rows).toEqual([])
  const done = snap({ tasks: [{ id: '1', subject: 'Done thing', status: 'completed' }], perimeter: ['src/'] })
  expect((await draw($, on, done, inProgressBlocks)).rows).toEqual([])
})

test('in progress: tasks, the perimeter with its files outside, the running agents', async ($, on) => {
  const calls: string[] = []
  const s = snap({
    tasks: [
      { id: '1', subject: 'Write the page', status: 'in_progress', startedAt: NOW - 5000 },
      { id: '2', subject: 'Old', status: 'completed' },
    ],
    perimeter: ['a/', 'b.ts'],
    perimeterCheck: { files: 3, outside: ['c.ts'] },
    agents: [agent('a1', 'implementer'), agent('a2', 'reviewer', { status: 'done', endedAt: NOW - 1000 })],
  })
  const { rows, ui } = await draw($, on, s, inProgressBlocks, calls)
  expect(rows.slice(0, 4)).toEqual(['', 'IN PROGRESS', '󱎖 tasks 1/2 · Write the page', '󰀦 1 file outside the perimeter'])
  expect(rows[4]).toMatch(/^󱎖 implementer/)
  expect(rows).toHaveLength(5)
  await ui.press({ key: 'agent:a1' })
  expect(calls).toEqual(['toggleAgent:a1'])
  const open = await draw($, on, { ...s, agentsOpen: ['a1'] }, inProgressBlocks)
  expect(open.rows).toContain('  tokens 0')
})

test('in progress: a perimeter with nothing outside reads as kept; the workflow run is a row', async ($, on) => {
  const s = snap({
    tasks: [{ id: '1', subject: 'Write', status: 'pending' }],
    perimeter: ['a/'],
    perimeterCheck: { files: 1, outside: [] },
    workflowRun: { runId: 'wf_1', name: 'review', phase: 'x', round: 1, agents: [{ id: 'a9', isDone: false }] },
  })
  const { rows } = await draw($, on, s, inProgressBlocks)
  expect(rows).toEqual(['', 'IN PROGRESS', '󰄰 tasks 0/1', '󰄬 deliver perimeter · 1 entry', 'workflow review · x · round 1 · 0/1 · $0.00'])
})

test('in progress: at most five rows, the rest behind the toggle', async ($, on) => {
  const agents = Array.from({ length: 7 }, (_, i) => agent(`a${i}`, `worker${i}`))
  const calls: string[] = []
  const closed = await draw($, on, snap({ agents }), inProgressBlocks, calls)
  expect((await keysOf(closed.ui, /^agent:/)).length).toBe(5)
  expect((await closed.ui.find({ key: 'inProgress:more' }))?.text).toBe('󰍟 +2')
  await closed.ui.press({ key: 'inProgress:more' })
  expect(calls).toEqual(['toggleOpen:inProgress'])
  const open = await draw($, on, snap({ agents, openKeys: ['inProgress'] }), inProgressBlocks)
  expect((await keysOf(open.ui, /^agent:/)).length).toBe(7)
})

// ── FATTO ──

const LOG = [
  { at: NOW - 60_000, kind: 'round', usd: 0.38, ms: 134_000 },
  { at: NOW - 50_000, kind: 'commit', key: 'abc1234', text: 'abc1234' },
  { at: NOW - 40_000, kind: 'test', text: 'npm test', isFailed: true },
  { at: NOW - 30_000, kind: 'compact', key: 'c1', tokens: 180_000, after: 40_000 },
  { at: NOW - 20_000, kind: 'pr', key: '12', text: 'Fix x' },
] as const
const HISTORY = [{ id: 'h1', type: 'reviewer', startedAt: NOW - 200_000, endedAt: NOW - 10_000, tokens: 0, isFailed: false, usd: 0.5 }]
/** A row's text: the cost right-aligned, the left padded by cells (an icon of the private use area is one cell, two UTF-16 units). */
const fullRow = (at: number, icon: string, text: string, cost?: string) => {
  const left = `${clockTime(at)} ${icon} ${text}`
  return cost === undefined ? left : left + ' '.repeat(WIDTH - 7 - [...left].length) + cost
}

test('done: hidden without a log or a finished agent', async ($, on) => {
  expect((await draw($, on, snap(), doneBlocks)).rows).toEqual([])
})

test('done: the newest five of the log and the finished agents by time, the rest behind the toggle', async ($, on) => {
  const calls: string[] = []
  const s = snap({ sessionLog: [...LOG], history: HISTORY })
  const { rows, ui } = await draw($, on, s, doneBlocks, calls)
  expect(rows).toEqual([
    '',
    'DONE',
    fullRow(NOW - 10_000, '󰄬', 'agent reviewer', costCell(0.5, 7)),
    fullRow(NOW - 20_000, '◆', 'PR #12 Fix x'),
    fullRow(NOW - 30_000, '◇', 'compacted 180k → 40k'),
    fullRow(NOW - 40_000, '󰅖', 'tests failed: npm test'),
    fullRow(NOW - 50_000, '●', 'commit abc1234'),
    '󰍟 +1',
  ])
  expect((await ui.find({ key: 'done:more' }))?.text).toBe('󰍟 +1')
  await ui.press({ key: 'done:more' })
  expect(calls).toEqual(['toggleOpen:done'])
  const open = await draw($, on, { ...s, openKeys: ['done'] }, doneBlocks)
  // the opened rows come below the toggle, which stays where it was pressed
  expect(open.rows.slice(-2)).toEqual(['󰍝 −1', fullRow(NOW - 60_000, '·', 'turn 02m14s', costCell(0.38, 7))])
})

test('done: an agent just finished, still listed in the agents, shows at once and once', async ($, on) => {
  const fresh = agent('a9', 'implementer', { status: 'done', endedAt: NOW - 5_000 })
  const alone = await draw($, on, snap({ agents: [fresh] }), doneBlocks)
  expect(alone.rows).toEqual(['', 'DONE', fullRow(NOW - 5_000, '󰄬', 'agent implementer')])
  const twice = await draw($, on, snap({ agents: [fresh], history: [{ id: 'a9', type: 'implementer', startedAt: NOW - 62_000, endedAt: NOW - 5_000, tokens: 0, isFailed: false }] }), doneBlocks)
  expect(twice.rows).toEqual(alone.rows)
})

// ── Both languages ──

test('page: the section titles and the empty row in Italian', async ($, on) => {
  try {
    setLang('it')
    expect((await draw($, on, snap(), attentionBlocks)).rows).toEqual(['', 'ATTENZIONE', '✓ niente da fare'])
    const trend = await draw($, on, snap({ cost: { usd: 10 }, insights: insights({ rounds: 3, usd: 6 }) }), andamentoBlocks)
    expect(trend.rows.slice(0, 4)).toEqual(['', 'ANDAMENTO', '$2.00/prompt →', 'agenti 0%'])
    expect((await draw($, on, snap({ agents: [agent('a1', 'implementer')] }), inProgressBlocks)).rows[1]).toBe('IN CORSO')
    expect((await draw($, on, snap({ sessionLog: [...LOG] }), doneBlocks)).rows[1]).toBe('FATTO')
  } finally {
    setLang('en')
  }
})
