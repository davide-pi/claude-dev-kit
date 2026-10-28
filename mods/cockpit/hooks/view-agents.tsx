import type { CockpitAgent, CockpitSnapshot, CockpitTask } from '../types'
import { AGENT_KEEP_MS, tokenShare } from './agents'
import type { AgentCost } from './signals'
import { COLORS, abbrevTokens, duration, fmtCost, modelFamily, padCells, shortModel, spanWidth, textCells, truncEnd, truncateSpans } from './shared'
import type { ModelFamily, Span } from './shared'
import { t } from './strings'
import { dim, padStart, sp } from './view-base'
import { effortSpans } from './view-header'

const TASK_TIME_W = 6

// An agent only seen through its events (no spawn yet, or an engine fork nothing lists) has type '?': not shown.
export const visibleAgents = (s: CockpitSnapshot): CockpitAgent[] =>
  s.agents.filter(a => a.type !== '?').filter(a => a.status === 'running' || (a.endedAt !== undefined && s.now - a.endedAt < AGENT_KEEP_MS))

/** `asked fable → sonnet (env)` when the model asked for is not the one the agent runs on. */
export function agentWarning(a: CockpitAgent, isForced: boolean): string | undefined {
  const asked = modelFamily(a.requested)
  const got = modelFamily(a.model)
  if (!asked || !got || asked === got) return undefined
  return t().askedModel(asked, got, isForced)
}

/** What the statusline's cockpit segment shows: agents running, and agents that run on another model than asked. */
export function agentCounts(s: CockpitSnapshot): { running: number; modelWarnings: number } {
  const agents = visibleAgents(s)
  return {
    running: agents.filter(a => a.status === 'running').length,
    modelWarnings: agents.filter(a => agentWarning(a, s.isSubagentModelForced) !== undefined).length,
  }
}

/** Tasks by state, and the `done/total` the statusline shows; null when there are none. */
export function taskCounts(s: CockpitSnapshot): { inProgress: number; pending: number; done: number; total: number } | null {
  const tasks = s.tasks ?? []
  if (tasks.length === 0) return null
  const n = (status: CockpitTask['status']) => tasks.filter(task => task.status === status).length
  return { inProgress: n('in_progress'), pending: n('pending'), done: n('completed'), total: tasks.length }
}

/** One task row: icon, subject cut with `…` to fit, and for a task in progress the time since it started. */
export function taskRow(task: CockpitTask, now: number, width: number): Span[] {
  const isActive = task.status === 'in_progress'
  const subjectW = Math.max(4, width - 2 - 1 - TASK_TIME_W)
  const subject = padCells(truncEnd(task.subject, subjectW), subjectW)
  const elapsed = isActive && task.startedAt !== undefined ? duration(now - task.startedAt) : ''
  return [
    isActive ? sp('󱎖', COLORS.blue) : dim('󰄰'),
    sp(' '),
    isActive ? sp(subject) : dim(subject),
    sp(' '),
    dim(padStart(elapsed, TASK_TIME_W)),
  ]
}

/** Parents first, each followed by its children; an orphan counts as a root. Every level is newest first (by start). */
export function orderAgents(list: readonly CockpitAgent[]): { agent: CockpitAgent; depth: number }[] {
  const ids = new Set(list.map(a => a.id))
  const newestFirst = [...list].sort((a, b) => b.startedAt - a.startedAt)
  const out: { agent: CockpitAgent; depth: number }[] = []
  const walk = (parent: string | undefined, depth: number) => {
    for (const a of newestFirst) {
      const isRoot = parent === undefined && (a.parentId === undefined || !ids.has(a.parentId))
      if (isRoot || (parent !== undefined && a.parentId === parent)) {
        out.push({ agent: a, depth })
        walk(a.id, depth + 1)
      }
    }
  }
  walk(undefined, 0)
  return out
}

/** An agent's state mark: running, interrupted, failed or done. */
export const agentIcon = (a: CockpitAgent): Span =>
  a.status === 'running' ? sp('󱎖', COLORS.blue) : a.isInterrupted ? sp('󰓛', COLORS.dim) : a.isFailed ? sp('󰅖', COLORS.red) : sp('󰄬', COLORS.green)

const MODEL_W = 9
/** A name is worth this many cells before a row gives up other columns (the model, on the Subagents tab; the cache hit then the model, in TOP AGENTS). */
const MIN_NAME_W = 6
const SHARE_W = 4
const TIME_W = 6
// icon, gap, name, then gap + model, gap + effort, gap + share of the session's tokens, gap + time
const ROW_FIXED_W = 2 + 1 + MODEL_W + 1 + 1 + 1 + SHARE_W + 1 + TIME_W

/** The model with its version (`son 5.5`, `opus 5.5`); a name this build does not know is cut to the column. */
const rowModel = (model: string | undefined): string => (model ? truncEnd(shortModel(model), MODEL_W) : '—')

/** An agent, live or from the history, in exactly one row of `width` cells: state, name (cut with `…` to fit), model, effort icon, their share of the session's `total` (blank when unknown), time. */
export function agentRow(a: CockpitAgent, depth: number, now: number, width: number, total: number): Span[] {
  // a pane too narrow for the name drops the model column: the share and the time matter more
  const hasModel = width - ROW_FIXED_W >= MIN_NAME_W
  const nameW = Math.max(1, width - (hasModel ? ROW_FIXED_W : ROW_FIXED_W - MODEL_W - 1))
  const prefix = depth > 0 ? `${'  '.repeat(depth - 1)}└ ` : ''
  const isRunning = a.status === 'running'
  const name = padCells(truncEnd(prefix + a.type, nameW), nameW)
  const effort = effortSpans(a.effort)
  return truncateSpans(
    [
      agentIcon(a),
      sp(' '),
      depth > 0 ? sp(name, COLORS.dim) : sp(name, undefined, isRunning),
      sp(' '),
      ...(hasModel ? [sp(padCells(rowModel(a.model), MODEL_W), undefined, isRunning), sp(' ')] : []),
      ...(effort.length ? effort : [sp(' ')]),
      sp(' '),
      sp(padStart(tokenShare(a.tokens, total) ?? '', SHARE_W)),
      sp(' '),
      sp(padStart(duration((a.endedAt ?? now) - a.startedAt), TIME_W)),
    ],
    width,
  )
}

const COST_W = 7

/** An agent of the TOP AGENTS list in exactly one row of `width` cells: name (cut with `…` to fit), model, effort icon, then its cost and cache hit; a pane too narrow to leave the name its minimum drops the cache hit, then the model. */
export function agentCostRow(a: AgentCost, width: number): Span[] {
  const effort = effortSpans(a.effort)
  const cost = sp(` ${fmtCost(a.usd).padStart(COST_W)}`, COLORS.yellow)
  // the cache-hit cell has one width, blank when unknown, so the cost sits at the same offset in every row
  const hitW = textCells(t().costCacheHit) + 1 + 4
  const hit = (gap: string) => dim(padCells(a.hit === undefined ? '' : `${gap}${t().costCacheHit} ${a.hit}%`, gap.length + hitW))
  const model = [sp(' '), sp(padCells(rowModel(a.model), MODEL_W), undefined, a.isRunning)]
  const icon = [sp(' '), ...(effort.length ? effort : [sp(' ')])]
  const tails = [[...model, ...icon, cost, hit('  ')], [...model, ...icon, cost, hit(' ')], [...model, ...icon, cost], [...icon, cost]]
  const tail = tails.find(x => width - spanWidth(x) >= MIN_NAME_W) ?? tails[tails.length - 1] ?? []
  const nameW = Math.max(1, width - spanWidth(tail))
  return truncateSpans([sp(padCells(truncEnd(a.type, nameW), nameW), undefined, a.isRunning), ...tail], width)
}

/** The rows under an expanded TOP AGENTS entry: what it was asked, its tokens, its time, how it ended and its share of the session cost; each left out when unknown. */
export function agentCostDetails(a: AgentCost, now: number, sessionUsd: number | undefined, indent: string, width: number): Span[][] {
  const D = t().costDetail
  const ms = a.ms ?? (a.startedAt === undefined ? undefined : now - a.startedAt)
  const outcome = a.isRunning ? 'running' : a.isFailed === undefined ? undefined : a.isFailed ? 'failed' : 'done'
  const share = sessionUsd === undefined ? undefined : tokenShare(a.usd, sessionUsd)
  const row = (text: string | undefined, color?: string): Span[] | undefined => (text === undefined ? undefined : truncateSpans([sp(indent), color ? sp(text, color) : dim(text)], width))
  return [
    row(a.description?.replace(/\s+/g, ' ')),
    row(D.tokens(abbrevTokens(a.tokens))),
    row(ms === undefined ? undefined : D.time(duration(ms))),
    row(outcome && D.outcome[outcome], outcome === 'failed' ? COLORS.red : undefined),
    row(share === undefined ? undefined : D.share(share)),
  ].filter((r): r is Span[] => r !== undefined)
}

/** `left` and `right` on one row of `width` cells: a gap between them, the left cut to leave the right whole; a row too short for both is cut. */
export function pairRow(left: readonly Span[], right: readonly Span[], width: number): Span[] {
  const rightW = spanWidth(right)
  if (width - rightW - 1 < 1) return truncateSpans([...left, sp(' '), ...right], width)
  const l = truncateSpans(left, width - rightW - 1)
  return [...l, sp(' '.repeat(width - spanWidth(l) - rightW)), ...right]
}

/** `left` and `right` as `pairRow` lays them when both fit `width`; the left alone, cut, when they do not. */
export const fitPair = (left: readonly Span[], right: readonly Span[], width: number): Span[] =>
  spanWidth(left) + 1 + spanWidth(right) <= width ? pairRow(left, right, width) : truncateSpans(left, width)

/**
 * The rows under an agent's row on the Subagents tab once it is expanded: the total tokens, what it was asked, the four counters, then the tool running
 * now (or, when none is, the last one). Each is left out until the engine gave it: nothing is faked.
 */
export function subagentDetails(a: CockpitAgent, indent: string, width: number): Span[][] {
  const running = a.status === 'running' ? a.activeTools?.at(-1) : undefined
  const counters =
    a.usage
      ? truncateSpans(
          [
            sp(indent),
            dim(t().tokenLabels.input),
            sp(abbrevTokens(a.usage.input)),
            dim(t().tokenLabels.output),
            sp(abbrevTokens(a.usage.output)),
            dim(t().tokenLabels.cacheRead),
            sp(abbrevTokens(a.usage.cacheRead)),
            dim(t().tokenLabels.cacheWrite),
            sp(abbrevTokens(a.usage.cacheWrite)),
          ],
          width,
        )
      : undefined
  const toolSpans = running ? [sp(indent), sp('󰍟 ', COLORS.blue), sp(running)] : a.lastTool ? [sp(indent), dim(t().lastTool), sp(a.lastTool)] : undefined
  const tool = toolSpans && truncateSpans(toolSpans, width)
  const task = a.description ? truncateSpans([sp(indent), dim(a.description.replace(/\s+/g, ' '))], width) : undefined
  const total = dim(`${indent}${t().costDetail.tokens(abbrevTokens(a.tokens))}`)
  return [truncateSpans([total], width), task, counters, tool].filter((r): r is Span[] => r !== undefined)
}

/** Cheapest first (pricing.ts). */
const COUNT_ORDER: { family: ModelFamily; label: string; color: string }[] = [
  { family: 'haiku', label: 'haiku', color: COLORS.green },
  { family: 'sonnet', label: 'son', color: COLORS.blue },
  { family: 'opus', label: 'opus', color: COLORS.amber },
  { family: 'fable', label: 'fable', color: COLORS.lavender },
]

export function modelCounts(list: readonly CockpitAgent[]): Span[] {
  const out: Span[] = []
  for (const { family, label, color } of COUNT_ORDER) {
    const n = list.filter(a => modelFamily(a.model) === family).length
    if (out.length) out.push(sp(' '))
    out.push(n > 0 ? sp(`${label} ×${n}`, color) : dim(`${label} ×0`))
  }
  return out
}
