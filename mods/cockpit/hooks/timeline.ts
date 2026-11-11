import type { CockpitEvent, CockpitLogEntry } from '../types'

/** The events kept: the oldest go first. */
export const EVENTS_KEEP = 300

/** `list` with `event` last; one with a `key` already in the list is not added twice. The list keeps the newest `EVENTS_KEEP`. */
export function recordEvent(list: readonly CockpitEvent[] | undefined, event: CockpitEvent): CockpitEvent[] {
  const events = list ?? []
  if (event.key !== undefined && events.some(e => e.kind === event.kind && e.key === event.key)) return events.slice()
  // a row older than the newest (a block read from the log) takes its place by time
  return [...events, event].map((e, i) => ({ e, i })).sort((a, b) => a.e.at - b.e.at || a.i - b.i).map(x => x.e).slice(-EVENTS_KEEP)
}

/** `list` with the entry of agent `id` of `kind` agent replaced (a turn that ended twice is one row). */
export const recordAgentEvent = (list: readonly CockpitEvent[] | undefined, event: CockpitEvent): CockpitEvent[] =>
  recordEvent((list ?? []).filter(e => !(e.kind === 'agent' && e.id !== undefined && e.id === event.id)), event)

// ── The session log: what FATTO lists. A ring of its own, so its kinds never evict the agent events the costs read. ──

/** The session log's entries kept: the oldest go first. */
export const SESSION_LOG_KEEP = 300

/**
 * `log` with `entry` in its place by time; one whose kind and `key` are already there is not added twice, except a 'flow' entry, which replaces
 * its node (a resumed run closes again). The log keeps the newest `SESSION_LOG_KEEP`.
 */
export function recordLog(log: readonly CockpitLogEntry[] | undefined, entry: CockpitLogEntry): CockpitLogEntry[] {
  const all = log ?? []
  const isSame = (e: CockpitLogEntry) => entry.key !== undefined && e.kind === entry.kind && e.key === entry.key
  if (entry.kind !== 'flow' && all.some(isSame)) return all.slice()
  const entries = entry.kind === 'flow' ? all.filter(e => !isSame(e)) : all
  return [...entries, entry].map((e, i) => ({ e, i })).sort((a, b) => a.e.at - b.e.at || a.i - b.i).map(x => x.e).slice(-SESSION_LOG_KEEP)
}

/** `log` with the newest round entry that has no cost given `usd`: a round whose cost was measured after it ended. An entry that has one, or no round, leaves the log as it was. */
export function withRoundUsd(log: readonly CockpitLogEntry[] | undefined, usd: number): CockpitLogEntry[] | undefined {
  const newest = newestRound(log)
  if (newest === undefined || newest.usd !== undefined) return log?.slice()
  const own = Math.max(0, usd - roundFlowUsd(log, newest, Infinity))
  return log?.map(e => (e === newest ? { ...e, usd: own } : e))
}

/** `log` with the newest round entry given `usd`, replacing the one it has: the header's figure and the log's stay one. No round leaves the log as it was. */
export function withRoundLastUsd(log: readonly CockpitLogEntry[] | undefined, usd: number): CockpitLogEntry[] | undefined {
  const newest = newestRound(log)
  return newest === undefined ? log?.slice() : log?.map(e => (e === newest ? { ...e, usd } : e))
}

/** The cost of the flow agents (log agents with a `runId`) that ended between `from` and `to`: theirs belongs to the flow, not to the round. */
export const flowUsdIn = (log: readonly CockpitLogEntry[] | undefined, from: number, to: number): number =>
  (log ?? []).reduce((n, e) => (e.kind === 'agent' && e.runId !== undefined && e.at >= from && e.at <= to ? n + (e.usd ?? 0) : n), 0)

/** The flow cost from the start of the round entry `round` (it ended at `at`, after `ms`) up to `to` (its end by default). */
export const roundFlowUsd = (log: readonly CockpitLogEntry[] | undefined, round: CockpitLogEntry, to = round.at): number => flowUsdIn(log, round.at - (round.ms ?? 0), to)

/** The newest round entry of `log`; none without one. */
const newestRound = (log: readonly CockpitLogEntry[] | undefined): CockpitLogEntry | undefined =>
  (log ?? []).filter(e => e.kind === 'round').reduce<CockpitLogEntry | undefined>((n, e) => (n === undefined || e.at >= n.at ? e : n), undefined)

/** The flow cost since the start of the newest round entry of `log`, the flow agents that ended after it (the loop idle) included; 0 without one. */
export const lastRoundFlowUsd = (log: readonly CockpitLogEntry[] | undefined): number => {
  const newest = newestRound(log)
  return newest === undefined ? 0 : roundFlowUsd(log, newest, Infinity)
}

const LOG_KINDS: readonly string[] = ['round', 'commit', 'test', 'compact', 'pr', 'agent', 'signal', 'flow']
const SEVERITIES: readonly string[] = ['block', 'warn', 'info']
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** A record of positive counts by name out of a parsed file; none for anything else or an empty one. */
export function parseToolCounts(value: unknown): Record<string, number> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const counts = Object.entries(value).filter((e): e is [string, number] => isNum(e[1]) && e[1] > 0)
  return counts.length > 0 ? Object.fromEntries(counts) : undefined
}

/** The session log a data file keeps: the entries with a time and a known kind (the other fields only when they have their type), the newest `SESSION_LOG_KEEP`; none for anything else. */
export function parseLog(value: unknown): CockpitLogEntry[] | undefined {
  if (!Array.isArray(value)) return undefined
  const entries = value.flatMap((v: unknown): CockpitLogEntry[] => {
    if (typeof v !== 'object' || v === null) return []
    const { at, kind, key, text, usd, ms, tokens, after, isFailed, model, effort, n, severity, tools, runId } = v as Record<string, unknown>
    if (!isNum(at) || typeof kind !== 'string' || !LOG_KINDS.includes(kind)) return []
    const counts = parseToolCounts(tools)
    return [{
      at,
      kind: kind as CockpitLogEntry['kind'],
      ...(typeof key === 'string' && { key }),
      ...(typeof runId === 'string' && { runId }),
      ...(typeof text === 'string' && { text }),
      ...(isNum(usd) && { usd }),
      ...(isNum(ms) && { ms }),
      ...(isNum(tokens) && { tokens }),
      ...(isNum(after) && { after }),
      ...(typeof isFailed === 'boolean' && { isFailed }),
      ...(typeof model === 'string' && { model }),
      ...((typeof effort === 'string' || isNum(effort)) && { effort }),
      ...(isNum(n) && { n }),
      ...(typeof severity === 'string' && SEVERITIES.includes(severity) && { severity: severity as CockpitLogEntry['severity'] }),
      ...(counts && { tools: counts }),
    }]
  }).slice(-SESSION_LOG_KEEP)
  return entries.length > 0 ? entries : undefined
}

/** The key of the next compact entry: after the highest the log holds, so a resumed session (whose counters restart) never meets a saved key. */
export const nextCompactKey = (log: readonly CockpitLogEntry[] | undefined): string =>
  `c${1 + Math.max(0, ...(log ?? []).filter(e => e.kind === 'compact').map(e => Number(e.key?.slice(1)) || 0))}`

/** The key of the newest compact entry; none without one. */
export const lastCompactKey = (log: readonly CockpitLogEntry[] | undefined): string | undefined =>
  log?.filter(e => e.kind === 'compact').at(-1)?.key

/** `log` with the compact entry of `key` given its `after` reading, once: an entry that has one, or an unknown key, leaves the log as it was. */
export function withCompactAfter(log: readonly CockpitLogEntry[] | undefined, key: string, after: number): CockpitLogEntry[] | undefined {
  if (!log?.some(e => e.kind === 'compact' && e.key === key && e.after === undefined)) return log?.slice()
  return log.map(e => (e.kind === 'compact' && e.key === key ? { ...e, after } : e))
}

// The test runners the log recognises, at a command boundary (alone or in a chain).
const TEST_COMMAND = /(?:^|[\s;&|(])(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test|dotnet\s+test|pytest|vitest|jest|go\s+test|cargo\s+test|node\s+--test|claude\s+plugin\s+test)(?![\w-])/

/** Whether a Bash command runs tests. */
export const isTestCommand = (cmd: string): boolean => TEST_COMMAND.test(cmd)

const COMMIT_COMMAND = /(?:^|[;&|(]\s*)git\s+(?:-C\s+\S+\s+)?commit\b/

/** Whether a Bash command makes a git commit (alone or in a chain). */
export const isCommitCommand = (cmd: string): boolean => COMMIT_COMMAND.test(cmd)

/**
 * The log entries a Bash call makes: a test run (ok or failed), a `git commit` that exited 0 (by its short hash), a pull request that was created (by its number).
 * A chain makes one entry per part, in this order; a failed commit or PR create makes none.
 */
export function bashLog(call: { command: string; arg?: string; out: string; isOk: boolean; at: number; pr?: { number: number; title: string } }): CockpitLogEntry[] {
  const hash = call.isOk && isCommitCommand(call.command) ? commitHash(call.out) : undefined
  return [
    ...(isTestCommand(call.command) ? [{ at: call.at, kind: 'test' as const, ...(call.arg !== undefined && { text: call.arg }), isFailed: !call.isOk }] : []),
    ...(call.isOk && isCommitCommand(call.command) ? [{ at: call.at, kind: 'commit' as const, ...(hash !== undefined && { key: hash, text: hash }) }] : []),
    ...(call.isOk && call.pr ? [{ at: call.at, kind: 'pr' as const, key: String(call.pr.number), text: call.pr.title }] : []),
  ]
}

/** The short hash `git commit` prints (`[branch abc1234] subject`); none when the output has no such line. */
export const commitHash = (out: string): string | undefined => /\[[^\]\s]+(?: \(root-commit\))? ([0-9a-f]{7,40})\]/.exec(out)?.[1]
