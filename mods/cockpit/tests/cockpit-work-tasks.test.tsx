import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { PERIMETER, createTask, mountPane, paneRows, taskTools, todo, updateTask } from './cockpit-fixtures'
import { flagOf, rowTexts, world } from './cockpit-world'
import type { World } from './cockpit-world'

/** The page's rows, without the padding a row keeps. */
const pageRows = async ($: Engine, bodyColumns = 50) => (await paneRows($, bodyColumns)).rows.map(r => r.trimEnd())
/** The tasks row of IN PROGRESS, when the page has one. */
const tasksRow = async ($: Engine) => (await pageRows($)).find(r => /^[󱎖󰄰] tasks /u.test(r))

test('the task list comes from TodoWrite: IN PROGRESS counts them and names the one in progress', async ($, on) => {
  world(on)
  taskTools(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({
    tool: 'TodoWrite',
    todos: [todo('Done one', 'completed'), todo('Pending one', 'pending'), todo('Working on it', 'in_progress'), todo('Done two', 'completed')],
  })
  const rows = await pageRows($)
  expect(rows.some(r => /^IN PROGRESS ─+$/.test(r))).toBe(true)
  expect(await tasksRow($)).toBe('󱎖 tasks 2/4 · Working on it')
})

test('the task list comes from the task tools: create, start, complete, delete', async ($, on) => {
  const writes = new Map<string, string>()
  const clock = world(on, { writes })
  taskTools(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await createTask($, 'First')
  await createTask($, 'Second')
  await createTask($, 'Third')
  await updateTask($, '1', 'in_progress')
  await updateTask($, '2', 'in_progress')
  await updateTask($, '2', 'completed')
  await updateTask($, '3', 'deleted')
  await clock.advance(3000)

  expect(await tasksRow($)).toBe('󱎖 tasks 1/2 · First')
  expect(flagOf(writes)).toMatchObject({ tasks: { done: 1, total: 2 } })
})

test('TodoWrite replaces its own items and leaves the task-tool items', async ($, on) => {
  world(on)
  taskTools(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await createTask($, 'From a tool')
  await $.tool.call({ tool: 'TodoWrite', todos: [todo('Old todo', 'pending')] })
  await $.tool.call({ tool: 'TodoWrite', todos: [todo('New todo', 'pending'), todo('Other todo', 'pending')] })
  expect(await tasksRow($)).toBe('󰄰 tasks 0/3')
})

test('the task list is shared: a subagent TaskCreate/TaskUpdate counts, its TodoWrite does not', async ($, on) => {
  world(on)
  taskTools(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'TodoWrite', todos: [todo('private to the subagent', 'pending')], agentId: 'a1' })
  expect(await tasksRow($)).toBeUndefined()
  await createTask($, 'by a subagent', 'a1')
  await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'in_progress', agentId: 'a1' })
  expect(await tasksRow($)).toBe('󱎖 tasks 0/1 · by a subagent')
})

test('an update of a task the mod never saw adds it; a delete of one it never saw adds nothing', async ($, on) => {
  world(on)
  taskTools(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'TaskUpdate', taskId: '9', status: 'deleted' })
  expect(await tasksRow($)).toBeUndefined()
  await $.tool.call({ tool: 'TaskUpdate', taskId: '7', status: 'in_progress', subject: 'Resumed work' })
  await $.tool.call({ tool: 'TaskUpdate', taskId: '8', status: 'completed' })
  await $.tool.call({ tool: 'TaskUpdate', taskId: '9', subject: 'no status: not a task state' })
  expect(await tasksRow($)).toBe('󱎖 tasks 1/2 · Resumed work')
})

test('no tasks: no IN PROGRESS section, and the state file says tasks:null', async ($, on) => {
  const writes = new Map<string, string>()
  world(on, { writes })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(await tasksRow($)).toBeUndefined()
  expect((await pageRows($)).some(r => /^IN PROGRESS/.test(r))).toBe(false)
  expect((flagOf(writes) as { tasks: unknown }).tasks).toBeNull()
})

test('the list is empty again at session start (a /clear included)', async ($, on) => {
  const writes = new Map<string, string>()
  let id = 's-1'
  world(on, { writes, sessionId: () => id })
  taskTools(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'TodoWrite', todos: [todo('x', 'pending')] })
  expect(await tasksRow($)).toBeDefined()
  id = 's-2'
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(await tasksRow($)).toBeUndefined()
  const second = [...writes.entries()].find(([k]) => /cockpit-s-2\.json$/.test(k))
  expect((JSON.parse(second?.[1] ?? 'null') as { tasks: unknown }).tasks).toBeNull()
})

test('ATTENTION: a worklog up to date is no row', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const upToDate = await pageRows($)
  expect(upToDate).toContain('✓ nothing to do')
  expect(upToDate.some(r => /worklog/.test(r))).toBe(false)
})

test('ATTENTION: a worklog behind is a row saying how many days, and `worklog:days` opens and folds the list of them', async ($, on) => {
  world(on, { hasWorklog: true })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 50)
  expect(rowTexts(await ui.drawn()).some(r => /^\u{F00F0} 1 day without logged hours/u.test(r))).toBe(true)
  expect(rowTexts(await ui.drawn()).some(r => /to log/.test(r))).toBe(false)
  await ui.press({ key: 'worklog:days' })
  expect(rowTexts(await ui.drawn()).some(r => /^\u{F00F0} 1 day without logged hours/u.test(r))).toBe(true)
  expect(rowTexts(await ui.drawn()).some(r => /to log/.test(r))).toBe(true)
  await ui.press({ key: 'worklog:days' })
  expect(rowTexts(await ui.drawn()).some(r => /^\u{F00F0} 1 day without logged hours/u.test(r))).toBe(true)
  await ui.unmount()
})

test('IN PROGRESS: the deliver perimeter is a row of the section, and no tab bar or worklog notice sits above it', async ($, on) => {
  world(on, { branch: 'feat/x', perimeter: PERIMETER, changed: ['lib/z.ts'] })
  taskTools(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'TodoWrite', todos: [todo('Working on it', 'in_progress')] })
  const rows = await pageRows($)
  const main = rows.findIndex(r => /^IN PROGRESS ─+$/.test(r))
  expect(main).toBeGreaterThan(0)
  expect(rows[main - 1]).toBe('')
  expect(rows[main - 2]).not.toMatch(/^─+$/) // sections are told apart by an empty row, not a rule
  expect(rows.slice(main).some(r => /deliver perimeter/.test(r) || /outside the perimeter/.test(r))).toBe(true)
})

const claim = (n: number, rule: string, excerpt: string, session = 's-1') =>
  JSON.stringify({ at: new Date(2026, 9, 22, 8 + n, 5).toISOString(), session, cwd: '/w', rule, word: 'fatto', excerpt })

test('hook triggers: the blocks of done-claim.log that belong to this session are one notification once there are two', async ($, on) => {
  const doneClaims = [
    claim(1, 'unproven-row', 'primo'),
    claim(2, 'unproven-row', 'secondo'),
    claim(3, 'tail-cut', 'terzo'),
    claim(5, 'shell-ran', 'solo contato'),
    claim(7, 'unproven-row', 'altra sessione', 's-2'),
    '',
  ].join('\n')
  world(on, { doneClaims })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect((await pageRows($)).some(r => /3 done-claim blocks/.test(r))).toBe(true)
})

test('hook triggers: the blocks of another session or no block at all draw nothing', async ($, on) => {
  world(on, { doneClaims: `${claim(1, 'unproven-row', 'altra', 's-2')}\n${claim(2, 'shell-ran', 'contato')}\n` })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect((await pageRows($)).some(r => /done-claim/.test(r))).toBe(false)
})

test('hook triggers: no log (or an empty one) draws no block', async ($, on) => {
  world(on, { doneClaims: '' })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect((await pageRows($)).some(r => /done-claim/.test(r))).toBe(false)
})

// ── done-claim.log is read again only when it changed ──

test('hook triggers: the log is read again only when its size or modification time changed', async ($, on) => {
  const claimReads: string[] = []
  let mtime = 1
  const options: World = { claimReads, doneClaims: claim(1, 'unproven-row', 'primo'), claimsMtime: () => mtime }
  const clock = world(on, options)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(claimReads).toHaveLength(1)
  for (let i = 0; i < 4; i++) await clock.advance(30_000)
  expect(claimReads).toHaveLength(1)
  expect((await pageRows($)).some(r => /done-claim/.test(r))).toBe(false) // one block is no notification yet

  mtime = 2 // same size, new time
  await clock.advance(30_000)
  expect(claimReads).toHaveLength(2)

  options.doneClaims = `${claim(1, 'unproven-row', 'primo')}\n${claim(2, 'unproven-row', 'secondo')}\n` // another size
  await clock.advance(30_000)
  expect(claimReads).toHaveLength(3)
  expect((await pageRows($)).some(r => /2 done-claim blocks/.test(r))).toBe(true)
  await clock.advance(30_000)
  expect(claimReads).toHaveLength(3)
})
