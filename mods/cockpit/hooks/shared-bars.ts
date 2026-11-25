import { COLORS } from './shared-style'
import type { Span } from './shared-style'

/** Widths of the header grid: folder 2/6, branch 3/6, diffs 1/6 (never less than its text), 1-cell gaps. */
export function gridWidths(total: number, diffsLen: number): { folder: number; branch: number; diffs: number } {
  const avail = Math.max(0, total - 2)
  const diffs = Math.max(Math.floor(avail / 6), diffsLen)
  const rest = Math.max(0, avail - diffs)
  const folder = Math.round((rest * 2) / 5)
  return { folder, branch: rest - folder, diffs }
}

export type BarPart = { pct: number; color: string }

/** Cells of a `width`-cell bar: each part gets round(pct) of the width, the rest is empty. */
export function barCells(width: number, parts: readonly BarPart[], markPct?: number): Span[] {
  const out: Span[] = []
  let used = 0
  for (const p of parts) {
    const n = Math.min(width - used, Math.max(0, Math.round((p.pct / 100) * width)))
    if (n > 0) out.push({ t: '▰'.repeat(n), c: p.color })
    used += n
  }
  if (used < width) out.push({ t: '▱'.repeat(width - used), c: COLORS.empty })
  return markPct === undefined ? out : withMark(out, markPct)
}

/** The autocompact threshold on a bar: the cell at `markPct` of the width turns amber, its glyph kept; none outside 0-100. */
function withMark(cells: Span[], markPct: number): Span[] {
  const chars = cells.flatMap(c => [...c.t].map(t => ({ ...c, t })))
  if (!(markPct > 0 && markPct < 100) || chars.length === 0) return cells
  const at = Math.min(chars.length - 1, Math.round((markPct / 100) * chars.length))
  chars[at] = { ...chars[at], c: COLORS.amber }
  return chars.reduce<Span[]>((out, cell) => {
    const last = out[out.length - 1]
    if (last && last.c === cell.c && last.t.at(-1) === cell.t) out[out.length - 1] = { ...last, t: last.t + cell.t }
    else out.push(cell)
    return out
  }, [])
}

/** `hex` (`#rrggbb`) moved toward `to` by `k`, 0 to 1: at 0 it is itself, at 1 it is `to`. */
export function mix(hex: string, to: string, k: number): string {
  const a = parseInt(hex.slice(1), 16)
  const b = parseInt(to.slice(1), 16)
  const channel = (shift: number) => {
    const from = (a >> shift) & 255
    return Math.round(from + k * (((b >> shift) & 255) - from)).toString(16).padStart(2, '0')
  }
  return `#${channel(16)}${channel(8)}${channel(0)}`
}

/** `hex` made brighter by `k`, 0 to 1, toward white: a colour whose strongest channel is already at 255 (the amber, the yellow) still lights up. */
export const brighten = (hex: string, k: number): string => mix(hex, '#ffffff', k)

/** How much the glow brightens its cells, from its centre out to both sides. */
const GLOW = [0.15, 0.35, 0.6, 0.35, 0.15]
/** Steps the glow rests once its tail has left the bar's end, before it starts again from the left. */
const GLOW_REST = 6
/** How much a pulse brightens the whole fill. */
const PULSE = 0.45

/** True for a run the glow and the pulse may light: a filled part, not the empty track or the pace gap. */
const isLit = (run: Span | undefined): run is Span & { c: string } => run?.c !== undefined && run.c !== COLORS.empty && run.c !== COLORS.gap

/** `cells` (a `barCells` bar) with a glow at step `phase`, in the first part's hue: it flows a cell a step from the left to the bar's end, then rests.
 * On the fill it brightens toward white; on the empty track it tints the cells with the fill's hue, so a short fill still shows the flow; a pace gap stays as it is. The text never changes. */
export function withGlow(cells: Span[], phase: number): Span[] {
  const [run] = cells
  if (phase < 0 || !isLit(run)) return cells
  const chars = cells.flatMap(c => [...c.t].map(t => ({ ...c, t })))
  const n = chars.length
  const half = (GLOW.length - 1) / 2
  const centre = (phase % (n + GLOW.length + GLOW_REST)) - half
  const lit = chars.map((cell, i) => {
    const k = Math.abs(i - centre) <= half ? GLOW[i - centre + half]! : 0
    if (k === 0) return cell
    return { ...cell, c: cell.c === COLORS.empty ? mix(COLORS.empty, run.c, k) : isLit(cell) ? brighten(cell.c, k) : cell.c }
  })
  // adjacent cells of one style join again into one span
  return lit.reduce<Span[]>((out, cell) => {
    const last = out[out.length - 1]
    if (last && last.c === cell.c && last.dim === cell.dim && last.bold === cell.bold && last.bg === cell.bg) out[out.length - 1] = { ...last, t: last.t + cell.t }
    else out.push(cell)
    return out
  }, [])
}

/** `cells` with the first part's whole run brighter while `isOn`: the pulse of a bar whose colour changed. */
export function withPulse(cells: Span[], isOn: boolean): Span[] {
  const [run, ...rest] = cells
  return isOn && isLit(run) ? [{ ...run, c: brighten(run.c, PULSE) }, ...rest] : cells
}
