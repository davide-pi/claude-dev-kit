import type { CockpitConsumer, CockpitContext, CockpitContextRow } from '../types'
import {
  COLORS,
  abbrevTokens,
  barCells,
  padCells,
  rangeSparkline,
  shade,
  textCells,
  truncEnd,
  truncMiddle,
  truncateSpans,
  withBackground,
} from './shared'
import type { Span } from './shared'
import { t } from './strings'
import { dim, pad, padStart, sp } from './view-base'

/** The most bars the Context trend line draws before its text, and the most lines a note shows before `▸ +N lines`. */
const TREND_BARS_MAX = 8

/** Cells of the Context rows: a category's tokens and share of the window, what follows them (the exact mark and the change of the last round) and a consumer's kind label. */
const CTX_TOKENS_W = 6
const CTX_SHARE_W = 5
const CTX_MARK_W = 2
const CTX_DELTA_W = 6
const CONSUMER_KIND_W = 5
/** The colors of the used categories, in turn; the compaction buffer is dim and the free space empty. */
const CATEGORY_COLORS = [COLORS.blue, COLORS.lavender, COLORS.amber, COLORS.green, COLORS.yellow, COLORS.orange, COLORS.violet, COLORS.gray]

/** The bar of the window: a part per used category (each its own color) and the compaction buffer; the rest stays empty. */
export function contextBar(c: CockpitContext, width: number): Span[] {
  let n = 0
  const parts = c.rows.flatMap(r => {
    if (r.kind !== 'used' && r.kind !== 'buffer') return []
    const color = r.kind === 'buffer' ? COLORS.dim : (CATEGORY_COLORS[n++ % CATEGORY_COLORS.length] ?? COLORS.gray)
    return [{ pct: c.max > 0 ? (100 * r.tokens) / c.max : 0, color }]
  })
  return barCells(width, parts)
}

/**
 * One category row, exactly `width` cells: a square in the bar color, its name cut to fit, its tokens and its share of the window; a `✓`
 * when the tokens are an exact count kept from earlier and the change of the last round (`+12k`, blank when it did not move). The first
 * cells, in proportion to the share of the window, sit on the `bg` background: the row carries its own bar.
 */
export function categorySpans(r: CockpitContextRow, color: string, bg: string, max: number, width: number): Span[] {
  const nameW = Math.max(4, width - 2 - CTX_TOKENS_W - CTX_SHARE_W - CTX_MARK_W - CTX_DELTA_W)
  const share = max > 0 ? `${Math.round((100 * r.tokens) / max)}%` : ''
  const delta = r.delta ? padStart(`${r.delta > 0 ? '+' : '−'}${abbrevTokens(Math.abs(r.delta))}`, CTX_DELTA_W) : ' '.repeat(CTX_DELTA_W)
  const row = [
    sp('■', color),
    sp(' '),
    sp(padCells(truncEnd(t().contextCategories[r.name] ?? r.name, nameW), nameW)),
    sp(padStart(abbrevTokens(r.tokens), CTX_TOKENS_W)),
    dim(padStart(share, CTX_SHARE_W)),
    r.isExact ? sp(' ✓', COLORS.green) : dim('  '),
    dim(delta),
  ]
  return withBackground(row, r.tokens > 0 && max > 0 ? Math.max(1, Math.round((width * r.tokens) / max)) : 0, bg)
}

/** The rows of the table, in the order the reading holds them (biggest first): the categories inside the window (a deferred one is outside it), colored as the bar colors them. */
export function categoryRows(c: CockpitContext, width: number): Span[][] {
  let n = 0
  return c.rows.flatMap(r => {
    if (r.kind === 'deferred') return []
    const color = r.kind === 'free' ? COLORS.empty : r.kind === 'buffer' ? COLORS.dim : (CATEGORY_COLORS[n++ % CATEGORY_COLORS.length] ?? COLORS.gray)
    // the free space is drawn from a dim gray, whose own square is nearly invisible
    return [categorySpans(r, color, shade(r.kind === 'free' ? COLORS.gray : color, r.kind === 'free' ? 0.2 : 0.32), c.max, width)]
  })
}

/**
 * The context's trend as one line: the last rounds as bars (as many as fit before the text, at most eight, none under two) then where the
 * context went, how fast it grows per round and in how many rounds auto-compaction comes (`forecast`); cut to `width`. Empty without a round.
 */
export function trendSpans(rounds: readonly number[], growth: number | undefined, forecast: number | undefined, color: string, width: number): Span[] {
  const first = rounds[0]
  const last = rounds.at(-1)
  if (first === undefined || last === undefined) return []
  const text = t().trendLine(abbrevTokens(first), abbrevTokens(last), growth === undefined ? undefined : abbrevTokens(Math.round(growth)), forecast)
  const bars = Math.min(rounds.length, TREND_BARS_MAX, width - 2 - textCells(text))
  return truncateSpans([...(bars >= 2 ? [sp(rangeSparkline(rounds.slice(-bars)), color), sp('  ')] : []), sp(text)], width)
}

/** A static consumer row: its kind, its name cut to fit, its tokens. */
export function consumerSpans(c: CockpitConsumer, width: number): Span[] {
  const nameW = Math.max(4, width - CONSUMER_KIND_W - 1 - CTX_TOKENS_W)
  return [dim(pad(t().consumerKinds[c.kind], CONSUMER_KIND_W)), sp(' '), sp(padCells(truncMiddle(c.name, nameW), nameW)), sp(padStart(abbrevTokens(c.tokens), CTX_TOKENS_W))]
}
