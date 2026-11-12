import type { CockpitLogEntry } from '../types'
import { agentLog } from './agents'
import { isFading } from './anim'
import { groupDone } from './done-groups'
import type { DoneEvent, DoneGroup } from './done-groups'
import { COLORS, abbrevTokens, clockTime, costCell, duration, localDate, spanWidth, textCells } from './shared'
import type { Span } from './shared'
import { loggedSignal, signalSeverity } from './signals'
import { t } from './strings'
import { agentIcon, pairRow, visibleAgents } from './view-agents'
import type { CockpitAgent } from '../types'
import { animCell, dim, line, sp, spanNodes } from './view-base'
import { SEVERITY_COLORS, collapsible, signalIcon, signalText } from './view-kit'
import type { Block, Kit } from './view-kit'
import { ALL_KEY, LABEL_W, detailRows, filesText, isAllShown, isExpandable, isMainEntry, linkAnchor, modelSpans, roundHeader, summarySpans } from './view-log-round'
import { activeRun, agentRunId, roundOf } from './workflow'

/** LOG shows this many nodes (an open one with its whole subtree); the rest sits behind its toggle. */
const DONE_ROWS = 5
/** The cells of the three figure slots at a row's end: a length (`01m00s`), a cost, a cost share (`100%`). */
const DURATION_W = 6
const COST_W = 7
const SHARE_W = 4

type G = DoneGroup<DoneEntry>

/** A row of the tree: the icon and text of its kind; an agent also carries its model, cost, length and start. */
type DoneEntry = DoneEvent & {
  icon: Span
  text: string
  /** An agent's id: the commit, test or PR it made names it in `agent`. */
  key?: string
  /** The flow agent that made a commit, test or PR: the row sits under it. */
  agent?: string
  /** An agent's spawn label, which names its loop round under a flow. */
  desc?: string
  effort?: string | number
  /** An agent that still runs: its icon spins. */
  isRunning?: boolean
  /** The time the row shows, when it is not `at`. */
  start?: number
  usd?: number
  ms?: number
  model?: string
}

/** The row of an agent entry. */
function agentEntry(e: CockpitLogEntry): DoneEntry {
  const icon = agentIcon({ id: e.key ?? '', type: '', startedAt: 0, tokens: 0, status: 'done', isFailed: e.isFailed === true })
  return {
    at: e.at,
    kind: 'agent',
    icon,
    ...(e.key !== undefined && { key: e.key }),
    text: e.text ?? '?',
    ...(e.desc !== undefined && { desc: e.desc }),
    ...(e.runId !== undefined && { runId: e.runId }),
    ...(e.model !== undefined && { model: e.model }),
    ...(e.effort !== undefined && { effort: e.effort }),
    ...(e.ms !== undefined && { ms: e.ms, start: e.at - e.ms }),
    ...(e.usd !== undefined && { usd: e.usd }),
  }
}

/** The row of an agent that still runs, listed under its flow: its icon and the time it has run. */
function liveAgentEntry(a: CockpitAgent, runId: string, now: number): DoneEntry {
  return {
    at: now,
    kind: 'agent',
    icon: agentIcon(a),
    isRunning: true,
    key: a.id,
    text: a.type,
    runId,
    ...(a.description !== undefined && a.description !== '' && { desc: a.description }),
    ...(a.model !== undefined && { model: a.model }),
    ...(a.effort !== undefined && { effort: a.effort }),
    start: a.startedAt,
    ms: Math.max(0, now - a.startedAt),
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
      return { at: e.at, kind: 'commit', icon: sp('󰜘', COLORS.green), text: E.commit(e.key ?? e.text ?? '', e.text ?? ''), ...(e.runId !== undefined && { runId: e.runId }), ...(e.agent !== undefined && { agent: e.agent }) }
    case 'test':
      return { at: e.at, kind: 'test', icon: e.isFailed ? sp('󰤒', COLORS.red) : sp('󰙨', COLORS.green), text: E.test(e.text ?? '', e.isFailed === true), ...(e.runId !== undefined && { runId: e.runId }), ...(e.agent !== undefined && { agent: e.agent }) }
    case 'compact':
      return { at: e.at, kind: 'compact', icon: sp('◇', COLORS.blue), text: E.compact(e.tokens === undefined ? '' : abbrevTokens(e.tokens), e.after === undefined ? '' : abbrevTokens(e.after)) }
    case 'pr':
      return { at: e.at, kind: 'pr', icon: sp('󰓂', COLORS.lavender), text: E.pr(e.key ?? '', e.text ?? ''), ...(e.runId !== undefined && { runId: e.runId }), ...(e.agent !== undefined && { agent: e.agent }) }
  }
}

// ── The tree ──

/** The figures of a node or an agent, dim, in three fixed slots (length, cost, share of the session's cost) so every row's columns line up; a missing value is blank; none at all, no figures. */
function figures(usd: number | undefined, ms: number | undefined, sessionUsd: number | undefined): Span[] {
  if (usd === undefined && ms === undefined) return []
  const share = usd !== undefined && sessionUsd !== undefined && sessionUsd > 0 ? `${Math.round((usd / sessionUsd) * 100)}%` : ''
  return [dim(ms === undefined ? ' '.repeat(DURATION_W) : duration(ms)), sp(' '), dim(usd === undefined ? ' '.repeat(COST_W) : costCell(usd, COST_W)), sp(' '), dim(share.padStart(SHARE_W))]
}

/** When a node began: its end less its length; the open round and a merged run only know their `at`. */
const startOf = (g: G): number => (g.ms !== undefined && !g.isCurrent ? g.at - g.ms : g.at)

type Tree = {
  /** The open nodes (IN CORSO): the open round and the run still open or silent. */
  live: G[]
  /** The closed nodes (LOG), newest first. */
  closed: G[]
  /** What a live run's node shows after its name. */
  detail: Map<string, { text: string; isSilent: boolean }>
}

function buildTree(k: Kit): Tree {
  const { s } = k
  const log = s.sessionLog ?? []
  // An agent that just finished is logged as it ends; one still listed and not yet in the log shows once all the same.
  const logged = new Set(log.filter(e => e.kind === 'agent').map(e => e.key))
  const pending = visibleAgents(s).filter(a => a.status === 'done' && !logged.has(a.id)).flatMap(a => agentLog(a, agentRunId(s.workflowRun, a)) ?? [])
  const all = [...log, ...pending]
  // a flow agent still running is an event of its flow, so a flow whose agents all run can open
  const running = visibleAgents(s).filter(a => a.status === 'running').flatMap(a => {
    const runId = agentRunId(s.workflowRun, a)
    return runId === undefined ? [] : [liveAgentEntry(a, runId, s.now)]
  })
  const entries = [...all.filter(e => isAllShown(s) || isMainEntry(e)).flatMap(e => logEntry(e) ?? []), ...running]

  // the run not logged yet (open, or closed by silence) is a node of IN CORSO
  const run = s.workflowRun
  const detail: Tree['detail'] = new Map()
  let openFlow: CockpitLogEntry | undefined
  // a run reopened by a new spawn is live again: its logged node (closed) gives way to the open one
  const isReopened = run !== undefined && (activeRun(run) !== undefined || run.isSilent === true)
  const flowLog = isReopened ? log.filter(e => !(e.kind === 'flow' && e.key === run?.runId)) : log
  if (run !== undefined && !flowLog.some(e => e.kind === 'flow' && e.key === run.runId)) {
    const mine = all.filter(e => e.kind === 'agent' && e.runId === run.runId)
    // the run's start counts its working agents too: the launch row stays under the round that launched it
    const starts = [...mine.map(e => e.at - (e.ms ?? 0)), ...running.filter(e => e.runId === run.runId).map(e => e.start ?? e.at)]
    const at = run.lastAt ?? s.now
    openFlow = { at, kind: 'flow', key: run.runId, usd: mine.reduce((n, e) => n + (e.usd ?? 0), 0), ...(run.name !== undefined && { text: run.name }), ...(starts.length > 0 && { ms: Math.max(0, at - Math.min(...starts)) }) }
    const progress = [run.phase ?? '—', `${run.agents.filter(a => a.isDone).length}/${run.agents.length}`].join(' · ')
    detail.set(`flow:${run.runId}`, run.isSilent === true ? { text: signalText({ kind: 'workflow', key: `${run.runId}:stall`, label: 'stall' }).what.replace(/^workflow /i, ''), isSilent: true } : { text: progress, isSilent: false })
  }
  const launches = [...flowLog.filter(e => e.kind === 'flow'), ...(openFlow ? [openFlow] : [])].map((f): DoneEntry => ({ at: f.at - (f.ms ?? 0), kind: 'launch', icon: sp('→', COLORS.blue), text: `flow ${f.text ?? f.key ?? ''}` }))

  const groups = groupDone([...entries, ...launches], flowLog, openFlow)
  const live = groups.filter(g => g.isCurrent === true || g.flow?.isLive === true)
  const closed = groups.filter(g => !live.includes(g))
  return { live, closed, detail }
}

/** The label of a node, whole (the row cuts it with … only when the pane is too narrow, the figures keep their columns); the detail a live run adds goes after it. */
function nodeLabel(g: G, tree: Tree): { label: Span; after: Span[] } {
  const E = t().page.events
  if (g.flow !== undefined) {
    const live = tree.detail.get(g.key)
    const text = `flow ${g.flow.name ?? g.flow.runId}`
    const label = live?.isSilent ? sp(text, COLORS.amber) : g.flow.isFailed ? sp(text, COLORS.red) : sp(text)
    return { label, after: live === undefined ? [] : [sp(' '), live.isSilent ? sp(`· ${live.text}`, COLORS.amber) : dim(`· ${live.text}`)] }
  }
  return { label: sp(g.isCurrent ? E.current : g.chatOnly !== undefined ? E.chatOnly(g.chatOnly) : E.round(g.round ?? 0)), after: [] }
}

/** The header of a node: toggle arrow (a dash when empty), start time (not the open round's), label, and at the row's end the figures (length, cost, share of the session's cost). */
function nodeHeader(k: Kit, tree: Tree, g: G, isOpen: boolean): { arrow: Span; rest: Span[]; second?: Span[] } {
  const { width, s } = k
  const { label, after } = nodeLabel(g, tree)
  const time = g.isCurrent ? [] : [dim(clockTime(startOf(g))), sp(' ')]
  const fig = figures(g.usd, g.ms, s.cost.usd)
  // a node with nothing under it opens nothing: a dash, not an arrow
  const arrow = sp(!isExpandable(g, s) ? '- ' : isOpen ? '▾ ' : '▸ ')
  // a round has two lines: its time, number and prompt, then its context and model with the figures at the end
  const round = roundHeader(g, s, { time, label, figures: fig, width })
  if (round !== undefined) return { arrow, rest: round.first, ...(round.second.length > 0 && { second: round.second }) }
  const left = [...time, { ...label, t: label.t.padEnd(LABEL_W) }, ...(after.length > 0 ? [sp(' '), ...after] : [])]
  return { arrow, rest: pairRow(left, fig, width - 2) }
}

/** An event row at `prefix`'s depth: time, icon, text, an agent also its model and figures at the end. */
function eventRow(k: Kit, e: DoneEntry, prefix: string): Block {
  const { ui } = k
  const left = [dim(clockTime(e.start ?? e.at)), sp(' '), e.icon, sp(' '), sp(e.text), ...(e.kind === 'agent' && (e.model !== undefined || e.effort !== undefined) ? [sp(' '), ...modelSpans(e.model, e.effort)] : [])]
  const spans = [sp(prefix, COLORS.rule), ...pairRow(left, e.kind === 'agent' ? figures(e.usd, e.ms, k.s.cost.usd) : [], k.width - textCells(prefix))]
  // a running agent's icon spins: it leaves the line for an animated cell between the time and the rest
  const at = 3
  if (e.isRunning === true && ui.Client !== undefined && e.key !== undefined && spans[at]?.t === e.icon.t && spans[at + 1]?.t === ' ') {
    const { Box } = ui
    return (
      <Box>
        {line(ui, spans.slice(0, at))}
        {animCell(ui, `anim:log:${e.key}`, 'spin', spans.slice(at, at + 2))}
        {line(ui, spans.slice(at + 2))}
      </Box>
    )
  }
  return line(ui, spans)
}

/** The rows under an open node: a round's summary and events; a run's agents, by the round their label names where it names one. */
function nodeChildren(k: Kit, g: G): Block[] {
  const { ui, width } = k
  const summary = g.flow === undefined ? summarySpans(g, k.s) : []
  const files = g.flow === undefined ? filesText(g, k.s) : undefined
  const head: Block[] = [
    ...(summary.length === 0 ? [] : [[line(ui, [sp('├ ', COLORS.rule), ...summary])]]),
    ...(files === undefined ? [] : [[line(ui, [sp('├ ', COLORS.rule), dim(files)])]]),
    ...detailRows(g, k.s).map(row => [line(ui, [sp('├ ', COLORS.rule), ...row])]),
  ]
  // a commit, test or PR a flow agent made sits under that agent's row
  const agentIds = new Set(g.flow === undefined ? [] : g.events.flatMap(e => (e.kind === 'agent' && e.key !== undefined ? [e.key] : [])))
  const byRound = new Map<number, DoneEntry[]>()
  const flat: DoneEntry[] = []
  for (const e of g.events.filter(x => x.agent === undefined || !agentIds.has(x.agent))) {
    const n = g.flow !== undefined && e.kind === 'agent' ? roundOf(e.desc ?? e.text) : undefined
    if (n === undefined) flat.push(e)
    else byRound.set(n, [...(byRound.get(n) ?? []), e])
  }
  // a flow lists its agents in the order they started
  if (g.flow !== undefined) flat.sort((a, b) => (a.start ?? a.at) - (b.start ?? b.at))
  /** The row of `e` at `base`'s depth, then what it made. */
  const rowWithKids = (e: DoneEntry, base: string, isLast: boolean): Block[] => {
    const kids = g.events.filter(x => x.agent !== undefined && x.agent === e.key).sort((a, b) => a.at - b.at)
    return [eventRow(k, e, `${base}${isLast ? '└ ' : '├ '}`), ...kids.map((c, j) => eventRow(k, c, `${base}${isLast ? '  ' : '│ '}${j === kids.length - 1 ? '└ ' : '├ '}`))]
  }
  const highest = Math.max(...byRound.keys())
  const items:((isLast: boolean) => Block[])[] = [
    ...[...byRound.entries()].sort((a, b) => b[0] - a[0]).map(([n, evs]) => (isLast: boolean): Block[] => {
      const costs = evs.flatMap(e => (e.usd === undefined ? [] : [e.usd]))
      const starts = evs.map(e => e.start ?? e.at)
      const ms = Math.max(...evs.map(e => e.at)) - Math.min(...starts)
      const fig = figures(costs.length > 0 ? costs.reduce((a, b) => a + b, 0) : undefined, ms, k.s.cost.usd)
      const key = `${g.key}:R${n}`
      // in a live run the highest round is the one at work and opens alone; a finished run opens them all, until a person gives a state
      const isOpen = k.s.groupsOpen?.[key] ?? (g.flow?.isLive !== true || n === highest)
      const { Button, Text } = ui
      const ordered = [...evs].sort((a, b) => (a.start ?? a.at) - (b.start ?? b.at))
      return [
        [
          <Button key={key} plain onPress={() => k.actions.setGroupOpen(key, !isOpen)}>
            <Text wrap="truncate">{spanNodes(ui, [sp(isLast ? '└ ' : '├ ', COLORS.rule), ...pairRow([sp(isOpen ? '▾ ' : '▸ '), sp(`R${n}`)], fig, width - 2)])}</Text>
          </Button>,
        ],
        ...(isOpen ? ordered.flatMap((e, i) => rowWithKids(e, isLast ? '  ' : '│ ', i === ordered.length - 1)) : []),
      ]
    }),
    ...flat.map(e => (isLast: boolean): Block[] => rowWithKids(e, '', isLast)),
  ]
  return [...head, ...items.flatMap((item, i) => item(i === items.length - 1))]
}

/** A node: its header (a button while it holds something) and, open, its children. `isNewest` fades the header from its highlight. */
function nodeBlock(k: Kit, tree: Tree, g: G, isOpen: boolean, isNewest: boolean): Block {
  const { ui, actions } = k
  const { Box, Button, Text } = ui
  const { arrow, rest, second } = nodeHeader(k, tree, g, isOpen)
  const toggle = () => actions.setGroupOpen(g.key, !isOpen)
  let header: Block
  if (!isExpandable(g, k.s)) header = [line(ui, [arrow, ...rest])]
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
  const anchor = linkAnchor(g, k.s)
  // the link sits in front of the second line, a button of its own (2 cells, where the line's indent is): it scrolls the chat to the round's marker
  const link: Block =
    second === undefined
      ? []
      : anchor === undefined
        ? [[line(ui, second)]]
        : [
            [
              <Box>
                <Button key={`${g.key}:link`} plain onPress={() => actions.scrollTo(anchor)}>
                  <Text wrap="truncate">{spanNodes(ui, [sp('\u{F0337}', COLORS.blue), sp(' ')])}</Text>
                </Button>
                <Text wrap="truncate">{spanNodes(ui, second)}</Text>
              </Box>,
            ],
          ]
  return [header, ...link, ...(isOpen ? nodeChildren(k, g) : [])]
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
  return tree.live.map(g => nodeBlock(k, tree, g, isExpandable(g, k.s) && (k.s.groupsOpen?.[g.key] ?? true), false))
}

/**
 * The session log: the closed nodes (main rounds and workflow runs) newest first, each a toggle row (start time, label, length, cost, its share of the
 * session's cost) over its children in a tree; the newest is open until a person gives it a state, which stays. Under a day row
 * (`2026-11-11`, a toggle, newest day open) when the nodes span two or more local days. The nodes count, not their lines: the newest five, the rest
 * behind the toggle.
 */
export function doneBlocks(k: Kit): Block[] {
  const { ui, s, width, actions } = k
  const tree = buildTree(k)
  const { closed } = tree
  if (closed.length === 0) return []

  // a node's day is its end's, the time the nodes are sorted by, so each day's nodes stay together
  const days = [...new Set(closed.map(g => localDate(g.at)))]
  const isDays = days.length > 1
  const seen = new Set<string>()
  const rows: Block[] = []
  const dayOpen = (date: string) => !isDays || (s.groupsOpen?.[`day:log:${date}`] ?? days[0] === date)
  const nodeOpen = (g: G, gi: number) => isExpandable(g, s) && (s.groupsOpen?.[g.key] ?? gi === 0)
  closed.forEach((g, gi) => {
    const date = localDate(g.at)
    const dayKey = `day:log:${date}`
    const isDayOpen = dayOpen(date)
    const first = isDays && !seen.has(date)
    seen.add(date)
    const dayHead: Block[] = first ? [dayRow(k, dayKey, date, isDayOpen, [])] : []
    if (!isDayOpen) {
      if (first) rows.push(dayHead)
      return
    }
    const isOpen = nodeOpen(g, gi)
    const isNewest = gi === 0 && ui.Client !== undefined && isFading(g.at, s.now)
    rows.push([...dayHead, nodeBlock(k, tree, g, isOpen, isNewest)])
  })

  const label = t().page.done
  // every day and every node that holds something; the toggle closes them once none is closed
  const keys = [...(isDays ? days.map(d => `day:log:${d}`) : []), ...closed.flatMap(g => (isExpandable(g, s) ? [g.key] : []))]
  const isAllOpen = days.every(dayOpen) && closed.every((g, gi) => !isExpandable(g, s) || nodeOpen(g, gi))
  // no node holds anything: nothing to open, so no open/close toggle (day rows alone do not count)
  const hasToggle = closed.some(g => isExpandable(g, s))
  const isAll = isAllShown(s)
  const toggle = hasToggle ? [sp(isAllOpen ? '\u{F0AA7}' : '\u{F0AB5}', COLORS.blue), sp(' ')] : []
  const filter = [sp(isAll ? '\u{F0233}' : '\u{F14F0}', COLORS.blue), sp(' ')]
  const fixed = textCells(label) + 2 + spanWidth(toggle) + spanWidth(filter)
  const rule = '─'.repeat(Math.max(0, width - fixed))
  const head = [sp(label, COLORS.title, true), sp(' '), sp(rule, COLORS.rule), sp(' ')]
  const { Box, Button, Text } = ui
  const title: Block = [
    <Box>
      <Text wrap="truncate">{spanNodes(ui, head)}</Text>
      {hasToggle && (
        <Button key="done:all" plain onPress={() => actions.setGroupsOpen(keys, !isAllOpen)}>
          <Text wrap="truncate">{spanNodes(ui, toggle)}</Text>
        </Button>
      )}
      <Button key="log:all" plain onPress={() => actions.toggleOpen(ALL_KEY)}>
        <Text wrap="truncate">{spanNodes(ui, filter)}</Text>
      </Button>
    </Box>,
  ]
  return [[title, collapsible(k, 'done', rows, DONE_ROWS, s.openKeys?.includes('done') === true, () => actions.toggleOpen('done'))]]
}
