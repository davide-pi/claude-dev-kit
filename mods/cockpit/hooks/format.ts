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
  gray: '#8c8c8c',
} as const

/** How long a finished agent stays listed. */
export const AGENT_KEEP_MS = 120_000

export const ICONS = {
  folder: '\u{F024B}', // nf-md-folder
  tree: '\u{F0253}', // nf-md-folder_multiple: a worktree, another checkout of the same repo
  branch: '\u{F062C}', // nf-md-source_branch
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
export type Span = { t: string; c?: string; dim?: boolean; bold?: boolean }

export const spanWidth = (spans: readonly Span[]): number =>
  spans.reduce((n, s) => n + [...s.t].length, 0)

export const spanText = (spans: readonly Span[]): string => spans.map(s => s.t).join('')

/** 1234 -> 1.2k, 248000 -> 248k, 1e6 -> 1M. `isUpper` writes K for the context readout. */
export function abbrevTokens(n: number | undefined, isUpper = false): string {
  if (n === undefined || !Number.isFinite(n) || n < 0) return ''
  const scale = (v: number, suffix: string) => (Number.isInteger(v) ? String(v) : v.toFixed(1)) + suffix
  if (n >= 1e6) return scale(n / 1e6, 'M')
  if (n >= 1000) return scale(n / 1000, isUpper ? 'K' : 'k')
  return String(Math.round(n))
}

/** Time to a reset as `3d6h`, `2h14m`, `14m`; empty when the reset is past or unknown. */
export function countdown(resetsAtMs: number | undefined, now: number): string {
  if (resetsAtMs === undefined) return ''
  const diff = resetsAtMs - now
  if (diff <= 0) return ''
  const totalMin = Math.floor(diff / 60000)
  const d = Math.floor(totalMin / 1440)
  const h = Math.floor((totalMin % 1440) / 60)
  const m = totalMin % 60
  if (d > 0) return `${d}d${h}h`
  if (h > 0) return `${h}h${m}m`
  return `${m}m`
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

/** The worklog badge is red once the oldest pending day is more than a week old (`YYYY-MM-DD`, local noon). */
export const isWorklogStale = (oldestIso: string, now: number): boolean => now - Date.parse(`${oldestIso}T12:00:00`) > 7 * 864e5

/** Cut spans to `max` cells: the cut leaves an unstyled `…` as its last cell (as the statusline's truncateAnsi). */
export function truncateSpans(spans: readonly Span[], max: number): Span[] {
  if (spanWidth(spans) <= max) return [...spans]
  if (max <= 0) return []
  const out: Span[] = []
  let room = max - 1
  for (const s of spans) {
    if (room <= 0) break
    const chars = [...s.t]
    out.push(chars.length <= room ? s : { ...s, t: chars.slice(0, room).join('') })
    room -= chars.length
  }
  out.push({ t: '…' })
  return out
}

/** How much should still be left now (`target`) and the signed gap to what is (`delta`, + is ahead). */
export function weeklyPace(
  remainingPct: number,
  resetsAtMs: number | undefined,
  windowSec: number,
  now: number,
): { target: number; delta: number } | undefined {
  if (resetsAtMs === undefined) return undefined
  const remainSec = (resetsAtMs - now) / 1000
  if (remainSec <= 0 || remainSec > windowSec) return undefined
  const target = Math.round((remainSec / windowSec) * 100)
  return { target, delta: remainingPct - target }
}

/** `+5%` / `−5%` (true minus sign, as the mockup). */
export const signedPct = (delta: number): string => `${delta < 0 ? '−' : '+'}${Math.abs(delta)}%`

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

/** Cut the end of a string to `max` cells with an ellipsis; short strings are untouched. */
export function truncEnd(s: string, max: number): string {
  if (textCells(s) <= max) return s
  if (max <= 0) return ''
  let out = ''
  let used = 0
  for (const ch of s) {
    const w = cellWidth(ch)
    if (used + w > max - 1) break
    out += ch
    used += w
  }
  return out + '…'
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
  if (nDone > 0) out.push({ t: '█'.repeat(nDone), c: COLORS.green })
  if (nActive > 0) out.push({ t: '█'.repeat(nActive), c: COLORS.blue })
  const rest = width - nDone - nActive
  if (rest > 0) out.push({ t: '█'.repeat(rest), c: COLORS.empty })
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
    if (n > 0) out.push({ t: '█'.repeat(n), c: p.color })
    used += n
  }
  if (used < width) out.push({ t: '█'.repeat(width - used), c: COLORS.empty })
  return out
}

/** Context color by fill: green, yellow, red (no orange: too close to red). */
export const ctxColor = (pct: number): string =>
  pct < 40 ? COLORS.green : pct < 80 ? COLORS.yellow : COLORS.red

/** `git status --porcelain -b` -> branch and dirty counts; undefined outside a repository. */
export function parseGitStatus(out: string): { branch: string; staged: number; modified: number; untracked: number } | undefined {
  const lines = out.split('\n').filter(l => l.length > 0)
  const header = lines[0]?.startsWith('## ') ? (lines.shift() ?? '').slice(3) : ''
  const branch = (header.replace(/^(?:No commits yet|Initial commit) on /, '').split('...')[0] ?? '')
    .replace(/ \(no branch\)$/, '')
    .trim()
  if (!branch) return undefined
  let staged = 0
  let modified = 0
  let untracked = 0
  for (const line of lines) {
    if (line.length < 2) continue
    const x = line[0]
    const y = line[1]
    if (x !== ' ' && x !== '?') staged++
    if (y !== ' ' && y !== '?') modified++
    if (line.startsWith('??')) untracked++
  }
  return { branch, staged, modified, untracked }
}

/** `rev-parse --git-dir --git-common-dir --show-toplevel` -> the worktree root inside a linked worktree. */
export function parseWorktree(out: string): string | undefined {
  const [gitDir, commonDir, root] = out.split('\n').map(l => l.trim())
  if (!gitDir || !commonDir || !root) return undefined
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  return norm(gitDir) === norm(commonDir) ? undefined : root
}

export const baseName = (p: string): string =>
  p.replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean).at(-1) ?? p

export type WorklogSnapshot = {
  day?: string
  auditMtime?: number
  pending?: { date: string }[]
  underTarget?: { date: string }[]
}

/**
 * The worklog days to flag, with the statusline's staleness rule: a snapshot from another day, or
 * from before /worklog last wrote its audit, is silent (which is how the badge clears itself).
 */
export function worklogDays(
  snap: WorklogSnapshot,
  auditMtimeMs: number | undefined,
  todayIso: string,
): { pending: string[]; underTarget: string[] } {
  const none = { pending: [], underTarget: [] }
  if (snap.day !== todayIso) return none
  if (snap.auditMtime === undefined || auditMtimeMs === undefined) return none
  if (Math.abs(snap.auditMtime - auditMtimeMs) >= 1) return none
  return {
    pending: (snap.pending ?? []).map(d => d.date),
    underTarget: (snap.underTarget ?? []).map(d => d.date),
  }
}

/** `2026-10-12` -> `12/10`. */
export const shortDate = (iso: string): string => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`

/** The `wl` / `worklog:` text of the footer for one kind of day. */
export function worklogLabel(kind: 'pending' | 'underTarget', dates: readonly string[]): string {
  const what = kind === 'pending' ? 'da registrare' : 'sotto target'
  return `worklog: ${dates.length}d ${what} (${dates.map(shortDate).join(', ')})`
}
