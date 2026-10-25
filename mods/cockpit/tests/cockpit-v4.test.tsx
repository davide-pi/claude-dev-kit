import { expect, test } from 'claude-code/testing'

import {
  askPerson,
  callAs,
  gatedBash,
  headerOf,
  launchWorkflow,
  loadSkill,
  mountPane,
  openCockpit,
  paneRows,
  permissionChecks,
  roundHooks,
  settleAll,
  skillTool,
  until,
  workflowLaunches,
} from './cockpit-fixtures'
import { flagOf, rowTexts, world } from './cockpit-world'

const failingBash = (on: Parameters<typeof world>[0]) => on('tool.call', { tool: 'Bash' }, () => ({ deny: 'exit 1: boom' }))

// ── Segnali: the tab and the header badge ──

test('Segnali: a command that failed twice is a signal: three lines (what, why, what to do), the badge in the header and the count in the state file', async ($, on) => {
  const writes = new Map<string, string>()
  const clock = world(on, { writes })
  failingBash(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(headerOf((await paneRows($)).rows).some(r => /⚠/.test(r))).toBe(false)

  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  expect(headerOf((await paneRows($)).rows).some(r => /⚠/.test(r))).toBe(false)
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  await settleAll()
  await clock.advance(5000) // past the state file's write window
  await settleAll()

  expect(headerOf((await paneRows($)).rows).some(r => /⚠ 1/.test(r))).toBe(true)
  const { rows } = await paneRows($, 58, 'signals')
  expect(rows.some(r => /^SEGNALI · 1/.test(r))).toBe(true)
  const at = rows.findIndex(r => /^⚠ .*npm test/.test(r))
  expect(at).toBeGreaterThan(0)
  expect(rows[at + 1]).toMatch(/^ +perché: /)
  expect(rows[at + 2]).toMatch(/^ +cosa fare: /)
  expect(flagOf(writes)).toMatchObject({ signals: 1 })
})

test('Segnali: with none, the tab says all is normal and the header has no badge', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const { rows } = await paneRows($, 58, 'signals')
  expect(rows).toContain('SEGNALI · 0')
  expect(rows.some(r => /nessun segnale/.test(r))).toBe(true)
  expect(headerOf(rows).some(r => /⚠/.test(r))).toBe(false)
})

test('Segnali: a permission ask unanswered over 60 seconds is a signal, and it clears when the person answers', async ($, on) => {
  const clock = world(on)
  permissionChecks(on)
  const release = gatedBash(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const call = callAs($, 'c1', { tool: 'Bash', command: 'rm x' })
  await settleAll()
  await askPerson($, 'c1')
  await clock.advance(91_000)
  await settleAll()
  expect((await paneRows($, 58, 'signals')).rows.some(r => /^SEGNALI · 1/.test(r))).toBe(true)
  release('rm x')
  await call
  await settleAll()
  expect((await paneRows($, 58, 'signals')).rows.some(r => /^SEGNALI · 0/.test(r))).toBe(true)
})

// ── Cronologia ──

test('Cronologia: a skill, an error and a round are rows, newest first, and the filter keeps one kind', async ($, on) => {
  world(on)
  roundHooks(on)
  skillTool(on)
  failingBash(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await loadSkill($, 'commit')
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  await $.turn.complete({ answer: '', durationMs: 4000, isAborted: false, turnId: 't1', reason: 'answer' })
  await settleAll()

  const ui = await mountPane($, 58)
  await ui.press({ key: 'tab:history' })
  const rows = rowTexts(await ui.drawn())
  expect(rows.some(r => /^CRONOLOGIA · 3/.test(r))).toBe(true)
  const list = rows.filter(r => /^\d\d:\d\d /.test(r))
  expect(list).toHaveLength(3)
  expect(list[0]).toMatch(/giro/)
  expect(list[1]).toMatch(/Bash: exit 1: boom/)
  expect(list[2]).toMatch(/skill commit/)

  await ui.press({ key: 'filter:skill' })
  expect(rowTexts(await ui.drawn()).filter(r => /^\d\d:\d\d /.test(r))).toHaveLength(1)
  expect(rowTexts(await ui.drawn()).some(r => /^CRONOLOGIA · 1\/3/.test(r))).toBe(true)
  await ui.press({ key: 'filter:stall' })
  expect(rowTexts(await ui.drawn()).some(r => /nessun evento/.test(r))).toBe(true)
  await ui.press({ key: 'filter:all' })
  expect(rowTexts(await ui.drawn()).filter(r => /^\d\d:\d\d /.test(r))).toHaveLength(3)
  await ui.unmount()
})

test('Cronologia: starts empty and says so; a compaction is a row', async ($, on) => {
  world(on, { compacts: true })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect((await paneRows($, 58, 'history')).rows.some(r => /nessun evento ancora/.test(r))).toBe(true)
  await $.session.compact({ messages: [{ role: 'user', text: 'x', toolUses: [] }], instructions: 'keep', trigger: 'manual' })
  await settleAll()
  expect((await paneRows($, 58, 'history')).rows.some(r => /compattazione/.test(r))).toBe(true)
})

// ── Ora ──

test('Ora: Claude\'s state with the seconds it has waited, and the workflow run with its phase and agents', async ($, on) => {
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
  expect(rows.some(r => /in attesa da \d+s/.test(r))).toBe(true)
  expect(rows.some(r => /^WORKFLOW · release-notes/.test(r))).toBe(true)
  expect(rows.some(r => /agenti 0\/0/.test(r))).toBe(true)
  release('rm x')
  await call
})

// ── Costi ──

test('Costi: the rounds with their cost, the dearest first, and the exact context count is still behind refresh', async ($, on) => {
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
  expect(rows.some(r => /^COSTO PER GIRO · 1/.test(r))).toBe(true)
  expect(rows.some(r => /^#1 /.test(r))).toBe(true)
  expect(rows.some(r => /^PER MODELLO/.test(r))).toBe(true)
  expect(rows.some(r => /^CONTEXT DETAILS/.test(r))).toBe(true)
  expect(await ui.find({ key: 'ctx:refresh' })).toBeDefined()
  await ui.unmount()
})

// ── Lavoro: processes are read only while the tab is open ──

test('Lavoro: the process reader runs only while Lavoro is the open tab, and its processes list with their ports', async ($, on) => {
  const procsCalls: string[] = []
  const procsLine = JSON.stringify({ procs: [{ pid: 4321, name: 'node', ports: [3000], ram: 52_428_800 }] })
  const clock = world(on, { procsCalls, procsLine })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await openCockpit($)
  const ui = await mountPane($, 58)
  await clock.advance(30_000)
  await settleAll()
  expect(procsCalls).toEqual([]) // the pane is open on Ora

  await ui.press({ key: 'tab:work' })
  await until(() => procsCalls.length > 0)
  await settleAll()
  expect(procsCalls).toHaveLength(1)
  expect(procsCalls[0]).toMatch(/^node .*procs\.mjs$/)
  const rows = rowTexts(await ui.drawn())
  expect(rows.some(r => /^PROCESSI E PORTE · 1/.test(r))).toBe(true)
  expect(rows.some(r => /4321.*node.*:3000/.test(r))).toBe(true)
  expect((await ui.findAll({ type: 'Link' })).map(l => l.props.href)).toContain('http://localhost:3000')

  await ui.press({ key: 'tab:notes' })
  const before = procsCalls.length
  await clock.advance(60_000)
  await settleAll()
  expect(procsCalls).toHaveLength(before)
  await ui.unmount()
})

test('Lavoro: a reader that fails says the processes are not readable here', async ($, on) => {
  const procsCalls: string[] = []
  world(on, { procsCalls })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await openCockpit($)
  const ui = await mountPane($, 58)
  await ui.press({ key: 'tab:work' })
  await until(() => procsCalls.length > 0)
  await settleAll()
  expect(rowTexts(await ui.drawn()).some(r => /processi non leggibili/.test(r))).toBe(true)
  await ui.unmount()
})

test('Lavoro: the work item of the branch is a link to it (AB# in the branch name), with no state, checks or review', async ($, on) => {
  world(on, { branch: 'feature/AB#512-reports', workspaces: { roots: [{ path: '/', platform: 'azure-devops', org: 'org-a', project: 'Alpha', identity: 'id-a' }] } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await settleAll()
  const ui = await mountPane($, 58)
  await ui.press({ key: 'tab:work' })
  await settleAll()
  const rows = rowTexts(await ui.drawn())
  expect(rows.some(r => /^LINK · 1/.test(r))).toBe(true)
  expect(rows.some(r => /^AB#512/.test(r))).toBe(true)
  expect((await ui.findAll({ type: 'Link' })).map(l => l.props.href)).toContain('https://dev.azure.com/org-a/Alpha/_workitems/edit/512')
  await ui.unmount()
})
