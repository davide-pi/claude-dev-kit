import type { Elements, RenderElement, RenderSurface } from 'claude-code'

import type { CockpitAgent, CockpitAlm, CockpitSnapshot, CockpitTab, CockpitTask } from '../types'
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
  parseReset,
  pctCell,
  rateColor,
  resetClock,
  shortModel,
  signedPctCell,
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
export type Ui = Pick<Elements[RenderSurface], 'Box' | 'Text' | 'Button'>

const CTX_TEXT_MIN = '100% 999K/1M +99K'.length
const FIVE_HOURS = 18000
const SEVEN_DAYS = 604800
const MAX_AGENT_ROWS = 10
const MAX_HISTORY_ROWS = 10
const MAX_LIVE_ROWS = 5
/** Below this pane width the tab bar uses the short labels: the full bar is 48 cells at its widest. */
const TAB_SHORT_BELOW = 48
/** Cells a terminal Button adds around its label (`[ label ]`), and between two of a row. */
const BUTTON_CHROME = 4
const BUTTON_GAP = 1
/** The context fill from which the Sessione view warns and offers to compact. */
const CTX_WARN_PCT = 80
const TAB_NAMES: Record<CockpitTab, string> = { session: 'Sessione', agents: 'Agenti', work: 'Lavoro', repo: 'Repo' }
const TAB_NAMES_SHORT: Record<CockpitTab, string> = { session: 'Sess', agents: 'Agen', work: 'Lav', repo: 'Repo' }
const ALM_LABEL = 'ALM '
const MAX_TASK_ROWS = 6
const TASK_TIME_W = 6

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

type RateRow = { rem: number; used: number; color: string; resetMs: number | undefined; pace?: { target: number; delta: number } }

function rateRow(s: CockpitSnapshot, kind: 'five_hour' | 'seven_day'): RateRow | undefined {
  const w = s.rateLimits.find(r => r.kind === kind)
  if (!w) return undefined
  const resetMs = parseReset(w.resetsAt)
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

/** The ALM row cut to `width`: dim label then the target, or `ALM non mappato` in red; empty for a root that names nothing. */
export function almSpans(alm: CockpitAlm, width: number): Span[] {
  const text = almText(alm)
  if (text === '') return []
  const target = truncMiddle(text, Math.max(0, width - ALM_LABEL.length))
  return alm.isMapped ? [dim(ALM_LABEL), sp(target)] : [sp(ALM_LABEL + target, COLORS.red)]
}

export function agentRow(a: CockpitAgent, depth: number, now: number, width: number): Span[] {
  const nameW = Math.max(6, width - 27)
  const prefix = depth > 0 ? `${'  '.repeat(depth - 1)}└ ` : ''
  const isRunning = a.status === 'running'
  const end = a.endedAt ?? now
  return [
    isRunning ? sp('◐', COLORS.blue) : a.isInterrupted ? sp('■', COLORS.dim) : a.isFailed ? sp('✗', COLORS.red) : sp('✓', COLORS.green),
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

type Node = RenderElement | false | undefined
type Block = (Node | readonly Node[])[]

/** What a press does; the register module holds the engine, the view only names the acts. */
export type PaneActions = {
  selectTab: (tab: CockpitTab) => void
  compact: () => void
  runWorklog: () => void
  /** Copies `branch` on the surface the press came from. */
  copyBranch: (branch: string, surface: RenderSurface) => void
  /** Puts the agent's transcript in the main view. */
  openAgent: (agentId: string) => void
  toggleHistory: () => void
}

export function paneView(ui: Ui, s: CockpitSnapshot, bodyColumns: number, actions: PaneActions): RenderElement {
  const { Box, Text, Button } = ui
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

  // An agent row is a Button: a press puts the agent's transcript in the main view.
  const agentButton = (key: string, a: CockpitAgent, depth: number) => (
    <Button key={key} plain onPress={() => actions.openAgent(a.id)}>
      {spanNodes(ui, agentRow(a, depth, s.now, width))}
    </Button>
  )

  const tab = s.tab ?? 'session'
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
  const names = width < TAB_SHORT_BELOW ? TAB_NAMES_SHORT : TAB_NAMES
  const tabBar = (
    <Box columnGap={1}>
      {tabButton('session', names.session)}
      {tabButton('agents', running.length > 0 ? `${names.agents} ${running.length}` : names.agents)}
      {tabButton('work', names.work, wlRows.length > 0)}
      {tabButton('repo', names.repo)}
    </Box>
  )

  // ── Folder · branch · diffs grid ──
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

  // ALM target of the folder (absent without a workspaces map, or a mapped root that names nothing)
  const almLine = s.alm ? almSpans(s.alm, width) : []
  const almRow = almLine.length > 0 && line(ui, almLine)

  // ── Sessione ──

  // Header: model + effort | session cost (always: `$0.00` before the first turn) and the last turn's delta
  const costDelta = fmtCostDelta(delta(s.cost.usd, s.cost.startUsd))
  const header = (
    <Box justifyContent="space-between">
      {line(ui, [sp(displayModel(s.model) || '—', COLORS.blue), ...headerEffort(s.effort)])}
      {line(ui, [sp(fmtCost(s.cost.usd), COLORS.yellow, true), ...(costDelta ? [sp(' '), dim(costDelta)] : [])])}
    </Box>
  )

  // The one bar width of the context and credit rows: what is left of the widest readout.
  const five = rateRow(s, 'five_hour')
  const seven = rateRow(s, 'seven_day')
  const fiveText = five && rateText('5h', five, s.now)
  const sevenText = seven && rateText('7d', seven, s.now)
  const ctxText = contextText(s)
  const textCol = Math.max(CTX_TEXT_MIN, ...[ctxText, fiveText, sevenText].map(t => spanWidth(t ?? [])))
  const barW = Math.max(4, width - textCol - 1)

  // CONTESTO: the cache share of the last main-loop turn sits right of the title; from 80% a red line and the way out
  const pct = s.ctx.percent ?? 0
  const ctxBar = line(ui, barCells(barW, [{ pct, color: ctxColor(pct) }]))
  const cacheSpans: Span[] = s.cacheShare === undefined ? [] : [dim('cache '), sp(pctCell(s.cacheShare))]
  const ctxWarning = pct >= CTX_WARN_PCT && (
    <Box justifyContent="space-between">
      {line(ui, [sp(`⚠ contesto al ${Math.round(pct)}%`, COLORS.red)])}
      <Button key="compact-now" variant="primary" onPress={() => actions.compact()}>
        compatta ora
      </Button>
    </Box>
  )

  // CREDITI RESIDUI
  const paceDelta = seven?.pace?.delta
  const paceSpans: Span[] =
    paceDelta === undefined
      ? []
      : [dim('vs atteso 7d '), sp(signedPctCell(paceDelta), paceDelta < 0 ? COLORS.red : COLORS.green, true)]
  const creditRow = (r: RateRow, text: Span[]) => {
    const gap = r.pace && r.pace.delta < 0 ? -r.pace.delta : 0
    const parts = [{ pct: r.rem, color: r.color }, ...(gap ? [{ pct: gap, color: COLORS.gap }] : [])]
    return split(line(ui, barCells(barW, parts)), barW, text)
  }

  // The 5h burn rate: absent until 10 minutes of readings show the credits falling
  const burn = five && burnRate(s.fiveHourSamples ?? [], s.now, five.used, five.resetMs)
  const burnRow = burn && line(ui, [sp(burnText(burn), burn.isBeforeReset ? COLORS.red : COLORS.green)])

  // Running agents, compact
  const liveRows = orderAgents(running)
  const liveAgents = [
    gap(),
    title(`AGENTS · ${running.length} in corso`, modelCounts(running)),
    liveRows.length > 0 && gap(),
    liveRows.slice(0, MAX_LIVE_ROWS).map(({ agent, depth }) => agentButton(`agent:${agent.id}`, agent, depth)),
    liveRows.length > MAX_LIVE_ROWS && line(ui, [dim(`… +${liveRows.length - MAX_LIVE_ROWS}`)]),
  ]

  // A detached HEAD has no branch to copy. The row stacks when its buttons do not fit the pane side by side.
  const branch = g && !g.isDetached ? g.branch : undefined
  const quickLabels = ['compatta', '/worklog', ...(branch ? ['copia branch'] : [])]
  const quickButtons = (
    <Box
      flexDirection={buttonRowWidth(quickLabels) <= width ? 'row' : 'column'}
      alignItems="flex-start"
      columnGap={BUTTON_GAP}
    >
      <Button key="quick:compact" onPress={() => actions.compact()}>
        compatta
      </Button>
      <Button key="quick:worklog" onPress={() => actions.runWorklog()}>
        /worklog
      </Button>
      {branch && (
        <Button key="quick:branch" onPress={press => actions.copyBranch(branch, press.surface)}>
          copia branch
        </Button>
      )}
    </Box>
  )

  const sessionBlocks = [
    [header, grid, almRow],
    [gap(), title('CONTESTO', cacheSpans), gap(), split(ctxBar, barW, ctxText), ctxWarning],
    [
      gap(),
      title('CREDITI RESIDUI', paceSpans),
      gap(),
      five && fiveText && creditRow(five, fiveText),
      burnRow,
      five && seven && gap(),
      seven && sevenText && creditRow(seven, sevenText),
      !five && !seven && line(ui, [dim('nessun dato sui limiti')]),
    ],
    liveAgents,
    [gap(), quickButtons],
  ]

  // ── Agenti: every agent listed, finished ones for two minutes ──
  const rows = orderAgents(agents)
  const agentRows = rows.slice(0, MAX_AGENT_ROWS).flatMap(({ agent, depth }) => {
    const warn = agentWarning(agent, s.isSubagentModelForced)
    const out = [agentButton(`agent:${agent.id}`, agent, depth)]
    if (warn) out.push(line(ui, [sp(`${'  '.repeat(depth + 1)}⚠ ${warn}`, COLORS.yellow)]))
    return out
  })
  // STORICO: the agents that left the list, newest first, behind a toggle (collapsed by default)
  const history = s.history ?? []
  const isHistoryOpen = s.isHistoryOpen === true
  const historyBlock: Block[] =
    history.length === 0
      ? []
      : [
          [
            gap(),
            <Button key="history" plain onPress={() => actions.toggleHistory()}>
              <Text color={COLORS.title}>{`STORICO · ${history.length} ${isHistoryOpen ? '▾' : '▸'}`}</Text>
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
      title(`AGENTS · ${running.length} in corso`, modelCounts(agents)),
      rows.length > 0 && gap(),
      agentRows,
      rows.length > MAX_AGENT_ROWS && line(ui, [dim(`… +${rows.length - MAX_AGENT_ROWS}`)]),
    ],
    ...historyBlock,
  ]

  // ── Lavoro: the tasks (omitted with none) and the worklog warnings ──
  const counts = taskCounts(s)
  const open = openTasks(s)
  const taskBlock =
    counts === null
      ? []
      : [
          [
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
            open.slice(0, MAX_TASK_ROWS).map(t => line(ui, taskRow(t, s.now, width))),
            open.length > MAX_TASK_ROWS && line(ui, [dim(`… +${open.length - MAX_TASK_ROWS}`)]),
            counts.done > 0 && line(ui, [sp('✓', COLORS.green), dim(` ${counts.done} completati`)]),
          ],
        ]
  const worklogBlock =
    wlRows.length > 0 ? [[gap(), wlRows.map(text => line(ui, [sp('● ', COLORS.yellow), sp(text, COLORS.yellow)]))]] : []
  const workBlocks = [...taskBlock, ...worklogBlock]

  // ── Repo: the git grid ──
  const repoBlocks = [[gap(), grid, almRow]]

  // Blocks are told apart by a rule; an empty tab says so.
  const blocks: Block[] = { session: sessionBlocks, agents: agentBlocks, work: workBlocks, repo: repoBlocks }[tab]
  const body: Node[] = blocks.length > 0 ? blocks.flatMap((block, i) => [...(i > 0 ? [rule] : []), ...block.flat()]) : [gap(), line(ui, [dim('niente da mostrare')])]

  return (
    <Box flexDirection="column" width={width} marginLeft={bodyColumns - width}>
      {tabBar}
      {rule}
      {body}
    </Box>
  )
}
