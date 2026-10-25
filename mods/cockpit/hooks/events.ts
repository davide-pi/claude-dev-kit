import { atom, read } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { CockpitAgent, CockpitClaudeState, CockpitSnapshot, CockpitTask, CockpitUsage, CockpitWorkflowRun } from '../types'
import { addUsage, newTokens } from './agents'
import { NOTE_MAX } from './session'
import { INITIAL } from './state'
import { patch } from './store'
import { editedPathOf, recordEdited } from './work'

// The scan that checks `$.state` references reads the atom from the file that uses it.
const snapshot = atom({ plugin: 'cockpit', key: 'snapshot' } as const, INITIAL)

/**
 * Keeps the name of the first workflow among `tasks` (a stop's `background_tasks`) in the snapshot; none clears it. The
 * end of the main loop's turn (`isMainStop`) reporting none also ends the run whose agents were counted: a subagent's stop
 * can report none while the run's other agents still work.
 */
export async function setWorkflow($: EngineInterface, tasks: readonly { type: string; name?: string }[] | undefined, isMainStop = false): Promise<void> {
  const workflow = tasks?.find(t => t.type === 'workflow' && typeof t.name === 'string' && t.name !== '')?.name
  const isRunEnd = isMainStop && workflow === undefined
  try {
    const now = await $.clock.now()
    // The run's end is the other way a workflow's agents end, besides their own turn: the engine never lists them.
    await patch($, s => ({
      ...s,
      workflow,
      workflowRun: isRunEnd ? undefined : s.workflowRun,
      agents: isRunEnd ? endRunAgents(s.agents, s.workflowRun, now) : s.agents,
    }))
  } catch {
    // observing must never break the stop
  }
}

/** The agents of `run` still running, finished at `now`. */
function endRunAgents(agents: CockpitAgent[], run: CockpitWorkflowRun | undefined, now: number): CockpitAgent[] {
  const ids = new Set(run?.agents.map(a => a.id))
  return agents.map((a): CockpitAgent => (ids.has(a.id) && a.status === 'running' ? { ...a, status: 'done', endedAt: now } : a))
}

/** `id` joins the run `runId`; an agent of another run than the one kept starts a new count. */
export function addWorkflowAgent(run: CockpitWorkflowRun | undefined, runId: string, id: string): CockpitWorkflowRun {
  const kept = run?.runId === runId ? run.agents : []
  return { runId, agents: kept.some(a => a.id === id) ? kept : [...kept, { id, isDone: false }] }
}

/** Marks agent `id` of the run finished; any other id leaves the run as it is. */
export function finishWorkflowAgent(run: CockpitWorkflowRun | undefined, id: string): CockpitWorkflowRun | undefined {
  return run?.agents.some(a => a.id === id && !a.isDone) ? { ...run, agents: run.agents.map(a => (a.id === id ? { ...a, isDone: true } : a)) } : run
}

/**
 * Keeps the main loop's state for the header's icon. It is told apart before patching: a thinking chunk repeats many times
 * a second, and a patch costs a session check and a state file check. `only` makes the change conditional on the state now held.
 */
export async function setClaudeState($: EngineInterface, state: CockpitClaudeState, only?: (now: CockpitClaudeState | undefined) => boolean): Promise<void> {
  try {
    const { claudeState } = await read($, snapshot)
    if (only && !only(claudeState)) return
    if (claudeState?.kind === state.kind && claudeState.tool === state.tool) return
    await patch($, s => ({ ...s, claudeState: state }))
  } catch {
    // observing must never break the event
  }
}

/**
 * Adds one response's counters to its loop's: an agent's four counters (kept apart as the turn's step part, which the turn's end
 * swaps for the turn's own total) or, for the main loop, the session's token count. Never breaks the step.
 */
export async function addStepUsage($: EngineInterface, agentId: string | undefined, usage: CockpitUsage): Promise<void> {
  const now = await $.clock.now()
  const added = newTokens(usage)
  await patch($, s =>
    agentId === undefined
      ? { ...s, mainTokens: (s.mainTokens ?? 0) + added, mainStepTokens: (s.mainStepTokens ?? 0) + added }
      : {
          ...s,
          agents: upsertAgent(s.agents, agentId, now, a => ({
            ...a,
            usage: addUsage(a.usage, usage),
            stepUsage: addUsage(a.stepUsage, usage),
            tokens: a.tokens + added,
          })),
        },
  )
}

/** `list` without its last entry equal to `tool` (a call that ended); undefined stays undefined. */
export const removeOne = (list: readonly string[] | undefined, tool: string): string[] | undefined => {
  const i = list?.lastIndexOf(tool) ?? -1
  return list && i >= 0 ? [...list.slice(0, i), ...list.slice(i + 1)] : list?.slice()
}

/** Applies `change` to the agent `id`; an agent whose events outran its spawn gets a stub the spawn later fills. */
export function upsertAgent(agents: CockpitAgent[], id: string, now: number, change: (a: CockpitAgent) => CockpitAgent): CockpitAgent[] {
  const stub: CockpitAgent = { id, type: '?', status: 'running', startedAt: now, tokens: 0 }
  return agents.some(a => a.id === id)
    ? agents.map(a => (a.id === id ? change(a) : a))
    : [...agents, change(stub)]
}

// ── Tasks: the main thread's task tools and TodoWrite, one merged list ──

const TODO_PREFIX = 'todo:'

/** TodoWrite sends the whole list: it replaces the TodoWrite items, the task-tool items stay. */
export function applyTodos(
  tasks: readonly CockpitTask[],
  todos: readonly { content: string; status: CockpitTask['status'] }[],
  now: number,
): CockpitTask[] {
  const before = new Map(tasks.map(t => [t.id, t]))
  const written = todos.map((todo): CockpitTask => {
    const id = TODO_PREFIX + todo.content
    const wasActive = before.get(id)?.status === 'in_progress'
    const startedAt = todo.status === 'in_progress' ? (wasActive ? before.get(id)?.startedAt : undefined) ?? now : undefined
    return { id, subject: todo.content, status: todo.status, startedAt }
  })
  return [...tasks.filter(t => !t.id.startsWith(TODO_PREFIX)), ...written]
}

/** A call that answered without error and was not refused. */
export const isOk = (ran: { deny?: string; isError?: boolean }) => ran.deny === undefined && ran.isError !== true

/** What a Bash call printed: the `stdout` of its result, narrowed from `unknown`; else the text the model read. */
export function bashOutput(ran: { result?: unknown; text?: string }): string {
  const { result } = ran
  return typeof result === 'object' && result !== null && 'stdout' in result && typeof result.stdout === 'string' ? result.stdout : (ran.text ?? '')
}

/** An edit call that ran clean adds its file to the ones this chat edited (a subagent's edit too), for the Work tab's marker. */
export async function noteEdit($: EngineInterface, input: { readonly [key: string]: unknown }, ran: { deny?: string; isError?: boolean }): Promise<void> {
  const path = editedPathOf(input)
  if (path !== undefined && isOk(ran)) await patch($, s => ({ ...s, edited: recordEdited(s.edited, path) })).catch(() => undefined)
}

/** A TaskUpdate result that says it did not apply (`success: false`), narrowed from `unknown`. */
export function isRefused(result: unknown): boolean {
  return typeof result === 'object' && result !== null && 'success' in result && result.success === false
}

/** The `task` a TaskCreate result carries, narrowed once here: the result reaches a hook as `unknown`. */
export function createdTask(result: unknown): { id: string; subject: string } | undefined {
  if (typeof result !== 'object' || result === null || !('task' in result)) return undefined
  const { task } = result
  if (typeof task !== 'object' || task === null || !('id' in task) || !('subject' in task)) return undefined
  return typeof task.id === 'string' && typeof task.subject === 'string' ? { id: task.id, subject: task.subject } : undefined
}

/** `list` with `item` taken out when it is in, put in when it is not; an empty list is none. */
export function toggled<T>(list: readonly T[] | undefined, item: T): T[] | undefined {
  const next = list?.includes(item) ? list.filter(x => x !== item) : [...(list ?? []), item]
  return next.length > 0 ? next : undefined
}

/**
 * Saves the field's text (`typed`, the text of the field on Enter; else the draft the snapshot holds): a new note at the end of the list,
 * or, when the field was loaded from a note (`noteEditing`) that is still there, that note's text replaced. The field is emptied; a blank text changes nothing.
 */
export function saveNote(s: CockpitSnapshot, typed?: string): CockpitSnapshot {
  const text = (typed ?? s.noteDraft ?? '').slice(0, NOTE_MAX)
  if (text.trim() === '') return s
  const notes = s.notes ?? []
  const isEdit = notes.some(n => n.id === s.noteEditing)
  const next = isEdit
    ? notes.map(n => (n.id === s.noteEditing ? { ...n, text } : n))
    : [...notes, { id: Math.max(0, ...notes.map(n => n.id)) + 1, text }]
  return { ...s, notes: next, noteDraft: undefined, noteEditing: undefined }
}

/**
 * Appends a saved note to the prompt box, after a newline when the box already holds text (D6; a box that cannot be read counts as
 * holding some). The box is only filled, never submitted (D3): the person decides. The note stays in the list, whether the box took the text or not.
 */
export async function sendNote($: EngineInterface, id: number): Promise<void> {
  const note = (await read($, snapshot)).notes?.find(n => n.id === id)
  if (!note) return
  const box = await $.prompt.read().catch(() => undefined)
  await $.prompt.fill({ text: `${box?.text === '' ? '' : '\n'}${note.text}`, mode: 'append' })
}
