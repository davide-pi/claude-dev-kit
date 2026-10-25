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
  CockpitProcSort,
  CockpitSnapshot,
  CockpitSysProc,
  CockpitSystem,
  CockpitTab,
  CockpitTask,
  CockpitToolCall,
} from '../types'
import {
  AGENT_KEEP_MS,
  CALLS_SHOWN,
  COLORS,
  ICONS,
  REFRESH_COOLDOWN_MS,
  TABS,
  TAB_ICONS,
  abbrevTokens,
  aheadBehindSpans,
  almText,
  autocompactForecast,
  barCells,
  baseName,
  cacheColor,
  claimTime,
  claimsOf,
  claudeStateSpans,
  countdown,
  ctxColor,
  ctxGrowth,
  displayModel,
  duration,
  effortGlyph,
  fmtCost,
  fmtBytes,
  fmtCostDelta,
  folderIcon,
  gridWidths,
  hhmm,
  insightHints,
  modelFamily,
  openTasks,
  parseReset,
  pctCell,
  rateColor,
  shortModel,
  shouldCompact,
  signedPctCell,
  sortProcs,
  spanWidth,
  padCells,
  rangeSparkline,
  repoRelative,
  shade,
  textCells,
  timeSplit,
  sessionTokens,
  sparkline,
  taskBarCells,
  tokenShare,
  truncEnd,
  truncMiddle,
  truncateSpans,
  weeklyPace,
  withBackground,
  worklogLabel,
} from './format'
import type { CockpitHint, ModelFamily, Span } from './format'
import { t } from './strings'

/** The elements the views draw with; every surface's table has them. */
export type Ui = Pick<Elements[RenderSurface], 'Box' | 'Text' | 'Button' | 'Code' | 'Link'> & {
  /** Every surface but the mobile app's draws a text field: there the note is left out. */
  Input?: Elements['terminal']['Input']
}

const CTX_TEXT_MIN = '100% 999K/1M +99K'.length
const FIVE_HOURS = 18000
const SEVEN_DAYS = 604800
/** Cells a terminal Button adds around its label (`[ label ]`), and between two of a row. */
const BUTTON_CHROME = 4
const BUTTON_GAP = 1
/** The context fill from which the header warns. */
const CTX_WARN_PCT = 80
const ALM_LABEL = 'ALM '
const MAX_TASK_ROWS = 6
const MAX_OUTSIDE_ROWS = 5
const TASK_TIME_W = 6
const MAX_FILE_ROWS = 8
/** Cells before a changed file's path: the added column, the deleted one and their gaps. */
const CHANGE_COUNTS_W = 12
const MAX_PR_ROWS = 4
/** Cells of a process row's columns: pid, name (at most), CPU, RAM and the ports' header (` PORTS`). */
const SYS_PID_W = 6
const SYS_NAME_W = 14
const SYS_CPU_W = 4
const SYS_RAM_W = 6
const SYS_PORTS_W = 6
/** The most bars the Context trend line draws before its text, and the most lines a note shows before `▸ +N lines`. */
const TREND_BARS_MAX = 8
const NOTE_LINES_SHOWN = 3
/** The height of the note field: multi-line notes are common. */
const NOTE_INPUT_ROWS = 6
/** Cells of a tool row: the tool's name, and the time it started (`HH:MM`). */
const CALL_TOOL_W = 7
const CALL_TIME_W = 5
/** Cells of a largest result's tokens (`+38k`). */
const GREW_TOKENS_W = 6
const MAX_SKILL_ROWS = 6
/** The Insights tab: the cells of a row's label, and the tool types listed. */
const INSIGHT_LABEL_W = 13
const MAX_TOOL_TYPES = 6
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
    <Text color={s.c} backgroundColor={s.bg} dimColor={s.dim} weight={s.bold ? 'bold' : undefined}>
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

/** One changed file's row: its added and deleted lines (`bin` for a binary file, `?` for an untracked one), then its path cut to fit, and `●` after it when this chat edited the file. */
export function changeSpans(c: CockpitChange, width: number, isEdited = false): Span[] {
  const counts: Span[] = c.isUntracked
    ? [dim(padStart('?', 5)), sp(' '.repeat(6))]
    : c.isBinary
      ? [dim(padStart('bin', 5)), sp(' '.repeat(6))]
      : [sp(padStart(`+${c.added ?? 0}`, 5), COLORS.green), sp(' '), sp(padStart(`-${c.deleted ?? 0}`, 5), COLORS.red)]
  const pathW = Math.max(4, width - CHANGE_COUNTS_W - (isEdited ? 2 : 0))
  return [...counts, sp(' '), sp(truncMiddle(c.path, pathW)), ...(isEdited ? [sp(' ●', COLORS.lavender)] : [])]
}

/** One of the largest results: the tool, its short argument cut to fit, and the result's estimated tokens. */
export function bigResultSpans(r: { tool: string; arg?: string; tokens: number }, width: number): Span[] {
  const argW = Math.max(0, width - CALL_TOOL_W - 1 - 1 - GREW_TOKENS_W)
  return [
    sp(padCells(truncEnd(r.tool, CALL_TOOL_W), CALL_TOOL_W)),
    sp(' '),
    dim(padCells(truncEnd(r.arg ?? '', argW), argW)),
    sp(' '),
    sp(padStart(`+${abbrevTokens(r.tokens)}`, GREW_TOKENS_W), COLORS.yellow),
  ]
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
 * One category row, exactly `width` cells: a square in the bar color, its name cut to fit, its tokens and its share of the window; a `✓`
 * when the tokens are an exact count kept from earlier and the change of the last round (`+12k`, blank when it did not move). The first
 * cells, in proportion to the share of the window, sit on the `bg` background: the row carries its own bar.
 */
export function categorySpans(r: CockpitContextRow, color: string, bg: string, max: number, width: number): Span[] {
  const nameW = Math.max(4, width - 2 - CTX_TOKENS_W - CTX_SHARE_W - CTX_MARK_W - CTX_DELTA_W)
  const share = max > 0 ? `${Math.round((100 * r.tokens) / max)}%` : ''
  const delta = r.delta ? padStart(`${r.delta > 0 ? '+' : '−'}${abbrevTokens(Math.abs(r.delta))}`, CTX_DELTA_W) : ' '.repeat(CTX_DELTA_W)
  const row = [
    sp('■', color),
    sp(' '),
    sp(padCells(truncEnd(t().contextCategories[r.name] ?? r.name, nameW), nameW)),
    sp(padStart(abbrevTokens(r.tokens), CTX_TOKENS_W)),
    dim(padStart(share, CTX_SHARE_W)),
    r.isExact ? sp(' ✓', COLORS.green) : dim('  '),
    dim(delta),
  ]
  return withBackground(row, r.tokens > 0 && max > 0 ? Math.max(1, Math.round((width * r.tokens) / max)) : 0, bg)
}

/** The rows of the table, in the order the reading holds them (biggest first): the categories inside the window (a deferred one is outside it), colored as the bar colors them. */
export function categoryRows(c: CockpitContext, width: number): Span[][] {
  let n = 0
  return c.rows.flatMap(r => {
    if (r.kind === 'deferred') return []
    const color = r.kind === 'free' ? COLORS.empty : r.kind === 'buffer' ? COLORS.dim : (CATEGORY_COLORS[n++ % CATEGORY_COLORS.length] ?? COLORS.gray)
    // the free space is drawn from a dim gray, whose own square is nearly invisible
    return [categorySpans(r, color, shade(r.kind === 'free' ? COLORS.gray : color, r.kind === 'free' ? 0.2 : 0.32), c.max, width)]
  })
}

/**
 * The context's trend as one line: the last rounds as bars (as many as fit before the text, at most eight, none under two) then where the
 * context went, how fast it grows per round and in how many rounds auto-compaction comes (`forecast`); cut to `width`. Empty without a round.
 */
export function trendSpans(rounds: readonly number[], growth: number | undefined, forecast: number | undefined, color: string, width: number): Span[] {
  const first = rounds[0]
  const last = rounds.at(-1)
  if (first === undefined || last === undefined) return []
  const text = t().trendLine(abbrevTokens(first), abbrevTokens(last), growth === undefined ? undefined : abbrevTokens(Math.round(growth)), forecast)
  const bars = Math.min(rounds.length, TREND_BARS_MAX, width - 2 - textCells(text))
  return truncateSpans([...(bars >= 2 ? [sp(rangeSparkline(rounds.slice(-bars)), color), sp('  ')] : []), sp(text)], width)
}

/** A static consumer row: its kind, its name cut to fit, its tokens. */
export function consumerSpans(c: CockpitConsumer, width: number): Span[] {
  const nameW = Math.max(4, width - CONSUMER_KIND_W - 1 - CTX_TOKENS_W)
  return [dim(pad(t().consumerKinds[c.kind], CONSUMER_KIND_W)), sp(' '), sp(padCells(truncMiddle(c.name, nameW), nameW)), sp(padStart(abbrevTokens(c.tokens), CTX_TOKENS_W))]
}

/** The text of an Insights hint. */
function hintText(h: CockpitHint): string {
  const S = t().hints
  switch (h.kind) {
    case 'rereads':
      return S.rereads(h.file, h.count)
    case 'coldCache':
      return S.coldCache
    case 'failures':
      return S.failures(h.count)
    case 'subagents':
      return S.subagents(h.share)
    case 'longRound':
      return S.longRound(duration(h.ms))
  }
}

/** The color of a load in percent: green, yellow from 60, red from 85. */
const loadColor = (pct: number): string => (pct >= 85 ? COLORS.red : pct >= 60 ? COLORS.yellow : COLORS.green)

/** The System tab's first numbers, one item each: CPU, RAM and network; a part that could not be read says so, one not read yet draws `…`. */
function usageItems(sys: CockpitSystem): Span[][] {
  const item = (label: string, isOff: boolean, value: Span[]): Span[] => [dim(`${label} `), ...(isOff ? [dim(t().unavailable)] : value)]
  const cpu = sys.cpu.at(-1)
  const ram = sys.ram.at(-1)
  const rx = sys.rx.at(-1)
  const tx = sys.tx.at(-1)
  return [
    item('CPU', sys.off.includes('cpu'), cpu === undefined ? [dim('…')] : [sp(`${Math.round(cpu)}%`, loadColor(cpu), true)]),
    item('RAM', sys.off.includes('ram'), ram === undefined ? [dim('…')] : [sp(`${ram}%`, loadColor(ram), true)]),
    item('NET', sys.off.includes('net'), rx === undefined || tx === undefined ? [dim('…')] : [dim('↓'), sp(`${fmtBytes(rx)}/s`), dim(' ↑'), sp(`${fmtBytes(tx)}/s`)]),
  ]
}

/** The free room of the working directory's drive, with its icon. */
function diskSpans(sys: CockpitSystem): Span[] {
  const { disk } = sys
  if (sys.off.includes('disk')) return [dim(`${ICONS.disk} `), dim(t().unavailable)]
  if (!disk) return [dim(`${ICONS.disk} `), dim('…')]
  const color = disk.total > 0 && disk.free / disk.total < 0.1 ? COLORS.red : disk.total > 0 && disk.free / disk.total < 0.2 ? COLORS.yellow : undefined
  return [dim(`${ICONS.disk} `), sp(`${disk.label ? `${disk.label} ` : ''}${fmtBytes(disk.free)} ${t().diskFree}`, color)]
}

/** The System tab's two rows of numbers, one item each (the pane lays an item out beside the last, wrapping where they do not fit): CPU, RAM and network; the disk. */
export const systemRowItems = (sys: CockpitSystem): Span[][][] => [usageItems(sys), [diskSpans(sys)]]

/** A CPU share in its cell: a tenth under 10 %, whole above (`0.4%`, `12%`); empty until two reads gave one. */
const cpuCell = (cpu: number | undefined): string => (cpu === undefined ? '' : cpu >= 10 ? `${Math.round(cpu)}%` : `${cpu.toFixed(1)}%`)

/** The width of a process row's name column: what the width leaves after the other columns, at most `SYS_NAME_W`. */
const procNameWidth = (width: number): number => Math.max(4, Math.min(SYS_NAME_W, width - (SYS_PID_W + SYS_CPU_W + SYS_RAM_W + SYS_PORTS_W + 3)))

/**
 * The process table's header, in the columns `procParts` draws: `PID NAME` before the CPU and RAM cells (which the pane makes buttons: the
 * press sorts by that column, and the sorted one carries a `▾`), then `PORTS`. The cells are the label padded to their column.
 */
export function procHeader(sort: CockpitProcSort, width: number): { start: Span[]; cpu: string; ram: string; ports: Span[] } {
  const H = t().procHeader
  const nameW = procNameWidth(width)
  const mark = (by: CockpitProcSort, label: string) => padStart(sort === by ? `${label}▾` : label, by === 'cpu' ? SYS_CPU_W : SYS_RAM_W)
  return {
    start: [dim(padStart(H.pid, SYS_PID_W)), sp(' '), dim(padCells(H.name, nameW)), sp(' ')],
    cpu: mark('cpu', H.cpu),
    ram: mark('ram', H.ram),
    ports: truncateSpans([sp(' '), dim(H.ports)], Math.max(0, width - (SYS_PID_W + 1 + nameW + 1 + SYS_CPU_W + 1 + SYS_RAM_W))),
  }
}

/**
 * One row of the process table: pid, name (cut to what the width leaves), CPU, RAM, then the ports that fit after them (each is a link the
 * pane draws); `more` when a port was left out for lack of room. The head is cut to `width`.
 */
export function procParts(p: CockpitSysProc, width: number): { head: Span[]; ports: number[]; more: boolean } {
  const nameW = procNameWidth(width)
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
  /** Asks for the exact count of the context breakdown (`full`: it spends token-count requests): the Context tab's `refresh`, once a minute. */
  refresh: () => void
  /** Opens or closes the four token counters of an agent. */
  toggleUsage: (agentId: string) => void
  /** Opens or closes a note beyond its first lines. */
  toggleNote: (id: number) => void
  /** Sorts the process table by the column pressed. */
  sortProcs: (by: CockpitProcSort) => void
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
  // a right side that does not fit beside its title goes under it
  const title = (label: string, right: Span[] = []) => (
    <Box justifyContent="space-between" flexDirection={textCells(label) + 1 + spanWidth(right) <= width ? 'row' : 'column'}>
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
      <Text wrap="truncate">{spanNodes(ui, agentRow(a, depth, s.now, width))}</Text>
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

  // ── Tab bar: the selected tab is the primary button with its name, the others show their icon; a hover shows every name ──
  const tabButton = (id: CockpitTab, hasDot = false, count = 0) => {
    const isSelected = tab === id
    const label = `${isSelected ? `${TAB_ICONS[id]} ${S.tabs[id]}` : TAB_ICONS[id]}${count > 0 ? ` ${count}` : ''}`
    const variant = isSelected ? 'primary' : 'secondary'
    const button = hasDot ? (
      <Button key={`tab:${id}`} variant={variant} onPress={() => actions.selectTab(id)}>
        {label}
        <Text color={COLORS.yellow}> ●</Text>
      </Button>
    ) : (
      <Button key={`tab:${id}`} variant={variant} label={label} onPress={() => actions.selectTab(id)} />
    )
    // The tooltip hangs from the row under the button; the last tabs anchor it to their right edge so it stays inside the pane.
    const anchor = TABS.indexOf(id) < TABS.length - 2 ? { left: 0 } : { right: 0 }
    return (
      <Box key={`tip:${id}`}>
        {button}
        <Box position="absolute" top={1} {...anchor} display="none" hover={{ display: 'flex' }}>
          <Text color={COLORS.text} backgroundColor={COLORS.rule}>{` ${S.tabs[id]} `}</Text>
        </Box>
      </Box>
    )
  }
  const tabBar = (
    <Box columnGap={1} flexWrap="wrap">
      {tabButton('agents', false, running.length)}
      {tabButton('context')}
      {tabButton('work', wlRows.length > 0)}
      {tabButton('insights')}
      {tabButton('system')}
      {tabButton('notes')}
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
  const agentRows = rows.flatMap(({ agent, depth }, i) => {
    const indent = '  '.repeat(depth + 1)
    const warn = agentWarning(agent, s.isSubagentModelForced)
    const isUsageOpen = s.usageOpen?.includes(agent.id) === true
    return [
      i > 0 && gap(),
      // The first row is the pressable one: state, type and what the agent was asked. Every row is one cut line, never wrapped.
      <Button key={`agent:${agent.id}`} plain onPress={() => actions.openAgent(agent.id)}>
        <Text wrap="truncate">
          {spanNodes(
            ui,
            truncateSpans(
              [
                agentIcon(agent),
                sp(' '),
                sp(depth > 0 ? `${'  '.repeat(depth - 1)}└ ${agent.type}` : agent.type, undefined, agent.status === 'running'),
                ...(agent.description ? [dim(`  ${agent.description.replace(/\s+/g, ' ')}`)] : []),
              ],
              width,
            ),
          )}
        </Text>
      </Button>,
      line(ui, subagentFacts(agent, s.now, sessionTotal, indent, width)),
      warn !== undefined && line(ui, [sp(`${indent}⚠ ${warn}`, COLORS.yellow)]),
      agent.usage && (
        <Button key={`usage:${agent.id}`} plain onPress={() => actions.toggleUsage(agent.id)}>
          <Text wrap="truncate" color={COLORS.title}>{`${indent}${isUsageOpen ? '▾' : '▸'} ${S.tokensToggle}`}</Text>
        </Button>
      ),
      ...subagentDetails(agent, indent, width, isUsageOpen).map(spans => line(ui, spans)),
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
            isHistoryOpen && history.map(h => agentButton(`history:${h.id}`, { ...h, status: 'done' }, 0)),
          ],
        ]
  const agentBlocks: Block[] = [
    [
      gap(),
      line(ui, fitPair([sp(S.subagentsTitle(running.length), COLORS.title)], modelCounts(agents), width)),
      rows.length > 0 && gap(),
      agentRows,
    ],
    ...historyBlock,
  ]

  // ── Context: the breakdown by category, the biggest static consumers, the skills invoked, the rounds ──
  const context = s.context
  const rounds = s.ctxRounds ?? []
  const hint = shouldCompact({ percent: s.ctx.percent, rounds, forecast })
  // `refresh` is an exact count and waits a minute from its press: a countdown stands in for the button meanwhile
  const wait = s.refreshedAt === undefined ? 0 : Math.min(REFRESH_COOLDOWN_MS, s.refreshedAt + REFRESH_COOLDOWN_MS - s.now)
  const refreshRow =
    wait > 0 ? (
      line(ui, [dim(S.refreshIn(Math.ceil(wait / 1000)))])
    ) : (
      <Button key="ctx:refresh" onPress={() => actions.refresh()}>
        {S.buttons.refresh}
      </Button>
    )
  const breakdownBlock: Block = [
    gap(),
    title(context ? `${S.contextDetailsTitle} · ${abbrevTokens(context.total, true)}/${abbrevTokens(context.max, true)}` : S.contextDetailsTitle, context ? [dim(context.isExact ? S.exact : context.rows.some(r => r.isExact) ? S.someExact : S.estimate)] : []),
    gap(),
    hint && line(ui, [sp(S.worthCompacting, COLORS.yellow)]),
    ...(context ? [line(ui, contextBar(context, width)), ...categoryRows(context, width).map(spans => line(ui, spans))] : [line(ui, [dim(S.noReading)])]),
    gap(),
    refreshRow,
  ]
  const consumersBlock: Block =
    context && context.consumers.length > 0
      ? [gap(), title(S.consumersTitle(context.consumers.length)), gap(), context.consumers.map(c => line(ui, consumerSpans(c, width)))]
      : []
  const trend = trendSpans(rounds, ctxGrowth(s.ctxSamples), forecast, ctxColor(s.ctx.percent ?? 0), width)
  const roundsBlock: Block = trend.length > 0 ? [gap(), title(S.trendTitle(rounds.length)), gap(), line(ui, trend)] : []
  const contextBlocks: Block[] = [breakdownBlock, consumersBlock, roundsBlock].filter(b => b.length > 0)

  // ── Work: the ALM line, the main agent's perimeter, tasks and worklog, the branch, the changed files, the PRs ──
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

  // The hooks that fired: the last done-claim blocks of this session
  const claims = claimsOf(s.doneClaims, s.sessionId)
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
  // The files changed on the branch and not committed yet. A changed file is a Button: a press draws its diff in the second pane.
  const repo = s.repo
  const edited = new Set((s.edited ?? []).flatMap(p => repoRelative(s.git?.root, p) ?? []))
  const changesPart: Block = repo
    ? [
        gap(),
        title(`${S.changesTitle} · ${repo.total}`, edited.size > 0 ? [dim(S.editedHere)] : []),
        gap(),
        repo.files.length === 0
          ? line(ui, [dim(S.noChanges)])
          : repo.files.slice(0, MAX_FILE_ROWS).map(c => (
              <Button key={`file:${c.path}`} plain onPress={() => actions.openDiff(c)}>
                {spanNodes(ui, changeSpans(c, width, edited.has(c.path)))}
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

  // The ALM target of the folder (absent without a workspaces map, or a mapped root that names nothing)
  const almLine = s.alm ? almSpans(s.alm, width) : []
  const almPart: Block = almLine.length > 0 ? [gap(), line(ui, almLine)] : []

  // The branch: its upstream (or the lack of one), the commits since it left the default branch and the newest of them
  const commits = s.repo?.commits
  const branchPart: Block =
    g && !g.isDetached
      ? [
          gap(),
          title(S.branchTitle),
          gap(),
          line(ui, g.upstream === undefined ? [dim(S.noUpstream)] : [dim(S.upstream), sp(truncMiddle(g.upstream, Math.max(4, width - textCells(S.upstream) - 8))), ...aheadBehindSpans(g)]),
          commits && s.repo?.from !== undefined && line(ui, [sp(S.commitsFrom(commits.count, s.repo.from), COLORS.lavender)]),
          commits?.list.map(c => line(ui, [dim(`${c.hash} `), sp(truncEnd(c.subject, Math.max(4, width - textCells(c.hash) - 1)))])),
          commits && commits.count > commits.list.length && line(ui, [dim(`… +${commits.count - commits.list.length}`)]),
        ]
      : []
  const workBlocks: Block[] = [almPart, ...principalBlock, branchPart, changesPart, prPart].filter(b => b.length > 0)

  // ── Insights: what the main loop's events add up to ──
  const ins = s.insights
  const fact = (name: string, ...value: Span[]) => line(ui, [dim(pad(name, INSIGHT_LABEL_W)), ...value])
  const rhythmPart: Block =
    ins && ins.rounds > 0
      ? [
          gap(),
          title(S.rhythmTitle),
          gap(),
          fact(S.rhythm.rounds, sp(String(ins.rounds), undefined, true)),
          ins.usd > 0 && fact(S.rhythm.perRound, sp(fmtCost(ins.usd / ins.rounds), COLORS.yellow)),
          ins.costliest && fact(S.rhythm.costliest, sp(fmtCost(ins.costliest.usd), COLORS.yellow), dim(` · ${duration(ins.costliest.ms)}`)),
          fact(S.rhythm.compactions, sp(String(ins.compactions))),
          (ins.compactCtx ?? []).map((c, i) => fact(i === 0 ? S.rhythm.compactCtx : '', sp(`${abbrevTokens(c.before)} → ${c.after === undefined ? '…' : abbrevTokens(c.after)}`))),
        ]
      : []
  const spent = ins && timeSplit(ins)
  const timeRows = spent
    ? ([['model', spent.model, COLORS.blue], ['tools', spent.tools, COLORS.green], ['wait', spent.wait, COLORS.yellow]] as const).map(([key, ms, color]) =>
        fact(S.time[key], sp(padStart(`${Math.round((100 * ms) / spent.total)}%`, 4), color, true), dim(` ${duration(ms)}`)),
      )
    : []
  const timePart: Block = timeRows.length > 0 ? [gap(), title(S.timeTitle), gap(), timeRows] : []
  const toolList = Object.entries(ins?.tools ?? {}).sort((a, b) => b[1].calls - a[1].calls || a[0].localeCompare(b[0]))
  const totalCalls = toolList.reduce((n, [, v]) => n + v.calls, 0)
  const lastCalls = [...(s.calls ?? [])].reverse().slice(0, CALLS_SHOWN)
  const toolNameW = Math.max(8, width - 12)
  const toolsPart: Block =
    totalCalls > 0
      ? [
          gap(),
          title(S.toolsTitle(totalCalls)),
          gap(),
          toolList.slice(0, MAX_TOOL_TYPES).map(([name, v]) => line(ui, [sp(padCells(truncEnd(name, toolNameW), toolNameW)), sp(padStart(String(v.calls), 5)), ...(v.failed > 0 ? [sp(`  ✗ ${v.failed}`, COLORS.red)] : [])])),
          toolList.length > MAX_TOOL_TYPES && line(ui, [dim(`… +${toolList.length - MAX_TOOL_TYPES}`)]),
          lastCalls.length > 0 && gap(),
          lastCalls.length > 0 && line(ui, [dim(S.lastTools)]),
          lastCalls.map(c => line(ui, toolCallSpans(c, width))),
        ]
      : []
  const biggest = ins?.biggest ?? []
  const grewPart: Block = biggest.length > 0 ? [gap(), title(S.grewTitle), gap(), biggest.map(r => line(ui, bigResultSpans(r, width)))] : []
  const lastError = ins?.lastError
  const errorPart: Block = lastError
    ? [
        gap(),
        title(S.lastErrorTitle),
        gap(),
        line(ui, [sp('✗ ', COLORS.red), sp(padCells(truncEnd(lastError.tool, CALL_TOOL_W), CALL_TOOL_W)), sp(' '), dim(truncEnd(lastError.text, Math.max(0, width - 2 - CALL_TOOL_W - 1)))]),
      ]
    : []
  const shares = ins?.cacheShares ?? []
  const meanCache = shares.length > 0 ? Math.round(shares.reduce((a, b) => a + b, 0) / shares.length) : undefined
  const efficiencyPart: Block =
    meanCache !== undefined
      ? [
          gap(),
          title(S.efficiencyTitle),
          gap(),
          fact(S.efficiency.cacheHit, sp(pctCell(meanCache), cacheColor(meanCache), true), sp('  '), sp(sparkline(shares, 100), cacheColor(meanCache))),
        ]
      : []
  const hints = insightHints(s)
  const hintsPart: Block = hints.length > 0 ? [gap(), title(S.hintsTitle), gap(), hints.map(h => line(ui, truncateSpans([sp(hintText(h), COLORS.yellow)], width)))] : []
  const skillsUsed = s.skillsUsed ?? []
  const skillsPart: Block =
    skillsUsed.length > 0 || s.context?.skills
      ? [
          gap(),
          title(S.skillsTitle(skillsUsed.length), s.context?.skills ? [dim(S.skillsListed(s.context.skills.listed, s.context.skills.total))] : []),
          skillsUsed.length > 0 && gap(),
          skillsUsed.slice(0, MAX_SKILL_ROWS).map(name => line(ui, [sp(truncEnd(name, width))])),
          skillsUsed.length > MAX_SKILL_ROWS && line(ui, [dim(`… +${skillsUsed.length - MAX_SKILL_ROWS}`)]),
        ]
      : []
  const insightsBlocks: Block[] = [rhythmPart, timePart, toolsPart, grewPart, errorPart, efficiencyPart, hintsPart, skillsPart, ...claimsBlock].filter(b => b.length > 0)

  // System: what the monitor child prints, drawn while the tab is selected; none yet reads as such, a part it cannot read says so. Every
  // process is listed (the pane's own window scrolls what the height cannot show), by RAM unless the CPU header was pressed; a listening
  // port is a link to it on localhost.
  const sys = s.system
  const sort = s.procSort ?? 'ram'
  const procs = sortProcs(sys?.procs ?? [], sort)
  const header = procHeader(sort, width)
  const sortButton = (by: CockpitProcSort, label: string) => (
    <Button key={`proc:${by}`} plain onPress={() => actions.sortProcs(by)}>
      <Text color={sort === by ? COLORS.title : undefined} dimColor={sort !== by} weight={sort === by ? 'bold' : undefined}>
        {label}
      </Text>
    </Button>
  )
  const procTable = (
    <Box width={width}>
      <Text>{spanNodes(ui, header.start)}</Text>
      {sortButton('cpu', header.cpu)}
      <Text> </Text>
      {sortButton('ram', header.ram)}
      <Text>{spanNodes(ui, header.ports)}</Text>
    </Box>
  )
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
          [
            gap(),
            title(S.systemTitle),
            gap(),
            ...systemRowItems(sys).map(items => (
              <Box flexWrap="wrap" columnGap={2}>
                {items.map(item => line(ui, item))}
              </Box>
            )),
          ],
          ...(sys.off.includes('procs') || sys.procs
            ? [
                [
                  gap(),
                  title(sys.procs ? `${S.processesTitle} · ${procs.length}` : S.processesTitle),
                  gap(),
                  sys.procs ? (procs.length === 0 ? line(ui, [dim(S.noChildProcess)]) : [procTable, ...procs.map(procRow)]) : line(ui, [dim(S.unavailable)]),
                ],
              ]
            : []),
        ]

  // Notes: the field and `save` first, then the saved notes (the first lines of each, the rest one press away) with their buttons; the field is left out where the surface has none.
  const notes = s.notes ?? []
  const noteButtons = [S.buttons.edit, S.buttons.send, S.buttons.delete]
  const noteRow = (n: CockpitNote) => {
    const lines = n.text.trimEnd().split(/\r?\n/)
    const isOpen = s.notesOpen?.includes(n.id) === true
    const hidden = Math.max(0, lines.length - NOTE_LINES_SHOWN)
    return (
      <Box flexDirection="column">
        {(isOpen ? lines : lines.slice(0, NOTE_LINES_SHOWN)).map(text => line(ui, [sp(text === '' ? ' ' : text)]))}
        {hidden > 0 && (
          <Button key={`note:more:${n.id}`} plain onPress={() => actions.toggleNote(n.id)}>
            <Text color={COLORS.title}>{isOpen ? S.lessLines(hidden) : S.moreLines(hidden)}</Text>
          </Button>
        )}
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
  }
  const notesBlocks: Block[] = [
    [
      gap(),
      title(S.notesTitle(notes.length)),
      gap(),
      Input && (
        <Input key="note" rows={NOTE_INPUT_ROWS} placeholder={S.notePlaceholder} value={s.noteDraft ?? ''} submitLabel={S.buttons.save} onInput={value => actions.setNoteDraft(value)} onSubmit={value => actions.saveNote(value)} />
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
  const blocks: Block[] = { agents: agentBlocks, context: contextBlocks, work: workBlocks, insights: insightsBlocks, system: systemBlocks, notes: notesBlocks }[tab]
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
