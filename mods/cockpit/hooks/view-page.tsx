import type { CockpitHistoryEntry, CockpitLogEntry } from '../types'
import { addHistory, toHistory } from './agents'
import { andamento, spendSplit } from './andamento'
import { openTasks } from './context'
import { CENT, COLORS, abbrevTokens, barCells, clockTime, costCell, duration, fmtCost, padCells, shownTurnUsd, spanWidth, truncateSpans } from './shared'
import type { Span } from './shared'
import { signalSeverity, signalsOf } from './signals'
import type { Signal, SignalKind } from './signals'
import { t } from './strings'
import { agentIcon, orderAgents, pairRow, taskCounts, visibleAgents } from './view-agents'
import { BUTTON_GAP, dim, line, sp } from './view-base'
import { collapsible, makeAgentBlock, signalRow, workflowLine, worklogBehindRows } from './view-kit'
import type { Block, Kit } from './view-kit'

// ── The single page: four sections, each hidden when empty (ATTENZIONE says there is nothing to do) ──

/** ATTENZIONE and IN CORSO show this many rows; the rest sits behind a toggle so the footer stays in view. */
const MAX_ROWS = 5
/** ATTENZIONE also stops at this many drawn lines: a closed notification takes two (what, then what to do), so four of them fill it. */
const ATTENTION_LINES = 8
/** FATTO shows this many events; the rest sits behind its toggle. */
const DONE_ROWS = 5
/** Cells the caption of a bar takes, so the bar and its legend line up. */
const CAPTION_W = 9
/** A bar's parts beyond this many tools join "other". */
const TOP_TOOLS = 3
const COST_W = 7
/** The columns of ANDAMENTO's figures. */
const COLUMNS = 4
const MISSING = '—'

/** The notifications that cost money; every other kind that is not blocking comes after them. */
const COST_KINDS: readonly SignalKind[] = ['heavyAgent', 'opusReadOnly', 'bigResult', 'reread', 'coldAfterIdle', 'ctxGrowth']

const rankOf = (sig: Signal): number => (signalSeverity(sig) === 'block' ? 0 : COST_KINDS.includes(sig.kind) ? 1 : 2)

// ── ATTENZIONE ──

/** How many rows, each as tall as its entry of `lines`, fit in `maxRows` rows and `maxLines` drawn lines; the first row always shows. */
function rowsWithin(lines: readonly number[], maxRows: number, maxLines: number): number {
  let used = 0
  let n = 0
  for (const cost of lines) {
    if (n >= maxRows || (n > 0 && used + cost > maxLines)) break
    used += cost
    n++
  }
  return n
}

/** The live notifications, blocking first then cost then the rest, and the worklog behind; "nothing to do" when there is neither. */
export function attentionBlocks(k: Kit): Block[] {
  const { ui, s, title, actions } = k
  const { Box, Button } = ui
  const S = t()
  const signals = [...signalsOf(s)].sort((a, b) => rankOf(a) - rankOf(b))
  const rows: Block[] = signals.map(sig => signalRow(k, sig))
  const lines: number[] = rows.map(() => 2)

  const late = worklogBehindRows(k, n => S.worklog.withoutHours(n))
  if (late !== undefined) {
    const hasLog = s.sessionId !== undefined && !s.isWorklogSkillMissing
    // the toggle on the left, the button right-aligned on the same row
    rows.push([
      <Box justifyContent="space-between" columnGap={BUTTON_GAP}>
        {late.toggle}
        {hasLog && (
          <Box flexShrink={0}>
            <Button key="attention:worklog" onPress={() => actions.ask('worklog')}>
              {S.buttons.logHours}
            </Button>
          </Box>
        )}
      </Box>,
      late.days,
    ])
    lines.push(1)
  }

  if (rows.length === 0) return [[title(S.page.attention), line(ui, [sp('✓ ', COLORS.green), dim(S.page.nothingToDo)])]]
  return [[title(S.page.attention), collapsible(k, 'attention', rows, rowsWithin(lines, MAX_ROWS, ATTENTION_LINES), s.openKeys?.includes('attention') === true, () => actions.toggleOpen('attention'))]]
}

// ── ANDAMENTO ──

const PALETTE = [COLORS.blue, COLORS.green, COLORS.amber, COLORS.lavender, COLORS.yellow]

type BarPart = { label: string; pct: number; isOther?: boolean }

/** A bar behind its dim caption and the legend under it, from the first column: each part's glyph in its colour, its label and share in the text colour. */
function barRows(k: Kit, caption: string, parts: readonly BarPart[]): Block {
  const { ui, width } = k
  const colors = parts.map((p, i) => (p.isOther ? COLORS.gray : (PALETTE[i % PALETTE.length] ?? COLORS.blue)))
  const legend: Span[] = parts.flatMap((p, i) => [...(i > 0 ? [sp('  ')] : []), sp('▰ ', colors[i]), sp(`${p.label} ${Math.round(p.pct)}%`)])
  return [
    line(ui, [dim(padCells(caption, CAPTION_W)), ...barCells(Math.max(1, width - CAPTION_W), parts.map((p, i) => ({ pct: p.pct, color: colors[i] ?? COLORS.blue })))]),
    line(ui, truncateSpans(legend, width)),
  ]
}

/** The tools that filled the context, the biggest three and the rest as "other", by their share. */
function toolParts(byTool: Record<string, number> | undefined, other: string): BarPart[] {
  const tools = Object.entries(byTool ?? {}).filter(([, tokens]) => tokens > 0).sort((a, b) => b[1] - a[1])
  const total = tools.reduce((n, [, tokens]) => n + tokens, 0)
  if (total <= 0) return []
  const rest = tools.slice(TOP_TOOLS).reduce((n, [, tokens]) => n + tokens, 0)
  return [...tools.slice(0, TOP_TOOLS).map(([label, tokens]) => ({ label, pct: (100 * tokens) / total })), ...(rest > 0 ? [{ label: other, pct: (100 * rest) / total, isOther: true }] : [])]
}

/** A column of the figures: its dim label, its bold value (`—` where there is none) and its dim caption. */
type Column = { label: string; value?: Span[]; caption?: string }

/** The figures rows: the columns side by side, floor(width / 4) cells each, a cell cut to leave a space before the next. */
function figureRows(k: Kit, columns: readonly Column[]): Block {
  const { ui, width } = k
  const cells = Math.floor(width / COLUMNS)
  const row = (pick: (c: Column) => Span[]) =>
    line(ui, columns.flatMap(c => {
      const cut = truncateSpans(pick(c), cells - 1)
      return [...cut, sp(' '.repeat(cells - spanWidth(cut)))]
    }))
  return [row(c => [dim(c.label)]), row(c => c.value ?? [dim(MISSING)]), row(c => (c.caption ? [dim(c.caption)] : []))]
}

/** The last main round's duration: the newest round of the session log; none before one ended. */
const lastRoundMs = (s: Kit['s']): number | undefined =>
  (s.sessionLog ?? []).reduce<CockpitLogEntry | undefined>((n, e) => (e.kind === 'round' && e.ms !== undefined && (n === undefined || e.at > n.at) ? e : n), undefined)?.ms

/** Four columns of figures ($/prompt with its trend, the last turn, the subagents' share, the turns to autocompact), then the spend bar and the context bar; hidden before the first round. */
export function andamentoBlocks(k: Kit): Block[] {
  const { ui, s, title } = k
  const S = t()
  if (s.insights === undefined || s.insights.rounds <= 0) return []
  const a = andamento(s)
  const trendColor = a.trend === 'up' ? COLORS.red : a.trend === 'down' ? COLORS.green : undefined
  const arrow = a.trend === 'up' ? sp('↑', COLORS.red) : a.trend === 'down' ? sp('↓', COLORS.green) : dim('→')
  // the running turn's cost once it reaches a cent, else the last ended turn's
  const turnUsd = shownTurnUsd(s.cost)
  const roundMs = lastRoundMs(s)
  const figures = figureRows(k, [
    { label: S.page.perPrompt, value: a.perPrompt === undefined ? undefined : [sp(fmtCost(a.perPrompt), trendColor, true), sp(' '), arrow], caption: a.target === undefined ? undefined : S.page.max(fmtCost(a.target)) },
    { label: S.page.lastTurn, value: turnUsd === undefined || turnUsd < CENT ? undefined : [sp(`$${turnUsd.toFixed(2)}`, COLORS.text, true)], caption: roundMs === undefined ? undefined : duration(roundMs) },
    { label: S.page.subagents, value: a.agentPct === undefined ? undefined : [sp(`${Math.round(a.agentPct)}%`, COLORS.lavender, true)], caption: a.agentPct === undefined ? undefined : S.page.ofSpend },
    { label: S.page.compaction, value: a.turnsLeft === undefined ? undefined : [sp(S.page.turnsLeft(a.turnsLeft), a.isCompactDue ? COLORS.yellow : COLORS.text, true)], caption: s.autoCompactAt === undefined ? undefined : S.page.compactAt(abbrevTokens(s.autoCompactAt, true)) },
  ])

  const label = (p: { label: string }) => (p.label === 'main' ? S.page.main : p.label === 'other' ? S.page.other : p.label)
  const spend = spendSplit(s).map((p): BarPart => ({ label: label(p), pct: p.pct, isOther: p.label === 'other' }))
  const context = toolParts(s.insights.byTool, S.page.other)
  return [[title(S.page.trend), figures, spend.length > 0 && barRows(k, S.page.spend, spend), context.length > 0 && barRows(k, S.page.context, context)]]
}

// ── IN CORSO ──

/** The deliver tasks and their perimeter, the workflow run and the running agents; hidden when nothing runs and no task is open. */
export function inProgressBlocks(k: Kit): Block[] {
  const { ui, s, width, title, actions } = k
  const S = t()
  const running = visibleAgents(s).filter(a => a.status === 'running')
  const run = workflowLine(k)
  if (running.length === 0 && run === undefined && openTasks(s).length === 0) return []

  const rows: Block[] = []
  const counts = taskCounts(s)
  if (counts !== null) {
    const current = s.tasks?.find(task => task.status === 'in_progress')
    const icon = counts.inProgress > 0 ? sp('󱎖 ', COLORS.blue) : dim('󰄰 ')
    rows.push([line(ui, truncateSpans([icon, sp(S.page.tasks(counts.done, counts.total)), ...(current === undefined ? [] : [dim(` · ${current.subject}`)])], width))])
  }
  if (s.perimeter !== undefined) {
    const outside = s.perimeterCheck?.outside ?? []
    const spans = outside.length > 0 ? [sp(S.filesOutside(outside.length), COLORS.red)] : s.perimeterCheck ? [sp('󰄬 ', COLORS.green), dim(S.perimeter(s.perimeter.length))] : [dim(S.perimeter(s.perimeter.length))]
    rows.push([line(ui, truncateSpans(spans, width))])
  }
  if (run !== undefined) rows.push([run])
  const agentBlock = makeAgentBlock(k)
  rows.push(...orderAgents(running).map(({ agent, depth }) => agentBlock(`agent:${agent.id}`, agent, depth)))

  return [[title(S.page.inProgress), collapsible(k, 'inProgress', rows, MAX_ROWS, s.openKeys?.includes('inProgress') === true, () => actions.toggleOpen('inProgress'))]]
}

// ── FATTO ──

type DoneEntry = { at: number; icon: Span; text: string; usd?: number }

function logEntry(e: CockpitLogEntry): DoneEntry {
  const E = t().page.events
  switch (e.kind) {
    case 'round':
      return { at: e.at, icon: dim('·'), text: E.round(duration(e.ms ?? 0)), usd: e.usd }
    case 'commit':
      return { at: e.at, icon: sp('●', COLORS.green), text: E.commit(e.text ?? e.key ?? '') }
    case 'test':
      return { at: e.at, icon: e.isFailed ? sp('󰅖', COLORS.red) : sp('󰄬', COLORS.green), text: E.test(e.text ?? '', e.isFailed === true) }
    case 'compact':
      return { at: e.at, icon: sp('◇', COLORS.blue), text: E.compact(e.tokens === undefined ? '' : abbrevTokens(e.tokens), e.after === undefined ? '' : abbrevTokens(e.after)) }
    case 'pr':
      return { at: e.at, icon: sp('◆', COLORS.lavender), text: E.pr(e.key ?? '', e.text ?? '') }
  }
}

/** The session log and the agents that finished, newest first: time, icon, text, cost; the newest five, the rest behind the toggle. */
export function doneBlocks(k: Kit): Block[] {
  const { ui, s, width, title, actions } = k
  const S = t()
  // An agent that just finished stays in s.agents for a while before it moves to the history: both feed FATTO, once per id.
  const ended = visibleAgents(s).filter(a => a.status === 'done').map(toHistory).filter((h): h is CockpitHistoryEntry => h !== undefined)
  const history = addHistory(s.history, ended)
  const entries: DoneEntry[] = [
    ...(s.sessionLog ?? []).map(logEntry),
    ...history.map((h): DoneEntry => ({ at: h.endedAt, icon: agentIcon({ ...h, status: 'done' }), text: S.page.events.agent(h.type), usd: h.usd })),
  ].sort((a, b) => b.at - a.at)
  if (entries.length === 0) return []
  const rows = entries.map((e): Block => [line(ui, pairRow([dim(clockTime(e.at)), sp(' '), e.icon, sp(' '), sp(e.text)], e.usd === undefined ? [] : [dim(costCell(e.usd, COST_W))], width))])
  return [[title(S.page.done), collapsible(k, 'done', rows, DONE_ROWS, s.openKeys?.includes('done') === true, () => actions.toggleOpen('done'))]]
}
