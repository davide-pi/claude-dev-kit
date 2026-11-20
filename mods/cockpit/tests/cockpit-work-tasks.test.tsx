import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { createTask, mountAnalysis, paneRows, taskTools, todo, updateTask } from './cockpit-fixtures'
import { flagOf, rowTexts, world } from './cockpit-world'
import type { World } from './cockpit-world'

/** The page's rows, without the padding a row keeps. */
const pageRows = async ($: Engine, bodyColumns = 50, tab?: 'now' | 'log' | 'analysis') => (await paneRows($, bodyColumns, tab)).rows.map(r => r.trimEnd())
/** The task counts the state file carries once its throttle has passed; null when there are none. */
const tasksOf = async (writes: Map<string, string>, clock: { advance: (ms: number) => Promise<void> }) => {
  await clock.advance(3000)
  return (flagOf(writes) as { tasks: unknown }).tasks
}

test('Given a TodoWrite with four items, When the state file is written, Then it counts the two done out of four', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const writes = new Map<string, string>()
  const clock = world(on, { writes })
  taskTools(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  // When
  await $.tool.call({
    tool: 'TodoWrite',
    todos: [todo('Done one', 'completed'), todo('Pending one', 'pending'), todo('Working on it', 'in_progress'), todo('Done two', 'completed')],
  })
  // Then
  expect(await tasksOf(writes, clock)).toEqual({ done: 2, total: 4 })
})

test('Given the task tools create, start, complete and delete, When the state file is written, Then it counts what is left', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const writes = new Map<string, string>()
  const clock = world(on, { writes })
  taskTools(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  // When
  await createTask($, 'First')
  await createTask($, 'Second')
  await createTask($, 'Third')
  await updateTask($, '1', 'in_progress')
  await updateTask($, '2', 'in_progress')
  await updateTask($, '2', 'completed')
  await updateTask($, '3', 'deleted')
  // Then
  expect(await tasksOf(writes, clock)).toEqual({ done: 1, total: 2 })
})

test('Given a task-tool item, When TodoWrite replaces its own items twice, Then the tool item stays and the todos are the last two', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const writes = new Map<string, string>()
  const clock = world(on, { writes })
  taskTools(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await createTask($, 'From a tool')
  // When
  await $.tool.call({ tool: 'TodoWrite', todos: [todo('Old todo', 'pending')] })
  await $.tool.call({ tool: 'TodoWrite', todos: [todo('New todo', 'pending'), todo('Other todo', 'pending')] })
  // Then
  expect(await tasksOf(writes, clock)).toEqual({ done: 0, total: 3 })
})

test('Given a subagent, When it calls TodoWrite and then TaskCreate and TaskUpdate, Then only the task tools count', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const writes = new Map<string, string>()
  const clock = world(on, { writes })
  taskTools(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  // When
  await $.tool.call({ tool: 'TodoWrite', todos: [todo('private to the subagent', 'pending')], agentId: 'a1' })
  // Then
  expect(await tasksOf(writes, clock)).toBeNull()
  // When
  await createTask($, 'by a subagent', 'a1')
  await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'in_progress', agentId: 'a1' })
  // Then
  expect(await tasksOf(writes, clock)).toEqual({ done: 0, total: 1 })
})

test('Given updates of tasks the mod never saw, When a delete, a start, a completion and a status-less update come, Then only the states count', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const writes = new Map<string, string>()
  const clock = world(on, { writes })
  taskTools(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  // When
  await $.tool.call({ tool: 'TaskUpdate', taskId: '9', status: 'deleted' })
  // Then
  expect(await tasksOf(writes, clock)).toBeNull()
  // When
  await $.tool.call({ tool: 'TaskUpdate', taskId: '7', status: 'in_progress', subject: 'Resumed work' })
  await $.tool.call({ tool: 'TaskUpdate', taskId: '8', status: 'completed' })
  await $.tool.call({ tool: 'TaskUpdate', taskId: '9', subject: 'no status: not a task state' })
  // Then
  expect(await tasksOf(writes, clock)).toEqual({ done: 1, total: 2 })
})

test('Given no tasks, When the state file is written, Then it says tasks:null and the page has no IN PROGRESS section', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const writes = new Map<string, string>()
  const clock = world(on, { writes })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  // When / Then
  expect(await tasksOf(writes, clock)).toBeNull()
  expect((await pageRows($)).some(r => /^IN PROGRESS/.test(r))).toBe(false)
})

test('Given a task, When a new session starts (a /clear included), Then the list is empty again', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const writes = new Map<string, string>()
  let id = 's-1'
  const clock = world(on, { writes, sessionId: () => id })
  taskTools(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'TodoWrite', todos: [todo('x', 'pending')] })
  expect(await tasksOf(writes, clock)).toEqual({ done: 0, total: 1 })
  // When
  id = 's-2'
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(3000)
  // Then
  const second = [...writes.entries()].find(([k]) => /cockpit-s-2\.json$/.test(k))
  expect((JSON.parse(second?.[1] ?? 'null') as { tasks: unknown }).tasks).toBeNull()
})

test('ATTENTION: a worklog up to date is no row', { timeoutMs: 30_000 }, async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const upToDate = await pageRows($, 50, 'analysis')
  expect(upToDate).toContain('✓ nothing to do')
  expect(upToDate.some(r => /worklog/.test(r))).toBe(false)
})

test('ATTENTION: a worklog behind is a row saying how many days, and `worklog:days` opens and folds the list of them', { timeoutMs: 30_000 }, async ($, on) => {
  world(on, { hasWorklog: true })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mountAnalysis($, 50)
  expect(rowTexts(await ui.drawn()).some(r => /^\u{F00F0} 1 day without logged hours/u.test(r))).toBe(true)
  expect(rowTexts(await ui.drawn()).some(r => /to log/.test(r))).toBe(false)
  await ui.press({ key: 'worklog:days' })
  expect(rowTexts(await ui.drawn()).some(r => /^\u{F00F0} 1 day without logged hours/u.test(r))).toBe(true)
  expect(rowTexts(await ui.drawn()).some(r => /to log/.test(r))).toBe(true)
  await ui.press({ key: 'worklog:days' })
  expect(rowTexts(await ui.drawn()).some(r => /^\u{F00F0} 1 day without logged hours/u.test(r))).toBe(true)
  await ui.unmount()
})

const claim = (n: number, rule: string, excerpt: string, session = 's-1') =>
  JSON.stringify({ at: new Date(2026, 9, 22, 8 + n, 5).toISOString(), session, cwd: '/w', rule, word: 'fatto', excerpt })

test('hook triggers: the blocks of done-claim.log that belong to this session are one notification once there are two', { timeoutMs: 30_000 }, async ($, on) => {
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
  expect((await pageRows($, 50, 'analysis')).some(r => /3 done-claim blocks/.test(r))).toBe(true)
})

test('hook triggers: the blocks of another session or no block at all draw nothing', { timeoutMs: 30_000 }, async ($, on) => {
  world(on, { doneClaims: `${claim(1, 'unproven-row', 'altra', 's-2')}\n${claim(2, 'shell-ran', 'contato')}\n` })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect((await pageRows($, 50, 'analysis')).some(r => /done-claim/.test(r))).toBe(false)
})

test('hook triggers: no log (or an empty one) draws no block', { timeoutMs: 30_000 }, async ($, on) => {
  world(on, { doneClaims: '' })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect((await pageRows($, 50, 'analysis')).some(r => /done-claim/.test(r))).toBe(false)
})

// ── done-claim.log is read again only when it changed ──

test('hook triggers: the log is read again only when its size or modification time changed', { timeoutMs: 30_000 }, async ($, on) => {
  const claimReads: string[] = []
  let mtime = 1
  const options: World = { claimReads, doneClaims: claim(1, 'unproven-row', 'primo'), claimsMtime: () => mtime }
  const clock = world(on, options)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(claimReads).toHaveLength(1)
  for (let i = 0; i < 4; i++) await clock.advance(30_000)
  expect(claimReads).toHaveLength(1)
  expect((await pageRows($, 50, 'analysis')).some(r => /done-claim/.test(r))).toBe(false) // one block is no notification yet

  mtime = 2 // same size, new time
  await clock.advance(30_000)
  expect(claimReads).toHaveLength(2)

  options.doneClaims = `${claim(1, 'unproven-row', 'primo')}\n${claim(2, 'unproven-row', 'secondo')}\n` // another size
  await clock.advance(30_000)
  expect(claimReads).toHaveLength(3)
  expect((await pageRows($, 50, 'analysis')).some(r => /2 done-claim blocks/.test(r))).toBe(true)
  await clock.advance(30_000)
  expect(claimReads).toHaveLength(3)
})
