import type { CockpitAgent, CockpitClaudeState, CockpitHistoryEntry, CockpitSnapshot, CockpitUsage } from '../types'
import { COLORS, isRecord, truncEnd } from './shared'
import type { Span } from './shared'
import { t } from './strings'

/** How long a finished agent stays listed. */
export const AGENT_KEEP_MS = 120_000

const STATE_LOOK = {
  idle: { icon: '○', color: COLORS.dim },
  working: { icon: '◐', color: COLORS.blue },
  thinking: { icon: '◌', color: COLORS.lavender },
  tool: { icon: '▸', color: COLORS.green },
  waiting: { icon: '◆', color: COLORS.yellow },
} as const
const STATE_TOOL_MAX = 14

/** The header's Claude state: an icon and a word (the tool's own name while one runs, cut to fit); no state yet reads as idle. */
export function claudeStateSpans(state: CockpitClaudeState | undefined): Span[] {
  const kind = state?.kind ?? 'idle'
  const look = STATE_LOOK[kind]
  const text = state?.kind === 'tool' && state.tool ? truncEnd(state.tool, STATE_TOOL_MAX) : t().state[kind]
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

/** Entries the history keeps (the state file persists them); the pane lists them all. */
export const HISTORY_KEEP = 300

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

/** The new tokens of the agents a history lists; undefined for an empty one. */
export const historyTokens = (history: readonly { tokens: number }[] | undefined): number | undefined =>
  history === undefined || history.length === 0 ? undefined : history.reduce((n, h) => n + h.tokens, 0)

/** The subagents' share of the session's tokens, in percent; undefined before any tokens were used. */
export function subagentShare(s: Pick<CockpitSnapshot, 'mainTokens' | 'agents' | 'agentTokens'>): number | undefined {
  const total = sessionTokens(s)
  return total > 0 ? Math.round((100 * (total - (s.mainTokens ?? 0))) / total) : undefined
}
