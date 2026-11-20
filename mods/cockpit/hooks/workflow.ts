import type { CockpitAgent, CockpitLogEntry, CockpitPlanTask, CockpitWorkflowRun } from '../types'
import { isRecord } from './shared'
import { recordLog } from './timeline'

// ── The workflow run in flight, from the events that really reach the mod: the `Workflow` tool's result names it, the `agent.spawn` of its agents counts it ──

/** The round a script's agent label names (`fix round 2 findings`, `reviewer A · round 1 · code`): the number after `round` (or after `R`); none for a label without one, or a block label (its task id may look like `R2`). */
export function roundOf(label: string): number | undefined {
  if (parseBlockLabel(label) !== undefined) return undefined
  const found = /\b(?:round |R)(\d+)\b/.exec(label)
  return found ? Number(found[1]) : undefined
}

/**
 * The run a `Workflow` tool result announces (`async_launched`): its id and the name of the script; none for any other result.
 * The tool types document `runId` and `workflowName` as optional (absent on old transcripts and on a remote launch), so each is read guarded.
 */
export function launchedRun(result: unknown): { runId: string; name?: string } | undefined {
  if (!isRecord(result) || typeof result.runId !== 'string' || result.runId === '') return undefined
  return { runId: result.runId, ...(typeof result.workflowName === 'string' && result.workflowName !== '' && { name: result.workflowName }) }
}

/** A block agent's label `B1 · T1 T2 · implement`: block number, task ids and the step; none for any other label. Shared shape with workflows/dev-loop.js. */
export type BlockLabel = { block: number; ids: string[]; step: string }
export function parseBlockLabel(label: string): BlockLabel | undefined {
  const [head, idList, ...rest] = label.split(' · ')
  const block = /^B(\d+)$/.exec(head ?? '')?.[1]
  const ids = (idList ?? '').split(' ').filter(Boolean)
  return block === undefined || ids.length === 0 || rest.length === 0 ? undefined : { block: Number(block), ids, step: rest.join(' · ') }
}

/** The task plan of a `Workflow` call (`args.plan.tasks`: id, title, dependsOn), in plan order; none without a plan. */
export function taskPlan(call: unknown): CockpitPlanTask[] | undefined {
  const tasks = isRecord(call) && isRecord(call.args) && isRecord(call.args.plan) ? call.args.plan.tasks : undefined
  if (!Array.isArray(tasks)) return undefined
  const plan = tasks.flatMap((x: unknown): CockpitPlanTask[] =>
    isRecord(x) && x.id !== undefined && x.id !== null && String(x.id).trim() !== ''
      ? [{ id: String(x.id).trim(), title: typeof x.title === 'string' ? x.title.trim() : '', dependsOn: Array.isArray(x.dependsOn) ? x.dependsOn.map(String) : [] }]
      : [],
  )
  return plan.length > 0 ? plan : undefined
}

/** One row of the task tree under a flow: the task, its block (once an agent label names it), its state and, while running, the step tag. */
export type TaskRow = { id: string; title?: string; dependsOn: string[]; block?: number; state: 'pending' | 'running' | 'done'; tag?: string }
export function taskRows(run: CockpitWorkflowRun | undefined): TaskRow[] {
  if (run === undefined) return []
  const labelled = run.agents.flatMap(a => {
    const parsed = a.label === undefined ? undefined : parseBlockLabel(a.label)
    return parsed === undefined ? [] : [{ ...parsed, isDone: a.isDone, isFailed: a.isFailed === true }]
  })
  // a silent run's agents were expired, not finished: its end says nothing about its tasks
  const isEnded = run.endedAt !== undefined && run.isSilent !== true
  // without a plan the ids come from the labels alone, in block order, without titles
  const planned: CockpitPlanTask[] = run.tasks ?? [...new Set(labelled.flatMap(l => l.ids))].map(id => ({ id, title: '', dependsOn: [] }))
  const rows = planned.map((task, at) => {
    const mine = labelled.filter(l => l.ids.includes(task.id))
    const block = mine.length === 0 ? undefined : Math.min(...mine.map(l => l.block))
    const ofBlock = mine.filter(l => l.block === block)
    const running = ofBlock.filter(l => !l.isDone).pop()
    // done: its reader A finished OK, a later block started (S size, a red gate or an unchanged tree skip reader A), or the run ended; a running fix reopens it
    const isDone =
      running?.step.startsWith('fix') !== true &&
      ofBlock.length > 0 &&
      (isEnded || labelled.some(l => l.block > (block ?? 0)) || ofBlock.some(l => l.isDone && !l.isFailed && l.step.startsWith('reader A')))
    const state: TaskRow['state'] = isDone ? 'done' : ofBlock.length > 0 ? 'running' : 'pending'
    const tag = state === 'running' && running !== undefined ? running.step.replace(/\s*\(.*\)$/, '') : undefined
    const row: TaskRow = { id: task.id, ...(task.title !== '' && { title: task.title }), dependsOn: task.dependsOn, ...(block !== undefined && { block }), state, ...(tag !== undefined && { tag }) }
    return { at, row }
  })
  return rows.sort((a, b) => (a.row.block ?? Infinity) - (b.row.block ?? Infinity) || a.at - b.at).map(x => x.row)
}

/** The lowest lane no flow entry of `log` holds over `startRound`: a flow whose rounds reach `startRound` keeps its lane (no `endRound`, old data, ends at its own round); `openLane` is one a run still open holds. */
export function laneFor(log: readonly CockpitLogEntry[] | undefined, startRound: number, openLane?: number): number {
  const held = new Set((log ?? []).flatMap(e => (e.kind === 'flow' && e.round !== undefined && e.lane !== undefined && e.round <= startRound && (e.endRound ?? e.round) >= startRound ? [e.lane] : [])))
  if (openLane !== undefined) held.add(openLane)
  let lane = 0
  while (held.has(lane)) lane++
  return lane
}

/** A run that has agents and never closed properly (still open, or silent-closed): its flow node is written when another run replaces it. */
const isUnclosed = (run: CockpitWorkflowRun): boolean => run.agents.length > 0 && (run.endedAt === undefined || run.isSilent === true)

/** The run `runId` as `run` keeps it, or a new one when `run` is another one (a new run starts a new count): it takes the round open and the lane free there; with no round open it has neither. */
const runOf = (run: CockpitWorkflowRun | undefined, runId: string, round?: number, log?: readonly CockpitLogEntry[]): CockpitWorkflowRun => {
  if (run?.runId === runId) return run
  // the run it replaces is still open or silent-closed: its node is written only after this lane is chosen, so its lane counts as held
  return { runId, agents: [], ...(round !== undefined && { startRound: round, lane: laneFor(log, round, run !== undefined && isUnclosed(run) ? run.lane : undefined) }) }
}

/** `run` after a `Workflow` result named its script: the name, and the task plan of the call when it had one, join the run it announces. A new run starts in `round` (the conversation round open) in the lane `log` leaves free. */
export function nameRun(run: CockpitWorkflowRun | undefined, launched: { runId: string; name?: string; tasks?: CockpitPlanTask[] }, round?: number, log?: readonly CockpitLogEntry[]): CockpitWorkflowRun {
  const kept = runOf(run, launched.runId, round, log)
  return { ...kept, ...(launched.name !== undefined && { name: launched.name }), ...(launched.tasks !== undefined && { tasks: launched.tasks }) }
}

/** `id` joins the run `runId` (which a spawn reopens), its label becoming the run's phase and, when it names a round, the round. */
export function addWorkflowAgent(run: CockpitWorkflowRun | undefined, runId: string, id: string, label: string, now: number, conversationRound?: number, log?: readonly CockpitLogEntry[]): CockpitWorkflowRun {
  const kept = runOf(run, runId, conversationRound, log)
  const round = roundOf(label)
  return {
    ...kept,
    endedAt: undefined,
    isSilent: undefined,
    agents: kept.agents.some(a => a.id === id) ? kept.agents : [...kept.agents, { id, isDone: false, ...(label !== '' && { label }) }],
    ...(label !== '' && { phase: label }),
    ...(round !== undefined && { round: Math.max(round, kept.round ?? 0) }),
    lastAt: now,
  }
}

/** Marks agent `id` of the run finished; any other id leaves the run as it is. */
export function finishWorkflowAgent(run: CockpitWorkflowRun | undefined, id: string, now: number, isFailed = false): CockpitWorkflowRun | undefined {
  return run?.agents.some(a => a.id === id && !a.isDone) ? { ...run, agents: run.agents.map(a => (a.id === id ? { ...a, isDone: true, ...(isFailed && { isFailed: true }) } : a)), lastAt: now } : run
}

/** `run` after one of its agents did something (a step, a tool call): the silence the stall check measures starts over. */
export const touchRun = (run: CockpitWorkflowRun | undefined, agentId: string, now: number): CockpitWorkflowRun | undefined =>
  run?.endedAt === undefined && run?.agents.some(a => a.id === agentId) ? { ...run, lastAt: now } : run

/** `run` closed when a main turn starts with every agent it spawned finished: the result reached the main loop. A run with no agent yet is not closed. */
export const endRun = (run: CockpitWorkflowRun | undefined, now: number): CockpitWorkflowRun | undefined =>
  run && run.endedAt === undefined && run.agents.length > 0 && run.agents.every(a => a.isDone) ? { ...run, endedAt: now } : run

/** How long a run's agents may do nothing (no step, no tool call, no spawn) before the run is taken as dead: the engine never lists a workflow's agents, so a lost `turn.complete` leaves no other sign. */
export const WORKFLOW_SILENCE_MS = 15 * 60_000

/** `run` with every agent still open marked finished when the run has been silent longer than `WORKFLOW_SILENCE_MS`; any other run as it is. */
export const expireRun = (run: CockpitWorkflowRun | undefined, now: number): CockpitWorkflowRun | undefined =>
  run && run.endedAt === undefined && now - (run.lastAt ?? now) > WORKFLOW_SILENCE_MS && run.agents.some(a => !a.isDone)
    ? { ...run, agents: run.agents.map(a => (a.isDone ? a : { ...a, isDone: true, isFailed: true })) }
    : run

/** `run` after the silence check closed it: it stays unlogged (`isSilent`) until a newer run replaces it. */
export const silenceRun = (run: CockpitWorkflowRun | undefined): CockpitWorkflowRun | undefined =>
  run?.endedAt === undefined ? run : { ...run, isSilent: true }

/** The id of the run agent `agentId` belongs to; none for an agent outside it. */
export const runIdOf = (run: CockpitWorkflowRun | undefined, agentId: string): string | undefined =>
  run?.agents.some(a => a.id === agentId) ? run.runId : undefined

/** The run agent `a` belongs to: the one its spawn named, else the one `run` holds it in. */
export const agentRunId = (run: CockpitWorkflowRun | undefined, a: CockpitAgent): string | undefined => a.runId ?? runIdOf(run, a.id)

/**
 * The 'flow' node of `run` in `log`: its cost is the stored figure plus the agents logged since the node was written (so agents pruned from the log keep their cost),
 * its length runs from the first agent's start, `isFailed` when the run ended silent. A resumed run updates its one node.
 */
function flowLog(log: CockpitLogEntry[] | undefined, run: CockpitWorkflowRun, isFailed: boolean, endRound?: number): CockpitLogEntry[] {
  const prev = (log ?? []).find(e => e.kind === 'flow' && e.key === run.runId)
  const agents = (log ?? []).filter(e => e.kind === 'agent' && e.runId === run.runId && (prev === undefined || e.at > prev.at))
  const starts = [...(prev ? [prev.at - (prev.ms ?? 0)] : []), ...agents.map(e => e.at - (e.ms ?? 0))]
  const at = run.endedAt ?? run.lastAt ?? 0
  const n = Math.max(run.round ?? 0, prev?.n ?? 0)
  // a rewrite keeps where the flow started and its lane; the end is the round open now
  const round = prev?.round ?? run.startRound
  const lane = prev?.lane ?? run.lane
  const end = endRound ?? prev?.endRound
  return recordLog(log, {
    at,
    kind: 'flow',
    key: run.runId,
    ...(round !== undefined && { round }),
    ...(end !== undefined && { endRound: end }),
    ...(lane !== undefined && { lane }),
    usd: (prev?.usd ?? 0) + agents.reduce((sum, e) => sum + (e.usd ?? 0), 0),
    ...(run.name !== undefined && { text: run.name }),
    ...(starts.length > 0 && { ms: Math.max(0, at - Math.min(...starts)) }),
    ...(n > 0 && { n }),
    ...(isFailed && { isFailed: true }),
  })
}

/**
 * `log` after the run went from `before` to `after`: a run that closed (not by silence) writes its flow node; a run that never closed properly
 * (silent-closed, or still open) writes it, failed, once a different run replaces it. Anything else leaves the log as it was.
 */
export function logRunChange(log: CockpitLogEntry[] | undefined, before: CockpitWorkflowRun | undefined, after: CockpitWorkflowRun | undefined, round?: number): CockpitLogEntry[] | undefined {
  if (before && before.runId !== after?.runId && isUnclosed(before)) return flowLog(log, before, true, round)
  if (before && after && before.endedAt === undefined && after.endedAt !== undefined && after.isSilent !== true) return flowLog(log, after, false, round)
  return log
}

/**
 * `log` with an agent's own entry: an agent of a run whose flow node is already written (a run replaced while it still worked) adds its cost to that node,
 * which now ends with it, so its cost lands in the flow it belongs to and not in a round. An entry already in the log changes nothing.
 */
export function recordAgentLog(log: CockpitLogEntry[] | undefined, entry: CockpitLogEntry): CockpitLogEntry[] {
  const isNew = !(log ?? []).some(e => e.kind === entry.kind && e.key === entry.key)
  const next = recordLog(log, entry)
  const node = isNew && entry.runId !== undefined ? next.find(e => e.kind === 'flow' && e.key === entry.runId) : undefined
  if (node === undefined || entry.at <= node.at) return next
  return recordLog(next, { ...node, at: entry.at, usd: (node.usd ?? 0) + (entry.usd ?? 0), ms: (node.ms ?? 0) + (entry.at - node.at) })
}

/** The run still in flight; none once it ended. */
export const activeRun = (run: CockpitWorkflowRun | undefined): CockpitWorkflowRun | undefined => (run?.endedAt === undefined ? run : undefined)
