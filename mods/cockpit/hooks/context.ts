import type { SessionContextBreakdown } from 'claude-code'

import type { CockpitContext, CockpitContextRow, CockpitSnapshot, CockpitStatic, CockpitTask } from '../types'
import { isCount, isRecord, truncEnd } from './shared'

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
  const growth = ctxGrowth(samples)
  const last = samples?.at(-1)
  return growth === undefined || last === undefined || threshold === undefined ? undefined : Math.max(0, Math.ceil((threshold - last) / growth))
}

/** The average growth of the context per main turn over `samples`; absent with fewer than two readings or a context that does not grow. */
export function ctxGrowth(samples: readonly number[] | undefined): number | undefined {
  if (samples === undefined || samples.length < 2) return undefined
  const growth = ((samples.at(-1) ?? 0) - (samples[0] ?? 0)) / (samples.length - 1)
  return growth > 0 ? growth : undefined
}

// ── The Context tab: the breakdown, when to compact ──

/** Main turns the compact hint keeps. */
export const ROUNDS_KEEP = 20
/** How long the Context tab's `refresh` waits after a press: an exact count spends token-count requests. */
export const REFRESH_COOLDOWN_MS = 60_000
/** The context fill from which the compact hint can show with the rounds' growth, and the growth each of the last rounds needs. */
export const COMPACT_HINT_PCT = 70
const COMPACT_GROWTH = 1.05
const COMPACT_ROUNDS = 3
/** The hint shows with this many requests (or fewer) left before auto-compaction, whatever the fill. */
const COMPACT_FORECAST_MAX = 3

/** `rounds` with this main turn's context size added, the last twenty kept. A shrinking context stays: a compaction is a drop to see. */
export const recordRound = (rounds: readonly number[] | undefined, tokens: number): number[] => [...(rounds ?? []), tokens].slice(-ROUNDS_KEEP)

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

/** What an exact reading fixes for the session: its static rows and skills listing. */
export const staticOf = (c: CockpitContext): CockpitStatic => ({
  rows: c.rows.filter(isStaticRow).map(r => ({ name: r.name, tokens: r.tokens })),
  ...(c.skills && { skills: c.skills }),
})

/**
 * A summary reading with the static part of an exact count laid over it: those rows (marked exact) and the skills
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
 * What the Context tab keeps of a breakdown: every row as the engine lists it, the window, and how many skills the listing holds.
 */
export function contextOf(
  b: Pick<SessionContextBreakdown, 'categories' | 'totalTokens' | 'rawMaxTokens' | 'skills'>,
  isExact: boolean,
): CockpitContext {
  return {
    rows: sortRows(b.categories.map((c): CockpitContextRow => ({ name: c.name, tokens: c.tokens, kind: c.kind, ...(isExact && { isExact: true as const }) }))),
    total: b.totalTokens,
    max: b.rawMaxTokens,
    ...(b.skills && { skills: { listed: b.skills.includedSkills, total: b.skills.totalSkills } }),
    isExact,
  }
}

/** The context a data file keeps (`tokens`, `window`, `percent`); none when any of the three is not a count. */
export function parseCtx(value: unknown): CockpitSnapshot['lastCtx'] {
  if (!isRecord(value)) return undefined
  const { tokens, window, percent } = value
  return isCount(tokens) && isCount(window) && isCount(percent) ? { tokens, window, percent } : undefined
}

// ── Buttons: what `compact` tells the summary to keep, and what `log hours` asks the worklog for ──

/** The open tasks the pane lists: in progress first, then pending, each in the order it arrived. */
export const openTasks = (s: Pick<CockpitSnapshot, 'tasks'>): CockpitTask[] => {
  const tasks = s.tasks ?? []
  return [...tasks.filter(t => t.status === 'in_progress'), ...tasks.filter(t => t.status === 'pending')]
}

const COMPACT_KEEP =
  "Keep: tasks in progress, decisions made with the user and why, open questions, files touched and their state, commands with the output line that settles them, next steps. Don't keep: tool output that's already summarised, superseded attempts."
const COMPACT_MAX = 400
const COMPACT_ITEM_MAX = 40
const COMPACT_LIST_MAX = 3
const COMPACT_PERIMETER_MAX = 2

/**
 * What the summary of `compact` should keep, in English and at most 400 characters: the fixed sentence, then what the
 * snapshot knows (the open task titles, the deliver perimeter: its size and first two entries, the name of the workflow
 * in flight), each part only when it fits.
 */
export function compactInstructions(s: Pick<CockpitSnapshot, 'tasks' | 'perimeter'> & { workflow?: string }): string {
  const cut = (items: readonly string[], max = COMPACT_LIST_MAX) => items.slice(0, max).map(i => truncEnd(i, COMPACT_ITEM_MAX))
  const perimeter = s.perimeter ?? []
  const parts = [
    { head: 'Open tasks: ', items: cut(openTasks(s).map(t => t.subject)), sep: '; ' },
    { head: `Deliver perimeter (${perimeter.length} ${perimeter.length === 1 ? 'entry' : 'entries'}): `, items: cut(perimeter, COMPACT_PERIMETER_MAX), sep: ', ' },
    { head: 'Running workflow: ', items: cut(s.workflow ? [s.workflow] : []), sep: '' },
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

/** The numbers of a saved list (the context samples, the rounds): the last `keep` finite non-negative ones; none for anything that is not a list. */
export function parseCounts(value: unknown, keep: number): number[] | undefined {
  if (!Array.isArray(value)) return undefined
  const counts = value.filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0).slice(-keep)
  return counts.length > 0 ? counts : undefined
}
