import type { CockpitLogEntry } from '../types'

export type DoneEvent = {
  at: number
  kind: 'agent' | 'signal' | 'commit' | 'test' | 'pr' | 'compact' | 'launch'
  /** The workflow run an agent belongs to: it is listed under that run's node, not under a round. */
  runId?: string
}

/** One node of the tree: a main round with its events, the open round after the newest one, a run of rounds that held none, or a workflow run. */
export type DoneGroup<E extends DoneEvent> = {
  /** The key the group toggles under: `done:<at>`, `done:current` for the open round, `flow:<runId>` for a run. */
  key: string
  /** The round's 1-based number in the log; none for the open round, a merged run and a flow. */
  round?: number
  /** When the round ended (the merged run: its newest round); the open round: its newest event; a flow: its end. */
  at: number
  ms?: number
  usd?: number
  /** The main loop's tool calls of the round by tool name. */
  tools?: Record<string, number>
  /** The events of the group, newest first; a flow holds its agents. */
  events: E[]
  /** How many chat-only rounds a merged run holds (two or more). */
  chatOnly?: number
  isCurrent?: boolean
  /** Set on a workflow run's node; `isLive` while the run is open or silent (not logged yet). */
  flow?: { runId: string; name?: string; isFailed: boolean; isLive: boolean }
}

/**
 * The events by the main round that ended them: those with `at` in (previous round's end, this round's end]; those after the newest round
 * make the open round. Consecutive rounds with no event merge into one group. The agents of a workflow run are not the rounds': each run (a 'flow' entry
 * of `log`, or `openFlow` while it is not logged) is a node of its own, holding them. Newest group first.
 */
export function groupDone<E extends DoneEvent>(events: readonly E[], log: readonly CockpitLogEntry[], openFlow?: CockpitLogEntry): DoneGroup<E>[] {
  const rounds = log.filter(e => e.kind === 'round').sort((a, b) => a.at - b.at)
  const newestFirst = [...events].sort((a, b) => b.at - a.at)
  const ofRounds = newestFirst.filter(e => !(e.kind === 'agent' && e.runId !== undefined))
  const bucket = (from: number, to: number) => ofRounds.filter(e => e.at > from && e.at <= to)

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
    const group: DoneGroup<E> = { key: `done:${r.at}`, round: i + 1, at: r.at, events: own, ...(r.ms !== undefined && { ms: r.ms }), ...(r.usd !== undefined && { usd: r.usd }), ...(r.tools !== undefined && { tools: r.tools }) }
    if (own.length === 0) run.push(group)
    else {
      flush()
      groups.push(group)
    }
  })
  flush()

  const open = bucket(rounds[rounds.length - 1]?.at ?? -Infinity, Infinity)
  const [newest] = open
  const flows = [...log.filter(e => e.kind === 'flow'), ...(openFlow ? [openFlow] : [])].flatMap((f): DoneGroup<E>[] =>
    f.key === undefined
      ? []
      : [
          {
            key: `flow:${f.key}`,
            at: f.at,
            events: newestFirst.filter(e => e.kind === 'agent' && e.runId === f.key),
            ...(f.ms !== undefined && { ms: f.ms }),
            ...(f.usd !== undefined && { usd: f.usd }),
            flow: { runId: f.key, ...(f.text !== undefined && { name: f.text }), isFailed: f.isFailed === true, isLive: f === openFlow },
          },
        ],
  )
  return [...(newest ? [{ key: 'done:current', at: newest.at, events: open, isCurrent: true }] : []), ...groups.reverse(), ...flows].sort((a, b) => b.at - a.at)
}
