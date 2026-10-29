import type { CockpitContext, CockpitContextRow } from '../types'
import {
  COLORS,
  abbrevTokens,
  barCells,
  padCells,
  shade,
  truncEnd,
  withBackground,
} from './shared'
import type { Span } from './shared'
import { t } from './strings'
import { dim, padStart, sp } from './view-base'

/** Cells of the Context rows: a category's tokens and share of the window, and what follows them (the exact mark and the change of the last round). */
const CTX_TOKENS_W = 6
const CTX_SHARE_W = 5
const CTX_MARK_W = 2
const CTX_DELTA_W = 6
/** The colors of the used categories, in turn. */
const CATEGORY_COLORS = [COLORS.blue, COLORS.lavender, COLORS.amber, COLORS.green, COLORS.yellow, COLORS.orange, COLORS.violet, COLORS.gray]

/** The bar of the window: a part per used category, each its own color; the rest stays empty. */
export function contextBar(c: CockpitContext, width: number): Span[] {
  let n = 0
  const parts = c.rows.flatMap(r => {
    if (r.kind !== 'used') return []
    const color = CATEGORY_COLORS[n++ % CATEGORY_COLORS.length] ?? COLORS.gray
    return [{ pct: c.max > 0 ? (100 * r.tokens) / c.max : 0, color }]
  })
  return barCells(width, parts)
}

/**
 * One category row, exactly `width` cells: a square in the bar color, its name cut to fit, its tokens and its share of the window; a yellow `~`
 * when the tokens of a used category are an estimate and the change of the last round (`+12k`, blank when it did not move). The first
 * cells, in proportion to the share of the window, sit on the `bg` background: the row carries its own bar.
 */
export function categorySpans(r: CockpitContextRow, color: string, bg: string, max: number, width: number): Span[] {
  const nameW = Math.max(4, width - 2 - CTX_TOKENS_W - CTX_SHARE_W - CTX_MARK_W - CTX_DELTA_W)
  const share = max > 0 ? `${Math.round((100 * r.tokens) / max)}%` : ''
  const delta = r.delta ? padStart(`${r.delta > 0 ? '+' : '−'}${abbrevTokens(Math.abs(r.delta))}`, CTX_DELTA_W) : ' '.repeat(CTX_DELTA_W)
  const row = [
    sp('󰝤', color),
    sp(' '),
    sp(padCells(truncEnd(t().contextCategories[r.name] ?? r.name, nameW), nameW)),
    sp(padStart(abbrevTokens(r.tokens), CTX_TOKENS_W)),
    dim(padStart(share, CTX_SHARE_W)),
    r.kind === 'used' && !r.isExact ? sp(' ~', COLORS.yellow) : dim('  '),
    dim(delta),
  ]
  return withBackground(row, r.tokens > 0 && max > 0 ? Math.max(1, Math.round((width * r.tokens) / max)) : 0, bg)
}

/** The rows of the table, in the order the reading holds them (biggest first): the used categories (not the free space, the compaction buffer or a deferred one), colored as the bar colors them. */
export function categoryRows(c: CockpitContext, width: number): Span[][] {
  let n = 0
  return c.rows.flatMap(r => {
    if (r.kind !== 'used') return []
    const color = CATEGORY_COLORS[n++ % CATEGORY_COLORS.length] ?? COLORS.gray
    return [categorySpans(r, color, shade(color, 0.32), c.max, width)]
  })
}
