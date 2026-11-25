import { isFading } from './anim'
import { COLORS, localDate, spanWidth, textCells } from './shared'
import type { Span } from './shared'
import { t } from './strings'
import { pairRow } from './view-agents'
import { dim, line, sp, spanNodes } from './view-base'
import { collapsible } from './view-kit'
import type { Block, Kit } from './view-kit'
import { ALL_KEY, isAllShown, isExpandable, roundAnchors } from './view-log-round'
import { linkReason } from './round-anchor'
import type { G } from './view-log-entries'
import { DONE_ROWS } from './view-log-figures'
import { buildTree } from './view-log-tree'
import { nodeBlock } from './view-log-nodes'

/** A day's row: a toggle (arrow, date) with `right` at the row's end. */
function dayRow(k: Kit, key: string, date: string, isOpen: boolean, right: readonly Span[]): Block {
  const { ui, actions, width } = k
  const { Button, Text } = ui
  return [
    <Button key={key} plain onPress={() => actions.setGroupOpen(key, !isOpen)}>
      <Text wrap="truncate">{spanNodes(ui, pairRow([sp(isOpen ? '▾ ' : '▸ '), dim(date)], right, width))}</Text>
    </Button>,
  ]
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
  const E = t().page.events
  const reason = linkReason(roundAnchors(s))
  // the reason sits under the title; the trimmed row ends the log: neither is a node, so neither counts in DONE_ROWS
  const reasonRow: Block[] = reason === undefined ? [] : [[line(ui, [sp(reason === 'denied' ? E.linkDenied : E.linkRestart, COLORS.dim)])]]
  const trimmedRow: Block[] = s.logTrimmed === undefined || !(s.logTrimmed > 0) ? [] : [[line(ui, [sp(E.trimmed(s.logTrimmed), COLORS.dim)])]]
  return [[title, ...reasonRow, collapsible(k, 'done', rows, DONE_ROWS, s.openKeys?.includes('done') === true, () => actions.toggleOpen('done')), ...trimmedRow]]
}
