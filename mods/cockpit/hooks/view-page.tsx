import type { CockpitLogEntry } from '../types'
import { agentLog } from './agents'
import { andamento, spendSplit } from './andamento'
import { openTasks } from './context'
import { CENT, COLORS, abbrevTokens, barCells, clockTime, costCell, duration, fmtCost, localDate, padCells, shortModel, shownTurnUsd, spanWidth, truncateSpans } from './shared'
import type { Span } from './shared'
import { loggedSignal, signalSeverity, signalsOf } from './signals'
import type { Signal, SignalKind } from './signals'
import { t } from './strings'
import { isFading } from './anim'
import { groupDone } from './done-groups'
import type { DoneEvent, DoneGroup } from './done-groups'
import { agentIcon, orderAgents, pairRow, taskCounts, visibleAgents } from './view-agents'
import { BUTTON_GAP, animCell, dim, line, sp, spanNodes } from './view-base'
import { SEVERITY_COLORS, collapsible, makeAgentBlock, signalIcon, signalRow, signalText, workflowLine, worklogBehindRows } from './view-kit'
import type { Block, Kit } from './view-kit'

// ── The single page: four sections, each hidden when empty (ATTENZIONE says there is nothing to do) ──

/** ATTENZIONE and IN CORSO show this many rows; the rest sits behind a toggle so the footer stays in view. */
const MAX_ROWS = 5
/** ATTENZIONE also stops at this many drawn lines: a closed notification takes two (what, then what to do), so four of them fill it. */
const ATTENTION_LINES = 8
/** LOG shows this many groups (an open one with its whole subtree); the rest sits behind its toggle. */
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
type Column = { label: string; value?: Span[]; caption?: string; /** The value shows bold in the accent for a moment when it changes. */ isAnimated?: boolean }

/** The figures rows: the columns side by side, floor(width / 4) cells each, a cell cut to leave a space before the next. */
function figureRows(k: Kit, columns: readonly Column[]): Block {
  const { ui, width } = k
  const { Box } = ui
  const cells = Math.floor(width / COLUMNS)
  const fit = (spans: Span[]): Span[] => {
    const cut = truncateSpans(spans, cells - 1)
    return [...cut, sp(' '.repeat(cells - spanWidth(cut)))]
  }
  const row = (pick: (c: Column) => Span[]) => line(ui, columns.flatMap(c => fit(pick(c))))
  // where the surface has modules, an animated value is a cell of its own that restarts when its text changes
  const values = ui.Client ? (
    <Box>
      {columns.map((c, i) => (
        <Box key={i}>{c.isAnimated && c.value !== undefined ? animCell(ui, `anim:figure:${i}`, 'once', fit(c.value), c.value.map(v => v.t).join('')) : line(ui, fit(c.value ?? [dim(MISSING)]))}</Box>
      ))}
    </Box>
  ) : (
    row(c => c.value ?? [dim(MISSING)])
  )
  return [row(c => [dim(c.label)]), values, row(c => (c.caption ? [dim(c.caption)] : []))]
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
    { label: S.page.perPrompt, value: a.perPrompt === undefined ? undefined : [sp(fmtCost(a.perPrompt), trendColor, true), sp(' '), arrow], caption: a.target === undefined ? undefined : S.page.max(fmtCost(a.target)), isAnimated: true },
    { label: S.page.lastTurn, value: turnUsd === undefined || turnUsd < CENT ? undefined : [sp(`$${turnUsd.toFixed(2)}`, COLORS.text, true)], caption: roundMs === undefined ? undefined : duration(roundMs) },
    { label: S.page.subagents, value: a.agentPct === undefined ? undefined : [sp(`${Math.round(a.agentPct)}%`, COLORS.lavender, true)], caption: a.agentPct === undefined ? undefined : S.page.ofSpend, isAnimated: true },
    { label: S.page.compaction, value: a.turnsLeft === undefined ? undefined : [sp(S.page.turnsLeft(a.turnsLeft), a.isCompactDue ? COLORS.yellow : COLORS.text, true)], caption: s.autoCompactAt === undefined ? undefined : S.page.compactAt(abbrevTokens(s.autoCompactAt, true)), isAnimated: true },
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

// ── LOG ──

/** The cells of a cost share (`100%`). */
const SHARE_W = 4

/** A row of the log: the icon and text of its kind; an agent also carries its model, cost, length and start. */
type DoneEntry = DoneEvent & {
  icon: Span
  text: string
  /** Dim, after the text. */
  detail?: string
  /** The time the row shows, when it is not `at`. */
  start?: number
  usd?: number
  ms?: number
}

/** `son5.5·high`: the short model and the effort, whichever there is. */
const modelEffort = (model: string | undefined, effort: string | number | undefined): string =>
  [shortModel(model).replace(' ', ''), effort === undefined ? '' : String(effort)].filter(Boolean).join('·')

/** The row of an agent entry. */
function agentEntry(e: CockpitLogEntry): DoneEntry {
  const detail = modelEffort(e.model, e.effort)
  const icon = agentIcon({ id: e.key ?? '', type: '', startedAt: 0, tokens: 0, status: 'done', isFailed: e.isFailed === true })
  return { at: e.at, kind: 'agent', icon, text: e.text ?? '?', ...(detail !== '' && { detail }), ...(e.ms !== undefined && { ms: e.ms, start: e.at - e.ms }), ...(e.usd !== undefined && { usd: e.usd }) }
}

/** The row of a log entry; none for a round, which ends a group instead, and for a signal of a kind unknown. */
function logEntry(e: CockpitLogEntry): DoneEntry | undefined {
  const E = t().page.events
  switch (e.kind) {
    case 'round':
      return undefined
    case 'agent':
      return agentEntry(e)
    case 'signal': {
      const sig = loggedSignal(e)
      if (sig === undefined) return undefined
      return { at: e.at, kind: 'signal', icon: sp(signalIcon(sig), SEVERITY_COLORS[e.severity ?? signalSeverity(sig)]), text: signalText(sig).what }
    }
    case 'commit':
      return { at: e.at, kind: 'commit', icon: sp('●', COLORS.green), text: E.commit(e.text ?? e.key ?? '') }
    case 'test':
      return { at: e.at, kind: 'test', icon: e.isFailed ? sp('󰅖', COLORS.red) : sp('󰄬', COLORS.green), text: E.test(e.text ?? '', e.isFailed === true) }
    case 'compact':
      return { at: e.at, kind: 'compact', icon: sp('◇', COLORS.blue), text: E.compact(e.tokens === undefined ? '' : abbrevTokens(e.tokens), e.after === undefined ? '' : abbrevTokens(e.after)) }
    case 'pr':
      return { at: e.at, kind: 'pr', icon: sp('◆', COLORS.lavender), text: E.pr(e.key ?? '', e.text ?? '') }
  }
}

/** What a group holds by kind (`2 agents · 1 commit`), then its tool calls (`34 tools: Read 20 · Bash 9 · Edit 5`, the top three); empty when it holds nothing. */
function doneSummary(g: DoneGroup<DoneEntry>): string {
  const S = t().page.events.summary
  const kinds = (['agent', 'signal', 'commit', 'test', 'pr', 'compact'] as const).flatMap(kind => {
    const n = g.events.filter(e => e.kind === kind).length
    return n > 0 ? [S[kind](n)] : []
  })
  const tools = Object.entries(g.tools ?? {}).sort((a, b) => b[1] - a[1])
  const total = tools.reduce((n, [, count]) => n + count, 0)
  const top = tools.slice(0, TOP_TOOLS).map(([name, count]) => `${name} ${count}`).join(' · ')
  return [...kinds, ...(total > 0 ? [S.tools(total, top)] : [])].join(' · ')
}

/** The figures of a round or an agent, dim: its share of the session's cost (aligned), its cost, its length; a cell with no data is left out. */
function figures(usd: number | undefined, ms: number | undefined, sessionUsd: number | undefined): Span[] {
  const share = usd !== undefined && sessionUsd !== undefined && sessionUsd > 0 ? `${Math.round((usd / sessionUsd) * 100)}%` : ''
  const cells = [...(usd === undefined ? [] : [share.padStart(SHARE_W), costCell(usd, COST_W)]), ...(ms === undefined ? [] : [duration(ms)])]
  return cells.flatMap((c, i) => [...(i > 0 ? [sp(' ')] : []), dim(c)])
}

/** When a group began: its round's end less its length; the open round and a merged run only know their `at`. */
const startOf = (g: DoneGroup<DoneEntry>): number => (g.ms !== undefined && !g.isCurrent ? g.at - g.ms : g.at)

/** The header of a group: toggle arrow, start time, round (or the open round, or the run of chat-only rounds), its share of the session's cost, cost and length. */
function doneHeader(g: DoneGroup<DoneEntry>, isOpen: boolean, width: number, sessionUsd: number | undefined): { arrow: Span; rest: Span[] } {
  const E = t().page.events
  const label = g.isCurrent ? E.current : g.chatOnly !== undefined ? E.chatOnly(g.chatOnly) : E.round(g.round ?? 0)
  const cells = figures(g.usd, g.ms, sessionUsd)
  const arrow = sp(isOpen ? '▾ ' : '▸ ')
  const rest = truncateSpans([...(g.isCurrent ? [] : [dim(clockTime(startOf(g))), sp(' ')]), sp(label), ...(cells.length > 0 ? [sp(' '), ...cells] : [])], width - 2)
  return { arrow, rest }
}

/**
 * The session log by main round, newest first, under a day header (`2026-11-11`) where the date changes: each round a toggle row (start time, number, its
 * share of the session's cost, cost, length) over a summary of what it holds (with its tool calls) and its children (time, icon, text; an agent also its
 * model, share, cost and length) in a tree, newest first. The newest group is open until a person gives it a state, which stays. The groups count, not
 * their lines: the newest five, the rest behind the toggle.
 */
export function doneBlocks(k: Kit): Block[] {
  const { ui, s, width, title, actions } = k
  const { Box, Button, Text } = ui
  const S = t()
  const log = s.sessionLog ?? []
  // An agent that just finished is logged as it ends; one still listed and not yet in the log shows once all the same.
  const logged = new Set(log.filter(e => e.kind === 'agent').map(e => e.key))
  const pending = visibleAgents(s).filter(a => a.status === 'done' && !logged.has(a.id)).flatMap(a => agentLog(a) ?? [])
  const entries = [...log, ...pending].flatMap(e => logEntry(e) ?? [])
  const groups = groupDone(entries, log)
  if (groups.length === 0) return []

  const rows: Block[] = groups.map((g, gi): Block => {
    // a state a person gave holds; else the newest group is open
    const isOpen = g.events.length > 0 && (s.groupsOpen?.[g.key] ?? gi === 0)
    const { arrow, rest } = doneHeader(g, isOpen, width, s.cost.usd)
    // the newest group's header fades from its highlight as it appears; the arrow stays a button beside the animated cells
    const isNewest = gi === 0 && ui.Client !== undefined && isFading(g.at, s.now)
    const toggle = () => actions.setGroupOpen(g.key, !isOpen)
    let header: Block
    if (g.events.length === 0) header = [line(ui, [arrow, ...rest])]
    else if (isNewest) {
      header = [
        <Box>
          <Button key={g.key} plain onPress={toggle}>
            <Text wrap="truncate">{spanNodes(ui, [arrow])}</Text>
          </Button>
          {animCell(ui, 'anim:done', 'fade', rest)}
        </Box>,
      ]
    } else {
      header = [
        <Button key={g.key} plain onPress={toggle}>
          <Text wrap="truncate">{spanNodes(ui, [arrow, ...rest])}</Text>
        </Button>,
      ]
    }
    const summary = doneSummary(g)
    const children = isOpen
      ? [...(summary === '' ? [] : [[line(ui, [sp('├ ', COLORS.rule), dim(summary)])]]), ...g.events.map((e, i): Block => {
          const left = [dim(clockTime(e.start ?? e.at)), sp(' '), e.icon, sp(' '), sp(e.text), ...(e.detail === undefined ? [] : [sp(' '), dim(e.detail)])]
          return [line(ui, [sp(i === g.events.length - 1 ? '└ ' : '├ ', COLORS.rule), ...pairRow(left, e.kind === 'agent' ? figures(e.usd, e.ms, s.cost.usd) : [], width - 2)])]
        })]
      : []
    const day = localDate(startOf(g))
    const prev = groups[gi - 1]
    return [(prev === undefined || localDate(startOf(prev)) !== day) && line(ui, [dim(day)]), header, ...children]
  })
  return [[title(S.page.done), collapsible(k, 'done', rows, DONE_ROWS, s.openKeys?.includes('done') === true, () => actions.toggleOpen('done'))]]
}
