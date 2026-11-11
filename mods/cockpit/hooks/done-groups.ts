import type { CockpitLogEntry } from '../types'

export type DoneEvent = { at: number; kind: 'agent' | 'commit' | 'test' | 'pr' | 'compact' }

/** One row of FATTO: a main round with its events, the open round after the newest one, or a run of rounds that held none. */
export type DoneGroup<E extends DoneEvent> = {
  /** The key the group toggles under: `done:<at>`, `done:current` for the open round. */
  key: string
  /** The round's 1-based number in the log; none for the open round and for a merged run. */
  round?: number
  /** When the round ended (the merged run: its newest round); the open round: its newest event. */
  at: number
  ms?: number
  usd?: number
  /** The events of the group, newest first. */
  events: E[]
  /** How many chat-only rounds a merged run holds (two or more). */
  chatOnly?: number
  isCurrent?: boolean
}

/**
 * The events by the main round that ended them: those with `at` in (previous round's end, this round's end]; those after the newest round
 * make the open round. Consecutive rounds with no event merge into one group. Newest group first.
 */
export function groupDone<E extends DoneEvent>(events: readonly E[], log: readonly CockpitLogEntry[]): DoneGroup<E>[] {
  const rounds = log.filter(e => e.kind === 'round').sort((a, b) => a.at - b.at)
  const newestFirst = [...events].sort((a, b) => b.at - a.at)
  const bucket = (from: number, to: number) => newestFirst.filter(e => e.at > from && e.at <= to)

  const groups: DoneGroup<E>[] = []
  let run: DoneGroup<E>[] = []
  const flush = () => {
    const [only] = run
    if (run.length === 1 && only) groups.push(only)
    else if (run.length > 1) {
      const costs = run.flatMap(g => (g.usd === undefined ? [] : [g.usd]))
      const at = run[run.length - 1]?.at ?? 0
      groups.push({ key: `done:${at}`, at, events: [], chatOnly: run.length, ...(costs.length > 0 && { usd: costs.reduce((n, u) => n + u, 0) }) })
    }
    run = []
  }
  rounds.forEach((r, i) => {
    const own = bucket(rounds[i - 1]?.at ?? -Infinity, r.at)
    const group: DoneGroup<E> = { key: `done:${r.at}`, round: i + 1, at: r.at, events: own, ...(r.ms !== undefined && { ms: r.ms }), ...(r.usd !== undefined && { usd: r.usd }) }
    if (own.length === 0) run.push(group)
    else {
      flush()
      groups.push(group)
    }
  })
  flush()

  const open = bucket(rounds[rounds.length - 1]?.at ?? -Infinity, Infinity)
  const [newest] = open
  return [...(newest ? [{ key: 'done:current', at: newest.at, events: open, isCurrent: true }] : []), ...groups.reverse()]
}
