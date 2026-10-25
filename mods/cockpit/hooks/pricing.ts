import type { CockpitUsage } from '../types'
import { modelFamily } from './shared'

/**
 * List prices in USD per million tokens by model family, the current generation: input, output and cache read. A cache write is 1.25x
 * the input (the 5-minute entry). Source: the claude-api skill's "Current Models" table (cached 2026-10-06): Opus 5.5 $4/$20 with
 * cache reads $0.20, Sonnet 5.5 $2/$10 with cache reads $0.20, Haiku 5.5 $0.10/$0.50 (prompts up to 100K; a cache read is assumed
 * at 0.1x, the skill gives none), Fable 5.1 $10/$50 with cache reads $0.25. The engine reports a session cost (`session.measure`) but no
 * cost per agent or per turn, so those stay estimates.
 */
const PRICES = {
  opus: { in: 4, out: 20, read: 0.2 },
  sonnet: { in: 2, out: 10, read: 0.2 },
  haiku: { in: 0.1, out: 0.5, read: 0.01 },
  fable: { in: 10, out: 50, read: 0.25 },
} as const
const CACHE_WRITE = 1.25

/** The cost in USD of `usage` on `model`; an unknown model is priced as Sonnet. */
export function usdOf(model: string | undefined, usage: CockpitUsage | undefined): number {
  if (!usage) return 0
  const p = PRICES[modelFamily(model) ?? 'sonnet']
  return (usage.input * p.in + usage.output * p.out + usage.cacheRead * p.read + usage.cacheWrite * p.in * CACHE_WRITE) / 1e6
}

/** The share of the input a prompt cache served, 0-100; undefined without input. */
export function cacheHit(usage: CockpitUsage | undefined): number | undefined {
  if (!usage) return undefined
  const total = usage.input + usage.cacheRead + usage.cacheWrite
  return total > 0 ? Math.round((100 * usage.cacheRead) / total) : undefined
}
