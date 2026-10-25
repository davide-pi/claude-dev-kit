import type { RenderElement } from 'claude-code'

import type { CockpitAgent, CockpitChange, CockpitEvent, CockpitEventKind, CockpitNote, CockpitSnapshot, CockpitSysProc, CockpitTab } from '../types'
import { claudeStateSpans, sessionTokens } from './agents'
import { REFRESH_COOLDOWN_MS, autocompactForecast, ctxGrowth, openTasks, shouldCompact } from './context'
import { creditProjection, modelRows, perHour, roundCosts, topRounds } from './costs'
import { workItemIds, workItemUrl } from './links'
import { worklogLabel } from './session'
import { COLORS, abbrevTokens, countdown, ctxColor, duration, fmtCost, hhmm, shortModel, spanWidth, sparkline, taskBarCells, textCells, truncEnd, truncMiddle, truncateSpans } from './shared'
import type { Span } from './shared'
import { agentCosts, signalsOf } from './signals'
import type { Signal } from './signals'
import { t } from './strings'
import { EVENT_KINDS, visibleEvents } from './timeline'
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
import { BUTTON_GAP, buttonRowWidth, dim, line, pad, sp, spanNodes } from './view-base'
import type { Ui } from './view-base'
import { categoryRows, consumerSpans, contextBar, trendSpans } from './view-context'
import { almSpans } from './view-header'
import { bigResultSpans } from './view-insights'
import { procParts } from './view-system'
import { changeSpans, prSpans } from './view-work'
import { repoRelative } from './work'
import { activeRun } from './workflow'

// ── What a tab draws with: the pane's actions and the helpers every tab shares ──

/** What a press does; the register module holds the engine, the view only names the acts. */
export type PaneActions = {
  selectTab: (tab: CockpitTab) => void
  compact: () => void
  /** Asks to confirm a button that sends something (`suite`: `/retro`) or logs hours (`worklog`). */
  ask: (kind: 'suite' | 'worklog') => void
  /** Answers the confirmation: yes runs what was asked, no drops it. */
  answer: (isYes: boolean) => void
  /** Puts the session's cost summary in the prompt box (no model call). */
  copySummary: () => void
  /** Puts the agent's transcript in the main view. */
  openAgent: (agentId: string) => void
  toggleHistory: () => void
  /** Asks for the exact count of the context breakdown (`full`: it spends token-count requests): the Costi tab's `refresh`, once a minute. */
  refresh: () => void
  /** Opens or closes the four token counters of an agent. */
  toggleUsage: (agentId: string) => void
  /** Opens or closes a note beyond its first lines. */
  toggleNote: (id: number) => void
  /** Draws the diff of a changed file in the second pane. */
  openDiff: (change: CockpitChange) => void
  /** Shows only one kind of event in the Cronologia (none: all). */
  filterEvents: (kind: CockpitEventKind | undefined) => void
  /** Keeps what the Note tab's field holds as the person types it. */
  setNoteDraft: (text: string) => void
  /** Saves the field as a note (replacing the one it was loaded from, if any): the text of the field on Enter, the kept draft when none is given. */
  saveNote: (text?: string) => void
  /** Loads a saved note into the field. */
  editNote: (id: number) => void
  /** Appends a saved note to the prompt box; the note stays in the list. */
  sendNote: (id: number) => void
  deleteNote: (id: number) => void
}

export type Node = RenderElement | false | undefined
export type Block = (Node | readonly Node[])[]

export type Kit = {
  ui: Ui
  s: CockpitSnapshot
  width: number
  actions: PaneActions
  /** An empty row. */
  gap: () => RenderElement
  /** A section's title, its right side under it when the two do not fit one row. */
  title: (label: string, right?: Span[]) => RenderElement
  /** `left` in `leftW` cells, `right` beside it. */
  split: (left: RenderElement, leftW: number, right: Span[]) => RenderElement
}

export function makeKit(ui: Ui, s: CockpitSnapshot, width: number, actions: PaneActions): Kit {
  const { Box, Text } = ui
  return {
    ui,
    s,
    width,
    actions,
    gap: () => <Text> </Text>,
    title: (label, right = []) => (
      <Box justifyContent="space-between" flexDirection={textCells(label) + 1 + spanWidth(right) <= width ? 'row' : 'column'}>
        {line(ui, [sp(label, COLORS.title)])}
        {line(ui, right)}
      </Box>
    ),
    split: (left, leftW, right) => (
      <Box>
        <Box width={leftW}>{left}</Box>
        <Box marginLeft={1}>{line(ui, right)}</Box>
      </Box>
    ),
  }
}

const MAX_TASK_ROWS = 6
const MAX_OUTSIDE_ROWS = 5
const MAX_FILE_ROWS = 8
const MAX_LINK_ROWS = 4
const MAX_AGENT_COST_ROWS = 6
const SPARK_MAX = 40
const NOTE_LINES_SHOWN = 3
/** The height of the note field: multi-line notes are common. */
const NOTE_INPUT_ROWS = 6

// ── Ora: what is happening now ──

/** The workflow run in flight with what it has cost so far (its agents' cost), or none. */
function workflowBlock(k: Kit): Block {
  const { s, width, gap, title, ui } = k
  const run = activeRun(s.workflowRun)
  if (!run) return []
  const S = t()
  const ids = new Set(run.agents.map(a => a.id))
  const usd = agentCosts(s.agents, s.events).filter(a => ids.has(a.id)).reduce((sum, a) => sum + a.usd, 0)
  const done = run.agents.filter(a => a.isDone).length
  return [
    gap(),
    title(run.name ? `${S.workflowTitle} · ${run.name}` : S.workflowTitle),
    gap(),
    line(ui, truncateSpans([sp(S.workflowLine(run.phase ?? '—', run.round, done, run.agents.length)), dim(' · '), sp(S.workflowCost(fmtCost(usd)), COLORS.yellow)], width)),
  ]
}

export function nowBlocks(k: Kit): Block[] {
  const { ui, s, width, gap, actions } = k
  const { Button, Text } = ui
  const S = t()
  const agents = visibleAgents(s)
  const running = agents.filter(a => a.status === 'running')

  // What Claude is doing: its state (and how long it has waited for an answer), the tool in flight, the last error
  const state = s.claudeState
  const waited = state?.kind === 'waiting' && state.since !== undefined ? Math.max(0, Math.floor((s.now - state.since) / 1000)) : undefined
  const lastError = s.insights?.lastError
  const stateBlock: Block = [
    gap(),
    line(ui, [...claudeStateSpans(state), ...(waited !== undefined ? [dim(`  ${S.waitingSince(waited)}`)] : [])]),
    state?.kind === 'tool' && state.tool ? line(ui, [sp('▸ ', COLORS.blue), dim(`${S.toolRunning} `), sp(state.tool)]) : undefined,
    lastError && line(ui, truncateSpans([sp('✗ ', COLORS.red), dim(`${lastError.tool}: `), dim(lastError.text)], width)),
  ]

  const agentButton = (key: string, a: CockpitAgent, depth: number) => (
    <Button key={key} plain onPress={() => actions.openAgent(a.id)}>
      <Text wrap="truncate">{spanNodes(ui, agentRow(a, depth, s.now, width))}</Text>
    </Button>
  )

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
    [gap(), line(ui, fitPair([sp(S.subagentsTitle(running.length), COLORS.title)], modelCounts(agents), width)), rows.length > 0 && gap(), agentRows],
    ...historyBlock,
  ]
  return [stateBlock, workflowBlock(k), ...agentBlocks].filter(b => b.length > 0)
}

// ── Segnali ──

/** The three lines of a signal: what, why it matters, what to do. */
export function signalText(sig: Signal): { what: string; why: string; todo: string } {
  const T = t().signalText
  switch (sig.kind) {
    case 'heavyAgent':
      return T.heavyAgent(sig.label ?? '?', sig.n ?? 0)
    case 'opusReadOnly':
      return T.opusReadOnly(sig.label ?? '?')
    case 'bigResult':
      return T.bigResult(sig.label ?? '?', sig.n ?? 0)
    case 'reread':
      return T.reread(sig.label ?? '?', sig.n ?? 0)
    case 'failedCommand':
      return T.failedCommand(sig.label ?? '?', sig.n ?? 0)
    case 'coldAfterIdle':
      return T.coldAfterIdle(sig.n ?? 0)
    case 'ctxGrowth':
      return T.ctxGrowth(sig.n ?? 0)
    case 'doneClaims':
      return T.doneClaims(sig.n ?? 0)
    case 'workflow':
      return T.workflow(sig.label ?? 'stall', sig.n)
    case 'permissionWait':
      return T.permissionWait(Math.round((sig.n ?? 0) / 1000))
  }
}

export function signalsBlocks(k: Kit): Block[] {
  const { ui, s, width, gap, title } = k
  const S = t()
  const signals = signalsOf(s)
  if (signals.length === 0) return [[gap(), title(S.signalsTitle(0)), gap(), line(ui, [dim(S.noSignals)])]]
  return [
    [
      gap(),
      title(S.signalsTitle(signals.length)),
      signals.flatMap(sig => {
        const text = signalText(sig)
        return [
          gap(),
          line(ui, [sp('⚠ ', COLORS.yellow), sp(truncEnd(text.what, Math.max(4, width - 2)), COLORS.yellow, true)]),
          line(ui, [dim(`  ${S.signalFields.why}${text.why}`)]),
          line(ui, [dim(`  ${S.signalFields.todo}${text.todo}`)]),
        ]
      }),
    ],
  ]
}

// ── Cronologia ──

const EVENT_COLORS: Record<CockpitEventKind, string | undefined> = {
  round: undefined,
  skill: COLORS.lavender,
  agent: COLORS.blue,
  compaction: COLORS.amber,
  error: COLORS.red,
  block: COLORS.yellow,
  stall: COLORS.red,
}

/** One event's text, from its kind's words. */
export function eventText(e: CockpitEvent): string {
  const R = t().eventRow
  switch (e.kind) {
    case 'round':
      return R.round(fmtCost(e.usd), duration(e.ms ?? 0))
    case 'skill':
      return R.skill(e.text ?? '?')
    case 'agent':
      return R.agent(e.text ?? '?', shortModel(e.model) || '—', fmtCost(e.usd))
    case 'compaction':
      return R.compaction
    case 'error':
      return R.error(e.text ?? '')
    case 'block':
      return R.block(e.text ?? '')
    case 'stall':
      return R.stall(e.text ?? '')
  }
}

export function historyBlocks(k: Kit): Block[] {
  const { ui, s, width, gap, title, actions } = k
  const { Box, Button } = ui
  const S = t()
  const all = s.events ?? []
  const shown = visibleEvents(all, s.eventFilter)
  const filters = (
    <Box columnGap={1} flexWrap="wrap">
      <Button key="filter:all" variant={s.eventFilter === undefined ? 'primary' : 'secondary'} label={S.filterAll} onPress={() => actions.filterEvents(undefined)} />
      {EVENT_KINDS.map(kind => (
        <Button key={`filter:${kind}`} variant={s.eventFilter === kind ? 'primary' : 'secondary'} label={S.eventKinds[kind]} onPress={() => actions.filterEvents(kind)} />
      ))}
    </Box>
  )
  return [
    [
      gap(),
      title(S.eventsTitle(shown.length, all.length)),
      gap(),
      filters,
      gap(),
      shown.length === 0 ? line(ui, [dim(S.noEvents)]) : shown.map(e => line(ui, truncateSpans([dim(`${hhmm(e.at)} `), sp(eventText(e), EVENT_COLORS[e.kind])], width))),
    ],
  ]
}

// ── Costi ──

export function costsBlocks(k: Kit): Block[] {
  const { ui, s, width, gap, title, actions } = k
  const { Button } = ui
  const S = t()

  // $ per round: a sparkline of the last rounds and the three dearest
  const rounds = roundCosts(s.events)
  const top = topRounds(rounds)
  const roundsBlock: Block =
    rounds.length > 0
      ? [
          gap(),
          title(S.costRounds(rounds.length), [dim(S.costTop)]),
          gap(),
          line(ui, [sp(sparkline(rounds.slice(-SPARK_MAX).map(r => r.usd)), COLORS.yellow)]),
          top.map(r => line(ui, [dim(`#${r.n} `), sp(fmtCost(r.usd), COLORS.yellow), dim(` · ${duration(r.ms)}`)])),
        ]
      : []

  // $ and cache hit per agent and per model, priced from the usage counters
  const nameW = Math.max(6, width - 24)
  const costRow = (name: string, usd: number, hit: number | undefined) =>
    line(ui, [sp(pad(truncMiddle(name, nameW), nameW)), sp(` ${fmtCost(usd).padStart(7)}`, COLORS.yellow), dim(hit === undefined ? '' : `  ${S.costCacheHit} ${hit}%`)])
  const agents = agentCosts(s.agents, s.events).sort((a, b) => b.usd - a.usd).slice(0, MAX_AGENT_COST_ROWS)
  const agentsBlock: Block = agents.length > 0 ? [gap(), title(S.costAgentsTitle), gap(), agents.map(a => costRow(`${a.type} ${shortModel(a.model)}`.trim(), a.usd, a.hit))] : []
  const models = modelRows(s.modelUse)
  const modelsBlock: Block = models.length > 0 ? [gap(), title(S.costModelsTitle), gap(), models.map(m => costRow(shortModel(m.model) || m.model, m.usd, m.hit))] : []

  // $/h and where the 5h credits go at this pace (the status line's rate cache stands in while the engine reports none)
  const rate = perHour(s.cost.usd, s.startedAt, s.now)
  const projection = creditProjection(s.rateLimits.length > 0 ? s.rateLimits : (s.lastRates ?? []), s.now)
  const rateBlock: Block =
    rate !== undefined || projection !== undefined
      ? [
          gap(),
          title(S.costProjectionTitle, rate === undefined ? [] : [sp(S.costRate(fmtCost(rate)), COLORS.yellow)]),
          gap(),
          projection &&
            line(
              ui,
              truncateSpans(
                projection.kind === 'hold' ? [sp(S.creditsHold, COLORS.green)] : [sp(S.creditsRunOut(duration(projection.inMs), countdown(projection.resetsAt, s.now)), COLORS.red)],
                width,
              ),
            ),
        ]
      : []

  // ── Context by category (the old Context tab), with the exact count behind `refresh` ──
  const context = s.context
  const ctxRounds = s.ctxRounds ?? []
  const forecast = autocompactForecast(s.ctxSamples, s.autoCompactAt)
  const hint = shouldCompact({ percent: s.ctx.percent, rounds: ctxRounds, forecast })
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
  const trend = trendSpans(ctxRounds, ctxGrowth(s.ctxSamples), forecast, ctxColor(s.ctx.percent ?? 0), width)
  const trendBlock: Block = trend.length > 0 ? [gap(), title(S.trendTitle(ctxRounds.length)), gap(), line(ui, trend)] : []
  // the five outputs that grew the context since the last compaction
  const biggest = s.insights?.biggest ?? []
  const grewBlock: Block = biggest.length > 0 ? [gap(), title(S.grewTitle), gap(), biggest.map(r => line(ui, bigResultSpans(r, width)))] : []

  const blocks = [roundsBlock, agentsBlock, modelsBlock, rateBlock, breakdownBlock, consumersBlock, trendBlock, grewBlock].filter(b => b.length > 0)
  return rounds.length + agents.length + models.length === 0 && rateBlock.length === 0 ? [[gap(), line(ui, [dim(S.noCosts)])], ...blocks] : blocks
}

// ── Lavoro ──

/** The question and its yes / no row. */
function confirmRow(k: Kit, question: string): Block {
  const { ui, gap, actions, width } = k
  const { Box, Button } = ui
  return [
    line(ui, truncateSpans([sp(question, COLORS.yellow)], width)),
    <Box columnGap={BUTTON_GAP}>
      <Button key="confirm:yes" onPress={() => actions.answer(true)}>
        {t().buttons.yes}
      </Button>
      <Button key="confirm:no" onPress={() => actions.answer(false)}>
        {t().buttons.no}
      </Button>
    </Box>,
    gap(),
  ]
}

export function workBlocks(k: Kit): Block[] {
  const { ui, s, width, gap, title, actions } = k
  const { Button, Link, Text } = ui
  const S = t()
  const wl = s.worklog

  // The ALM target of the folder (absent without a workspaces map, or a mapped root that names nothing)
  const almLine = s.alm ? almSpans(s.alm, width) : []
  const almPart: Block = almLine.length > 0 ? [gap(), line(ui, almLine)] : []

  const counts = taskCounts(s)
  const open = openTasks(s)
  const taskPart: Block =
    counts === null
      ? []
      : [
          gap(),
          title(`${S.taskTitle} · ${counts.done}/${counts.total}`, [sp(`◐ ${counts.inProgress}`, COLORS.blue), sp('  '), dim(`○ ${counts.pending}`), sp('  '), sp(`✓ ${counts.done}`, COLORS.green)]),
          gap(),
          line(ui, taskBarCells(width, counts.done, counts.inProgress, counts.total)),
          open.slice(0, MAX_TASK_ROWS).map(task => line(ui, taskRow(task, s.now, width))),
          open.length > MAX_TASK_ROWS && line(ui, [dim(`… +${open.length - MAX_TASK_ROWS}`)]),
          counts.done > 0 && line(ui, [sp('✓', COLORS.green), dim(S.tasksDone(counts.done))]),
        ]
  const wlRows = [...(wl.pending.length ? [worklogLabel('pending', wl.pending)] : []), ...(wl.underTarget.length ? [worklogLabel('underTarget', wl.underTarget)] : [])]
  const worklogPart: Block = wlRows.length > 0 ? [gap(), wlRows.map(text => line(ui, [sp('● ', COLORS.yellow), sp(text, COLORS.yellow)]))] : []

  // The deliver perimeter: its entries, the files touched since HEAD and the ones outside it (none claimed when git could not say)
  const check = s.perimeterCheck
  const outside = check?.outside ?? []
  const perimeterPart: Block =
    s.perimeter === undefined
      ? []
      : [
          gap(),
          line(ui, [dim(S.perimeter(s.perimeter.length)), ...(check ? [dim(S.filesTouched(check.files))] : [])]),
          check && (outside.length === 0 ? line(ui, [sp('✓ ', COLORS.green), dim(S.noFileOutside)]) : line(ui, [sp(S.filesOutside(outside.length), COLORS.red)])),
          outside.slice(0, MAX_OUTSIDE_ROWS).map(file => line(ui, [sp(`  ${truncMiddle(file, Math.max(4, width - 2))}`, COLORS.yellow)])),
          outside.length > MAX_OUTSIDE_ROWS && line(ui, [dim(`  … +${outside.length - MAX_OUTSIDE_ROWS}`)]),
        ]
  const principalBlock: Block[] = perimeterPart.length + taskPart.length + worklogPart.length > 0 ? [[gap(), title(S.mainTitle), ...perimeterPart, ...taskPart, ...worklogPart]] : []

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

  // Links only: the pull requests of this chat (newest first) and the work items its branch and pull requests name
  const prs = [...(s.prs ?? [])].reverse()
  const items = workItemIds(s)
  const linkRows: Node[] = [
    ...prs.slice(0, MAX_LINK_ROWS).map(pr => (
      <Text wrap="truncate">
        {pr.url !== undefined ? <Link href={pr.url}>{`#${pr.number}`}</Link> : <Text>{`#${pr.number}`}</Text>}
        {spanNodes(ui, prSpans(pr, width))}
      </Text>
    )),
    prs.length > MAX_LINK_ROWS && line(ui, [dim(`… +${prs.length - MAX_LINK_ROWS}`)]),
    ...items.slice(0, MAX_LINK_ROWS).map(id => {
      const url = workItemUrl(s.alm, id)
      return (
        <Text wrap="truncate">
          {url !== undefined ? <Link href={url}>{`AB#${id}`}</Link> : <Text>{`AB#${id}`}</Text>}
          <Text dimColor>{` ${S.workItemsTitle}`}</Text>
        </Text>
      )
    }),
  ]
  const linksPart: Block = prs.length + items.length > 0 ? [gap(), title(S.linksTitle(prs.length + items.length)), gap(), linkRows] : []

  // The session's processes with the ports they listen on: read only while this tab is open; a port is a link to it on localhost
  const procs = s.procs ?? []
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
  const procsPart: Block = [
    gap(),
    title(procs.length > 0 ? `${S.procsTitle} · ${procs.length}` : S.procsTitle),
    gap(),
    s.isProcsOff === true ? line(ui, [dim(S.procsOff)]) : procs.length === 0 ? line(ui, [dim(S.noProcs)]) : procs.map(procRow),
  ]

  // `log hours` logs the hours of this chat: here only, behind a confirmation
  const logPart: Block =
    s.sessionId === undefined
      ? []
      : [
          gap(),
          ...(s.confirm === 'worklog'
            ? confirmRow(k, S.confirmLog)
            : [
                <Button key="bar:worklog" onPress={() => actions.ask('worklog')}>
                  {S.buttons.logHours}
                </Button>,
              ]),
        ]

  return [almPart, ...principalBlock, changesPart, linksPart, procsPart, logPart].filter(b => b.length > 0)
}

// ── Note ──

export function notesBlocks(k: Kit): Block[] {
  const { ui, s, width, gap, title, actions } = k
  const { Box, Button, Input, Text } = ui
  const S = t()
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
  return [
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
}

/** The blocks of the selected tab; the others are not built. */
export function tabBlocks(tab: CockpitTab, k: Kit): Block[] {
  switch (tab) {
    case 'agents':
      return nowBlocks(k)
    case 'signals':
      return signalsBlocks(k)
    case 'history':
      return historyBlocks(k)
    case 'context':
      return costsBlocks(k)
    case 'work':
      return workBlocks(k)
    case 'notes':
      return notesBlocks(k)
  }
}
