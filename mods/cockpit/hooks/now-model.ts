import type { CockpitAgent, CockpitSnapshot } from '../types'
import { nextRoundNumber } from './round-capture'
import { clockTime, costCell, duration, shownTurnUsd } from './shared'
import { t } from './strings'
import { orderAgents, visibleAgents } from './view-agents'
import { activeRun, agentRunId, steppedAgents, taskRows } from './workflow'

// ── The `In corso` tab's data, shared by the desktop and the terminal drawings ──

/** A value the open request does not know yet. */
export const NONE = '—'
const COST_W = 7

export type StepState = 'done' | 'failed' | 'running'
export type Segment = { step: string; state: StepState }

/** The step segments of the flow's newest block: each distinct step in the order it began. */
export function segmentsOf(s: CockpitSnapshot): Segment[] {
  const run = s.workflowRun
  const labelled = steppedAgents(run)
  const newest = Math.max(0, ...labelled.map(l => l.block ?? 0))
  const inBlock = labelled.filter(x => (x.block ?? newest) === newest)
  // the steps without a task (suite, review, fix) follow the last wave; a step with several agents (build runs one per task) is running if any runs, failed if any failed, else done
  return [...new Set(inBlock.map(l => l.step))].map(step => {
    const mine = inBlock.filter(l => l.step === step)
    return { step, state: mine.some(l => !l.isDone) ? 'running' : mine.some(l => l.isFailed) ? 'failed' : 'done' }
  })
}

/** The running agents the open run (live or silent) does not claim, in the list's order; one of a run that is not the open one stays listed. */
export function outsideAgents(s: CockpitSnapshot): { agent: CockpitAgent; depth: number }[] {
  const run = s.workflowRun
  const open = run !== undefined && (activeRun(run) !== undefined || run.isSilent === true) ? run.runId : undefined
  return orderAgents(visibleAgents(s).filter(a => a.status === 'running' && (open === undefined || agentRunId(run, a) !== open)))
}

/** The open request: whether it is open, its prompt (or the empty line) and its facts (round, start, duration, cost); the facts are a blank while closed. */
export function requestOf(s: CockpitSnapshot): { isOpen: boolean; prompt: string; facts: string } {
  const S = t().desk.now
  const E = t().page.events
  const isOpen = s.roundPrompt !== undefined || (s.claudeState !== undefined && s.claudeState.kind !== 'idle')
  const lastRound = (s.sessionLog ?? []).filter(e => e.kind === 'round').at(-1)
  const since = s.roundStartedAt ?? lastRound?.at ?? s.startedAt
  const turnUsd = shownTurnUsd(s.cost)
  const facts = isOpen
    ? [E.round(nextRoundNumber(s)), since === undefined ? NONE : clockTime(since), since === undefined ? NONE : duration(Math.max(0, s.now - since)), turnUsd === undefined ? NONE : `$${costCell(turnUsd, COST_W).slice(1).trim()}`].join(' · ')
    : ' '
  return { isOpen, prompt: isOpen ? (s.roundPrompt ?? ' ') : S.noRequest, facts }
}

/** The flow: whether a run is open (or silent), its name, its cycle and the steps of its newest block. */
export function flowOf(s: CockpitSnapshot): { isLive: boolean; isSilent: boolean; name: string; cycle: string; segments: Segment[] } {
  const S = t().desk.now
  const run = s.workflowRun
  const isLive = run !== undefined && (activeRun(run) !== undefined || run.isSilent === true)
  const blocks = isLive ? taskRows(run).flatMap(r => (r.block === undefined ? [] : [r.block])) : []
  const total = blocks.length === 0 ? undefined : Math.max(run?.round ?? 0, ...blocks)
  const cycle = !isLive || run?.round === undefined ? NONE : `${S.cycle} ${run.round}${total === undefined ? '' : `/${total}`}`
  return { isLive, isSilent: run?.isSilent === true, name: run?.name ?? run?.runId ?? NONE, cycle, segments: isLive ? segmentsOf(s) : [] }
}
