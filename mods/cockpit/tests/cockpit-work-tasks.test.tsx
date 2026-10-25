import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import {
  PERIMETER,
  RED,
  colorOf,
  createTask,
  insightsRows,
  paneRows,
  spawnAgent,
  spawns,
  taskRows,
  taskTools,
  todo,
  updateTask,
  workRows,
} from './cockpit-fixtures'
import { PANE, flagOf, world } from './cockpit-world'
import type { World } from './cockpit-world'

test('the task list comes from TodoWrite: title, counts, bar, rows by state and the completed row', async ($, on) => {
  const clock = world(on)
  taskTools(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({
    tool: 'TodoWrite',
    todos: [todo('Done one', 'completed'), todo('Pending one', 'pending'), todo('Working on it', 'in_progress'), todo('Done two', 'completed')],
  })
  await clock.advance(15_000 * 8) // 2m00s: the tick moves `now`

  const { rows, i } = await taskRows($)
  expect(rows[i]).toMatch(/^TASK · 2\/4◐ 1 {2}○ 1 {2}✓ 2$/)
  expect(rows[i - 1]).toBe(' ')
  // the tasks belong to the main agent's block
  expect(rows[i - 2]).toBe('MAIN')
  expect(rows[i - 3]).toBe(' ')
  expect(rows[i - 4]).toMatch(/^─+$/)
  expect(rows[i + 1]).toBe(' ')
  expect(rows[i + 2]).toMatch(/^[▰▱]{48}$/)
  // in progress first, with its elapsed time; then pending; then the completed row
  expect(rows[i + 3]).toMatch(/^◐ Working on it +2m00s$/)
  expect(rows[i + 4]).toMatch(/^○ Pending one +$/)
  expect(rows[i + 5]).toBe('✓ 2 done')
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
  // 40 cells: 2/4 done green, 1/4 in progress blue (the context and credit bars add their own green and blue)
  expect(cells['#7ec699']).toBeGreaterThanOrEqual(20)
  expect(cells['#7fb4ff']).toBeGreaterThanOrEqual(10)
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
  expect(rows[i]).toMatch(/^TASK · 1\/2◐ 1 {2}○ 0 {2}✓ 1$/)
  expect(rows[i + 3]).toMatch(/^◐ First +/)
  expect(rows[i + 4]).toBe('✓ 1 done')
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
  expect(rows[i]).toMatch(/^TASK · 0\/3◐/)
  expect(rows.filter(r => /^○ /.test(r)).map(r => r.trim())).toEqual(['○ From a tool', '○ New todo', '○ Other todo'])
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
  expect(rows[i]).toMatch(/^TASK · 0\/1◐ 1 {2}○ 0 {2}✓ 0$/)
  expect(rows[i + 3]).toMatch(/^◐ by a subagent/)
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
  expect(rows[i]).toMatch(/^TASK · 1\/2◐ 1 {2}○ 0 {2}✓ 1$/)
  expect(rows[i + 3]).toMatch(/^◐ Resumed work/)
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
  expect(rows[i + 3]).toMatch(/^◐ A very long subject.*… +0s$/)
  expect([...(rows[i + 3] ?? '')].length).toBe(38)
  expect(rows.slice(i + 3, i + 9).filter(r => /^[◐○]/.test(r)).length).toBe(6)
  expect(rows[i + 9]).toBe('… +2')
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

/** The ALM line of the Work tab, where it sits since the header lost it. */
const almRow = (rows: string[]): string | undefined => rows.find(r => /^ALM/.test(r))
const workTab = async ($: Engine, bodyColumns = 50) => paneRows($, bodyColumns, 'work')

test('ALM line at the top of the Work tab, not in the header: org / project and identity, resolved for the cwd', async ($, on) => {
  world(on, { workspaces: { roots: [{ path: '/work', platform: 'azure-devops', org: 'org-a', project: 'Alpha', identity: 'id-a' }] } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(almRow((await paneRows($)).rows)).toBeUndefined()
  const { rows } = await workTab($)
  expect(almRow(rows)).toBe('ALM org-a / Alpha · id-a')
  expect(rows.findIndex(r => /^ALM/.test(r))).toBeLessThan(rows.findIndex(r => /^BRANCH/.test(r)))
})

test('ALM line: a mapped root with no org, project or identity draws no line', async ($, on) => {
  world(on, { workspaces: { roots: [{ path: '/work', platform: 'github' }] } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const { rows } = await workTab($)
  expect(almRow(rows)).toBeUndefined()
})

test('ALM line is cut in the middle to the pane width', async ($, on) => {
  const project = 'A-very-long-project-name-that-cannot-fit-in-a-narrow-pane'
  world(on, { workspaces: { roots: [{ path: '/work', platform: 'azure-devops', org: 'org-a', project, identity: 'id-a' }] } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const row = almRow((await workTab($, 40)).rows)
  expect([...(row ?? '')].length).toBe(38)
  expect(row).toMatch(/^ALM org-a.*….*id-a$/)
})

test('a workspaces.json that goes missing clears the ALM line; a malformed one too', async ($, on) => {
  const options: World = { workspaces: { roots: [{ path: '/work', platform: 'azure-devops', org: 'org-a', project: 'Alpha', identity: 'id-a' }] } }
  const clock = world(on, options)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(almRow((await workTab($)).rows)).toBe('ALM org-a / Alpha · id-a')
  options.workspacesFail = true
  await clock.advance(30_000)
  expect(almRow((await workTab($)).rows)).toBeUndefined()
  options.workspacesFail = false
  await clock.advance(30_000)
  expect(almRow((await workTab($)).rows)).toBe('ALM org-a / Alpha · id-a')
  options.workspaces = 'not a map' // valid JSON, no roots
  await clock.advance(30_000)
  expect(almRow((await workTab($)).rows)).toBeUndefined()
  // text that is not JSON at all: cut in the middle, as a half-written file is
  options.workspaces = { roots: [{ path: '/work', platform: 'azure-devops', org: 'org-a', project: 'Alpha', identity: 'id-a' }] }
  await clock.advance(30_000)
  expect(almRow((await workTab($)).rows)).toBe('ALM org-a / Alpha · id-a')
  options.workspacesRaw = '{ "roots": [ { "path": "/work", "org": '
  await clock.advance(30_000)
  expect(almRow((await workTab($)).rows)).toBeUndefined()
})

test('ALM line reads ALM unmapped in red when no root contains the cwd, and is absent without a map', async ($, on) => {
  world(on, { workspaces: { roots: [{ path: '/elsewhere', platform: 'github', org: 'o' }] } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const { root, rows } = await workTab($)
  expect(almRow(rows)).toBe('ALM unmapped')
  expect(colorOf(root, /^ALM unmapped$/)).toBe(RED)
})

test('no workspaces map: no ALM line at all', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(almRow((await workTab($)).rows)).toBeUndefined()
})

test('the other tabs draw the current sections: Subagents the agents, Work tasks and worklog warnings, System its own title', async ($, on) => {
  world(on, { hasWorklog: true })
  taskTools(on)
  spawns(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await spawnAgent($, 'code-reviewer')
  await $.tool.call({ tool: 'TodoWrite', todos: [todo('Working on it', 'in_progress')] })

  const agents = (await paneRows($, 50, 'agents')).rows
  expect(agents.some(r => /^◐ code-reviewer/.test(r))).toBe(true)
  expect(agents.some(r => /^TASK/.test(r) || /worklog/.test(r))).toBe(false)

  const work = (await paneRows($, 50, 'work')).rows
  expect(work.some(r => /^TASK · 0\/1/.test(r))).toBe(true)
  expect(work.some(r => /worklog: 1d to log/.test(r))).toBe(true)
  expect(work.some(r => /^SUBAGENTS/.test(r))).toBe(false)

  const system = (await paneRows($, 50, 'system')).rows
  expect(system).toContain('SYSTEM')
  expect(system).not.toContain('in arrivo')
  expect(system.some(r => /^SUBAGENTS/.test(r) || /^TASK/.test(r))).toBe(false)
})

// ── Phase 2 follow-ups ──

test('a workspaces.json that is not JSON draws no ALM line', async ($, on) => {
  world(on, { workspacesRaw: '{ "roots": [ { "path": "/work", "org": ' })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect((await paneRows($)).rows.some(r => /^ALM/.test(r))).toBe(false)
})

test('Work with no tasks, no worklog warnings and no git says nothing to show', async ($, on) => {
  world(on, { notRepo: true })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const { rows } = await paneRows($, 50, 'work')
  // the buttons row closes the pane, under a rule and the spacer
  expect(rows.at(-4)).toBe('nothing to show')
  expect(rows.some(r => /^TASK/.test(r) || /worklog/.test(r))).toBe(false)
})

test('MAIN: the perimeter, the session tasks and the worklog warnings are one block, in that order', async ($, on) => {
  world(on, { hasWorklog: true, branch: 'feat/x', perimeter: PERIMETER, changed: ['lib/z.ts'] })
  taskTools(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'TodoWrite', todos: [todo('Working on it', 'in_progress')] })
  const rows = await workRows($)
  const at = (re: RegExp) => rows.findIndex(r => re.test(r))
  const [main, perimeter, tasks, worklog] = [at(/^MAIN$/), at(/^deliver perimeter/), at(/^TASK ·/), at(/worklog: 1d to log/)]
  expect(main).toBeLessThan(perimeter)
  expect(perimeter).toBeLessThan(tasks)
  expect(tasks).toBeLessThan(worklog)
  // no rule inside the block
  expect(rows.slice(main, worklog).some(r => /^─+$/.test(r))).toBe(false)
  // and the tasks are not in the Subagents view
  expect((await paneRows($, 50, 'agents')).rows.some(r => /^TASK/.test(r))).toBe(false)
})

const claim = (n: number, rule: string, excerpt: string, session = 's-1') =>
  JSON.stringify({ at: new Date(2026, 9, 22, 8 + n, 5).toISOString(), session, cwd: '/w', rule, word: 'fatto', excerpt })

test('hook triggers: the last three blocks of done-claim.log that belong to this session, newest first, on the Insights tab', async ($, on) => {
  const doneClaims = [
    claim(1, 'unproven-row', 'primo'),
    claim(2, 'unproven-row', 'secondo'),
    claim(3, 'tail-cut', 'terzo'),
    claim(4, 'unproven-row', 'tutto fatto, test verdi'),
    claim(5, 'shell-ran', 'solo contato'),
    claim(6, 'tail-truncated', 'vecchio'),
    claim(7, 'unproven-row', 'altra sessione', 's-2'),
    '',
  ].join('\n')
  world(on, { doneClaims })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const rows = await insightsRows($)
  const i = rows.findIndex(r => r.startsWith('HOOK'))
  expect(rows[i]).toBe('HOOK · done-claim')
  expect(rows[i - 1]).toBe(' ')
  expect(rows[i - 2]).toMatch(/^─+$/)
  expect(rows[i + 1]).toBe(' ')
  expect(rows.slice(i + 2, i + 5)).toEqual([
    '22/10 12:05 unproven-row tutto fatto, test verdi',
    '22/10 11:05 tail-cut terzo',
    '22/10 10:05 unproven-row secondo',
  ])
  expect(rows.some(r => /primo|solo contato|vecchio|altra sessione/.test(r))).toBe(false)
  expect((await workRows($)).some(r => r.startsWith('HOOK'))).toBe(false)
})

test('hook triggers: the blocks of another session or no block at all draw nothing', async ($, on) => {
  world(on, { doneClaims: `${claim(1, 'unproven-row', 'altra', 's-2')}\n${claim(2, 'shell-ran', 'contato')}\n` })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect((await insightsRows($)).some(r => r.startsWith('HOOK'))).toBe(false)
})

test('hook triggers: no log (or an empty one) draws no block', async ($, on) => {
  world(on, { doneClaims: '' })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect((await insightsRows($)).some(r => r.startsWith('HOOK'))).toBe(false)
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
  expect((await insightsRows($)).some(r => /primo/.test(r))).toBe(true)

  mtime = 2 // same size, new time
  await clock.advance(30_000)
  expect(claimReads).toHaveLength(2)

  options.doneClaims = `${claim(1, 'unproven-row', 'primo')}\n${claim(2, 'unproven-row', 'secondo')}\n` // another size
  await clock.advance(30_000)
  expect(claimReads).toHaveLength(3)
  expect((await insightsRows($)).some(r => /secondo/.test(r))).toBe(true)
  await clock.advance(30_000)
  expect(claimReads).toHaveLength(3)
})
