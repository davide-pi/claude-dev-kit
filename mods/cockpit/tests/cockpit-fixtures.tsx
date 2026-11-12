import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

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

// ── Credits, cache share, ALM ──

/** The color of the first leaf Text whose content matches `re`. */
export const colorOf = (root: unknown, re: RegExp): string | undefined => {
  const o = root as { type?: string; props?: { color?: string; props?: { cells?: { t: string; c?: string }[] } }; children?: unknown[] } | null
  const [only] = o?.children ?? []
  if (typeof only === 'string' && re.test(only)) return o?.props?.color
  // an animated cell (surface module) holds the spans it draws in its props
  if (o?.type === 'Client') {
    const cell = o.props?.props?.cells?.find(c => re.test(c.t))
    if (cell !== undefined) return cell.c
  }
  for (const c of o?.children ?? []) {
    const found = colorOf(c, re)
    if (found !== undefined) return found
  }
  return undefined
}

export const RED = '#f07a6f'
export const MIN = 60_000

/** The pane's drawn tree and its rows. */
export async function paneRows($: Engine, bodyColumns = 50) {
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns }, surface: 'terminal' })
  const root = await ui.drawn()
  await ui.unmount()
  return { root, rows: rowTexts(root) }
}

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

// ── Work, per agent ──

export const PERIMETER = 'branch: feat/x\nstatus: active\n- src/a.ts\n- src/b/\n'

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

/** The rows above the page: the always-visible header (its inner rule sets the budgets apart, the second one closes it). */
export const headerOf = (rows: string[]): string[] => rows.slice(0, rows.flatMap((r, i) => (/^─+$/.test(r) ? [i] : []))[1])

export const openCockpit = ($: Engine) => $.command.run({ command: 'cockpit', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 80 } })
export const mainTurnEnd = ($: Engine, agentId?: string) =>
  $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer', ...(agentId ? { agentId } : {}) })

// ── Cockpit v3, phase 4: work fixtures ──

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

/** The keys of the drawn tree in drawing order. */
export const keysInOrder = (el: unknown): string[] => {
  if (typeof el === 'string') return []
  const o = el as { props?: { key?: string }; children?: unknown[] } | null
  return [...(o?.props?.key ? [o.props.key] : []), ...(o?.children ?? []).flatMap(keysInOrder)]
}

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
