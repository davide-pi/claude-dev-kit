import { expect, test } from 'claude-code/testing'

import { clockTime, wrapCells } from '../hooks/shared'
import {
  askPerson,
  callAs,
  gatedBash,
  headerOf,
  launchWorkflow,
  mountPane,
  paneRows,
  permissionChecks,
  roundHooks,
  settleAll,
  workflowLaunches,
} from './cockpit-fixtures'
import { NOW, flagOf, rowTexts, world } from './cockpit-world'

const failingBash = (on: Parameters<typeof world>[0]) => on('tool.call', { tool: 'Bash' }, () => ({ deny: 'exit 1: boom' }))

// ── Notifications: a row of ATTENTION, and no badge in the fixed header or the state file ──

test('Notifications: a command that failed twice is one row (what) with what to do under it, its why and what to do open on a press, and nothing is in the header or the state file', { timeoutMs: 30_000 }, async ($, on) => {
  const writes = new Map<string, string>()
  const clock = world(on, { writes })
  failingBash(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 58)

  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  await settleAll()
  await clock.advance(5000) // past the state file's write window
  await settleAll()

  expect(headerOf(rowTexts(await ui.drawn())).some(r => /󰀦/.test(r))).toBe(false)
  expect(flagOf(writes)).not.toHaveProperty('signals')

  let rows = rowTexts(await ui.drawn())
  expect(rows.some(r => /^ATTENTION ─+$/.test(r))).toBe(true)
  const at = rows.findIndex(r => /^\u{F018D} .*npm test/u.test(r))
  expect(at).toBeGreaterThan(0)
  expect(rows[at + 1]).toMatch(/^ {2}\S/) // what to do, dim under the closed row, indented, with no arrow
  expect(rows[at + 1]).not.toMatch(/→/)
  expect(rows.some(r => /^ +why: /.test(r))).toBe(false)
  await ui.press({ key: 'signal:failedCommand:npm test' })
  rows = rowTexts(await ui.drawn())
  expect(rows[at]).toMatch(/^\u{F018D} /u)
  expect(rows[at + 1]).toMatch(/^ +why: /)
  expect(rows.slice(at + 2, at + 4).some(r => /^ +what to do: /.test(r))).toBe(true) // the why may wrap onto a second row
  expect(rows[at]?.trimEnd().endsWith(` ${clockTime(NOW)}`)).toBe(true) // the time it arrived, on the right
  await ui.unmount()
})

test('Notifications: a title too long for the row is cut closed, and open it wraps under the row with why and what to do whole; the time stays on the right', { timeoutMs: 30_000 }, async ($, on) => {
  const clock = world(on)
  failingBash(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 34)
  const cmd = 'npm run test:integration --watch'
  await $.tool.call({ tool: 'Bash', command: cmd })
  await clock.advance(60_000)
  await $.tool.call({ tool: 'Bash', command: cmd })
  await settleAll()
  const time = clockTime(NOW + 60_000) // the second failure is what makes it hold

  let rows = rowTexts(await ui.drawn())
  const at = rows.findIndex(r => /^\u{F018D} command failed/u.test(r))
  expect(at).toBeGreaterThan(0)
  expect(rows[at]).toMatch(new RegExp(`… +${time}$`))

  await ui.press({ key: `signal:failedCommand:${cmd}` })
  rows = rowTexts(await ui.drawn())
  expect(rows[at]).toMatch(new RegExp(`^\u{F018D} command .* ${time}$`, 'u'))
  const end = rows.findIndex((r, i) => i > at && r.trim() === '')
  const below = rows.slice(at + 1, end < 0 ? undefined : end).map(r => r.trim())
  expect(rows.slice(at, at + below.length + 1).some(r => r.includes('…'))).toBe(false)
  const text = [rows[at]?.replace(time, '').trim(), ...below].join(' ')
  expect(text).toContain(`command failed 2 times: ${cmd}`)
  expect(text).toContain('why: the same error repeats without a change of approach')
  expect(text).toContain('what to do: read the error and fix the cause instead of rerunning')
  expect(rows[at + 1]).toMatch(/^ {2}\S/) // wrapped lines sit indented under the row
  await ui.unmount()
})

test('wrapCells: breaks at the space that fits, a word longer than the row is cut, a wide character under a narrow row still advances', () => {
  expect(wrapCells('aaa bbb ccc', 7)).toEqual(['aaa bbb', 'ccc'])
  expect(wrapCells('abcdefgh ij', 4)).toEqual(['abcd', 'efgh', 'ij'])
  expect(wrapCells('漢字', 1)).toEqual(['漢', '字'])
  expect(wrapCells('', 5)).toEqual([])
})

test('Notifications: with none, ATTENTION says there is nothing to do', { timeoutMs: 30_000 }, async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const { rows } = await paneRows($, 58)
  expect(rows.filter(r => /^✓ nothing to do/.test(r))).toHaveLength(1)
  expect(headerOf(rows).some(r => /󰀦/.test(r))).toBe(false)
})

test('Notifications: a permission ask unanswered over 60 seconds is a notification, and it clears when the person answers', { timeoutMs: 30_000 }, async ($, on) => {
  const clock = world(on)
  permissionChecks(on)
  const release = gatedBash(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const call = callAs($, 'c1', { tool: 'Bash', command: 'rm x' })
  await settleAll()
  await askPerson($, 'c1')
  await clock.advance(91_000)
  await settleAll()
  expect((await paneRows($, 58)).rows.some(r => /^\u{F033E} permission waiting/u.test(r))).toBe(true)
  release('rm x')
  await call
  await settleAll()
  expect((await paneRows($, 58)).rows.some(r => /^✓ nothing to do/.test(r))).toBe(true)
})

// ── IN PROGRESS: the workflow run in one row ──

test('IN PROGRESS: the workflow run is a node with its name, phase and agents done out of all', { timeoutMs: 30_000 }, async ($, on) => {
  const clock = world(on)
  permissionChecks(on)
  workflowLaunches(on, 'release-notes')
  const release = gatedBash(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await launchWorkflow($, 'release-notes')
  const call = callAs($, 'c1', { tool: 'Bash', command: 'rm x' })
  await settleAll()
  await askPerson($, 'c1')
  await clock.advance(7000)
  await settleAll()
  const { rows } = await paneRows($, 64)
  const run = rows.findIndex(r => /^[▾▸-] \d\d:\d\d flow release-notes/.test(r))
  expect(run).toBeGreaterThan(-1)
  expect(rows.findIndex(r => /^IN PROGRESS ─+$/.test(r))).toBeLessThan(run)
  release('rm x')
  await call
})

// ── Context: the breakdown first, then what the session costs ──

// ── Work: links, no processes ──
