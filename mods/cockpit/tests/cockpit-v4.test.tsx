import { expect, test } from 'claude-code/testing'

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
import { flagOf, rowTexts, world } from './cockpit-world'

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
  expect(rows[at + 2]).toMatch(/^ +what to do: /)

  await ui.press({ key: 'tab:notes' })
  expect((await ui.find({ key: 'tab:signals' }))?.text).toBe('Notifications') // seen: leaving the tab does not count it again
  await ui.unmount()
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

test('Context: the breakdown comes first, the costs below it (models), and the exact count is still behind refresh', async ($, on) => {
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
  expect(at(/^BY MODEL/)).toBeGreaterThan(at(/^CONTEXT DETAILS/))
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
