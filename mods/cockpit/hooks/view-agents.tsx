import type { CockpitAgent, CockpitSnapshot, CockpitTask } from '../types'
import { AGENT_KEEP_MS, tokenShare } from './agents'
import { COLORS, abbrevTokens, duration, fmtCost, modelFamily, padCells, shortModel, spanWidth, truncEnd, truncateSpans, wrapCells } from './shared'
import type { ModelFamily, Span } from './shared'
import { t } from './strings'
import { dim, padStart, sp } from './view-base'
import { effortSpans } from './view-header'

const TASK_TIME_W = 6
const taskSubjectW = (width: number): number => Math.max(4, width - 2 - 1 - TASK_TIME_W)

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
export function taskRow(task: CockpitTask, now: number, width: number, isFull = false): Span[] {
  const isActive = task.status === 'in_progress'
  const subjectW = taskSubjectW(width)
  const subject = padCells(isFull ? (wrapCells(task.subject, subjectW)[0] ?? '') : truncEnd(task.subject, subjectW), subjectW)
  const elapsed = isActive && task.startedAt !== undefined ? duration(now - task.startedAt) : ''
  return [
    isActive ? sp('󱎖', COLORS.blue) : dim('󰄰'),
    sp(' '),
    isActive ? sp(subject) : dim(subject),
    sp(' '),
    dim(padStart(elapsed, TASK_TIME_W)),
  ]
}

/** The rows of a task's subject after the first, for a row drawn in full (`taskRow` with `isFull`). */
export const taskRest = (task: CockpitTask, width: number): Span[][] =>
  wrapCells(task.subject, taskSubjectW(width)).slice(1).map(l => [sp('  '), task.status === 'in_progress' ? sp(l) : dim(l)])

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
/** A name is worth this many cells before a row gives up the model column. */
const MIN_NAME_W = 6
const SHARE_W = 4
const TIME_W = 6
/** The widest cost `fmtCost` writes in a row. */
const COST_W = 7
// icon, gap, name, then gap + model, gap + effort, gap + share of the session's tokens, gap + cost, gap + time
const ROW_FIXED_W = 2 + 1 + MODEL_W + 1 + 1 + 1 + SHARE_W + 1 + COST_W + 1 + TIME_W

/** The model with its version (`son 5.5`, `opus 5.5`); a name this build does not know is cut to the column. */
const rowModel = (model: string | undefined): string => (model ? truncEnd(shortModel(model), MODEL_W) : '—')

/** An agent, live or from the history, in exactly one row of `width` cells: state, name (cut with `…` to fit), model, effort icon, their share of the session's `total` (blank when unknown), its cost `usd` (blank when unknown), time. */
export function agentRow(a: CockpitAgent, depth: number, now: number, width: number, total: number, usd?: number): Span[] {
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
      dim(padStart(usd === undefined ? '' : fmtCost(usd), COST_W)),
      sp(' '),
      sp(padStart(duration((a.endedAt ?? now) - a.startedAt), TIME_W)),
    ],
    width,
  )
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
  const tool = running ? wrapped(indent, [sp('󰍟 ', COLORS.blue)], running, sp, width) : a.lastTool ? wrapped(indent, [dim(t().lastTool)], a.lastTool, sp, width) : []
  const task = a.description ? wrapped(indent, [], a.description.replace(/\s+/g, ' '), dim, width) : []
  const total = dim(`${indent}${t().costDetail.tokens(abbrevTokens(a.tokens))}`)
  return [truncateSpans([total], width), ...task, ...(counters ? [counters] : []), ...tool]
}

/** `text` in full under `indent` after `label` on its first row: it wraps to `width` instead of being cut. */
function wrapped(indent: string, label: readonly Span[], text: string, style: (t: string) => Span, width: number): Span[][] {
  const labelW = spanWidth(label)
  return wrapCells(text, Math.max(4, width - indent.length - labelW)).map((l, i) => [sp(indent), ...(i === 0 ? label : [sp(' '.repeat(labelW))]), style(l)])
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
