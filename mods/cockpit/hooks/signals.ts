import type { CockpitAgent, CockpitClaudeState, CockpitEvent, CockpitInsights, CockpitSnapshot, CockpitWorkflowRun } from '../types'
import { cacheHit, usdOf } from './pricing'
import { baseName, modelFamily } from './shared'
import { claimsOf } from './work'
import { activeRun } from './workflow'

/** Every limit a detector compares with, in one place. */
export const THRESHOLDS = {
  /** A subagent over this many new tokens, or over this percent of the session's cost. */
  subagentTokens: 150_000,
  subagentCostPct: 40,
  /** Agent types that only read: Opus on one of them is a waste. */
  readOnlyAgents: ['Explore', 'investigator', 'code-reviewer', 'ops-analyst', 'db-analyst'],
  /** A tool result over this many characters (the insights keep it as characters / 4). */
  resultChars: 20_000,
  /** The same file read this many times. */
  rereads: 3,
  /** The same command failed this many times. */
  failedCommands: 2,
  /** Cache hit under this percent after an idle gap over `idleGapMs`. */
  coldCachePct: 50,
  idleGapMs: 5 * 60_000,
  /** The context grew by this many tokens within this many rounds. */
  ctxGrowth: 100_000,
  ctxGrowthRounds: 3,
  /** This many done-claim blocks in the session. */
  doneClaims: 2,
  /** A workflow in a round past this one, or silent for this long. */
  workflowRound: 3,
  stallMs: 5 * 60_000,
  /** A permission asked of the person and unanswered for this long. */
  permissionWaitMs: 60_000,
}

export type SignalKind =
  | 'heavyAgent'
  | 'opusReadOnly'
  | 'bigResult'
  | 'reread'
  | 'failedCommand'
  | 'coldAfterIdle'
  | 'ctxGrowth'
  | 'doneClaims'
  | 'workflow'
  | 'permissionWait'

/** One thing that looks wrong: its kind, a key that tells two of a kind apart, and the number or name the text names. */
export type Signal = { kind: SignalKind; key: string; label?: string; n?: number }

/** What tells a notification from the others across readings (the pane's expanded row and its seen list hold it). */
export const signalId = (sig: Signal): string => `${sig.kind}:${sig.key}`

/** An agent with what it cost: the live ones priced from their counters, the finished ones from the Cronologia. */
export type AgentCost = { id: string; type: string; description?: string; model?: string; tokens: number; usd: number; hit?: number }

/** The agents of the session with their cost: live ones from their usage, finished ones (gone from the list) from the agent events. */
export function agentCosts(agents: readonly CockpitAgent[], events: readonly CockpitEvent[] | undefined): AgentCost[] {
  const live = agents.map((a): AgentCost => ({ id: a.id, type: a.type, description: a.description?.trim() || undefined, model: a.model, tokens: a.tokens, usd: usdOf(a.model, a.usage), hit: cacheHit(a.usage) }))
  const gone = (events ?? []).flatMap((e): AgentCost[] =>
    e.kind === 'agent' && e.id !== undefined && !live.some(a => a.id === e.id) ? [{ id: e.id, type: e.text ?? '?', description: e.desc?.trim() || undefined, model: e.model, tokens: e.tokens ?? 0, usd: e.usd ?? 0, hit: e.hit }] : [],
  )
  return [...live, ...gone]
}

export function detectHeavyAgents(agents: readonly AgentCost[], sessionUsd: number | undefined): Signal[] {
  return agents.flatMap((a): Signal[] => {
    const isShare = sessionUsd !== undefined && sessionUsd > 0 && (100 * a.usd) / sessionUsd > THRESHOLDS.subagentCostPct
    return a.tokens > THRESHOLDS.subagentTokens || isShare ? [{ kind: 'heavyAgent', key: a.id, label: a.type, n: a.tokens }] : []
  })
}

export function detectOpusReadOnly(agents: readonly { id: string; type: string; model?: string }[]): Signal[] {
  return agents.filter(a => modelFamily(a.model) === 'opus' && THRESHOLDS.readOnlyAgents.includes(a.type)).map(a => ({ kind: 'opusReadOnly', key: a.id, label: a.type }))
}

export function detectBigResults(biggest: CockpitInsights['biggest']): Signal[] {
  return (biggest ?? []).filter(r => r.tokens * 4 > THRESHOLDS.resultChars).map(r => ({ kind: 'bigResult', key: `${r.tool}:${r.arg ?? ''}`, label: r.tool, n: r.tokens * 4 }))
}

export function detectRereads(reads: Readonly<Record<string, number>> | undefined): Signal[] {
  return Object.entries(reads ?? {}).filter(([, n]) => n >= THRESHOLDS.rereads).map(([file, n]) => ({ kind: 'reread', key: file, label: baseName(file), n }))
}

export function detectFailedCommands(failed: Readonly<Record<string, number>> | undefined): Signal[] {
  return Object.entries(failed ?? {}).filter(([, n]) => n >= THRESHOLDS.failedCommands).map(([cmd, n]) => ({ kind: 'failedCommand', key: cmd, label: cmd, n }))
}

/** The last round, when it came back to a cold cache after an idle gap. */
export function detectColdAfterIdle(ins: CockpitInsights | undefined): Signal[] {
  const c = ins?.idleCold
  return c !== undefined && c.round === ins?.rounds && c.share < THRESHOLDS.coldCachePct && c.gapMs > THRESHOLDS.idleGapMs ? [{ kind: 'coldAfterIdle', key: String(c.round), n: c.share }] : []
}

/** The context grew by `ctxGrowth` or more over the last `ctxGrowthRounds` rounds (a compaction's drop in between does not hide it). */
export function detectCtxGrowth(rounds: readonly number[] | undefined): Signal[] {
  const list = rounds ?? []
  const last = list.at(-1)
  if (last === undefined) return []
  const before = list.slice(-1 - THRESHOLDS.ctxGrowthRounds, -1)
  const grew = last - Math.min(...before)
  return before.length > 0 && grew >= THRESHOLDS.ctxGrowth ? [{ kind: 'ctxGrowth', key: String(list.length), n: grew }] : []
}

export function detectDoneClaims(count: number): Signal[] {
  return count >= THRESHOLDS.doneClaims ? [{ kind: 'doneClaims', key: 'claims', n: count }] : []
}

/** Whether a run in flight has been silent past `stallMs`. */
export const isStalled = (run: CockpitWorkflowRun | undefined, now: number): boolean => {
  const open = activeRun(run)
  return open !== undefined && open.agents.some(a => !a.isDone) && open.lastAt !== undefined && now - open.lastAt > THRESHOLDS.stallMs
}

export function detectWorkflow(run: CockpitWorkflowRun | undefined, now: number): Signal[] {
  const open = activeRun(run)
  if (!open) return []
  const out: Signal[] = []
  if (isStalled(open, now)) out.push({ kind: 'workflow', key: `${open.runId}:stall`, label: 'stall' })
  if ((open.round ?? 0) > THRESHOLDS.workflowRound) out.push({ kind: 'workflow', key: `${open.runId}:round`, label: 'round', n: open.round })
  return out
}

export function detectPermissionWait(state: CockpitClaudeState | undefined, now: number): Signal[] {
  return state?.kind === 'waiting' && state.since !== undefined && now - state.since > THRESHOLDS.permissionWaitMs ? [{ kind: 'permissionWait', key: String(state.since), n: now - state.since }] : []
}

/** Every signal that holds now, from the snapshot alone (no clock, no model). */
export function signalsOf(s: CockpitSnapshot): Signal[] {
  const costs = agentCosts(s.agents, s.events)
  return [
    ...detectHeavyAgents(costs, s.cost.usd),
    ...detectOpusReadOnly(costs),
    ...detectBigResults(s.insights?.biggest),
    ...detectRereads(s.insights?.reads),
    ...detectFailedCommands(s.insights?.failedCmds),
    ...detectColdAfterIdle(s.insights),
    ...detectCtxGrowth(s.ctxRounds),
    ...detectDoneClaims(claimsOf(s.doneClaims, s.sessionId).length),
    ...detectWorkflow(s.workflowRun, s.now),
    ...detectPermissionWait(s.claudeState, s.now),
  ]
}
