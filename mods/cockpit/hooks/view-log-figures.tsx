import { costCell, duration } from './shared'
import type { Span } from './shared'
import { dim, sp } from './view-base'
import type { G } from './view-log-entries'

/** LOG shows this many nodes (an open one with its whole subtree); the rest sits behind its toggle. */
export const DONE_ROWS = 5
/** The cells of the three figure slots at a row's end: a length (`01m00s`), a cost, a cost share (`100%`). */
const DURATION_W = 6
const COST_W = 7
const SHARE_W = 4

/** The figures of a node or an agent, dim, in three fixed slots (length, cost, share of the session's cost) so every row's columns line up; a missing value is blank; none at all, no figures. */
export function figures(usd: number | undefined, ms: number | undefined, sessionUsd: number | undefined): Span[] {
  if (usd === undefined && ms === undefined) return []
  const share = usd !== undefined && sessionUsd !== undefined && sessionUsd > 0 ? `${Math.round((usd / sessionUsd) * 100)}%` : ''
  return [dim(ms === undefined ? ' '.repeat(DURATION_W) : duration(ms)), sp(' '), dim(usd === undefined ? ' '.repeat(COST_W) : costCell(usd, COST_W)), sp(' '), dim(share.padStart(SHARE_W))]
}

/** When a node began: its end less its length; the open round and a merged run only know their `at`. */
export const startOf = (g: G): number => (g.ms !== undefined && !g.isCurrent ? g.at - g.ms : g.at)
