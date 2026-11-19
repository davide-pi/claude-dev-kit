export type DeskLayout = {
  size: 'narrow' | 'medium' | 'wide'
  columns: number
  bodyRows: number
  gaugeSize: number
  barWidth: number
  nowColumns: 1 | 2
}

export const DESK_MIN_COLUMNS = 28
export const DESK_MEDIUM_FROM = 56
export const DESK_WIDE_FROM = 110
export const DESK_MIN_ROWS = 8
export const DESK_BAR_MIN = 120
export const DESK_BAR_MAX = 260
// Width (columns) at which the credit bar reaches its maximum.
export const DESK_BAR_FULL_AT = 140

const GAUGE_SIZE = { narrow: 72, medium: 96, wide: 120 } as const

export function deskLayout(bodyColumns: number, bodyRows: number): DeskLayout {
  const columns = Number.isFinite(bodyColumns) && bodyColumns > 0 ? Math.max(DESK_MIN_COLUMNS, Math.floor(bodyColumns)) : DESK_MIN_COLUMNS
  const size = columns >= DESK_WIDE_FROM ? 'wide' : columns >= DESK_MEDIUM_FROM ? 'medium' : 'narrow'
  const span = DESK_BAR_FULL_AT - DESK_MIN_COLUMNS
  const ratio = Math.min(1, (columns - DESK_MIN_COLUMNS) / span)
  return {
    size,
    columns,
    bodyRows: Number.isFinite(bodyRows) && bodyRows >= DESK_MIN_ROWS ? Math.floor(bodyRows) : DESK_MIN_ROWS,
    gaugeSize: GAUGE_SIZE[size],
    barWidth: Math.round(DESK_BAR_MIN + (DESK_BAR_MAX - DESK_BAR_MIN) * ratio),
    nowColumns: size === 'wide' ? 2 : 1,
  }
}
