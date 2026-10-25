import type { CockpitInsights, CockpitSnapshot, CockpitToolCall } from '../types'
import { subagentShare } from './agents'
import { ROUNDS_KEEP } from './context'
import { baseName } from './shared'
import { THRESHOLDS } from './signals'

// ── Insights and Work: the main loop's last tools, the pull requests of the chat ──

/** The main loop's tool calls kept, and the newest of them the Insights tab lists. */
export const CALLS_KEEP = 8
export const CALLS_SHOWN = 5
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

// ── Insights: what the main loop's events add up to ──

/** The hints' limits: a file read this many times, the cache under `COLD_CACHE_PCT` for `COLD_CACHE_ROUNDS` rounds, this many failed Bash calls, subagents over `SUBAGENT_SHARE_PCT` of the tokens, a round this long. */
const REREAD_MIN = 6
const COLD_CACHE_PCT = 50
const COLD_CACHE_ROUNDS = 3
const FAILED_COMMANDS_MIN = 7
const SUBAGENT_SHARE_PCT = 60
const LONG_ROUND_MS = 10 * 60_000
/** Tool names and file paths the counts keep: past them a new name is not counted. */
const INSIGHT_TOOLS_KEEP = 40
const INSIGHT_READS_KEEP = 200

/** The cost of the main round that just ended: the session's cost now over what it was when the round began; none when either was not measured. */
export const roundCost = (cost: CockpitSnapshot['cost']): number | undefined =>
  cost.usd !== undefined && cost.startUsd !== undefined && cost.usd >= cost.startUsd ? cost.usd - cost.startUsd : undefined

/** `ins` after a main round ended: its cost where measured, its length, the cache hit of its input, and the dearest round so far. */
export function recordRoundEnd(ins: CockpitInsights | undefined, round: { usd?: number; ms: number; cacheShare?: number; endedAt?: number }): CockpitInsights {
  const now = ins ?? emptyInsights()
  const usd = round.usd ?? 0
  const isCostliest = round.usd !== undefined && round.usd > (now.costliest?.usd ?? 0)
  // The gap between the last round's end and this one's start: a long one let the prompt cache lapse.
  const gapMs = round.endedAt !== undefined && now.lastRoundEnd !== undefined ? round.endedAt - Math.max(0, round.ms) - now.lastRoundEnd : 0
  const isIdle = gapMs > THRESHOLDS.idleGapMs && round.cacheShare !== undefined
  return {
    ...now,
    ...(round.endedAt !== undefined && { lastRoundEnd: round.endedAt }),
    ...(isIdle && round.cacheShare !== undefined && { idleCold: { round: now.rounds + 1, share: round.cacheShare, gapMs } }),
    rounds: now.rounds + 1,
    usd: now.usd + usd,
    ...(isCostliest && { costliest: { usd, ms: round.ms } }),
    roundMs: now.roundMs + Math.max(0, round.ms),
    cacheShares: round.cacheShare === undefined ? now.cacheShares : [...now.cacheShares, round.cacheShare].slice(-ROUNDS_KEEP),
  }
}

/** The largest results and the cut of an error message the insights keep. */
const BIGGEST_KEEP = 5
const COMPACT_CTX_KEEP = 3
const ERROR_MAX = 200
const FAILED_CMDS_KEEP = 40

/** The tokens a tool result weighs for the model, estimated from its text (characters / 4); a result with no text is measured on its JSON. */
export function resultTokens(ran: { text?: unknown; result?: unknown }): number {
  const text = typeof ran.text === 'string' ? ran.text : (JSON.stringify(ran.result) ?? '')
  return Math.ceil(text.length / 4)
}

/** `ins` after a main-loop tool call ended: counted by tool (and as a failure when it did not run clean, its message kept), its running time added, a successful `Read` counted by file, its result among the largest. */
export function recordToolCall(
  ins: CockpitInsights | undefined,
  call: { tool: string; isOk: boolean; ms: number; readPath?: string; arg?: string; tokens?: number; error?: string },
): CockpitInsights {
  const now = ins ?? emptyInsights()
  const known = now.tools[call.tool]
  const tools = known || Object.keys(now.tools).length < INSIGHT_TOOLS_KEEP ? { ...now.tools, [call.tool]: { calls: (known?.calls ?? 0) + 1, failed: (known?.failed ?? 0) + (call.isOk ? 0 : 1) } } : now.tools
  const path = call.isOk ? call.readPath : undefined
  const isReadKept = path !== undefined && (path in now.reads || Object.keys(now.reads).length < INSIGHT_READS_KEEP)
  const failedKey = !call.isOk && call.tool === 'Bash' ? call.arg : undefined
  const isCmdKept = failedKey !== undefined && (failedKey in (now.failedCmds ?? {}) || Object.keys(now.failedCmds ?? {}).length < FAILED_CMDS_KEEP)
  const error = call.error?.replace(/\s+/g, ' ').trim().slice(0, ERROR_MAX)
  return {
    ...now,
    tools,
    toolMs: now.toolMs + Math.max(0, call.ms),
    ...(isCmdKept && failedKey !== undefined && { failedCmds: { ...now.failedCmds, [failedKey]: (now.failedCmds?.[failedKey] ?? 0) + 1 } }),
    reads: isReadKept ? { ...now.reads, [path]: (now.reads[path] ?? 0) + 1 } : now.reads,
    ...(call.tokens !== undefined && call.tokens > 0 && {
      biggest: [...(now.biggest ?? []), { tool: call.tool, ...(call.arg !== undefined && { arg: call.arg }), tokens: call.tokens }].sort((a, b) => b.tokens - a.tokens).slice(0, BIGGEST_KEEP),
    }),
    ...(!call.isOk && error !== undefined && error !== '' && { lastError: { tool: call.tool, text: error } }),
  }
}

/** `ins` with `ms` more spent waiting on the person's answer to a permission request. */
export const recordWait = (ins: CockpitInsights | undefined, ms: number): CockpitInsights => {
  const now = ins ?? emptyInsights()
  return { ...now, waitMs: now.waitMs + Math.max(0, ms) }
}

/** `ins` with one more compaction, and the context reading it started from (none when there was no reading). */
export const recordCompaction = (ins: CockpitInsights | undefined, before?: number): CockpitInsights => {
  const now = ins ?? emptyInsights()
  return {
    ...now,
    compactions: now.compactions + 1,
    // what grew the context is measured from the compaction on
    biggest: undefined,
    ...(before !== undefined && before > 0 && { compactCtx: [...(now.compactCtx ?? []), { before }].slice(-COMPACT_CTX_KEEP) }),
  }
}

/** `ins` after a context reading: the last compaction still waiting for one takes it as its `after`, unless it is the very reading the compaction started from. */
export function recordCtxAfter(ins: CockpitInsights | undefined, tokens: number | undefined): CockpitInsights | undefined {
  const last = ins?.compactCtx?.at(-1)
  if (!ins?.compactCtx || !last || last.after !== undefined || !tokens || tokens === last.before) return ins
  return { ...ins, compactCtx: [...ins.compactCtx.slice(0, -1), { before: last.before, after: tokens }] }
}

/** A context drop that counts as a compaction: more than 40 % of the last reading and more than 50k tokens. */
const COMPACT_DROP_RATIO = 0.4
const COMPACT_DROP_TOKENS = 50_000

/**
 * The snapshot after a context measurement of the main loop. The harness skips `session.compact` for this mod, so a compaction is
 * read from the data that does arrive: a drop between consecutive readings, recorded once (a compaction the engine event already
 * recorded, still waiting for its `after`, is the same one).
 */
export function withContextReading(s: CockpitSnapshot, tokens: number | undefined): Pick<CockpitSnapshot, 'insights'> {
  const prev = s.ctx.tokens
  const pending = s.insights?.compactCtx?.at(-1)?.after === undefined && (s.insights?.compactCtx?.length ?? 0) > 0
  const isDrop = prev !== undefined && tokens !== undefined && !pending && prev - tokens > COMPACT_DROP_TOKENS && prev - tokens > prev * COMPACT_DROP_RATIO
  const base = isDrop ? recordCompaction(s.insights, prev) : s.insights
  return { insights: recordCtxAfter(base, tokens) }
}

export const emptyInsights =(): CockpitInsights => ({ rounds: 0, usd: 0, compactions: 0, roundMs: 0, toolMs: 0, waitMs: 0, tools: {}, reads: {}, cacheShares: [] })

/** The file a `Read` call opens, from its input; none for any other call. */
export const readPathOf = (input: { readonly [key: string]: unknown }): string | undefined =>
  input.tool === 'Read' && typeof input.file_path === 'string' && input.file_path !== '' ? input.file_path.replace(/\\/g, '/') : undefined

/** Where the rounds' time went: the tools' and the permission waits' share of it, the model taking the rest. Tools that ran side by side can add up to more than the rounds: the total then is theirs. Undefined before a round ended. */
export function timeSplit(ins: CockpitInsights): { model: number; tools: number; wait: number; total: number } | undefined {
  if (ins.roundMs <= 0) return undefined
  const total = Math.max(ins.roundMs, ins.toolMs + ins.waitMs)
  return { model: total - ins.toolMs - ins.waitMs, tools: ins.toolMs, wait: ins.waitMs, total }
}

/** One automatic hint of the Insights tab, with what it is about. */
export type CockpitHint =
  | { kind: 'rereads'; file: string; count: number }
  | { kind: 'coldCache' }
  | { kind: 'failures'; count: number }
  | { kind: 'subagents'; share: number }
  | { kind: 'longRound'; ms: number }

/** The hints that apply now: each shows only while its cause holds. */
export function insightHints(s: CockpitSnapshot): CockpitHint[] {
  const ins = s.insights
  const out: CockpitHint[] = []
  const [file, count] = Object.entries(ins?.reads ?? {}).sort((a, b) => b[1] - a[1])[0] ?? []
  if (file !== undefined && count !== undefined && count >= REREAD_MIN) out.push({ kind: 'rereads', file: baseName(file), count })
  const last = (ins?.cacheShares ?? []).slice(-COLD_CACHE_ROUNDS)
  if (last.length === COLD_CACHE_ROUNDS && last.every(share => share < COLD_CACHE_PCT)) out.push({ kind: 'coldCache' })
  const failed = ins?.tools.Bash?.failed ?? 0
  if (failed >= FAILED_COMMANDS_MIN) out.push({ kind: 'failures', count: failed })
  const share = subagentShare(s)
  if (share !== undefined && share > SUBAGENT_SHARE_PCT) out.push({ kind: 'subagents', share })
  if (s.lastRoundMs !== undefined && s.lastRoundMs > LONG_ROUND_MS) out.push({ kind: 'longRound', ms: s.lastRoundMs })
  return out
}
