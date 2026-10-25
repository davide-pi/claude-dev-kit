import type { CockpitSnapshot } from '../types'
import { parseReset, weeklyPace } from './session'
import { abbrevTokens, countdown, ctxColor, effortGlyph, pctCell, rateColor } from './shared'
import type { Span } from './shared'
import { delta, dim, sp } from './view-base'

const FIVE_HOURS = 18000
const SEVEN_DAYS = 604800

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

/** The windows to draw: the engine's, or while it reports none the status line's last known ones (drawn with a `~`). */
const isLastKnownRates = (s: CockpitSnapshot): boolean => s.rateLimits.length === 0 && (s.lastRates?.length ?? 0) > 0

export function rateRow(s: CockpitSnapshot, kind: 'five_hour' | 'seven_day'): RateRow | undefined {
  const isStale = isLastKnownRates(s)
  const w = (isStale ? (s.lastRates ?? []) : s.rateLimits).find(r => r.kind === kind)
  if (!w) return undefined
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
  const startTokens = isStale ? undefined : s.ctx.startTokens
  // Before the first response nothing is measured: the fill reads as empty, not as missing.
  const pct = percent ?? 0
  const out: Span[] = [...pctSpans(pct, ctxColor(pct), isStale), sp(` ${abbrevTokens(tokens ?? 0, true)}`)]
  if (window) out.push(dim(`/${abbrevTokens(window, true)}`))
  const grown = delta(tokens, startTokens)
  if (grown !== undefined && grown > 0) out.push(dim(` +${abbrevTokens(grown, true)}`))
  return out
}

export function rateText(label: string, r: RateRow, now: number): Span[] {
  const cd = countdown(r.resetMs, now)
  return [...pctSpans(r.rem, r.color, r.isStale), sp(' '), dim(label), ...(cd ? [dim(' ↻ '), sp(cd)] : [])]
}
