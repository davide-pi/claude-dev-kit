import { expect, test } from 'claude-code/testing'

import { agentLog } from '../hooks/agents'
import { clockTime, costCell, duration, effortGlyph, localDate } from '../hooks/shared'
import { setLang } from '../hooks/strings'
import { doneBlocks } from '../hooks/view-log'
import type { CockpitAgent, CockpitLogEntry } from '../types'
import { WIDTH, draw, keysOf, snap } from './cockpit-page-draw'
import { NOW } from './cockpit-world'

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

test('done: hidden without a log or a finished agent', { timeoutMs: 30_000 }, async ($, on) => {
  expect((await draw($, on, snap(), doneBlocks)).rows).toEqual([])
})

/** The summary row an open group starts with. */
const summary = (text: string) => `├ ${text}`


test('Given a log entry kept with a raw task-notification prompt, When the log draws it, Then it shows a label and no raw tag', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const s = snap({ sessionLog: [{ at: NOW - 60_000, kind: 'round', prompt: '<task-notification>', usd: 0.38, ms: 134_000 }] })
  // When
  const closed = await draw($, on, s, doneBlocks)
  // Then
  expect(closed.rows.join('\n')).not.toContain('task-notification')
  expect(closed.rows.join('\n')).toMatch(/agent/)
})

test('done: given seven groups, when drawn, then the newest five show and the toggle opens the other two', { timeoutMs: 30_000 }, async ($, on) => {
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

test('done: given rounds, when drawn, then only the newest is open and each header toggles under its own key, to the opposite state', { timeoutMs: 30_000 }, async ($, on) => {
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

test('done: given a state a person gave, when drawn, then an older group stays open under the newest, and the newest can be closed', { timeoutMs: 30_000 }, async ($, on) => {
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

test('done: given the newest group closed by a person, when a newer round arrives, then the old group stays closed and the new one is open', { timeoutMs: 30_000 }, async ($, on) => {
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

test('done: given the session total, when drawn, then each header and each agent shows its cost share in percent, after the cost; none without a total or a cost', { timeoutMs: 30_000 }, async ($, on) => {
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

test('done: given rounds with no events, when drawn, then they are one row with a dash, not a toggle arrow; a round without a cost prints none', { timeoutMs: 30_000 }, async ($, on) => {
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


test('done: given agents that finished only in the history, when drawn, then the capped history adds no row', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const history = [{ id: 'h1', type: 'reviewer', startedAt: NOW - 200_000, endedAt: NOW - 10_000, tokens: 0, isFailed: false, usd: 0.5 }]
  // When
  const { rows } = await draw($, on, snap({ history }), doneBlocks)
  // Then
  expect(rows).toEqual([])
})


test('done: given tool counts on a round, when drawn, then the summary ends with the total and the top three by count', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const log = [{ at: NOW - 50_000, kind: 'commit', key: 'abc1234', text: 'abc1234' }, { at: NOW - 40_000, kind: 'round', tools: { Grep: 1, Read: 20, Edit: 5, Bash: 9 } }] as const
  // When
  const { rows } = await draw($, on, snap({ sessionLog: [...log] }), doneBlocks)
  // Then
  expect(rows[2]).toBe(summary('1 commit · 35 tools: Read 20 · Bash 9 · Edit 5'))
})


test('done: given groups on two dates, when drawn, then a day row opens the nodes of each date, the newest open and the older closed, each toggling under its own key', { timeoutMs: 30_000 }, async ($, on) => {
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

test('done: Given two closed nodes and only the newest open, When the toggle is pressed, Then both are set open in one call and, drawn so, the toggle reads close all', { timeoutMs: 30_000 }, async ($, on) => {
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

test('done: Given every node open, When the toggle is pressed, Then all are set closed in one call and, drawn so, the toggle reads open all', { timeoutMs: 30_000 }, async ($, on) => {
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

test('done: Given nodes on two days, When the toggle is pressed, Then the days are set with the nodes, and a node with no events is left out', { timeoutMs: 30_000 }, async ($, on) => {
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

test('done: Given a log of nodes with no events, When drawn, Then there is no toggle', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const log = [{ at: NOW - 60_000, kind: 'round', ms: 1_000 }, { at: NOW - 30_000, kind: 'round', ms: 1_000 }] as const
  // When
  const { ui } = await draw($, on, snap({ sessionLog: [...log] }), doneBlocks)
  // Then
  expect(await keysOf(ui, /^done:all$/)).toEqual([])
})


test('done: Given an ok test and a failed test in a round, When drawn filtered and with log:all, Then the filtered log keeps only the failed one and its icon offers all', { timeoutMs: 30_000 }, async ($, on) => {
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

test('done: given a run and its agents, when drawn, then the run is a node beside the rounds: its agents by round under it, only there, and the round that launched it points to it', { timeoutMs: 30_000 }, async ($, on) => {
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
    node('▾', NOW - 160_000, 'flow review', figs('', 0.6, 40_000)),
    sub('├ ', '▾ R2', figs('', 0.35, 20_000)),
    nested('│ └ ', NOW - 140_000, '󰄬', 'reviewer opu5.5', figs('', 0.35, 20_000)),
    sub('└ ', '▾ R1', figs('', 0.25, 30_000)),
    nested('  └ ', NOW - 160_000, '󰄬', 'implementer son5.5', figs('', 0.25, 30_000)),
  ])
  expect(await keysOf(ui, /^flow:/)).toEqual(['flow:wf_1', 'flow:wf_1:R2', 'flow:wf_1:R1'])
})



// ── Both languages ──

test('page: the section titles and the empty row in Italian', { timeoutMs: 30_000 }, async ($, on) => {
  try {
    setLang('it')
    const done = await draw($, on, snap({ sessionLog: [...ROUNDS, ROUND_AGENT], groupsOpen: { [`done:${NOW - 200_000}`]: true } }), doneBlocks)
    expect(done.rows[0]).toBe(logTitle(CLOSE_ALL))
    expect(done.rows[1]).toBe(node('▾', START_2, 'giro 002', figs('', 1.12, 180_000)))
    expect(done.rows[2]).toBe(summary('1 test'))
    expect(done.rows[4]).toBe(node('▾', START_1, 'giro 001', figs('', 0.44, 60_000)))
    expect(done.rows[5]).toBe(summary('1 agente · 1 commit'))
    const idle = [{ at: 1, kind: 'round' }, { at: 2, kind: 'round' }] as const
    expect((await draw($, on, snap({ sessionLog: [...idle] }), doneBlocks)).rows.join('\n')).toContain('2 giri di sola conversazione')
  } finally {
    setLang('en')
  }
})
