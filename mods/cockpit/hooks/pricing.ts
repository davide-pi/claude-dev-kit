import type { CockpitUsage } from '../types'
import { modelFamily } from './shared'

/** List prices in USD per million tokens by model family: input and output; a cache read costs a tenth of the input, a cache write a quarter more. An estimate: the engine reports no price per model. */
const PRICES = { opus: { in: 5, out: 25 }, sonnet: { in: 3, out: 15 }, haiku: { in: 1, out: 5 }, fable: { in: 3, out: 15 } } as const
const CACHE_READ = 0.1
const CACHE_WRITE = 1.25

/** The cost in USD of `usage` on `model`; an unknown model is priced as Sonnet. */
export function usdOf(model: string | undefined, usage: CockpitUsage | undefined): number {
  if (!usage) return 0
  const p = PRICES[modelFamily(model) ?? 'sonnet']
  return (usage.input * p.in + usage.output * p.out + usage.cacheRead * p.in * CACHE_READ + usage.cacheWrite * p.in * CACHE_WRITE) / 1e6
}

/** The share of the input a prompt cache served, 0-100; undefined without input. */
export function cacheHit(usage: CockpitUsage | undefined): number | undefined {
  if (!usage) return undefined
  const total = usage.input + usage.cacheRead + usage.cacheWrite
  return total > 0 ? Math.round((100 * usage.cacheRead) / total) : undefined
}
