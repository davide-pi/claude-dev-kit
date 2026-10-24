import type { Elements, RenderElement, RenderSurface } from 'claude-code'

import type {
  CockpitAgent,
  CockpitAlm,
  CockpitChange,
  CockpitConsumer,
  CockpitContext,
  CockpitContextRow,
  CockpitDiff,
  CockpitNote,
  CockpitPr,
  CockpitSnapshot,
  CockpitSysProc,
  CockpitSystem,
  CockpitTab,
  CockpitTask,
  CockpitToolCall,
} from '../types'
import {
  AGENT_KEEP_MS,
  COLORS,
  ICONS,
  abbrevTokens,
  aheadBehindSpans,
  almText,
  autocompactForecast,
  barCells,
  baseName,
  cacheColor,
  claimTime,
  claudeStateSpans,
  countdown,
  ctxColor,
  displayModel,
  duration,
  effortGlyph,
  fmtCost,
  fmtBytes,
  fmtCostDelta,
  folderIcon,
  gridWidths,
  hhmm,
  modelFamily,
  openTasks,
  parseReset,
  pctCell,
  rateColor,
  shortModel,
  shouldCompact,
  signedPctCell,
  spanWidth,
  sparkline,
  padCells,
  rangeSparkline,
  textCells,
  sessionTokens,
  taskBarCells,
  tokenShare,
  truncEnd,
  truncMiddle,
  truncateSpans,
  weeklyPace,
  worklogLabel,
} from './format'
import type { ModelFamily, Span } from './format'
import { t } from './strings'

/** The elements the views draw with; every surface's table has them. */
export type Ui = Pick<Elements[RenderSurface], 'Box' | 'Text' | 'Button' | 'Code' | 'Link'> & {
  /** Every surface but the mobile app's draws a text field: there the note is left out. */
  Input?: Elements['terminal']['Input']
}

const CTX_TEXT_MIN = '100% 999K/1M +99K'.length
const FIVE_HOURS = 18000
const SEVEN_DAYS = 604800
const MAX_AGENT_ROWS = 10
const MAX_HISTORY_ROWS = 10
/** Cells a terminal Button adds around its label (`[ label ]`), and between two of a row. */
const BUTTON_CHROME = 4
const BUTTON_GAP = 1
/** The context fill from which the header warns. */
const CTX_WARN_PCT = 80
const ALM_LABEL = 'ALM '
const MAX_TASK_ROWS = 6
const MAX_OUTSIDE_ROWS = 5
const MAX_SUBAGENT_BLOCKS = 5
const TASK_TIME_W = 6
const MAX_FILE_ROWS = 8
/** Cells before a changed file's path: the added column, the deleted one and their gaps. */
const CHANGE_COUNTS_W = 12
const MAX_PR_ROWS = 4
/** Cells of a System row's label (`CPU  `), the sparkline's longest run, and the cells of a process row's columns: pid, name (at most), CPU and RAM. */
const SYS_LABEL_W = 5
const SYS_SPARK_MAX = 20
const SYS_PID_W = 6
const SYS_NAME_W = 14
const SYS_CPU_W = 4
const SYS_RAM_W = 5
/** Cells of a tool row: the tool's name, and the time it started (`HH:MM`). */
const CALL_TOOL_W = 7
const CALL_TIME_W = 5
const MAX_SKILL_ROWS = 6
/** Cells of the Context rows: a category's tokens and share of the window, what follows them (the exact mark and the change of the last round) and a consumer's kind label. */
const CTX_TOKENS_W = 6
const CTX_SHARE_W = 5
const CTX_MARK_W = 2
const CTX_DELTA_W = 6
const CONSUMER_KIND_W = 5
/** The colors of the used categories, in turn; the compaction buffer is dim and the free space empty. */
const CATEGORY_COLORS = [COLORS.blue, COLORS.lavender, COLORS.amber, COLORS.green, COLORS.yellow, COLORS.orange, COLORS.violet, COLORS.gray]

// ── Spans ────────────────────────────────────────────────────────────────────

const dim = (t: string): Span => ({ t, dim: true })
const sp = (t: string, c?: string, bold?: boolean): Span => ({ t, c, bold })

/** One `Text` per span: the children of a row and of a pressable row. */
function spanNodes({ Text }: Ui, spans: readonly Span[]): RenderElement[] {
  return spans.map(s => (
    <Text color={s.c} dimColor={s.dim} weight={s.bold ? 'bold' : undefined}>
      {s.t}
    </Text>
  ))
}

function line(ui: Ui, spans: readonly Span[]): RenderElement {
  const { Text } = ui
  return <Text wrap="truncate">{spanNodes(ui, spans)}</Text>
}

/** Cells a row of terminal Buttons takes with these labels. */
const buttonRowWidth = (labels: readonly string[]): number =>
  labels.reduce((n, l) => n + [...l].length + BUTTON_CHROME, 0) + BUTTON_GAP * Math.max(0, labels.length - 1)

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

type RateRow = { rem: number; color: string; resetMs: number | undefined; isStale: boolean; pace?: { target: number; delta: number } }

/** The windows to draw: the engine's, or while it reports none the status line's last known ones (drawn with a `~`). */
const isLastKnownRates = (s: CockpitSnapshot): boolean => s.rateLimits.length === 0 && (s.lastRates?.length ?? 0) > 0

function rateRow(s: CockpitSnapshot, kind: 'five_hour' | 'seven_day'): RateRow | undefined {
  const isStale = isLastKnownRates(s)
  const w = (isStale ? (s.lastRates ?? []) : s.rateLimits).find(r => r.kind === kind)
  if (!w) return undefined
  const resetMs = parseReset(w.resetsAt)
  const windowSec = kind === 'five_hour' ? FIVE_HOURS : SEVEN_DAYS
  const rem = Math.max(0, Math.min(100, Math.round(100 - w.percentUsed)))
  return {
    rem,
    resetMs,
    isStale,
    color: rateColor(w.percentUsed, resetMs, windowSec, s.now),
    pace: kind === 'seven_day' ? weeklyPace(rem, resetMs, windowSec, s.now) : undefined,
  }
}

// An agent only seen through its events (no spawn yet, or an engine fork nothing lists) has type '?': not shown.
const visibleAgents = (s: CockpitSnapshot): CockpitAgent[] =>
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

const delta = (now: number | undefined, start: number | undefined): number | undefined =>
  now !== undefined && start !== undefined ? now - start : undefined

// ── Row builders (pure: spans in, spans out) ─────────────────────────────────

/** A percentage in its column; the last known one has a dim `~` in the cell before its digits. */
const pctSpans = (n: number, color: string, isStale: boolean): Span[] =>
  isStale ? [dim('~'), sp(pctCell(n).trimStart().padStart(3), color, true)] : [sp(pctCell(n), color, true)]

export function contextText(s: CockpitSnapshot): Span[] {
  // Until the engine measures the window (a resumed session, before its first response) the last state's reading stands in, with a `~`.
  const isStale = s.ctx.percent === undefined && s.lastCtx !== undefined
  const { tokens, window, percent } = isStale && s.lastCtx ? s.lastCtx : s.ctx
  const startTokens = isStale ? undefined : s.ctx.startTokens
  // Before the first response nothing is measured: the fill reads as empty, not as missing.
  const pct = percent ?? 0
  const out: Span[] = [...pctSpans(pct, ctxColor(pct), isStale), sp(` ${abbrevTokens(tokens ?? 0, true)}`)]
  if (window) out.push(dim(`/${abbrevTokens(window, true)}`))
  const grown = delta(tokens, startTokens)
  if (grown !== undefined && grown > 0) out.push(dim(` +${abbrevTokens(grown, true)}`))
  return out
}

function rateText(label: string, r: RateRow, now: number): Span[] {
  const cd = countdown(r.resetMs, now)
  return [...pctSpans(r.rem, r.color, r.isStale), sp(' '), dim(label), ...(cd ? [dim(' ↻ '), sp(cd)] : [])]
}

/** The ALM row cut to `width`: dim label then the target, or `ALM non mappato` in red; empty for a root that names nothing. */
export function almSpans(alm: CockpitAlm, width: number): Span[] {
  const text = almText(alm)
  if (text === '') return []
  const target = truncMiddle(text, Math.max(0, width - ALM_LABEL.length))
  return alm.isMapped ? [dim(ALM_LABEL), sp(target)] : [sp(ALM_LABEL + target, COLORS.red)]
}

/** An agent's state mark: running, interrupted, failed or done. */
const agentIcon = (a: CockpitAgent): Span =>
  a.status === 'running' ? sp('◐', COLORS.blue) : a.isInterrupted ? sp('■', COLORS.dim) : a.isFailed ? sp('✗', COLORS.red) : sp('✓', COLORS.green)

export function agentRow(a: CockpitAgent, depth: number, now: number, width: number): Span[] {
  const nameW = Math.max(6, width - 27)
  const prefix = depth > 0 ? `${'  '.repeat(depth - 1)}└ ` : ''
  const isRunning = a.status === 'running'
  const end = a.endedAt ?? now
  return [
    agentIcon(a),
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

/** The Subagenti tab's second row of an agent: model and effort on the left; its share of the session's tokens and its elapsed time on the right. */
export function subagentFacts(a: CockpitAgent, now: number, total: number, indent: string): { left: Span[]; right: Span[] } {
  const share = tokenShare(a.tokens, total)
  return {
    left: [sp(indent), a.model ? sp(shortModel(a.model), undefined, a.status === 'running') : dim('—'), ...headerEffort(a.effort)],
    right: [...(share ? [sp(share, undefined, true), dim(t().tokenShare)] : []), sp(duration((a.endedAt ?? now) - a.startedAt))],
  }
}

/**
 * The rows under an agent's facts on the Subagenti tab: the four counters, then the tool running now (or, when none is, the last
 * one). Each is left out until the engine gave it: nothing is faked.
 */
export function subagentDetails(a: CockpitAgent, indent: string, width: number): Span[][] {
  const running = a.status === 'running' ? a.activeTools?.at(-1) : undefined
  const counters = a.usage
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

/** One changed file's row: its added and deleted lines (`bin` for a binary file, `?` for an untracked one), then its path cut to fit. */
export function changeSpans(c: CockpitChange, width: number): Span[] {
  const counts: Span[] = c.isUntracked
    ? [dim(padStart('?', 5)), sp(' '.repeat(6))]
    : c.isBinary
      ? [dim(padStart('bin', 5)), sp(' '.repeat(6))]
      : [sp(padStart(`+${c.added ?? 0}`, 5), COLORS.green), sp(' '), sp(padStart(`-${c.deleted ?? 0}`, 5), COLORS.red)]
  return [...counts, sp(' '), sp(truncMiddle(c.path, Math.max(4, width - CHANGE_COUNTS_W)))]
}

/** One tool call of the main loop: how it ended, the tool, its short argument cut to fit, the time it started (none when the clock could not give it). */
export function toolCallSpans(c: CockpitToolCall, width: number): Span[] {
  const timeW = c.at === undefined ? 0 : 1 + CALL_TIME_W
  const argW = Math.max(0, width - 2 - CALL_TOOL_W - 1 - timeW)
  return [
    c.isOk ? sp('✓', COLORS.green) : sp('✗', COLORS.red),
    sp(' '),
    sp(padCells(truncEnd(c.tool, CALL_TOOL_W), CALL_TOOL_W)),
    sp(' '),
    // a call whose start the clock could not give has no time to draw: its argument takes the cells
    ...(c.at === undefined ? [dim(truncEnd(c.arg ?? '', argW))] : [dim(padCells(truncEnd(c.arg ?? '', argW), argW)), sp(' '), dim(hhmm(c.at))]),
  ]
}

const PR_COLORS = { open: COLORS.green, draft: COLORS.yellow, merged: COLORS.violet, closed: COLORS.red } as const

/** The state word of a pull request, a draft told apart from an open one. */
const prState = (pr: CockpitPr) => {
  const state = pr.state === 'open' && pr.isDraft ? 'draft' : pr.state
  return { text: t().prStates[state], color: PR_COLORS[state] }
}

/** What follows a pull request's number on its row: its state and its title, cut to fit `width` (the number's own cells included). */
export function prSpans(pr: CockpitPr, width: number): Span[] {
  const { text, color } = prState(pr)
  const head = ` · ${text}`
  const titleW = width - textCells(`#${pr.number}${head} · `)
  return [sp(' · ', COLORS.dim), sp(text, color), ...(pr.title !== '' && titleW >= 4 ? [sp(' · ', COLORS.dim), sp(truncEnd(pr.title, titleW))] : [])]
}

/** The row under a pull request's: its review and its checks, when known; empty when neither is. */
export function prDetailSpans(pr: CockpitPr, indent: string, width: number): Span[] {
  const review = reviewSpans(pr)
  const checks = checksSpans(pr)
  if (review.length + checks.length === 0) return []
  return truncateSpans([sp(indent), ...review, ...(review.length > 0 && checks.length > 0 ? [dim(' · ')] : []), ...checks], width)
}

/** The bar of the window: a part per used category (each its own color) and the compaction buffer; the rest stays empty. */
export function contextBar(c: CockpitContext, width: number): Span[] {
  let n = 0
  const parts = c.rows.flatMap(r => {
    if (r.kind !== 'used' && r.kind !== 'buffer') return []
    const color = r.kind === 'buffer' ? COLORS.dim : (CATEGORY_COLORS[n++ % CATEGORY_COLORS.length] ?? COLORS.gray)
    return [{ pct: c.max > 0 ? (100 * r.tokens) / c.max : 0, color }]
  })
  return barCells(width, parts)
}

/**
 * One category row: a square in the bar color, its name cut to fit, its tokens and its share of the window; then a `✓` when the tokens are an
 * exact count kept from earlier, and the change of the last round (`+12k`, none when it did not move).
 */
export function categorySpans(r: CockpitContextRow, color: string, max: number, width: number): Span[] {
  const nameW = Math.max(4, width - 2 - CTX_TOKENS_W - CTX_SHARE_W - CTX_MARK_W - CTX_DELTA_W)
  const share = max > 0 ? `${Math.round((100 * r.tokens) / max)}%` : ''
  const delta = r.delta ? padStart(`${r.delta > 0 ? '+' : '−'}${abbrevTokens(Math.abs(r.delta))}`, CTX_DELTA_W) : ''
  const mark = r.isExact ? ' ✓' : delta !== '' ? '  ' : ''
  return [
    sp('■', color),
    sp(' '),
    sp(padCells(truncEnd(r.name, nameW), nameW)),
    sp(padStart(abbrevTokens(r.tokens), CTX_TOKENS_W)),
    dim(padStart(share, CTX_SHARE_W)),
    ...(mark !== '' ? [r.isExact ? sp(mark, COLORS.green) : dim(mark)] : []),
    ...(delta !== '' ? [dim(delta)] : []),
  ]
}

/** The rows of the table, in the order the reading holds them (biggest first): the categories inside the window (a deferred one is outside it), colored as the bar colors them. */
export function categoryRows(c: CockpitContext, width: number): Span[][] {
  let n = 0
  return c.rows.flatMap(r => {
    if (r.kind === 'deferred') return []
    const color = r.kind === 'free' ? COLORS.empty : r.kind === 'buffer' ? COLORS.dim : (CATEGORY_COLORS[n++ % CATEGORY_COLORS.length] ?? COLORS.gray)
    return [categorySpans(r, color, c.max, width)]
  })
}

/** A static consumer row: its kind, its name cut to fit, its tokens. */
export function consumerSpans(c: CockpitConsumer, width: number): Span[] {
  const nameW = Math.max(4, width - CONSUMER_KIND_W - 1 - CTX_TOKENS_W)
  return [dim(pad(t().consumerKinds[c.kind], CONSUMER_KIND_W)), sp(' '), sp(padCells(truncMiddle(c.name, nameW), nameW)), sp(padStart(abbrevTokens(c.tokens), CTX_TOKENS_W))]
}

/** The color of a load in percent: green, yellow from 60, red from 85. */
const loadColor = (pct: number): string => (pct >= 85 ? COLORS.red : pct >= 60 ? COLORS.yellow : COLORS.green)

/**
 * One System row: its label, bars of the last samples (as many as fit, at most 20, scaled between the lowest and the highest of them),
 * the highest one printed after them (`formatMax`) and the readout flush right; cut to `width`.
 */
export function metricSpans(label: string, samples: readonly number[], color: string, readout: Span[], width: number, formatMax: (max: number) => string): Span[] {
  const widest = samples.length > 0 ? 1 + textCells(formatMax(Math.max(...samples))) : 0
  const room = Math.max(0, Math.min(SYS_SPARK_MAX, width - SYS_LABEL_W - spanWidth(readout) - 1 - widest))
  const shown = samples.slice(-room)
  const spark = room > 0 ? rangeSparkline(shown) : ''
  const maxSpans: Span[] = spark !== '' ? [dim(` ${formatMax(Math.max(...shown))}`)] : []
  const fill = Math.max(1, width - SYS_LABEL_W - spark.length - spanWidth(maxSpans) - spanWidth(readout))
  return truncateSpans([dim(pad(label, SYS_LABEL_W)), ...(spark !== '' ? [sp(spark, color)] : []), ...maxSpans, sp(' '.repeat(fill)), ...readout], width)
}

const maxPct = (max: number) => `${t().max} ${Math.round(max)}%`

/** The System tab's CPU, RAM and network rows; a part that could not be read says so, one not read yet draws `…`. */
export function systemMetricRows(sys: CockpitSystem, width: number): Span[][] {
  const na = (label: string): Span[] => [dim(pad(label, SYS_LABEL_W)), dim(t().unavailable)]
  const cpu = sys.cpu.at(-1)
  const ram = sys.ram.at(-1)
  const rx = sys.rx.at(-1)
  const tx = sys.tx.at(-1)
  return [
    sys.off.includes('cpu') ? na('CPU') : metricSpans('CPU', sys.cpu, cpu === undefined ? COLORS.dim : loadColor(cpu), cpu === undefined ? [dim('…')] : [sp(`${Math.round(cpu)}%`, loadColor(cpu), true)], width, maxPct),
    sys.off.includes('ram')
      ? na('RAM')
      : metricSpans(
          'RAM',
          sys.ram,
          ram === undefined ? COLORS.dim : loadColor(ram),
          ram === undefined || sys.ramUsed === undefined || sys.ramTotal === undefined
            ? [dim('…')]
            : [sp(`${fmtBytes(sys.ramUsed)}/${fmtBytes(sys.ramTotal)}`), sp(' '), sp(`${ram}%`, loadColor(ram), true)],
          width,
          maxPct,
        ),
    sys.off.includes('net')
      ? na('NET')
      : metricSpans(
          'NET',
          sys.rx.map((v, i) => v + (sys.tx[i] ?? 0)),
          COLORS.blue,
          rx === undefined || tx === undefined ? [dim('…')] : [dim('↓'), sp(`${fmtBytes(rx)}/s`), dim(' ↑'), sp(`${fmtBytes(tx)}/s`)],
          width,
          max => `${t().max} ${fmtBytes(max)}/s`,
        ),
  ]
}

/** The System tab's last metric row: the free room of the working directory's drive and where the power comes from, each with its icon. */
export function diskPowerSpans(sys: CockpitSystem, width: number): Span[] {
  const { disk, power } = sys
  const diskSpans: Span[] = sys.off.includes('disk')
    ? [dim(`${ICONS.disk} `), dim(t().unavailable)]
    : disk
      ? [dim(`${ICONS.disk} `), sp(`${disk.label ? `${disk.label} ` : ''}${fmtBytes(disk.free)} ${t().diskFree}`, disk.total > 0 && disk.free / disk.total < 0.1 ? COLORS.red : disk.total > 0 && disk.free / disk.total < 0.2 ? COLORS.yellow : undefined)]
      : [dim(`${ICONS.disk} `), dim('…')]
  const powerSpans: Span[] = sys.off.includes('power')
    ? [dim(`${ICONS.battery} `), dim(t().unavailable)]
    : !power
      ? [dim(`${ICONS.battery} `), dim('…')]
      : power.kind === 'wired'
        ? [sp(`${ICONS.plug} `, COLORS.green), sp(t().mains)]
        : [
            sp(`${power.isCharging ? ICONS.charging : ICONS.battery} `, power.isCharging ? COLORS.green : power.percent <= 15 ? COLORS.red : power.percent <= 30 ? COLORS.yellow : undefined),
            sp(`${Math.round(power.percent)}%${power.isCharging ? t().charging : ''}`, power.isCharging ? COLORS.green : power.percent <= 15 ? COLORS.red : undefined),
          ]
  return truncateSpans([...diskSpans, sp('  '), ...powerSpans], width)
}

/** A CPU share in its cell: a tenth under 10 %, whole above (`0.4%`, `12%`); empty until two reads gave one. */
const cpuCell = (cpu: number | undefined): string => (cpu === undefined ? '' : cpu >= 10 ? `${Math.round(cpu)}%` : `${cpu.toFixed(1)}%`)

/**
 * One row of the process table: pid, name (cut to what the width leaves), CPU, RAM, then the ports that fit after them (each is a link the
 * pane draws); `more` when a port was left out for lack of room. The head is cut to `width`.
 */
export function procParts(p: CockpitSysProc, width: number): { head: Span[]; ports: number[]; more: boolean } {
  const nameW = Math.max(4, Math.min(SYS_NAME_W, width - (SYS_PID_W + SYS_CPU_W + SYS_RAM_W + 3)))
  const head = truncateSpans(
    [
      dim(padStart(String(p.pid), SYS_PID_W)),
      sp(' '),
      sp(padCells(truncEnd(p.name, nameW), nameW)),
      sp(' '),
      sp(padStart(cpuCell(p.cpu), SYS_CPU_W)),
      sp(' '),
      dim(padStart(p.ram === undefined ? '' : fmtBytes(p.ram), SYS_RAM_W)),
    ],
    width,
  )
  const ports: number[] = []
  let used = spanWidth(head)
  for (const port of p.ports) {
    const cells = 1 + String(port).length + 1
    if (used + cells > width) break
    ports.push(port)
    used += cells
  }
  // ` …` says a port was left out, when it fits after the ones shown
  return { head, ports, more: ports.length < p.ports.length && used + 2 <= width }
}

const REVIEW_COLORS: Record<NonNullable<CockpitPr['review']>, string> = { approved: COLORS.green, changes: COLORS.red, pending: COLORS.yellow }

/** The review row of a pull request: `review approved`; empty when no review is known. */
export function reviewSpans(pr: CockpitPr): Span[] {
  return pr.review === undefined ? [] : [dim(t().review), sp(t().reviews[pr.review], REVIEW_COLORS[pr.review])]
}

/** The checks row of a pull request: `checks 2/4 · ✗ 1 · ◐ 1` (passed of all, then the failed and the undecided); empty when none are known. */
export function checksSpans(pr: CockpitPr): Span[] {
  const c = pr.checks
  if (!c) return []
  const total = c.passed + c.failed + c.pending
  const color = c.failed > 0 ? COLORS.red : c.pending > 0 ? COLORS.yellow : COLORS.green
  return [
    dim(t().checks),
    sp(`${c.passed}/${total}`, color, true),
    ...(c.failed > 0 ? [dim(' · '), sp(`✗ ${c.failed}`, COLORS.red)] : []),
    ...(c.pending > 0 ? [dim(' · '), sp(`◐ ${c.pending}`, COLORS.yellow)] : []),
  ]
}

// ── Pane ─────────────────────────────────────────────────────────────────────

/** The pane's content stops here; a wider dock leaves the rest empty on the left. */
export const PANE_MAX_COLUMNS = 60
/** Columns of margin on each side of the content. */
const PANE_PADDING_X = 1

type Node = RenderElement | false | undefined
type Block = (Node | readonly Node[])[]

/** What a press does; the register module holds the engine, the view only names the acts. */
export type PaneActions = {
  selectTab: (tab: CockpitTab) => void
  compact: () => void
  /** Asks the worklog for today's hours of this chat (`/worklog oggi sessione <id>`). */
  runWorklog: () => void
  /** Puts the agent's transcript in the main view. */
  openAgent: (agentId: string) => void
  toggleHistory: () => void
  /** Asks for the exact count of the context breakdown (`full`: it spends token-count requests). */
  countExact: () => void
  /** Draws the diff of a changed file in the second pane. */
  openDiff: (change: CockpitChange) => void
  /** Keeps what the Notes tab's field holds as the person types it. */
  setNoteDraft: (text: string) => void
  /** Saves the field as a note (replacing the one it was loaded from, if any): the text of the field on Enter, the kept draft when none is given. */
  saveNote: (text?: string) => void
  /** Loads a saved note into the field. */
  editNote: (id: number) => void
  /** Appends a saved note to the prompt box; the note stays in the list. */
  sendNote: (id: number) => void
  deleteNote: (id: number) => void
}

/** What the diff pane's button does. */
export type DiffActions = { close: () => void }

/** The second pane: the diff of the file pressed on the Work tab, drawn by the engine's `Code` as unified hunks; empty when none is open. */
export function diffView(ui: Ui, diff: CockpitDiff | undefined, bodyColumns: number, actions: DiffActions): RenderElement {
  const { Box, Text, Button, Code } = ui
  const S = t()
  if (!diff) return <Text dimColor>{S.nothingToShow}</Text>
  return (
    <Box flexDirection="column" width={bodyColumns}>
      <Box justifyContent="space-between">
        <Text wrap="truncate" color={COLORS.title}>
          {S.diffTitle(diff.file)}
        </Text>
        <Button key="diff:close" onPress={() => actions.close()}>
          {S.buttons.close}
        </Button>
      </Box>
      {diff.isUnreadable === true ? (
        <Text dimColor>{S.diffUnreadable}</Text>
      ) : diff.text === '' ? (
        <Text dimColor>{S.noHunk}</Text>
      ) : (
        <Code source={diff.text} format="diff" wrap="truncate-end" />
      )}
      {diff.isCut === true && <Text dimColor>{S.diffCut}</Text>}
    </Box>
  )
}

export function paneView(ui: Ui, s: CockpitSnapshot, bodyColumns: number, bodyRows: number, actions: PaneActions): RenderElement {
  const { Box, Text, Button, Link, Input } = ui
  const S = t()
  // The block is at most PANE_MAX_COLUMNS wide; its content leaves one column of margin each side.
  const block = Math.min(bodyColumns, PANE_MAX_COLUMNS)
  const width = Math.max(0, block - 2 * PANE_PADDING_X)
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

  // An agent row is a Button: a press puts the agent's transcript in the main view.
  const agentButton = (key: string, a: CockpitAgent, depth: number) => (
    <Button key={key} plain onPress={() => actions.openAgent(a.id)}>
      {spanNodes(ui, agentRow(a, depth, s.now, width))}
    </Button>
  )

  const tab = s.tab ?? 'agents'
  const agents = visibleAgents(s)
  const running = agents.filter(a => a.status === 'running')

  const wl = s.worklog
  const wlRows = [
    ...(wl.pending.length ? [worklogLabel('pending', wl.pending)] : []),
    ...(wl.underTarget.length ? [worklogLabel('underTarget', wl.underTarget)] : []),
  ]

  // ── Tab bar: the selected tab is the primary button ──
  const tabButton = (id: CockpitTab, label: string, hasDot = false) => {
    const variant = tab === id ? 'primary' : 'secondary'
    return hasDot ? (
      <Button key={`tab:${id}`} variant={variant} onPress={() => actions.selectTab(id)}>
        {label}
        <Text color={COLORS.yellow}> ●</Text>
      </Button>
    ) : (
      <Button key={`tab:${id}`} variant={variant} label={label} onPress={() => actions.selectTab(id)} />
    )
  }
  // The long labels, with the running count and the dot, when the whole bar fits; else the short ones.
  const fullLabels = [
    running.length > 0 ? `${S.tabs.agents} ${running.length}` : S.tabs.agents,
    S.tabs.context,
    wlRows.length > 0 ? `${S.tabs.work} ●` : S.tabs.work,
    S.tabs.system,
    S.tabs.notes,
  ]
  const names = buttonRowWidth(fullLabels) <= width ? S.tabs : S.tabsShort
  const tabBar = (
    <Box columnGap={1} flexWrap="wrap">
      {tabButton('agents', running.length > 0 ? `${names.agents} ${running.length}` : names.agents)}
      {tabButton('context', names.context)}
      {tabButton('work', names.work, wlRows.length > 0)}
      {tabButton('system', names.system)}
      {tabButton('notes', names.notes)}
    </Box>
  )

  // ── Header: folder · branch (ahead/behind) · compact git state ──
  const g = s.git
  const diffs: Span[] = []
  if (g && g.staged > 0) diffs.push(sp(`+${g.staged}`, COLORS.green))
  if (g && g.modified > 0) diffs.push(sp(`~${g.modified}`, COLORS.yellow))
  if (g && g.untracked > 0) diffs.push(sp(`?${g.untracked}`, COLORS.dim))
  const diffText = diffs.flatMap((d, i) => (i ? [sp(' '), d] : [d]))
  const w = gridWidths(width, spanWidth(diffText))
  const dirty = g !== undefined && (g.staged > 0 || g.modified > 0)
  const folderName = g?.worktreeRoot ? baseName(g.worktreeRoot) : baseName(s.cwd)
  const arrows = g ? aheadBehindSpans(g) : []
  const grid = (
    <Box columnGap={1}>
      <Box width={w.folder}>{line(ui, [sp(truncMiddle(`${folderIcon(g)} ${folderName}`, w.folder), COLORS.folder)])}</Box>
      <Box width={w.branch}>
        {g
          ? line(ui, [sp(truncMiddle(`${ICONS.branch} ${g.branch}`, Math.max(0, w.branch - spanWidth(arrows))), dirty ? COLORS.yellow : COLORS.lavender), ...arrows])
          : line(ui, [])}
      </Box>
      <Box width={w.diffs} justifyContent="flex-end">
        {line(ui, diffText)}
      </Box>
    </Box>
  )

  // ALM target of the folder (absent without a workspaces map, or a mapped root that names nothing)
  const almLine = s.alm ? almSpans(s.alm, width) : []
  const almRow = almLine.length > 0 && line(ui, almLine)

  // Header line 1: model + effort + the Claude state | session cost (always: `$0.00` before the first turn), the last round's delta and duration
  const costDelta = fmtCostDelta(delta(s.cost.usd, s.cost.startUsd))
  // the last main round's length, once a second or more of it ran
  const roundSpans: Span[] = s.lastRoundMs !== undefined && s.lastRoundMs >= 1000 ? [dim(' · '), dim(duration(s.lastRoundMs))] : []
  const costSpans: Span[] = [sp(fmtCost(s.cost.usd), COLORS.yellow, true), ...(costDelta ? [sp(' '), dim(costDelta)] : []), ...roundSpans]
  const modelSpans = truncateSpans(
    [sp(displayModel(s.model) || '—', COLORS.blue), ...headerEffort(s.effort), sp('  '), ...claudeStateSpans(s.claudeState)],
    Math.max(0, width - spanWidth(costSpans) - 1),
  )
  const modelLine = (
    <Box justifyContent="space-between">
      {line(ui, modelSpans)}
      {line(ui, costSpans)}
    </Box>
  )

  // The one bar width of the context and credit rows: what is left of the widest readout.
  const five = rateRow(s, 'five_hour')
  const seven = rateRow(s, 'seven_day')
  const fiveText = five && rateText('5h', five, s.now)
  const sevenText = seven && rateText('7d', seven, s.now)
  const ctxText = contextText(s)
  const textCol = Math.max(CTX_TEXT_MIN, ...[ctxText, fiveText, sevenText].map(text => spanWidth(text ?? [])))
  const barW = Math.max(4, width - textCol - 1)

  // CONTEXT: from 80% a red line
  const pct = s.ctx.percent ?? 0
  const shownPct = s.ctx.percent ?? s.lastCtx?.percent ?? 0
  const ctxBar = line(ui, barCells(barW, [{ pct: shownPct, color: ctxColor(shownPct) }]))
  const ctxWarning = pct >= CTX_WARN_PCT && line(ui, [sp(S.contextAt(Math.round(pct)), COLORS.red)])

  // Right of the CONTEXT title: the prompt cache hit of the last main-loop turn (coloured by thresholds) and the requests left before auto-compaction
  const cacheSpans: Span[] = s.cacheShare === undefined ? [] : [dim(S.cache), sp(pctCell(s.cacheShare), cacheColor(s.cacheShare))]
  const forecast = autocompactForecast(s.ctxSamples, s.autoCompactAt)
  const forecastSpans: Span[] = forecast === undefined ? [] : [dim(S.requestsLeft(forecast))]
  const contextRight: Span[] = [...cacheSpans, ...(cacheSpans.length > 0 && forecastSpans.length > 0 ? [sp('  ')] : []), ...forecastSpans]

  // CREDITS: the pace of the week sits right of the title
  const paceDelta = seven?.pace?.delta
  const paceSpans: Span[] =
    paceDelta === undefined
      ? []
      : [dim(S.vsExpected), sp(signedPctCell(paceDelta), paceDelta < 0 ? COLORS.red : COLORS.green, true)]
  const creditRow = (r: RateRow, text: Span[]) => {
    const gap = r.pace && r.pace.delta < 0 ? -r.pace.delta : 0
    const parts = [{ pct: r.rem, color: r.color }, ...(gap ? [{ pct: gap, color: COLORS.gap }] : [])]
    return split(line(ui, barCells(barW, parts)), barW, text)
  }

  // The last row of every tab: compact always; log hours (the hours of this chat) whenever the session has an id. The row stacks
  // when its buttons do not fit the pane side by side.
  const hasSession = s.sessionId !== undefined
  const barLabels = [S.buttons.compact, ...(hasSession ? [S.buttons.logHours] : [])]
  const buttonsRow = (
    <Box flexDirection={buttonRowWidth(barLabels) <= width ? 'row' : 'column'} alignItems="flex-start" columnGap={BUTTON_GAP}>
      <Button key="bar:compact" onPress={() => actions.compact()}>
        {S.buttons.compact}
      </Button>
      {hasSession && (
        <Button key="bar:worklog" onPress={() => actions.runWorklog()}>
          {S.buttons.logHours}
        </Button>
      )}
    </Box>
  )

  // The header, above the tab bar on every tab: model, state and cost; folder, branch and git; then CONTEXT and CREDITS, the three blocks told apart by a rule, each title with an empty row on both sides
  const headerRows: Node[] = [
    modelLine,
    grid,
    almRow,
    rule,
    gap(),
    title(S.contextTitle, contextRight),
    gap(),
    split(ctxBar, barW, ctxText),
    ctxWarning,
    rule,
    gap(),
    title(S.creditsTitle, paceSpans),
    gap(),
    five && fiveText && creditRow(five, fiveText),
    five && seven && gap(),
    seven && sevenText && creditRow(seven, sevenText),
    !five && !seven && line(ui, [dim(S.noRateData)]),
  ]

  // ── Subagents: every agent listed (finished ones for two minutes), a block each ──
  const rows = orderAgents(agents)
  const sessionTotal = sessionTokens(s)
  const agentRows = rows.slice(0, MAX_AGENT_ROWS).flatMap(({ agent, depth }, i) => {
    const indent = '  '.repeat(depth + 1)
    const warn = agentWarning(agent, s.isSubagentModelForced)
    const facts = subagentFacts(agent, s.now, sessionTotal, indent)
    return [
      i > 0 && gap(),
      // The first row is the pressable one: state, type and what the agent was asked.
      <Button key={`agent:${agent.id}`} plain onPress={() => actions.openAgent(agent.id)}>
        {spanNodes(
          ui,
          truncateSpans(
            [
              agentIcon(agent),
              sp(' '),
              sp(depth > 0 ? `${'  '.repeat(depth - 1)}└ ${agent.type}` : agent.type, undefined, agent.status === 'running'),
              ...(agent.description ? [dim(`  ${agent.description}`)] : []),
            ],
            width,
          ),
        )}
      </Button>,
      <Box justifyContent="space-between">
        {line(ui, facts.left)}
        {line(ui, facts.right)}
      </Box>,
      warn !== undefined && line(ui, [sp(`${indent}⚠ ${warn}`, COLORS.yellow)]),
      ...subagentDetails(agent, indent, width).map(spans => line(ui, spans)),
    ]
  })
  // HISTORY: the agents that left the list, newest first, behind a toggle (collapsed by default)
  const history = s.history ?? []
  const isHistoryOpen = s.isHistoryOpen === true
  const historyBlock: Block[] =
    history.length === 0
      ? []
      : [
          [
            gap(),
            <Button key="history" plain onPress={() => actions.toggleHistory()}>
              <Text color={COLORS.title}>{`${S.historyTitle} · ${history.length} ${isHistoryOpen ? '▾' : '▸'}`}</Text>
            </Button>,
            isHistoryOpen && gap(),
            isHistoryOpen &&
              history.slice(0, MAX_HISTORY_ROWS).map(h => agentButton(`history:${h.id}`, { ...h, status: 'done' }, 0)),
            isHistoryOpen && history.length > MAX_HISTORY_ROWS && line(ui, [dim(`… +${history.length - MAX_HISTORY_ROWS}`)]),
          ],
        ]
  const agentBlocks: Block[] = [
    [
      gap(),
      title(S.subagentsTitle(running.length), modelCounts(agents)),
      rows.length > 0 && gap(),
      agentRows,
      rows.length > MAX_AGENT_ROWS && line(ui, [dim(`… +${rows.length - MAX_AGENT_ROWS}`)]),
    ],
    ...historyBlock,
  ]

  // ── Context: the breakdown by category, the biggest static consumers, the skills invoked, the rounds ──
  const context = s.context
  const rounds = s.ctxRounds ?? []
  const hint = shouldCompact({ percent: s.ctx.percent, rounds, forecast })
  const breakdownBlock: Block = [
    gap(),
    title(context ? `${S.contextTitle} · ${abbrevTokens(context.total, true)}/${abbrevTokens(context.max, true)}` : S.contextTitle, context ? [dim(context.isExact ? S.exact : context.rows.some(r => r.isExact) ? S.someExact : S.estimate)] : []),
    gap(),
    hint && line(ui, [sp(S.worthCompacting, COLORS.yellow)]),
    ...(context ? [line(ui, contextBar(context, width)), ...categoryRows(context, width).map(spans => line(ui, spans))] : [line(ui, [dim(S.noReading)])]),
    gap(),
    <Button key="ctx:exact" onPress={() => actions.countExact()}>
      {S.buttons.exactCount}
    </Button>,
  ]
  const consumersBlock: Block =
    context && context.consumers.length > 0
      ? [gap(), title(S.consumersTitle(context.consumers.length)), gap(), context.consumers.map(c => line(ui, consumerSpans(c, width)))]
      : []
  const skillsUsed = s.skillsUsed ?? []
  const skillsBlock: Block =
    skillsUsed.length > 0 || context?.skills
      ? [
          gap(),
          title(S.skillsTitle(skillsUsed.length), context?.skills ? [dim(S.skillsListed(context.skills.listed, context.skills.total))] : []),
          skillsUsed.length > 0 && gap(),
          skillsUsed.slice(0, MAX_SKILL_ROWS).map(name => line(ui, [sp(truncEnd(name, width))])),
          skillsUsed.length > MAX_SKILL_ROWS && line(ui, [dim(`… +${skillsUsed.length - MAX_SKILL_ROWS}`)]),
        ]
      : []
  const first = rounds[0]
  const last = rounds.at(-1)
  const roundsBlock: Block =
    first !== undefined && last !== undefined
      ? [
          gap(),
          title(S.trendTitle(rounds.length)),
          gap(),
          line(ui, [sp(sparkline(rounds), ctxColor(s.ctx.percent ?? 0)), dim(`  ${abbrevTokens(first)} → ${abbrevTokens(last)}`)]),
        ]
      : []
  const contextBlocks: Block[] = [breakdownBlock, consumersBlock, skillsBlock, roundsBlock].filter(b => b.length > 0)

  // ── Work, per agent: the main one, the workflow in flight, each running subagent, the hooks that fired ──
  const counts = taskCounts(s)
  const open = openTasks(s)
  const taskPart: Block =
    counts === null
      ? []
      : [
          gap(),
          title(`${S.taskTitle} · ${counts.done}/${counts.total}`, [
            sp(`◐ ${counts.inProgress}`, COLORS.blue),
            sp('  '),
            dim(`○ ${counts.pending}`),
            sp('  '),
            sp(`✓ ${counts.done}`, COLORS.green),
          ]),
          gap(),
          line(ui, taskBarCells(width, counts.done, counts.inProgress, counts.total)),
          open.slice(0, MAX_TASK_ROWS).map(task => line(ui, taskRow(task, s.now, width))),
          open.length > MAX_TASK_ROWS && line(ui, [dim(`… +${open.length - MAX_TASK_ROWS}`)]),
          counts.done > 0 && line(ui, [sp('✓', COLORS.green), dim(S.tasksDone(counts.done))]),
        ]
  const worklogPart: Block = wlRows.length > 0 ? [gap(), wlRows.map(text => line(ui, [sp('● ', COLORS.yellow), sp(text, COLORS.yellow)]))] : []

  // The deliver perimeter: its entries, the files touched since HEAD and the ones outside it (none claimed when git could not say)
  const check = s.perimeterCheck
  const outside = check?.outside ?? []
  const perimeterPart: Block =
    s.perimeter === undefined
      ? []
      : [
          gap(),
          line(ui, [
            dim(S.perimeter(s.perimeter.length)),
            ...(check ? [dim(S.filesTouched(check.files))] : []),
          ]),
          check && (outside.length === 0
            ? line(ui, [sp('✓ ', COLORS.green), dim(S.noFileOutside)])
            : line(ui, [sp(S.filesOutside(outside.length), COLORS.red)])),
          outside.slice(0, MAX_OUTSIDE_ROWS).map(file => line(ui, [sp(`  ${truncMiddle(file, Math.max(4, width - 2))}`, COLORS.yellow)])),
          outside.length > MAX_OUTSIDE_ROWS && line(ui, [dim(`  … +${outside.length - MAX_OUTSIDE_ROWS}`)]),
        ]
  const principalBlock: Block[] =
    perimeterPart.length + taskPart.length + worklogPart.length > 0
      ? [[gap(), title(S.mainTitle), ...perimeterPart, ...taskPart, ...worklogPart]]
      : []

  // The workflow in flight: its name (from the last stop) and the agents of the run finished out of those seen starting. The engine
  // does not expose a phase, a round or P1/P2 counts: they are not drawn.
  const runAgents = s.workflowRun?.agents ?? []
  const isWorkflowActive = s.workflow !== undefined || runAgents.some(a => !a.isDone)
  const workflowBlock: Block[] = isWorkflowActive
    ? [
        [
          gap(),
          title(s.workflow === undefined ? S.workflowTitle : `${S.workflowTitle} · ${truncMiddle(s.workflow, Math.max(4, width - textCells(S.workflowTitle) - 3))}`),
          runAgents.length > 0 && gap(),
          runAgents.length > 0 && line(ui, [dim(S.workflowAgents), sp(`${runAgents.filter(a => a.isDone).length}/${runAgents.length}`, COLORS.blue)]),
        ],
      ]
    : []

  // One block per running subagent (a workflow's agents are the workflow's); the tool line only once a tool call was seen
  const inWorkflow = new Set(runAgents.map(a => a.id))
  const workers = running.filter(a => !inWorkflow.has(a.id))
  const subagentBlocks: Block[] = workers.slice(0, MAX_SUBAGENT_BLOCKS).map((a, i) => [
    gap(),
    title(truncMiddle(a.type, Math.max(4, width - 7)), [dim(duration(s.now - a.startedAt))]),
    a.description ? line(ui, [sp(truncEnd(a.description, width))]) : undefined,
    a.lastTool ? line(ui, truncateSpans([dim(S.lastTool), sp(a.lastTool)], width)) : undefined,
    i === MAX_SUBAGENT_BLOCKS - 1 && workers.length > MAX_SUBAGENT_BLOCKS && line(ui, [dim(`… +${workers.length - MAX_SUBAGENT_BLOCKS}`)]),
  ])

  // The hooks that fired: the last done-claim entries
  const claims = s.doneClaims ?? []
  const claimsBlock: Block[] =
    claims.length > 0
      ? [
          [
            gap(),
            title(S.hookTitle),
            gap(),
            claims.map(c => line(ui, [dim(`${claimTime(c.at)} `), sp(c.rule, COLORS.yellow), ...(c.excerpt ? [dim(` ${c.excerpt}`)] : [])])),
          ],
        ]
      : []
  // The changed files (the branch and its upstream are in the header). A changed file is a Button: a press draws its diff in the second pane.
  const repo = s.repo
  const changesPart: Block = repo
    ? [
        gap(),
        title(`${S.changesTitle} · ${repo.total}`),
        gap(),
        repo.files.length === 0
          ? line(ui, [dim(S.noChanges)])
          : repo.files.slice(0, MAX_FILE_ROWS).map(c => (
              <Button key={`file:${c.path}`} plain onPress={() => actions.openDiff(c)}>
                {spanNodes(ui, changeSpans(c, width))}
              </Button>
            )),
        repo.total > MAX_FILE_ROWS && line(ui, [dim(`… +${repo.total - MAX_FILE_ROWS}`)]),
      ]
    : []

  // The pull requests of this chat, the newest first: the number is a link when the CLI gave an address.
  const prs = [...(s.prs ?? [])].reverse()
  const prRow = (pr: CockpitPr) => (
    <Text wrap="truncate">
      {pr.url !== undefined ? <Link href={pr.url}>{`#${pr.number}`}</Link> : <Text>{`#${pr.number}`}</Text>}
      {spanNodes(ui, prSpans(pr, width))}
    </Text>
  )
  const prPart: Block =
    prs.length > 0
      ? [
          gap(),
          title(`${S.prTitle} · ${prs.length}`),
          gap(),
          prs.slice(0, MAX_PR_ROWS).flatMap(pr => {
            const detail = prDetailSpans(pr, '  ', width)
            return [prRow(pr), ...(detail.length > 0 ? [line(ui, detail)] : [])]
          }),
          prs.length > MAX_PR_ROWS && line(ui, [dim(`… +${prs.length - MAX_PR_ROWS}`)]),
        ]
      : []

  // The main loop's last tools, the newest first.
  const calls = [...(s.calls ?? [])].reverse()
  const toolsPart: Block = calls.length > 0 ? [gap(), title(`${S.toolTitle} · ${calls.length}`), gap(), calls.map(c => line(ui, toolCallSpans(c, width)))] : []
  const workBlocks: Block[] = [...principalBlock, changesPart, prPart, toolsPart, ...workflowBlock, ...subagentBlocks, ...claimsBlock].filter(b => b.length > 0)

  // System: what the monitor child prints, drawn while the tab is selected; none yet reads as such, a part it cannot read says so. Every
  // process is listed (the pane's own window scrolls what the height cannot show); a listening port is a link to it on localhost.
  const sys = s.system
  const procs = sys?.procs ?? []
  const procRow = (p: CockpitSysProc) => {
    const { head, ports, more } = procParts(p, width)
    return (
      <Text wrap="truncate">
        {spanNodes(ui, head)}
        {ports.flatMap(port => [<Text> </Text>, <Link href={`http://localhost:${port}`}>{`:${port}`}</Link>])}
        {more && <Text dimColor> …</Text>}
      </Text>
    )
  }
  const systemBlocks: Block[] =
    sys === undefined
      ? [[gap(), title(S.systemTitle), gap(), line(ui, [dim(S.reading)])]]
      : [
          [gap(), title(S.systemTitle), gap(), systemMetricRows(sys, width).map(spans => line(ui, spans)), line(ui, diskPowerSpans(sys, width))],
          ...(sys.off.includes('procs') || sys.procs
            ? [
                [
                  gap(),
                  title(sys.procs ? `${S.processesTitle} · ${procs.length}` : S.processesTitle),
                  gap(),
                  sys.procs ? (procs.length === 0 ? line(ui, [dim(S.noChildProcess)]) : procs.map(procRow)) : line(ui, [dim(S.unavailable)]),
                ],
              ]
            : []),
        ]

  // Notes: the field and `save` first, then the saved notes (the first line of each) with their buttons; the field is left out where the surface has none.
  const notes = s.notes ?? []
  const noteButtons = [S.buttons.edit, S.buttons.send, S.buttons.delete]
  const noteRow = (n: CockpitNote) => (
    <Box flexDirection="column">
      <Text wrap="truncate">{n.text.replace(/\s*\n\s*/g, ' ')}</Text>
      <Box flexDirection={buttonRowWidth(noteButtons) <= width ? 'row' : 'column'} alignItems="flex-start" columnGap={BUTTON_GAP}>
        <Button key={`note:edit:${n.id}`} onPress={() => actions.editNote(n.id)}>
          {S.buttons.edit}
        </Button>
        <Button key={`note:send:${n.id}`} onPress={() => actions.sendNote(n.id)}>
          {S.buttons.send}
        </Button>
        <Button key={`note:delete:${n.id}`} onPress={() => actions.deleteNote(n.id)}>
          {S.buttons.delete}
        </Button>
      </Box>
    </Box>
  )
  const notesBlocks: Block[] = [
    [
      gap(),
      title(S.notesTitle(notes.length)),
      gap(),
      Input && (
        <Input key="note" rows={2} placeholder={S.notePlaceholder} value={s.noteDraft ?? ''} submitLabel={S.buttons.save} onInput={value => actions.setNoteDraft(value)} onSubmit={value => actions.saveNote(value)} />
      ),
      Input && (
        <Button key="note:save" onPress={() => actions.saveNote()}>
          {S.buttons.save}
        </Button>
      ),
      ...(notes.length > 0 ? [gap(), notes.flatMap((n, i) => [i > 0 && gap(), noteRow(n)])] : [gap(), line(ui, [dim(S.noNotes)])]),
    ],
  ]

  // Blocks are told apart by a rule; an empty tab says so.
  const blocks: Block[] = { agents: agentBlocks, context: contextBlocks, work: workBlocks, system: systemBlocks, notes: notesBlocks }[tab]
  const body: Node[] = blocks.length > 0 ? blocks.flatMap((block, i) => [...(i > 0 ? [rule] : []), ...block.flat()]) : [gap(), line(ui, [dim(S.nothingToShow)])]

  return (
    <Box flexDirection="column" width={block} paddingX={PANE_PADDING_X} minHeight={bodyRows} marginLeft={bodyColumns - block}>
      {headerRows}
      {rule}
      {tabBar}
      {rule}
      {body}
      {/* The spacer takes what the tab leaves of the pane height: the buttons sit on its last row, or follow a taller tab. */}
      <Box flexGrow={1} />
      {rule}
      {buttonsRow}
    </Box>
  )
}
