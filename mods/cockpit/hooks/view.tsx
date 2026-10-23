import type { Elements, RenderElement, RenderSurface } from 'claude-code'

import type { CockpitAgent, CockpitAlm, CockpitSnapshot, CockpitTask } from '../types'
import {
  AGENT_KEEP_MS,
  COLORS,
  ICONS,
  abbrevTokens,
  almText,
  barCells,
  burnRate,
  burnText,
  baseName,
  countdown,
  ctxColor,
  displayModel,
  duration,
  effortGlyph,
  fmtCost,
  fmtCostDelta,
  gridWidths,
  modelFamily,
  pctCell,
  rateColor,
  resetClock,
  shortModel,
  signedPct,
  spanWidth,
  padCells,
  taskBarCells,
  truncEnd,
  truncMiddle,
  weeklyPace,
  worklogLabel,
} from './format'
import type { ModelFamily, Span } from './format'

/** The elements the views draw with; every surface's table has them. */
export type Ui = Pick<Elements[RenderSurface], 'Box' | 'Text'>

const CTX_TEXT_MIN = '100% 999K/1M +99K'.length
const FIVE_HOURS = 18000
const SEVEN_DAYS = 604800
const MAX_AGENT_ROWS = 10
const MAX_TASK_ROWS = 6
const TASK_TIME_W = 6

// ── Spans ────────────────────────────────────────────────────────────────────

const dim = (t: string): Span => ({ t, dim: true })
const sp = (t: string, c?: string, bold?: boolean): Span => ({ t, c, bold })

function line({ Text }: Ui, spans: readonly Span[]): RenderElement {
  return (
    <Text wrap="truncate">
      {spans.map(s => (
        <Text color={s.c} dimColor={s.dim} weight={s.bold ? 'bold' : undefined}>
          {s.t}
        </Text>
      ))}
    </Text>
  )
}

const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - [...s].length))
const padStart = (s: string, n: number) => ' '.repeat(Math.max(0, n - [...s].length)) + s

const effortSpans = (effort: string | number | undefined): Span[] => {
  const g = effortGlyph(effort)
  return g ? [sp(g.icon, g.color)] : []
}

// The session's effort in the header: icon and level name, both in the level's color.
const headerEffort = (effort: string | number | undefined): Span[] => {
  const g = effortGlyph(effort)
  return g && typeof effort === 'string' ? [sp(' '), sp(`${g.icon} ${effort.toUpperCase()}`, g.color, true)] : []
}

// ── Data derived from the snapshot ───────────────────────────────────────────

type RateRow = { rem: number; used: number; color: string; resetMs: number | undefined; pace?: { target: number; delta: number } }

function rateRow(s: CockpitSnapshot, kind: 'five_hour' | 'seven_day'): RateRow | undefined {
  const w = s.rateLimits.find(r => r.kind === kind)
  if (!w) return undefined
  const parsed = w.resetsAt ? Date.parse(w.resetsAt) : Number.NaN
  const resetMs = Number.isNaN(parsed) ? undefined : parsed
  const windowSec = kind === 'five_hour' ? FIVE_HOURS : SEVEN_DAYS
  const rem = Math.max(0, Math.min(100, Math.round(100 - w.percentUsed)))
  return {
    rem,
    used: w.percentUsed,
    resetMs,
    color: rateColor(w.percentUsed, resetMs, windowSec, s.now),
    pace: kind === 'seven_day' ? weeklyPace(rem, resetMs, windowSec, s.now) : undefined,
  }
}

// An agent only seen through its events (no spawn yet, or an engine fork nothing lists) has type '?': not shown.
const visibleAgents = (s: CockpitSnapshot): CockpitAgent[] =>
  s.agents.filter(a => a.type !== '?').filter(a => a.status === 'running' || (a.endedAt !== undefined && s.now - a.endedAt < AGENT_KEEP_MS))

/** `chiesto fable → sonnet (env)` when the model asked for is not the one the agent runs on. */
export function agentWarning(a: CockpitAgent, isForced: boolean): string | undefined {
  const asked = modelFamily(a.requested)
  const got = modelFamily(a.model)
  if (!asked || !got || asked === got) return undefined
  return `chiesto ${asked} → ${got}${isForced ? ' (env)' : ''}`
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
  const n = (status: CockpitTask['status']) => tasks.filter(t => t.status === status).length
  return { inProgress: n('in_progress'), pending: n('pending'), done: n('completed'), total: tasks.length }
}

/** The open tasks the pane lists: in progress first, then pending, each in the order it arrived. */
export const openTasks = (s: CockpitSnapshot): CockpitTask[] => {
  const tasks = s.tasks ?? []
  return [...tasks.filter(t => t.status === 'in_progress'), ...tasks.filter(t => t.status === 'pending')]
}

/** One task row: icon, subject cut with `…` to fit, and for a task in progress the time since it started. */
export function taskRow(t: CockpitTask, now: number, width: number): Span[] {
  const isActive = t.status === 'in_progress'
  const subjectW = Math.max(4, width - 2 - 1 - TASK_TIME_W)
  const subject = padCells(truncEnd(t.subject, subjectW), subjectW)
  const elapsed = isActive && t.startedAt !== undefined ? duration(now - t.startedAt) : ''
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

const delta = (now: number | undefined, start: number | undefined): number | undefined =>
  now !== undefined && start !== undefined ? now - start : undefined

// ── Row builders (pure: spans in, spans out) ─────────────────────────────────

export function contextText(s: CockpitSnapshot): Span[] {
  const { tokens, window, percent, startTokens } = s.ctx
  // Before the first response nothing is measured: the fill reads as empty, not as missing.
  const pct = percent ?? 0
  const out: Span[] = [sp(pctCell(pct), ctxColor(pct), true), sp(` ${abbrevTokens(tokens ?? 0, true)}`)]
  if (window) out.push(dim(`/${abbrevTokens(window, true)}`))
  const grown = delta(tokens, startTokens)
  if (grown !== undefined && grown > 0) out.push(dim(` +${abbrevTokens(grown, true)}`))
  return out
}

function rateText(label: string, r: RateRow, now: number): Span[] {
  const cd = countdown(r.resetMs, now)
  const clock = resetClock(r.resetMs, now)
  return [sp(pctCell(r.rem), r.color, true), sp(' '), dim(label), ...(cd ? [dim(' ↻ '), sp(cd)] : []), ...(clock ? [sp(' '), dim(clock)] : [])]
}

/** The ALM row: dim label then the target, or `ALM non mappato` in red. */
export function almSpans(alm: CockpitAlm): Span[] {
  return alm.isMapped ? [dim('ALM '), sp(almText(alm).slice('ALM '.length))] : [sp(almText(alm), COLORS.red)]
}

export function agentRow(a: CockpitAgent, depth: number, now: number, width: number): Span[] {
  const nameW = Math.max(6, width - 27)
  const prefix = depth > 0 ? `${'  '.repeat(depth - 1)}└ ` : ''
  const isRunning = a.status === 'running'
  const end = a.endedAt ?? now
  return [
    isRunning ? sp('◐', COLORS.blue) : sp('✓', COLORS.green),
    sp(' '),
    depth > 0 ? sp(pad(truncMiddle(prefix + a.type, nameW), nameW), COLORS.dim) : sp(pad(truncMiddle(a.type, nameW), nameW)),
    sp(' '),
    sp(pad(shortModel(a.model), 9), undefined, isRunning),
    sp(' '),
    ...(effortSpans(a.effort).length ? effortSpans(a.effort) : [sp(' ')]),
    sp(' '),
    sp(padStart(duration(end - a.startedAt), 6)),
    sp(' '),
    sp(padStart(isRunning ? '' : abbrevTokens(a.tokens), 5)),
  ]
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

// ── Pane ─────────────────────────────────────────────────────────────────────

/** The pane's content stops here; a wider dock leaves the rest empty on the left. */
export const PANE_MAX_COLUMNS = 60

export function paneView(ui: Ui, s: CockpitSnapshot, bodyColumns: number): RenderElement {
  const { Box, Text } = ui
  const width = Math.min(bodyColumns, PANE_MAX_COLUMNS)
  const rule = <Text color={COLORS.rule}>{'─'.repeat(width)}</Text>
  const title = (label: string, right: Span[] = []) => (
    <Box justifyContent="space-between">
      {line(ui, [sp(label, COLORS.title)])}
      {line(ui, right)}
    </Box>
  )
  const split = (left: RenderElement, leftW: number, right: Span[]) => (
    <Box>
      <Box width={leftW}>{left}</Box>
      <Box marginLeft={1}>{line(ui, right)}</Box>
    </Box>
  )

  // Breathing room: an empty row between sections and under a title.
  const gap = () => <Text> </Text>

  // Header: model + effort | session cost (always: `$0.00` before the first turn) and the last turn's delta
  const costDelta = fmtCostDelta(delta(s.cost.usd, s.cost.startUsd))
  const header = (
    <Box justifyContent="space-between">
      {line(ui, [sp(displayModel(s.model) || '—', COLORS.blue), ...headerEffort(s.effort)])}
      {line(ui, [sp(fmtCost(s.cost.usd), COLORS.yellow, true), ...(costDelta ? [sp(' '), dim(costDelta)] : [])])}
    </Box>
  )

  // Folder · branch · diffs grid
  const g = s.git
  const diffs: Span[] = []
  if (g && g.staged > 0) diffs.push(sp(`+${g.staged}`, COLORS.green))
  if (g && g.modified > 0) diffs.push(sp(`~${g.modified}`, COLORS.yellow))
  if (g && g.untracked > 0) diffs.push(sp(`?${g.untracked}`, COLORS.dim))
  const diffText = diffs.flatMap((d, i) => (i ? [sp(' '), d] : [d]))
  const w = gridWidths(width, spanWidth(diffText))
  const dirty = g !== undefined && (g.staged > 0 || g.modified > 0)
  const folderName = g?.worktreeRoot ? baseName(g.worktreeRoot) : baseName(s.cwd)
  const grid = (
    <Box columnGap={1}>
      <Box width={w.folder}>
        {line(ui, [sp(truncMiddle(`${g?.worktreeRoot ? ICONS.tree : ICONS.folder} ${folderName}`, w.folder), COLORS.folder)])}
      </Box>
      <Box width={w.branch}>
        {g ? line(ui, [sp(truncMiddle(`${ICONS.branch} ${g.branch}`, w.branch), dirty ? COLORS.yellow : COLORS.lavender)]) : line(ui, [])}
      </Box>
      <Box width={w.diffs} justifyContent="flex-end">
        {line(ui, diffText)}
      </Box>
    </Box>
  )

  // ALM target of the folder (absent without a workspaces map)
  const almRow = s.alm && line(ui, almSpans(s.alm))

  // The one bar width of the context and credit rows: what is left of the widest readout.
  const five = rateRow(s, 'five_hour')
  const seven = rateRow(s, 'seven_day')
  const fiveText = five && rateText('5h', five, s.now)
  const sevenText = seven && rateText('7d', seven, s.now)
  const ctxText = contextText(s)
  const textCol = Math.max(CTX_TEXT_MIN, ...[ctxText, fiveText, sevenText].map(t => spanWidth(t ?? [])))
  const barW = Math.max(4, width - textCol - 1)

  // CONTESTO: the cache share of the last main-loop turn sits right of the title
  const pct = s.ctx.percent ?? 0
  const ctxBar = line(ui, barCells(barW, [{ pct, color: ctxColor(pct) }]))
  const cacheSpans: Span[] = s.cacheShare === undefined ? [] : [dim('cache '), sp(pctCell(s.cacheShare))]

  // CREDITI RESIDUI
  const paceDelta = seven?.pace?.delta
  const paceSpans: Span[] =
    paceDelta === undefined
      ? []
      : [dim('vs atteso 7d '), sp(signedPct(paceDelta), paceDelta < 0 ? COLORS.red : COLORS.green, true)]
  const creditRow = (r: RateRow, text: Span[]) => {
    const gap = r.pace && r.pace.delta < 0 ? -r.pace.delta : 0
    const parts = [{ pct: r.rem, color: r.color }, ...(gap ? [{ pct: gap, color: COLORS.gap }] : [])]
    return split(line(ui, barCells(barW, parts)), barW, text)
  }

  // The 5h burn rate: absent until 10 minutes of readings show the credits falling
  const burn = five && burnRate(s.fiveHourSamples ?? [], s.now, five.used, five.resetMs)
  const burnRow = burn && line(ui, [sp(burnText(burn), burn.isBeforeReset ? COLORS.red : COLORS.green)])

  // AGENTS
  const agents = visibleAgents(s)
  const rows = orderAgents(agents)
  const running = agents.filter(a => a.status === 'running').length
  const agentRows = rows.slice(0, MAX_AGENT_ROWS).flatMap(({ agent, depth }) => {
    const warn = agentWarning(agent, s.isSubagentModelForced)
    const out = [line(ui, agentRow(agent, depth, s.now, width))]
    if (warn) out.push(line(ui, [sp(`${'  '.repeat(depth + 1)}⚠ ${warn}`, COLORS.yellow)]))
    return out
  })

  // TASK (omitted with no tasks)
  const counts = taskCounts(s)
  const open = openTasks(s)
  const taskSection =
    counts === null
      ? []
      : [
          rule,
          gap(),
          title(`TASK · ${counts.done}/${counts.total}`, [
            sp(`◐ ${counts.inProgress}`, COLORS.blue),
            sp('  '),
            dim(`○ ${counts.pending}`),
            sp('  '),
            sp(`✓ ${counts.done}`, COLORS.green),
          ]),
          gap(),
          line(ui, taskBarCells(width, counts.done, counts.inProgress, counts.total)),
          ...open.slice(0, MAX_TASK_ROWS).map(t => line(ui, taskRow(t, s.now, width))),
          ...(open.length > MAX_TASK_ROWS ? [line(ui, [dim(`… +${open.length - MAX_TASK_ROWS}`)])] : []),
          ...(counts.done > 0 ? [line(ui, [sp('✓', COLORS.green), dim(` ${counts.done} completati`)])] : []),
        ]

  const wl = s.worklog
  const wlRows = [
    ...(wl.pending.length ? [worklogLabel('pending', wl.pending)] : []),
    ...(wl.underTarget.length ? [worklogLabel('underTarget', wl.underTarget)] : []),
  ]

  return (
    <Box flexDirection="column" width={width} marginLeft={bodyColumns - width}>
      {header}
      {grid}
      {almRow}
      {rule}
      {gap()}
      {title('CONTESTO', cacheSpans)}
      {gap()}
      {split(ctxBar, barW, ctxText)}
      {rule}
      {gap()}
      {title('CREDITI RESIDUI', paceSpans)}
      {gap()}
      {five && fiveText && creditRow(five, fiveText)}
      {burnRow}
      {five && seven && gap()}
      {seven && sevenText && creditRow(seven, sevenText)}
      {!five && !seven && line(ui, [dim('nessun dato sui limiti')])}
      {rule}
      {gap()}
      {title(`AGENTS · ${running} in corso`, modelCounts(agents))}
      {rows.length > 0 && gap()}
      {agentRows}
      {rows.length > MAX_AGENT_ROWS && line(ui, [dim(`… +${rows.length - MAX_AGENT_ROWS}`)])}
      {taskSection}
      {wlRows.length > 0 && rule}
      {wlRows.length > 0 && gap()}
      {wlRows.map(text => line(ui, [sp('● ', COLORS.yellow), sp(text, COLORS.yellow)]))}
    </Box>
  )
}
