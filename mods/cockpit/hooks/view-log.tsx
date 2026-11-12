import type { CockpitLogEntry } from '../types'
import { agentLog } from './agents'
import { isFading } from './anim'
import { groupDone } from './done-groups'
import type { DoneEvent, DoneGroup } from './done-groups'
import { COLORS, abbrevTokens, clockTime, costCell, duration, localDate, modelFamily, padCells, shortModel, spanWidth, textCells } from './shared'
import type { Span } from './shared'
import { loggedSignal, signalSeverity } from './signals'
import { t } from './strings'
import { agentIcon, pairRow, visibleAgents } from './view-agents'
import { animCell, dim, line, sp, spanNodes } from './view-base'
import { SEVERITY_COLORS, collapsible, signalIcon, signalText } from './view-kit'
import type { Block, Kit } from './view-kit'
import { activeRun, agentRunId, roundOf } from './workflow'

/** LOG shows this many nodes (an open one with its whole subtree); the rest sits behind its toggle. */
const DONE_ROWS = 5
/** A round's tools in the summary: the top three. */
const TOP_TOOLS = 3
/** The cells of a cost share (`100%`), of a cost, and of a node's label. */
const SHARE_W = 4
const COST_W = 7
const LABEL_W = 10
/** The cells of a node row left of its model counters: arrow, time, label, duration, cost, share. */
const LEFT_W = 40

type G = DoneGroup<DoneEntry>

/** A row of the tree: the icon and text of its kind; an agent also carries its model, cost, length and start. */
type DoneEntry = DoneEvent & {
  icon: Span
  text: string
  /** An agent's spawn label, which names its loop round under a flow. */
  desc?: string
  /** Dim, after the text. */
  detail?: string
  /** The time the row shows, when it is not `at`. */
  start?: number
  usd?: number
  ms?: number
  model?: string
}

/** `son5.5·high`: the short model and the effort, whichever there is. */
const modelEffort = (model: string | undefined, effort: string | number | undefined): string =>
  [shortModel(model).replace(' ', ''), effort === undefined ? '' : String(effort)].filter(Boolean).join('·')

/** The row of an agent entry. */
function agentEntry(e: CockpitLogEntry): DoneEntry {
  const detail = modelEffort(e.model, e.effort)
  const icon = agentIcon({ id: e.key ?? '', type: '', startedAt: 0, tokens: 0, status: 'done', isFailed: e.isFailed === true })
  return {
    at: e.at,
    kind: 'agent',
    icon,
    text: e.text ?? '?',
    ...(e.desc !== undefined && { desc: e.desc }),
    ...(e.runId !== undefined && { runId: e.runId }),
    ...(e.model !== undefined && { model: e.model }),
    ...(detail !== '' && { detail }),
    ...(e.ms !== undefined && { ms: e.ms, start: e.at - e.ms }),
    ...(e.usd !== undefined && { usd: e.usd }),
  }
}

/** The row of a log entry; none for a round and a flow, which are nodes of their own, and for a signal of a kind unknown. */
function logEntry(e: CockpitLogEntry): DoneEntry | undefined {
  const E = t().page.events
  switch (e.kind) {
    case 'round':
    case 'flow':
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
function doneSummary(g: G): string {
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

// ── Model counters ──

const FAMILIES = ['haiku', 'sonnet', 'opus', 'fable'] as const
const LONG_NAMES = ['hai', 'son', 'op', 'fab']
const SHORT_NAMES = ['h', 's', 'o', 'f']
type Counts = number[]

/** The agents of `events` by model family; an agent with no model or a model of no family is not counted. */
const countModels = (events: readonly DoneEntry[]): Counts => FAMILIES.map(f => events.filter(e => e.kind === 'agent' && modelFamily(e.model) === f).length)
const sumCounts = (list: readonly Counts[]): Counts => FAMILIES.map((_, i) => list.reduce((n, c) => n + (c[i] ?? 0), 0))

/** `hai x0 son x2 op x10 fab x3` (short: `h x0 s x2 o x10 f x3`), each number as wide as the widest of its column. */
function counterSpans(counts: Counts, widths: readonly number[], isShort: boolean): Span[] {
  const names = isShort ? SHORT_NAMES : LONG_NAMES
  return [dim(names.map((name, i) => `${name} x${String(counts[i] ?? 0).padStart(widths[i] ?? 1)}`).join(' '))]
}

// ── The tree ──

/** The figures of a node or an agent, dim: its length, its cost, its share of the session's cost; a cell with no data is left out. */
function figures(usd: number | undefined, ms: number | undefined, sessionUsd: number | undefined): Span[] {
  const share = usd !== undefined && sessionUsd !== undefined && sessionUsd > 0 ? `${Math.round((usd / sessionUsd) * 100)}%` : ''
  const cells = [...(ms !== undefined ? [duration(ms)] : usd !== undefined ? [' '.repeat(6)] : []), ...(usd === undefined ? [] : [costCell(usd, COST_W)]), ...(share === '' ? [] : [share.padStart(SHARE_W)])]
  return cells.flatMap((c, i) => [...(i > 0 ? [sp(' ')] : []), dim(c)])
}

/** When a node began: its end less its length; the open round and a merged run only know their `at`. */
const startOf = (g: G): number => (g.ms !== undefined && !g.isCurrent ? g.at - g.ms : g.at)

type Tree = {
  /** The open nodes (IN CORSO): the open round and the run still open or silent. */
  live: G[]
  /** The closed nodes (LOG), newest first. */
  closed: G[]
  widths: number[]
  isShort: boolean
  /** What a live run's node shows after its name. */
  detail: Map<string, { text: string; isSilent: boolean }>
}

function buildTree(k: Kit): Tree {
  const { s, width } = k
  const log = s.sessionLog ?? []
  // An agent that just finished is logged as it ends; one still listed and not yet in the log shows once all the same.
  const logged = new Set(log.filter(e => e.kind === 'agent').map(e => e.key))
  const pending = visibleAgents(s).filter(a => a.status === 'done' && !logged.has(a.id)).flatMap(a => agentLog(a, agentRunId(s.workflowRun, a)) ?? [])
  const all = [...log, ...pending]
  const entries = all.flatMap(e => logEntry(e) ?? [])

  // the run not logged yet (open, or closed by silence) is a node of IN CORSO
  const run = s.workflowRun
  const detail: Tree['detail'] = new Map()
  let openFlow: CockpitLogEntry | undefined
  // a run reopened by a new spawn is live again: its logged node (closed) gives way to the open one
  const isReopened = run !== undefined && (activeRun(run) !== undefined || run.isSilent === true)
  const flowLog = isReopened ? log.filter(e => !(e.kind === 'flow' && e.key === run?.runId)) : log
  if (run !== undefined && !flowLog.some(e => e.kind === 'flow' && e.key === run.runId)) {
    const mine = all.filter(e => e.kind === 'agent' && e.runId === run.runId)
    const starts = mine.map(e => e.at - (e.ms ?? 0))
    const at = run.lastAt ?? s.now
    openFlow = { at, kind: 'flow', key: run.runId, usd: mine.reduce((n, e) => n + (e.usd ?? 0), 0), ...(run.name !== undefined && { text: run.name }), ...(starts.length > 0 && { ms: Math.max(0, at - Math.min(...starts)) }) }
    const progress = [run.phase ?? '—', `${run.agents.filter(a => a.isDone).length}/${run.agents.length}`].join(' · ')
    detail.set(`flow:${run.runId}`, run.isSilent === true ? { text: signalText({ kind: 'workflow', key: `${run.runId}:stall`, label: 'stall' }).what.replace(/^workflow /i, ''), isSilent: true } : { text: progress, isSilent: false })
  }
  const launches = [...flowLog.filter(e => e.kind === 'flow'), ...(openFlow ? [openFlow] : [])].map((f): DoneEntry => ({ at: f.at - (f.ms ?? 0), kind: 'launch', icon: sp('→', COLORS.blue), text: `flow ${f.text ?? f.key ?? ''}` }))

  const groups = groupDone([...entries, ...launches], flowLog, openFlow)
  const live = groups.filter(g => g.isCurrent === true || g.flow?.isLive === true)
  const closed = groups.filter(g => !live.includes(g))
  const counts = groups.map(g => countModels(g.events))
  const widths = FAMILIES.map((_, i) => Math.max(1, ...[...counts, sumCounts(counts)].map(c => String(c[i] ?? 0).length)))
  const fullWidth = LONG_NAMES.reduce((n, name, i) => n + name.length + 2 + (widths[i] ?? 1), 0) + 3
  return { live, closed, widths, isShort: width - 2 < LEFT_W + 1 + fullWidth, detail }
}

/** The label of a node, cut to its cell so the figures keep their columns; the detail a live run adds goes after the figures. */
function nodeLabel(g: G, tree: Tree): { label: Span; after: Span[] } {
  const E = t().page.events
  if (g.flow !== undefined) {
    const live = tree.detail.get(g.key)
    const text = `flow ${g.flow.name ?? g.flow.runId}`.slice(0, LABEL_W)
    const label = live?.isSilent ? sp(text, COLORS.amber) : g.flow.isFailed ? sp(text, COLORS.red) : sp(text)
    return { label, after: live === undefined ? [] : [sp(' '), live.isSilent ? sp(`· ${live.text}`, COLORS.amber) : dim(`· ${live.text}`)] }
  }
  return { label: sp(g.isCurrent ? E.current : g.chatOnly !== undefined ? E.chatOnly(g.chatOnly) : E.round(g.round ?? 0)), after: [] }
}

/** The header of a node: toggle arrow (a dash when empty), start time (not the open round's), label, length, cost and share of the session's cost, the model counters at the row's end. */
function nodeHeader(k: Kit, tree: Tree, g: G, isOpen: boolean): { arrow: Span; rest: Span[] } {
  const { width, s } = k
  const { label, after } = nodeLabel(g, tree)
  const left = [...(g.isCurrent ? [] : [dim(clockTime(startOf(g))), sp(' ')]), { ...label, t: padCells(label.t, LABEL_W) }, ...(figures(g.usd, g.ms, s.cost.usd).length > 0 ? [sp(' '), ...figures(g.usd, g.ms, s.cost.usd)] : []), ...after]
  // a node with nothing under it opens nothing: a dash, not an arrow
  return { arrow: sp(g.events.length === 0 ? '- ' : isOpen ? '▾ ' : '▸ '), rest: pairRow(left, counterSpans(countModels(g.events), tree.widths, tree.isShort), width - 2) }
}

/** An event row at `prefix`'s depth: time, icon, text, an agent also its model and figures at the end. */
function eventRow(k: Kit, e: DoneEntry, prefix: string): Block {
  const left = [dim(clockTime(e.start ?? e.at)), sp(' '), e.icon, sp(' '), sp(e.text), ...(e.detail === undefined ? [] : [sp(' '), dim(e.detail)])]
  return line(k.ui, [sp(prefix, COLORS.rule), ...pairRow(left, e.kind === 'agent' ? figures(e.usd, e.ms, k.s.cost.usd) : [], k.width - textCells(prefix))])
}

/** The rows under an open node: a round's summary and events; a run's agents, by the round their label names where it names one. */
function nodeChildren(k: Kit, tree: Tree, g: G): Block[] {
  const { ui, width } = k
  const summary = g.flow === undefined ? doneSummary(g) : ''
  const head: Block[] = summary === '' ? [] : [[line(ui, [sp('├ ', COLORS.rule), dim(summary)])]]
  const byRound = new Map<number, DoneEntry[]>()
  const flat: DoneEntry[] = []
  for (const e of g.events) {
    const n = g.flow !== undefined && e.kind === 'agent' ? roundOf(e.desc ?? e.text) : undefined
    if (n === undefined) flat.push(e)
    else byRound.set(n, [...(byRound.get(n) ?? []), e])
  }
  const items: ((isLast: boolean) => Block[])[] = [
    ...[...byRound.entries()].sort((a, b) => b[0] - a[0]).map(([n, evs]) => (isLast: boolean): Block[] => {
      const costs = evs.flatMap(e => (e.usd === undefined ? [] : [e.usd]))
      const starts = evs.map(e => e.start ?? e.at)
      const ms = Math.max(...evs.map(e => e.at)) - Math.min(...starts)
      const left = [sp(`R${n}`), ...(figures(costs.length > 0 ? costs.reduce((a, b) => a + b, 0) : undefined, ms, k.s.cost.usd).length > 0 ? [sp(' ')] : []), ...figures(costs.length > 0 ? costs.reduce((a, b) => a + b, 0) : undefined, ms, k.s.cost.usd)]
      return [
        line(ui, [sp(isLast ? '└ ' : '├ ', COLORS.rule), ...pairRow(left, counterSpans(countModels(evs), tree.widths, tree.isShort), width - 2)]),
        ...evs.map((e, i) => eventRow(k, e, `${isLast ? '  ' : '│ '}${i === evs.length - 1 ? '└ ' : '├ '}`)),
      ]
    }),
    ...flat.map(e => (isLast: boolean): Block[] => [eventRow(k, e, isLast ? '└ ' : '├ ')]),
  ]
  return [...head, ...items.flatMap((item, i) => item(i === items.length - 1))]
}

/** A node: its header (a button while it holds something) and, open, its children. `isNewest` fades the header from its highlight. */
function nodeBlock(k: Kit, tree: Tree, g: G, isOpen: boolean, isNewest: boolean): Block {
  const { ui, actions } = k
  const { Box, Button, Text } = ui
  const { arrow, rest } = nodeHeader(k, tree, g, isOpen)
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
  return [header, ...(isOpen ? nodeChildren(k, tree, g) : [])]
}

/** A day's row: a toggle (arrow, date) with `right` at the row's end. */
export function dayRow(k: Kit, key: string, date: string, isOpen: boolean, right: readonly Span[]): Block {
  const { ui, actions, width } = k
  const { Button, Text } = ui
  return [
    <Button key={key} plain onPress={() => actions.setGroupOpen(key, !isOpen)}>
      <Text wrap="truncate">{spanNodes(ui, pairRow([sp(isOpen ? '▾ ' : '▸ '), dim(date)], right, width))}</Text>
    </Button>,
  ]
}

/** IN CORSO's nodes: the open round and the run still open or silent, each open until a person closes it. */
export function liveBlocks(k: Kit): Block[] {
  const tree = buildTree(k)
  return tree.live.map(g => nodeBlock(k, tree, g, g.events.length > 0 && (k.s.groupsOpen?.[g.key] ?? true), false))
}

/**
 * The session log: the closed nodes (main rounds and workflow runs) newest first, each a toggle row (start time, label, length, cost, its share of the
 * session's cost, model counters) over its children in a tree; the newest is open until a person gives it a state, which stays. Under a day row
 * (`2026-11-11`, a toggle, newest day open) when the nodes span two or more local days. The nodes count, not their lines: the newest five, the rest
 * behind the toggle.
 */
export function doneBlocks(k: Kit): Block[] {
  const { ui, s, width, actions } = k
  const S = t()
  const tree = buildTree(k)
  const { closed } = tree
  if (closed.length === 0) return []

  const counts = closed.map(g => countModels(g.events))
  const total = sumCounts(counts)
  // a node's day is its end's, the time the nodes are sorted by, so each day's nodes stay together
  const days = [...new Set(closed.map(g => localDate(g.at)))]
  const isDays = days.length > 1
  const seen = new Set<string>()
  const rows: Block[] = []
  closed.forEach((g, gi) => {
    const date = localDate(g.at)
    const dayKey = `day:log:${date}`
    const isDayOpen = !isDays || (s.groupsOpen?.[dayKey] ?? days[0] === date)
    const first = isDays && !seen.has(date)
    seen.add(date)
    const dayHead: Block[] = first ? [dayRow(k, dayKey, date, isDayOpen, counterSpans(sumCounts(closed.flatMap((x, i) => (localDate(startOf(x)) === date ? [counts[i] ?? []] : []))), tree.widths, tree.isShort))] : []
    if (!isDayOpen) {
      if (first) rows.push(dayHead)
      return
    }
    const isOpen = g.events.length > 0 && (s.groupsOpen?.[g.key] ?? gi === 0)
    const isNewest = gi === 0 && ui.Client !== undefined && isFading(g.at, s.now)
    rows.push([...dayHead, nodeBlock(k, tree, g, isOpen, isNewest)])
  })

  const counters = counterSpans(total, tree.widths, tree.isShort)
  const label = S.page.done
  const rule = '─'.repeat(Math.max(0, width - textCells(label) - 2 - spanWidth(counters)))
  const title = line(ui, [sp(label, COLORS.title, true), sp(' '), sp(rule, COLORS.rule), sp(' '), ...counters])
  return [[title, collapsible(k, 'done', rows, DONE_ROWS, s.openKeys?.includes('done') === true, () => actions.toggleOpen('done'))]]
}


