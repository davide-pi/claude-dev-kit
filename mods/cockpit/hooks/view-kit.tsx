import type { RenderElement } from 'claude-code'

import type { CockpitAgent, CockpitSnapshot } from '../types'
import { sessionTokens } from './agents'
import { COLORS, textCells } from './shared'
import { agentCosts } from './signals'
import type { Signal, SignalSeverity } from './signals'
import { t } from './strings'
import { agentRow, agentWarning, subagentInline, trailRows } from './view-agents'
import { animCell, dim, line, sp, spanNodes } from './view-base'
import type { Ui } from './view-base'

// ── What the page draws with: the pane's actions and the helpers every section shares ──

/** What a press does; the register module holds the engine, the view only names the acts. */
export type PaneActions = {
  compact: () => void
  /** Shows a tab of the desktop page. */
  setTab: (tab: 'now' | 'log') => void
  /** Expands or collapses an agent row. */
  toggleAgent: (agentId: string) => void
  /** Shows a cut list in full or folds it again (`inProgress`, `done`). */
  toggleOpen: (key: string) => void
  /** Gives a FATTO group an explicit state, kept when it is no longer the newest. */
  setGroupOpen: (key: string, isOpen: boolean) => void
  /** Scrolls the chat to a round's marker (`anchor`); a refusal hides the link for the session. */
  scrollTo: (anchor: string) => void
  /** Gives many FATTO groups and days one state in a single write. */
  setGroupsOpen: (keys: string[], isOpen: boolean) => void
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
  title: (label: string, right?: string) => RenderElement
}

export function makeKit(ui: Ui, s: CockpitSnapshot, width: number, actions: PaneActions): Kit {
  const { Text } = ui
  return {
    ui,
    s,
    width,
    actions,
    gap: () => <Text> </Text>,
    title: (label, right) =>
      line(ui, [
        sp(label, COLORS.title, true),
        sp(' '),
        sp('─'.repeat(Math.max(0, width - textCells(label) - 1 - (right === undefined ? 0 : textCells(right) + 1))), COLORS.rule),
        ...(right === undefined ? [] : [sp(' '), dim(right)]),
      ]),
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
    const spans = agentRow(agent, depth, s.now, width, sessionTotal, usd ?? usdById.get(agent.id), isOpen ? subagentInline(agent) : [])
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
        ...trailRows(agent, indent, width).map(spans => line(ui, spans)),
        gap(),
      ],
    ]
  }
}

// ── Notifications ──

/** The text of a signal. */
export function signalText(sig: Signal): { what: string } {
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
