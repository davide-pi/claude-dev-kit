import { COLORS } from './shared-style'

/** Context color by fill of the window: green, yellow, red. The CTX bar uses it only without a compaction threshold (`ctxScale`). */
export const ctxColor = (pct: number): string =>
  pct < 40 ? COLORS.green : pct < 80 ? COLORS.yellow : COLORS.red

/** The cache hit of the last turn by thresholds: green from 80 %, amber from 50 to 79, red below. */
export const cacheColor = (pct: number): string => (pct >= 80 ? COLORS.green : pct >= 50 ? COLORS.amber : COLORS.red)

export const baseName = (p: string): string =>
  p.replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean).at(-1) ?? p

/** A percentage in a 4-cell column (`  7%`, ` 87%`, `100%`) so one-, two- and three-digit values line up. */
export const pctCell = (n: number): string => `${String(n).padStart(3)}%`

export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

export const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0

/**
 * Whether two snapshots hold the same data. A part both share by reference is the same without a look; only a part that was rebuilt is
 * serialised, so a patch that changes one field pays for that field.
 */
export function sameSnapshot(a: object, b: object): boolean {
  if (a === b) return true
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const key of keys) {
    const x = (a as Record<string, unknown>)[key]
    const y = (b as Record<string, unknown>)[key]
    if (x !== y && JSON.stringify(x) !== JSON.stringify(y)) return false
  }
  return true
}

/** The `file://` URI of a local path (Windows drive letters kept: `file:///C:/<dir>`), as the status line builds it; undefined for an empty path. */
export function pathToFileUri(p: string): string | undefined {
  if (!p) return undefined
  let u = p.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/')
  u = u.replace(/^([A-Za-z])%3A/i, '$1:')
  if (!u.startsWith('/')) u = '/' + u
  return `file://${u}`
}
