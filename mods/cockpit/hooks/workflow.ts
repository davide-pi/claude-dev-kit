import type { CockpitAgent, CockpitLogEntry, CockpitWorkflowRun } from '../types'
import { isRecord } from './shared'
import { recordLog } from './timeline'

// ── The workflow run in flight, from the events that really reach the mod: the `Workflow` tool's result names it, the `agent.spawn` of its agents counts it ──

/** The round a script's agent label names (`fix round 2 findings`, `reviewer A · round 1 · code`): the number after `round` (or after `R`); none for a label without one. */
export function roundOf(label: string): number | undefined {
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

/** The run `runId` as `run` keeps it, or a new empty one when `run` is another one (a new run starts a new count). */
const runOf = (run: CockpitWorkflowRun | undefined, runId: string): CockpitWorkflowRun => (run?.runId === runId ? run : { runId, agents: [] })

/** `run` after a `Workflow` result named its script: the name joins the run it announces. */
export function nameRun(run: CockpitWorkflowRun | undefined, launched: { runId: string; name?: string }): CockpitWorkflowRun {
  const kept = runOf(run, launched.runId)
  return launched.name === undefined ? kept : { ...kept, name: launched.name }
}

/** `id` joins the run `runId` (which a spawn reopens), its label becoming the run's phase and, when it names a round, the round. */
export function addWorkflowAgent(run: CockpitWorkflowRun | undefined, runId: string, id: string, label: string, now: number): CockpitWorkflowRun {
  const kept = runOf(run, runId)
  const round = roundOf(label)
  return {
    ...kept,
    endedAt: undefined,
    isSilent: undefined,
    agents: kept.agents.some(a => a.id === id) ? kept.agents : [...kept.agents, { id, isDone: false }],
    ...(label !== '' && { phase: label }),
    ...(round !== undefined && { round: Math.max(round, kept.round ?? 0) }),
    lastAt: now,
  }
}

/** Marks agent `id` of the run finished; any other id leaves the run as it is. */
export function finishWorkflowAgent(run: CockpitWorkflowRun | undefined, id: string, now: number): CockpitWorkflowRun | undefined {
  return run?.agents.some(a => a.id === id && !a.isDone) ? { ...run, agents: run.agents.map(a => (a.id === id ? { ...a, isDone: true } : a)), lastAt: now } : run
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
    ? { ...run, agents: run.agents.map(a => ({ ...a, isDone: true })) }
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
function flowLog(log: CockpitLogEntry[] | undefined, run: CockpitWorkflowRun, isFailed: boolean): CockpitLogEntry[] {
  const prev = (log ?? []).find(e => e.kind === 'flow' && e.key === run.runId)
  const agents = (log ?? []).filter(e => e.kind === 'agent' && e.runId === run.runId && (prev === undefined || e.at > prev.at))
  const starts = [...(prev ? [prev.at - (prev.ms ?? 0)] : []), ...agents.map(e => e.at - (e.ms ?? 0))]
  const at = run.endedAt ?? run.lastAt ?? 0
  const n = Math.max(run.round ?? 0, prev?.n ?? 0)
  return recordLog(log, {
    at,
    kind: 'flow',
    key: run.runId,
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
export function logRunChange(log: CockpitLogEntry[] | undefined, before: CockpitWorkflowRun | undefined, after: CockpitWorkflowRun | undefined): CockpitLogEntry[] | undefined {
  const isUnclosed = before !== undefined && before.agents.length > 0 && (before.isSilent === true ? before.endedAt !== undefined : before.endedAt === undefined)
  if (before && before.runId !== after?.runId && isUnclosed) return flowLog(log, before, true)
  if (before && after && before.endedAt === undefined && after.endedAt !== undefined && after.isSilent !== true) return flowLog(log, after, false)
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
