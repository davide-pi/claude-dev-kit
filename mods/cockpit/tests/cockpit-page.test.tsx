import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { agentLog } from '../hooks/agents'
import { emptyInsights } from '../hooks/insights'
import { COLORS, clockTime, costCell, duration, effortGlyph, localDate } from '../hooks/shared'
import { signalId } from '../hooks/signals'
import { INITIAL } from '../hooks/state'
import { setLang } from '../hooks/strings'
import { andamentoBlocks, attentionBlocks, doneBlocks, inProgressBlocks, shortLabel } from '../hooks/view-page'
import { paneView } from '../hooks/view'
import { makeKit, signalIcon, signalText } from '../hooks/view-kit'
import type { Block, Kit, PaneActions } from '../hooks/view-kit'
import type { CockpitAgent, CockpitLogEntry, CockpitSnapshot } from '../types'
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

const snap = (over: Partial<CockpitSnapshot> = {}): CockpitSnapshot => ({ ...INITIAL, now: NOW, openKeys: ['log:all'], ...over })
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

test('attention: Given signals that first held at different times, When drawn, Then a blocking one stays on top and the others come newest first', async ($, on) => {
  // Given: the permission wait is the oldest, the opus agent the newest, the failed command in between
  const s = snap({
    agents: [agent('a1', 'Explore', { model: 'claude-opus-5-5' })],
    insights: insights({ failedCmds: { 'npm test': 3 } }),
    claudeState: WAITING,
    signalsAt: { [`permissionWait:${SINCE}`]: NOW - 120_000, 'failedCommand:npm test': NOW - 60_000, 'opusReadOnly:a1': NOW - 30_000 },
  })
  // When
  const { rows } = await draw($, on, s, attentionBlocks)
  // Then
  expect(rows.filter(r => /^\S/.test(r) && r !== titled('ATTENTION')).map(r => [...r][0])).toEqual(['\u{F033E}', '\u{F0114}', '\u{F018D}'])
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

test('attention: Given the worklog behind, a blocking signal and more notifications than fit, When drawn closed, Then the worklog row is pinned right under the blocking one, above every notification, never behind the toggle', async ($, on) => {
  // Given
  const reads = Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`/src/f${i}.ts`, 4]))
  const s = snap({ sessionId: 's-1', worklog: { pending: ['2026-10-20'], underTarget: [] }, insights: insights({ reads }), claudeState: WAITING, signalsAt: { [`permissionWait:${SINCE}`]: NOW - 1_000 } })
  // When
  const { rows, ui } = await draw($, on, s, attentionBlocks)
  // Then
  expect(await ui.find({ key: 'worklog:days' })).toBeDefined()
  const at = (re: RegExp) => rows.findIndex(r => re.test(r))
  expect(at(/permission/)).toBeLessThan(at(/without logged hours/))
  expect(at(/without logged hours/)).toBeLessThan(at(/read 4/))
})

test('attention: at most five rows and eight drawn lines, the rest behind the toggle', async ($, on) => {
  const reads = Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`/src/f${i}.ts`, 4]))
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
  expect(await kinds(snap({ insights: insights(failed), workflowRun: run({ lastAt: NOW - 700_000 }) }))).toEqual(['workflow', 'failedCommand'])
  // a run past its rounds is no stall: it stays behind the failed command, in the order of the detectors
  expect(await kinds(snap({ insights: insights(failed), workflowRun: run({ round: 5 }) }))).toEqual(['failedCommand', 'workflow'])
  // a cost signal (the context grew) outranks the failed command that comes before it
  expect(await kinds(snap({ insights: insights(failed), ctxRounds: [100_000, 150_000, 250_000] }))).toEqual(['ctxGrowth', 'failedCommand'])
})

test('page: with eight notifications at 40 rows the footer buttons are still drawn, and the rows stay within the pane', async ($, on) => {
  const reads = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`/src/f${i}.ts`, 4]))
  const s = snap({ insights: insights({ reads }), cost: { usd: 1 } })
  const { ui, rows } = await draw($, on, s, k => [[paneView({ ...k.ui, Client: undefined }, k.s, WIDTH, 40, k.actions)]])
  expect((await keysOf(ui, /^bar:compact$/)).length).toBe(1)
  expect(rows.length).toBeLessThanOrEqual(40)
})
// ── ANDAMENTO ──

const BAR = 51
const bar = (n: number) => '▰'.repeat(n)
test('andamento: hidden before the first round', async ($, on) => {
  expect((await draw($, on, snap(), andamentoBlocks)).rows).toEqual([])
  expect((await draw($, on, snap({ insights: insights() }), andamentoBlocks)).rows).toEqual([])
})

test('andamento: Given the main loop only, When it is drawn, Then the spend bar is all main, the context bar by tool, and no figures row', async ($, on) => {
  // Given
  const s = snap({ cost: { usd: 10 }, insights: insights({ rounds: 3, usd: 6, byTool: { Read: 60_000, Bash: 30_000, Edit: 10_000 } }) })
  // When
  const { rows } = await draw($, on, s, andamentoBlocks)
  // Then
  expect(rows).toEqual([
    titled('TREND'),
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

test('andamento: Given main and two agent types, When it is drawn, Then only the spend bar and the context bar (top three tools and other) show, with their legends', async ($, on) => {
  // Given / When
  const { rows } = await draw($, on, AGENTS_SNAP(), andamentoBlocks)
  // Then
  expect(rows).toEqual([
    titled('TREND'),
    `spend    ${bar(BAR)}`,
    '▰ main 60%  ▰ implementer 30%  ▰ reviewer 10%',
    `context  ${bar(BAR)}`,
    '▰ Read 60%  ▰ Bash 20%  ▰ Edit 10%  ▰ other 10%',
  ])
})

test('andamento: the legend glyph takes the colour of its part and the label the text colour', async ($, on) => {
  const { ui } = await draw($, on, AGENTS_SNAP(), andamentoBlocks)
  const root = await ui.drawn()
  expect(colorOf(root, /^▰ $/)).toBe(COLORS.blue)
  expect(colorOf(root, /^main 60%$/)).toBeUndefined()
})

const LONG_SPEND = () => snap({ cost: { usd: 10 }, agentSpend: { 'code-reviewer': 2.5, implementer: 2.5, Plan: 1 }, insights: insights({ rounds: 3, usd: 6 }) })

test('andamento: Given a spend legend wider than the pane, When it is drawn, Then each label is its last hyphen segment cut to 4 letters and a dot', async ($, on) => {
  // Given / When
  const { rows } = await draw($, on, LONG_SPEND(), andamentoBlocks)
  // Then
  expect(rows[2]).toBe('▰ main 40%  ▰ revi. 25%  ▰ impl. 25%  ▰ Plan 10%')
})

test('andamento: Given a spend legend that fits the pane, When it is drawn, Then the labels stay whole', async ($, on) => {
  // Given / When
  const { rows } = await draw($, on, { ...LONG_SPEND(), agentSpend: { 'code-reviewer': 2.5, Plan: 1 } }, andamentoBlocks)
  // Then
  expect(rows[2]).toBe('▰ main 65%  ▰ code-reviewer 25%  ▰ Plan 10%')
})

test('shortLabel: Given agent types, When abbreviated, Then the last segment keeps 4 letters and a dot when longer', () => {
  expect(['implementer', 'code-reviewer', 'Explore', 'Plan', 'main'].map(shortLabel)).toEqual(['impl.', 'revi.', 'Expl.', 'Plan', 'main'])
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
  // the agent that finished is the open round's
  expect(rows[3]).toBe(node('▾', undefined, 'current round'))
  expect(rows.at(-1)).toMatch(/^󱎖 implementer/)
  expect(rows).toHaveLength(7)
  await ui.press({ key: 'agent:a1' })
  expect(calls).toEqual(['toggleAgent:a1'])
  const open = await draw($, on, { ...s, agentsOpen: ['a1'] }, inProgressBlocks)
  expect(open.rows).toContain('  tokens 0')
})

test('in progress: a perimeter with nothing outside reads as kept; the open workflow run is a node, and the round that launched it points to it', async ($, on) => {
  const s = snap({
    tasks: [{ id: '1', subject: 'Write', status: 'pending' }],
    perimeter: ['a/'],
    perimeterCheck: { files: 1, outside: [] },
    workflowRun: { runId: 'wf_1', name: 'review', phase: 'x', round: 1, agents: [{ id: 'a9', isDone: false }] },
  })
  const { rows } = await draw($, on, s, inProgressBlocks)
  expect(rows.slice(0, 5)).toEqual([titled('IN PROGRESS'), '󰄰 tasks 0/1', '󰄬 deliver perimeter · 1 entry', node('▾', undefined, 'current round'), child(NOW, '→', 'flow review', undefined, true)])
  expect(rows[5]).toMatch(/^- \d\d:\d\d flow revie +· x\b/)
  expect(rows[5]).not.toMatch(/ x\d/)
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
const figs = (share: string, usd: number | undefined, ms?: number) => [ms === undefined ? ' '.repeat(6) : duration(ms), usd === undefined ? ' '.repeat(7) : costCell(usd, 7), share.padStart(4)].join(' ')
/** A row that only has a duration: the other two slots stay blank. */
const dur = (ms: number) => figs('', undefined, ms)
/** A row: `left` at the start, `right` (the three figure slots) at the end; trimmed like the drawn rows. */
const ends = (left: string, right = '') => (right === '' ? left : left + ' '.repeat(Math.max(1, WIDTH - [...left].length - [...right].length)) + right).trimEnd()
/** A node row: arrow, start time (none for the open round), label padded to 10 cells, the figures at the row's end. */
const node = (arrow: string, at: number | undefined, label: string, right = '') => ends(`${arrow} ${at === undefined ? '' : `${clockTime(at)} `}${label.padEnd(10)}`, right)
/** A row of a flow's round: its branch and label, the figures at the end. */
const sub = (prefix: string, left: string, right = '') => ends(`${prefix}${left}`, right)
/** A row nested under a flow's round. */
const nested = (prefix: string, at: number, icon: string, text: string, right: string) => {
  const left = `${prefix}${clockTime(at)} ${icon} ${text}`
  return (left + ' '.repeat(WIDTH - [...left].length - [...right].length) + right).trimEnd()
}
/** The LOG title's icons: open all, close all, and the filter (the first shows all while filtered). */
const OPEN_ALL = '\u{F0AB5}'
const CLOSE_ALL = '\u{F0AA7}'
const SHOW_ALL = '\u{F14F0}'
const SHOW_MAIN = '\u{F0233}'
/** LOG's title: the label, a rule, the open/close icon when there is one, the filter icon, the totals of every closed node. */
const logTitle = (toggle?: string, filter = SHOW_MAIN) => {
  const icons = [...(toggle === undefined ? [] : [toggle]), filter].join(' ')
  return `LOG ${'─'.repeat(WIDTH - 3 - 2 - [...icons].length - 1)} ${icons}`
}
/** A child row of a group: the tree branch, then time, icon, text, the figures right-aligned (an icon of the private use area is one cell, two UTF-16 units). */
const child = (at: number, icon: string, text: string, right?: string, isLast = false) => {
  const left = `${isLast ? '└' : '├'} ${clockTime(at)} ${icon} ${text}`
  return right === undefined ? left : (left + ' '.repeat(WIDTH - [...left].length - [...right].length) + right).trimEnd()
}
/** The day header row. */
const day = (at: number) => localDate(at)

test('done: hidden without a log or a finished agent', async ($, on) => {
  expect((await draw($, on, snap(), doneBlocks)).rows).toEqual([])
})

/** The summary row an open group starts with. */
const summary = (text: string) => `├ ${text}`

test('done: given events after the newest round, when drawn, then LOG holds the closed round and IN PROGRESS the open one with its whole subtree, the agent with its model, cost and length', async ($, on) => {
  // Given
  const s = snap({ sessionLog: [...LOG] })
  // When
  const closed = await draw($, on, s, doneBlocks)
  const open = await draw($, on, s, inProgressBlocks)
  // Then: a round with nothing in it is a plain row with a dash, not an arrow that opens nothing
  expect(closed.rows).toEqual([logTitle(), node('-', NOW - 194_000, 'round 001', figs('', 0.38, 134_000))])
  expect(open.rows).toEqual([
    titled('IN PROGRESS'),
    node('▾', undefined, 'current round'),
    summary('1 agent · 1 commit · 1 test · 1 PR · 1 compaction'),
    child(NOW - 200_000, '󰄬', `reviewer son5.5 ${effortGlyph('high')?.icon}`, figs('', 0.5, 190_000)),
    child(NOW - 20_000, '\u{F04C2}', 'PR #12 Fix x'),
    child(NOW - 30_000, '◇', 'compacted 180k → 40k'),
    child(NOW - 40_000, '\u{F0912}', 'tests failed: npm test'),
    child(NOW - 50_000, '\u{F0718}', 'commit abc1234', undefined, true),
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
  // Then: one day, so no day row
  expect(rows).toEqual([
    logTitle(OPEN_ALL),
    node('▾', START_2, 'round 002', figs('', 1.12, 180_000)),
    summary('1 test'),
    child(NOW - 110_000, '\u{F0668}', 'tests passed: npm test', undefined, true),
    node('▸', START_1, 'round 001', figs('', 0.44, 60_000)),
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
  expect(older.rows.slice(4)).toEqual([
    node('▾', START_1, 'round 001', figs('', 0.44, 60_000)),
    summary('1 agent · 1 commit'),
    child(NOW - 300_000, '󰄬', 'reviewer', figs('', 0.21, 90_000)),
    child(NOW - 220_000, '\u{F0718}', 'commit abc1234', undefined, true),
  ])
  expect(closed.rows[1]).toBe(node('▸', START_2, 'round 002', figs('', 1.12, 180_000)))
  expect(closed.rows).toHaveLength(3)
})

test('done: given the newest group closed by a person, when a newer round arrives, then the old group stays closed and the new one is open', async ($, on) => {
  // Given
  const groupsOpen = { [`done:${NOW - 100_000}`]: false }
  const newer = [...ROUNDS, { at: NOW - 40_000, kind: 'commit', key: 'def5678', text: 'def5678' } as const, { at: NOW - 30_000, kind: 'round', ms: 10_000 } as const]
  // When
  const { rows } = await draw($, on, snap({ sessionLog: newer, groupsOpen }), doneBlocks)
  // Then
  expect(rows).toEqual([
    logTitle(OPEN_ALL),
    node('▾', NOW - 40_000, 'round 003', dur(10_000)),
    summary('1 commit'),
    child(NOW - 40_000, '\u{F0718}', 'commit def5678', undefined, true),
    node('▸', START_2, 'round 002', figs('', 1.12, 180_000)),
    node('▸', START_1, 'round 001', figs('', 0.44, 60_000)),
  ])
})

test('done: given the session total, when drawn, then each header and each agent shows its cost share in percent, after the cost; none without a total or a cost', async ($, on) => {
  // Given
  const s = snap({ sessionLog: [...ROUNDS, ROUND_AGENT], groupsOpen: { [`done:${NOW - 200_000}`]: false } })
  // When
  const withTotal = await draw($, on, { ...s, cost: { usd: 4 } }, doneBlocks)
  const noCost = await draw($, on, { ...s, cost: { usd: 4 }, sessionLog: [{ at: NOW - 50_000, kind: 'round' }, { at: NOW - 60_000, kind: 'commit', key: 'abc1234', text: 'abc1234' }] }, doneBlocks)
  const agent = await draw($, on, { ...s, cost: { usd: 4 }, groupsOpen: { [`done:${NOW - 200_000}`]: true } }, doneBlocks)
  // Then
  expect(withTotal.rows[1]).toBe(node('▾', START_2, 'round 002', figs('28%', 1.12, 180_000)))
  expect(withTotal.rows.at(-1)).toBe(node('▸', START_1, 'round 001', figs('11%', 0.44, 60_000)))
  expect(agent.rows).toContain(child(NOW - 300_000, '󰄬', 'reviewer', figs('5%', 0.21, 90_000)))
  expect(noCost.rows[1]).not.toContain('%')
})

test('done: given rounds with no events, when drawn, then they are one row with a dash, not a toggle arrow; a round without a cost prints none', async ($, on) => {
  // Given
  const log = [{ at: NOW - 300_000, kind: 'round', usd: 0.1 }, { at: NOW - 250_000, kind: 'round', usd: 0.1 }, { at: NOW - 200_000, kind: 'round', usd: 0.11 }, { at: NOW - 100_000, kind: 'commit', key: 'abc1234', text: 'abc1234' }, { at: NOW - 90_000, kind: 'round', ms: 5_000 }] as const
  // When
  const { rows, ui } = await draw($, on, snap({ sessionLog: [...log] }), doneBlocks)
  // Then
  // the label and figures of the run give way to the counters in a narrow pane
  expect(rows.slice(0, 4)).toEqual([logTitle(CLOSE_ALL), node('▾', NOW - 95_000, 'round 004', dur(5_000)), summary('1 commit'), child(NOW - 100_000, '\u{F0718}', 'commit abc1234', undefined, true)])
  expect(rows[4]).toMatch(/^- \d\d:\d\d 3 chat-only rounds/)
  expect(rows[4]).not.toMatch(/ x\d/)
  expect(await keysOf(ui, /^done:\d/)).toEqual([`done:${NOW - 90_000}`])
})

test('done: given an agent just finished and still listed in the agents, when drawn, then it shows at once and once, from its start, without a cost it has none', async ($, on) => {
  // Given
  const fresh = agent('a9', 'implementer', { status: 'done', endedAt: NOW - 5_000 })
  const logged = { at: NOW - 5_000, kind: 'agent', key: 'a9', text: 'implementer', model: 'claude-sonnet-5-5', ms: 57_000, isFailed: false } as const
  // When
  const alone = await draw($, on, snap({ agents: [fresh] }), inProgressBlocks)
  const twice = await draw($, on, snap({ agents: [fresh], sessionLog: [logged] }), inProgressBlocks)
  // Then
  expect(alone.rows).toEqual([titled('IN PROGRESS'), node('▾', undefined, 'current round'), summary('1 agent'), child(NOW - 62_000, '󰄬', 'implementer son5.5', dur(57_000), true)])
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
  const { rows } = await draw($, on, snap({ sessionLog: [...log] }), inProgressBlocks)
  // Then: the agent with no model is not counted
  expect(rows[1]).toBe(node('▾', undefined, 'current round'))
  expect(rows.slice(3)).toEqual([
    child(NOW - 10_000, '󰄬', `effortless ${effortGlyph('low')?.icon}`),
    child(NOW - 25_000, '󰄬', `tuned opu5.5 ${effortGlyph('max')?.icon}`, dur(5_000)),
    child(NOW - 30_000, '󰅖', 'bare', undefined, true),
  ])
})

test('done: given tool counts on a round, when drawn, then the summary ends with the total and the top three by count', async ($, on) => {
  // Given
  const log = [{ at: NOW - 50_000, kind: 'commit', key: 'abc1234', text: 'abc1234' }, { at: NOW - 40_000, kind: 'round', tools: { Grep: 1, Read: 20, Edit: 5, Bash: 9 } }] as const
  // When
  const { rows } = await draw($, on, snap({ sessionLog: [...log] }), doneBlocks)
  // Then
  expect(rows[2]).toBe(summary('1 commit · 35 tools: Read 20 · Bash 9 · Edit 5'))
})

test('done: given a signal entry, when drawn, then it is a child row with its time, its severity icon and the text ATTENTION gives it', async ($, on) => {
  // Given
  const sig = { kind: 'failedCommand', key: 'npm test', label: 'npm test', n: 3 } as const
  const log = [{ at: NOW - 30_000, kind: 'signal', key: 'failedCommand:npm test', text: 'npm test', n: 3, severity: 'warn' }, { at: NOW - 25_000, kind: 'signal', key: 'gone:x' }] as const
  // When
  const { rows, ui } = await draw($, on, snap({ sessionLog: [...log] }), inProgressBlocks)
  // Then: a signal of a kind unknown is left out
  expect(rows.slice(1)).toEqual([node('▾', undefined, 'current round'), summary('1 signal'), child(NOW - 30_000, signalIcon(sig), signalText(sig).what, undefined, true)])
  expect(colorOf(await ui.drawn(), /^\u{F018D}/u)).toBe(COLORS.orange)
})

test('done: given groups on two dates, when drawn, then a day row opens the nodes of each date, the newest open and the older closed, each toggling under its own key', async ($, on) => {
  // Given
  const calls: string[] = []
  const log = [
    { at: NOW - 90_000_000, kind: 'commit', key: 'a', text: 'a' },
    { at: NOW - 89_990_000, kind: 'round', ms: 1_000 },
    { at: NOW - 50_000, kind: 'commit', key: 'b', text: 'b' },
    { at: NOW - 40_000, kind: 'round', ms: 1_000 },
  ] as const
  const [newer, older] = [localDate(NOW - 41_000), localDate(NOW - 89_991_000)]
  const dayLine = (arrow: string, date: string) => `${arrow} ${date}`
  // When
  const { rows, ui } = await draw($, on, snap({ sessionLog: [...log] }), doneBlocks, calls)
  const open = await draw($, on, snap({ sessionLog: [...log], groupsOpen: { [`day:log:${older}`]: true } }), doneBlocks)
  // Then
  expect(rows).toEqual([logTitle(OPEN_ALL), dayLine('▾', newer), node('▾', NOW - 41_000, 'round 002', dur(1_000)), summary('1 commit'), child(NOW - 50_000, '\u{F0718}', 'commit b', undefined, true), dayLine('▸', older)])
  expect(open.rows.slice(5)).toEqual([dayLine('▾', older), node('▸', NOW - 89_991_000, 'round 001', dur(1_000))])
  await ui.press({ key: `day:log:${newer}` })
  expect(calls).toEqual([`setGroupOpen:day:log:${newer},false`])
})

const NEWEST = `done:${NOW - 100_000}`
const OLDER = `done:${NOW - 200_000}`

test('done: Given two closed nodes and only the newest open, When the toggle is pressed, Then both are set open in one call and, drawn so, the toggle reads close all', async ($, on) => {
  // Given
  const calls: string[] = []
  const s = snap({ sessionLog: [...ROUNDS, ROUND_AGENT] })
  // When
  const { rows, ui } = await draw($, on, s, doneBlocks, calls)
  await ui.press({ key: 'done:all' })
  const open = await draw($, on, { ...s, groupsOpen: { [NEWEST]: true, [OLDER]: true } }, doneBlocks)
  // Then
  expect(rows[0]).toBe(logTitle(OPEN_ALL))
  expect(calls).toEqual([`setGroupsOpen:${NEWEST},${OLDER},true`])
  expect(open.rows[0]).toBe(logTitle(CLOSE_ALL))
})

test('done: Given every node open, When the toggle is pressed, Then all are set closed in one call and, drawn so, the toggle reads open all', async ($, on) => {
  // Given
  const calls: string[] = []
  const s = snap({ sessionLog: [...ROUNDS, ROUND_AGENT], groupsOpen: { [NEWEST]: true, [OLDER]: true } })
  // When
  const { rows, ui } = await draw($, on, s, doneBlocks, calls)
  await ui.press({ key: 'done:all' })
  const closed = await draw($, on, { ...s, groupsOpen: { [NEWEST]: false, [OLDER]: false } }, doneBlocks)
  // Then
  expect(rows[0]).toBe(logTitle(CLOSE_ALL))
  expect(calls).toEqual([`setGroupsOpen:${NEWEST},${OLDER},false`])
  expect(closed.rows).toEqual([logTitle(OPEN_ALL), node('▸', START_2, 'round 002', figs('', 1.12, 180_000)), node('▸', START_1, 'round 001', figs('', 0.44, 60_000))])
})

test('done: Given nodes on two days, When the toggle is pressed, Then the days are set with the nodes, and a node with no events is left out', async ($, on) => {
  // Given
  const calls: string[] = []
  const log = [
    { at: NOW - 90_000_000, kind: 'round', ms: 1_000 },
    { at: NOW - 50_000, kind: 'commit', key: 'b', text: 'b' },
    { at: NOW - 40_000, kind: 'round', ms: 1_000 },
  ] as const
  const [newer, older] = [localDate(NOW - 40_000), localDate(NOW - 90_000_000)]
  // When
  const { ui } = await draw($, on, snap({ sessionLog: [...log] }), doneBlocks, calls)
  await ui.press({ key: 'done:all' })
  // Then: the older day holds only an empty node, still a day to open
  expect(calls).toEqual([`setGroupsOpen:day:log:${newer},day:log:${older},done:${NOW - 40_000},true`])
})

test('done: Given a log of nodes with no events, When drawn, Then there is no toggle', async ($, on) => {
  // Given
  const log = [{ at: NOW - 60_000, kind: 'round', ms: 1_000 }, { at: NOW - 30_000, kind: 'round', ms: 1_000 }] as const
  // When
  const { ui } = await draw($, on, snap({ sessionLog: [...log] }), doneBlocks)
  // Then
  expect(await keysOf(ui, /^done:all$/)).toEqual([])
})


test('done: Given an ok test and a failed test in a round, When drawn filtered and with log:all, Then the filtered log keeps only the failed one and its icon offers all', async ($, on) => {
  // Given
  const log = [
    { at: NOW - 60_000, kind: 'test', text: 'npm test' },
    { at: NOW - 50_000, kind: 'test', text: 'npm run e2e', isFailed: true },
    { at: NOW - 40_000, kind: 'round', ms: 20_000, usd: 0.1 },
  ] as const
  // When
  const main = await draw($, on, snap({ sessionLog: [...log], openKeys: [] }), doneBlocks)
  const all = await draw($, on, snap({ sessionLog: [...log] }), doneBlocks)
  // Then
  expect(main.rows[0]).toBe(logTitle(CLOSE_ALL, SHOW_ALL))
  expect(main.rows.filter(r => r.includes('tests '))).toEqual([child(NOW - 50_000, '󰤒', 'tests failed: npm run e2e', undefined, true)])
  expect(all.rows[0]).toBe(logTitle(CLOSE_ALL, SHOW_MAIN))
  expect(all.rows.filter(r => r.includes('tests '))).toHaveLength(2)
})

test('done: given a run and its agents, when drawn, then the run is a node beside the rounds: its agents by round under it, only there, and the round that launched it points to it', async ($, on) => {
  // Given
  // built as production writes it: the type in `text`, the spawn label (which names the round) in `desc`
  const agentOf = (key: string, type: string, label: string, model: string, usd: number, ms: number, at: number) =>
    agentLog({ id: key, type, description: label, model, startedAt: at - ms, endedAt: at, tokens: 0, status: 'done' } as CockpitAgent, 'wf_1') as CockpitLogEntry
  const log = [
    { at: NOW - 170_000, kind: 'commit', key: 'abc1234', text: 'abc1234' },
    { ...agentOf('a1', 'implementer', 'implementer round 1', 'claude-sonnet-5-5', 0.25, 30_000, NOW - 130_000), usd: 0.25 },
    { ...agentOf('a2', 'reviewer', 'reviewer round 2', 'claude-opus-5-5', 0.35, 20_000, NOW - 120_000), usd: 0.35 },
    { at: NOW - 120_000, kind: 'flow', key: 'wf_1', text: 'review', usd: 0.6, ms: 40_000, n: 2 },
    { at: NOW - 100_000, kind: 'round', ms: 90_000, usd: 0.1 },
  ] as const
  // When
  const { rows, ui } = await draw($, on, snap({ sessionLog: [...log], groupsOpen: { 'flow:wf_1': true } }), doneBlocks)
  // Then
  expect(rows).toEqual([
    logTitle(CLOSE_ALL),
    node('▾', NOW - 190_000, 'round 001', figs('', 0.1, 90_000)),
    summary('1 commit'),
    child(NOW - 160_000, '→', 'flow review'),
    child(NOW - 170_000, '\u{F0718}', 'commit abc1234', undefined, true),
    node('▾', NOW - 160_000, 'flow revie', figs('', 0.6, 40_000)),
    sub('├ ', '▾ R2', figs('', 0.35, 20_000)),
    nested('│ └ ', NOW - 140_000, '󰄬', 'reviewer opu5.5', figs('', 0.35, 20_000)),
    sub('└ ', '▾ R1', figs('', 0.25, 30_000)),
    nested('  └ ', NOW - 160_000, '󰄬', 'implementer son5.5', figs('', 0.25, 30_000)),
  ])
  expect(await keysOf(ui, /^flow:/)).toEqual(['flow:wf_1', 'flow:wf_1:R2', 'flow:wf_1:R1'])
})

test('in progress: given a logged run reopened by a new spawn, when drawn, then it is a node of IN CORSO and LOG no longer holds it', async ($, on) => {
  // Given
  const run = { runId: 'wf_1', name: 'review', phase: 'x', agents: [{ id: 'a1', isDone: true }, { id: 'a2', isDone: false }], lastAt: NOW - 5_000 }
  const s = snap({ workflowRun: run, sessionLog: [{ at: NOW - 60_000, kind: 'agent', key: 'a1', runId: 'wf_1', text: 'implementer', model: 'claude-sonnet-5-5', ms: 10_000 }, { at: NOW - 50_000, kind: 'flow', key: 'wf_1', text: 'review', ms: 20_000 }] })
  // When
  const open = await draw($, on, s, inProgressBlocks)
  const closed = await draw($, on, s, doneBlocks)
  // Then
  expect(open.rows.some(r => /^[▾▸] \d\d:\d\d flow revie /.test(r))).toBe(true)
  expect(closed.rows.some(r => /flow revie/.test(r))).toBe(false)
})

test('in progress: given a run closed by silence, when drawn, then it stays here marked with the silence wording, and LOG holds nothing of it', async ($, on) => {
  // Given
  const run = { runId: 'wf_1', name: 'review', phase: 'x', agents: [{ id: 'a1', isDone: true }], lastAt: NOW - 20_000, endedAt: NOW - 10_000, isSilent: true }
  const s = snap({ workflowRun: run, sessionLog: [{ at: NOW - 30_000, kind: 'agent', key: 'a1', runId: 'wf_1', text: 'implementer', model: 'claude-sonnet-5-5', ms: 10_000 }] })
  // When
  const open = await draw($, on, s, inProgressBlocks)
  const closed = await draw($, on, s, doneBlocks)
  // Then
  expect(open.rows.some(r => /^[▾▸] \d\d:\d\d flow revie .*· /.test(r))).toBe(true)
  expect(colorOf(await open.ui.drawn(), /flow revie/)).toBe(COLORS.amber)
  expect(closed.rows).toEqual([])
})

test('attention: given signals on two days, when drawn, then a blocking one stays on top outside any day, the newest day is open and the older one closed', async ($, on) => {
  // Given
  const opus = { kind: 'opusReadOnly', key: 'a1', label: 'Explore' } as const
  const failed = { kind: 'failedCommand', key: 'npm test', label: 'npm test', n: 3 } as const
  const older = NOW - 90_000_000
  const s = snap({ agents: [agent('a1', 'Explore', { model: 'claude-opus-5-5' })], insights: insights({ failedCmds: { 'npm test': 3 } }), claudeState: WAITING, signalsAt: { [signalId(opus)]: NOW - 1_000, [signalId(failed)]: older } })
  // When
  const closed = await draw($, on, s, attentionBlocks)
  const open = await draw($, on, { ...s, groupsOpen: { [`day:att:${localDate(older)}`]: true } }, attentionBlocks)
  // Then
  const cut = (r: string) => [...r].slice(0, 12).join('').trimEnd()
  expect(closed.rows.map(cut)).toEqual([titled('ATTENTION'), '\u{F033E} permission', '  answer the re', `▾ ${localDate(NOW - 1_000)}`, '\u{F0114} Opus on a', '  set model so', `▸ ${localDate(older)}`].map(cut))
  expect(open.rows.some(r => r.startsWith('\u{F018D} command failed'))).toBe(true)
})

test('attention: given a blocking signal from yesterday and the others all from today, when drawn, then no day row: the days that count are the non-blocking ones', async ($, on) => {
  // Given
  const failed = { kind: 'failedCommand', key: 'npm test', label: 'npm test', n: 3 } as const
  const s = snap({ insights: insights({ failedCmds: { 'npm test': 3 } }), claudeState: WAITING, signalsAt: { [`permissionWait:${SINCE}`]: NOW - 90_000_000, [signalId(failed)]: NOW - 1_000 } })
  // When
  const { rows } = await draw($, on, s, attentionBlocks)
  // Then
  expect(rows.some(r => /^[▾▸] \d{4}-\d\d-\d\d/.test(r))).toBe(false)
  expect(rows.some(r => r.startsWith('\u{F018D} command failed'))).toBe(true)
})

// ── Both languages ──

test('page: the section titles and the empty row in Italian', async ($, on) => {
  try {
    setLang('it')
    expect((await draw($, on, snap(), attentionBlocks)).rows).toEqual([titled('ATTENZIONE'), '✓ niente da fare'])
    const trend = await draw($, on, LONG_SPEND(), andamentoBlocks)
    expect([trend.rows[0], trend.rows[2]]).toEqual([titled('ANDAMENTO'), '▰ princ. 40%  ▰ revi. 25%  ▰ impl. 25%  ▰ Plan 10%'])
    expect((await draw($, on, snap({ agents: [agent('a1', 'implementer')] }), inProgressBlocks)).rows[0]).toBe(titled('IN CORSO'))
    const done = await draw($, on, snap({ sessionLog: [...ROUNDS, ROUND_AGENT], groupsOpen: { [`done:${NOW - 200_000}`]: true } }), doneBlocks)
    expect(done.rows[0]).toBe(logTitle(CLOSE_ALL))
    expect(done.rows[1]).toBe(node('▾', START_2, 'giro 002', figs('', 1.12, 180_000)))
    expect(done.rows[2]).toBe(summary('1 test'))
    expect(done.rows[4]).toBe(node('▾', START_1, 'giro 001', figs('', 0.44, 60_000)))
    expect(done.rows[5]).toBe(summary('1 agente · 1 commit'))
    const current = (await draw($, on, snap({ sessionLog: [...LOG] }), inProgressBlocks)).rows
    expect(current.slice(1, 3)).toEqual([node('▾', undefined, 'giro in corso'), summary('1 agente · 1 commit · 1 test · 1 PR · 1 compattazione')])
    const idle = [{ at: 1, kind: 'round' }, { at: 2, kind: 'round' }] as const
    expect((await draw($, on, snap({ sessionLog: [...idle] }), doneBlocks)).rows.join('\n')).toContain('2 giri di sola conversazione')
  } finally {
    setLang('en')
  }
})
