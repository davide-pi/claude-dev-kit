// Pure formatting and parsing helpers of the cockpit: no `$`, no state, all unit-tested.
// Logic ported from ~/.claude/statusline.js (abbrevTokens, countdown, rateColor, weeklyPace).

import type {
  CockpitAgent,
  CockpitAlm,
  CockpitBurnSample,
  CockpitDoneClaim,
  CockpitGit,
  CockpitHistoryEntry,
  CockpitPerimeterCheck,
  CockpitSnapshot,
  CockpitTab,
  CockpitTask,
} from '../types'

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

/** Context color by fill: green, yellow, red (no orange: too close to red). */
export const ctxColor = (pct: number): string =>
  pct < 40 ? COLORS.green : pct < 80 ? COLORS.yellow : COLORS.red

/** `git status --porcelain -b` -> branch and dirty counts; undefined outside a repository. */
export function parseGitStatus(
  out: string,
): { branch: string; isDetached: boolean; staged: number; modified: number; untracked: number } | undefined {
  const lines = out.split('\n').filter(l => l.length > 0)
  const header = lines[0]?.startsWith('## ') ? (lines.shift() ?? '').slice(3) : ''
  const isDetached = / \(no branch\)$/.test(header)
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
  return { branch, isDetached, staged, modified, untracked }
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

/** A percentage in a 4-cell column (`  7%`, ` 87%`, `100%`) so one-, two- and three-digit values line up. */
export const pctCell = (n: number): string => `${String(n).padStart(3)}%`

// ── Burn rate of the 5h window ───────────────────────────────────────────────

const BURN_WINDOW_MS = 30 * 60_000
const BURN_MIN_SPAN_MS = 10 * 60_000
const FIVE_HOURS_MS = 5 * 3_600_000

/** A reset time as the engine reports it (ISO text) in milliseconds; undefined when absent or not a date. */
export function parseReset(resetsAt: string | undefined): number | undefined {
  const ms = resetsAt ? Date.parse(resetsAt) : Number.NaN
  return Number.isNaN(ms) ? undefined : ms
}

/** The readings taken inside the current 5h window, which opened five hours before its reset: an older one belongs to the last window. */
const sinceWindowOpen = (samples: readonly CockpitBurnSample[], resetsAtMs: number | undefined): CockpitBurnSample[] =>
  resetsAtMs === undefined ? [...samples] : samples.filter(s => s.at >= resetsAtMs - FIVE_HOURS_MS)

/**
 * Appends the 5h usage reading `used` taken at `now`, keeping the last 30 minutes. A reading equal to the last one
 * adds nothing (the rate counts from the oldest reading to the present), so the reading that fell out of the window
 * is what the credits stood at when it opened: it stays as the first sample, clamped to the window's start. A lower
 * reading means the window reset: start over. Given the window's reset time, a reading older than the window's opening
 * is dropped: the credits were not counting from it.
 */
export function recordBurnSample(
  samples: readonly CockpitBurnSample[] | undefined,
  now: number,
  used: number | undefined,
  resetsAtMs?: number,
): CockpitBurnSample[] {
  const start = now - BURN_WINDOW_MS
  const current = sinceWindowOpen(samples ?? [], resetsAtMs)
  const inWindow = current.filter(s => s.at >= start)
  const before = current.filter(s => s.at < start).at(-1)
  const kept = before && inWindow[0]?.at !== start ? [{ at: start, used: before.used }, ...inWindow] : inWindow
  if (used === undefined) return kept
  const last = kept.at(-1)
  if (last && used < last.used) return [{ at: now, used }]
  return last && used === last.used ? kept : [...kept, { at: now, used }]
}

/**
 * How fast the 5h credits fall, from the reading at the start of the last 30 minutes (the last one before it, when
 * none lies on it: the value held since) to `used` now: the rate in points
 * per hour, when they run out, and whether that is before the reset. A reading from before the current window opened
 * (five hours before the reset) is never the start. Undefined with under 10 minutes of readings,
 * a rate that rounds to under 1 %/h, a window already spent or no reset ahead.
 */
export function burnRate(
  samples: readonly CockpitBurnSample[],
  now: number,
  used: number,
  resetsAtMs: number | undefined,
): { perHour: number; etaMs: number; isBeforeReset: boolean } | undefined {
  const start = now - BURN_WINDOW_MS
  const current = sinceWindowOpen(samples, resetsAtMs)
  const before = current.filter(s => s.at < start).at(-1)
  const oldest = before ? { at: start, used: before.used } : current.find(s => s.at >= start)
  if (!oldest || resetsAtMs === undefined || resetsAtMs <= now || used >= 100) return undefined
  const span = now - oldest.at
  if (span < BURN_MIN_SPAN_MS) return undefined
  const perHour = ((used - oldest.used) * 3_600_000) / span
  if (Math.round(perHour) < 1) return undefined
  const etaMs = ((100 - used) * 3_600_000) / perHour
  return { perHour, etaMs, isBeforeReset: etaMs < resetsAtMs - now }
}

/** `−9%/h · finisce tra  6h53m: arrivi al reset`, or `…, prima del reset` (the time in `fixedSpan`'s 6 cells). */
export function burnText(b: { perHour: number; etaMs: number; isBeforeReset: boolean }): string {
  return `\u2212${Math.round(b.perHour)}%/h \u00b7 finisce tra ${fixedSpan(b.etaMs)}${b.isBeforeReset ? ', prima del reset' : ': arrivi al reset'}`
}

// ── ALM target of the working directory ──────────────────────────────────────

// A directory in the form the roots are compared in: forward slashes, no trailing one, lowercase.
const normDir = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * The ALM target of `cwd` from the parsed `workspaces.json`, by the rules of hooks/lib/workspaces.js: the longest
 * root whose path contains the directory, case-insensitively (a port: the mod cannot require a Node module). A root
 * names its `project`, or maps the first subfolder through `projects`; `"ask"`, an unlisted subfolder and a GitHub
 * root leave the project out. Undefined when there is no usable map: the hook is silent then, and so is the line.
 */
export function resolveAlm(map: unknown, cwd: string): CockpitAlm | undefined {
  const rawRoots = isRecord(map) ? map.roots : undefined
  if (!Array.isArray(rawRoots)) return undefined
  const roots = rawRoots
    .filter((r): r is Record<string, unknown> & { path: string } => isRecord(r) && typeof r.path === 'string')
    .map(r => ({ entry: r, root: normDir(r.path) }))
    .sort((a, b) => b.root.length - a.root.length)
  const dir = normDir(cwd)
  const hit = roots.find(({ root }) => dir === root || dir.startsWith(`${root}/`))
  if (!hit) return { isMapped: false }
  const { entry, root } = hit
  const alm: CockpitAlm = { isMapped: true }
  if (typeof entry.org === 'string') alm.org = entry.org
  const project = projectOf(entry, dir.slice(root.length + 1).split('/')[0] ?? '')
  if (project && entry.platform !== 'github') alm.project = project
  if (typeof entry.identity === 'string' && /^[\w.-]+$/.test(entry.identity)) alm.identity = entry.identity
  return alm
}

function projectOf(entry: Record<string, unknown>, firstSubfolder: string): string | undefined {
  if (isRecord(entry.projects)) {
    const key = Object.keys(entry.projects).find(k => k.toLowerCase() === firstSubfolder)
    const name = key === undefined ? undefined : entry.projects[key]
    return typeof name === 'string' ? name : undefined
  }
  return typeof entry.project === 'string' && entry.project !== 'ask' && entry.project !== '' ? entry.project : undefined
}

/** The target alone, `<org> / <project> · <identity>`, each part only when known (empty when none is); `non mappato` when no root matches. */
export function almText(alm: CockpitAlm): string {
  if (!alm.isMapped) return 'non mappato'
  const target = [alm.org, alm.project].filter(Boolean).join(' / ')
  return [target, alm.identity].filter(Boolean).join(' \u00b7 ')
}

// ── History of finished agents ───────────────────────────────────────────────

/** Entries the history keeps (the state file persists them); the pane lists the newest ten of them. */
export const HISTORY_KEEP = 50

/** What the history keeps of a finished agent; undefined for one the mod only saw through its events (type `?`). */
export function toHistory(a: CockpitAgent): CockpitHistoryEntry | undefined {
  if (a.type === '?' || a.endedAt === undefined) return undefined
  return { id: a.id, type: a.type, model: a.model, startedAt: a.startedAt, endedAt: a.endedAt, tokens: a.tokens, isFailed: a.isFailed === true, ...(a.isInterrupted === true && { isInterrupted: true }) }
}

/** `entries` go in front (newest first), an id already there replaced; the list is cut to `HISTORY_KEEP`. */
export const addHistory = (history: readonly CockpitHistoryEntry[] | undefined, entries: readonly CockpitHistoryEntry[]): CockpitHistoryEntry[] => {
  const ids = new Set(entries.map(e => e.id))
  return [...entries, ...(history ?? []).filter(h => !ids.has(h.id))].slice(0, HISTORY_KEEP)
}

/** The history out of a parsed state file: the entries that have every field, in order; none for anything else. */
export function parseHistory(value: unknown): CockpitHistoryEntry[] {
  if (!Array.isArray(value)) return []
  const out: CockpitHistoryEntry[] = []
  for (const v of value.slice(0, HISTORY_KEEP)) {
    if (!isRecord(v)) continue
    const { id, type, model, startedAt, endedAt, tokens, isFailed, isInterrupted } = v
    if (typeof id !== 'string' || typeof type !== 'string' || typeof startedAt !== 'number' || typeof endedAt !== 'number') continue
    out.push({
      id,
      type,
      model: typeof model === 'string' ? model : undefined,
      startedAt,
      endedAt,
      tokens: typeof tokens === 'number' ? tokens : 0,
      isFailed: isFailed === true,
      ...(isInterrupted === true && { isInterrupted: true }),
    })
  }
  return out
}

// ── Buttons: what `compatta` tells the summary to keep, and what `segna ore` asks the worklog for ──

/** The open tasks the pane lists: in progress first, then pending, each in the order it arrived. */
export const openTasks = (s: Pick<CockpitSnapshot, 'tasks'>): CockpitTask[] => {
  const tasks = s.tasks ?? []
  return [...tasks.filter(t => t.status === 'in_progress'), ...tasks.filter(t => t.status === 'pending')]
}

const COMPACT_KEEP =
  "Tieni: task in corso, decisioni prese con l'utente e il loro perché, domande aperte, file toccati e stato, comandi con la riga di output che decide, prossimi passi. Butta: output di tool già riassunti, tentativi superati."
const COMPACT_MAX = 400
const COMPACT_ITEM_MAX = 40
const COMPACT_LIST_MAX = 3
const COMPACT_PERIMETER_MAX = 2

/**
 * What the summary of `compatta` should keep, in Italian and at most 400 characters: the fixed sentence, then what the
 * snapshot knows (the open task titles, the deliver perimeter: its size and first two entries, the name of the workflow
 * the last `Stop` reported in flight), each part only when it fits.
 */
export function compactInstructions(s: Pick<CockpitSnapshot, 'tasks' | 'perimeter' | 'workflow'>): string {
  const cut = (items: readonly string[], max = COMPACT_LIST_MAX) => items.slice(0, max).map(i => truncEnd(i, COMPACT_ITEM_MAX))
  const perimeter = s.perimeter ?? []
  const parts = [
    { head: 'Task aperti: ', items: cut(openTasks(s).map(t => t.subject)), sep: '; ' },
    { head: `Perimetro deliver (${perimeter.length} ${perimeter.length === 1 ? 'voce' : 'voci'}): `, items: cut(perimeter, COMPACT_PERIMETER_MAX), sep: ', ' },
    { head: 'Workflow in corso: ', items: cut(s.workflow ? [s.workflow] : []), sep: '' },
  ]
  let out = COMPACT_KEEP
  for (const { head, items, sep } of parts) {
    // as many items as fit; none fitting leaves the part out
    for (let n = items.length; n > 0; n--) {
      const next = `${out} ${head}${items.slice(0, n).join(sep)}.`
      if ([...next].length <= COMPACT_MAX) {
        out = next
        break
      }
    }
  }
  return out
}

/** The work item id a branch name carries (`AB#1234`, `/1234-`, `feature/1234`); undefined when it carries none. */
export const branchWorkItemId = (branch: string): string | undefined =>
  /AB#(\d+)/i.exec(branch)?.[1] ?? /(?:^|\/)(\d{3,})(?=$|[-_/])/.exec(branch)?.[1]

const DEFAULT_BRANCHES: readonly string[] = ['main', 'master', 'develop']

/** The branch is a default one: `main`, `master`, `develop` or the repo's own (`defaultBranch`, from `origin/HEAD`). */
export const isDefaultBranch = (branch: string, defaultBranch?: string): boolean =>
  DEFAULT_BRANCHES.includes(branch) || branch === defaultBranch

/**
 * The scope `/worklog` takes for the work in hand: `AB#<id>` when the branch name carries a work item id
 * (`AB#1234`, `/1234-`, `feature/1234`), else `PR <n>` when a pull request is known, else `topic <branch>`;
 * none on a detached HEAD, without git, or on the default branch (`main`, `master`, `develop` or the repo's own,
 * `defaultBranch`), where no implementation is identifiable.
 */
export function worklogScope(git: CockpitGit | undefined, prNumber?: number, defaultBranch?: string): string | undefined {
  if (!git || git.isDetached || isDefaultBranch(git.branch, defaultBranch)) return undefined
  const id = branchWorkItemId(git.branch)
  if (id) return `AB#${id}`
  return prNumber !== undefined ? `PR ${prNumber}` : `topic ${git.branch}`
}

/** `git symbolic-ref --short refs/remotes/origin/HEAD` -> the repo's default branch (`origin/main` -> `main`); undefined for anything else. */
export const parseDefaultBranch = (out: string): string | undefined => /^origin\/(.+)$/.exec(out.trim())?.[1]

/** An `origin` URL (ssh or https) that points at github.com. */
export const isGithubRemote = (url: string): boolean => /(?:^|[@/])github\.com[:/]/i.test(url.trim())

/** `gh pr view --json number,state` -> the number of an open pull request; undefined for any other state or text. */
export function parsePrNumber(out: string): number | undefined {
  try {
    const parsed: unknown = JSON.parse(out)
    if (!isRecord(parsed)) return undefined
    const { number, state } = parsed
    return state === 'OPEN' && typeof number === 'number' && Number.isInteger(number) && number > 0 ? number : undefined
  } catch {
    return undefined
  }
}

/** `deliver`'s perimeter file -> its entries, when it is active and for `branch` (as `hooks/scope-guard.js` reads it); else undefined. */
export function parsePerimeter(text: string, branch: string): string[] | undefined {
  const entries: string[] = []
  let fileBranch = ''
  let isActive = false
  for (const raw of text.split(/\r?\n/)) {
    const l = raw.trim()
    const b = /^branch:\s*(.+)$/i.exec(l)
    if (b) fileBranch = (b[1] ?? '').trim()
    else if (/^status:\s*active\s*$/i.test(l)) isActive = true
    else if (l.startsWith('- ') && l.slice(2).trim()) entries.push(l.slice(2).trim())
  }
  return isActive && entries.length > 0 && fileBranch !== '' && fileBranch === branch ? entries : undefined
}

const slashes = (p: string): string => p.trim().replace(/\\/g, '/').replace(/^\.\//, '')

/** A perimeter entry as a regex over a repo-relative path: a file, a directory (trailing `/`) or a glob; anchored, case-insensitive (as `hooks/scope-guard.js`). */
function entryRegex(entry: string): RegExp {
  let e = slashes(entry)
  if (e.endsWith('/')) e += '**'
  const src = e
    .replace(/[.+^${}()|[\]]/g, '\\$&')
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\u0000/g, '.*')
    .replace(/\?/g, '[^/]')
  return new RegExp(`^${src}$`, 'i')
}

/**
 * How many of the `changed` files (repo-relative, tracked and untracked) there are, and which of them the perimeter `entries`
 * do not cover: what `hooks/scope-guard.js --check` lists (a plan under `docs/plans/` and `.git/` are never outside).
 */
export function checkPerimeter(changed: readonly string[], entries: readonly string[]): CockpitPerimeterCheck {
  const regexes = entries.map(entryRegex)
  const seen = new Set<string>()
  const outside: string[] = []
  for (const raw of changed) {
    const p = slashes(raw)
    if (!p || seen.has(p)) continue
    seen.add(p)
    const lower = p.toLowerCase()
    if (lower.startsWith('docs/plans/') || lower.startsWith('.git/') || regexes.some(r => r.test(p))) continue
    outside.push(p)
  }
  return { files: seen.size, outside }
}

// ── The done-claim hook's log ────────────────────────────────────────────────

const CLAIMS_SHOWN = 3
const CLAIM_EXCERPT_MAX = 160

/** The last `CLAIMS_SHOWN` lines of `done-claim.log` (one JSON object each), newest first; a line without `at` and `rule` is skipped. */
export function parseDoneClaims(text: string): CockpitDoneClaim[] {
  const out: CockpitDoneClaim[] = []
  for (const l of text.split(/\r?\n/).reverse()) {
    if (out.length === CLAIMS_SHOWN) break
    try {
      const v: unknown = JSON.parse(l)
      if (!isRecord(v) || typeof v.at !== 'string' || typeof v.rule !== 'string') continue
      out.push({ at: v.at, rule: v.rule, excerpt: typeof v.excerpt === 'string' ? v.excerpt.trim().slice(0, CLAIM_EXCERPT_MAX) : '' })
    } catch {
      // a torn or foreign line
    }
  }
  return out
}

/** `22/10 09:05`: the log entry's day and time on the local clock; empty for a date that does not parse. */
export function claimTime(at: string): string {
  const d = new Date(at)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** The cockpit's tabs, in the order the bar draws them. */
export const TABS: readonly CockpitTab[] = ['session', 'agents', 'work', 'repo']

export const isTab = (v: unknown): v is CockpitTab => TABS.some(tab => tab === v)
