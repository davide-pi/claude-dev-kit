import { expect, test } from 'claude-code/testing'

import { COLORS } from '../hooks/shared'
import { andamentoBlocks, attentionBlocks, inProgressBlocks, shortLabel } from '../hooks/view-page'
import { paneView } from '../hooks/view'
import type { CockpitSnapshot } from '../types'
import { colorOf, keysInOrder } from './cockpit-fixtures'
import { LONG_SPEND, SINCE, WAITING, WIDTH, agent, boldOf, draw, insights, keysOf, snap, titled } from './cockpit-page-draw'
import { NOW } from './cockpit-world'

// ── ATTENZIONE ──

/** The thin rule between the action rows and the notification rows. */
const RULE = '─'.repeat(WIDTH)

test('attention: nothing to do is one row, never an empty section', { timeoutMs: 30_000 }, async ($, on) => {
  const { rows } = await draw($, on, snap(), attentionBlocks)
  expect(rows).toEqual([titled('ATTENTION'), '✓ nothing to do'])
})

test('attention: blocking first, then cost, then the rest; each row has its severity icon, what, and what to do dim under it', { timeoutMs: 30_000 }, async ($, on) => {
  const s = snap({ agents: [agent('a1', 'Explore', { model: 'claude-opus-5-5' })], insights: insights({ failedCmds: { 'npm test': 3 } }), claudeState: WAITING })
  const { rows } = await draw($, on, s, attentionBlocks)
  expect(rows).toEqual([
    titled('ATTENTION'),
    '\u{F033E} permission waiting for 120s',
    '  answer the request in the terminal',
    RULE,
    '\u{F0114} Opus on a read-only agent (Explore)',
    '  set model sonnet or haiku for this agent type',
    '\u{F018D} command failed 3 times: npm test',
    '  read the error and fix the cause instead of rerunning',
  ])
})

test('attention: Given a pending permission and a notification, When drawn, Then a thin rule row sits between them', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const s = snap({ insights: insights({ failedCmds: { 'npm test': 3 } }), claudeState: WAITING })
  // When
  const { rows } = await draw($, on, s, attentionBlocks)
  // Then
  expect(rows).toEqual([titled('ATTENTION'), '\u{F033E} permission waiting for 120s', '  answer the request in the terminal', RULE, '\u{F018D} command failed 3 times: npm test', '  read the error and fix the cause instead of rerunning'])
})

test('attention: Given the hours row and a notification, When drawn, Then a thin rule row sits right under the hours row and above the notification', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const s = snap({ sessionId: 's-1', worklog: { pending: ['2026-10-20'], underTarget: [] }, insights: insights({ failedCmds: { 'npm test': 3 } }) })
  // When
  const { rows } = await draw($, on, s, attentionBlocks)
  // Then
  const rule = rows.indexOf(RULE)
  expect(rows[rule - 1]).toContain('without logged hours')
  expect(rows[rule + 1]).toContain('command failed 3 times')
  expect(rows.filter(r => r === RULE)).toHaveLength(1)
})

test('attention: Given a permission, the hours row and a notification, When drawn, Then one rule closes the action rows', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const s = snap({ sessionId: 's-1', worklog: { pending: ['2026-10-20'], underTarget: [] }, insights: insights({ failedCmds: { 'npm test': 3 } }), claudeState: WAITING })
  // When
  const { rows } = await draw($, on, s, attentionBlocks)
  // Then
  const at = (re: RegExp) => rows.findIndex(r => re.test(r))
  expect(rows.filter(r => r === RULE)).toHaveLength(1)
  expect(at(/permission/)).toBeLessThan(at(/without logged hours/))
  expect(at(/without logged hours/)).toBeLessThan(rows.indexOf(RULE))
  expect(rows.indexOf(RULE)).toBeLessThan(at(/command failed/))
})

test('attention: Given only actions or only notifications, When drawn, Then no rule row', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const onlyPermission = snap({ claudeState: WAITING })
  const onlyHours = snap({ sessionId: 's-1', worklog: { pending: ['2026-10-20'], underTarget: [] } })
  const onlyNotes = snap({ insights: insights({ failedCmds: { 'npm test': 3 } }) })
  // When
  const drawnRows: string[][] = []
  for (const s of [onlyPermission, onlyHours, onlyNotes]) drawnRows.push((await draw($, on, s, attentionBlocks)).rows)
  // Then
  for (const rows of drawnRows) expect(rows).not.toContain(RULE)
})

test('attention: Given signals that first held at different times, When drawn, Then a blocking one stays on top and the others come newest first', { timeoutMs: 30_000 }, async ($, on) => {
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
  expect(rows.filter(r => /^\S/.test(r) && r !== titled('ATTENTION')).map(r => [...r][0])).toEqual(['\u{F033E}', '─','\u{F0114}', '\u{F018D}'])
})

test('attention: the icon takes the colour of its severity (block red, warn orange, info yellow) and a blocking title is bold', { timeoutMs: 30_000 }, async ($, on) => {
  const s = snap({ agents: [agent('a1', 'Explore', { model: 'claude-opus-5-5' })], insights: insights({ failedCmds: { 'npm test': 3 } }), claudeState: WAITING })
  const { ui } = await draw($, on, s, attentionBlocks)
  const root = await ui.drawn()
  expect(colorOf(root, /^\u{F033E}/u)).toBe(COLORS.red)
  expect(colorOf(root, /^\u{F018D}/u)).toBe(COLORS.orange)
  expect(colorOf(root, /^\u{F0114}/u)).toBe(COLORS.yellow)
  expect(boldOf(root, /^permission waiting/)).toBe(true)
  expect(boldOf(root, /^command failed/)).toBe(false)
})

test('attention: a pressed row says why and what to do; the press toggles that signal', { timeoutMs: 30_000 }, async ($, on) => {
  const calls: string[] = []
  const id = `permissionWait:${SINCE}`
  const { rows, ui } = await draw($, on, snap({ claudeState: WAITING, signalOpen: id }), attentionBlocks, calls)
  expect(rows).toEqual([titled('ATTENTION'), '\u{F033E} permission waiting for 120s', '  why: the work is stopped until you answer', '  what to do: answer the request in the terminal'])
  await ui.press({ key: `signal:${id}` })
  expect(calls).toEqual([`toggleSignal:${id}`])
})

test('attention: the worklog behind is a row with its icon and log hours on the right; up to date it is no row', { timeoutMs: 30_000 }, async ($, on) => {
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

test('attention: Given the worklog behind, a blocking signal and more notifications than fit, When drawn closed, Then the worklog row is pinned right under the blocking one, above every notification, never behind the toggle', { timeoutMs: 30_000 }, async ($, on) => {
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

test('attention: at most five rows and eight drawn lines, the rest behind the toggle', { timeoutMs: 30_000 }, async ($, on) => {
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

test('attention: a workflow stall is blocking and comes first; a workflow past its rounds is not, and a cost outranks a rest that signalsOf emits before it', { timeoutMs: 30_000 }, async ($, on) => {
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

test('page: with eight notifications at 40 rows the footer buttons are still drawn, and the rows stay within the pane', { timeoutMs: 30_000 }, async ($, on) => {
  const reads = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`/src/f${i}.ts`, 4]))
  const s = snap({ insights: insights({ reads }), cost: { usd: 1 } })
  const { ui, rows } = await draw($, on, s, k => [[paneView({ ...k.ui, Client: undefined }, k.s, WIDTH, 40, k.actions)]])
  expect((await keysOf(ui, /^bar:compact$/)).length).toBe(1)
  expect(rows.length).toBeLessThanOrEqual(40)
})
// ── ANDAMENTO ──

const BAR = 51
const bar = (n: number) => '▰'.repeat(n)
test('andamento: hidden before the first round', { timeoutMs: 30_000 }, async ($, on) => {
  expect((await draw($, on, snap(), andamentoBlocks)).rows).toEqual([])
  expect((await draw($, on, snap({ insights: insights() }), andamentoBlocks)).rows).toEqual([])
})

test('andamento: Given the main loop only, When it is drawn, Then the spend bar is all main, the context bar by tool, and no figures row', { timeoutMs: 30_000 }, async ($, on) => {
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
    ctx: { tokens: 120_000 },
    autoCompactAt: 150_000,
    sessionLog: [{ at: NOW - 90_000, kind: 'round', usd: 0.2, ms: 134_000 }, { at: NOW - 30_000, kind: 'round', usd: 0.44, ms: 61_000 }],
    insights: insights({ rounds: 3, usd: 6, byTool: { Read: 60_000, Bash: 20_000, Edit: 10_000, Grep: 6_000, Glob: 4_000 } }),
  })

test('andamento: Given main and two agent types, When it is drawn, Then only the spend bar and the context bar (top three tools and other) show, with their legends', { timeoutMs: 30_000 }, async ($, on) => {
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

test('andamento: the legend glyph takes the colour of its part and the label the text colour', { timeoutMs: 30_000 }, async ($, on) => {
  const { ui } = await draw($, on, AGENTS_SNAP(), andamentoBlocks)
  const root = await ui.drawn()
  expect(colorOf(root, /^▰ $/)).toBe(COLORS.blue)
  expect(colorOf(root, /^main 60%$/)).toBeUndefined()
})


test('andamento: Given a spend legend wider than the pane, When it is drawn, Then each label is its last hyphen segment cut to 4 letters and a dot', { timeoutMs: 30_000 }, async ($, on) => {
  // Given / When
  const { rows } = await draw($, on, LONG_SPEND(), andamentoBlocks)
  // Then
  expect(rows[2]).toBe('▰ main 40%  ▰ revi. 25%  ▰ impl. 25%  ▰ Plan 10%')
})

test('andamento: Given a spend legend that fits the pane, When it is drawn, Then the labels stay whole', { timeoutMs: 30_000 }, async ($, on) => {
  // Given / When
  const { rows } = await draw($, on, { ...LONG_SPEND(), agentSpend: { 'code-reviewer': 2.5, Plan: 1 } }, andamentoBlocks)
  // Then
  expect(rows[2]).toBe('▰ main 65%  ▰ code-reviewer 25%  ▰ Plan 10%')
})

test('shortLabel: Given agent types, When abbreviated, Then the last segment keeps 4 letters and a dot when longer', () => {
  expect(['implementer', 'code-reviewer', 'Explore', 'Plan', 'main'].map(shortLabel)).toEqual(['impl.', 'revi.', 'Expl.', 'Plan', 'main'])
})

// ── IN CORSO ──

test('in progress: hidden when nothing runs and no task is open', { timeoutMs: 30_000 }, async ($, on) => {
  expect((await draw($, on, snap(), inProgressBlocks)).rows).toEqual([])
  const done = snap({ tasks: [{ id: '1', subject: 'Done thing', status: 'completed' }], perimeter: ['src/'] })
  expect((await draw($, on, done, inProgressBlocks)).rows).toEqual([])
})

test('in progress: at most five rows, the rest behind the toggle', { timeoutMs: 30_000 }, async ($, on) => {
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

