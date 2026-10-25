import type { RenderElement } from 'claude-code'

import type { CockpitAgent, CockpitChange, CockpitNote, CockpitPr, CockpitProcSort, CockpitSnapshot, CockpitSysProc, CockpitTab } from '../types'
import { claudeStateSpans, sessionTokens } from './agents'
import { REFRESH_COOLDOWN_MS, autocompactForecast, ctxGrowth, openTasks, shouldCompact } from './context'
import { CALLS_SHOWN, insightHints, timeSplit } from './insights'
import { TABS, TAB_ICONS, worklogLabel } from './session'
import {
  COLORS,
  ICONS,
  abbrevTokens,
  barCells,
  baseName,
  cacheColor,
  ctxColor,
  displayModel,
  duration,
  fmtCost,
  fmtCostDelta,
  folderIcon,
  gridWidths,
  padCells,
  pctCell,
  signedPctCell,
  spanWidth,
  sparkline,
  taskBarCells,
  textCells,
  truncEnd,
  truncMiddle,
  truncateSpans,
} from './shared'
import type { Span } from './shared'
import { t } from './strings'
import { sortProcs } from './system'
import {
  agentIcon,
  agentRow,
  agentWarning,
  fitPair,
  modelCounts,
  orderAgents,
  subagentDetails,
  subagentFacts,
  taskCounts,
  taskRow,
  visibleAgents,
} from './view-agents'
import { BUTTON_GAP, CALL_TOOL_W, buttonRowWidth, delta, dim, line, pad, padStart, sp, spanNodes } from './view-base'
import type { Ui } from './view-base'
import { categoryRows, consumerSpans, contextBar, trendSpans } from './view-context'
import { almSpans, contextText, headerEffort, rateRow, rateText } from './view-header'
import type { RateRow } from './view-header'
import { bigResultSpans, hintText, toolCallSpans } from './view-insights'
import { procHeader, procParts, systemRowItems } from './view-system'
import { changeSpans, prDetailSpans, prSpans } from './view-work'
import { aheadBehindSpans, claimTime, claimsOf, repoRelative } from './work'

const CTX_TEXT_MIN = '100% 999K/1M +99K'.length

/** The context fill from which the header warns. */
const CTX_WARN_PCT = 80

const MAX_TASK_ROWS = 6
const MAX_OUTSIDE_ROWS = 5

const MAX_FILE_ROWS = 8

const MAX_PR_ROWS = 4

const NOTE_LINES_SHOWN = 3
/** The height of the note field: multi-line notes are common. */
const NOTE_INPUT_ROWS = 6

const MAX_SKILL_ROWS = 6
/** The Insights tab: the cells of a row's label, and the tool types listed. */
const INSIGHT_LABEL_W = 13
const MAX_TOOL_TYPES = 6

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
