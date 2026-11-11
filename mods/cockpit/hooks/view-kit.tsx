import type { RenderElement } from 'claude-code'

import type { CockpitAgent, CockpitSnapshot } from '../types'
import { sessionTokens } from './agents'
import { worklogLabel } from './session'
import { COLORS, clockTime, spanWidth, splitCells, textCells, truncateSpans, wrapCells } from './shared'
import type { Span } from './shared'
import { agentCosts, signalId, signalSeverity } from './signals'
import type { Signal, SignalSeverity } from './signals'
import { t } from './strings'
import { signalAnim } from './anim'
import { agentRow, agentWarning, pairRow, subagentDetails } from './view-agents'
import { animCell, dim, line, sp, spanNodes } from './view-base'
import type { Ui } from './view-base'

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
  /** Gives a FATTO group an explicit state, kept when it is no longer the newest. */
  setGroupOpen: (key: string, isOpen: boolean) => void
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
  /** A section's title: the label, a space, a rule to the end of the row. */
  title: (label: string) => RenderElement
}

export function makeKit(ui: Ui, s: CockpitSnapshot, width: number, actions: PaneActions): Kit {
  const { Text } = ui
  return {
    ui,
    s,
    width,
    actions,
    gap: () => <Text> </Text>,
    title: label => line(ui, [sp(label, COLORS.title, true), sp(' '), sp('─'.repeat(Math.max(0, width - textCells(label) - 1)), COLORS.rule)]),
  }
}

// ── Agents: every agent one row ──

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
  const { Box, Button, Text } = ui
  const sessionTotal = sessionTokens(s)
  const usdById = new Map(agentCosts(s.agents, s.events).map(a => [a.id, a.usd]))
  return (key, agent, depth, usd) => {
    const indent = '  '.repeat(depth + 1)
    const isOpen = s.agentsOpen?.includes(agent.id) === true
    const warn = agentWarning(agent, s.isSubagentModelForced)
    const spans = agentRow(agent, depth, s.now, width, sessionTotal, usd ?? usdById.get(agent.id))
    // A running agent's icon spins: it leaves the button (which holds the rest of the row) for an animated cell beside it
    const [icon, space, ...rest] = spans
    const isSpinning = ui.Client !== undefined && agent.status === 'running' && icon !== undefined && space?.t === ' '
    const button = (
      <Button key={key} plain onPress={() => actions.toggleAgent(agent.id)}>
        <Text wrap="truncate">{spanNodes(ui, isSpinning ? rest : spans)}</Text>
      </Button>
    )
    return [
      isSpinning ? (
        <Box>
          {animCell(ui, `anim:${key}`, 'spin', [icon!, space!])}
          {button}
        </Box>
      ) : (
        button
      ),
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

export const SEVERITY_COLORS: Record<SignalSeverity, string> = { block: COLORS.red, warn: COLORS.orange, info: COLORS.yellow }

/** A notification's icon: one per kind, a workflow's by whether it stalled or ran past its rounds. */
export function signalIcon(sig: Signal): string {
  switch (sig.kind) {
    case 'permissionWait':
      return '\u{F033E}'
    case 'workflow':
      return sig.label === 'stall' ? '\u{F03E5}' : '\u{F04E6}'
    case 'failedCommand':
      return '\u{F018D}'
    case 'ctxGrowth':
      return '\u{F0535}'
    case 'heavyAgent':
      return '\u{F06A9}'
    case 'doneClaims':
      return '\u{F0028}'
    case 'reread':
      return '\u{F0450}'
    case 'bigResult':
      return '\u{F03D6}'
    case 'opusReadOnly':
      return '\u{F0114}'
    case 'coldAfterIdle':
      return '\u{F0717}'
  }
}

/**
 * A notification's row: its icon in the colour of its severity, what (bold when it blocks), the time it arrived on the right; pressed, the row also tells why
 * and what to do. A closed row carries what to do dim under it.
 */
export function signalRow(k: Kit, sig: Signal): Block {
  const { ui, s, width, actions } = k
  const { Box, Button, Text } = ui
  const S = t()
  // An open notification's text wraps under its row, indented, instead of being cut
  const wrapped = (text: string, style: (t: string) => Span) => wrapCells(text, Math.max(4, width - 2)).map(l => line(ui, [style(`  ${l}`)]))
  const text = signalText(sig)
  const id = signalId(sig)
  const isOpen = s.signalOpen === id
  const severity = signalSeverity(sig)
  const style = (t: string) => sp(t, undefined, severity === 'block')
  const icon = `${signalIcon(sig)} `
  // The time it arrived on the right; open, the row holds what fits of the title and the rest goes under it
  const at = s.signalsAt?.[id]
  const time = at === undefined ? [] : [dim(clockTime(at))]
  const [head, rest] = isOpen ? splitCells(text.what, width - textCells(icon) - spanWidth(time) - 1) : [text.what, '']
  // A blocking icon blinks and a new one flashes: it is an animated cell beside the button, which then holds the rest of the row
  const iconSpan = sp(icon, SEVERITY_COLORS[severity])
  const kind = ui.Client ? signalAnim(severity, at, s.now) : undefined
  const button = (
    <Button key={`signal:${id}`} plain onPress={() => actions.toggleSignal(id)}>
      <Text wrap="truncate">{spanNodes(ui, kind ? pairRow([style(head)], time, width - textCells(icon)) : pairRow([iconSpan, style(head)], time, width))}</Text>
    </Button>
  )
  return [
    kind ? (
      <Box>
        {animCell(ui, `anim:signal:${id}`, kind, [iconSpan], undefined)}
        {button}
      </Box>
    ) : (
      button
    ),
    isOpen && wrapped(rest, style),
    isOpen && wrapped(`${S.signalFields.why}${text.why}`, dim),
    isOpen && wrapped(`${S.signalFields.todo}${text.todo}`, dim),
    !isOpen && line(ui, truncateSpans([dim(`  ${text.todo}`)], width)),
  ]
}

/** The late worklog days' icon: nf-md-calendar_clock */
const WORKLOG_ICON = '\u{F00F0}'

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
        <Text wrap="truncate" color={COLORS.yellow}>{`${WORKLOG_ICON} ${label(lateDays.size)}`}</Text>
      </Button>
    ),
    days: isDaysOpen && daysRows.flatMap(text => wrapCells(text, Math.max(4, width - 2)).map(l => line(ui, [sp(`  ${l}`, COLORS.yellow)]))),
  }
}
