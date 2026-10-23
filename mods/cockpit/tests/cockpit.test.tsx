import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const NOW = Date.parse('2026-10-22T10:00:00Z')
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString()

const PANE = {
  plugin: 'cockpit',
  component: 'Pane',
  requestId: 'cockpit',
  props: { title: 'cockpit', isFocused: false, bodyColumns: 50, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

/** The text of the pane's top-level rows, in order (an empty row reads ' '). */
const rowTexts = (root: unknown): string[] => {
  const text = (el: unknown): string => {
    if (typeof el === 'string') return el
    const o = el as { text?: string; children?: unknown[] } | null
    return o?.text ?? (o?.children ?? []).map(text).join('')
  }
  return ((root as { children?: unknown[] }).children ?? []).map(text)
}

/** The left margin of the drawn root: the column its content starts at. */
const marginOf = (root: unknown): number => (root as { props?: { marginLeft?: number } }).props?.marginLeft ?? 0

/** Lets what a hook left running (the unawaited flag write of a first render) settle. */
declare const setTimeout: (fn: () => void, ms: number) => unknown // the test runtime has it; the module's types do not
const settle = () => new Promise<void>(resolve => setTimeout(resolve, 0))

type World = {
  isPlaced?: boolean
  env?: Record<string, string>
  store?: Record<string, unknown>
  /** A session before its first response: no context measured, no cost. */
  isFresh?: boolean
  /** Receives the id of every pane the mod opens. */
  opened?: string[]
  /** Receives the `columns` of every pane the mod opens. */
  openedColumns?: (number | undefined)[]
  /** Receives the origin kind of every close the mod's hooks let through. */
  closed?: string[]
  /** A worklog snapshot with one pending day, as the worklog hook writes it. */
  hasWorklog?: boolean
  /** Receives every `$.fs.write`: the text by path, the last write winning. */
  writes?: Map<string, string>
  /** What `$.session.id()` answers (`s-1` when not given). */
  sessionId?: () => string
  /** Receives the path of every `$.fs.write`, one entry per write. */
  log?: string[]
}

/** The harness reports a path in the host's own spelling (backslashes on Windows): compared by its tail. */
const FLAG = /cockpit-s-1\.json$/

/** The world beneath the plugin: what the engine would answer to the calls the mod makes. */
function world(on: On, options: World = {}) {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on, options.store)
  mock.env(on, options.env ?? { CLAUDE_CONFIG_DIR: '/cfg' })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: options.sessionId?.() ?? 's-1' }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.cwd', () => ({ value: '/work/example-repo' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('settings.read', () => ({ value: { effortLevel: 'high' } }))
  on('session.usage', () => ({
    value: {
      startedAt: NOW,
      context: options.isFresh ? { window: 1_000_000 } : { window: 1_000_000, tokens: 248_000, percent: 25 },
      rateLimits: [
        { kind: 'five_hour', percentUsed: 38, resetsAt: iso((2 * 60 + 14) * 60000) },
        { kind: 'seven_day', percentUsed: 59, resetsAt: iso(0.46 * 604800 * 1000) },
      ],
      cost: { usd: options.isFresh ? 0 : 4.82 },
    },
  }))
  on('process.run', (_, e) => ({
    value: {
      exitCode: 0,
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false,
      stdout: e.argv.includes('rev-parse')
        ? '.git\n.git\n/work/example-repo\n'
        : '## feature/x\nM  a.ts\n M b.ts\n?? c.ts\n',
    },
  }))
  on('fs.read', () => ({
    value: options.hasWorklog ? JSON.stringify({ day: '2026-10-22', auditMtime: 5, pending: [{ date: '2026-10-20' }], underTarget: [] }) : '{}',
  }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 0, mtimeMs: options.hasWorklog ? 5 : 0, isLink: false } }))
  on('agent.list', () => ({ value: [] }))
  on('ui.open', (_, e) => {
    options.opened?.push(e.id)
    options.openedColumns?.push(e.columns)
    return { value: options.isPlaced === false ? { isPlaced: false, reason: 'too narrow (80 < 144)' } : { isPlaced: true } }
  })
  on('ui.close', (_, e) => {
    options.closed?.push(e.origin.kind)
    return { value: undefined }
  })
  on('fs.write', (_, e) => {
    options.writes?.set(e.path, e.text)
    options.log?.push(e.text)
    return { value: undefined }
  })
  return clock
}

/** The statusline's state file as last written, parsed. */
const flagOf = (writes: Map<string, string>): unknown => {
  const path = [...writes.keys()].find(k => FLAG.test(k))
  return JSON.parse((path && writes.get(path)) || 'null')
}

test('the pane shows header, context, credits and an agent that finished before its spawn was noted', async ($, on) => {
  world(on)
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'a1' }))
  on('turn.complete', () => ({ text: '' }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  // the agent's own events can outrun the spawn's bookkeeping: they must not be lost
  await $.turn.complete({
    answer: '',
    durationMs: 1,
    isAborted: false,
    turnId: 'a1-turn',
    agentId: 'a1',
    reason: 'answer',
    usage: { input_tokens: 30_000, output_tokens: 8_000, cache_read_input_tokens: 90_000, cache_creation_input_tokens: 0, model: 'm' },
  })
  await $.agent.spawn({
    tool_use_id: 't1',
    prompt: 'review',
    description: 'review',
    subagentType: 'code-reviewer',
    provider: { plugin: 'engine', tier: 'core' },
    model: 'fable',
    parentModel: 'claude-opus-5-5',
    background: true,
    fork: false,
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const text = async (re: RegExp) => (await ui.find({ type: 'Text', text: re }))?.text
    expect(await text(/Opus 5\.5/)).toContain('Opus 5.5')
    expect(await text(/example-repo/)).toContain('example-repo')
    expect(await text(/^\+1 ~1 \?1$/)).toBe('+1 ~1 ?1')
    expect(await text(/25% 248K\/1M/)).toBe('25% 248K/1M')
    expect(await text(/^5h/)).toContain('62% \u21bb 2h14m')
    expect(await text(/^7d/)).toContain('41%')
    expect(await text(/vs atteso/)).toBe('vs atteso 7d \u22125%')
    expect(await text(/code-reviewer/)).toContain('\u2713 code-reviewer')
    expect(await text(/code-reviewer/)).toContain('son 5.5')
    expect(await text(/code-reviewer/)).toContain('38k')
    expect(await text(/chiesto/)).toContain('chiesto fable \u2192 sonnet')
    expect(await text(/AGENTS/)).toBe('AGENTS \u00b7 0 in corso')
    await ui.unmount()
  }
})

test('there is no button of our own: the engine close is the only one', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Button' })).toBeUndefined()
  await ui.unmount()
})

test('the cost is shown at zero and the context reads 0% 0/1M before the first response', async ($, on) => {
  world(on, { isFresh: true })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const text = async (re: RegExp) => (await ui.find({ type: 'Text', text: re }))?.text
  expect(await text(/^\$0\.00$/)).toBe('$0.00')
  expect(await text(/^0% /)).toBe('0% 0/1M')
  await ui.unmount()
})

test('empty rows separate the sections, each title from its rows and the 5h bar from the 7d bar', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const rows = rowTexts(await ui.drawn())
  const at = (re: RegExp) => rows.findIndex(r => re.test(r))
  for (const title of [/^CONTESTO/, /^CREDITI RESIDUI/, /^AGENTS/]) {
    const i = at(title)
    expect(i).toBeGreaterThan(1)
    expect(rows[i - 1]).toBe(' ')
    expect(rows[i - 2]).toMatch(/^\u2500+$/)
  }
  expect(rows[at(/^CONTESTO/) + 1]).toBe(' ')
  expect(rows[at(/^CREDITI RESIDUI/) + 1]).toBe(' ')
  await ui.unmount()
})

test('the context section is the bar and its readout, then the rule: no session-share line', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const rows = rowTexts(await ui.drawn())
  const title = rows.findIndex(r => /^CONTESTO/.test(r))
  expect(rows[title + 1]).toBe(' ')
  expect(rows[title + 2]).toMatch(/25% 248K\/1M/)
  expect(rows[title + 3]).toMatch(/^─+$/)
  expect(rows.some(r => /sessione/.test(r))).toBe(false)
  await ui.unmount()
})

test('the pane opens 60 columns wide; in a wider dock its content stops at 60 and the empty space is on the left', async ($, on) => {
  const openedColumns: (number | undefined)[] = []
  world(on, { openedColumns })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'cockpit', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 80 } })
  expect(openedColumns).toEqual([60])

  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 90 }, surface: 'terminal' })
  const root = await ui.drawn()
  const rules = rowTexts(root).filter(r => /^─+$/.test(r))
  expect(rules.length).toBeGreaterThan(0)
  for (const r of rules) expect([...r].length).toBe(60)
  // the 60-column block is pushed right: it starts at column 30 of 90
  expect(marginOf(root)).toBe(30)
  await ui.unmount()

  const narrow = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 50 }, surface: 'terminal' })
  const narrowRoot = await narrow.drawn()
  for (const r of rowTexts(narrowRoot).filter(r => /^─+$/.test(r))) expect([...r].length).toBe(50)
  expect(marginOf(narrowRoot)).toBe(0)
  await narrow.unmount()
})

test('the pane is not opened at session start', async ($, on) => {
  const opened: string[] = []
  world(on, { opened })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await settle()
  expect(opened).toEqual([])
})

test('the state file is written at session start with open:false and the session data', async ($, on) => {
  const writes = new Map<string, string>()
  world(on, { writes })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(flagOf(writes)).toEqual({
    open: false,
    at: NOW,
    lastTurnUsd: null,
    agents: { running: 0, modelWarnings: 0 },
    effort: 'high',
    tasks: null,
  })
  expect(Object.keys(flagOf(writes) as object)).toEqual(['open', 'at', 'lastTurnUsd', 'agents', 'effort', 'tasks'])
})

const CLOSED = { open: false, at: NOW, lastTurnUsd: null, agents: { running: 0, modelWarnings: 0 }, effort: null, tasks: null }

test('session.end leaves the ENDING session file closed and empty, not the current one', async ($, on) => {
  const writes = new Map<string, string>()
  // $.session.id() already answers the new id (a /clear): the file written is the one `e.sessionId` names.
  world(on, { writes, sessionId: () => 's-2' })
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.end({ reason: 'clear', sessionId: 's-1', resume: { id: 's-1' } })
  expect(flagOf(writes)).toEqual(CLOSED)
})

test('session.end with the pane open still writes open:false for the ending session', async ($, on) => {
  const writes = new Map<string, string>()
  world(on, { writes, sessionId: () => 's-2' })
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'cockpit', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 80 } })
  const current = [...writes.keys()].find(k => /cockpit-s-2\.json$/.test(k))
  expect(JSON.parse(writes.get(current ?? '') ?? 'null')).toMatchObject({ open: true })
  await $.session.end({ reason: 'prompt_input_exit', sessionId: 's-1', resume: { id: 's-1' } })
  expect(flagOf(writes)).toEqual(CLOSED)
})

test('a new session id (/clear) gets its own file, even with the same content', async ($, on) => {
  const writes = new Map<string, string>()
  let id = 's-1'
  world(on, { writes, sessionId: () => id })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  id = 's-2'
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect([...writes.keys()].map(k => k.replace(/^.*(cockpit-s-\d\.json)$/, '$1')).sort()).toEqual(['cockpit-s-1.json', 'cockpit-s-2.json'])
})

test('a session id the statusline would not accept writes nothing', async ($, on) => {
  const writes = new Map<string, string>()
  world(on, { writes, sessionId: () => '../x' })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(writes.size).toBe(0)
})

test('/cockpit opens the pane and the state file says open:true', async ($, on) => {
  const opened: string[] = []
  const writes = new Map<string, string>()
  world(on, { opened, writes })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(flagOf(writes)).toMatchObject({ open: false })

  const ran = await $.command.run({ command: 'cockpit', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 80 } })
  expect(ran.text).toBe('cockpit aperto')
  expect(opened).toEqual(['cockpit'])
  expect(flagOf(writes)).toMatchObject({ open: true })
})

test('while the pane is open the tick rewrites the state file with a fresh at; closed, it writes nothing', async ($, on) => {
  const writes = new Map<string, string>()
  const log: string[] = []
  const clock = world(on, { writes, log })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const afterStart = log.length
  await clock.advance(15_000)
  expect(log.length).toBe(afterStart)

  await $.command.run({ command: 'cockpit', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 80 } })
  const openedAt = (flagOf(writes) as { at: number }).at
  await clock.advance(15_000)
  const heartbeat = flagOf(writes) as { open: boolean; at: number }
  expect(heartbeat.open).toBe(true)
  expect(heartbeat.at).toBeGreaterThanOrEqual(openedAt + 15_000)
})

test('a pane that cannot be placed is reported with open:false, and its first render says open:true', async ($, on) => {
  const writes = new Map<string, string>()
  const clock = world(on, { isPlaced: false, writes })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ran = await $.command.run({ command: 'cockpit', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  expect(ran.text).toBe('cockpit in attesa: too narrow (80 < 144)')
  expect(flagOf(writes)).toMatchObject({ open: false })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await clock.settle()
  expect(flagOf(writes)).toMatchObject({ open: true })
  await ui.unmount()
})

test('the state file follows the last turn cost and the agent counts, at most once per few seconds, never unchanged', async ($, on) => {
  const writes = new Map<string, string>()
  const log: string[] = []
  const clock = world(on, { writes, log })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'a1' }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const atStart = log.length
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.agent.spawn({
    tool_use_id: 't1',
    prompt: 'review',
    description: 'review',
    subagentType: 'code-reviewer',
    provider: { plugin: 'engine', tier: 'core' },
    model: 'fable',
    parentModel: 'claude-opus-5-5',
    background: true,
    fork: false,
  })
  await $.session.measure({
    context: { window: 1_000_000, tokens: 260_000, percent: 26 },
    rateLimits: [],
    cost: { usd: 5.2 },
    changed: ['context', 'cost'],
  })
  // inside the window: held back
  expect(log.length).toBe(atStart)
  expect(flagOf(writes)).toMatchObject({ lastTurnUsd: null })

  await clock.advance(3000)
  expect(flagOf(writes)).toMatchObject({
    open: false,
    at: NOW + 3000,
    lastTurnUsd: 0.38,
    agents: { running: 1, modelWarnings: 1 },
    effort: 'high',
    tasks: null,
  })
  const afterFlush = log.length

  // nothing changed: a later moment writes nothing
  await clock.advance(2000)
  expect(log.length).toBe(afterFlush)
})

test('deltas count from the turn start', async ($, on) => {
  world(on)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('session.measure', (_, e) => ({ changed: e.changed }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.session.measure({
    context: { window: 1_000_000, tokens: 260_000, percent: 26 },
    rateLimits: [],
    cost: { usd: 5.2 },
    changed: ['context', 'cost'],
  })
  await $.turn.complete({
    answer: '',
    durationMs: 1,
    isAborted: false,
    turnId: 't1',
    reason: 'answer',
    usage: { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 199_900, cache_creation_input_tokens: 0, model: 'm' },
  })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const text = async (re: RegExp) => (await ui.find({ type: 'Text', text: re }))?.text
  expect(await text(/^\$5\.20/)).toContain('$5.20')
  expect(await text(/^\+0\.38/)).toBe('+0.38')
  expect(await text(/^26% /)).toBe('26% 260K/1M +12K')
  await ui.unmount()
})

// ── Tasks ──

type Todo = { content: string; status: 'pending' | 'in_progress' | 'completed'; activeForm: string }
const todo = (content: string, status: Todo['status']): Todo => ({ content, status, activeForm: content })

/** The tools beneath the mod: TaskCreate answers with the next id, the others with their plain result. */
function taskTools(on: On) {
  let n = 0
  on('tool.call', { tool: 'TaskCreate' }, (_, e) => ({ result: { task: { id: String(++n), subject: e.subject } } }))
  on('tool.call', { tool: 'TaskUpdate' }, (_, e) => ({ result: { success: true, taskId: e.taskId, updatedFields: ['status'] } }))
  on('tool.call', { tool: 'TodoWrite' }, (_, e) => ({ result: { oldTodos: [], newTodos: e.todos } }))
}

const createTask = ($: Engine, subject: string, agentId?: string) =>
  $.tool.call({ tool: 'TaskCreate', subject, description: subject, ...(agentId ? { agentId } : {}) })
const updateTask = ($: Engine, taskId: string, status: 'pending' | 'in_progress' | 'completed' | 'deleted') =>
  $.tool.call({ tool: 'TaskUpdate', taskId, status })

async function taskRows($: Engine, bodyColumns = 50) {
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns }, surface: 'terminal' })
  const rows = rowTexts(await ui.drawn())
  await ui.unmount()
  const i = rows.findIndex(r => /^TASK/.test(r))
  return { rows, i }
}

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
  expect(rows[i - 2]).toMatch(/^─+$/)
  expect(rows[i + 1]).toBe(' ')
  expect(rows[i + 2]).toMatch(/^[▰▱]{50}$/)
  // in progress first, with its elapsed time; then pending; then the completed row
  expect(rows[i + 3]).toMatch(/^◐ Working on it +2m00s$/)
  expect(rows[i + 4]).toMatch(/^○ Pending one +$/)
  expect(rows[i + 5]).toBe('✓ 2 completati')
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
  expect(rows[i + 4]).toBe('✓ 1 completati')
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

test('a TaskUpdate that answers success:false changes nothing', async ($, on) => {
  world(on)
  on('tool.call', { tool: 'TaskCreate' }, (_, e) => ({ result: { task: { id: '1', subject: e.subject } } }))
  on('tool.call', { tool: 'TaskUpdate' }, (_, e) => ({ result: { success: false, taskId: e.taskId, updatedFields: [], error: 'no such task' } }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await createTask($, 'Only one')
  await updateTask($, '1', 'completed')
  await updateTask($, '2', 'in_progress')
  const { rows, i } = await taskRows($)
  expect(rows[i]).toMatch(/^TASK · 0\/1◐ 0 {2}○ 1 {2}✓ 0$/)
})

test('the section is omitted with no tasks, and the state file says tasks:null', async ($, on) => {
  const writes = new Map<string, string>()
  world(on, { writes })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const { rows, i } = await taskRows($)
  expect(i).toBe(-1)
  expect(rows.some(r => /completati/.test(r))).toBe(false)
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
  expect([...(rows[i + 3] ?? '')].length).toBe(40)
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
