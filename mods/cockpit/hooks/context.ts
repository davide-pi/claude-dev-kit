import type { CockpitSnapshot, CockpitTask } from '../types'
import { COLORS, ctxColor, isCount, isRecord, truncEnd } from './shared'

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

// ── Rounds and the CTX bar's scale ──

/** Main turns the context rounds keep. */
export const ROUNDS_KEEP = 20

/** `rounds` with this main turn's context size added, the last twenty kept. A shrinking context stays: a compaction is a drop to see. */
export const recordRound = (rounds: readonly number[] | undefined, tokens: number): number[] => [...(rounds ?? []), tokens].slice(-ROUNDS_KEEP)

/** The CTX bar is full at this multiple of the autocompact threshold, so the threshold's tick sits at 1/1.1 of the bar. */
const CTX_SCALE = 1.1

/** The share of the autocompact threshold from which the CTX fill turns orange, then red. */
const CTX_ORANGE_PCT = 60
const CTX_RED_PCT = 90

/**
 * The CTX bar's fill and the tick of the autocompact threshold. Where the engine reports `autoCompactAt` the bar is `1.1 × autoCompactAt` tokens long
 * (`pct` is the context over that, capped at 100, `markPct` the threshold's place, `limit` the bar's length in tokens); without one it is the window's own percent, no tick.
 * `color` is the fill's: by the share of the threshold reached (under 60% green, under 90% orange, else red), or by the window's own percent without one.
 */
export function ctxScale(s: Pick<CockpitSnapshot, 'ctx' | 'lastCtx' | 'autoCompactAt'>): { pct: number; color: string; markPct?: number; limit?: number } {
  // Until the engine measures the window (a resumed session) the last state's reading stands in.
  const { tokens, percent } = s.ctx.percent === undefined && s.lastCtx ? s.lastCtx : s.ctx
  if (s.autoCompactAt === undefined || s.autoCompactAt <= 0) return { pct: percent ?? 0, color: ctxColor(percent ?? 0) }
  const limit = CTX_SCALE * s.autoCompactAt
  const share = ((tokens ?? 0) / s.autoCompactAt) * 100
  const color = share < CTX_ORANGE_PCT ? COLORS.green : share < CTX_RED_PCT ? COLORS.orange : COLORS.red
  return { pct: Math.min(100, ((tokens ?? 0) / limit) * 100), color, markPct: 100 / CTX_SCALE, limit }
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
