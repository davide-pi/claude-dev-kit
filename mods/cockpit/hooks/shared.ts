// Pure formatting and parsing helpers of the cockpit: no `$`, no state, all unit-tested.
// Logic ported from ~/.claude/statusline.js (abbrevTokens, countdown, rateColor, weeklyPace).

export const COLORS = {
  text: '#d6d8dc',
  dim: '#9aa0aa',
  title: '#a98fd4',
  rule: '#332b44',
  sep: '#4a4f59',
  folder: '#b89ad9',
  violet: '#7d5ba6',
  lavender: '#a082c8',
  blue: '#7fb4ff',
  green: '#7ec699',
  yellow: '#ffcf8a',
  amber: '#e8a35a',
  orange: '#ff9e5e',
  red: '#f07a6f',
  gap: '#8a3b33',
  empty: '#33363c',
  band: '#808080', // the odd rows of a list: a mid grey, the theme's default text (white or black) keeps contrast >= 3.9 on it in light and dark terminals
  gray: '#8c8c8c',
} as const

export const ICONS = {
  folder: '\u{F024B}', // nf-md-folder: the folder, whether a plain one, a repository or a linked worktree
  branch: '\u{F062C}', // nf-md-source_branch
  disk: '\u{F02CA}', // nf-md-harddisk
} as const

// Nerd Font Material Design glyphs (supplementary private use area, hence \u{...}).
const EFFORT: Record<string, { icon: string; color: string }> = {
  low: { icon: '\u{F12A1}', color: COLORS.gray },
  medium: { icon: '\u{F12A2}', color: COLORS.green },
  high: { icon: '\u{F12A3}', color: COLORS.yellow },
  xhigh: { icon: '\u{F12A6}', color: COLORS.orange },
  max: { icon: '\u{F0083}', color: COLORS.red },
}

/** Icon and color of an effort level; undefined for a level this build does not name (a number). */
export function effortGlyph(effort: string | number | undefined): { icon: string; color: string } | undefined {
  return typeof effort === 'string' ? EFFORT[effort] : undefined
}

/** A run of text with one style: the unit both views are built from. */
export type Span = { t: string; c?: string; dim?: boolean; bold?: boolean; bg?: string }

export const spanWidth = (spans: readonly Span[]): number =>
  spans.reduce((n, s) => n + textCells(s.t), 0)

export const spanText = (spans: readonly Span[]): string => spans.map(s => s.t).join('')

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

/** Elapsed time: `41s`, `2m14s`, `1h02m`. */
export function duration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`
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

/** Cut spans to `max` cells: the cut leaves an unstyled `…` as its last cell (as the statusline's truncateAnsi). */
export function truncateSpans(spans: readonly Span[], max: number): Span[] {
  if (spanWidth(spans) <= max) return [...spans]
  if (max <= 0) return []
  const out: Span[] = []
  let room = max - 1
  for (const s of spans) {
    if (room <= 0) break
    const w = textCells(s.t)
    out.push(w <= room ? s : { ...s, t: takeCells(s.t, room) })
    room -= w
  }
  out.push({ t: '…' })
  return out
}

/** `+5%` / `−5%` (true minus sign, as the mockup). */
export const signedPct = (delta: number): string => `${delta < 0 ? '−' : '+'}${Math.abs(delta)}%`

/** A signed percentage in the 4-cell column of the other percentages (` −5%`, `−12%`); a wider one keeps its width. */
export const signedPctCell = (delta: number): string => signedPct(delta).padStart(4)

/** Cost with precision that scales down; `$0.00` for an untouched session. */
export function fmtCost(usd: number | undefined): string {
  if (usd === undefined || !Number.isFinite(usd) || usd <= 0) return '$0.00'
  return `$${usd < 0.01 ? usd.toFixed(4) : usd < 1 ? usd.toFixed(3) : usd.toFixed(2)}`
}

/** The last turn's cost, `+0.38`; empty below a cent. */
export const fmtCostDelta = (d: number | undefined): string =>
  d !== undefined && d >= 0.005 ? `+${d.toFixed(2)}` : ''

export type ModelFamily = 'opus' | 'sonnet' | 'haiku' | 'fable'

export function modelFamily(model: string | undefined): ModelFamily | undefined {
  const m = model?.toLowerCase().match(/opus|sonnet|haiku|fable/)
  return m ? (m[0] as ModelFamily) : undefined // the regex only yields one of the four names
}

/** `claude-opus-5-5-20260101[1m]` or `Opus 5.5` -> version `5.5`; empty when none is spelled. */
function modelVersion(model: string): string {
  const m = model.match(/(?:opus|sonnet|haiku|fable)[\s-]+(\d+)(?:[-.](\d{1,2})(?!\d))?/i)
  if (!m) return ''
  return m[2] === undefined ? (m[1] ?? '') : `${m[1]}.${m[2]}`
}

const FAMILY_SHORT: Record<ModelFamily, string> = { opus: 'opus', sonnet: 'son', haiku: 'haiku', fable: 'fable' }

/** `son 5.5`, `opus 5.5`: the agent rows and counts. Unknown names pass through. */
export function shortModel(model: string | undefined): string {
  if (!model) return ''
  const family = modelFamily(model)
  if (!family) return model
  const v = modelVersion(model)
  return v ? `${FAMILY_SHORT[family]} ${v}` : FAMILY_SHORT[family]
}

/** `Opus 5.5`: the header. Unknown names pass through. */
export function displayModel(model: string | undefined): string {
  if (!model) return ''
  const family = modelFamily(model)
  if (!family) return model
  const name = family.charAt(0).toUpperCase() + family.slice(1)
  const v = modelVersion(model)
  return v ? `${name} ${v}` : name
}

/** Cut the middle of a string to `max` cells with an ellipsis; short strings are untouched. */
export function truncMiddle(s: string, max: number): string {
  const chars = [...s]
  if (chars.length <= max) return s
  if (max <= 1) return max === 1 ? '…' : ''
  const keep = max - 1
  const head = Math.ceil(keep / 2)
  const tail = keep - head
  return chars.slice(0, head).join('') + '…' + chars.slice(chars.length - tail).join('')
}

/** Terminal cells of one character: 2 for CJK, fullwidth and emoji, 0 for combining and zero-width marks, else 1. */
export function cellWidth(ch: string): number {
  const c = ch.codePointAt(0) ?? 0
  if ((c >= 0x300 && c <= 0x36f) || (c >= 0x200b && c <= 0x200f) || (c >= 0xfe00 && c <= 0xfe0f)) return 0
  const isWide =
    (c >= 0x1100 && c <= 0x115f) ||
    (c >= 0x2e80 && c <= 0xa4cf) ||
    (c >= 0xac00 && c <= 0xd7a3) ||
    (c >= 0xf900 && c <= 0xfaff) ||
    (c >= 0xfe30 && c <= 0xfe6f) ||
    (c >= 0xff00 && c <= 0xff60) ||
    (c >= 0xffe0 && c <= 0xffe6) ||
    (c >= 0x1f300 && c <= 0x1faff) ||
    (c >= 0x20000 && c <= 0x3fffd)
  return isWide ? 2 : 1
}

export const textCells = (s: string): number => [...s].reduce((n, ch) => n + cellWidth(ch), 0)

/** The longest start of `s` that fits `max` cells. */
function takeCells(s: string, max: number): string {
  let out = ''
  let used = 0
  for (const ch of s) {
    const w = cellWidth(ch)
    if (used + w > max) break
    out += ch
    used += w
  }
  return out
}

/** `s` cut where its start fits `max` cells, at the last space of that start when it has one: the start, and the rest without its leading spaces. */
export function splitCells(s: string, max: number): [string, string] {
  if (textCells(s) <= max) return [s, '']
  // At least one character, so a wide one under a narrow `max` still moves the cut on
  const head = takeCells(s, Math.max(1, max)) || ([...s][0] ?? '')
  const space = s[head.length] === ' ' ? head.length : head.lastIndexOf(' ')
  const cut = space > 1 ? space : head.length
  return [s.slice(0, cut), s.slice(cut).trimStart()]
}

/** `s` in lines of at most `max` cells, broken at spaces where it can be. */
export function wrapCells(s: string, max: number): string[] {
  const out: string[] = []
  let rest = s
  while (rest !== '') {
    const [head, tail] = splitCells(rest, max)
    out.push(head)
    rest = tail
  }
  return out
}

/** Cut the end of a string to `max` cells with an ellipsis; short strings are untouched. */
export function truncEnd(s: string, max: number): string {
  if (textCells(s) <= max) return s
  if (max <= 0) return ''
  return takeCells(s, max - 1) + '…'
}

/** Pads with spaces to `n` cells. */
export const padCells = (s: string, n: number): string => s + ' '.repeat(Math.max(0, n - textCells(s)))

/**
 * The task bar's cells: done floors (full only when all are done), in progress rounds but never vanishes,
 * the rest is empty; the cells never exceed `width`.
 */
export function taskBarCells(width: number, done: number, inProgress: number, total: number): Span[] {
  if (total <= 0 || width <= 0) return []
  const nDone = done >= total ? width : Math.min(width, Math.floor((done / total) * width))
  const nActive = inProgress > 0 ? Math.min(width - nDone, Math.max(1, Math.round((inProgress / total) * width))) : 0
  const out: Span[] = []
  if (nDone > 0) out.push({ t: '▰'.repeat(nDone), c: COLORS.green })
  if (nActive > 0) out.push({ t: '▰'.repeat(nActive), c: COLORS.blue })
  const rest = width - nDone - nActive
  if (rest > 0) out.push({ t: '▱'.repeat(rest), c: COLORS.empty })
  return out
}

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
export function barCells(width: number, parts: readonly BarPart[]): Span[] {
  const out: Span[] = []
  let used = 0
  for (const p of parts) {
    const n = Math.min(width - used, Math.max(0, Math.round((p.pct / 100) * width)))
    if (n > 0) out.push({ t: '▰'.repeat(n), c: p.color })
    used += n
  }
  if (used < width) out.push({ t: '▱'.repeat(width - used), c: COLORS.empty })
  return out
}

/** `spans` with their first `cells` cells on a `bg` background: a row that carries its own bar. */
export function withBackground(spans: readonly Span[], cells: number, bg: string): Span[] {
  const out: Span[] = []
  let left = Math.max(0, cells)
  for (const s of spans) {
    const chars = [...s.t]
    if (left <= 0) out.push(s)
    else if (chars.length <= left) out.push({ ...s, bg })
    else out.push({ ...s, t: chars.slice(0, left).join(''), bg }, { ...s, t: chars.slice(left).join('') })
    left -= chars.length
  }
  return out
}

/** `color` (`#rrggbb`) darkened to `factor` of its brightness: a background that text of any color stays readable on. */
export function shade(color: string, factor: number): string {
  const channel = (i: number) => Math.round(parseInt(color.slice(1 + 2 * i, 3 + 2 * i), 16) * factor)
  return `#${[0, 1, 2].map(i => channel(i).toString(16).padStart(2, '0')).join('')}`
}

/** Context color by fill: green, yellow, red (no orange: too close to red). */
export const ctxColor = (pct: number): string =>
  pct < 40 ? COLORS.green : pct < 80 ? COLORS.yellow : COLORS.red

/** The cache hit of the last turn by thresholds: green from 80 %, amber from 50 to 79, red below. */
export const cacheColor = (pct: number): string => (pct >= 80 ? COLORS.green : pct >= 50 ? COLORS.amber : COLORS.red)

export const baseName = (p: string): string =>
  p.replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean).at(-1) ?? p

/** `2026-10-12` -> `12/10`. */
export const shortDate = (iso: string): string => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`

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
