import type { CockpitEvent, CockpitRateLimit, CockpitSnapshot, CockpitUsage } from '../types'
import { cacheHit, usdOf } from './pricing'
import { signalsOf } from './signals'
import { fmtCost } from './shared'
import { t } from './strings'
import { parseReset } from './session'

const HOUR_MS = 3_600_000
const FIVE_HOURS_MS = 5 * HOUR_MS
/** The $/h needs this much of the session behind it to mean anything. */
const RATE_MIN_MS = 60_000

/** The rounds that carry a cost, oldest first: their number (the event's key) and what they cost. */
export const roundCosts = (events: readonly CockpitEvent[] | undefined): { n: number; usd: number; ms: number }[] =>
  (events ?? []).filter(e => e.kind === 'round').flatMap((e, i) => (e.usd !== undefined ? [{ n: Number(e.key) || i + 1, usd: e.usd, ms: e.ms ?? 0 }] : []))

/** The `count` dearest rounds, dearest first. */
export const topRounds = (rounds: readonly { n: number; usd: number; ms: number }[], count = 3) => [...rounds].sort((a, b) => b.usd - a.usd || a.n - b.n).slice(0, count)

/** The session's cost per hour since its first reading; none before a minute of it. */
export function perHour(usd: number | undefined, startedAt: number | undefined, now: number): number | undefined {
  if (usd === undefined || startedAt === undefined || now - startedAt < RATE_MIN_MS) return undefined
  return (usd * HOUR_MS) / (now - startedAt)
}

/**
 * Where the 5h credits go at the pace of the window so far: `runOut` with the time left before they are used up when that is before the
 * window's reset, else `hold`. None without a 5h reading, a reset time, or any use yet.
 */
export function creditProjection(rates: readonly CockpitRateLimit[], now: number): { kind: 'hold' } | { kind: 'runOut'; inMs: number; resetsAt: number } | undefined {
  const five = rates.find(r => r.kind === 'five_hour')
  const resetsAt = parseReset(five?.resetsAt)
  if (!five || resetsAt === undefined || resetsAt <= now) return undefined
  const elapsed = now - (resetsAt - FIVE_HOURS_MS)
  if (elapsed <= 0 || five.percentUsed <= 0) return undefined
  const inMs = ((100 - five.percentUsed) / five.percentUsed) * elapsed
  return now + inMs < resetsAt ? { kind: 'runOut', inMs, resetsAt } : { kind: 'hold' }
}

/** The usage counters by model priced and ranked: dearest first. */
export const modelRows = (use: Readonly<Record<string, CockpitUsage>> | undefined): { model: string; usd: number; hit?: number }[] =>
  Object.entries(use ?? {})
    .map(([model, usage]) => ({ model, usd: usdOf(model, usage), hit: cacheHit(usage) }))
    .sort((a, b) => b.usd - a.usd)

/** The session's cost as text for the prompt box: no model call, only what the pane already holds. */
export function costSummary(s: CockpitSnapshot): string {
  const S = t().summary
  const rounds = roundCosts(s.events)
  const rate = perHour(s.cost.usd, s.startedAt, s.now)
  const models = modelRows(s.modelUse).map(m => `${m.model} ${fmtCost(m.usd)}${m.hit === undefined ? '' : ` (cache ${m.hit}%)`}`)
  const five = (s.rateLimits.length > 0 ? s.rateLimits : (s.lastRates ?? [])).find(r => r.kind === 'five_hour')
  return [
    t().summaryTitle,
    S.cost(fmtCost(s.cost.usd), s.insights?.rounds ?? rounds.length, rate === undefined ? undefined : fmtCost(rate)),
    ...(models.length > 0 ? [S.models(models.join(', '))] : []),
    ...(five ? [S.credits(Math.round(five.percentUsed))] : []),
    S.signals(signalsOf(s).length),
  ].join('\n')
}
