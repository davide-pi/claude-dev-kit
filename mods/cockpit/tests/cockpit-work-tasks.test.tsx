import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import {
  PERIMETER,
  createTask,
  mountPane,
  openCockpit,
  paneRows,
  spawnAgent,
  settleAll,
  spawns,
  taskRows,
  taskTools,
  todo,
  updateTask,
  workRows,
} from './cockpit-fixtures'
import { PANE, flagOf, rowTexts, world } from './cockpit-world'
import type { World } from './cockpit-world'

test('the task list comes from TodoWrite: title, counts, bar, rows by state and the completed row', async ($, on) => {
  const clock = world(on)
  taskTools(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({
    tool: 'TodoWrite',
    todos: [todo('Done one', 'completed'), todo('Pending one', 'pending'), todo('Working on it', 'in_progress'), todo('Done two', 'completed')],
  })
  await openCockpit($)
  await clock.advance(15_000 * 8) // 2m00s: the tick moves `now`

  const { rows, i } = await taskRows($)
  expect(rows[i]).toMatch(/^TASK · 2\/4󱎖 1 {2}󰄰 1 {2}󰄬 2$/)
  expect(rows[i - 1]).toBe(' ')
  // the tasks belong to the main agent's block
  expect(rows[i - 2]).toBe('IN PROGRESS')
  expect(rows[i - 3]).toBe(' ')
  expect(rows[i - 4]).toMatch(/^─+$/)
  expect(rows[i + 1]).toBe(' ')
  expect(rows[i + 2]).toMatch(/^[▰▱]{48}$/)
  // in progress first, with its elapsed time; then pending; then the completed row
  expect(rows[i + 3]).toMatch(/^󱎖 Working on it +2m00s$/)
  expect(rows[i + 4]).toMatch(/^󰄰 Pending one +$/)
  expect(rows[i + 5]).toBe('󰄬 2 done')
})

test('the bar splits its width by done, in progress and the rest', async ($, on) => {
  world(on)
  taskTools(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({
    tool: 'TodoWrite',
    todos: [todo('a', 'completed'), todo('b', 'completed'), todo('c', 'in_progress'), todo('d', 'pending')],
  })
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 40 }, surface: 'terminal' })
  await ui.press({ key: 'tab:work' })
  const cells: Record<string, number> = {}
  const walk = (el: unknown) => {
    const o = el as { props?: { color?: string }; children?: unknown[] } | null
    const [only] = o?.children ?? []
    if (typeof only === 'string' && /^[▰▱]+$/.test(only)) cells[o?.props?.color ?? ''] = (cells[o?.props?.color ?? ''] ?? 0) + [...only].length
    for (const c of o?.children ?? []) walk(c)
  }
  walk(await ui.drawn())
  await ui.unmount()
  // the bar fills the pane's width: half done green, a quarter in progress blue (the CTX and credit bars are surface modules, not counted here)
  expect(cells['#7ec699']).toBeGreaterThanOrEqual(19)
  expect(cells['#7fb4ff']).toBeGreaterThanOrEqual(9)
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

  const { rows, i } = await taskRows($)
  expect(rows[i]).toMatch(/^TASK · 1\/2󱎖 1 {2}󰄰 0 {2}󰄬 1$/)
  expect(rows[i + 3]).toMatch(/^󱎖 First +/)
  expect(rows[i + 4]).toBe('󰄬 1 done')
  expect(flagOf(writes)).toMatchObject({ tasks: { done: 1, total: 2 } })
})

test('TodoWrite replaces its own items and leaves the task-tool items', async ($, on) => {
  world(on)
  taskTools(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await createTask($, 'From a tool')
  await $.tool.call({ tool: 'TodoWrite', todos: [todo('Old todo', 'pending')] })
  await $.tool.call({ tool: 'TodoWrite', todos: [todo('New todo', 'pending'), todo('Other todo', 'pending')] })
  const { rows, i } = await taskRows($)
  expect(rows[i]).toMatch(/^TASK · 0\/3󱎖/)
  expect(rows.filter(r => /^󰄰 /.test(r)).map(r => r.trim())).toEqual(['󰄰 From a tool', '󰄰 New todo', '󰄰 Other todo'])
})

test('the task list is shared: a subagent TaskCreate/TaskUpdate counts, its TodoWrite does not', async ($, on) => {
  world(on)
  taskTools(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'TodoWrite', todos: [todo('private to the subagent', 'pending')], agentId: 'a1' })
  expect((await taskRows($)).i).toBe(-1)
  await createTask($, 'by a subagent', 'a1')
  await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'in_progress', agentId: 'a1' })
  const { rows, i } = await taskRows($)
  expect(rows[i]).toMatch(/^TASK · 0\/1󱎖 1 {2}󰄰 0 {2}󰄬 0$/)
  expect(rows[i + 3]).toMatch(/^󱎖 by a subagent/)
})

test('an update of a task the mod never saw adds it; a delete of one it never saw adds nothing', async ($, on) => {
  world(on)
  taskTools(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'TaskUpdate', taskId: '9', status: 'deleted' })
  expect((await taskRows($)).i).toBe(-1)
  await $.tool.call({ tool: 'TaskUpdate', taskId: '7', status: 'in_progress', subject: 'Resumed work' })
  await $.tool.call({ tool: 'TaskUpdate', taskId: '8', status: 'completed' })
  await $.tool.call({ tool: 'TaskUpdate', taskId: '9', subject: 'no status: not a task state' })
  const { rows, i } = await taskRows($)
  expect(rows[i]).toMatch(/^TASK · 1\/2󱎖 1 {2}󰄰 0 {2}󰄬 1$/)
  expect(rows[i + 3]).toMatch(/^󱎖 Resumed work/)
})

test('the section is omitted with no tasks, and the state file says tasks:null', async ($, on) => {
  const writes = new Map<string, string>()
  world(on, { writes })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const { rows, i } = await taskRows($)
  expect(i).toBe(-1)
  expect(rows.some(r => /done/.test(r))).toBe(false)
  expect((flagOf(writes) as { tasks: unknown }).tasks).toBeNull()
})

test('long subjects are cut with … and more than 6 open tasks end in … +N', async ($, on) => {
  world(on)
  taskTools(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const todos = [todo('A very long subject that cannot possibly fit in the narrow pane width', 'in_progress')]
  for (let n = 1; n <= 7; n++) todos.push(todo(`Pending ${n}`, 'pending'))
  await $.tool.call({ tool: 'TodoWrite', todos })
  const { rows, i } = await taskRows($, 40)
  expect(rows[i + 3]).toMatch(/^󱎖 A very long subject.*… +0s$/)
  expect([...(rows[i + 3] ?? '')].length).toBe(38)
  expect(rows.slice(i + 3, i + 9).filter(r => /^[󱎖󰄰]/u.test(r)).length).toBe(6)
  expect(rows[i + 9]).toBe('󰍟 +2')
})

test('tasks: `󰍟 +2` opens the open tasks past the sixth, `󰍝 −2` folds them again', async ($, on) => {
  world(on)
  taskTools(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'TodoWrite', todos: Array.from({ length: 8 }, (_, n) => todo(`Pending ${n + 1}`, 'pending')) })
  const ui = await mountPane($, 40)
  await ui.press({ key: 'tab:work' })
  const pending = async () => rowTexts(await ui.drawn()).filter(r => /^󰄰 Pending/.test(r)).length
  expect(await pending()).toBe(6)
  expect((await ui.find({ key: 'tasks:more' }))?.text).toBe('󰍟 +2')
  await ui.press({ key: 'tasks:more' })
  expect(await pending()).toBe(8)
  expect((await ui.find({ key: 'tasks:more' }))?.text).toBe('󰍝 −2')
  await ui.press({ key: 'tasks:more' })
  expect(await pending()).toBe(6)
  await ui.unmount()
})

test('tasks: opened, a long subject wraps under its row instead of ending in …', async ($, on) => {
  world(on)
  taskTools(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const todos = [todo('A very long subject that cannot possibly fit in the narrow pane width', 'in_progress')]
  for (let n = 1; n <= 7; n++) todos.push(todo(`Pending ${n}`, 'pending'))
  await $.tool.call({ tool: 'TodoWrite', todos })
  const ui = await mountPane($, 40)
  await ui.press({ key: 'tab:work' })
  expect(rowTexts(await ui.drawn()).some(r => /^󱎖 A very long subject.*…/.test(r))).toBe(true)
  await ui.press({ key: 'tasks:more' })
  const rows = rowTexts(await ui.drawn())
  expect(rows.some(r => /^󱎖 A very long/.test(r) && !r.includes('…'))).toBe(true)
  expect(rows.some(r => /^ {2}.*width/.test(r))).toBe(true)
  await ui.unmount()
})

test('Notifications: the worklog is "up to date", or lists its days behind when its row is pressed', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect((await paneRows($, 50, 'signals')).rows).toContain('󰄬 worklog up to date')
})

test('Notifications: a worklog behind says how many days, and `worklog:days` opens and folds the list of them', async ($, on) => {
  world(on, { hasWorklog: true })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 50)
  await ui.press({ key: 'tab:signals' })
  expect(rowTexts(await ui.drawn())).toContain('▸ 1 day behind')
  expect(rowTexts(await ui.drawn()).some(r => /to log/.test(r))).toBe(false)
  await ui.press({ key: 'worklog:days' })
  const opened = rowTexts(await ui.drawn())
  expect(opened).toContain('▾ 1 day behind')
  expect(opened.some(r => /to log/.test(r))).toBe(true)
  await ui.press({ key: 'worklog:days' })
  expect(rowTexts(await ui.drawn())).toContain('▸ 1 day behind')
  await ui.unmount()
})

test('the list is empty again at session start (a /clear included)', async ($, on) => {
  const writes = new Map<string, string>()
  let id = 's-1'
  world(on, { writes, sessionId: () => id })
  taskTools(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'TodoWrite', todos: [todo('x', 'pending')] })
  expect((await taskRows($)).i).toBeGreaterThan(0)
  id = 's-2'
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect((await taskRows($)).i).toBe(-1)
  const second = [...writes.entries()].find(([k]) => /cockpit-s-2\.json$/.test(k))
  expect((JSON.parse(second?.[1] ?? 'null') as { tasks: unknown }).tasks).toBeNull()
})

test('Work: no ALM line, and the log hours button is in the footer, not at the top of the tab', async ($, on) => {
  world(on, { sessionId: () => 'chat-7', workspaces: { roots: [{ path: '/work', platform: 'azure-devops', org: 'org-a', project: 'Alpha', identity: 'id-a' }] } })
  taskTools(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'TodoWrite', todos: [todo('Working on it', 'in_progress')] })
  await settleAll()
  const ui = await mountPane($)
  await ui.press({ key: 'tab:work' })
  const rows = rowTexts(await ui.drawn())
  expect(rows.some(r => /^ALM/.test(r))).toBe(false)
  expect((await ui.find({ key: 'bar:worklog' }))?.text).toBe('log hours')
  // the tab starts with the empty row after the tab bar's rule, then the IN PROGRESS block
  const main = rows.findIndex(r => /^IN PROGRESS/.test(r))
  expect(rows[main - 1]?.trim()).toBe('')
  expect(rows[main - 2]).toMatch(/^─/)
  await ui.unmount()
})

test('the other tabs draw the current sections: Agents the agents, Work tasks, Notifications its own title and the worklog', async ($, on) => {
  world(on, { hasWorklog: true })
  taskTools(on)
  spawns(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await spawnAgent($, 'code-reviewer')
  await $.tool.call({ tool: 'TodoWrite', todos: [todo('Working on it', 'in_progress')] })

  const agents = (await paneRows($, 50, 'agents')).rows
  expect(agents.some(r => /^󱎖 code-reviewer/.test(r))).toBe(true)
  expect(agents.some(r => /^TASK/.test(r) || /worklog/.test(r))).toBe(false)

  const work = (await paneRows($, 50, 'work')).rows
  expect(work.some(r => /^TASK · 0\/1/.test(r))).toBe(true)
  expect(work.some(r => /worklog/.test(r))).toBe(false)
  expect(work.some(r => /^SUBAGENTS/.test(r))).toBe(false)

  const notifications = (await paneRows($, 50, 'signals')).rows
  expect(notifications.some(r => /^no notifications/.test(r))).toBe(true)
  expect(notifications.some(r => /^WORKLOG$/.test(r))).toBe(true)
  expect(notifications.some(r => /^SUBAGENTS/.test(r) || /^TASK/.test(r))).toBe(false)
})

// ── Phase 2 follow-ups ──

test('Work with no tasks, no worklog warnings and no git draws no section, and never processes or ports', async ($, on) => {
  world(on, { notRepo: true })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const { rows } = await paneRows($, 50, 'work')
  expect(rows.some(r => /^(PROCESSI|PROCESSES)/.test(r))).toBe(false)
  expect(rows.some(r => /^(IN PROGRESS|CHANGES|LINK)/.test(r))).toBe(false)
  expect(rows.some(r => /^TASK/.test(r) || /worklog/.test(r))).toBe(false)
})

test('IN PROGRESS: the perimeter and the session tasks are one block, in that order, with no worklog notice', async ($, on) => {
  world(on, { hasWorklog: true, branch: 'feat/x', perimeter: PERIMETER, changed: ['lib/z.ts'] })
  taskTools(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'TodoWrite', todos: [todo('Working on it', 'in_progress')] })
  const rows = await workRows($)
  const at = (re: RegExp) => rows.findIndex(r => re.test(r))
  const [main, perimeter, tasks] = [at(/^IN PROGRESS$/), at(/^deliver perimeter/), at(/^TASK ·/)]
  expect(main).toBeLessThan(perimeter)
  expect(perimeter).toBeLessThan(tasks)
  expect(rows.some(r => /worklog/.test(r))).toBe(false)
  // no rule inside the block
  expect(rows.slice(main, tasks + 2).some(r => /^─+$/.test(r))).toBe(false)
  // and the tasks are not in the Subagents view
  expect((await paneRows($, 50, 'agents')).rows.some(r => /^TASK/.test(r))).toBe(false)
})

/** The Notifications tab's rows. */
const notificationRows = async ($: Engine) => (await paneRows($, 50, 'signals')).rows

const claim = (n: number, rule: string, excerpt: string, session = 's-1') =>
  JSON.stringify({ at: new Date(2026, 9, 22, 8 + n, 5).toISOString(), session, cwd: '/w', rule, word: 'fatto', excerpt })

test('hook triggers: the blocks of done-claim.log that belong to this session are one notification once there are two, and never reach Work', async ($, on) => {
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
  const rows = await notificationRows($)
  expect(rows.some(r => /3 done-claim blocks/.test(r))).toBe(true)
  expect((await workRows($)).some(r => /done-claim/.test(r))).toBe(false)
})

test('hook triggers: the blocks of another session or no block at all draw nothing', async ($, on) => {
  world(on, { doneClaims: `${claim(1, 'unproven-row', 'altra', 's-2')}\n${claim(2, 'shell-ran', 'contato')}\n` })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect((await notificationRows($)).some(r => /done-claim/.test(r))).toBe(false)
})

test('hook triggers: no log (or an empty one) draws no block', async ($, on) => {
  world(on, { doneClaims: '' })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect((await notificationRows($)).some(r => /done-claim/.test(r))).toBe(false)
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
  expect((await notificationRows($)).some(r => /done-claim/.test(r))).toBe(false) // one block is no notification yet

  mtime = 2 // same size, new time
  await clock.advance(30_000)
  expect(claimReads).toHaveLength(2)

  options.doneClaims = `${claim(1, 'unproven-row', 'primo')}\n${claim(2, 'unproven-row', 'secondo')}\n` // another size
  await clock.advance(30_000)
  expect(claimReads).toHaveLength(3)
  expect((await notificationRows($)).some(r => /2 done-claim blocks/.test(r))).toBe(true)
  await clock.advance(30_000)
  expect(claimReads).toHaveLength(3)
})
