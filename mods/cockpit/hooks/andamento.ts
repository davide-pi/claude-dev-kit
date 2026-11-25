import type { CockpitSnapshot } from '../types'

// ── Andamento: whether the next compaction is due ──

/** The share of the autocompact threshold from which a compact is due, as a fraction (3 / 4). */
const DUE_NUM = 3
const DUE_DEN = 4

/** The context is at 75% of where the engine compacts or more: a compact is due. */
export function andamento(s: CockpitSnapshot): { isCompactDue: boolean } {
  const tokens = s.ctx.tokens
  return { isCompactDue: tokens !== undefined && s.autoCompactAt !== undefined && tokens * DUE_DEN >= s.autoCompactAt * DUE_NUM }
}
