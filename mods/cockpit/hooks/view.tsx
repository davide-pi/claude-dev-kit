import type { RenderElement } from 'claude-code'

import type { CockpitSnapshot } from '../types'
import { claudeStateSpans } from './agents'
import { ctxScale } from './context'
import { isWorking } from './session'
import {
  COLORS,
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
  shownTurnUsd,
  signedPct,
  spanWidth,
  truncMiddle,
  truncateSpans,
  ICONS,
} from './shared'
import type { BarPart, Span } from './shared'
import { t } from './strings'
import { BUTTON_GAP, buttonRowWidth, dim, line, padStart, sp } from './view-base'
import type { Ui } from './view-base'
import { contextText, headerEffort, rateRow, rateText } from './view-header'
import type { RateRow } from './view-header'
import { makeKit } from './view-kit'
import type { Block, Node, PaneActions } from './view-kit'
import { andamentoBlocks, attentionBlocks, doneBlocks, inProgressBlocks } from './view-page'
import { aheadBehindSpans } from './work'

export type { PaneActions } from './view-kit'

/** The context fill from which the header warns. */
const CTX_WARN_PCT = 80
// The cells of a round's cost delta (`$+12.34`) on the trend row, beside the context growth.
const COST_DELTA_CELLS = 7
// Stands in a trend cell whose turn value is not computed yet: nf-md-duck
const NOT_YET = '\u{F01E5}'
// The shortest bar a budget cell draws: below it the credit windows go one row each.
const BUDGET_BAR_MIN = 4

// ── Pane ─────────────────────────────────────────────────────────────────────

/** The pane's content stops here; a wider dock leaves the rest empty on the left. */
export const PANE_MAX_COLUMNS = 60
/** Columns of margin on each side of the content. */
const PANE_PADDING_X = 1

export function paneView(ui: Ui, s: CockpitSnapshot, bodyColumns: number, bodyRows: number, actions: PaneActions): RenderElement {
  const { Box, Text, Button, Link } = ui
  const S = t()
  // The block is at most PANE_MAX_COLUMNS wide; its content leaves one column of margin each side.
  const block = Math.min(bodyColumns, PANE_MAX_COLUMNS)
  const width = Math.max(0, block - 2 * PANE_PADDING_X)
  const rule = <Text color={COLORS.rule}>{'─'.repeat(width)}</Text>
  const kit = makeKit(ui, s, width, actions)

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

  // Header line 1: model + effort + the Claude state | session cost (always: `$0.00` before the first turn); the round's delta is on the trend row
  const costSpans: Span[] = [sp(fmtCost(s.cost.usd), COLORS.yellow, true)]
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
  const budget = (label: string, cells: number, parts: BarPart[], text: Span[], markPct?: number): Span[] => {
    const head = dim(`${label} `)
    return [head, ...barCells(barLength(head, cells, text), parts, markPct), sp(' '), ...text]
  }

  // CTX row: the fill, red from 80% with a warning line, then the prompt cache hit of the last main-loop turn (coloured by thresholds);
  // the readout keeps its cells (blank before the first turn's cache hit), so the bar keeps its length; its glow flows while Claude works
  // The bar is 1.2 x the autocompact threshold long where the engine reports one: the fill, its colour, the tick and the warning follow that scale
  const scale = ctxScale(s)
  const cacheShown: Span[] = [dim('· '), dim(S.cache), sp(pctCell(s.cacheShare ?? 0), cacheColor(s.cacheShare ?? 0))]
  const cacheSpans: Span[] = s.cacheShare === undefined ? [sp(' '.repeat(spanWidth(cacheShown)))] : cacheShown
  const ctxParts = [{ pct: scale.pct, color: ctxColor(scale.pct) }]
  const ctxText = [...contextText(s), ...cacheSpans]
  // The bar is a surface module where the surface has one: its glow and pulse move on that region's own clock, never redrawing the pane; a surface without one draws it static
  const budgetRow = (key: string, label: string, cells: number, parts: BarPart[], text: Span[], isFlowing: boolean, tone?: string, markPct?: number): RenderElement => {
    if (!ui.Client) return line(ui, budget(label, cells, parts, text, markPct))
    const head = dim(`${label} `)
    return (
      <Box>
        {line(ui, [head])}
        <ui.Client key={key} module="./bar.tsx" props={{ cells: barCells(barLength(head, cells, text), parts, markPct), isFlowing, ...(tone === undefined ? {} : { tone }) }} width={barLength(head, cells, text)} />
        {line(ui, [sp(' '), ...text])}
      </Box>
    )
  }
  const ctxRow = budgetRow('ctxbar', 'CTX', width, ctxParts, ctxText, isWorking(s, s.now), undefined, scale.markPct)
  // triggered on the scaled percent, which it prints too
  const ctxWarning = s.ctx.percent !== undefined && scale.pct >= CTX_WARN_PCT && line(ui, [sp(S.contextAt(Math.round(scale.limit === undefined ? s.ctx.percent : scale.pct)), COLORS.red)])

  // Credits row: the 5h and 7d windows side by side, half the row each, or one row each when a half cannot hold its readout and a short bar;
  // the week's pace shows as the gap segment of the 7d bar
  const sevenDay = rateRow(s, 'seven_day')
  const windows = [
    { label: '5h', r: rateRow(s, 'five_hour') },
    { label: '7d', r: sevenDay },
  ].filter((w): w is { label: string; r: RateRow } => w.r !== undefined)
  const windowSep = dim(' · ')
  const halfCells = Math.floor((width - spanWidth([windowSep])) / 2)
  const sideBySide = windows.length > 1 && windows.every(({ label, r }) => spanWidth([dim(`${label} `), ...rateText(r, s.now)]) + 1 + BUDGET_BAR_MIN <= halfCells)
  const windowParts = (r: RateRow): BarPart[] => {
    const gapPct = r.pace && r.pace.delta < 0 ? -r.pace.delta : 0
    return [{ pct: r.rem, color: r.color }, ...(gapPct ? [{ pct: gapPct, color: COLORS.gap }] : [])]
  }
  // A window's bar pulses when its colour changes; the last known reading (resumed session) has no tone, so the first live one never pulses
  const windowRow = ({ label, r }: { label: string; r: RateRow }): RenderElement =>
    // no tone for a window whose reset has passed: its colour then changes with the clock alone, not with a new reading
    budgetRow(`bar:${label}`, label, sideBySide ? halfCells : width, windowParts(r), rateText(r, s.now), false, r.isStale || (r.resetMs !== undefined && r.resetMs <= s.now) ? undefined : r.color)
  const creditsRows = windows.length === 0
    ? [line(ui, [dim(S.noRateData)])]
    : sideBySide
      ? [
          ui.Client ? (
            <Box>
              {windowRow(windows[0]!)}
              {line(ui, [windowSep])}
              {windowRow(windows[1]!)}
            </Box>
          ) : (
            line(ui, windows.flatMap(({ label, r }, i) => [...(i > 0 ? [windowSep] : []), ...budget(label, halfCells, windowParts(r), rateText(r, s.now))]))
          ),
        ]
      : windows.map(windowRow)

  // Under the credits: what the current turn added to the cost, then the week's pace (the credit left against an even burn,
  // + is ahead); all dim but the pace, each in its own cells and the row always drawn, so neither the readout nor the sections below move
  // until the running turn's cost is measured, the last ended turn's stands in: the duck only before the first one
  const costDelta = fmtCostDelta(shownTurnUsd(s.cost))
  const pace = sevenDay?.pace
  const trendRow = line(ui, [
    dim(`${S.turnCost} `),
    // padded by cells: NOT_YET is one cell but two UTF-16 units
    dim(padStart(costDelta ? `$${costDelta}` : NOT_YET, COST_DELTA_CELLS + 1)),
    windowSep,
    dim(`${S.weekPace} `),
    ...(pace ? [sp(padStart(signedPct(pace.delta), 5), pace.delta < 0 ? COLORS.red : COLORS.green)] : []),
  ])

  // The footer, the last rows of the page: compact, retrospettiva (behind a choice of the last 10 days or this session: it sends /retro to the model), segna ore (behind a choice of this chat or today: it sends /worklog; only with a session).
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

  // The header, above the page: model, state and cost; folder, branch and git; then, after a rule, the CTX row and the credits row
  const headerRows: Node[] = [modelLine, grid, rule, ctxRow, ctxWarning, ...creditsRows, trendRow]

  // The sections in their order, told apart by a rule; an empty one is not built (ATTENZIONE says there is nothing to do).
  const sections = [attentionBlocks, andamentoBlocks, inProgressBlocks, doneBlocks].flatMap(build => build(kit))
  const body: Block = sections.flatMap((b, i) => [...(i > 0 ? [rule] : []), ...b.flat()])

  return (
    <Box flexDirection="column" width={block} paddingX={PANE_PADDING_X} minHeight={bodyRows} marginLeft={bodyColumns - block}>
      {headerRows}
      {rule}
      {body}
      {/* The spacer takes what the page leaves of the pane height: the buttons sit on its last row, or follow a taller page. */}
      <Box flexGrow={1} />
      {rule}
      {buttonsRow}
    </Box>
  )
}
