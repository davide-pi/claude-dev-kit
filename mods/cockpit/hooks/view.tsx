import type { RenderElement } from 'claude-code'

import type { CockpitSnapshot, CockpitTab } from '../types'
import { claudeStateSpans } from './agents'
import { TABS, isWorking } from './session'
import {
  COLORS,
  abbrevTokens,
  barCells,
  baseName,
  cacheColor,
  ctxColor,
  displayModel,
  fmtCost,
  fmtCostDelta,
  gridWidths,
  pathToFileUri,
  pctCell,
  signedPct,
  spanWidth,
  textCells,
  truncMiddle,
  truncateSpans,
  ICONS,
} from './shared'
import type { BarPart, Span } from './shared'
import { signalId, signalsOf } from './signals'
import { t } from './strings'
import { visibleAgents } from './view-agents'
import { BUTTON_GAP, buttonRowWidth, delta, dim, line, sp } from './view-base'
import type { Ui } from './view-base'
import { TOKENS_CELLS, contextText, headerEffort, rateRow, rateText } from './view-header'
import type { RateRow } from './view-header'
import { makeKit, tabBlocks } from './view-tabs'
import type { Block, Node, PaneActions } from './view-tabs'
import { aheadBehindSpans } from './work'

export type { PaneActions } from './view-tabs'

/** The context fill from which the header warns. */
const CTX_WARN_PCT = 80
// The shortest bar a budget cell draws: below it the credit windows go one row each.
const BUDGET_BAR_MIN = 4

// ── Pane ─────────────────────────────────────────────────────────────────────

/** The pane's content stops here; a wider dock leaves the rest empty on the left. */
export const PANE_MAX_COLUMNS = 60
/** Columns of margin on each side of the content. */
const PANE_PADDING_X = 1

/** Cells a tab button takes: its label, a border and a space each side, and the dot after it. */
const tabCells = (label: string, hasDot: boolean): number => textCells(label) + 4 + (hasDot ? 2 : 0)

/**
 * The tab bar's labels, always for one row of `width` cells; each step is tried when the one before does not fit: full names with counters,
 * Context short, every short name, the first 3 cells of each short name. The selected tab always keeps its full name. A counter past 9 reads `9+`.
 */
export function tabBarLabels(active: CockpitTab, counts: Partial<Record<CockpitTab, number>>, dots: Partial<Record<CockpitTab, boolean>>, width: number): Record<CockpitTab, string> {
  const S = t()
  const badge = (id: CockpitTab) => {
    const n = counts[id] ?? 0
    return n > 0 ? ` ${n > 9 ? '9+' : n}` : ''
  }
  const steps: ((id: CockpitTab) => string)[] = [
    id => S.tabs[id],
    id => (id === 'context' && id !== active ? S.tabsShort[id] : S.tabs[id]),
    id => (id === active ? S.tabs[id] : S.tabsShort[id]),
    id => (id === active ? S.tabs[id] : S.tabsShort[id].slice(0, 3)),
  ]
  const build = (name: (id: CockpitTab) => string) => Object.fromEntries(TABS.map(id => [id, name(id) + badge(id)])) as Record<CockpitTab, string>
  const total = (labels: Record<CockpitTab, string>) => TABS.reduce((n, id) => n + tabCells(labels[id], dots[id] === true), 0) + TABS.length - 1
  const fitting = steps.map(build).find(labels => total(labels) <= width)
  return fitting ?? build(steps[steps.length - 1] as (id: CockpitTab) => string)
}

export function paneView(ui: Ui, s: CockpitSnapshot, bodyColumns: number, bodyRows: number, actions: PaneActions): RenderElement {
  const { Box, Text, Button, Link } = ui
  const S = t()
  // The block is at most PANE_MAX_COLUMNS wide; its content leaves one column of margin each side.
  const block = Math.min(bodyColumns, PANE_MAX_COLUMNS)
  const width = Math.max(0, block - 2 * PANE_PADDING_X)
  const rule = <Text color={COLORS.rule}>{'─'.repeat(width)}</Text>
  const kit = makeKit(ui, s, width, actions)
  const { gap } = kit

  const tab: CockpitTab = s.tab ?? 'agents'
  const running = visibleAgents(s).filter(a => a.status === 'running')
  const wl = s.worklog
  const hasWorklog = wl.pending.length + wl.underTarget.length > 0
  // The notifications the person has not seen: counted on the tab label until the tab is opened
  const seen = new Set(s.seenSignals)
  const newSignals = tab === 'signals' ? 0 : signalsOf(s).filter(sig => !seen.has(signalId(sig))).length

  // ── Tab bar: every tab shows its name; the selected one is the primary button ──
  const counts = { agents: running.length, signals: newSignals }
  const labels = tabBarLabels(tab, counts, { work: hasWorklog }, width)
  const tabButton = (id: CockpitTab, hasDot = false) => {
    const label = labels[id]
    const variant = tab === id ? 'primary' : 'secondary'
    return hasDot ? (
      <Button key={`tab:${id}`} variant={variant} onPress={() => actions.selectTab(id)}>
        {label}
        <Text color={COLORS.yellow}> 󰧞</Text>
      </Button>
    ) : (
      <Button key={`tab:${id}`} variant={variant} label={label} onPress={() => actions.selectTab(id)} />
    )
  }
  const tabBar = (
    <Box columnGap={1}>
      {TABS.map(id => tabButton(id, id === 'work' && hasWorklog))}
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
  const folderPath = g?.worktreeRoot || s.cwd
  const folderName = baseName(folderPath)
  const folderHref = pathToFileUri(folderPath)
  const folderText = truncMiddle(`${ICONS.folder} ${folderName}`, w.folder)
  const arrows = g ? aheadBehindSpans(g) : []
  const grid = (
    <Box columnGap={1}>
      <Box width={w.folder}>
        {folderHref ? (
          <Text wrap="truncate">
            <Link href={folderHref}>
              <Text color={COLORS.folder}>{folderText}</Text>
            </Link>
          </Text>
        ) : (
          line(ui, [sp(folderText, COLORS.folder)])
        )}
      </Box>
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

  // Header line 1: model + effort + the Claude state | session cost (always: `$0.00` before the first turn) and the last round's delta
  const costDelta = fmtCostDelta(delta(s.cost.usd, s.cost.startUsd))
  const costSpans: Span[] = [sp(fmtCost(s.cost.usd), COLORS.yellow, true), ...(costDelta ? [sp(' '), dim(costDelta)] : [])]
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

  // A budget cell: its label, a bar taking what the readout leaves of `cells`, the readout.
  const barLength = (head: Span, cells: number, text: Span[]): number => Math.max(BUDGET_BAR_MIN, cells - spanWidth([head, ...text]) - 1)
  const budget = (label: string, cells: number, parts: BarPart[], text: Span[]): Span[] => {
    const head = dim(`${label} `)
    return [head, ...barCells(barLength(head, cells, text), parts), sp(' '), ...text]
  }

  // CTX row: the fill, red from 80% with a warning line, then the prompt cache hit of the last main-loop turn (coloured by thresholds);
  // the readout keeps its cells (blank before the first turn's cache hit), so the bar keeps its length; its glow flows while Claude works
  const pct = s.ctx.percent ?? 0
  const shownPct = s.ctx.percent ?? s.lastCtx?.percent ?? 0
  const cacheShown: Span[] = [sp('  '), dim(S.cache), sp(pctCell(s.cacheShare ?? 0), cacheColor(s.cacheShare ?? 0))]
  const cacheSpans: Span[] = s.cacheShare === undefined ? [sp(' '.repeat(spanWidth(cacheShown)))] : cacheShown
  const ctxParts = [{ pct: shownPct, color: ctxColor(shownPct) }]
  const ctxText = [...contextText(s), ...cacheSpans]
  const ctxHead = dim('CTX ')
  const ctxBar = barLength(ctxHead, width, ctxText)
  // The bar is a surface module where the surface has one: its glow moves on that region's own clock, never redrawing the pane
  const ctxRow = ui.Client ? (
    <Box>
      {line(ui, [ctxHead])}
      <ui.Client key="ctxbar" module="./ctx-bar.tsx" props={{ cells: barCells(ctxBar, ctxParts), isWorking: isWorking(s, s.now) }} width={ctxBar} />
      {line(ui, [sp(' '), ...ctxText])}
    </Box>
  ) : (
    line(ui, budget('CTX', width, ctxParts, ctxText))
  )
  const ctxWarning = pct >= CTX_WARN_PCT && line(ui, [sp(S.contextAt(Math.round(pct)), COLORS.red)])

  // Credits row: the 5h and 7d windows side by side, half the row each, or one row each when a half cannot hold its readout and a short bar;
  // the week's pace shows as the gap segment of the 7d bar
  const windows = [
    { label: '5h', r: rateRow(s, 'five_hour') },
    { label: '7d', r: rateRow(s, 'seven_day') },
  ].filter((w): w is { label: string; r: RateRow } => w.r !== undefined)
  const windowSep = dim(' · ')
  const halfCells = Math.floor((width - spanWidth([windowSep])) / 2)
  const sideBySide = windows.length > 1 && windows.every(({ label, r }) => spanWidth([dim(`${label} `), ...rateText(r, s.now)]) + 1 + BUDGET_BAR_MIN <= halfCells)
  const windowSpans = ({ label, r }: { label: string; r: RateRow }): Span[] => {
    const gapPct = r.pace && r.pace.delta < 0 ? -r.pace.delta : 0
    const parts = [{ pct: r.rem, color: r.color }, ...(gapPct ? [{ pct: gapPct, color: COLORS.gap }] : [])]
    return budget(label, sideBySide ? halfCells : width, parts, rateText(r, s.now))
  }
  const creditsRows = windows.length === 0
    ? [line(ui, [dim(S.noRateData)])]
    : sideBySide
      ? [line(ui, windows.flatMap((w, i) => [...(i > 0 ? [windowSep] : []), ...windowSpans(w)]))]
      : windows.map(w => line(ui, windowSpans(w)))

  // Under the credits: the context the current turn added and the week's pace (the credit left against an even burn, + is ahead),
  // each in its own cells and the row always drawn, so neither the readout nor the tabs below move
  const grown = s.ctx.percent === undefined ? undefined : delta(s.ctx.tokens, s.ctx.startTokens)
  const pace = rateRow(s, 'seven_day')?.pace
  const trendRow = line(ui, [
    dim(`${S.turnGrowth} `),
    sp((grown !== undefined && grown > 0 ? `+${abbrevTokens(grown, true)}` : '').padStart(TOKENS_CELLS + 1)),
    windowSep,
    dim(`${S.weekPace} `),
    ...(pace ? [sp(signedPct(pace.delta).padStart(5), pace.delta < 0 ? COLORS.amber : COLORS.green)] : []),
  ])

  // The footer, the last row of every tab: compact, retrospettiva (behind a choice of the last 10 days or this session: it sends /retro to the model), segna ore (behind a choice of this chat or today: it sends /worklog; only with a session).
  // The row stacks when its buttons do not fit the pane side by side.
  const hasLog = s.sessionId !== undefined && !s.isWorklogSkillMissing
  const barLabels = [S.buttons.compact, S.buttons.retro, ...(hasLog ? [S.buttons.logHours] : [])]
  const retroLabels = [S.buttons.retroDays, S.buttons.retroSession, S.buttons.no]
  const logLabels = [S.buttons.logSession, S.buttons.logDay, S.buttons.no]
  const buttonsRow =
    s.confirm === 'retro' ? (
      <Box flexDirection="column">
        {line(ui, truncateSpans([sp(S.confirmRetro, COLORS.yellow)], width))}
        <Box flexDirection={buttonRowWidth(retroLabels) <= width ? 'row' : 'column'} alignItems="flex-start" columnGap={BUTTON_GAP}>
          <Button key="confirm:days" onPress={() => actions.retro('days')}>
            {S.buttons.retroDays}
          </Button>
          <Button key="confirm:session" onPress={() => actions.retro('session')}>
            {S.buttons.retroSession}
          </Button>
          <Button key="confirm:no" onPress={() => actions.answer(false)}>
            {S.buttons.no}
          </Button>
        </Box>
      </Box>
    ) : s.confirm === 'worklog' && hasLog ? (
      <Box flexDirection="column">
        {line(ui, truncateSpans([sp(S.confirmLog, COLORS.yellow)], width))}
        <Box flexDirection={buttonRowWidth(logLabels) <= width ? 'row' : 'column'} alignItems="flex-start" columnGap={BUTTON_GAP}>
          <Button key="confirm:chat" onPress={() => actions.worklog('session')}>
            {S.buttons.logSession}
          </Button>
          <Button key="confirm:day" onPress={() => actions.worklog('day')}>
            {S.buttons.logDay}
          </Button>
          <Button key="confirm:no" onPress={() => actions.answer(false)}>
            {S.buttons.no}
          </Button>
        </Box>
      </Box>
    ) : (
      <Box flexDirection={buttonRowWidth(barLabels) <= width ? 'row' : 'column'} alignItems="flex-start" columnGap={BUTTON_GAP}>
        <Button key="bar:compact" onPress={() => actions.compact()}>
          {S.buttons.compact}
        </Button>
        <Button key="bar:retro" onPress={() => actions.ask('retro')}>
          {S.buttons.retro}
        </Button>
        {hasLog && (
          <Button key="bar:worklog" onPress={() => actions.ask('worklog')}>
            {S.buttons.logHours}
          </Button>
        )}
      </Box>
    )

  // The header, above the tab bar on every tab: model, state and cost; folder, branch and git; then, after a rule, the CTX row and the credits row
  const headerRows: Node[] = [modelLine, grid, rule, ctxRow, ctxWarning, ...creditsRows, trendRow]

  // Only the selected tab is built. Blocks are told apart by a rule; an empty tab says so.
  const blocks = tabBlocks(tab, kit)
  const body: Block = blocks.length > 0 ? blocks.flatMap((b, i) => [...(i > 0 ? [rule] : []), ...b.flat()]) : [gap(), line(ui, [dim(S.nothingToShow)])]

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
