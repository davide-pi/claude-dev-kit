// Pure formatting and parsing helpers of the cockpit: no `$`, no state, all unit-tested.
// Logic ported from ~/.claude/statusline.js (abbrevTokens, countdown, rateColor, weeklyPace).

import type { SessionContextBreakdown } from 'claude-code'

import type {
  CockpitAgent,
  CockpitAlm,
  CockpitBurnSample,
  CockpitChange,
  CockpitClaudeState,
  CockpitConsumer,
  CockpitContext,
  CockpitDoneClaim,
  CockpitGit,
  CockpitHistoryEntry,
  CockpitPerimeterCheck,
  CockpitContextRow,
  CockpitPr,
  CockpitRateLimit,
  CockpitSnapshot,
  CockpitStatic,
  CockpitSysLine,
  CockpitSysProc,
  CockpitSystem,
  CockpitSystemPart,
  CockpitTab,
  CockpitTask,
  CockpitToolCall,
  CockpitUsage,
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
  folder: '\u{F024B}', // nf-md-folder: a folder that is not a repository
  repo: '\u{F0CCF}', // nf-md-source_repository: a repository's own checkout
  tree: '\u{F0CD0}', // nf-md-source_repository_multiple: a linked worktree, another checkout of the same repo
  branch: '\u{F062C}', // nf-md-source_branch
  disk: '\u{F02CA}', // nf-md-harddisk
  battery: '\u{F0079}', // nf-md-battery
  charging: '\u{F0084}', // nf-md-battery_charging
  plug: '\u{F06A5}', // nf-md-power_plug
} as const

/** The folder glyph by what the folder is: a linked worktree, a repository's checkout, or a plain folder (no git). */
export const folderIcon = (git: Pick<CockpitGit, 'root' | 'worktreeRoot'> | undefined): string =>
  git?.worktreeRoot ? ICONS.tree : git ? ICONS.repo : ICONS.folder

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

/** The cache hit of the last turn by thresholds: green from 80 %, amber from 50 to 79, red below. */
export const cacheColor = (pct: number): string => (pct >= 80 ? COLORS.green : pct >= 50 ? COLORS.amber : COLORS.red)

const STATE_LOOK = {
  idle: { icon: '○', text: 'ready', color: COLORS.dim },
  working: { icon: '◐', text: 'working', color: COLORS.blue },
  thinking: { icon: '◌', text: 'thinking', color: COLORS.lavender },
  tool: { icon: '▸', text: '', color: COLORS.green },
  waiting: { icon: '◆', text: 'waiting', color: COLORS.yellow },
} as const
const STATE_TOOL_MAX = 14

/** The header's Claude state: an icon and a word (the tool's own name while one runs, cut to fit); no state yet reads as idle. */
export function claudeStateSpans(state: CockpitClaudeState | undefined): Span[] {
  const look = STATE_LOOK[state?.kind ?? 'idle']
  const text = state?.kind === 'tool' && state.tool ? truncEnd(state.tool, STATE_TOOL_MAX) : look.text
  return [{ t: `${look.icon} ${text}`, c: look.color }]
}

/**
 * The state to go back to when a permission wait that began in `held` is answered: a main tool still in flight (the held one when
 * it is, else the newest) or, with none, what the wait interrupted (working when that was a tool that has since ended).
 */
export function stateAfterWait(held: CockpitClaudeState | undefined, inFlight: readonly string[]): CockpitClaudeState {
  const tool = held?.kind === 'tool' && held.tool !== undefined && inFlight.includes(held.tool) ? held.tool : inFlight.at(-1)
  if (tool !== undefined) return { kind: 'tool', tool }
  return held && held.kind !== 'tool' && held.kind !== 'waiting' ? held : { kind: 'working' }
}

/** ` ↑2 ↓1`: the commits ahead of and behind the upstream; empty when level or without an upstream. */
export function aheadBehindSpans(g: CockpitGit): Span[] {
  const parts: Span[] = []
  if (g.ahead) parts.push({ t: `↑${g.ahead}`, c: COLORS.green })
  if (g.behind) parts.push({ t: `↓${g.behind}`, c: COLORS.yellow })
  return parts.flatMap((p): Span[] => [{ t: ' ' }, p])
}

// ── Context growth and the autocompact forecast ──

export const CTX_SAMPLES_KEEP = 6

/** `samples` with this main turn's context size added: the last six kept, and a context that shrank (a compaction) starts over. */
export function recordCtxSample(samples: readonly number[] | undefined, tokens: number): number[] {
  const last = samples?.at(-1)
  const kept = last !== undefined && tokens < last ? [] : (samples ?? [])
  return [...kept, tokens].slice(-CTX_SAMPLES_KEEP)
}

/**
 * Requests left before auto-compaction at `threshold`: the room left from the last reading over the average growth per
 * turn. Absent with fewer than two readings, no threshold (auto-compaction off) or a context that does not grow.
 */
export function autocompactForecast(samples: readonly number[] | undefined, threshold: number | undefined): number | undefined {
  if (samples === undefined || samples.length < 2 || threshold === undefined) return undefined
  const first = samples[0] ?? 0
  const last = samples[samples.length - 1] ?? 0
  const growth = (last - first) / (samples.length - 1)
  return growth > 0 ? Math.max(0, Math.ceil((threshold - last) / growth)) : undefined
}

// ── The Context tab: the breakdown, the sparkline of rounds, when to compact ──

/** Main turns the sparkline keeps. */
export const ROUNDS_KEEP = 20
/** The context fill from which the compact hint can show with the rounds' growth, and the growth each of the last rounds needs. */
export const COMPACT_HINT_PCT = 70
const COMPACT_GROWTH = 1.05
const COMPACT_ROUNDS = 3
/** The hint shows with this many requests (or fewer) left before auto-compaction, whatever the fill. */
const COMPACT_FORECAST_MAX = 3
const CONSUMERS_SHOWN = 5

/** `rounds` with this main turn's context size added, the last twenty kept. A shrinking context stays: a compaction is a drop to see. */
export const recordRound = (rounds: readonly number[] | undefined, tokens: number): number[] => [...(rounds ?? []), tokens].slice(-ROUNDS_KEEP)

const SPARK = '▁▂▃▄▅▆▇█'

/** One block per value, scaled to `max` (the tallest of them when not given; a value of 0 is the lowest block, one above `max` the highest); empty without values. */
export function sparkline(values: readonly number[], max: number = Math.max(0, ...values)): string {
  return values.map(v => SPARK[max > 0 ? Math.min(SPARK.length - 1, Math.round((Math.max(0, v) / max) * (SPARK.length - 1))) : 0]).join('')
}

/** One block per value, scaled between the lowest and the highest of them: a flat series draws the lowest block (nothing to tell apart), never noise; empty without values. */
export function rangeSparkline(values: readonly number[]): string {
  if (values.length === 0) return ''
  const min = Math.min(...values)
  const span = Math.max(...values) - min
  return values.map(v => SPARK[span > 0 ? Math.round(((v - min) / span) * (SPARK.length - 1)) : 0]).join('')
}

/**
 * Whether `worth compacting` shows: the context is at 70 % or more and each of the last three rounds grew it by more than 5 %
 * of the round before, or auto-compaction is three requests away or nearer (`forecast`), whatever the fill.
 */
export function shouldCompact(p: { percent?: number; rounds?: readonly number[]; forecast?: number }): boolean {
  if (p.forecast !== undefined && p.forecast <= COMPACT_FORECAST_MAX) return true
  const last = (p.rounds ?? []).slice(-(COMPACT_ROUNDS + 1))
  const isGrowing = last.length === COMPACT_ROUNDS + 1 && last.every((v, i) => i === 0 || v > (last[i - 1] ?? Infinity) * COMPACT_GROWTH)
  return (p.percent ?? 0) >= COMPACT_HINT_PCT && isGrowing
}

const ROW_ORDER = { used: 0, deferred: 1, free: 2, buffer: 3 } as const

/** The rows biggest first: what fills the window, then the tool schemas outside it, then the free space and the compaction buffer. */
export const sortRows = (rows: readonly CockpitContextRow[]): CockpitContextRow[] =>
  [...rows].sort((a, b) => ROW_ORDER[a.kind] - ROW_ORDER[b.kind] || b.tokens - a.tokens)

/** Messages are what the conversation holds and change with every response; every other row of the window is fixed for a session. */
const isStaticRow = (r: CockpitContextRow): boolean => (r.kind === 'used' || r.kind === 'deferred') && !/^messages$/i.test(r.name)

/** What an exact reading fixes for the session: its static rows, consumers and skills listing. */
export const staticOf = (c: CockpitContext): CockpitStatic => ({
  rows: c.rows.filter(isStaticRow).map(r => ({ name: r.name, tokens: r.tokens })),
  consumers: c.consumers,
  ...(c.skills && { skills: c.skills }),
})

/**
 * A summary reading with the static part of an exact count laid over it: those rows (marked exact), the consumers and the skills
 * listing come from the count, Messages stay the summary's. The free space gives back what the used rows took, the total follows.
 */
export function withStatic(c: CockpitContext, fixed: CockpitStatic): CockpitContext {
  let diff = 0
  const rows = c.rows.map((r): CockpitContextRow => {
    const exact = isStaticRow(r) ? fixed.rows.find(f => f.name === r.name) : undefined
    if (!exact) return r
    if (r.kind === 'used') diff += exact.tokens - r.tokens
    return { ...r, tokens: exact.tokens, isExact: true }
  })
  return {
    ...c,
    rows: sortRows(rows.map(r => (r.kind === 'free' ? { ...r, tokens: Math.max(0, r.tokens - diff) } : r))),
    total: c.total + diff,
    consumers: fixed.consumers,
    ...(fixed.skills && { skills: fixed.skills }),
    isExact: false,
  }
}

/** `next` with each row's change from `previous`: measured by a round's read, kept as it was by any other; a row the reading before did not have has none. */
export function withDeltas(next: CockpitContext, previous: CockpitContext | undefined, isRound: boolean): CockpitContext {
  const before = new Map((previous?.rows ?? []).map(r => [r.name, r]))
  return {
    ...next,
    rows: next.rows.map((r): CockpitContextRow => {
      const was = before.get(r.name)
      const delta = was === undefined ? undefined : isRound ? r.tokens - was.tokens : was.delta
      return delta === undefined ? r : { ...r, delta }
    }),
  }
}

/**
 * What the Context tab keeps of a breakdown: every row as the engine lists it, the window, and the five biggest static
 * consumers (memory files, MCP tools inside the window, agents, and the skills listing as one).
 */
export function contextOf(
  b: Pick<SessionContextBreakdown, 'categories' | 'totalTokens' | 'rawMaxTokens' | 'memoryFiles' | 'mcpTools' | 'agents' | 'skills'>,
  isExact: boolean,
): CockpitContext {
  const consumers: CockpitConsumer[] = [
    ...b.memoryFiles.map((f): CockpitConsumer => ({ name: `${f.type} ${baseName(f.path)}`, kind: 'memory', tokens: f.tokens })),
    ...b.mcpTools.filter(t => t.isLoaded).map((t): CockpitConsumer => ({ name: t.name, kind: 'mcp', tokens: t.tokens })),
    ...b.agents.map((a): CockpitConsumer => ({ name: a.agentType, kind: 'agent', tokens: a.tokens })),
    ...(b.skills ? [{ name: 'skills', kind: 'skill' as const, tokens: b.skills.tokens }] : []),
  ]
  return {
    rows: sortRows(b.categories.map(c => ({ name: c.name, tokens: c.tokens, kind: c.kind }))),
    total: b.totalTokens,
    max: b.rawMaxTokens,
    consumers: consumers.filter(c => c.tokens > 0).sort((a, c) => c.tokens - a.tokens).slice(0, CONSUMERS_SHOWN),
    ...(b.skills && { skills: { listed: b.skills.includedSkills, total: b.skills.totalSkills } }),
    isExact,
  }
}

/**
 * What a selected tab asks of the clock tiers: `fast` (2 s) for the elapsed times it draws. The medium tier (10 s, git) runs
 * whenever the pane is open, the header shows git on every tab; the slow tier (30 s) runs whatever the tab; none of them
 * while the pane is closed.
 */
export function tabNeeds(tab: CockpitTab | undefined): { fast: boolean } {
  switch (tab ?? 'agents') {
    case 'context':
    case 'system':
      return { fast: false }
    default:
      return { fast: true }
  }
}

/** `git status --porcelain -b` -> branch, dirty counts and the upstream with the commits ahead and behind it (none for a branch without one, or whose upstream is gone); undefined outside a repository. */
export function parseGitStatus(
  out: string,
): { branch: string; isDetached: boolean; staged: number; modified: number; untracked: number; upstream?: string; ahead?: number; behind?: number } | undefined {
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
  const tracking = /\.\.\.(\S+)(?: \[([^\]]*)\])?\s*$/.exec(header)
  const upstream = tracking?.[2] === 'gone' ? undefined : tracking?.[1]
  const range = tracking?.[2] ?? ''
  const ahead = Number(/ahead (\d+)/.exec(range)?.[1] ?? 0)
  const behind = Number(/behind (\d+)/.exec(range)?.[1] ?? 0)
  return { branch, isDetached, staged, modified, untracked, ...(upstream !== undefined && { upstream, ahead, behind }) }
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
  const what = kind === 'pending' ? 'to log' : 'under target'
  return `worklog: ${dates.length}d ${what} (${dates.map(shortDate).join(', ')})`
}

/** A percentage in a 4-cell column (`  7%`, ` 87%`, `100%`) so one-, two- and three-digit values line up. */
export const pctCell = (n: number): string => `${String(n).padStart(3)}%`

// ── Burn rate of the 5h window ───────────────────────────────────────────────

const BURN_WINDOW_MS = 30 * 60_000
const BURN_MIN_SPAN_MS = 10 * 60_000
const FIVE_HOURS_MS = 5 * 3_600_000

/**
 * The status line's rate-limit cache (`.statusline-rate-limits.json`, `resets_at` in seconds) as the engine's limits, reconciled the way the
 * status line does: a window whose reset is over is back to 0 % used with no reset time. A window of the wrong shape is left out.
 */
export function parseRateCache(value: unknown, now: number): CockpitRateLimit[] {
  if (!isRecord(value)) return []
  const window = (kind: 'five_hour' | 'seven_day'): CockpitRateLimit[] => {
    const w = value[kind]
    if (!isRecord(w) || typeof w.used_percentage !== 'number' || !Number.isFinite(w.used_percentage)) return []
    const resetsMs = typeof w.resets_at === 'number' && Number.isFinite(w.resets_at) && w.resets_at > 0 ? w.resets_at * 1000 : undefined
    if (resetsMs !== undefined && resetsMs <= now) return [{ kind, percentUsed: 0 }]
    return [{ kind, percentUsed: w.used_percentage, ...(resetsMs !== undefined && { resetsAt: new Date(resetsMs).toISOString() }) }]
  }
  return [...window('five_hour'), ...window('seven_day')]
}

/** The context a data file keeps (`tokens`, `window`, `percent`); none when any of the three is not a count. */
export function parseCtx(value: unknown): CockpitSnapshot['lastCtx'] {
  if (!isRecord(value)) return undefined
  const { tokens, window, percent } = value
  return isCount(tokens) && isCount(window) && isCount(percent) ? { tokens, window, percent } : undefined
}

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

/** `−9%/h · runs out in  6h53m: lasts to the reset`, or `…, before the reset` (the time in `fixedSpan`'s 6 cells). */
export function burnText(b: { perHour: number; etaMs: number; isBeforeReset: boolean }): string {
  return `\u2212${Math.round(b.perHour)}%/h \u00b7 runs out in ${fixedSpan(b.etaMs)}${b.isBeforeReset ? ', before the reset' : ': lasts to the reset'}`
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

/** The target alone, `<org> / <project> · <identity>`, each part only when known (empty when none is); `unmapped` when no root matches. */
export function almText(alm: CockpitAlm): string {
  if (!alm.isMapped) return 'unmapped'
  const target = [alm.org, alm.project].filter(Boolean).join(' / ')
  return [target, alm.identity].filter(Boolean).join(' \u00b7 ')
}

// ── Tokens: the four counters, live per step, and an agent's share of the session ──

/** The counters of an API usage record (`ModelUsage`). */
export const usageOf = (u: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }): CockpitUsage => ({
  input: u.input_tokens,
  output: u.output_tokens,
  cacheRead: u.cache_read_input_tokens,
  cacheWrite: u.cache_creation_input_tokens,
})

export const addUsage = (a: CockpitUsage | undefined, b: CockpitUsage): CockpitUsage => ({
  input: (a?.input ?? 0) + b.input,
  output: (a?.output ?? 0) + b.output,
  cacheRead: (a?.cacheRead ?? 0) + b.cacheRead,
  cacheWrite: (a?.cacheWrite ?? 0) + b.cacheWrite,
})

/** New tokens: input + cache writes + output, cache reads left out (the count an agent's `tokens` keeps). */
export const newTokens = (u: CockpitUsage | undefined): number => (u ? u.input + u.output + u.cacheWrite : 0)

/** `total` when a turn ends with its own count `final`: the part its steps added (`step`) is swapped for `final`; no count leaves `total` as the steps made it. */
export function settleUsage(total: CockpitUsage | undefined, step: CockpitUsage | undefined, final: CockpitUsage | undefined): CockpitUsage | undefined {
  if (final === undefined) return total
  const left = (a: number | undefined, b: number | undefined) => Math.max(0, (a ?? 0) - (b ?? 0))
  return {
    input: left(total?.input, step?.input) + final.input,
    output: left(total?.output, step?.output) + final.output,
    cacheRead: left(total?.cacheRead, step?.cacheRead) + final.cacheRead,
    cacheWrite: left(total?.cacheWrite, step?.cacheWrite) + final.cacheWrite,
  }
}

/** New tokens of the whole session: the main loop's, every agent listed and the cumulative count of those that left the list. */
export const sessionTokens = (s: Pick<CockpitSnapshot, 'mainTokens' | 'agents' | 'agentTokens'>): number =>
  (s.mainTokens ?? 0) + s.agents.reduce((n, a) => n + a.tokens, 0) + (s.agentTokens ?? 0)

/** The cumulative count `total` plus the tokens of the agents `leaving` the live list; absent stays absent until an agent leaves. */
export function withAgentTokens(total: number | undefined, leaving: readonly { tokens: number }[]): number | undefined {
  return leaving.length === 0 ? total : (total ?? 0) + leaving.reduce((n, a) => n + a.tokens, 0)
}

/** `tokens` as a share of `total`, `12%` (`<1%` for a non-empty share that rounds to none); undefined when nothing was used yet. */
export function tokenShare(tokens: number, total: number): string | undefined {
  if (total <= 0 || tokens < 0) return undefined
  const pct = Math.min(100, Math.round((100 * tokens) / total))
  return pct === 0 && tokens > 0 ? '<1%' : `${pct}%`
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

// ── Buttons: what `compact` tells the summary to keep, and what `log hours` asks the worklog for ──

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
 * What the summary of `compact` should keep, in Italian and at most 400 characters: the fixed sentence, then what the
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

const DEFAULT_BRANCHES: readonly string[] = ['main', 'master', 'develop']

/** The branch is a default one: `main`, `master`, `develop` or the repo's own (`defaultBranch`, from `origin/HEAD`). */
export const isDefaultBranch = (branch: string, defaultBranch?: string): boolean =>
  DEFAULT_BRANCHES.includes(branch) || branch === defaultBranch

/** `git symbolic-ref --short refs/remotes/origin/HEAD` -> the repo's default branch (`origin/main` -> `main`); undefined for anything else. */
export const parseDefaultBranch = (out: string): string | undefined => /^origin\/(.+)$/.exec(out.trim())?.[1]

/** An `origin` URL (ssh or https) that points at github.com. */
export const isGithubRemote = (url: string): boolean => /(?:^|[@/])github\.com[:/]/i.test(url.trim())

/** An `origin` URL (ssh or https, the old `visualstudio.com` host too) that points at Azure DevOps. */
export const isAzureRemote = (url: string): boolean => /(?:^|[@/])(?:ssh\.)?dev\.azure\.com[:/]|\.visualstudio\.com[:/]/i.test(url.trim())

/** The project (absent when the remote names none: the project's default repository) and repository of an Azure DevOps remote; undefined for any other URL. */
export function azureRepo(url: string): { project?: string; repo: string } | undefined {
  const u = url.trim()
  if (!isAzureRemote(u)) return undefined
  const decode = (s: string | undefined): string | undefined => {
    if (s === undefined || s === '') return undefined
    try {
      return decodeURIComponent(s)
    } catch {
      return s
    }
  }
  // scheme and user dropped, then host and path segments: `dev.azure.com/<org>/<project>/_git/<repo>`, `ssh.dev.azure.com:v3/<org>/<project>/<repo>`
  const [host = '', ...segs] = u
    .replace(/^[a-z+]+:\/\//i, '')
    .replace(/^[^@/]*@/, '')
    .replace(/[?#].*$/, '')
    .split(/[/:]/)
    .filter(s => s !== '')
  if (segs[0] === 'v3') {
    const repo = decode(segs[3])
    return repo === undefined ? undefined : { project: decode(segs[2]), repo }
  }
  const g = segs.indexOf('_git')
  const repo = g < 0 ? undefined : decode(segs[g + 1])
  if (repo === undefined) return undefined
  // on dev.azure.com the organization comes first, on visualstudio.com it is the host
  const project = decode(segs[g - 1])
  const isOrgOnly = host.endsWith('dev.azure.com') ? g < 2 : g < 1
  return isOrgOnly ? { repo } : { project, repo }
}

const CHECK_PASSED: readonly string[] = ['SUCCESS', 'NEUTRAL', 'SKIPPED']
const CHECK_FAILED: readonly string[] = ['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE']

/** The checks of a `statusCheckRollup` told passed, failed or not decided yet; undefined without any. */
function summarizeChecks(rollup: unknown): CockpitPr['checks'] {
  if (!Array.isArray(rollup)) return undefined
  const out = { passed: 0, failed: 0, pending: 0 }
  for (const c of rollup) {
    if (!isRecord(c)) continue
    // a check run says `conclusion` once it completed, a status context says `state`
    const verdict = typeof c.conclusion === 'string' && c.conclusion !== '' ? c.conclusion : typeof c.state === 'string' ? c.state : ''
    if (CHECK_PASSED.includes(verdict)) out.passed++
    else if (CHECK_FAILED.includes(verdict)) out.failed++
    else out.pending++
  }
  return out.passed + out.failed + out.pending > 0 ? out : undefined
}

/** `gh pr view --json number,title,state,isDraft,reviewDecision,statusCheckRollup,url` -> the pull request with its state (open, merged or closed); undefined for any other state or text. */
export function parseGithubPr(out: string): CockpitPr | undefined {
  try {
    const parsed: unknown = JSON.parse(out)
    if (!isRecord(parsed)) return undefined
    const { number, state, title, isDraft, reviewDecision, statusCheckRollup, url } = parsed
    const prState: CockpitPr['state'] | undefined = state === 'OPEN' ? 'open' : state === 'MERGED' ? 'merged' : state === 'CLOSED' ? 'closed' : undefined
    if (prState === undefined || typeof number !== 'number' || !Number.isInteger(number) || number <= 0) return undefined
    const review: CockpitPr['review'] =
      reviewDecision === 'APPROVED' ? 'approved' : reviewDecision === 'CHANGES_REQUESTED' ? 'changes' : reviewDecision === 'REVIEW_REQUIRED' ? 'pending' : undefined
    const link = safeUrl(url)
    return {
      number,
      title: typeof title === 'string' ? title : '',
      state: prState,
      isDraft: isDraft === true,
      ...(link !== undefined && { url: link }),
      review,
      checks: summarizeChecks(statusCheckRollup),
    }
  } catch {
    return undefined
  }
}

/** `value` when it is an http(s) address without control characters (what a pull request's link may point to); none otherwise. */
export function safeUrl(value: unknown): string | undefined {
  return typeof value === 'string' && /^https?:\/\/\S/i.test(value) && !/[\u0000-\u001f\u007f-\u009f]/.test(value) ? value : undefined
}

/** The `url` of an `az` pull request record: its repository's web address and the pull request's path; nothing when the record names no safe address. */
function azureUrl(pr: Record<string, unknown>, number: number): { url?: string } {
  const webUrl = isRecord(pr.repository) ? safeUrl(pr.repository.webUrl)?.replace(/\/+$/, '') : undefined
  return webUrl === undefined ? {} : { url: `${webUrl}/pullrequest/${number}` }
}

/**
 * `az repos pr list --output json` -> the first pull request: active is open, completed is merged, abandoned is closed (any other
 * status is none). The review comes from the reviewers' votes (10 and 5
 * approve, -5 and -10 ask for changes); the list carries no checks, so none are claimed. The link is the repository's web
 * address with the pull request's path, when the list names one.
 */
export function parseAzurePr(out: string): CockpitPr | undefined {
  try {
    const parsed: unknown = JSON.parse(out)
    const pr = Array.isArray(parsed) ? parsed[0] : undefined
    if (!isRecord(pr)) return undefined
    const { pullRequestId: number, title, isDraft, reviewers, status } = pr
    const state: CockpitPr['state'] | undefined = status === 'active' ? 'open' : status === 'completed' ? 'merged' : status === 'abandoned' ? 'closed' : undefined
    if (state === undefined) return undefined
    if (typeof number !== 'number' || !Number.isInteger(number) || number <= 0) return undefined
    const votes = Array.isArray(reviewers) ? reviewers.flatMap(r => (isRecord(r) && typeof r.vote === 'number' ? [r.vote] : [])) : []
    const review: CockpitPr['review'] = votes.length === 0 ? undefined : votes.some(v => v < 0) ? 'changes' : votes.some(v => v > 0) ? 'approved' : 'pending'
    return { number, title: typeof title === 'string' ? title : '', state, isDraft: isDraft === true, ...azureUrl(pr, number), review }
  } catch {
    return undefined
  }
}

// ── The Work tab: the changed files, the diff of one ──

/** `git diff --numstat --no-renames -z HEAD --` then the untracked paths -> the changed files; a binary file has `-` counts. */
export function parseNumstat(out: string, untracked: readonly string[]): CockpitChange[] {
  const tracked = out.split('\0').flatMap((entry): CockpitChange[] => {
    const m = /^(\d+|-)\t(\d+|-)\t([\s\S]+)$/.exec(entry)
    const [, added, deleted, path] = m ?? []
    if (added === undefined || deleted === undefined || path === undefined) return []
    return [added === '-' || deleted === '-' ? { path, isBinary: true } : { path, added: Number(added), deleted: Number(deleted) }]
  })
  return [...tracked, ...untracked.map((path): CockpitChange => ({ path, isUntracked: true }))]
}

/** What one drawing of `Code` takes (100000 characters in all), with room to spare. */
export const DIFF_MAX = 90_000

/** The control characters `Code` refuses (tab and newline are its only ones): carriage returns and the like go. */
const CONTROL = /[\0-\x08\x0b-\x1f\x7f]/g

/** A `git diff` without the lines before its `---` (the engine's parser starts at the file pair); empty when there is no hunk to draw (a binary file). */
export function diffHunks(raw: string): string {
  const text = raw.replace(CONTROL, '')
  if (text.startsWith('--- ')) return text
  const at = text.indexOf('\n--- ')
  return at < 0 ? '' : text.slice(at + 1)
}

/** `kept`, cut at a line inside its last hunk, with that hunk's `@@ -a,b +c,d @@` counts rewritten to the lines kept (a hunk that claims more lines than it has does not parse). */
function recountLastHunk(kept: string): string {
  const lines = kept.split('\n')
  let at = lines.length - 1
  while (at >= 0 && !lines[at]?.startsWith('@@ ')) at--
  const head = at < 0 ? undefined : /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(lines[at] ?? '')
  if (!head) return kept
  let before = 0
  let after = 0
  for (const l of lines.slice(at + 1)) {
    if (l.startsWith('-')) before++
    else if (l.startsWith('+')) after++
    else if (l.startsWith(' ')) {
      before++
      after++
    }
  }
  lines[at] = `@@ -${head[1]},${before} +${head[2]},${after} @@${head[3]}`
  return lines.join('\n')
}

/** What `cmd` reads as text: letters, digits, spaces and the punctuation of a URL, a ref or a name (`&`, `|`, `%`, `^`, quotes and the like are left out). */
const CMD_SAFE = /^[\p{L}\p{N} _./@+=,:#-]*$/u

/**
 * The argument vector that runs the Azure CLI with `args`. `$.process.run` starts a command with no shell, and on Windows
 * the CLI is `az.cmd`, which cannot be started by name: it goes through `cmd /d /s /c`. Then an argument `cmd` would read
 * as more than text (a branch named `a&b`) is never handed to it: undefined, and the call is not made.
 */
export function azArgv(args: readonly string[], isWindows: boolean): string[] | undefined {
  if (!isWindows) return ['az', ...args]
  return args.every(a => CMD_SAFE.test(a)) ? ['cmd', '/d', '/s', '/c', 'az', ...args] : undefined
}

/** `text` cut to `max` characters before a hunk when it has one before the limit, else at a line of its first hunk, whose header is recounted: a diff cut mid-hunk does not parse. */
export function capDiff(text: string, max: number = DIFF_MAX): { text: string; isCut: boolean } {
  if (text.length <= max) return { text, isCut: false }
  const hunk = text.lastIndexOf('\n@@', max)
  if (hunk > text.indexOf('@@')) return { text: text.slice(0, hunk + 1), isCut: true }
  const line = text.lastIndexOf('\n', max - 1)
  return { text: recountLastHunk(line < 0 ? text.slice(0, max) : text.slice(0, line + 1)), isCut: true }
}

/** An untracked file as a diff of added lines (empty for an empty file: git shows no hunk for it either). */
export function additionsDiff(file: string, raw: string): string {
  const lines = raw.replace(CONTROL, '').split('\n')
  if (lines.at(-1) === '') lines.pop()
  if (lines.length === 0) return ''
  return `--- /dev/null\n+++ b/${file}\n@@ -0,0 +1,${lines.length} @@\n${lines.map(l => `+${l}`).join('\n')}\n`
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

/** `ms` as the local `HH:MM`; empty for a time that is no date. */
export function hhmm(ms: number): string {
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}`
}

/** The cockpit's tabs, in the order the bar draws them. */
export const TABS: readonly CockpitTab[] = ['agents', 'context', 'work', 'system']

export const isTab = (v: unknown): v is CockpitTab => TABS.some(tab => tab === v)

/** The tab a state file names; the v2 Sessione and Repo tabs went to Subagents and Work, and so does a file that still holds them. */
export const savedTab = (v: unknown): CockpitTab | undefined => (v === 'session' ? 'agents' : v === 'repo' ? 'work' : isTab(v) ? v : undefined)

// ── Work: the main loop's last tools, the pull requests of the chat ──

/** The main loop's tool calls the Work tab lists. */
export const CALLS_KEEP = 8
const ARG_MAX = 120
// What a tool call shows of itself, first match: a command, a file (by its name), a pattern (a Grep or Glob shows what it looks for, before the folder it looks in), a folder, an address, a query, a description.
const ARG_KEYS = ['command', 'file_path', 'notebook_path', 'pattern', 'path', 'url', 'query', 'description', 'skill'] as const

/** The short argument of a tool call: one line of at most 120 characters, a file by its name; undefined when the call carries nothing to show. */
export function toolArg(input: { readonly [key: string]: unknown }): string | undefined {
  for (const key of ARG_KEYS) {
    const value = input[key]
    if (typeof value !== 'string') continue
    const one = (key.endsWith('path') ? baseName(value) : value).replace(/\s+/g, ' ').trim()
    if (one !== '') return [...one].slice(0, ARG_MAX).join('')
  }
  return undefined
}

/** `calls` with `call` last, cut to the last `CALLS_KEEP`. */
export const recordCall = (calls: readonly CockpitToolCall[] | undefined, call: CockpitToolCall): CockpitToolCall[] => [...(calls ?? []), call].slice(-CALLS_KEEP)

const GH_PR_CREATE = /\bgh\s+pr\s+create\b/
const AZ_PR_CREATE = /\baz\s+repos\s+pr\s+create\b/

/** The part of `command` from `from` to the next `;`, `|`, `&` or line break outside quotes: the command that starts there, without the rest of a compound one. */
function commandSegment(command: string, from: number): string {
  let quote = ''
  for (let i = from; i < command.length; i++) {
    const ch = command.charAt(i)
    if (quote !== '') {
      if (ch === quote) quote = ''
    } else if (ch === '"' || ch === "'") {
      quote = ch
    } else if (ch === ';' || ch === '|' || ch === '&' || ch === '\n') {
      return command.slice(from, i)
    }
  }
  return command.slice(from)
}

/** The words of `segment` as a shell splits them (quotes removed), each with whether it began inside quotes: such a word is an argument's text, never a flag. */
function shellWords(segment: string): { text: string; isQuoted: boolean }[] {
  const words: { text: string; isQuoted: boolean }[] = []
  let text = ''
  let isQuoted = false
  let isStarted = false
  let quote = ''
  for (const ch of segment) {
    if (quote !== '') {
      if (ch === quote) quote = ''
      else text += ch
    } else if (ch === '"' || ch === "'") {
      if (!isStarted) isQuoted = true
      isStarted = true
      quote = ch
    } else if (/\s/.test(ch)) {
      if (isStarted) words.push({ text, isQuoted })
      text = ''
      isQuoted = false
      isStarted = false
    } else {
      isStarted = true
      text += ch
    }
  }
  if (isStarted) words.push({ text, isQuoted })
  return words
}

/** The title and the draft flag of a `gh pr create` command segment: only unquoted words are flags, and a flag's own value is not read as one. */
function createFlags(segment: string): { title: string; isDraft: boolean } {
  const words = shellWords(segment)
  let title: string | undefined
  let isDraft = false
  for (let i = 0; i < words.length; i++) {
    const word = words[i]
    if (!word || word.isQuoted) continue
    const inline = /^(?:--title|-t)=([\s\S]*)$/.exec(word.text)
    if (inline) title ??= inline[1]
    else if (word.text === '--title' || word.text === '-t') {
      const value = words[i + 1]
      if (value) {
        title ??= value.text
        i++
      }
    } else if (word.text === '--draft' || word.text === '-d') isDraft = true
  }
  return { title: title ?? '', isDraft }
}

/**
 * The pull request that `command` created, from what it printed: `gh pr create` prints the pull request's URL (the title is
 * the one the command gave, none for `--fill`); `az repos pr create` prints the pull request as JSON. Undefined for any
 * other command, or output that names no pull request.
 */
export function parseCreatedPr(command: string, out: string): CockpitPr | undefined {
  const gh = GH_PR_CREATE.exec(command)
  if (gh) {
    const found = /https?:\/\/\S+\/pull\/(\d+)/.exec(out)
    const number = Number(found?.[1])
    if (!found || !Number.isInteger(number) || number <= 0) return undefined
    // The flags are the create command's own: an `-d` or `-t` of another command of the line is not.
    const { title, isDraft } = createFlags(commandSegment(command, gh.index))
    const url = safeUrl(found[0])
    return { number, title, state: 'open', isDraft, ...(url !== undefined && { url }) }
  }
  if (AZ_PR_CREATE.test(command)) {
    try {
      const pr: unknown = JSON.parse(out.slice(Math.max(0, out.indexOf('{'))))
      if (!isRecord(pr)) return undefined
      const { pullRequestId: number, title, isDraft } = pr
      if (typeof number !== 'number' || !Number.isInteger(number) || number <= 0) return undefined
      return { number, title: typeof title === 'string' ? title : '', state: 'open', isDraft: isDraft === true, ...azureUrl(pr, number) }
    } catch {
      return undefined
    }
  }
  return undefined
}

/** The pull requests of a chat that the list keeps (the state file persists them). */
export const PRS_KEEP = 10

/** `pr` joins `list`, or replaces the entry it is a newer reading of (the same url, or the same number when one side has no url); the list keeps the last ten. */
export function upsertPr(list: readonly CockpitPr[] | undefined, pr: CockpitPr): CockpitPr[] {
  const prs = list ?? []
  const isSame = (a: CockpitPr) => (a.url !== undefined && pr.url !== undefined ? a.url === pr.url : a.number === pr.number)
  const i = prs.findIndex(isSame)
  const next = i < 0 ? [...prs, pr] : prs.map((a, j) => (j === i ? { ...a, ...pr, url: pr.url ?? a.url } : a))
  return next.slice(-PRS_KEEP)
}

/** The pull requests out of a parsed state file: the entries with a number and a title (any other field a guess is made for), in order; none for anything else. */
export function parseSavedPrs(value: unknown): CockpitPr[] {
  if (!Array.isArray(value)) return []
  const out: CockpitPr[] = []
  for (const v of value.slice(-PRS_KEEP)) {
    if (!isRecord(v)) continue
    const { number, title, state, isDraft, url, review, checks } = v
    if (typeof number !== 'number' || !Number.isInteger(number) || number <= 0 || typeof title !== 'string') continue
    const count = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : 0)
    const link = safeUrl(url)
    out.push({
      number,
      title,
      state: state === 'merged' || state === 'closed' ? state : 'open',
      isDraft: isDraft === true,
      ...(link !== undefined && { url: link }),
      ...((review === 'approved' || review === 'changes' || review === 'pending') && { review }),
      ...(isRecord(checks) && { checks: { passed: count(checks.passed), failed: count(checks.failed), pending: count(checks.pending) } }),
    })
  }
  return out
}

/** The new tokens of the agents a history lists; undefined for an empty one. */
export const historyTokens = (history: readonly { tokens: number }[] | undefined): number | undefined =>
  history === undefined || history.length === 0 ? undefined : history.reduce((n, h) => n + h.tokens, 0)

// ── System: the monitor's lines, the rings the tab draws ──

/** Samples a ring keeps: a minute of the monitor's 2 s ticks. */
export const SYSTEM_KEEP = 30

/** Processes a line carries at most: the monitor lists every one of the session's tree, in this number. */
const PROCS_KEEP = 200

/** The parts of the tab, in the order it draws them. */
const SYSTEM_PARTS: readonly CockpitSystemPart[] = ['cpu', 'ram', 'net', 'procs', 'disk', 'power']

/** Bytes as `512B`, `1.5K`, `40K`, `1.2M`, `12G` (base 1024, one letter, a decimal only under ten). */
export function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0B'
  const units = ['B', 'K', 'M', 'G', 'T']
  let v = n
  let i = 0
  // The unit is chosen on the rounded value: 1023.6K is 1.0M, never 1024K.
  while (i < units.length - 1 && Math.round(v) >= 1024) {
    v /= 1024
    i++
  }
  if (i === 0) return `${Math.round(v)}B`
  // A tenth that rounds up to ten reads as a whole number: 10K, not 10.0K.
  const tenth = Math.round(v * 10) / 10
  return `${tenth < 10 ? tenth.toFixed(1) : Math.round(v)}${units[i]}`
}

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0

/** One JSON line of the system monitor, narrowed field by field: a field that is not the expected shape is dropped; text that is no JSON object is none. */
export function parseSysLine(text: string): CockpitSysLine | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return undefined
  }
  if (!isRecord(parsed)) return undefined
  const { cpu, ram, net, procs, disk, power, off } = parsed
  const out: CockpitSysLine = {}
  if (isCount(cpu)) out.cpu = Math.min(100, cpu)
  if (isRecord(ram) && isCount(ram.used) && isCount(ram.total)) out.ram = { used: ram.used, total: ram.total }
  if (isRecord(net) && isCount(net.rx) && isCount(net.tx)) out.net = { rx: net.rx, tx: net.tx }
  if (Array.isArray(procs)) {
    out.procs = procs.slice(0, PROCS_KEEP).flatMap((p): CockpitSysProc[] =>
      isRecord(p) && isCount(p.pid) && typeof p.name === 'string'
        ? [{ pid: p.pid, name: p.name, ports: Array.isArray(p.ports) ? p.ports.filter(isCount) : [], ...(isCount(p.cpu) && { cpu: p.cpu }), ...(isCount(p.ram) && { ram: p.ram }) }]
        : [],
    )
  }
  if (isRecord(disk) && isCount(disk.free) && isCount(disk.total)) out.disk = { free: disk.free, total: disk.total, ...(typeof disk.label === 'string' && { label: disk.label }) }
  if (isRecord(power) && power.kind === 'wired') out.power = { kind: 'wired' }
  else if (isRecord(power) && power.kind === 'battery' && isCount(power.percent) && typeof power.isCharging === 'boolean') {
    out.power = { kind: 'battery', percent: power.percent, isCharging: power.isCharging }
  }
  if (Array.isArray(off)) out.off = SYSTEM_PARTS.filter(part => off.includes(part))
  return out
}

/** The tab's readings with every part unavailable: the monitor could not start, or it ended. */
export const systemOff = (): CockpitSystem => ({ cpu: [], ram: [], rx: [], tx: [], off: [...SYSTEM_PARTS] })

/** `system` after one line of the monitor: samples join their rings, a slow reading replaces the last one, a part the line reports off is cleared and marked, a part it carries is no longer off. */
export function recordSystem(system: CockpitSystem | undefined, line: CockpitSysLine): CockpitSystem {
  const s: CockpitSystem = system ?? { cpu: [], ram: [], rx: [], tx: [], off: [] }
  const ring = (list: readonly number[], v: number) => [...list, v].slice(-SYSTEM_KEEP)
  const next: CockpitSystem = { ...s }
  if (line.cpu !== undefined) next.cpu = ring(s.cpu, line.cpu)
  if (line.ram) {
    next.ram = ring(s.ram, line.ram.total > 0 ? Math.round((100 * line.ram.used) / line.ram.total) : 0)
    next.ramUsed = line.ram.used
    next.ramTotal = line.ram.total
  }
  if (line.net) {
    next.rx = ring(s.rx, line.net.rx)
    next.tx = ring(s.tx, line.net.tx)
  }
  if (line.procs) next.procs = line.procs
  if (line.disk) next.disk = line.disk
  if (line.power) next.power = line.power
  const carried = new Set<CockpitSystemPart>([
    ...(line.cpu !== undefined ? ['cpu' as const] : []),
    ...(line.ram ? ['ram' as const] : []),
    ...(line.net ? ['net' as const] : []),
    ...(line.procs ? ['procs' as const] : []),
    ...(line.disk ? ['disk' as const] : []),
    ...(line.power ? ['power' as const] : []),
  ])
  const off = new Set([...s.off.filter(part => !carried.has(part)), ...(line.off ?? [])])
  if (off.has('cpu')) next.cpu = []
  if (off.has('ram')) Object.assign(next, { ram: [], ramUsed: undefined, ramTotal: undefined })
  if (off.has('net')) Object.assign(next, { rx: [], tx: [] })
  if (off.has('procs')) next.procs = undefined
  if (off.has('disk')) next.disk = undefined
  if (off.has('power')) next.power = undefined
  next.off = SYSTEM_PARTS.filter(part => off.has(part))
  return next
}

// ── Alerts (D4) and the session data file ──

/** The context fill from which the cockpit alerts, and the 5h credits left (percent) at or under which it does. */
const ALERT_CTX_PCT = 80
const ALERT_CREDITS_LEFT_PCT = 10

/** One cause the person is told about: `key` names the episode (it ends when the cause is no longer in the list), `text` is the toast. */
export type CockpitAlert = { key: string; text: string }

/** The causes of an alert in `s` now: context at 80 % or more, 5h credits at 10 % left or less, each failed subagent, each pull request with red checks. */
export function activeAlerts(s: CockpitSnapshot): CockpitAlert[] {
  const out: CockpitAlert[] = []
  const pct = s.ctx.percent
  if (pct !== undefined && pct >= ALERT_CTX_PCT) out.push({ key: 'context', text: `context at ${Math.round(pct)}%` })
  const five = s.rateLimits.find(r => r.kind === 'five_hour')
  if (five && 100 - five.percentUsed <= ALERT_CREDITS_LEFT_PCT) out.push({ key: 'credits', text: `credits 5h: ${Math.max(0, Math.round(100 - five.percentUsed))}% left` })
  for (const a of s.agents) if (a.isFailed === true) out.push({ key: `agent:${a.id}`, text: `subagent ${a.type} failed` })
  for (const pr of s.prs ?? []) if ((pr.checks?.failed ?? 0) > 0) out.push({ key: `pr:${pr.number}`, text: `PR #${pr.number}: checks failing` })
  return out
}

/** The quick note's longest text. */
export const NOTE_MAX = 2000

/** The numbers of a saved list (the context samples, the rounds): the last `keep` finite non-negative ones; none for anything that is not a list. */
export function parseCounts(value: unknown, keep: number): number[] | undefined {
  if (!Array.isArray(value)) return undefined
  const counts = value.filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0).slice(-keep)
  return counts.length > 0 ? counts : undefined
}

/** The quick note out of a parsed data file: text only, cut to `NOTE_MAX`; a blank one is none. */
export const parseNote = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.slice(0, NOTE_MAX) : undefined
