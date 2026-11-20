import type { CockpitLogEntry } from '../types'

export type DoneEvent = {
  at: number
  kind: 'agent' | 'signal' | 'commit' | 'test' | 'pr' | 'compact' | 'error' | 'launch'
  /** The workflow run an agent, commit, test or PR belongs to: it is listed under that run's node, not under a round. */
  runId?: string
}

/** One node of the tree: a main round with its events, the open round after the newest one, a run of rounds that held none, or a workflow run. */
export type DoneGroup<E extends DoneEvent> = {
  /** The key the group toggles under: `done:<at>`, `done:current` for the open round, `flow:<runId>` for a run. */
  key: string
  /** The round's number (the entry's `n`, else its 1-based place in the log); none for the open round, a merged run and a flow. */
  round?: number
  /** The round's log entry: what its header and summary read (prompt, files, waits, fails, context, model); none for the open round, a merged run and a flow. */
  entry?: CockpitLogEntry
  /** The context percent the round gained or lost on the one before; none without both readings or when a compaction came between. */
  ctxDelta?: number
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

export type LogModel = {
  /** Newest round first; an event of a round with no round entry still makes its group, with no `entry`. */
  rounds: { n: number; entry?: CockpitLogEntry; events: CockpitLogEntry[] }[]
  /** The entries that carry no round (pre-v3 log, or logged with none open), newest first. */
  unattributed: CockpitLogEntry[]
  /** The workflow runs, newest first, with the rounds and lane recorded on their entry and the entries that carry their `runId` (newest first). */
  flows: { runId: string; name?: string; startRound?: number; endRound?: number; lane?: number; isLive: boolean; events: CockpitLogEntry[] }[]
}

/** The log by the ids recorded on its entries (`round`, `n`, `endRound`, `lane`), never by `at`: a round entry's group holds the entries whose `round` is its `n`. */
export function logModel(log: readonly CockpitLogEntry[], openFlow?: CockpitLogEntry): LogModel {
  const newestFirst = (a: CockpitLogEntry, b: CockpitLogEntry) => b.at - a.at
  // the stable sorts keep the order of the log on equal `at`: reversed first, the entry inserted later comes first
  const ordered = [...log].reverse().sort(newestFirst)
  const roundEntries = log.filter(e => e.kind === 'round').sort((a, b) => a.at - b.at)
  const all: LogModel['rounds'] = []
  // the group an event of round n joins: the newest one of that n
  const byN = new Map<number, LogModel['rounds'][number]>()
  roundEntries.forEach((r, i) => {
    const n = r.n ?? i + 1
    const group: LogModel['rounds'][number] = { n, entry: r, events: [] }
    all.push(group)
    byN.set(n, group)
  })
  const flowEntries = [...log.filter(e => e.kind === 'flow' && e.key !== openFlow?.key), ...(openFlow ? [openFlow] : [])]
  const flows = [...flowEntries].reverse().sort(newestFirst).flatMap((f): LogModel['flows'] =>
    f.key === undefined
      ? []
      : [
          {
            runId: f.key,
            ...(f.text !== undefined && { name: f.text }),
            ...(f.round !== undefined && { startRound: f.round }),
            ...(f.endRound !== undefined && { endRound: f.endRound }),
            ...(f.lane !== undefined && { lane: f.lane }),
            isLive: f === openFlow,
            events: [],
          },
        ],
  )
  const unattributed: CockpitLogEntry[] = []
  for (const e of ordered) {
    if (e.kind === 'round' || e.kind === 'flow') continue
    // an entry of a workflow run belongs to its flow, not to a round
    const flow = e.runId === undefined ? undefined : flows.find(f => f.runId === e.runId)
    if (flow) {
      flow.events.push(e)
      continue
    }
    if (e.round === undefined || e.runId !== undefined) {
      unattributed.push(e)
      continue
    }
    const group = byN.get(e.round) ?? { n: e.round, events: [] }
    if (!byN.has(e.round)) {
      byN.set(e.round, group)
      all.push(group)
    }
    group.events.push(e)
  }
  return { rounds: [...all].reverse().sort((a, b) => b.n - a.n), unattributed, flows }
}

/**
 * The events by the main round that ended them: those with `at` in (previous round's end, this round's end]; those after the newest round
 * make the open round. Consecutive rounds with no event merge into one group. The agents of a workflow run are not the rounds': each run (a 'flow' entry
 * of `log`, or `openFlow` while it is not logged) is a node of its own, holding them. Newest group first.
 */
export function groupDone<E extends DoneEvent>(events: readonly E[], log: readonly CockpitLogEntry[], openFlow?: CockpitLogEntry): DoneGroup<E>[] {
  const rounds = log.filter(e => e.kind === 'round').sort((a, b) => a.at - b.at)
  const newestFirst = [...events].sort((a, b) => b.at - a.at)
  const ofRounds = newestFirst.filter(e => e.runId === undefined)
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
    const prev = rounds[i - 1]
    const isCompacted = prev !== undefined && log.some(c => c.kind === 'compact' && c.at > prev.at && c.at <= r.at)
    const ctxDelta = prev?.ctxPct !== undefined && r.ctxPct !== undefined && !isCompacted ? r.ctxPct - prev.ctxPct : undefined
    const group: DoneGroup<E> = {
      key: `done:${r.at}`,
      round: r.n ?? i + 1,
      entry: r,
      at: r.at,
      events: own,
      ...(ctxDelta !== undefined && { ctxDelta }),
      ...(r.ms !== undefined && { ms: r.ms }),
      ...(r.usd !== undefined && { usd: r.usd }),
      ...(r.tools !== undefined && { tools: r.tools }),
    }
    // a round that holds a prompt, files, waits, failures or tools is a node of its own; only a bare one merges
    const isBare = own.length === 0 && r.prompt === undefined && !(r.files?.length) && r.waits === undefined && r.fails === undefined && !Object.keys(r.tools ?? {}).length
    if (isBare) run.push(group)
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
            events: newestFirst.filter(e => e.runId === f.key),
            ...(f.ms !== undefined && { ms: f.ms }),
            ...(f.usd !== undefined && { usd: f.usd }),
            flow: { runId: f.key, ...(f.text !== undefined && { name: f.text }), isFailed: f.isFailed === true, isLive: f === openFlow },
          },
        ],
  )
  return [...(newest ? [{ key: 'done:current', at: newest.at, events: open, isCurrent: true }] : []), ...groups.reverse(), ...flows].sort((a, b) => b.at - a.at)
}
