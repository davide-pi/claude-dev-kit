import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { emptyInsights } from '../hooks/insights'
import { COLORS, clockTime, costCell, duration, localDate } from '../hooks/shared'
import { INITIAL } from '../hooks/state'
import { setLang } from '../hooks/strings'
import { andamentoBlocks, attentionBlocks, doneBlocks, inProgressBlocks } from '../hooks/view-page'
import { paneView } from '../hooks/view'
import { makeKit, signalIcon, signalText } from '../hooks/view-kit'
import type { Block, Kit, PaneActions } from '../hooks/view-kit'
import type { CockpitAgent, CockpitSnapshot } from '../types'
import { colorOf, keysInOrder } from './cockpit-fixtures'
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

/** Whether the first leaf Text whose content matches `re` is bold. */
const boldOf = (root: unknown, re: RegExp): boolean | undefined => {
  const o = root as { type?: string; props?: { weight?: string; props?: { cells?: { t: string; bold?: boolean }[] } }; children?: unknown[] } | null
  const [only] = o?.children ?? []
  if (typeof only === 'string' && re.test(only)) return o?.props?.weight === 'bold'
  // an animated cell (surface module) holds the spans it draws in its props
  if (o?.type === 'Client') {
    const cell = o.props?.props?.cells?.find(c => re.test(c.t))
    if (cell !== undefined) return cell.bold === true
  }
  for (const c of o?.children ?? []) {
    const found = boldOf(c, re)
    if (found !== undefined) return found
  }
  return undefined
}

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
      // the harness cannot load a surface module for this test plugin: the page is drawn as a surface without them draws it
      const ui = { ...$$.ui.resolve(e), Client: undefined }
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

/** A section's title row: the title, a space, a rule to the width. */
const titled = (label: string) => `${label} ${'─'.repeat(WIDTH - [...label].length - 1)}`

// ── ATTENZIONE ──

test('attention: nothing to do is one row, never an empty section', async ($, on) => {
  const { rows } = await draw($, on, snap(), attentionBlocks)
  expect(rows).toEqual([titled('ATTENTION'), '✓ nothing to do'])
})

test('attention: blocking first, then cost, then the rest; each row has its severity icon, what, and what to do dim under it', async ($, on) => {
  const s = snap({ agents: [agent('a1', 'Explore', { model: 'claude-opus-5-5' })], insights: insights({ failedCmds: { 'npm test': 3 } }), claudeState: WAITING })
  const { rows } = await draw($, on, s, attentionBlocks)
  expect(rows).toEqual([
    titled('ATTENTION'),
    '\u{F033E} permission waiting for 120s',
    '  answer the request in the terminal',
    '\u{F0114} Opus on a read-only agent (Explore)',
    '  set model sonnet or haiku for this agent type',
    '\u{F018D} command failed 3 times: npm test',
    '  read the error and fix the cause instead of rerunning',
  ])
})

test('attention: the icon takes the colour of its severity (block red, warn orange, info yellow) and a blocking title is bold', async ($, on) => {
  const s = snap({ agents: [agent('a1', 'Explore', { model: 'claude-opus-5-5' })], insights: insights({ failedCmds: { 'npm test': 3 } }), claudeState: WAITING })
  const { ui } = await draw($, on, s, attentionBlocks)
  const root = await ui.drawn()
  expect(colorOf(root, /^\u{F033E}/u)).toBe(COLORS.red)
  expect(colorOf(root, /^\u{F018D}/u)).toBe(COLORS.orange)
  expect(colorOf(root, /^\u{F0114}/u)).toBe(COLORS.yellow)
  expect(boldOf(root, /^permission waiting/)).toBe(true)
  expect(boldOf(root, /^command failed/)).toBe(false)
})

test('attention: a pressed row says why and what to do; the press toggles that signal', async ($, on) => {
  const calls: string[] = []
  const id = `permissionWait:${SINCE}`
  const { rows, ui } = await draw($, on, snap({ claudeState: WAITING, signalOpen: id }), attentionBlocks, calls)
  expect(rows).toEqual([titled('ATTENTION'), '\u{F033E} permission waiting for 120s', '  why: the work is stopped until you answer', '  what to do: answer the request in the terminal'])
  await ui.press({ key: `signal:${id}` })
  expect(calls).toEqual([`toggleSignal:${id}`])
})

test('attention: the worklog behind is a row with its icon and log hours on the right; up to date it is no row', async ($, on) => {
  const calls: string[] = []
  const behind = snap({ sessionId: 's-1', worklog: { pending: ['2026-10-20'], underTarget: [] } })
  const { rows, ui } = await draw($, on, behind, attentionBlocks, calls)
  expect(rows[0]).toBe(titled('ATTENTION'))
  expect(rows).not.toContain('✓ nothing to do')
  expect((await ui.find({ key: 'worklog:days' }))?.text).toBe('\u{F00F0} 1 day without logged hours')
  expect(colorOf(await ui.drawn(), /^\u{F00F0}/u)).toBe(COLORS.yellow)
  // the toggle and the button share one row, the button pushed to the right
  const row = ((await ui.drawn()) as { children: unknown[] }).children[1] as { props?: { justifyContent?: string } }
  expect(keysInOrder(row)).toEqual(['worklog:days', 'attention:worklog'])
  expect(row.props?.justifyContent).toBe('space-between')
  expect((await ui.find({ key: 'attention:worklog' }))?.text).toBe('log hours')
  await ui.press({ key: 'attention:worklog' })
  expect(calls).toEqual(['ask:worklog'])

  const open = await draw($, on, { ...behind, openKeys: ['worklog:days'] }, attentionBlocks)
  expect(open.rows.some(r => /^ {2}worklog: 1d to log/.test(r))).toBe(true)

  const noSkill = await draw($, on, { ...behind, isWorklogSkillMissing: true }, attentionBlocks)
  expect(await noSkill.ui.find({ key: 'attention:worklog' })).toBeUndefined()
})

test('attention: at most five rows and eight drawn lines, the rest behind the toggle', async ($, on) => {
  const reads = Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`/src/f${i}.ts`, 3]))
  const calls: string[] = []
  const closed = await draw($, on, snap({ insights: insights({ reads }) }), attentionBlocks, calls)
  expect((await keysOf(closed.ui, /^signal:/)).length).toBe(4)
  // a closed notification draws two lines, so four fill the eight
  expect((await closed.ui.find({ key: 'attention:more' }))?.text).toBe('󰍟 +3')
  await closed.ui.press({ key: 'attention:more' })
  expect(calls).toEqual(['toggleOpen:attention'])
  const open = await draw($, on, snap({ insights: insights({ reads }), openKeys: ['attention'] }), attentionBlocks)
  expect((await keysOf(open.ui, /^signal:/)).length).toBe(7)
  expect((await open.ui.find({ key: 'attention:more' }))?.text).toBe('󰍝 −3')
})

test('attention: a workflow stall is blocking and comes first; a workflow past its rounds is not, and a cost outranks a rest that signalsOf emits before it', async ($, on) => {
  const agents = [{ id: 'a9', isDone: false }]
  const run = (over: object) => ({ runId: 'wf_1', name: 'review', phase: 'x', round: 1, agents, lastAt: NOW, ...over })
  const failed = { failedCmds: { 'npm test': 3 }, rounds: 5 }
  const kinds = async (s: CockpitSnapshot) => (await keysOf((await draw($, on, s, attentionBlocks)).ui, /^signal:/)).map(k => k.split(':')[1])

  // the stall comes before a failed command that signalsOf emits first
  expect(await kinds(snap({ insights: insights(failed), workflowRun: run({ lastAt: NOW - 400_000 }) }))).toEqual(['workflow', 'failedCommand'])
  // a run past its rounds is no stall: it stays behind the failed command, in the order of the detectors
  expect(await kinds(snap({ insights: insights(failed), workflowRun: run({ round: 4 }) }))).toEqual(['failedCommand', 'workflow'])
  // a cost signal (the context grew) outranks the failed command that comes before it
  expect(await kinds(snap({ insights: insights(failed), ctxRounds: [100_000, 150_000, 250_000] }))).toEqual(['ctxGrowth', 'failedCommand'])
})

test('page: with eight notifications at 40 rows the footer buttons are still drawn, and the rows stay within the pane', async ($, on) => {
  const reads = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`/src/f${i}.ts`, 3]))
  const s = snap({ insights: insights({ reads }), cost: { usd: 1 } })
  const { ui, rows } = await draw($, on, s, k => [[paneView({ ...k.ui, Client: undefined }, k.s, WIDTH, 40, k.actions)]])
  expect((await keysOf(ui, /^bar:compact$/)).length).toBe(1)
  expect(rows.length).toBeLessThanOrEqual(40)
})
// ── ANDAMENTO ──

const BAR = 51
const bar = (n: number) => '▰'.repeat(n)
/** The four columns of the figures rows: floor(WIDTH / 4) cells each. */
const COL = WIDTH / 4
const cols = (...cells: string[]) => cells.map(c => c.padEnd(COL)).join('').trimEnd()

test('andamento: hidden before the first round', async ($, on) => {
  expect((await draw($, on, snap(), andamentoBlocks)).rows).toEqual([])
  expect((await draw($, on, snap({ insights: insights() }), andamentoBlocks)).rows).toEqual([])
})

test('andamento: main loop only: four columns with — for what is missing, the spend bar is all main, the context bar by tool', async ($, on) => {
  const s = snap({ cost: { usd: 10 }, insights: insights({ rounds: 3, usd: 6, byTool: { Read: 60_000, Bash: 30_000, Edit: 10_000 } }) })
  const { rows } = await draw($, on, s, andamentoBlocks)
  expect(rows).toEqual([
    titled('TREND'),
    cols('$/prompt', 'last turn', 'subagents', 'compaction'),
    cols('$2.00 →', '—', '0%', '—'),
    cols('', '', 'of spend', ''),
    `spend    ${bar(BAR)}`,
    '▰ main 100%',
    `context  ${bar(31 + 15 + 5)}`,
    '▰ Read 60%  ▰ Bash 30%  ▰ Edit 10%',
  ])
})

const AGENTS_SNAP = () =>
  snap({
    cost: { usd: 10, lastUsd: 0.44 },
    agentSpend: { implementer: 3, reviewer: 1 },
    costTarget: 1.5,
    ctx: { tokens: 120_000 },
    ctxSamples: [100_000, 110_000, 120_000],
    autoCompactAt: 150_000,
    sessionLog: [{ at: NOW - 90_000, kind: 'round', usd: 0.2, ms: 134_000 }, { at: NOW - 30_000, kind: 'round', usd: 0.44, ms: 61_000 }],
    insights: insights({ rounds: 3, usd: 6, byTool: { Read: 60_000, Bash: 20_000, Edit: 10_000, Grep: 6_000, Glob: 4_000 } }),
  })

test('andamento: main and two agent types over the target: arrow up, its max, last turn and its time, agents share, turns to compact and where, top three tools and other', async ($, on) => {
  const { rows } = await draw($, on, AGENTS_SNAP(), andamentoBlocks)
  expect(rows).toEqual([
    titled('TREND'),
    cols('$/prompt', 'last turn', 'subagents', 'compaction'),
    cols('$2.00 ↑', '$0.44', '40%', '~3 turns'),
    cols('max $1.50', '01m01s', 'of spend', 'at 150K'),
    `spend    ${bar(BAR)}`,
    '▰ main 60%  ▰ implementer 30%  ▰ reviewer 10%',
    `context  ${bar(BAR)}`,
    '▰ Read 60%  ▰ Bash 20%  ▰ Edit 10%  ▰ other 10%',
  ])
  const down = await draw($, on, { ...AGENTS_SNAP(), costTarget: 3 }, andamentoBlocks)
  expect(down.rows[2]).toBe(cols('$2.00 ↓', '$0.44', '40%', '~3 turns'))
})

test('andamento: the figures take their colours, the legend glyph the colour of its part and the label the text colour', async ($, on) => {
  const { ui } = await draw($, on, AGENTS_SNAP(), andamentoBlocks)
  const root = await ui.drawn()
  expect(colorOf(root, /^\$2\.00$/)).toBe(COLORS.red)
  expect(colorOf(root, /^↑$/)).toBe(COLORS.red)
  expect(colorOf(root, /^\$0\.44$/)).toBe(COLORS.text)
  expect(colorOf(root, /^40%$/)).toBe(COLORS.lavender)
  expect(colorOf(root, /^~3 turns$/)).toBe(COLORS.yellow) // 120K of 150K: a compact is due
  expect(colorOf(root, /^▰ $/)).toBe(COLORS.blue)
  expect(colorOf(root, /^main 60%$/)).toBeUndefined()
})

test('andamento: with no target and no autocompact threshold the max and the compaction caption are blank', async ($, on) => {
  const s = { ...AGENTS_SNAP(), autoCompactAt: undefined, costTarget: undefined }
  const { rows } = await draw($, on, s, andamentoBlocks)
  expect(rows[3]).toBe(cols('', '01m01s', 'of spend'))
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
  expect(rows.slice(0, 3)).toEqual([titled('IN PROGRESS'), '󱎖 tasks 1/2 · Write the page', '󰀦 1 file outside the perimeter'])
  expect(rows[3]).toMatch(/^󱎖 implementer/)
  expect(rows).toHaveLength(4)
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
  expect(rows).toEqual([titled('IN PROGRESS'), '󰄰 tasks 0/1', '󰄬 deliver perimeter · 1 entry', 'workflow review · x · round 1 · 0/1 · $0.00'])
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

// ── LOG ──

const SESSION_AGENT = { at: NOW - 10_000, kind: 'agent', key: 'h1', text: 'reviewer', model: 'claude-sonnet-5-5', effort: 'high', usd: 0.5, ms: 190_000 } as const
const LOG = [
  { at: NOW - 60_000, kind: 'round', usd: 0.38, ms: 134_000 },
  { at: NOW - 50_000, kind: 'commit', key: 'abc1234', text: 'abc1234' },
  { at: NOW - 40_000, kind: 'test', text: 'npm test', isFailed: true },
  { at: NOW - 30_000, kind: 'compact', key: 'c1', tokens: 180_000, after: 40_000 },
  { at: NOW - 20_000, kind: 'pr', key: '12', text: 'Fix x' },
  SESSION_AGENT,
] as const
/** The dim figures a round or an agent ends with: its share of the session's cost (4 cells), its cost, its length. */
const figs = (share: string, usd: number, ms?: number) => `${share.padStart(4)} ${costCell(usd, 7)}${ms === undefined ? '' : ` ${duration(ms)}`}`
/** A child row of a group: the tree branch, then time, icon, text, the figures right-aligned (an icon of the private use area is one cell, two UTF-16 units). */
const child = (at: number, icon: string, text: string, right?: string, isLast = false) => {
  const left = `${isLast ? '└' : '├'} ${clockTime(at)} ${icon} ${text}`
  return right === undefined ? left : left + ' '.repeat(WIDTH - [...left].length - [...right].length) + right
}
/** The day header row. */
const day = (at: number) => localDate(at)

test('done: hidden without a log or a finished agent', async ($, on) => {
  expect((await draw($, on, snap(), doneBlocks)).rows).toEqual([])
})

/** The summary row an open group starts with. */
const summary = (text: string) => `├ ${text}`

test('done: given events after the newest round, when drawn, then they are the open group under a day header: the header, a summary row, and its whole subtree, the agent with its model, cost and length', async ($, on) => {
  // Given
  const s = snap({ sessionLog: [...LOG] })
  // When
  const { rows } = await draw($, on, s, doneBlocks)
  // Then
  expect(rows).toEqual([
    titled('LOG'),
    day(NOW - 10_000),
    '▾ current round',
    summary('1 agent · 1 commit · 1 test · 1 PR · 1 compaction'),
    child(NOW - 200_000, '󰄬', 'reviewer son5.5·high', figs('', 0.5, 190_000)),
    child(NOW - 20_000, '◆', 'PR #12 Fix x'),
    child(NOW - 30_000, '◇', 'compacted 180k → 40k'),
    child(NOW - 40_000, '󰅖', 'tests failed: npm test'),
    child(NOW - 50_000, '●', 'commit abc1234', undefined, true),
    // a round with nothing in it is a plain row, under the start time
    `▸ ${clockTime(NOW - 194_000)} round 001 ${figs('', 0.38, 134_000)}`,
  ])
})

test('done: given seven groups, when drawn, then the newest five show and the toggle opens the other two', async ($, on) => {
  // Given
  const calls: string[] = []
  const log = [1, 2, 3, 4, 5, 6, 7].flatMap(n => [{ at: NOW - n * 20_000 - 10_000, kind: 'commit', key: `c${n}`, text: `c${n}` } as const, { at: NOW - n * 20_000, kind: 'round' } as const]).reverse()
  const s = snap({ sessionLog: log })
  // When
  const { rows, ui } = await draw($, on, s, doneBlocks, calls)
  // Then: the open newest group counts as one, however many rows it has
  expect(rows.filter(r => /^[▾▸] /.test(r))).toHaveLength(5)
  expect(rows.at(-1)).toBe('󰍟 +2')
  await ui.press({ key: 'done:more' })
  expect(calls).toEqual(['toggleOpen:done'])
  const open = await draw($, on, { ...s, openKeys: ['done'] }, doneBlocks)
  expect(open.rows.filter(r => /^[▾▸] /.test(r))).toHaveLength(7)
  expect(open.rows.filter(r => r.startsWith('󰍝'))).toEqual(['󰍝 −2'])
})

const ROUNDS = [
  { at: NOW - 220_000, kind: 'commit', key: 'abc1234', text: 'abc1234' },
  { at: NOW - 200_000, kind: 'round', ms: 60_000, usd: 0.44 },
  { at: NOW - 110_000, kind: 'test', text: 'npm test' },
  { at: NOW - 100_000, kind: 'round', ms: 180_000, usd: 1.12 },
] as const
const ROUND_AGENT = { at: NOW - 210_000, kind: 'agent', key: 'h1', text: 'reviewer', usd: 0.21, ms: 90_000 } as const
const header = (at: number, arrow: string, rest: string) => `${arrow} ${clockTime(at)} ${rest}`
/** The start of the rounds above: their end less their length. */
const START_2 = NOW - 280_000
const START_1 = NOW - 260_000

test('done: given rounds, when drawn, then only the newest is open and each header toggles under its own key, to the opposite state', async ($, on) => {
  // Given
  const calls: string[] = []
  const s = snap({ sessionLog: [...ROUNDS, ROUND_AGENT] })
  // When
  const { rows, ui } = await draw($, on, s, doneBlocks, calls)
  // Then
  expect(rows).toEqual([
    titled('LOG'),
    day(START_2),
    header(START_2, '▾', `round 002 ${figs('', 1.12, 180_000)}`),
    summary('1 test'),
    child(NOW - 110_000, '󰄬', 'tests passed: npm test', undefined, true),
    header(START_1, '▸', `round 001 ${figs('', 0.44, 60_000)}`),
  ])
  await ui.press({ key: `done:${NOW - 200_000}` })
  await ui.press({ key: `done:${NOW - 100_000}` })
  expect(calls).toEqual([`setGroupOpen:done:${NOW - 200_000},true`, `setGroupOpen:done:${NOW - 100_000},false`])
})

test('done: given a state a person gave, when drawn, then an older group stays open under the newest, and the newest can be closed', async ($, on) => {
  // Given
  const s = snap({ sessionLog: [...ROUNDS, ROUND_AGENT] })
  // When
  const older = await draw($, on, { ...s, groupsOpen: { [`done:${NOW - 200_000}`]: true } }, doneBlocks)
  const closed = await draw($, on, { ...s, groupsOpen: { [`done:${NOW - 100_000}`]: false } }, doneBlocks)
  // Then
  expect(older.rows.slice(5)).toEqual([
    header(START_1, '▾', `round 001 ${figs('', 0.44, 60_000)}`),
    summary('1 agent · 1 commit'),
    child(NOW - 300_000, '󰄬', 'reviewer', figs('', 0.21, 90_000)),
    child(NOW - 220_000, '●', 'commit abc1234', undefined, true),
  ])
  expect(closed.rows[2]).toBe(header(START_2, '▸', `round 002 ${figs('', 1.12, 180_000)}`))
  expect(closed.rows).toHaveLength(4)
})

test('done: given the newest group closed by a person, when a newer round arrives, then the old group stays closed and the new one is open', async ($, on) => {
  // Given
  const groupsOpen = { [`done:${NOW - 100_000}`]: false }
  const newer = [...ROUNDS, { at: NOW - 40_000, kind: 'commit', key: 'def5678', text: 'def5678' } as const, { at: NOW - 30_000, kind: 'round', ms: 10_000 } as const]
  // When
  const { rows } = await draw($, on, snap({ sessionLog: newer, groupsOpen }), doneBlocks)
  // Then
  expect(rows).toEqual([
    titled('LOG'),
    day(NOW - 40_000),
    header(NOW - 40_000, '▾', 'round 003 00m10s'),
    summary('1 commit'),
    child(NOW - 40_000, '●', 'commit def5678', undefined, true),
    header(START_2, '▸', `round 002 ${figs('', 1.12, 180_000)}`),
    header(START_1, '▸', `round 001 ${figs('', 0.44, 60_000)}`),
  ])
})

test('done: given the session total, when drawn, then each header and each agent shows its cost share in percent, aligned before the cost; none without a total or a cost', async ($, on) => {
  // Given
  const s = snap({ sessionLog: [...ROUNDS, ROUND_AGENT], groupsOpen: { [`done:${NOW - 200_000}`]: false } })
  // When
  const withTotal = await draw($, on, { ...s, cost: { usd: 4 } }, doneBlocks)
  const noCost = await draw($, on, { ...s, cost: { usd: 4 }, sessionLog: [{ at: NOW - 50_000, kind: 'round' }, { at: NOW - 60_000, kind: 'commit', key: 'abc1234', text: 'abc1234' }] }, doneBlocks)
  const agent = await draw($, on, { ...s, cost: { usd: 4 }, groupsOpen: { [`done:${NOW - 200_000}`]: true } }, doneBlocks)
  // Then
  expect(withTotal.rows[2]).toBe(header(START_2, '▾', `round 002 ${figs('28%', 1.12, 180_000)}`))
  expect(withTotal.rows.at(-1)).toBe(header(START_1, '▸', `round 001 ${figs('11%', 0.44, 60_000)}`))
  expect(agent.rows).toContain(child(NOW - 300_000, '󰄬', 'reviewer', figs('5%', 0.21, 90_000)))
  expect(noCost.rows[2]).not.toContain('%')
})

test('done: given rounds with no events, when drawn, then they are one row that does not toggle; a round without a cost prints none', async ($, on) => {
  // Given
  const log = [{ at: NOW - 300_000, kind: 'round', usd: 0.1 }, { at: NOW - 250_000, kind: 'round', usd: 0.1 }, { at: NOW - 200_000, kind: 'round', usd: 0.11 }, { at: NOW - 100_000, kind: 'commit', key: 'abc1234', text: 'abc1234' }, { at: NOW - 90_000, kind: 'round', ms: 5_000 }] as const
  // When
  const { rows, ui } = await draw($, on, snap({ sessionLog: [...log] }), doneBlocks)
  // Then
  expect(rows).toEqual([
    titled('LOG'),
    day(NOW - 95_000),
    header(NOW - 95_000, '▾', `round 004 ${'00m05s'}`),
    summary('1 commit'),
    child(NOW - 100_000, '●', 'commit abc1234', undefined, true),
    header(NOW - 200_000, '▸', `3 chat-only rounds ${figs('', 0.31)}`),
  ])
  expect(await keysOf(ui, /^done:\d/)).toEqual([`done:${NOW - 90_000}`])
})

test('done: given an agent just finished and still listed in the agents, when drawn, then it shows at once and once, from its start, without a cost it has none', async ($, on) => {
  // Given
  const fresh = agent('a9', 'implementer', { status: 'done', endedAt: NOW - 5_000 })
  const logged = { at: NOW - 5_000, kind: 'agent', key: 'a9', text: 'implementer', model: 'claude-sonnet-5-5', ms: 57_000, isFailed: false } as const
  // When
  const alone = await draw($, on, snap({ agents: [fresh] }), doneBlocks)
  const twice = await draw($, on, snap({ agents: [fresh], sessionLog: [logged] }), doneBlocks)
  // Then
  expect(alone.rows).toEqual([titled('LOG'), day(NOW - 5_000), '▾ current round', summary('1 agent'), child(NOW - 62_000, '󰄬', 'implementer son5.5', duration(57_000), true)])
  expect(twice.rows).toEqual(alone.rows)
})

test('done: given agents that finished only in the history, when drawn, then the capped history adds no row', async ($, on) => {
  // Given
  const history = [{ id: 'h1', type: 'reviewer', startedAt: NOW - 200_000, endedAt: NOW - 10_000, tokens: 0, isFailed: false, usd: 0.5 }]
  // When
  const { rows } = await draw($, on, snap({ history }), doneBlocks)
  // Then
  expect(rows).toEqual([])
})

test('done: given an agent with no model, effort or length, when drawn, then its row shows only what there is', async ($, on) => {
  // Given
  const log = [
    { at: NOW - 30_000, kind: 'agent', key: 'x', text: 'bare', isFailed: true },
    { at: NOW - 20_000, kind: 'agent', key: 'y', text: 'tuned', model: 'claude-opus-5-5', effort: 'max', ms: 5_000 },
    { at: NOW - 10_000, kind: 'agent', key: 'z', text: 'effortless', effort: 'low' },
  ] as const
  // When
  const { rows } = await draw($, on, snap({ sessionLog: [...log] }), doneBlocks)
  // Then
  expect(rows.slice(4)).toEqual([
    child(NOW - 10_000, '󰄬', 'effortless low'),
    child(NOW - 25_000, '󰄬', 'tuned opu5.5·max', duration(5_000)),
    child(NOW - 30_000, '󰅖', 'bare', undefined, true),
  ])
})

test('done: given tool counts on a round, when drawn, then the summary ends with the total and the top three by count', async ($, on) => {
  // Given
  const log = [{ at: NOW - 50_000, kind: 'commit', key: 'abc1234', text: 'abc1234' }, { at: NOW - 40_000, kind: 'round', tools: { Grep: 1, Read: 20, Edit: 5, Bash: 9 } }] as const
  // When
  const { rows } = await draw($, on, snap({ sessionLog: [...log] }), doneBlocks)
  // Then
  expect(rows[3]).toBe(summary('1 commit · 35 tools: Read 20 · Bash 9 · Edit 5'))
})

test('done: given a signal entry, when drawn, then it is a child row with its time, its severity icon and the text ATTENTION gives it', async ($, on) => {
  // Given
  const sig = { kind: 'failedCommand', key: 'npm test', label: 'npm test', n: 3 } as const
  const log = [{ at: NOW - 30_000, kind: 'signal', key: 'failedCommand:npm test', text: 'npm test', n: 3, severity: 'warn' }, { at: NOW - 25_000, kind: 'signal', key: 'gone:x' }] as const
  // When
  const { rows, ui } = await draw($, on, snap({ sessionLog: [...log] }), doneBlocks)
  // Then: a signal of a kind unknown is left out
  expect(rows.slice(2)).toEqual(['▾ current round', summary('1 signal'), child(NOW - 30_000, signalIcon(sig), signalText(sig).what, undefined, true)])
  expect(colorOf(await ui.drawn(), /^\u{F018D}/u)).toBe(COLORS.orange)
})

test('done: given groups on two dates, when drawn, then a day header opens the groups of each date, and the older one stays with its group', async ($, on) => {
  // Given
  const log = [
    { at: NOW - 90_000_000, kind: 'commit', key: 'a', text: 'a' },
    { at: NOW - 89_990_000, kind: 'round', ms: 1_000 },
    { at: NOW - 50_000, kind: 'commit', key: 'b', text: 'b' },
    { at: NOW - 40_000, kind: 'round', ms: 1_000 },
  ] as const
  // When
  const { rows } = await draw($, on, snap({ sessionLog: [...log] }), doneBlocks)
  // Then
  expect(rows.filter(r => /^\d{4}-\d\d-\d\d$/.test(r))).toEqual([day(NOW - 41_000), day(NOW - 89_991_000)])
  expect(rows.at(-1)).toMatch(/^▸ \d\d:\d\d round 001/)
  expect(rows.at(-2)).toBe(day(NOW - 89_991_000))
})

// ── Both languages ──

test('page: the section titles and the empty row in Italian', async ($, on) => {
  try {
    setLang('it')
    expect((await draw($, on, snap(), attentionBlocks)).rows).toEqual([titled('ATTENZIONE'), '✓ niente da fare'])
    const trend = await draw($, on, snap({ cost: { usd: 10 }, insights: insights({ rounds: 3, usd: 6 }) }), andamentoBlocks)
    expect(trend.rows.slice(0, 4)).toEqual([titled('ANDAMENTO'), cols('$/prompt', 'ultimo turno', 'subagenti', 'compattazione'), cols('$2.00 →', '—', '0%', '—'), cols('', '', 'della spesa')])
    expect((await draw($, on, snap({ agents: [agent('a1', 'implementer')] }), inProgressBlocks)).rows[0]).toBe(titled('IN CORSO'))
    const done = await draw($, on, snap({ sessionLog: [...ROUNDS, ROUND_AGENT], groupsOpen: { [`done:${NOW - 200_000}`]: true } }), doneBlocks)
    expect(done.rows[0]).toBe(titled('LOG'))
    expect(done.rows[2]).toBe(header(START_2, '▾', `giro 002 ${figs('', 1.12, 180_000)}`))
    expect(done.rows[3]).toBe(summary('1 test'))
    expect(done.rows[5]).toBe(header(START_1, '▾', `giro 001 ${figs('', 0.44, 60_000)}`))
    expect(done.rows[6]).toBe(summary('1 agente · 1 commit'))
    const current = (await draw($, on, snap({ sessionLog: [...LOG] }), doneBlocks)).rows
    expect(current.slice(2, 4)).toEqual(['▾ giro in corso', summary('1 agente · 1 commit · 1 test · 1 PR · 1 compattazione')])
    const idle = [{ at: 1, kind: 'round' }, { at: 2, kind: 'round' }] as const
    expect((await draw($, on, snap({ sessionLog: [...idle] }), doneBlocks)).rows.join('\n')).toContain('2 giri di sola conversazione')
  } finally {
    setLang('en')
  }
})
