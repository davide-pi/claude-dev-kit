import type { CockpitWorkflowRun } from '../types'
import { isRecord } from './shared'

// ── The workflow run in flight, from the events that really reach the mod: the `Workflow` tool's result names it, the `agent.spawn` of its agents counts it ──

/** The round a script's agent label names (`fix R2`, `cleanup R1`): the number after `R`; none for a label without one. */
export function roundOf(label: string): number | undefined {
  const found = /\bR(\d+)\b/.exec(label)
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

/** The run still in flight; none once it ended. */
export const activeRun = (run: CockpitWorkflowRun | undefined): CockpitWorkflowRun | undefined => (run?.endedAt === undefined ? run : undefined)
