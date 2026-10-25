import type { CockpitAgent, CockpitSnapshot, CockpitTask } from '../types'
import { AGENT_KEEP_MS, tokenShare } from './agents'
import { COLORS, abbrevTokens, duration, modelFamily, padCells, shortModel, spanWidth, truncEnd, truncateSpans } from './shared'
import type { ModelFamily, Span } from './shared'
import { t } from './strings'
import { dim, padStart, sp } from './view-base'
import { effortSpans, headerEffort } from './view-header'

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
    isActive ? sp('◐', COLORS.blue) : dim('○'),
    sp(' '),
    isActive ? sp(subject) : dim(subject),
    sp(' '),
    dim(padStart(elapsed, TASK_TIME_W)),
  ]
}

/** Parents first, each followed by its children; an orphan counts as a root. */
export function orderAgents(list: readonly CockpitAgent[]): { agent: CockpitAgent; depth: number }[] {
  const ids = new Set(list.map(a => a.id))
  const out: { agent: CockpitAgent; depth: number }[] = []
  const walk = (parent: string | undefined, depth: number) => {
    for (const a of list) {
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
  a.status === 'running' ? sp('◐', COLORS.blue) : a.isInterrupted ? sp('■', COLORS.dim) : a.isFailed ? sp('✗', COLORS.red) : sp('✓', COLORS.green)

export function agentRow(a: CockpitAgent, depth: number, now: number, width: number): Span[] {
  const nameW = Math.max(6, width - 27)
  const prefix = depth > 0 ? `${'  '.repeat(depth - 1)}└ ` : ''
  const isRunning = a.status === 'running'
  const end = a.endedAt ?? now
  return [
    agentIcon(a),
    sp(' '),
    depth > 0 ? sp(padCells(truncEnd(prefix + a.type, nameW), nameW), COLORS.dim) : sp(padCells(truncEnd(a.type, nameW), nameW)),
    sp(' '),
    sp(padCells(truncEnd(shortModel(a.model), 9), 9), undefined, isRunning),
    sp(' '),
    ...(effortSpans(a.effort).length ? effortSpans(a.effort) : [sp(' ')]),
    sp(' '),
    sp(padStart(duration(end - a.startedAt), 6)),
    sp(' '),
    sp(padStart(isRunning ? '' : abbrevTokens(a.tokens), 5)),
  ]
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

/** The Subagents tab's second row of an agent, `width` cells: model and effort on the left; its share of the session's tokens and its elapsed time on the right. */
export function subagentFacts(a: CockpitAgent, now: number, total: number, indent: string, width: number): Span[] {
  const share = tokenShare(a.tokens, total)
  return pairRow(
    [sp(indent), a.model ? sp(shortModel(a.model), undefined, a.status === 'running') : dim('—'), ...headerEffort(a.effort)],
    [...(share ? [sp(share, undefined, true), dim(t().tokenShare)] : []), sp(duration((a.endedAt ?? now) - a.startedAt))],
    width,
  )
}

/**
 * The rows under an agent's facts on the Subagents tab: the four counters when the agent's are open (`isUsageOpen`), then the tool running
 * now (or, when none is, the last one). Each is left out until the engine gave it: nothing is faked.
 */
export function subagentDetails(a: CockpitAgent, indent: string, width: number, isUsageOpen = false): Span[][] {
  const running = a.status === 'running' ? a.activeTools?.at(-1) : undefined
  const counters =
    a.usage && isUsageOpen
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
  const toolSpans = running ? [sp(indent), sp('▸ ', COLORS.blue), sp(running)] : a.lastTool ? [sp(indent), dim(t().lastTool), sp(a.lastTool)] : undefined
  const tool = toolSpans && truncateSpans(toolSpans, width)
  return [counters, tool].filter((r): r is Span[] => r !== undefined)
}

const COUNT_ORDER: { family: ModelFamily; label: string; color: string }[] = [
  { family: 'sonnet', label: 'son', color: COLORS.blue },
  { family: 'opus', label: 'opus', color: COLORS.amber },
  { family: 'fable', label: 'fable', color: COLORS.lavender },
  { family: 'haiku', label: 'haiku', color: COLORS.green },
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
