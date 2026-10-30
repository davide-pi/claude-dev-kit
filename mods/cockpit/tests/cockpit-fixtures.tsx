import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { TABS } from '../hooks/session'
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
  "Keep: tasks in progress, decisions made with the user and why, open questions, files touched and their state, commands with the output line that settles them, next steps. Don't keep: tool output that's already summarised, superseded attempts."

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

/** The tab labels in each language. */
export const NAMES: Record<'en' | 'it', Record<CockpitTab, string>> = {
  en: { agents: 'Agents', context: 'Context', signals: 'Notifications', work: 'Work', notes: 'Notes' },
  it: { agents: 'Agenti', context: 'Contesto', signals: 'Notifiche', work: 'Lavoro', notes: 'Note' },
}

const SHORT_NAMES: Record<'en' | 'it', Record<CockpitTab, string>> = {
  en: { agents: 'Agt', context: 'Ctx', signals: 'Notif', work: 'Work', notes: 'Notes' },
  it: { agents: 'Agt', context: 'Ctx', signals: 'Notif', work: 'Lav', notes: 'Note' },
}

/**
 * The tab bar's labels at 58 columns: `level` 1 is every full name but Context (a bare bar), 2 the selected tab's name and the others short (a badge
 * or the worklog dot is on); `extras` adds a badge (` 1`, ` 󰧞`) after a label.
 */
export const barLabels = (extras: Partial<Record<CockpitTab, string>> = {}, lang: 'en' | 'it' = 'en', active: CockpitTab = 'agents', level: 1 | 2 = 1) =>
  TABS.map(tab => {
    const isShort = level === 2 ? tab !== active : tab === 'context' && tab !== active
    return `${(isShort ? SHORT_NAMES : NAMES)[lang][tab]}${extras[tab] ?? ''}`
  })

// ── Phase 4: Work, per agent ──

export const PERIMETER = 'branch: feat/x\nstatus: active\n- src/a.ts\n- src/b/\n'
export const workRows = async ($: Engine, bodyColumns = 50) => (await paneRows($, bodyColumns, 'work')).rows

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

/** The rows above the tab bar: the always-visible header (its inner rule sets the budgets apart, the second one closes it). */
export const headerOf = (rows: string[]): string[] => rows.slice(0, rows.flatMap((r, i) => (/^─+$/.test(r) ? [i] : []))[1])

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

// ── Waiting for what a loop the mod left running does ──

export const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))
/** Waits (up to a second) for something a loop the mod left running does on its own. */
export const until = async (isDone: () => boolean) => {
  for (let i = 0; i < 100 && !isDone(); i++) await sleep(10)
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

/** Types `text` into the Notes field and presses Enter. */
export const saveNote = async (ui: Awaited<ReturnType<typeof notesPane>>, text: string) => {
  await ui.input({ key: 'note', text, kind: 'change' })
  await ui.input({ key: 'note', text, kind: 'submit' })
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

// ── Permission asks: what really reaches the mod (`tool.check`), not the classic events a managed plugin swallows ──

/** The checks beneath the mod: an ask a person has to answer settles `ask`, every other check `allow`. */
export function permissionChecks(on: On) {
  on('tool.check', (_, e) => ({ decision: e.approver === 'person' ? 'ask' : 'allow' }))
}

/** The check of the call `id` once the engine finds a person has to answer it. */
export const askPerson = ($: Engine, id: string, tool = 'Bash') =>
  $.tool.check({ tool, input: {}, approver: 'person', tool_use_id: id } as never)

/** A tool call under a known id (the engine's own ids are random): the ask of that id ends with it. */
export const callAs = ($: Engine, id: string, call: Record<string, unknown>) => $.tool.call({ ...call, tool_use_id: id } as never)

/** The engine's answer to a launched workflow: its script's name and the run id the agents' spawns carry. */
export function workflowLaunches(on: On, name: string, runId = 'wf_1') {
  on('tool.call', { tool: 'Workflow' }, () => ({ result: { status: 'async_launched', taskId: 'wt', runId, workflowName: name } }))
}

export const launchWorkflow = ($: Engine, name: string) => $.tool.call({ tool: 'Workflow', name })

/** The Skill tool answering: the skills a session loads reach the mod as this call. */
export const skillTool = (on: On) => on('tool.call', { tool: 'Skill' }, () => ({ result: {} }))

export const loadSkill = ($: Engine, skill: string) => $.tool.call({ tool: 'Skill', skill })

/** Bash calls that hold until `release(command)` is called: the engine's tool takes as long as the test says. */
export function gatedBash(on: On) {
  const gates = new Map<string, () => void>()
  on('tool.call', { tool: 'Bash' }, (_, e) => new Promise<{ result: object }>(resolve => void gates.set(e.command, () => resolve({ result: {} }))))
  return (command: string) => gates.get(command)?.()
}
