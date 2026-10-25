import type { CockpitUsage } from '../types'
import { cacheHit, usdOf } from './pricing'

/** The usage counters by model priced and ranked: dearest first. */
export const modelRows = (use: Readonly<Record<string, CockpitUsage>> | undefined): { model: string; usd: number; hit?: number }[] =>
  Object.entries(use ?? {})
    .map(([model, usage]) => ({ model, usd: usdOf(model, usage), hit: cacheHit(usage) }))
    .sort((a, b) => b.usd - a.usd)

