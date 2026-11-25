import { COLORS, clockTime, spanWidth, textCells, truncateSpans } from './shared'
import type { Span } from './shared'
import { t } from './strings'
import { pairRow, subagentInline, trailRows } from './view-agents'
import { animCell, dim, line, sp, spanNodes } from './view-base'
import type { Block, Kit } from './view-kit'
import { LABEL_W, detailRows, filesText, isExpandable, modelSpans, roundHeader, roundLink, summarySpans } from './view-log-round'
import { roundOf, taskRows } from './workflow'
import type { DoneEntry, G } from './view-log-entries'
import { figures, startOf } from './view-log-figures'
import type { Tree } from './view-log-tree'

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
function nodeHeader(k: Kit, tree: Tree, g: G, isOpen: boolean): { arrow: Span; rest: Span[]; link?: { anchor: string; isLive: boolean } } {
  const { width, s } = k
  const { label, after } = nodeLabel(g, tree)
  const time = g.isCurrent ? [] : [dim(clockTime(startOf(g))), sp(' ')]
  const fig = figures(g.usd, g.ms, s.cost.usd)
  // a node with nothing under it opens nothing: a dash, not an arrow
  const arrow = sp(!isExpandable(g, s) ? '- ' : isOpen ? '▾ ' : '▸ ')
  // a round is one row: time, number, prompt, context and model, the figures at the end; its link, when it has one, sits in front (2 cells)
  const link = g.flow === undefined ? roundLink(g, s) : undefined
  const round = roundHeader(g, s, { time, label, figures: fig, width: width - (link === undefined ? 0 : 2) })
  if (round !== undefined) return { arrow, rest: round, ...(link !== undefined && { link }) }
  // a live run's phase and progress outrank its name: on a narrow pane the name gives way first, down to `flow…`
  const room = width - 2 - spanWidth(fig) - 1 - spanWidth(time) - (after.length > 0 ? 1 + spanWidth(after) : 0)
  const name = after.length > 0 && textCells(label.t) > room ? { ...label, t: truncateSpans([label], Math.max(room, 5)).map(x => x.t).join('') } : label
  const pad = after.length > 0 ? Math.max(textCells(name.t), Math.min(LABEL_W, room)) : LABEL_W
  const left = [...time, { ...name, t: name.t.padEnd(pad) }, ...(after.length > 0 ? [sp(' '), ...after] : [])]
  return { arrow, rest: pairRow(left, fig, width - 2) }
}

/** An event row at `prefix`'s depth: time, icon, text, an agent also its model and figures at the end. */
function eventRow(k: Kit, e: DoneEntry, prefix: string, toggle?: { key: string; isOpen: boolean; onPress: () => void }): Block {
  const { ui } = k
  const { Button, Text } = ui
  const left = [dim(clockTime(e.start ?? e.at)), sp(' '), e.icon, sp(' '), sp(e.text, e.color), ...(toggle === undefined ? [] : [sp(toggle.isOpen ? ' ▾' : ' ▸')]), ...(e.kind === 'agent' && (e.model !== undefined || e.effort !== undefined) ? [sp(' '), ...modelSpans(e.model, e.effort)] : []), ...(toggle?.isOpen === true && e.live !== undefined ? subagentInline(e.live) : [])]
  const spans = [sp(prefix, COLORS.rule), ...pairRow(left, e.kind === 'agent' ? figures(e.usd, e.ms, k.s.cost.usd) : [], k.width - textCells(prefix))]
  // a flow agent that runs is a toggle: its row opens on its detail and trail
  const rest = (from: number): Block =>
    toggle === undefined ? line(ui, spans.slice(from)) : (
      <Button key={toggle.key} plain onPress={toggle.onPress}>
        <Text wrap="truncate">{spanNodes(ui, spans.slice(from))}</Text>
      </Button>
    )
  // a running agent's icon spins: it leaves the line for an animated cell between the time and the rest
  const at = 3
  if (e.isRunning === true && ui.Client !== undefined && e.key !== undefined && spans[at]?.t === e.icon.t && spans[at + 1]?.t === ' ') {
    const { Box } = ui
    return (
      <Box>
        {line(ui, spans.slice(0, at))}
        {animCell(ui, `anim:log:${e.key}`, 'spin', spans.slice(at, at + 2))}
        {rest(at + 2)}
      </Box>
    )
  }
  return rest(0)
}

/** The task tree under a live flow, one row per task: state icon, id, title (cut to fit), `← T1,T2`, its block and, while it runs, the step; none for a run with no tasks. */
function taskTree(k: Kit, runId: string): Block[] {
  const { ui, width, s } = k
  const { Text } = ui
  if (s.workflowRun?.runId !== runId) return []
  const all = taskRows(s.workflowRun)
  const open = all.filter(r => r.state !== 'done')
  const finished = all.length - open.length
  const collapsed: Block[] = finished === 0 ? [] : [[<Text key={`flow:${runId}:task:done`} wrap="truncate">{spanNodes(ui, [sp('  '), sp('󰄬', COLORS.green), sp(' '), dim(t().page.planDone(finished))])}</Text>]]
  const rows = open.map(r => {
    const icon = r.state === 'done' ? sp('󰄬', COLORS.green) : r.state === 'running' ? sp('󱎖', COLORS.blue) : dim('󰄰')
    const right = [r.dependsOn.length > 0 ? `← ${r.dependsOn.join(',')}` : '', r.block === undefined ? '' : `B${r.block}`, r.tag === undefined ? '' : t().page.planStep(r.tag)].filter(Boolean).join(' · ')
    const left = [sp('  '), icon, sp(' '), sp(r.id, undefined, r.state === 'running'), sp(' ')]
    const room = width - spanWidth(left) - (right === '' ? 0 : textCells(right) + 1)
    const title = r.title === undefined || room < 4 ? [] : truncateSpans([sp(r.title.replace(/\s+/g, ' '))], room)
    const spans = truncateSpans([...left, ...title, ...(right === '' ? [] : [sp(' '), dim(right)])], width)
    return [<Text key={`flow:${runId}:task:${r.id}`} wrap="truncate">{spanNodes(ui, spans)}</Text>]
  })
  return [...collapsed, ...rows]
}

/** The rows under an open node: a round's summary and events; a run's agents, by the round their label names where it names one. */
function nodeChildren(k: Kit, g: G, drawn?: Set<string>): Block[] {
  const { ui, width } = k
  const summary = g.flow === undefined ? summarySpans(g, k.s) : []
  const files = g.flow === undefined ? filesText(g, k.s) : undefined
  const head: Block[] = [
    ...(summary.length === 0 ? [] : [[line(ui, [sp('├ ', COLORS.rule), ...summary])]]),
    ...(files === undefined ? [] : [[line(ui, [sp('├ ', COLORS.rule), dim(files)])]]),
    ...detailRows(g, k.s).map(row => [line(ui, [sp('├ ', COLORS.rule), ...row])]),
    ...(g.flow?.isLive === true ? taskTree(k, g.flow.runId) : []),
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
    const cont = `${base}${isLast ? '  ' : '│ '}`
    let head: Block[]
    if (e.live === undefined || e.key === undefined || drawn === undefined) head = [eventRow(k, e, `${base}${isLast ? '└ ' : '├ '}`)]
    else {
      // a running flow agent: a toggle (open while it runs until a person closes it) over its detail and its trail
      const key = `${g.key}:agent:${e.key}`
      const isOpen = k.s.groupsOpen?.[key] ?? true
      const indent = `${cont}  `
      drawn?.add(e.key)
      head = [
        eventRow(k, e, `${base}${isLast ? '└ ' : '├ '}`, { key, isOpen, onPress: () => k.actions.setGroupOpen(key, !isOpen) }),
        ...(isOpen ? trailRows(e.live, indent, width).map(spans => line(ui, spans)) : []),
      ]
    }
    return [...head, ...kids.map((c, j) => eventRow(k, c, `${base}${isLast ? '  ' : '│ '}${j === kids.length - 1 ? '└ ' : '├ '}`))]
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
export function nodeBlock(k: Kit, tree: Tree, g: G, isOpen: boolean, isNewest: boolean, drawn?: Set<string>): Block {
  const { ui, actions } = k
  const { Box, Button, Text } = ui
  const { arrow, rest, link } = nodeHeader(k, tree, g, isOpen)
  const toggle = () => actions.setGroupOpen(g.key, !isOpen)
  const isExpand = isExpandable(g, k.s)
  const isFade = isExpand && isNewest
  // the link is a button of its own (2 cells) between the arrow and the row: it scrolls the chat to the round's marker; one that cannot scroll keeps its slot, dim and not pressable
  if (link !== undefined) {
    return [
      [
        <Box>
          {isExpand ? (
            <Button key={g.key} plain onPress={toggle}>
              <Text wrap="truncate">{spanNodes(ui, [arrow])}</Text>
            </Button>
          ) : (
            <Text wrap="truncate">{spanNodes(ui, [arrow])}</Text>
          )}
          {link.isLive ? (
            <Button key={`${g.key}:link`} plain onPress={() => actions.scrollTo(link.anchor)}>
              <Text wrap="truncate">{spanNodes(ui, [sp('󰌷', COLORS.blue), sp(' ')])}</Text>
            </Button>
          ) : (
            <Text wrap="truncate">{spanNodes(ui, [sp('󰌷', COLORS.dim), sp(' ')])}</Text>
          )}
          {isFade ? (
            animCell(ui, 'anim:done', 'fade', rest)
          ) : isExpand ? (
            <Button key={`${g.key}:row`} plain onPress={toggle}>
              <Text wrap="truncate">{spanNodes(ui, rest)}</Text>
            </Button>
          ) : (
            <Text wrap="truncate">{spanNodes(ui, rest)}</Text>
          )}
        </Box>,
      ],
      ...(isOpen ? nodeChildren(k, g, drawn) : []),
    ]
  }
  let header: Block
  if (!isExpand) header = [line(ui, [arrow, ...rest])]
  else if (isFade) {
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
  return [header, ...(isOpen ? nodeChildren(k, g, drawn) : [])]
}
