import type { CockpitSnapshot } from '../types'
import { parseReset, weeklyPace } from './session'
import { abbrevTokens, countdown, ctxColor, effortGlyph, pctCell, rateColor } from './shared'
import type { Span } from './shared'
import { dim, sp } from './view-base'

const FIVE_HOURS = 18000
const SEVEN_DAYS = 604800
// The widest token count `abbrevTokens` writes (`248.5K`): the readout keeps its cells whatever the count, so the bar beside it never moves.
export const TOKENS_CELLS = 6
// The cells of ` ↻ ` and the countdown: kept, blank, once the reset has passed.
const RESET_CELLS = 9
// The widest window `abbrevTokens` writes, with its slash (`/200K`).
const WINDOW_CELLS = 5

export const effortSpans = (effort: string | number | undefined): Span[] => {
  const g = effortGlyph(effort)
  return g ? [sp(g.icon, g.color)] : []
}

// The session's effort in the header: icon and level name, both in the level's color.
export const headerEffort = (effort: string | number | undefined): Span[] => {
  const g = effortGlyph(effort)
  return g && typeof effort === 'string' ? [sp(' '), sp(`${g.icon} ${effort.toUpperCase()}`, g.color, true)] : []
}

// ── Data derived from the snapshot ───────────────────────────────────────────

export type RateRow = { rem: number; color: string; resetMs: number | undefined; isStale: boolean; pace?: { target: number; delta: number } }

/** A window from the engine's reading, or while it reports none of that kind the status line's last known one (drawn with a `~`). */
export function rateRow(s: CockpitSnapshot, kind: 'five_hour' | 'seven_day'): RateRow | undefined {
  const live = s.rateLimits.find(r => r.kind === kind)
  const w = live ?? s.lastRates?.find(r => r.kind === kind)
  if (!w) return undefined
  const isStale = live === undefined
  const resetMs = parseReset(w.resetsAt)
  const windowSec = kind === 'five_hour' ? FIVE_HOURS : SEVEN_DAYS
  const rem = Math.max(0, Math.min(100, Math.round(100 - w.percentUsed)))
  return {
    rem,
    resetMs,
    isStale,
    color: rateColor(w.percentUsed, resetMs, windowSec, s.now),
    pace: kind === 'seven_day' ? weeklyPace(rem, resetMs, windowSec, s.now) : undefined,
  }
}

// ── Row builders (pure: spans in, spans out) ─────────────────────────────────

/** A percentage in its column; the last known one has a dim `~` in the cell before its digits. */
const pctSpans = (n: number, color: string, isStale: boolean): Span[] =>
  isStale ? [dim('~'), sp(pctCell(n).trimStart().padStart(3), color, true)] : [sp(pctCell(n), color, true)]

export function contextText(s: CockpitSnapshot): Span[] {
  // Until the engine measures the window (a resumed session, before its first response) the last state's reading stands in, with a `~`.
  const isStale = s.ctx.percent === undefined && s.lastCtx !== undefined
  const { tokens, window, percent } = isStale && s.lastCtx ? s.lastCtx : s.ctx
  // Before the first response nothing is measured: the fill reads as empty, not as missing.
  const pct = percent ?? 0
  const out: Span[] = [...pctSpans(pct, ctxColor(pct), isStale), sp(` ${abbrevTokens(tokens ?? 0, true).padStart(TOKENS_CELLS)}`)]
  // the window keeps its cells too: unmeasured or switched (`/1M`, `/200K`), the bar keeps its length
  out.push(dim((window ? `/${abbrevTokens(window, true)}` : '').padEnd(WINDOW_CELLS)))
  return out
}

export function rateText(r: RateRow, now: number): Span[] {
  const cd = countdown(r.resetMs, now)
  return [...pctSpans(r.rem, r.color, r.isStale), ...(cd ? [dim(' ↻ '), sp(cd)] : [sp(' '.repeat(RESET_CELLS))])]
}
