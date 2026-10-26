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

// ── Notifications: the tab, its new-count, and no badge in the fixed header or the state file ──

test('Notifications: a command that failed twice is one row (what), its why and what to do open on a press, the new count sits on the tab label and nothing is in the header or the state file', async ($, on) => {
  const writes = new Map<string, string>()
  const clock = world(on, { writes })
  failingBash(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 58)
  expect((await ui.find({ key: 'tab:signals' }))?.text).toBe('Notifications')

  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  await settleAll()
  await clock.advance(5000) // past the state file's write window
  await settleAll()

  expect((await ui.find({ key: 'tab:signals' }))?.text).toBe('Notif 1')
  expect(headerOf(rowTexts(await ui.drawn())).some(r => /⚠/.test(r))).toBe(false)
  expect(flagOf(writes)).not.toHaveProperty('signals')

  await ui.press({ key: 'tab:signals' })
  expect((await ui.find({ key: 'tab:signals' }))?.text).toBe('Notifications') // opening the tab clears the count
  let rows = rowTexts(await ui.drawn())
  expect(rows.some(r => /^NOTIFICATIONS · 1/.test(r))).toBe(true)
  const at = rows.findIndex(r => /^▸ .*npm test/.test(r))
  expect(at).toBeGreaterThan(0)
  expect(rows.some(r => /^ +why: /.test(r))).toBe(false)
  await ui.press({ key: 'signal:failedCommand:npm test' })
  rows = rowTexts(await ui.drawn())
  expect(rows[at]).toMatch(/^▾ /)
  expect(rows[at + 1]).toMatch(/^ +why: /)
  expect(rows.slice(at + 2, at + 4).some(r => /^ +what to do: /.test(r))).toBe(true) // the why may wrap onto a second row
  expect(rows[at]?.trimEnd().endsWith(` ${clockTime(NOW)}`)).toBe(true) // the time it arrived, on the right

  await ui.press({ key: 'tab:notes' })
  expect((await ui.find({ key: 'tab:signals' }))?.text).toBe('Notifications') // seen: leaving the tab does not count it again
  await ui.unmount()
})

test('Notifications: a title too long for the row is cut closed, and open it wraps under the row with why and what to do whole; the time stays on the right', async ($, on) => {
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

  await ui.press({ key: 'tab:signals' })
  let rows = rowTexts(await ui.drawn())
  const at = rows.findIndex(r => /^▸ command failed/.test(r))
  expect(at).toBeGreaterThan(0)
  expect(rows[at]).toMatch(new RegExp(`… +${time}$`))

  await ui.press({ key: `signal:failedCommand:${cmd}` })
  rows = rowTexts(await ui.drawn())
  expect(rows[at]).toMatch(new RegExp(`^▾ command .* ${time}$`))
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

test('Notifications: with none, one line says so', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const { rows } = await paneRows($, 58, 'signals')
  expect(rows.filter(r => /^no notifications/.test(r))).toHaveLength(1)
  expect(rows.some(r => /^NOTIFICATIONS/.test(r))).toBe(false)
  expect(headerOf(rows).some(r => /⚠/.test(r))).toBe(false)
})

test('Notifications: a permission ask unanswered over 60 seconds is a notification, and it clears when the person answers', async ($, on) => {
  const clock = world(on)
  permissionChecks(on)
  const release = gatedBash(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const call = callAs($, 'c1', { tool: 'Bash', command: 'rm x' })
  await settleAll()
  await askPerson($, 'c1')
  await clock.advance(91_000)
  await settleAll()
  expect((await paneRows($, 58, 'signals')).rows.some(r => /^NOTIFICATIONS · 1/.test(r))).toBe(true)
  release('rm x')
  await call
  await settleAll()
  expect((await paneRows($, 58, 'signals')).rows.some(r => /^no notifications/.test(r))).toBe(true)
})

// ── Agents: the workflow run in one row ──

test('Agents: the workflow run is one row on top with its name, phase and agents done out of all', async ($, on) => {
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
  const { rows } = await paneRows($, 58, 'agents')
  const run = rows.findIndex(r => /^workflow release-notes · .* · 0\/0 · \$0\.00/.test(r))
  expect(run).toBeGreaterThan(-1)
  expect(run).toBeLessThan(rows.findIndex(r => /^SUBAGENTS/.test(r)))
  release('rm x')
  await call
})

// ── Context: the breakdown first, then what the session costs ──

test('Context: the breakdown comes first, no cost per model, and the exact count is still behind refresh', async ($, on) => {
  world(on)
  roundHooks(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.session.measure({ context: { window: 1_000_000, tokens: 260_000, percent: 26 }, rateLimits: [], cost: { usd: 5.2 }, changed: ['context', 'cost'] })
  await $.turn.complete({ answer: '', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer', usage: { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 9000, cache_creation_input_tokens: 0, model: 'm' } })
  await settleAll()
  const ui = await mountPane($, 58)
  await ui.press({ key: 'tab:context' })
  await settleAll()
  const rows = rowTexts(await ui.drawn())
  const at = (re: RegExp) => rows.findIndex(r => re.test(r))
  expect(at(/^CONTEXT DETAILS/)).toBeGreaterThan(-1)
  expect(rows.some(r => /^COST PER ROUND|^TREND/.test(r))).toBe(false)
  expect(rows.some(r => /^BY MODEL/.test(r))).toBe(false)
  expect(await ui.find({ key: 'ctx:refresh' })).toBeDefined()
  await ui.unmount()
})

// ── Work: links, no processes ──

test('Work: the work item of the branch is a link to it (AB# in the branch name), with no state, checks or review, and no processes or ports', async ($, on) => {
  world(on, { branch: 'feature/AB#512-reports', workspaces: { roots: [{ path: '/', platform: 'azure-devops', org: 'contoso', project: 'Alpha', identity: 'id-a' }] } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await settleAll()
  const ui = await mountPane($, 58)
  await ui.press({ key: 'tab:work' })
  await settleAll()
  const rows = rowTexts(await ui.drawn())
  expect(rows.some(r => /^LINKS · 1/.test(r))).toBe(true)
  expect(rows.some(r => /^AB#512/.test(r))).toBe(true)
  expect(rows.some(r => /^PROCESS/.test(r))).toBe(false)
  expect((await ui.findAll({ type: 'Link' })).map(l => l.props.href)).toContain('https://dev.azure.com/contoso/Alpha/_workitems/edit/512')
  await ui.unmount()
})
