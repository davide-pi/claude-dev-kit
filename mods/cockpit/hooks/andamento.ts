import type { CockpitSnapshot } from '../types'
import { autocompactForecast } from './context'
import { usdOf } from './pricing'

// ── Andamento: where the session's money goes and how the next compaction looks ──

/** A part of the spend under this share joins "other". */
const OTHER_BELOW_PCT = 5
/** A figure within this share of what it is compared with is flat. */
const FLAT_BAND = 0.1
/** The share of the autocompact threshold from which a compact is due, as a fraction (3 / 4). */
const DUE_NUM = 3
const DUE_DEN = 4

/** The USD of the agents: the finished ones' accumulator by type, and the running ones priced from their usage (a finished one still listed is already in the accumulator). */
const agentParts = (s: CockpitSnapshot): Map<string, number> => {
  const parts = new Map(Object.entries(s.agentSpend ?? {}))
  for (const a of s.agents) if (a.status === 'running') parts.set(a.type, (parts.get(a.type) ?? 0) + usdOf(a.model, a.usage))
  return parts
}

const sum = (parts: Iterable<number>): number => [...parts].reduce((n, v) => n + v, 0)

/**
 * The session's spend by who spent it: the main loop (the total minus the agents) and one part per agent type, biggest share first.
 * Parts under 5% of the total join one "other" part, last. Empty when no cost was measured and no agent has spent.
 */
export function spendSplit(s: CockpitSnapshot): { label: string; usd: number; pct: number }[] {
  const agents = agentParts(s)
  const agentsUsd = sum(agents.values())
  const total = s.cost.usd ?? agentsUsd
  if (!(total > 0)) return []
  const part = (label: string, usd: number) => ({ label, usd, pct: (100 * usd) / total })
  const main = total - agentsUsd
  const typed = [...agents].filter(([, usd]) => usd > 0).map(([label, usd]) => part(label, usd))
  const small = typed.filter(p => p.pct < OTHER_BELOW_PCT)
  const kept = [...(main > 0 ? [part('main', main)] : []), ...typed.filter(p => p.pct >= OTHER_BELOW_PCT)].sort((a, b) => b.pct - a.pct)
  return small.length > 0 ? [...kept, part('other', sum(small.map(p => p.usd)))] : kept
}

/** The agent spend a data file keeps: the positive finite amounts by type; none for anything else. */
export function parseAgentSpend(value: unknown): Record<string, number> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const kept = Object.entries(value).filter((e): e is [string, number] => typeof e[1] === 'number' && Number.isFinite(e[1]) && e[1] > 0)
  return kept.length > 0 ? Object.fromEntries(kept) : undefined
}

const trendOf = (value: number, reference: number): 'up' | 'flat' | 'down' =>
  value > reference * (1 + FLAT_BAND) ? 'up' : value < reference * (1 - FLAT_BAND) ? 'down' : 'flat'

/**
 * The figures of the Andamento section. `perPrompt`: the main rounds' cost over their count (a round is one main turn, its cost the session delta
 * including subagents). `trend`: that figure against `costTarget` when `cockpit.json` has one, else the last round against the session mean; flat
 * when nothing can be compared. `agentPct`: the agents' share of the spend. `turnsLeft`: the autocompact forecast. `isCompactDue`: the context is at
 * 75% of where the engine compacts or more.
 */
export function andamento(s: CockpitSnapshot): { perPrompt?: number; target?: number; trend: 'up' | 'flat' | 'down'; agentPct?: number; turnsLeft?: number; isCompactDue: boolean } {
  const { insights, costTarget: target } = s
  const perPrompt = insights && insights.rounds > 0 ? insights.usd / insights.rounds : undefined
  const last = s.cost.lastUsd
  const trend = perPrompt === undefined ? 'flat' : target !== undefined ? trendOf(perPrompt, target) : last === undefined ? 'flat' : trendOf(last, perPrompt)
  const agentsUsd = sum(agentParts(s).values())
  const total = s.cost.usd ?? (agentsUsd > 0 ? agentsUsd : undefined)
  const tokens = s.ctx.tokens
  const turnsLeft = autocompactForecast(s.ctxSamples, s.autoCompactAt)
  return {
    ...(perPrompt !== undefined && { perPrompt }),
    ...(target !== undefined && { target }),
    trend,
    ...(total !== undefined && total > 0 && { agentPct: (100 * agentsUsd) / total }),
    ...(turnsLeft !== undefined && { turnsLeft }),
    isCompactDue: tokens !== undefined && s.autoCompactAt !== undefined && tokens * DUE_DEN >= s.autoCompactAt * DUE_NUM,
  }
}
