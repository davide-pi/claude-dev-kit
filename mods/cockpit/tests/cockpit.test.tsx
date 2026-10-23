import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { AgentStatus, On } from 'claude-code'

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
  /** True: every `$.fs.write` fails, as one the exit's short budget cuts off. Read at every call. */
  failWrites?: () => boolean
  /** Receives the path of every `$.fs.write`, one entry per write. */
  log?: string[]
  /** The rate-limit windows `$.session.usage()` answers (a 5h and a 7d one when not given). */
  rateLimits?: { kind: string; percentUsed: number; resetsAt?: string }[]
  /** The text of `<config>/workspaces.json`; absent, the file answers an empty map. */
  workspaces?: unknown
  /** The raw text of `<config>/workspaces.json`, answered as is (a malformed file): wins over `workspaces`. */
  workspacesRaw?: string
  /** True: reading `<config>/workspaces.json` fails (no such file), whatever `workspaces` says. Read at every call. */
  workspacesFail?: boolean
  /** The text of this session's state file, as an earlier run left it. */
  stateFile?: string
  /** True: every git command fails, as in a folder that is not a repository. */
  notRepo?: boolean
  /** True: git is on a detached HEAD (`## HEAD (no branch)`). */
  detached?: boolean
  /** The agents `$.agent.list()` answers, read at every call (none when not given). */
  listed?: { id: string; status: AgentStatus }[]
  /** Receives the `agentId` of every `$.ui.view`. */
  viewed?: (string | undefined)[]
  /** The context fill `$.session.usage()` answers (25 when not given). */
  ctxPercent?: number
  /** Receives `session.compact`, in order. */
  calls?: string[]
  /** Receives the `instructions` of every `session.compact`. */
  instructions?: (string | undefined)[]
  /** Receives the line of every `command.run` (`/<command> <args>`). */
  commands?: string[]
  /** The text of this branch's deliver perimeter file (`<git-dir>/deliver/perimeter.md`). */
  perimeter?: string
  /** The branch `git status` reports (`feature/x` when not given). */
  branch?: string
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
      context: options.isFresh ? { window: 1_000_000 } : { window: 1_000_000, tokens: 248_000, percent: options.ctxPercent ?? 25 },
      rateLimits: options.rateLimits ?? [
        { kind: 'five_hour', percentUsed: 38, resetsAt: iso((2 * 60 + 14) * 60000) },
        { kind: 'seven_day', percentUsed: 59, resetsAt: iso(0.46 * 604800 * 1000) },
      ],
      cost: { usd: options.isFresh ? 0 : 4.82 },
    },
  }))
  on('process.run', (_, e) => ({
    value: {
      exitCode: options.notRepo ? 128 : 0,
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false,
      stdout: options.notRepo
        ? ''
        : e.argv.includes('rev-parse')
        ? '.git\n.git\n/work/example-repo\n'
        : `## ${options.detached ? 'HEAD (no branch)' : (options.branch ?? 'feature/x')}\nM  a.ts\n M b.ts\n?? c.ts\n`,
    },
  }))
  on('fs.read', (_, e) => {
    if (e.path.endsWith('workspaces.json')) {
      if (options.workspacesFail) throw new Error('ENOENT: no such file')
      return { value: options.workspacesRaw ?? JSON.stringify(options.workspaces ?? {}) }
    }
    if (FLAG.test(e.path) && options.stateFile !== undefined) return { value: options.stateFile }
    if (options.perimeter !== undefined && /deliver[\\/]perimeter\.md$/.test(e.path)) return { value: options.perimeter }
    return {
      value: options.hasWorklog ? JSON.stringify({ day: '2026-10-22', auditMtime: 5, pending: [{ date: '2026-10-20' }], underTarget: [] }) : '{}',
    }
  })
  on('fs.stat', () => ({ value: { kind: 'file', size: 0, mtimeMs: options.hasWorklog ? 5 : 0, isLink: false } }))
  on('agent.list', () => ({ value: (options.listed ?? []).map(l => ({ ...l, description: 'go', type: 'code-reviewer' })) }))
  on('ui.view', (_, e) => {
    options.viewed?.push(e.agentId)
    return { value: {} }
  })
  on('ui.open', (_, e) => {
    options.opened?.push(e.id)
    options.openedColumns?.push(e.columns)
    return { value: options.isPlaced === false ? { isPlaced: false, reason: 'too narrow (80 < 144)' } : { isPlaced: true } }
  })
  on('ui.close', (_, e) => {
    options.closed?.push(e.origin.kind)
    return { value: undefined }
  })
  on('session.compact', (_, e) => {
    options.calls?.push('compact')
    options.instructions?.push(e.instructions)
    return { skip: 'test' }
  })
  on('command.run', { command: 'worklog' }, (_, e) => {
    options.commands?.push(`/${e.command} ${e.args}`)
    return { text: 'ok' }
  })
  on('fs.write', (_, e) => {
    if (options.failWrites?.()) throw new Error('timed out')
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
    expect(await text(/25% 248K\/1M/)).toBe(' 25% 248K/1M')
    expect(await text(/^ 62% 5h/)).toMatch(/^ 62% 5h \u21bb 2h14m \(\d\d:\d\d\)$/)
    expect(await text(/^ 41% 7d/)).toMatch(/^ 41% 7d \u21bb 3d\dh \((dom|lun|mar|mer|gio|ven|sab) \d\d:\d\d\)$/)
    expect(await text(/vs atteso/)).toBe('vs atteso 7d  \u22125%')
    expect(await text(/AGENTS/)).toBe('AGENTS \u00b7 0 in corso')
    // the Sessione view lists running agents only; the finished one is in the Agenti tab
    expect(await ui.find({ key: 'agent:a1' })).toBeUndefined()
    await ui.press({ key: 'tab:agents' })
    // the row is one pressable Button: its text is the whole row
    const row = (await ui.find({ key: 'agent:a1' }))?.text
    expect(row).toContain('\u2713 code-reviewer')
    expect(row).toContain('son 5.5')
    expect(row).toContain('38k')
    expect(await text(/chiesto/)).toContain('chiesto fable \u2192 sonnet')
    expect(await text(/AGENTS/)).toBe('AGENTS \u00b7 0 in corso')
    await ui.press({ key: 'tab:session' })
    await ui.unmount()
  }
})

test('the pane has no close button of its own: the tab bar and the buttons row are its only buttons', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const keys = (await ui.findAll({ type: 'Button' })).map(b => b.key)
  expect(keys).toEqual(['tab:session', 'tab:agents', 'tab:work', 'tab:repo', 'bar:compact', 'bar:worklog'])
  await ui.unmount()
})

test('the cost is shown at zero and the context reads 0% 0/1M before the first response', async ($, on) => {
  world(on, { isFresh: true })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const text = async (re: RegExp) => (await ui.find({ type: 'Text', text: re }))?.text
  expect(await text(/^\$0\.00$/)).toBe('$0.00')
  expect(await text(/^ {2}0% /)).toBe('  0% 0/1M')
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
    tab: 'session',
    history: [],
  })
  expect(Object.keys(flagOf(writes) as object)).toEqual(['open', 'at', 'lastTurnUsd', 'agents', 'effort', 'tasks', 'tab', 'history'])
})

const CLOSED = { open: false, at: NOW, lastTurnUsd: null, agents: { running: 0, modelWarnings: 0 }, effort: null, tasks: null, tab: 'session', history: [] }

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
    tab: 'session',
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
  expect(await text(/^ 26% /)).toBe(' 26% 260K/1M +12K')
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
  await ui.press({ key: 'tab:work' })
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

// ── Credits, cache share, ALM ──

/** The color of the first leaf Text whose content matches `re`. */
const colorOf = (root: unknown, re: RegExp): string | undefined => {
  const o = root as { props?: { color?: string }; children?: unknown[] } | null
  const [only] = o?.children ?? []
  if (typeof only === 'string' && re.test(only)) return o?.props?.color
  for (const c of o?.children ?? []) {
    const found = colorOf(c, re)
    if (found !== undefined) return found
  }
  return undefined
}

const GREEN = '#7ec699'
const RED = '#f07a6f'
const MIN = 60_000

/** The pane's rows with the tab pressed first (the one the mod state already holds when none is given). */
async function paneRows($: Engine, bodyColumns = 50, tab?: string) {
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns }, surface: 'terminal' })
  if (tab) await ui.press({ key: `tab:${tab}` })
  const root = await ui.drawn()
  await ui.unmount()
  return { root, rows: rowTexts(root) }
}

test('percentages are right-aligned: 87% and 7% start their label in the same column, context included', async ($, on) => {
  world(on, {
    rateLimits: [
      { kind: 'five_hour', percentUsed: 13, resetsAt: iso(2 * 60 * MIN) },
      { kind: 'seven_day', percentUsed: 93, resetsAt: iso(2 * 24 * 60 * MIN) },
    ],
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const { rows } = await paneRows($)
  const five = rows.find(r => /87% 5h/.test(r))
  const seven = rows.find(r => /7% 7d/.test(r))
  const context = rows.find(r => /25% 248K/.test(r))
  expect(five).toMatch(/^[▰▱]+ 87% 5h/)
  expect(seven).toMatch(/^[▰▱]+ {2}7% 7d/)
  expect(seven?.indexOf('%')).toBe(five?.indexOf('%'))
  expect(context?.indexOf('%')).toBe(five?.indexOf('%'))
})

test('percentages are right-aligned with three digits too: 100% and 87% start their label in the same column', async ($, on) => {
  world(on, {
    rateLimits: [
      { kind: 'five_hour', percentUsed: 0, resetsAt: iso(5 * 60 * MIN) },
      { kind: 'seven_day', percentUsed: 13, resetsAt: iso(2 * 24 * 60 * MIN) },
    ],
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const { rows } = await paneRows($)
  const five = rows.find(r => /100% 5h/.test(r))
  const seven = rows.find(r => /87% 7d/.test(r))
  expect(five).toMatch(/^[▰▱]+100% 5h/)
  expect(seven).toMatch(/^[▰▱]+ 87% 7d/)
  expect(seven?.indexOf('%')).toBe(five?.indexOf('%'))
})

test('burn rate: under the 5h row, green when the credits last to the reset, red when they run out before it', async ($, on) => {
  const clock = world(on)
  on('session.measure', (_, e) => ({ changed: e.changed }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect((await paneRows($)).rows.some(r => /finisce/.test(r))).toBe(false) // one reading: no rate yet
  await clock.advance(15 * MIN)
  const measure = (used: number) =>
    $.session.measure({
      context: { window: 1_000_000, tokens: 260_000, percent: 26 },
      rateLimits: [
        { kind: 'five_hour', percentUsed: used, resetsAt: iso(2 * 60 * MIN) },
        { kind: 'seven_day', percentUsed: 59, resetsAt: iso(0.46 * 604800 * 1000) },
      ],
      cost: { usd: 5.2 },
      changed: ['rateLimits'],
    })

  await measure(41) // 3 points in 15 min = 12 %/h; 59 left lasts 4h55, the reset is in 1h45
  let { root, rows } = await paneRows($)
  const five = rows.findIndex(r => /59% 5h/.test(r))
  expect(rows[five + 1]).toBe('−12%/h · finisce tra 4h55: arrivi al reset')
  expect(colorOf(root, /finisce/)).toBe(GREEN)

  await measure(50) // 12 points in 15 min = 48 %/h; 50 left lasts 1h02, before the reset
  ;({ root, rows } = await paneRows($))
  expect(rows[rows.findIndex(r => /50% 5h/.test(r)) + 1]).toBe('−48%/h · finisce tra 1h02, prima del reset')
  expect(colorOf(root, /finisce/)).toBe(RED)
})

test('burn rate: no line with under 10 minutes of readings', async ($, on) => {
  const clock = world(on)
  on('session.measure', (_, e) => ({ changed: e.changed }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(5 * MIN)
  await $.session.measure({
    context: { window: 1_000_000, tokens: 260_000, percent: 26 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 60, resetsAt: iso(2 * 60 * MIN) }],
    cost: { usd: 5.2 },
    changed: ['rateLimits'],
  })
  expect((await paneRows($)).rows.some(r => /finisce/.test(r))).toBe(false)
})

test('cache share: the last main-loop turn, right of CONTESTO; a subagent turn and an empty one do not set it', async ($, on) => {
  world(on)
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const complete = (usage: { input: number; read: number; write: number }, agentId?: string) =>
    $.turn.complete({
      answer: '',
      durationMs: 1,
      isAborted: false,
      turnId: 't',
      reason: 'answer',
      ...(agentId ? { agentId } : {}),
      usage: {
        input_tokens: usage.input,
        output_tokens: 7,
        cache_read_input_tokens: usage.read,
        cache_creation_input_tokens: usage.write,
        model: 'm',
      },
    })
  const title = async () => (await paneRows($)).rows.find(r => /^CONTESTO/.test(r))

  expect(await title()).toBe('CONTESTO')
  await complete({ input: 600, read: 94_000, write: 5_400 }, 'a1')
  expect(await title()).toBe('CONTESTO')
  await complete({ input: 0, read: 0, write: 0 })
  expect(await title()).toBe('CONTESTO')
  await complete({ input: 600, read: 94_000, write: 5_400 })
  expect(await title()).toBe('CONTESTOcache  94%')
  await complete({ input: 9_000, read: 500, write: 500 })
  expect(await title()).toBe('CONTESTOcache   5%')
})

/** The row under the folder row: where the ALM line sits. */
const belowFolder = (rows: string[]): string | undefined => rows[rows.findIndex(r => /example-repo/.test(r)) + 1]

test('ALM line under the folder row: org / project and identity, resolved for the cwd', async ($, on) => {
  world(on, { workspaces: { roots: [{ path: '/work', platform: 'azure-devops', org: 'org-a', project: 'Alpha', identity: 'id-a' }] } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const { rows } = await paneRows($)
  expect(belowFolder(rows)).toBe('ALM org-a / Alpha · id-a')
})

test('ALM line: a mapped root with no org, project or identity draws no line', async ($, on) => {
  world(on, { workspaces: { roots: [{ path: '/work', platform: 'github' }] } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const { rows } = await paneRows($)
  expect(rows.some(r => /^ALM/.test(r))).toBe(false)
})

test('ALM line is cut in the middle to the pane width', async ($, on) => {
  const project = 'A-very-long-project-name-that-cannot-fit-in-a-narrow-pane'
  world(on, { workspaces: { roots: [{ path: '/work', platform: 'azure-devops', org: 'org-a', project, identity: 'id-a' }] } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const row = (await paneRows($, 40)).rows.find(r => /^ALM/.test(r))
  expect([...(row ?? '')].length).toBe(40)
  expect(row).toMatch(/^ALM org-a.*….*id-a$/)
})

test('a workspaces.json that goes missing clears the ALM line; a malformed one too', async ($, on) => {
  const options: World = { workspaces: { roots: [{ path: '/work', platform: 'azure-devops', org: 'org-a', project: 'Alpha', identity: 'id-a' }] } }
  const clock = world(on, options)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(belowFolder((await paneRows($)).rows)).toBe('ALM org-a / Alpha · id-a')
  options.workspacesFail = true
  await clock.advance(15_000)
  expect((await paneRows($)).rows.some(r => /^ALM/.test(r))).toBe(false)
  options.workspacesFail = false
  await clock.advance(15_000)
  expect(belowFolder((await paneRows($)).rows)).toBe('ALM org-a / Alpha · id-a')
  options.workspaces = 'not a map' // valid JSON, no roots
  await clock.advance(15_000)
  expect((await paneRows($)).rows.some(r => /^ALM/.test(r))).toBe(false)
  // text that is not JSON at all: cut in the middle, as a half-written file is
  options.workspaces = { roots: [{ path: '/work', platform: 'azure-devops', org: 'org-a', project: 'Alpha', identity: 'id-a' }] }
  await clock.advance(15_000)
  expect(belowFolder((await paneRows($)).rows)).toBe('ALM org-a / Alpha · id-a')
  options.workspacesRaw = '{ "roots": [ { "path": "/work", "org": '
  await clock.advance(15_000)
  expect((await paneRows($)).rows.some(r => /^ALM/.test(r))).toBe(false)
})

test('ALM line reads ALM non mappato in red when no root contains the cwd, and is absent without a map', async ($, on) => {
  world(on, { workspaces: { roots: [{ path: '/elsewhere', platform: 'github', org: 'o' }] } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const { root, rows } = await paneRows($)
  expect(belowFolder(rows)).toBe('ALM non mappato')
  expect(colorOf(root, /^ALM non mappato$/)).toBe(RED)
})

test('no workspaces map: no ALM line at all', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect((await paneRows($)).rows.some(r => /^ALM/.test(r))).toBe(false)
})

// ── Tabs ──

const spawnAgent = ($: Engine, subagentType: string) =>
  $.agent.spawn({
    tool_use_id: `t-${subagentType}`,
    prompt: 'go',
    description: 'go',
    subagentType,
    provider: { plugin: 'engine', tier: 'core' },
    model: 'sonnet',
    parentModel: 'claude-opus-5-5',
    background: true,
    fork: false,
  })

/** `agent.spawn` that answers a new agent id each time: `a1`, `a2`, ... */
function spawns(on: On) {
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: `a${++n}` }))
}

test('tab bar: four buttons, Sessione selected by default; a press on Agenti draws the Agenti view', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const tabs = async () => (await ui.findAll({ type: 'Button' })).filter(b => /^tab:/.test(b.key ?? ''))
  expect((await tabs()).map(b => b.text)).toEqual(['Sessione', 'Agenti', 'Lavoro', 'Repo'])
  const selected = async () => (await tabs()).filter(b => b.props.variant === 'primary').map(b => b.key)
  expect(await selected()).toEqual(['tab:session'])
  expect(await ui.find({ type: 'Text', text: /^CONTESTO/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^AGENTS/ })).toBeDefined()

  await ui.press({ key: 'tab:agents' })
  expect(await selected()).toEqual(['tab:agents'])
  expect(await ui.find({ type: 'Text', text: /^AGENTS/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^CONTESTO/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^CREDITI/ })).toBeUndefined()

  await ui.press({ key: 'tab:session' })
  expect(await ui.find({ type: 'Text', text: /^CONTESTO/ })).toBeDefined()
  await ui.unmount()
})

test('tab labels: Agenti counts the running agents, Lavoro carries a dot when the worklog needs attention', async ($, on) => {
  world(on, { hasWorklog: true })
  spawns(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await spawnAgent($, 'code-reviewer')
  await spawnAgent($, 'implementer')
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ key: 'tab:agents' }))?.text).toBe('Agenti 2')
  expect((await ui.find({ key: 'tab:work' }))?.text).toBe('Lavoro ●')
  expect((await ui.find({ key: 'tab:repo' }))?.text).toBe('Repo')
  await ui.unmount()
})

test('tab labels without agents or warnings are the bare names', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.findAll({ type: 'Button' })).filter(b => /^tab:/.test(b.key ?? '')).map(b => b.text)).toEqual(['Sessione', 'Agenti', 'Lavoro', 'Repo'])
  await ui.unmount()
})

test('the other tabs draw the current sections: Agenti the agents, Lavoro tasks and worklog warnings, Repo the git grid', async ($, on) => {
  world(on, { hasWorklog: true })
  taskTools(on)
  spawns(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await spawnAgent($, 'code-reviewer')
  await $.tool.call({ tool: 'TodoWrite', todos: [todo('Working on it', 'in_progress')] })

  const agents = (await paneRows($, 50, 'agents')).rows
  expect(agents.some(r => /^◐ code-reviewer/.test(r))).toBe(true)
  expect(agents.some(r => /^TASK/.test(r) || /worklog/.test(r) || /^CONTESTO/.test(r))).toBe(false)

  const work = (await paneRows($, 50, 'work')).rows
  expect(work.some(r => /^TASK · 0\/1/.test(r))).toBe(true)
  expect(work.some(r => /worklog: 1d da registrare/.test(r))).toBe(true)
  expect(work.some(r => /^AGENTS/.test(r) || /^CONTESTO/.test(r))).toBe(false)

  const repo = (await paneRows($, 50, 'repo')).rows
  expect(repo.some(r => /example-repo/.test(r) && /feature\/x/.test(r) && /\+1 ~1 \?1/.test(r))).toBe(true)
  expect(repo.some(r => /^AGENTS/.test(r) || /^TASK/.test(r) || /^CONTESTO/.test(r))).toBe(false)
})

test('the selected tab is written in the state file', async ($, on) => {
  const writes = new Map<string, string>()
  const clock = world(on, { writes })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await paneRows($, 50, 'repo')
  await clock.advance(3000)
  expect(flagOf(writes)).toMatchObject({ tab: 'repo' })
})

test('a state file left by an earlier run brings its tab back', async ($, on) => {
  world(on, { stateFile: JSON.stringify({ open: false, tab: 'repo' }) })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const { rows } = await paneRows($)
  expect(rows.some(r => /^CONTESTO/.test(r))).toBe(false)
  expect(rows.some(r => /feature\/x/.test(r))).toBe(true)
})

test('an unknown tab in the state file is ignored', async ($, on) => {
  world(on, { stateFile: JSON.stringify({ open: false, tab: 'nope' }) })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect((await paneRows($)).rows.some(r => /^CONTESTO/.test(r))).toBe(true)
})

test('a state file that is not JSON is ignored', async ($, on) => {
  world(on, { stateFile: 'not json' })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect((await paneRows($)).rows.some(r => /^CONTESTO/.test(r))).toBe(true)
})

test('session.end keeps the tab in the closed file, so a resume finds it', async ($, on) => {
  const writes = new Map<string, string>()
  world(on, { writes })
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await paneRows($, 50, 'work')
  await $.session.end({ reason: 'clear', sessionId: 's-1', resume: { id: 's-1' } })
  expect(flagOf(writes)).toEqual({ ...CLOSED, tab: 'work' })
})

// ── Sessione view ──

test('Sessione: the context line at 80% or more is red, with no button of its own', async ($, on) => {
  world(on, { ctxPercent: 87 })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^⚠ contesto al 87%$/ })).toBeDefined()
  expect(colorOf(await ui.drawn(), /^⚠ contesto al 87%$/)).toBe(RED)
  expect(await ui.find({ key: 'compact-now' })).toBeUndefined()
  expect((await ui.findAll({ type: 'Button' })).some(b => /compatta ora/.test(b.text ?? ''))).toBe(false)
  await ui.unmount()
})

test('Sessione: below 80% there is no warning; 80% exactly has it', async ($, on) => {
  const clock = world(on, { ctxPercent: 79 })
  on('session.measure', (_, e) => ({ changed: e.changed }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  let ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^⚠/ })).toBeUndefined()
  await ui.unmount()
  await clock.advance(1)
  await $.session.measure({ context: { window: 1_000_000, tokens: 800_000, percent: 80 }, rateLimits: [], cost: { usd: 5 }, changed: ['context'] })
  ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^⚠ contesto al 80%$/ })).toBeDefined()
  await ui.unmount()
})

// ── Buttons row: compatta and segna ore, the last row of every tab ──

test('buttons row: compatta compacts with the instructions, segna ore submits the scoped /worklog', async ($, on) => {
  const calls: string[] = []
  const instructions: (string | undefined)[] = []
  const commands: string[] = []
  world(on, { calls, instructions, commands, branch: 'feature/1234-orders' })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ key: 'bar:compact' }))?.text).toBe('compatta')
  expect((await ui.find({ key: 'bar:worklog' }))?.text).toBe('segna ore')
  // the quick row's buttons are gone
  for (const key of ['quick:compact', 'quick:worklog', 'quick:branch']) expect(await ui.find({ key })).toBeUndefined()

  await ui.press({ key: 'bar:compact' })
  expect(calls).toEqual(['compact'])
  expect(instructions).toEqual([KEEP_DROP])
  expect(commands).toEqual([])
  await ui.press({ key: 'bar:worklog' })
  expect(commands).toEqual(['/worklog oggi AB#1234'])
  expect(calls).toEqual(['compact'])
  await ui.unmount()
})

const KEEP_DROP =
  "Tieni: task in corso, decisioni prese con l'utente e il loro perché, domande aperte, file toccati e stato, comandi con la riga di output che decide, prossimi passi. Butta: output di tool già riassunti, tentativi superati."

test('buttons row: the instructions name the open tasks and the active deliver perimeter of the branch', async ($, on) => {
  const instructions: (string | undefined)[] = []
  world(on, {
    instructions,
    branch: 'feat/x',
    perimeter: 'branch: feat/x\nstatus: active\n- src/a.ts\n- src/b/\n',
  })
  taskTools(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'TodoWrite', todos: [todo('Scrivere i test', 'in_progress'), todo('Poi il codice', 'pending'), todo('Fatto', 'completed')] })
  const ui = await mountPane($)
  await ui.press({ key: 'bar:compact' })
  await ui.unmount()
  expect(instructions).toHaveLength(1)
  expect(instructions[0]?.startsWith(KEEP_DROP)).toBe(true)
  expect(instructions[0]).toContain('Task aperti: Scrivere i test; Poi il codice.')
  expect(instructions[0]).toContain('Perimetro deliver (2 voci): src/a.ts, src/b/.')
  expect(instructions[0]).not.toContain('Fatto')
})

test('buttons row: a perimeter of another branch, or a closed one, is not named', async ($, on) => {
  const instructions: (string | undefined)[] = []
  world(on, { instructions, branch: 'feat/x', perimeter: 'branch: feat/other\nstatus: active\n- src/a.ts\n' })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mountPane($)
  await ui.press({ key: 'bar:compact' })
  await ui.unmount()
  expect(instructions).toEqual([KEEP_DROP])
})

for (const [branch, scope] of [
  ['feature/AB#512-reports', 'AB#512'],
  ['users/me/4711-fix-login', 'AB#4711'],
  ['main', 'topic main'],
] as const) {
  test(`buttons row: segna ore on ${branch} submits the scope ${scope}`, async ($, on) => {
    const commands: string[] = []
    world(on, { commands, branch })
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    const ui = await mountPane($)
    await ui.press({ key: 'bar:worklog' })
    await ui.unmount()
    expect(commands).toEqual([`/worklog oggi ${scope}`])
  })
}

for (const [name, options] of [
  ['a detached HEAD', { detached: true }],
  ['no git', { notRepo: true }],
] as const) {
  test(`buttons row: segna ore is hidden on ${name}; compatta stays`, async ($, on) => {
    world(on, options)
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    const ui = await mountPane($)
    expect(await ui.find({ key: 'bar:worklog' })).toBeUndefined()
    expect(await ui.find({ key: 'bar:compact' })).toBeDefined()
    await ui.unmount()
  })
}

/** The keys of the Buttons in the last row of the drawn pane. */
const lastRowKeys = (root: unknown): string[] => {
  const keys = (el: unknown): string[] => {
    const o = el as { props?: { key?: string }; type?: string; children?: unknown[] } | null
    const own = o?.type === 'Button' && o.props?.key ? [o.props.key] : []
    return [...own, ...(o?.children ?? []).flatMap(keys)]
  }
  return keys(((root as { children?: unknown[] }).children ?? []).at(-1))
}

test('buttons row: the very last row of every tab', async ($, on) => {
  world(on, { hasWorklog: true })
  taskTools(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'TodoWrite', todos: [todo('Uno', 'pending')] })
  for (const tab of ['session', 'agents', 'work', 'repo']) {
    const { root, rows } = await paneRows($, 50, tab)
    expect(lastRowKeys(root)).toEqual(['bar:compact', 'bar:worklog'])
    // a rule sets it apart from the tab's content
    expect(rows.at(-2)).toMatch(/^─+$/)
  }
})

test('Sessione: the running agents only, compact, at most 5 rows then … +n', async ($, on) => {
  world(on)
  spawns(on)
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  for (let n = 1; n <= 7; n++) await spawnAgent($, `agent-${n}`)
  // the first one ends: it is no longer listed here
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 'x', agentId: 'a1', reason: 'answer' })
  const { rows } = await paneRows($, 60)
  const title = rows.findIndex(r => /^AGENTS/.test(r))
  expect(rows[title]).toMatch(/^AGENTS · 6 in corso/)
  const listed = rows.filter(r => /^◐ agent-/.test(r))
  expect(listed.map(r => r.split(' ')[1])).toEqual(['agent-2', 'agent-3', 'agent-4', 'agent-5', 'agent-6'])
  expect(rows.some(r => /✓ agent-/.test(r))).toBe(false)
  expect(rows[title + 2 + 5]).toBe('… +1')
})

// ── Phase 1 follow-ups ──

test('a session start (/clear) forgets the cache share and the 5h readings of the burn rate', async ($, on) => {
  let id = 's-1'
  const options: World = { sessionId: () => id }
  const clock = world(on, options)
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(15 * MIN)
  await $.session.measure({
    context: { window: 1_000_000, tokens: 260_000, percent: 26 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 41, resetsAt: iso(2 * 60 * MIN) }],
    cost: { usd: 5.2 },
    changed: ['rateLimits'],
  })
  await $.turn.complete({
    answer: '',
    durationMs: 1,
    isAborted: false,
    turnId: 't',
    reason: 'answer',
    usage: { input_tokens: 600, output_tokens: 7, cache_read_input_tokens: 94_000, cache_creation_input_tokens: 5_400, model: 'm' },
  })
  const before = (await paneRows($)).rows
  expect(before.some(r => /finisce/.test(r))).toBe(true)
  expect(before.some(r => /^CONTESTOcache/.test(r))).toBe(true)

  id = 's-2'
  // The new session reads the same 41% window: without the reset the old samples would still give a rate.
  options.rateLimits = [{ kind: 'five_hour', percentUsed: 41, resetsAt: iso(2 * 60 * MIN) }]
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const after = (await paneRows($)).rows
  expect(after.some(r => /finisce/.test(r))).toBe(false)
  expect(after.find(r => /^CONTESTO/.test(r))).toBe('CONTESTO')
})

// ── Agenti: history and open an agent ──

/** The end of agent `agentId`'s turn, as the engine raises it. */
const finishAgent = ($: Engine, agentId: string, reason: 'answer' | 'aborted' | 'error' = 'answer') =>
  $.turn.complete({ answer: '', durationMs: 1, isAborted: reason === 'aborted', turnId: `${agentId}-t`, agentId, reason })

const mountPane = ($: Engine, bodyColumns = 50) => $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns }, surface: 'terminal' })

/** A history entry as the state file holds it. */
const entry = (id: string, type: string, endedAt: number, isFailed = false) => ({
  id,
  type,
  model: 'claude-sonnet-5-5',
  startedAt: endedAt - 60_000,
  endedAt,
  tokens: 5400,
  isFailed,
})

test('Agenti: a finished agent leaves the list after 2 minutes for STORICO, collapsed by default, newest first, with its outcome', async ($, on) => {
  const writes = new Map<string, string>()
  const clock = world(on, { writes, listed: [{ id: 'a3', status: 'running' }] })
  spawns(on)
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  for (const type of ['one', 'two', 'three']) await spawnAgent($, type)
  await finishAgent($, 'a1')
  await clock.advance(5_000)
  await finishAgent($, 'a2', 'error')

  const ui = await mountPane($)
  await ui.press({ key: 'tab:agents' })
  // inside the two minutes the finished agents are listed as before, and there is no history yet
  expect(await ui.find({ key: 'agent:a1' })).toBeDefined()
  expect(await ui.find({ key: 'agent:a2' })).toBeDefined()
  expect(await ui.find({ key: 'history' })).toBeUndefined()

  await clock.advance(130_000)
  expect(await ui.find({ key: 'agent:a1' })).toBeUndefined()
  expect(await ui.find({ key: 'agent:a2' })).toBeUndefined()
  expect(await ui.find({ key: 'agent:a3' })).toBeDefined()
  expect((await ui.find({ key: 'history' }))?.text).toBe('STORICO · 2 ▸')
  expect(await ui.find({ key: 'history:a1' })).toBeUndefined()

  await ui.press({ key: 'history' })
  expect((await ui.find({ key: 'history' }))?.text).toBe('STORICO · 2 ▾')
  const keys = async () => (await ui.findAll({ type: 'Button' })).map(b => b.key ?? '').filter(k => k.startsWith('history:'))
  expect(await keys()).toEqual(['history:a2', 'history:a1'])
  expect((await ui.find({ key: 'history:a2' }))?.text).toMatch(/^✗ two +son 5\.5 +5s +0$/)
  expect((await ui.find({ key: 'history:a1' }))?.text).toMatch(/^✓ one +son 5\.5 +0s +0$/)
  await ui.press({ key: 'history' })
  expect(await keys()).toEqual([])
  await ui.unmount()

  // the state file carries it, so a resume or a reload finds it
  await clock.advance(3000)
  expect((flagOf(writes) as { history: unknown }).history).toEqual([
    { id: 'a2', type: 'two', model: 'claude-sonnet-5-5', startedAt: NOW, endedAt: NOW + 5000, tokens: 0, isFailed: true },
    { id: 'a1', type: 'one', model: 'claude-sonnet-5-5', startedAt: NOW, endedAt: NOW, tokens: 0, isFailed: false },
  ])
})

test('Agenti: an agent the engine lists as killed or failed ends with ✗, one it no longer lists with ✓', async ($, on) => {
  const clock = world(on, {
    listed: [
      { id: 'a1', status: 'killed' },
      { id: 'a2', status: 'failed' },
    ],
  })
  spawns(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  for (const type of ['one', 'two', 'three']) await spawnAgent($, type)
  await clock.advance(15_000)
  const ui = await mountPane($)
  await ui.press({ key: 'tab:agents' })
  expect((await ui.find({ key: 'agent:a1' }))?.text).toMatch(/^✗ one/)
  expect((await ui.find({ key: 'agent:a2' }))?.text).toMatch(/^✗ two/)
  expect((await ui.find({ key: 'agent:a3' }))?.text).toMatch(/^✓ three/)
  await ui.unmount()
})

test('STORICO lists at most ten rows, then … +n', async ($, on) => {
  const clock = world(on)
  spawns(on)
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  for (let n = 1; n <= 12; n++) await spawnAgent($, `agent-${n}`)
  for (let n = 1; n <= 12; n++) await finishAgent($, `a${n}`)
  await clock.advance(135_000)
  const ui = await mountPane($)
  await ui.press({ key: 'tab:agents' })
  await ui.press({ key: 'history' })
  expect((await ui.find({ key: 'history' }))?.text).toBe('STORICO · 12 ▾')
  expect((await ui.findAll({ type: 'Button' })).filter(b => (b.key ?? '').startsWith('history:')).length).toBe(10)
  const rows = rowTexts(await ui.drawn())
  // the buttons row closes the pane, under a rule
  expect(rows.at(-3)).toBe('… +2')
  await ui.unmount()
})

test('STORICO survives a reload: the session id reads its history from its state file; another id starts empty', async ($, on) => {
  let id = 's-1'
  world(on, { sessionId: () => id, stateFile: JSON.stringify({ open: false, tab: 'agents', history: [entry('a9', 'implementer', NOW - 30_000), entry('a8', 'reviewer', NOW - 90_000, true)] }) })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  let ui = await mountPane($)
  expect((await ui.find({ key: 'history' }))?.text).toBe('STORICO · 2 ▸')
  await ui.press({ key: 'history' })
  expect((await ui.find({ key: 'history:a9' }))?.text).toMatch(/^✓ implementer +son 5\.5 +1m00s +5\.4k$/)
  expect((await ui.find({ key: 'history:a8' }))?.text).toMatch(/^✗ reviewer/)
  await ui.unmount()

  id = 's-2'
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  ui = await mountPane($)
  expect(await ui.find({ key: 'history' })).toBeUndefined()
  await ui.unmount()
})

/** The state file of session `id` as last written, parsed; `undefined` when none was written. */
const fileOfSession = (writes: Map<string, string>, id: string): { history: unknown[] } | undefined => {
  const path = [...writes.keys()].find(k => k.endsWith(`cockpit-${id}.json`))
  return path === undefined ? undefined : JSON.parse(writes.get(path) ?? 'null')
}

test('STORICO: a /clear moves the finished agent still under 2 minutes into the ending session\'s history; the new session starts empty', async ($, on) => {
  let id = 's-1'
  const writes = new Map<string, string>()
  const clock = world(on, { sessionId: () => id, writes })
  spawns(on)
  on('turn.complete', () => ({ text: '' }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await spawnAgent($, 'old')
  await finishAgent($, 'a1')
  id = 's-2'
  await $.session.end({ reason: 'clear', sessionId: 's-1', resume: { id: 's-1' } })
  expect(fileOfSession(writes, 's-1')?.history).toEqual([{ id: 'a1', type: 'old', model: 'claude-sonnet-5-5', startedAt: NOW, endedAt: NOW, tokens: 0, isFailed: false }])
  await clock.advance(135_000)
  const ui = await mountPane($)
  await ui.press({ key: 'tab:agents' })
  expect(await ui.find({ key: 'history' })).toBeUndefined()
  expect(await ui.find({ key: 'agent:a1' })).toBeUndefined()
  await ui.unmount()
  expect(fileOfSession(writes, 's-2')?.history).toEqual([])
})

test('Agenti: a reload of the same session id keeps the live agents, the finished one too until its 2 minutes pass', async ($, on) => {
  const clock = world(on, { listed: [{ id: 'a1', status: 'running' }] })
  spawns(on)
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await spawnAgent($, 'one')
  await spawnAgent($, 'two')
  await finishAgent($, 'a2')
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mountPane($)
  await ui.press({ key: 'tab:agents' })
  expect(await ui.find({ key: 'agent:a1' })).toBeDefined()
  expect(await ui.find({ key: 'agent:a2' })).toBeDefined()
  await clock.advance(135_000)
  expect(await ui.find({ key: 'agent:a1' })).toBeDefined()
  expect(await ui.find({ key: 'agent:a2' })).toBeUndefined()
  expect((await ui.find({ key: 'history' }))?.text).toBe('STORICO · 1 ▸')
  await ui.unmount()
})

test('a write delayed across a /clear writes nothing to the new session\'s file', async ($, on) => {
  let id = 's-1'
  const writes = new Map<string, string>()
  const clock = world(on, { sessionId: () => id, writes })
  spawns(on)
  on('turn.complete', () => ({ text: '' }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await spawnAgent($, 'one')
  await finishAgent($, 'a1')
  // the change is inside the 3 s window of the start's write: it waits for the timer
  id = 's-2'
  await $.session.end({ reason: 'clear', sessionId: 's-1', resume: { id: 's-1' } })
  await clock.advance(3500)
  expect(fileOfSession(writes, 's-2')).toBeUndefined()
})

test('session.end while id() still answers the ending session: a tick in between never re-adopts it, the running agent is interrotto in its file, nothing of it reaches the next', async ($, on) => {
  let id = 's-1'
  const writes = new Map<string, string>()
  const clock = world(on, { sessionId: () => id, writes, listed: [{ id: 'a1', status: 'running' }, { id: 'a2', status: 'running' }] })
  spawns(on)
  on('turn.complete', () => ({ text: '' }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await spawnAgent($, 'running-one')
  await spawnAgent($, 'finished-one')
  await finishAgent($, 'a2')
  // an open pane makes every tick rewrite the state file of whatever session the snapshot holds
  await $.command.run({ command: 'cockpit', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 80 } })
  // the documented order: the ending id is still the current one while session.end runs
  await $.session.end({ reason: 'clear', sessionId: 's-1', resume: { id: 's-1' } })
  const ended = fileOfSession(writes, 's-1')
  expect(ended?.history).toEqual([
    { id: 'a1', type: 'running-one', model: 'claude-sonnet-5-5', startedAt: NOW, endedAt: NOW, tokens: 0, isFailed: false, isInterrupted: true },
    { id: 'a2', type: 'finished-one', model: 'claude-sonnet-5-5', startedAt: NOW, endedAt: NOW, tokens: 0, isFailed: false },
  ])
  // a tick lands before the engine switches to the next id: it must not take s-1 back
  await clock.advance(15_000)
  expect(fileOfSession(writes, 's-1')).toEqual(ended)
  id = 's-2' // no session.start follows a /clear
  await clock.advance(135_000)
  const ui = await mountPane($)
  await ui.press({ key: 'tab:agents' })
  expect(await ui.find({ key: 'agent:a1' })).toBeUndefined()
  expect(await ui.find({ key: 'agent:a2' })).toBeUndefined()
  expect(await ui.find({ key: 'history' })).toBeUndefined()
  await ui.unmount()
  expect(fileOfSession(writes, 's-2')?.history).toEqual([])
  expect(fileOfSession(writes, 's-1')).toEqual(ended)
})

test('STORICO draws an interrupted agent as a dim ■, and a resume of the ended id brings its history back', async ($, on) => {
  const history = [{ ...entry('a1', 'running-one', NOW - 1000), isInterrupted: true }]
  world(on, { stateFile: JSON.stringify({ tab: 'agents', history }) })
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.end({ reason: 'resume', sessionId: 's-1', resume: { id: 's-1' } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mountPane($)
  await ui.press({ key: 'history' })
  expect((await ui.find({ key: 'history:a1' }))?.text).toMatch(/^■ running-one/)
  await ui.unmount()
})

test('a session.end whose file write is cut short still leaves nothing of the ending session in the snapshot', async ($, on) => {
  let id = 's-1'
  const writes = new Map<string, string>()
  let isCut = false
  world(on, { sessionId: () => id, writes, failWrites: () => isCut })
  spawns(on)
  on('turn.complete', () => ({ text: '' }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await spawnAgent($, 'running-one')
  isCut = true
  await $.session.end({ reason: 'clear', sessionId: 's-1', resume: { id: 's-1' } })
  id = 's-2'
  const ui = await mountPane($)
  await ui.press({ key: 'tab:agents' })
  expect(await ui.find({ key: 'agent:a1' })).toBeUndefined()
  await ui.unmount()
})

test('a resume reloads the history of the session it resumes', async ($, on) => {
  let id = 's-2'
  const history = [entry('a9', 'implementer', NOW - 30_000), entry('a8', 'reviewer', NOW - 90_000, true)]
  const clock = world(on, { sessionId: () => id, stateFile: JSON.stringify({ open: false, tab: 'agents', history }) })
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  id = 's-1'
  await $.session.end({ reason: 'resume', sessionId: 's-2', resume: { id: 's-2' } })
  await clock.advance(15_000)
  const ui = await mountPane($)
  expect((await ui.find({ key: 'history' }))?.text).toBe('STORICO · 2 ▸')
  await ui.unmount()
})

test('STORICO: entries a state file holds wrongly are left out, a file with no history means none', async ($, on) => {
  world(on, { stateFile: JSON.stringify({ tab: 'agents', history: [{ id: 'x' }, 'text', entry('a1', 'ok', NOW - 1000)] }) })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mountPane($)
  expect((await ui.find({ key: 'history' }))?.text).toBe('STORICO · 1 ▸')
  await ui.unmount()
})

test('session.end keeps the history in the closed file, so a resume finds it', async ($, on) => {
  const writes = new Map<string, string>()
  const history = [entry('a9', 'implementer', NOW - 30_000)]
  world(on, { writes, stateFile: JSON.stringify({ history }) })
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.end({ reason: 'clear', sessionId: 's-1', resume: { id: 's-1' } })
  expect(flagOf(writes)).toEqual({ ...CLOSED, history })
})

test('pressing an agent row, live or in STORICO, puts that agent in the main view', async ($, on) => {
  const viewed: (string | undefined)[] = []
  const clock = world(on, { viewed, listed: [{ id: 'a3', status: 'running' }] })
  spawns(on)
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  for (const type of ['one', 'two', 'three']) await spawnAgent($, type)
  await finishAgent($, 'a1')
  await clock.advance(130_000)
  await finishAgent($, 'a2')

  const ui = await mountPane($)
  // the Sessione view lists the running agent
  await ui.press({ key: 'agent:a3' })
  expect(viewed).toEqual(['a3'])
  await ui.press({ key: 'tab:agents' })
  await ui.press({ key: 'agent:a3' }) // live
  await ui.press({ key: 'agent:a2' }) // finished, still listed
  await ui.press({ key: 'history' })
  await ui.press({ key: 'history:a1' }) // in the history
  expect(viewed).toEqual(['a3', 'a3', 'a2', 'a1'])
  await ui.unmount()
})

// ── Phase 2 follow-ups ──

test('burn rate: a reading from before the current 5h window opened is not carried across the reset', async ($, on) => {
  const clock = world(on) // 38% at start, in a window that opened before it
  on('session.measure', (_, e) => ({ changed: e.changed }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const measure = (used: number, resetsAt: string) =>
    $.session.measure({
      context: { window: 1_000_000, tokens: 260_000, percent: 26 },
      rateLimits: [{ kind: 'five_hour', percentUsed: used, resetsAt }],
      cost: { usd: 5.2 },
      changed: ['rateLimits'],
    })
  await clock.advance(15 * MIN)
  await measure(41, iso(2 * 60 * MIN)) // the same window: 3 points in 15 minutes
  expect((await paneRows($)).rows.some(r => /finisce/.test(r))).toBe(true)

  await clock.advance(75 * MIN)
  await measure(45, iso(90 * MIN + 5 * 60 * MIN)) // a new window that opened just now: the earlier readings are not its start
  expect((await paneRows($)).rows.some(r => /finisce/.test(r))).toBe(false)
})

test('a workspaces.json that is not JSON draws no ALM line', async ($, on) => {
  world(on, { workspacesRaw: '{ "roots": [ { "path": "/work", "org": ' })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect((await paneRows($)).rows.some(r => /^ALM/.test(r))).toBe(false)
})

test('tab bar: below 48 columns the labels are short and the bar fits the pane; from 48 they are whole', async ($, on) => {
  world(on, { hasWorklog: true })
  spawns(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await spawnAgent($, 'code-reviewer')
  // a terminal Button draws `[ label ]`: 4 cells of chrome, one cell between two
  const tabsAt = async (columns: number) => {
    const ui = await mountPane($, columns)
    const labels = (await ui.findAll({ type: 'Button' })).filter(b => (b.key ?? '').startsWith('tab:')).map(b => b.text ?? '')
    await ui.unmount()
    return { labels, cells: labels.reduce((n, l) => n + [...l].length + 4, 0) + labels.length - 1 }
  }
  const narrow = await tabsAt(40)
  expect(narrow.labels).toEqual(['Sess', 'Agen 1', 'Lav ●', 'Repo'])
  expect(narrow.cells).toBeLessThanOrEqual(40)
  expect((await tabsAt(47)).labels).toEqual(['Sess', 'Agen 1', 'Lav ●', 'Repo'])
  const whole = await tabsAt(48)
  expect(whole.labels).toEqual(['Sessione', 'Agenti 1', 'Lavoro ●', 'Repo'])
  expect(whole.cells).toBeLessThanOrEqual(48)
})

/** The `flexDirection` of the Box that holds the Button keyed `key`. */
const directionAround = (root: unknown, key: string): string | undefined => {
  const o = root as { type?: string; props?: { flexDirection?: string }; children?: { props?: { key?: string } }[] } | null
  if (o?.type === 'Box' && (o.children ?? []).some(c => c?.props?.key === key)) return o.props?.flexDirection
  for (const c of o?.children ?? []) {
    const found = directionAround(c, key)
    if (found !== undefined) return found
  }
  return undefined
}

test('buttons row: side by side, and the row fits 40 columns', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  // compatta + segna ore: 12 + 13 cells and one gap
  for (const columns of [60, 50, 40]) expect(directionAround((await paneRows($, columns)).root, 'bar:compact')).toBe('row')
  const ui = await mountPane($, 40)
  const labels = (await ui.findAll({ type: 'Button' })).filter(b => (b.key ?? '').startsWith('bar:')).map(b => b.text ?? '')
  await ui.unmount()
  expect(labels.reduce((n, l) => n + [...l].length + 4, 0) + labels.length - 1).toBeLessThanOrEqual(40)
})

test('Lavoro with no tasks and no worklog warnings says niente da mostrare', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const { rows } = await paneRows($, 50, 'work')
  // the buttons row closes the pane, under a rule
  expect(rows.at(-3)).toBe('niente da mostrare')
  expect(rows.some(r => /^TASK/.test(r) || /worklog/.test(r))).toBe(false)
})
