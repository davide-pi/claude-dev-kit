import { expect, test } from 'claude-code/testing'

import { COLORS } from '../hooks/shared'
import { attentionBlocks, spendBlocks } from '../hooks/view-page'
import { paneView } from '../hooks/view'
import { makeKit } from '../hooks/view-kit'
import type { CockpitSnapshot } from '../types'
import { colorOf, keysInOrder, mountPane, settleAll, spawnAgent, spawnWorkflowAgent, spawns } from './cockpit-fixtures'
import { LONG_SPEND, SINCE, WAITING, WIDTH, agent, boldOf, draw, insights, keysOf, snap, titled } from './cockpit-page-draw'
import { NOW, rowTexts, world } from './cockpit-world'

// ── IN PROGRESS: a flow's running agent shows once, under its flow ──

test('in progress: Given a live run with a running implementer carrying its run id, When drawn, Then the run shows in the flow section and the implementer is not listed outside it', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const clock = world(on)
  spawns(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await spawnWorkflowAgent($, 'wf_1', 1)
  await clock.advance(3000)
  await settleAll()
  // When
  const ui = await mountPane($, 100)
  const rows = rowTexts(await ui.drawn())
  const flat = await ui.find({ key: 'agent:a1' })
  await ui.unmount()
  // Then
  expect(rows.some(r => /^◆ wf_1/.test(r))).toBe(true)
  expect(rows.filter(r => /implementer/.test(r))).toHaveLength(0)
  expect(flat).toBeUndefined()
})

test('in progress: Given a running agent with no workflow run, When drawn, Then it is still in the flat agent list', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  world(on)
  spawns(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await spawnAgent($, 'reviewer')
  // When
  const ui = await mountPane($, 100)
  const flat = await ui.find({ key: 'agent:a1' })
  await ui.unmount()
  // Then
  expect(flat).toBeDefined()
})

test('in progress: Given a running agent whose run id names a run that is not the live one, When drawn, Then it is still listed and the live run\'s agent is not', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const clock = world(on)
  spawns(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await spawnWorkflowAgent($, 'w1', 1)
  await spawnWorkflowAgent($, 'w2', 1)
  await clock.advance(3000)
  await settleAll()
  // When
  const ui = await mountPane($, 100)
  const replaced = await ui.find({ key: 'agent:a1' })
  const live = await ui.find({ key: 'agent:a2' })
  await ui.unmount()
  // Then
  expect(replaced).toBeDefined()
  expect(live).toBeUndefined()
})

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


const AGENTS_SNAP = () =>
  snap({
    cost: { usd: 10, lastUsd: 0.44 },
    agentSpend: { implementer: 3, reviewer: 1 },
    ctx: { tokens: 120_000 },
    autoCompactAt: 150_000,
    sessionLog: [{ at: NOW - 90_000, kind: 'round', usd: 0.2, ms: 134_000 }, { at: NOW - 30_000, kind: 'round', usd: 0.44, ms: 61_000 }],
    insights: insights({ rounds: 3, usd: 6, byTool: { Read: 60_000, Bash: 20_000, Edit: 10_000, Grep: 6_000, Glob: 4_000 } }),
  })







// ── IN CORSO ──

// ── SPESA ──

test('spend: Given the main loop and agent types, When drawn, Then the title carries the session cost and each row is its share, a block bar, who and its cost on the right', { timeoutMs: 30_000 }, async ($, on) => {
  // Given / When
  const { rows } = await draw($, on, LONG_SPEND(), spendBlocks)
  // Then
  expect(rows[0]).toMatch(/^SPEND ─+ \$10\.00$/)
  expect(rows.slice(1)).toEqual([
    expect.stringMatching(/^ 40% ████░░░░░░ main +\$4\.00$/),
    expect.stringMatching(/^ 25% ███░░░░░░░ code-reviewer +\$2\.50$/),
    expect.stringMatching(/^ 25% ███░░░░░░░ implementer +\$2\.50$/),
    expect.stringMatching(/^ 10% █░░░░░░░░░ Plan +\$1\.00$/),
  ])
})

test('spend: Given nothing spent, When drawn, Then one dim line says so under the title', { timeoutMs: 30_000 }, async ($, on) => {
  // Given / When
  const { rows } = await draw($, on, snap(), spendBlocks)
  // Then
  expect(rows[1]).toBe('nothing yet')
})

test('spend: Given a narrow pane, When drawn, Then the name is cut and the cost stays whole at the right', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const s = LONG_SPEND()
  // When
  const { rows } = await draw($, on, s, k => spendBlocks(makeKit(k.ui, k.s, 30, k.actions)))
  // Then
  for (const row of rows.slice(1)) {
    expect([...row].length).toBeLessThanOrEqual(30)
    expect(row).toMatch(/\$\d+\.\d\d$/)
  }
})
