import type { RenderElement } from 'claude-code'

import type { CockpitAgent, CockpitSnapshot } from '../types'
import { sessionTokens } from './agents'
import { worklogLabel } from './session'
import { COLORS, clockTime, fmtCost, spanWidth, splitCells, textCells, truncateSpans, wrapCells } from './shared'
import type { Span } from './shared'
import { agentCosts, signalId } from './signals'
import type { Signal } from './signals'
import { t } from './strings'
import { agentRow, agentWarning, pairRow, subagentDetails } from './view-agents'
import { dim, line, sp, spanNodes } from './view-base'
import type { Ui } from './view-base'
import { activeRun } from './workflow'

// ── What the page draws with: the pane's actions and the helpers every section shares ──

/** What a press does; the register module holds the engine, the view only names the acts. */
export type PaneActions = {
  compact: () => void
  /** Asks to confirm a button that sends something (`retro`: which `/retro`) or logs hours (`worklog`: which `/worklog`). */
  ask: (kind: 'retro' | 'worklog') => void
  /** Answers the confirmation: yes runs what was asked, no drops it. */
  answer: (isYes: boolean) => void
  /** Answers the retrospective's choice: `/retro days 10` over the last ten days, `/retro` on this session. */
  retro: (scope: 'days' | 'session') => void
  /** Answers the worklog's choice: `/worklog oggi sessione <id>` for the hours of this chat, `/worklog oggi` for the whole day. */
  worklog: (scope: 'session' | 'day') => void
  /** Expands or collapses an agent row. */
  toggleAgent: (agentId: string) => void
  /** Opens or closes the why and what-to-do of a notification (`kind:key`). */
  toggleSignal: (id: string) => void
  /** Shows a cut list in full or folds it again (`attention`, `inProgress`, `done`), or opens the late worklog days (`worklog:days`). */
  toggleOpen: (key: string) => void
}

export type Node = RenderElement | false | undefined
export type Block = (Node | readonly Node[] | Block)[]

export type Kit = {
  ui: Ui
  s: CockpitSnapshot
  width: number
  actions: PaneActions
  /** An empty row. */
  gap: () => RenderElement
  /** A section's title, its right side under it when the two do not fit one row. */
  title: (label: string, right?: Span[]) => RenderElement
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
  }
}

// ── Agents: the workflow run in one row, every agent one row ──

/** The workflow run in flight in one row: name, phase, round, finished agents out of all and what they cost so far (its agents' cost). */
export function workflowLine(k: Kit): RenderElement | undefined {
  const { s, width, ui } = k
  const run = activeRun(s.workflowRun)
  if (!run) return undefined
  const ids = new Set(run.agents.map(a => a.id))
  const usd = agentCosts(s.agents, s.events).filter(a => ids.has(a.id)).reduce((sum, a) => sum + (a.usd ?? 0), 0)
  const done = run.agents.filter(a => a.isDone).length
  return line(ui, truncateSpans([sp(t().workflowRow(run.name, run.phase ?? '—', run.round, done, run.agents.length, fmtCost(usd)))], width))
}

/** The first `shown` rows, then a button that opens the rest (`󰍟 +K`) and folds them again (`󰍝 −K`), which open below it so the button stays where it was pressed; no button when every row fits. */
export function collapsible(k: Kit, key: string, rows: Block[], shown: number, isOpen: boolean, onToggle: () => void): Block {
  const { Button, Text } = k.ui
  const hidden = rows.length - shown
  if (hidden <= 0) return rows
  return [
    rows.slice(0, shown),
    <Button key={`${key}:more`} plain onPress={onToggle}>
      <Text color={COLORS.title}>{isOpen ? t().lessRows(hidden) : t().moreRows(hidden)}</Text>
    </Button>,
    isOpen ? rows.slice(shown) : [],
  ]
}

/**
 * Every agent is one row (state, name, model when it fits, effort, share, time); pressing it expands what else there is to know. Live and history alike.
 * `usd` of the returned builder: what a history entry kept of its cost; it outlives the events, which the resumed session no longer holds.
 */
export function makeAgentBlock(k: Kit): (key: string, agent: CockpitAgent, depth: number, usd?: number) => Block {
  const { ui, s, width, gap, actions } = k
  const { Button, Text } = ui
  const sessionTotal = sessionTokens(s)
  const usdById = new Map(agentCosts(s.agents, s.events).map(a => [a.id, a.usd]))
  return (key, agent, depth, usd) => {
    const indent = '  '.repeat(depth + 1)
    const isOpen = s.agentsOpen?.includes(agent.id) === true
    const warn = agentWarning(agent, s.isSubagentModelForced)
    return [
      <Button key={key} plain onPress={() => actions.toggleAgent(agent.id)}>
        <Text wrap="truncate">{spanNodes(ui, agentRow(agent, depth, s.now, width, sessionTotal, usd ?? usdById.get(agent.id)))}</Text>
      </Button>,
      isOpen && [
        warn !== undefined && line(ui, [sp(`${indent}󰀦 ${warn}`, COLORS.yellow)]),
        ...subagentDetails(agent, indent, width).map(spans => line(ui, spans)),
        gap(),
      ],
    ]
  }
}

// ── Notifications ──

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

/**
 * A notification's row: what, the time it arrived on the right; pressed, the row also tells why and what to do. A blocking one starts with a red `!`,
 * and a closed row carries what to do under it.
 */
export function signalRow(k: Kit, sig: Signal, page: { isBlocking: boolean }): Block {
  const { ui, s, width, actions } = k
  const { Button, Text } = ui
  const S = t()
  // An open notification's text wraps under its row, indented, instead of being cut
  const wrapped = (text: string, style: (t: string) => Span) => wrapCells(text, Math.max(4, width - 2)).map(l => line(ui, [style(`  ${l}`)]))
  const text = signalText(sig)
  const id = signalId(sig)
  const isOpen = s.signalOpen === id
  const style = (t: string) => (page.isBlocking ? sp(t, COLORS.red, true) : sp(t, COLORS.yellow, true))
  // The time it arrived on the right; open, the row holds what fits of the title and the rest goes under it
  const at = s.signalsAt?.[id]
  const time = at === undefined ? [] : [dim(clockTime(at))]
  const mark = page.isBlocking ? '!' : isOpen ? '󰍝' : '󰍟'
  const [head, rest] = isOpen ? splitCells(`${mark} ${text.what}`, width - spanWidth(time) - 1) : [`${mark} ${text.what}`, '']
  return [
    <Button key={`signal:${id}`} plain onPress={() => actions.toggleSignal(id)}>
      <Text wrap="truncate">{spanNodes(ui, pairRow([style(head)], time, width))}</Text>
    </Button>,
    isOpen && wrapped(rest, style),
    isOpen && wrapped(`${S.signalFields.why}${text.why}`, dim),
    isOpen && wrapped(`${S.signalFields.todo}${text.todo}`, dim),
    !isOpen && line(ui, truncateSpans([dim(`  → ${text.todo}`)], width)),
  ]
}

/** The worklog days behind: the toggle button (`label` of their count) and the list it opens; undefined when up to date. */
export function worklogBehindRows(k: Kit, label: (n: number) => string): { toggle: Block[number]; days: Block[number] } | undefined {
  const { ui, s, width, actions } = k
  const { Button, Text } = ui
  const wl = s.worklog
  const lateDays = new Set([...wl.pending, ...wl.underTarget])
  if (lateDays.size === 0) return undefined
  const isDaysOpen = s.openKeys?.includes('worklog:days') === true
  const daysRows = [...(wl.pending.length ? [worklogLabel('pending', wl.pending)] : []), ...(wl.underTarget.length ? [worklogLabel('underTarget', wl.underTarget)] : [])]
  return {
    toggle: (
      <Button key="worklog:days" plain onPress={() => actions.toggleOpen('worklog:days')}>
        <Text color={COLORS.yellow}>{`${isDaysOpen ? '▾' : '▸'} ${label(lateDays.size)}`}</Text>
      </Button>
    ),
    days: isDaysOpen && daysRows.flatMap(text => wrapCells(text, Math.max(4, width - 2)).map(l => line(ui, [sp(`  ${l}`, COLORS.yellow)]))),
  }
}
