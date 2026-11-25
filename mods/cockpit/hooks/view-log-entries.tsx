import type { CockpitAgent, CockpitLogEntry } from '../types'
import type { DoneEvent, DoneGroup } from './done-groups'
import { COLORS, abbrevTokens } from './shared'
import type { Span } from './shared'
import { loggedSignal, signalSeverity } from './signals'
import { t } from './strings'
import { agentIcon } from './view-agents'
import { sp } from './view-base'
import { SEVERITY_COLORS, signalIcon, signalText } from './view-kit'

export type G = DoneGroup<DoneEntry>

/** A row of the tree: the icon and text of its kind; an agent also carries its model, cost, length and start. */
export type DoneEntry = DoneEvent & {
  icon: Span
  text: string
  /** An agent's id: the commit, test or PR it made names it in `agent`. */
  key?: string
  /** The flow agent that made a commit, test or PR: the row sits under it. */
  agent?: string
  /** An agent's spawn label, which names its loop round under a flow. */
  desc?: string
  effort?: string | number
  /** An agent that still runs: its icon spins. */
  isRunning?: boolean
  /** The running agent itself: its row opens on its detail and trail. */
  live?: CockpitAgent
  /** The text's color, when it is not the default. */
  color?: string
  /** The time the row shows, when it is not `at`. */
  start?: number
  usd?: number
  ms?: number
  model?: string
}

/** The row of an agent entry. */
function agentEntry(e: CockpitLogEntry): DoneEntry {
  const icon = agentIcon({ id: e.key ?? '', type: '', startedAt: 0, tokens: 0, status: 'done', isFailed: e.isFailed === true })
  return {
    at: e.at,
    kind: 'agent',
    icon,
    ...(e.key !== undefined && { key: e.key }),
    text: e.text ?? '?',
    ...(e.desc !== undefined && { desc: e.desc }),
    ...(e.runId !== undefined && { runId: e.runId }),
    ...(e.model !== undefined && { model: e.model }),
    ...(e.effort !== undefined && { effort: e.effort }),
    ...(e.ms !== undefined && { ms: e.ms, start: e.at - e.ms }),
    ...(e.usd !== undefined && { usd: e.usd }),
  }
}

/** The row of an agent that still runs, listed under its flow: its icon and the time it has run. */
export function liveAgentEntry(a: CockpitAgent, runId: string, now: number): DoneEntry {
  return {
    at: now,
    kind: 'agent',
    icon: agentIcon(a),
    isRunning: true,
    live: a,
    key: a.id,
    text: a.type,
    runId,
    ...(a.description !== undefined && a.description !== '' && { desc: a.description }),
    ...(a.model !== undefined && { model: a.model }),
    ...(a.effort !== undefined && { effort: a.effort }),
    start: a.startedAt,
    ms: Math.max(0, now - a.startedAt),
  }
}

/** The row of a log entry; none for a round and a flow, which are nodes of their own, and for a signal of a kind unknown. */
export function logEntry(e: CockpitLogEntry): DoneEntry | undefined {
  const E = t().page.events
  switch (e.kind) {
    case 'round':
    case 'flow':
      return undefined
    case 'agent':
      return agentEntry(e)
    case 'signal': {
      const sig = loggedSignal(e)
      if (sig === undefined) return undefined
      return { at: e.at, kind: 'signal', icon: sp(signalIcon(sig), SEVERITY_COLORS[e.severity ?? signalSeverity(sig)]), text: signalText(sig).what }
    }
    case 'commit':
      return { at: e.at, kind: 'commit', icon: sp('󰜘', COLORS.green), text: E.commit(e.key ?? e.text ?? '', e.text ?? ''), ...(e.runId !== undefined && { runId: e.runId }), ...(e.agent !== undefined && { agent: e.agent }) }
    case 'test':
      return { at: e.at, kind: 'test', icon: e.isFailed ? sp('󰤒', COLORS.red) : sp('󰙨', COLORS.green), text: E.test(e.text ?? '', e.isFailed === true), ...(e.runId !== undefined && { runId: e.runId }), ...(e.agent !== undefined && { agent: e.agent }) }
    case 'compact':
      return { at: e.at, kind: 'compact', icon: sp('◇', COLORS.blue), text: E.compact(e.tokens === undefined ? '' : abbrevTokens(e.tokens), e.after === undefined ? '' : abbrevTokens(e.after)) }
    case 'error':
      return { at: e.at, kind: 'error', icon: sp('󰀦', COLORS.red), text: E.error(e.key ?? '?', e.n ?? 1), color: COLORS.red }
    case 'pr':
      return { at: e.at, kind: 'pr', icon: sp('󰓂', COLORS.lavender), text: E.pr(e.key ?? '', e.text ?? ''), ...(e.runId !== undefined && { runId: e.runId }), ...(e.agent !== undefined && { agent: e.agent }) }
  }
}
