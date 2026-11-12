import type { CockpitAgent, CockpitClaudeState, CockpitEvent, CockpitInsights, CockpitSnapshot, CockpitWorkflowRun } from '../types'
import { usdOf } from './pricing'
import { baseName, modelFamily } from './shared'
import { recordLog } from './timeline'
import { claimsOf } from './work'
import { activeRun } from './workflow'

/** Every limit a detector compares with, in one place. */
export const THRESHOLDS = {
  /**
   * A subagent over this cost in USD, or over this percent of the session's cost. Not its cumulative tokens: they grow with every call
   * whatever the context, so a long implementer always crossed them (measured 2026-11: implementer p50 $0.45, p90 $1.37, max $2.07).
   */
  subagentUsd: 2,
  subagentCostPct: 40,
  /** Agent types that only read: Opus on one of them is a waste (a reviewer is left out: the kit puts one on Opus on purpose). */
  readOnlyAgents: ['Explore', 'investigator', 'ops-analyst', 'db-analyst'],
  /** A tool result over this many characters (the insights keep it as characters / 4). */
  resultChars: 20_000,
  /** The same file read this many times (a read after each edit is normal: three is still work, not waste). */
  rereads: 4,
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
  /** A workflow in a round past this one (a review loop's fourth round is still normal), or silent for this long (an implementer often works 5 min unseen). */
  workflowRound: 4,
  stallMs: 10 * 60_000,
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

/** How much a notification asks of the person: `block` stops the work, `warn` costs money or risks it, `info` is a hint. */
export type SignalSeverity = 'block' | 'warn' | 'info'

export function signalSeverity(sig: Signal): SignalSeverity {
  switch (sig.kind) {
    case 'permissionWait':
      return 'block'
    case 'workflow':
      return sig.label === 'stall' ? 'block' : 'warn'
    case 'failedCommand':
    case 'ctxGrowth':
    case 'heavyAgent':
    case 'doneClaims':
      return 'warn'
    case 'reread':
    case 'bigResult':
    case 'opusReadOnly':
    case 'coldAfterIdle':
      return 'info'
  }
}

/** What tells a notification from the others across readings (the pane's expanded row and its seen list hold it). */
export const signalId = (sig: Signal): string => `${sig.kind}:${sig.key}`

/** An agent with what it cost: the live ones priced from their counters, the finished ones from the Cronologia. */
export type AgentCost = { id: string; type: string; model?: string; tokens: number; usd?: number }

/** The agents of the session with their cost: live ones from their usage, finished ones (gone from the list) from the agent events. */
export function agentCosts(agents: readonly CockpitAgent[], events: readonly CockpitEvent[] | undefined): AgentCost[] {
  const live = agents.map((a): AgentCost => ({ id: a.id, type: a.type, model: a.model, tokens: a.tokens, ...(a.usage !== undefined && { usd: usdOf(a.model, a.usage) }) }))
  const gone = (events ?? []).flatMap((e): AgentCost[] =>
    e.kind === 'agent' && e.id !== undefined && !live.some(a => a.id === e.id) ? [{ id: e.id, type: e.text ?? '?', model: e.model, tokens: e.tokens ?? 0, usd: e.usd }] : [],
  )
  return [...live, ...gone]
}

export function detectHeavyAgents(agents: readonly AgentCost[], sessionUsd: number | undefined): Signal[] {
  return agents.flatMap((a): Signal[] => {
    const usd = a.usd ?? 0
    const isShare = sessionUsd !== undefined && sessionUsd > 0 && (100 * usd) / sessionUsd > THRESHOLDS.subagentCostPct
    return usd > THRESHOLDS.subagentUsd || isShare ? [{ kind: 'heavyAgent', key: a.id, label: a.type, n: usd }] : []
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
export function detectCtxGrowth(rounds: readonly number[] | undefined, roundCount?: number): Signal[] {
  const list = rounds ?? []
  const last = list.at(-1)
  if (last === undefined) return []
  const before = list.slice(-1 - THRESHOLDS.ctxGrowthRounds, -1)
  const grew = last - Math.min(...before)
  return before.length > 0 && grew >= THRESHOLDS.ctxGrowth ? [{ kind: 'ctxGrowth', key: String(roundCount ?? list.length), n: grew }] : []
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

/** `s` with `signalsAt` naming each signal in force, at `at` for one new and its time kept for one already there; `s` itself when the set did not change. */
export function withSignalTimes(s: CockpitSnapshot, at: number): CockpitSnapshot {
  const prev = s.signalsAt ?? {}
  const ids = [...new Set(signalsOf(s).map(signalId))]
  if (ids.length === Object.keys(prev).length && ids.every(id => id in prev)) return s
  return { ...s, signalsAt: Object.fromEntries(ids.map(id => [id, prev[id] ?? at])) }
}

export const SIGNAL_KINDS: readonly string[] = ['heavyAgent', 'opusReadOnly', 'bigResult', 'reread', 'failedCommand', 'coldAfterIdle', 'ctxGrowth', 'doneClaims', 'workflow', 'permissionWait']

/** The signal a log entry names (`kind:key`, its label and number); none when the entry is not one of a kind known. */
export function loggedSignal(e: { key?: string; text?: string; n?: number }): Signal | undefined {
  const [kind, ...rest] = (e.key ?? '').split(':')
  if (kind === undefined || !SIGNAL_KINDS.includes(kind)) return undefined
  return { kind: kind as SignalKind, key: rest.join(':'), ...(e.text !== undefined && { label: e.text }), ...(e.n !== undefined && { n: e.n }) }
}

/** `s` with a session log entry for each signal in force that the log does not hold yet, at the time `signalsAt` gives it (else `at`): a notification is logged once, the first time it holds. `s` itself when there is none. */
export function withLoggedSignals(s: CockpitSnapshot, at: number): CockpitSnapshot {
  const logged = new Set((s.sessionLog ?? []).filter(e => e.kind === 'signal').map(e => e.key))
  const fresh = signalsOf(s).filter(sig => !logged.has(signalId(sig)))
  if (fresh.length === 0) return s
  const sessionLog = fresh.reduce<CockpitSnapshot['sessionLog']>(
    (log, sig) => recordLog(log, { at: s.signalsAt?.[signalId(sig)] ?? at, kind: 'signal', key: signalId(sig), severity: signalSeverity(sig), ...(sig.label !== undefined && { text: sig.label }), ...(sig.n !== undefined && { n: sig.n }) }),
    s.sessionLog,
  )
  return { ...s, sessionLog }
}

/** Every signal that holds now, from the snapshot alone (no clock, no model); one id only once (the same result read twice is one notification). */
export function signalsOf(s: CockpitSnapshot): Signal[] {
  // the model of a workflow run's agent is the flow's choice, so Opus there is no waste; its size is still a cost to see, whoever started it
  const inRun = new Set([...s.agents.filter(a => a.runId !== undefined).map(a => a.id), ...(s.workflowRun?.agents.map(a => a.id) ?? [])])
  const costs = agentCosts(s.agents, s.events)
  const all = [
    ...detectHeavyAgents(costs, s.cost.usd),
    ...detectOpusReadOnly(costs.filter(a => !inRun.has(a.id))),
    ...detectBigResults(s.insights?.biggest),
    ...detectRereads(s.insights?.reads),
    ...detectFailedCommands(s.insights?.failedCmds),
    ...detectColdAfterIdle(s.insights),
    ...detectCtxGrowth(s.ctxRounds, s.insights?.rounds),
    ...detectDoneClaims(claimsOf(s.doneClaims, s.sessionId).length),
    ...detectWorkflow(s.workflowRun, s.now),
    ...detectPermissionWait(s.claudeState, s.now),
  ]
  return all.filter((sig, i) => all.findIndex(o => signalId(o) === signalId(sig)) === i)
}
