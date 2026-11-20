export type DeskLayout = {
  size: 'narrow' | 'medium' | 'wide'
  columns: number
  bodyRows: number
  gaugeSize: number
  nowColumns: 1 | 2
}

export const DESK_MIN_COLUMNS = 28
export const DESK_MEDIUM_FROM = 56
export const DESK_WIDE_FROM = 110
export const DESK_MIN_ROWS = 8

const GAUGE_SIZE = { narrow: 72, medium: 96, wide: 120 } as const

/** At most `limit` rows: all when they fit, else the first `limit - 1` and the `more` row for the `n` left out. */
export function limitRows<T>(rows: readonly T[], limit: number, more: (n: number) => T): T[] {
  if (rows.length <= limit) return [...rows]
  const kept = Math.max(0, limit - 1)
  return [...rows.slice(0, kept), more(rows.length - kept)]
}

export function deskLayout(bodyColumns: number, bodyRows: number): DeskLayout {
  const columns = Number.isFinite(bodyColumns) && bodyColumns > 0 ? Math.max(DESK_MIN_COLUMNS, Math.floor(bodyColumns)) : DESK_MIN_COLUMNS
  const size = columns >= DESK_WIDE_FROM ? 'wide' : columns >= DESK_MEDIUM_FROM ? 'medium' : 'narrow'
  return {
    size,
    columns,
    bodyRows: Number.isFinite(bodyRows) && bodyRows >= DESK_MIN_ROWS ? Math.floor(bodyRows) : DESK_MIN_ROWS,
    gaugeSize: GAUGE_SIZE[size],
    nowColumns: size === 'wide' ? 2 : 1,
  }
}

/** A scroll offset moved `by` rows and kept within [0, max]; the start is clamped first, so an offset left past a shrunk list moves at once. */
export function scrollOffset(offset: number, by: number, max: number): number {
  const top = Math.max(0, Math.floor(max))
  const from = Math.min(Math.max(0, Math.floor(offset)), top)
  // a desktop wheel may report a fraction of a row: any move is at least one row its own way (Math.round alone turns -0.5 into 0, so up would never move)
  const step = by > 0 ? Math.max(1, Math.round(by)) : by < 0 ? Math.min(-1, Math.round(by)) : 0
  return Math.min(Math.max(0, from + step), top)
}

/**
 * The window over units `cells` tall that fits `limit` from `offset`: the first unit shown (`from`, clamped), one past the last (`to`, at
 * least one unit) and the furthest offset (`max`: the first unit from which the rest fit, 0 when all do).
 */
export function scrollSpan(cells: readonly number[], offset: number, limit: number): { from: number; to: number; max: number } {
  let max = cells.length
  for (let sum = 0; max > 0 && sum + (cells[max - 1] ?? 0) <= limit; max--) sum += cells[max - 1] ?? 0
  max = Math.min(max, Math.max(0, cells.length - 1))
  const from = Math.min(Math.max(0, Math.floor(offset)), max)
  let to = from
  for (let sum = 0; to < cells.length && (to === from || sum + (cells[to] ?? 0) <= limit); to++) sum += cells[to] ?? 0
  return { from, to, max }
}
