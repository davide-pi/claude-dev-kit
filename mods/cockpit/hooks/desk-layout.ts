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
