import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { TABS, TAB_ICONS } from '../hooks/session'
import type { CockpitTab } from '../types'
import { NOW, PANE, rowTexts, settle } from './cockpit-world'

/** Lets what a hook left running (the unawaited flag write of a first render) settle. */
declare const setTimeout: (fn: () => void, ms: number) => unknown // the test runtime has it; the module's types do not

// ── Tasks ──

type Todo = { content: string; status: 'pending' | 'in_progress' | 'completed'; activeForm: string }
export const todo = (content: string, status: Todo['status']): Todo => ({ content, status, activeForm: content })

/** The tools beneath the mod: TaskCreate answers with the next id, the others with their plain result. */
export function taskTools(on: On) {
  let n = 0
  on('tool.call', { tool: 'TaskCreate' }, (_, e) => ({ result: { task: { id: String(++n), subject: e.subject } } }))
  on('tool.call', { tool: 'TaskUpdate' }, (_, e) => ({ result: { success: true, taskId: e.taskId, updatedFields: ['status'] } }))
  on('tool.call', { tool: 'TodoWrite' }, (_, e) => ({ result: { oldTodos: [], newTodos: e.todos } }))
}

export const createTask = ($: Engine, subject: string, agentId?: string) =>
  $.tool.call({ tool: 'TaskCreate', subject, description: subject, ...(agentId ? { agentId } : {}) })
export const updateTask = ($: Engine, taskId: string, status: 'pending' | 'in_progress' | 'completed' | 'deleted') =>
  $.tool.call({ tool: 'TaskUpdate', taskId, status })

export async function taskRows($: Engine, bodyColumns = 50) {
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns }, surface: 'terminal' })
  await ui.press({ key: 'tab:work' })
  const rows = rowTexts(await ui.drawn())
  await ui.unmount()
  const i = rows.findIndex(r => /^TASK/.test(r))
  return { rows, i }
}

// ── Credits, cache share, ALM ──

/** The color of the first leaf Text whose content matches `re`. */
export const colorOf = (root: unknown, re: RegExp): string | undefined => {
  const o = root as { props?: { color?: string }; children?: unknown[] } | null
  const [only] = o?.children ?? []
  if (typeof only === 'string' && re.test(only)) return o?.props?.color
  for (const c of o?.children ?? []) {
    const found = colorOf(c, re)
    if (found !== undefined) return found
  }
  return undefined
}

export const RED = '#f07a6f'
export const MIN = 60_000

/** The pane's rows with the tab pressed first (the one the mod state already holds when none is given). */
export async function paneRows($: Engine, bodyColumns = 50, tab?: string) {
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns }, surface: 'terminal' })
  if (tab) await ui.press({ key: `tab:${tab}` })
  const root = await ui.drawn()
  await ui.unmount()
  return { root, rows: rowTexts(root) }
}

// ── Tabs ──

export const spawnAgent = ($: Engine, subagentType: string) =>
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
export function spawns(on: On) {
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: `a${++n}` }))
}

export const KEEP_DROP =
  "Tieni: task in corso, decisioni prese con l'utente e il loro perché, domande aperte, file toccati e stato, comandi con la riga di output che decide, prossimi passi. Butta: output di tool già riassunti, tentativi superati."

// ── Work: the PRs, read in the background ──

/** Lets the background reads a session start leaves running (the repo's default branch, the PR) finish. */
export const settleAll = async () => {
  for (let i = 0; i < 8; i++) await settle()
}

export const CHECKS = [
  { __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SUCCESS' },
  { __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'FAILURE' },
  { __typename: 'StatusContext', state: 'SUCCESS' },
  { __typename: 'CheckRun', status: 'IN_PROGRESS', conclusion: '' },
]

// ── Subagents: history and open an agent ──

/** The end of agent `agentId`'s turn, as the engine raises it. */
export const finishAgent = ($: Engine, agentId: string, reason: 'answer' | 'aborted' | 'error' = 'answer') =>
  $.turn.complete({ answer: '', durationMs: 1, isAborted: reason === 'aborted', turnId: `${agentId}-t`, agentId, reason })

export const mountPane = ($: Engine, bodyColumns = 50) => $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns }, surface: 'terminal' })

/** A history entry as the state file holds it. */
export const entry = (id: string, type: string, endedAt: number, isFailed = false) => ({
  id,
  type,
  model: 'claude-sonnet-5-5',
  startedAt: endedAt - 60_000,
  endedAt,
  tokens: 5400,
  isFailed,
})

/** The data file of session `id` as last written, parsed; `undefined` when none was written. */
export const fileOfSession = (writes: Map<string, string>, id: string): { history: unknown[] } | undefined => {
  const path = [...writes.keys()].find(k => k.endsWith(`cockpit-data-${id}.json`))
  return path === undefined ? undefined : JSON.parse(writes.get(path) ?? 'null')
}

/** The tab labels of a pane `columns` wide, the cells they take (a terminal Button draws `[ label ]`: 4 cells of chrome, one between two) and the drawn tree. */
export const tabsAt = async ($: Engine, columns: number) => {
  const ui = await mountPane($, columns)
  const labels = (await ui.findAll({ type: 'Button' })).filter(b => (b.key ?? '').startsWith('tab:')).map(b => b.text ?? '')
  const root = await ui.drawn()
  await ui.unmount()
  return { labels, cells: labels.reduce((n, l) => n + [...l].length + 4, 0) + labels.length - 1, root }
}

export const NAMES_EN: Record<CockpitTab, string> = { agents: 'Subagents', context: 'Context', work: 'Work', insights: 'Insights', system: 'System', notes: 'Notes' }
export const NAMES_IT: Record<CockpitTab, string> = { agents: 'Subagenti', context: 'Contesto', work: 'Lavoro', insights: 'Analisi', system: 'Sistema', notes: 'Note' }

/** The tab bar's labels with `selected` named: an icon each, the name beside the selected one's; `extras` adds a badge (` 1`, ` ●`) after a label. */
export const barLabels = (selected: CockpitTab, extras: Partial<Record<CockpitTab, string>> = {}, names: Record<CockpitTab, string> = NAMES_EN) =>
  TABS.map(tab => `${TAB_ICONS[tab]}${tab === selected ? ` ${names[tab]}` : ''}${extras[tab] ?? ''}`)

// ── Phase 4: Work, per agent ──

export const PERIMETER = 'branch: feat/x\nstatus: active\n- src/a.ts\n- src/b/\n'
export const workRows = async ($: Engine, bodyColumns = 50) => (await paneRows($, bodyColumns, 'work')).rows
export const insightsRows = async ($: Engine, bodyColumns = 50) => (await paneRows($, bodyColumns, 'insights')).rows

/** A workflow agent's spawn: `runId` and its place in the run. */
export const spawnWorkflowAgent = ($: Engine, runId: string, agentIndex: number) =>
  $.agent.spawn({
    tool_use_id: 'wf-call',
    prompt: 'go',
    description: `step ${agentIndex}`,
    subagentType: 'implementer',
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'claude-opus-5-5',
    background: true,
    fork: false,
    workflow: { runId, agentIndex },
  })

export const WORKFLOW_TASK = { id: 'b2', type: 'workflow', status: 'running', description: 'x', name: 'impl-review-loop' }

/** An `agent.spawn` input but for the agent type and its description. */
export const SPAWN = {
  tool_use_id: 't',
  prompt: 'go',
  provider: { plugin: 'engine', tier: 'core' },
  model: 'sonnet',
  parentModel: 'claude-opus-5-5',
  background: true,
  fork: false,
} as const

// ── Cockpit v3, phase 1: layout, header, refresh tiers, buttons at the bottom ──

/** The rows above the tab bar: the always-visible header (its two inner rules told apart, the third one closes it). */
export const headerOf = (rows: string[]): string[] => rows.slice(0, rows.flatMap((r, i) => (/^─+$/.test(r) ? [i] : []))[2])

// ── Cockpit v3, phase 3: the Context tab ──

export const breakdownRow = (name: string, tokens: number, kind: 'used' | 'free' | 'buffer' | 'deferred' = 'used') => ({ name, tokens, color: 'promptBorder', isDeferred: kind === 'deferred', kind })
export const CONTEXT_ROWS = [breakdownRow('System prompt', 8000), breakdownRow('Messages', 90_000), breakdownRow('Free space', 700_000, 'free')]
export const openCockpit = ($: Engine) => $.command.run({ command: 'cockpit', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 80 } })
export const mainTurnEnd = ($: Engine, agentId?: string) =>
  $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer', ...(agentId ? { agentId } : {}) })

// ── Cockpit v3, phase 4: the final tabs and the Work tab ──

/** The Work tab's rows once the reads its selection started have settled. */
export async function lavoroRows($: Engine, bodyColumns = 50) {
  const ui = await mountPane($, bodyColumns)
  await ui.press({ key: 'tab:work' })
  await settleAll()
  const rows = rowTexts(await ui.drawn())
  await ui.unmount()
  return rows
}

export const GH_CREATED = 'https://github.com/example/orders/pull/42'
export const bashResult = (stdout: string) => ({ result: { stdout, stderr: '', interrupted: false } })

/** A held read by detail: `hold('full')` makes the next full read wait until the returned release is called. */
export function holds() {
  const gates: Record<string, Promise<void> | undefined> = {}
  return {
    holdUsage: (detail: string) => gates[detail],
    hold: (detail: string) => {
      let release = () => {}
      gates[detail] = new Promise<void>(resolve => (release = resolve))
      return () => {
        gates[detail] = undefined
        release()
      }
    },
  }
}

// ── Cockpit v3, phase 5: the System tab ──

export const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))
/** Waits (up to a second) for something a loop the mod left running does on its own. */
export const until = async (isDone: () => boolean) => {
  for (let i = 0; i < 100 && !isDone(); i++) await sleep(10)
}
export const GIB = 1024 ** 3
export const sysLine = (fields: object) => `${JSON.stringify(fields)}\n`

/**
 * A fake monitor behind `$.process.spawn`: prints what the test pushes (and a stderr dot while idle, as the real one prints every
 * 2 s: a loop that was stopped notices at the next piece), notes how it was started and when its stream was closed (a generator ends
 * in `finally` when the loop that reads it stops). It is finite: it ends by itself after two seconds. A stand-in for a call on `$`
 * answers `{ value }`, here the way the child ended.
 */
export function fakeMonitor(on: On, options: { isBroken?: boolean } = {}) {
  const monitor = {
    spawns: [] as { argv: readonly string[]; env?: Record<string, string> }[],
    stops: 0,
    isEnded: false,
    queue: [] as string[],
    push: (text: string) => void monitor.queue.push(text),
    /** The monitor exits by itself, as a crash would end it. */
    end: () => void (monitor.isEnded = true),
  }
  on('process.spawn', async function* (_, e) {
    monitor.spawns.push({ argv: e.argv, env: e.env })
    if (options.isBroken) throw new Error('spawn node ENOENT')
    try {
      for (let i = 0; i < 400; i++) {
        while (monitor.queue.length > 0) yield { stream: 'stdout' as const, text: monitor.queue.shift() ?? '' }
        if (monitor.isEnded) return { value: { code: 1, signal: null } }
        yield { stream: 'stderr' as const, text: '.' }
        await sleep(5)
      }
      return { value: { code: 0, signal: null } }
    } finally {
      monitor.stops++
    }
  })
  return monitor
}

export const FULL_LINE = sysLine({
  cpu: 37,
  ram: { used: Math.round(12.4 * GIB), total: 32 * GIB },
  net: { rx: Math.round(1.2 * 1024 ** 2), tx: 40 * 1024 },
  procs: [
    { pid: 7000, name: 'bash', ports: [] },
    { pid: 7240, name: 'node', ports: [3000, 5173] },
  ],
  disk: { free: 120 * GIB, total: 266 * GIB, label: 'D:' },
})

/** The System tab's rows after `lines` came from the monitor. */
export async function sistemaRows($: Engine, m: ReturnType<typeof fakeMonitor>, lines: string[], bodyColumns = 50) {
  await openCockpit($)
  const ui = await mountPane($, bodyColumns)
  await settleAll()
  await ui.press({ key: 'tab:system' })
  await until(() => m.spawns.length > 0)
  for (const l of lines) m.push(l)
  await until(() => m.queue.length === 0)
  await settleAll()
  const rows = rowTexts(await ui.drawn())
  await ui.unmount()
  return rows
}

// ── Phase 8: the Notes tab ──

/** The keys of the drawn tree in drawing order. */
export const keysInOrder = (el: unknown): string[] => {
  if (typeof el === 'string') return []
  const o = el as { props?: { key?: string }; children?: unknown[] } | null
  return [...(o?.props?.key ? [o.props.key] : []), ...(o?.children ?? []).flatMap(keysInOrder)]
}

/** The mounted pane on its Notes tab. */
export const notesPane = async ($: Engine, columns = 58) => {
  const ui = await mountPane($, columns)
  await ui.press({ key: 'tab:notes' })
  return ui
}

/** Types `text` into the Notes field and presses `save`. */
export const saveNote = async (ui: Awaited<ReturnType<typeof notesPane>>, text: string) => {
  await ui.input({ key: 'note', text, kind: 'change' })
  await ui.press({ key: 'note:save' })
  await settleAll()
}

/** The saved notes' texts, as the rows of the Notes tab draw them. */
export const noteKeys = async (ui: Awaited<ReturnType<typeof notesPane>>, action: string) =>
  keysInOrder(await ui.drawn()).filter(k => k.startsWith(`note:${action}:`))

// ── Cockpit v3.1, phase 7: English, last-known values, round duration, adaptive bars, processes, context, alert seed ──

export const RL_FILE = '.statusline-rate-limits.json'
export const rlCache = (five: number, seven: number) =>
  JSON.stringify({ five_hour: { used_percentage: five, resets_at: NOW / 1000 + 3600 }, seven_day: { used_percentage: seven, resets_at: NOW / 1000 + 3 * 86400 } })
export const measureWith = ($: Engine, percent: number, rateLimits: { kind: string; percentUsed: number; resetsAt?: string }[] = []) =>
  $.session.measure({ context: { window: 1_000_000, tokens: percent * 10_000, percent }, rateLimits, cost: { usd: 5 }, changed: ['context', 'rateLimits'] })

// ── Phase 8: the v2 header and the pane's two languages ──

export const IT_FILE = { 'cockpit.json': '{"lang":"it"}' }

/** The hooks a round needs a terminal handler for. */
export const roundHooks = (on: On) => {
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
}
