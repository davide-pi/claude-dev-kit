import { COLORS } from './shared-style'

/** 1234 -> 1.2k, 248000 -> 248k, 1e6 -> 1M. `isUpper` writes K for the context readout. */
export function abbrevTokens(n: number | undefined, isUpper = false): string {
  if (n === undefined || !Number.isFinite(n) || n < 0) return ''
  const scale = (v: number, suffix: string) => (Number.isInteger(v) ? String(v) : v.toFixed(1)) + suffix
  if (n >= 1e6) return scale(n / 1e6, 'M')
  if (n >= 1000) return scale(n / 1000, isUpper ? 'K' : 'k')
  return String(Math.round(n))
}

/** A time span in 6 cells, right-aligned: `   45m` under an hour, ` 2h14m` / `13h45m` under a day, ` 3d06h` beyond (minutes and hours in two digits). */
function fixedSpan(ms: number): string {
  const totalMin = Math.floor(ms / 60000)
  const d = Math.floor(totalMin / 1440)
  const h = Math.floor((totalMin % 1440) / 60)
  const m = totalMin % 60
  const two = (n: number) => String(n).padStart(2, '0')
  const text = d > 0 ? `${d}d${two(h)}h` : h > 0 ? `${h}h${two(m)}m` : `${m}m`
  return text.padStart(6)
}

/** Time to a reset in `fixedSpan`'s 6 cells; empty when the reset is past or unknown. */
export function countdown(resetsAtMs: number | undefined, now: number): string {
  if (resetsAtMs === undefined || resetsAtMs - now <= 0) return ''
  return fixedSpan(resetsAtMs - now)
}

/** `ms` as the local time of day, `HH:MM`. */
export function clockTime(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** The local date of a moment, `2026-11-11`. */
export function localDate(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Elapsed time in one fixed shape of 6 cells: `00m41s`, `02m14s`, `01h02m`; from 100 hours the days, ` 4d04h`. */
export function duration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const two = (n: number) => String(n).padStart(2, '0')
  if (s < 3600) return `${two(Math.floor(s / 60))}m${two(s % 60)}s`
  if (s >= 100 * 3600) return fixedSpan(ms)
  return `${two(Math.floor(s / 3600))}h${two(Math.floor((s % 3600) / 60))}m`
}

/**
 * Color by projected end-of-window usage (constant-burn assumption): <= 80 green,
 * <= 100 yellow, above red. Early in the window, or with no reset, by what is left.
 */
export function rateColor(used: number, resetsAtMs: number | undefined, windowSec: number, now: number): string {
  const rem = 100 - used
  const byRemaining = rem > 60 ? COLORS.green : rem > 30 ? COLORS.yellow : COLORS.red
  if (resetsAtMs === undefined) return byRemaining
  const remainSec = (resetsAtMs - now) / 1000
  if (remainSec <= 0) return byRemaining
  const elapsedFrac = 1 - remainSec / windowSec
  if (elapsedFrac < 0.1) return byRemaining
  const projected = used / elapsedFrac
  return projected <= 80 ? COLORS.green : projected <= 100 ? COLORS.yellow : COLORS.red
}
