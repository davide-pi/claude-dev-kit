import type { CockpitHistoryEntry, CockpitLogEntry } from '../types'
import { addHistory, toHistory } from './agents'
import { andamento, spendSplit } from './andamento'
import { openTasks } from './context'
import { COLORS, abbrevTokens, barCells, clockTime, costCell, duration, fmtCost, padCells, truncateSpans } from './shared'
import type { Span } from './shared'
import { signalsOf } from './signals'
import type { Signal, SignalKind } from './signals'
import { t } from './strings'
import { agentIcon, orderAgents, pairRow, taskCounts, visibleAgents } from './view-agents'
import { BUTTON_GAP, dim, line, sp } from './view-base'
import { collapsible, makeAgentBlock, signalRow, workflowLine, worklogDays } from './view-tabs'
import type { Block, Kit } from './view-tabs'

// ── The single page: four sections, each hidden when empty (ATTENZIONE says there is nothing to do) ──

/** ATTENZIONE and IN CORSO show this many rows; the rest sits behind a toggle so the footer stays in view. */
const MAX_ROWS = 5
/** FATTO shows this many events; the rest sits behind its toggle. */
const DONE_ROWS = 5
/** Cells the caption of a bar takes, so the bar and its legend line up. */
const CAPTION_W = 9
/** A bar's parts beyond this many tools join "other". */
const TOP_TOOLS = 3
const COST_W = 7

/** The notifications that cost money; every other kind that is not blocking comes after them. */
const COST_KINDS: readonly SignalKind[] = ['heavyAgent', 'opusReadOnly', 'bigResult', 'reread', 'coldAfterIdle', 'ctxGrowth']

const isBlocking = (sig: Signal): boolean => sig.kind === 'permissionWait' || (sig.kind === 'workflow' && sig.label === 'stall')
const rankOf = (sig: Signal): number => (isBlocking(sig) ? 0 : COST_KINDS.includes(sig.kind) ? 1 : 2)

// ── ATTENZIONE ──

/** The live notifications, blocking first then cost then the rest, and the worklog behind; "nothing to do" when there is neither. */
export function attentionBlocks(k: Kit): Block[] {
  const { ui, s, gap, title, actions } = k
  const { Box, Button } = ui
  const S = t()
  const signals = [...signalsOf(s)].sort((a, b) => rankOf(a) - rankOf(b))
  const rows: Block[] = signals.map(sig => signalRow(k, sig, { isBlocking: isBlocking(sig) }))

  const late = worklogDays(k, n => `worklog · ${S.worklog.behind(n)}`)
  if (late !== undefined) {
    const hasLog = s.sessionId !== undefined && !s.isWorklogSkillMissing
    rows.push([
      <Box columnGap={BUTTON_GAP}>
        {late.toggle}
        {hasLog && (
          <Button key="attention:worklog" onPress={() => actions.ask('worklog')}>
            {S.buttons.logHours}
          </Button>
        )}
      </Box>,
      late.days,
    ])
  }

  if (rows.length === 0) return [[gap(), title(S.page.attention), line(ui, [sp('✓ ', COLORS.green), dim(S.page.nothingToDo)])]]
  return [[gap(), title(S.page.attention), collapsible(k, 'attention', rows, MAX_ROWS, s.openKeys?.includes('attention') === true, () => actions.toggleOpen('attention'))]]
}

// ── ANDAMENTO ──

const PALETTE = [COLORS.blue, COLORS.green, COLORS.amber, COLORS.lavender, COLORS.yellow]

type BarPart = { label: string; pct: number; isOther?: boolean }

/** A bar under its caption and the legend under it, each part's colour and share. */
function barRows(k: Kit, caption: string, parts: readonly BarPart[]): Block {
  const { ui, width } = k
  const colors = parts.map((p, i) => (p.isOther ? COLORS.gray : (PALETTE[i % PALETTE.length] ?? COLORS.blue)))
  const legend: Span[] = parts.flatMap((p, i) => [...(i > 0 ? [sp('  ')] : []), sp('■ ', colors[i]), dim(`${p.label} ${Math.round(p.pct)}%`)])
  return [
    line(ui, [dim(padCells(caption, CAPTION_W)), ...barCells(Math.max(1, width - CAPTION_W), parts.map((p, i) => ({ pct: p.pct, color: colors[i] ?? COLORS.blue })))]),
    line(ui, truncateSpans([sp(' '.repeat(CAPTION_W)), ...legend], width)),
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

/** $/prompt with its arrow and target, the subagents' share, the turns to autocompact, then the spend bar and the context bar; hidden before the first round. */
export function andamentoBlocks(k: Kit): Block[] {
  const { ui, s, width, gap, title } = k
  const S = t()
  if (s.insights === undefined || s.insights.rounds <= 0) return []
  const a = andamento(s)
  const trendColor = a.trend === 'up' ? COLORS.red : a.trend === 'down' ? COLORS.green : undefined
  const arrow = a.trend === 'up' ? sp('↑', COLORS.red) : a.trend === 'down' ? sp('↓', COLORS.green) : dim('→')
  const figures: Block = [
    line(ui, truncateSpans([sp(fmtCost(a.perPrompt), trendColor, true), dim(S.page.perPrompt), sp(' '), arrow, ...(a.target === undefined ? [] : [dim(` ${S.page.target(fmtCost(a.target))}`)])], width)),
  ]
  const facts: Span[][] = [
    ...(a.agentPct === undefined ? [] : [[sp(S.page.agents(Math.round(a.agentPct)))]]),
    ...(a.turnsLeft === undefined ? [] : [[sp(S.page.turnsLeft(a.turnsLeft), a.isCompactDue ? COLORS.yellow : undefined)]]),
  ]
  if (facts.length > 0) figures.push(line(ui, truncateSpans(facts.flatMap((f, i) => (i > 0 ? [dim(' · '), ...f] : f)), width)))

  const label = (p: { label: string }) => (p.label === 'main' ? S.page.main : p.label === 'other' ? S.page.other : p.label)
  const spend = spendSplit(s).map((p): BarPart => ({ label: label(p), pct: p.pct, isOther: p.label === 'other' }))
  const context = toolParts(s.insights.byTool, S.page.other)
  return [[gap(), title(S.page.trend), figures, spend.length > 0 && barRows(k, S.page.spend, spend), context.length > 0 && barRows(k, S.page.context, context)]]
}

// ── IN CORSO ──

/** The deliver tasks and their perimeter, the workflow run and the running agents; hidden when nothing runs and no task is open. */
export function inProgressBlocks(k: Kit): Block[] {
  const { ui, s, width, gap, title, actions } = k
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

  return [[gap(), title(S.page.inProgress), collapsible(k, 'inProgress', rows, MAX_ROWS, s.openKeys?.includes('inProgress') === true, () => actions.toggleOpen('inProgress'))]]
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
      return { at: e.at, icon: sp('◇', COLORS.blue), text: E.compact(abbrevTokens(e.tokens), e.after === undefined ? '' : abbrevTokens(e.after)) }
    case 'pr':
      return { at: e.at, icon: sp('◆', COLORS.lavender), text: E.pr(e.key ?? '', e.text ?? '') }
  }
}

/** The session log and the agents that finished, newest first: time, icon, text, cost; the newest five, the rest behind the toggle. */
export function doneBlocks(k: Kit): Block[] {
  const { ui, s, width, gap, title, actions } = k
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
  return [[gap(), title(S.page.done), collapsible(k, 'done', rows, DONE_ROWS, s.openKeys?.includes('done') === true, () => actions.toggleOpen('done'))]]
}
