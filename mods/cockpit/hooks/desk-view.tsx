import type { Elements, RenderElement } from 'claude-code'

import type { CockpitSnapshot } from '../types'
import { analysisScrollMax, deskActions, deskAnalysis } from './desk-analysis'
import { deskHead } from './desk-head'
import { DESK_MEDIUM_FROM, DESK_WIDE_FROM, deskLayout } from './desk-layout'
import { deskLog, logScrollMax } from './desk-log'
import { deskNow, nowScrollMax } from './desk-now'
import { t } from './strings'
import type { Ui } from './view-base'
import type { PaneActions } from './view-kit'

/** What the desktop page draws with: the shared elements, the desktop's `Svg` and its `Markdown` (the tabs' links). */
export type DeskUi = Ui & Pick<Elements['desktop'], 'Svg' | 'Markdown'>

type Tab = 'now' | 'log' | 'analysis'
const TABS: readonly Tab[] = ['now', 'log', 'analysis']

const ACCENT = '#8B6CF6'
const DIM = '#A8A49B'
/**
 * Rows the head and the tab row take by layout size, gaps included: only the cap of the lists a tab draws, the page itself fills the pane by layout.
 * Measured on a medium pane (a capture at about 780 by 960 px): the state lines, the gauges card, the URGENTE card (title, its one slot, the worklog
 * row) and the tab row take about 15 cells; a margin of 3 keeps a list from reaching under the action bar. Narrow stacks the donut over the windows.
 */
const HEAD_ROWS = { narrow: 26, medium: 18, wide: 20 } as const
/** Rows the action bar takes with the gap above it: one row of native buttons, two when narrow (compact, then the retrospectives). */
/** Rows kept free under the action bar: on Desktop the pane's 100% runs under its own title bar, so the bar would sit half out of view. */
const FOOT_PAD = 3
/** The rows a body may draw: the pane scrolls over them, so the cap only bounds the tree (a long Log ends on its "a–b / n" hint). */
const PAGE_ROWS = 240
const ACTION_ROWS = { narrow: 5, medium: 3, wide: 3 } as const
const MIN_BODY_ROWS = 8
/** The underline's width per letter of the tab's label, in CSS pixels: the label's drawn width is not known, so an estimate. */
const TAB_CHAR_PX = 8

const sizeOf = (columns: number): keyof typeof HEAD_ROWS => (columns >= DESK_WIDE_FROM ? 'wide' : columns >= DESK_MEDIUM_FROM ? 'medium' : 'narrow')

/** The rows the tab body may take of a pane `bodyRows` tall, so the head above and the action bar below both stay in view. */
export const bodyLimit = (bodyRows: number, bodyColumns: number = DESK_WIDE_FROM): number => {
  const size = sizeOf(bodyColumns)
  return Math.max(bodyRows - HEAD_ROWS[size] - ACTION_ROWS[size], MIN_BODY_ROWS)
}


/**
 * The furthest the body of the open tab scrolls under the fixed head and action bar, in its own units: Log rows, In corso agents, Analysis cards.
 */
export function deskScrollMax(s: CockpitSnapshot, bodyColumns: number, bodyRows: number): number {
  const tab = s.deskTab ?? 'now'
  void bodyRows
  const layout = deskLayout(bodyColumns, PAGE_ROWS)
  return tab === 'log' ? logScrollMax(s, layout) : tab === 'now' ? nowScrollMax(s, layout) : analysisScrollMax(s, layout)
}

/** A tab's link target: never opened (the press is answered here), an `https:` one because a desktop draws any other scheme as plain text. */
export const tabHref = (tab: Tab): string => `https://cockpit.invalid/tab/${tab}`
export { limitRows } from './desk-layout'

/** The tab's underline, `px` wide: always there, the accent under the open tab and transparent under the others, so the row never changes size. */
const underline = (color: string, px: number): string => `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="2" viewBox="0 0 ${px} 2" preserveAspectRatio="none"><rect width="${px}" height="2" fill="${color}"/></svg>`

const BODIES = { now: deskNow, log: deskLog, analysis: deskAnalysis } as const

/**
 * The desktop page: the head, the tab row, the open tab's body, then the action bar. The page is as tall as its content and the pane scrolls over
 * it as a whole, head and bar included (the engine has no scrolling Box, and a Desktop wheel never reaches a hook while the page fits).
 * Widths are the pane's own (`100%`) or the layout's, never a fixed column count.
 */
export function deskView(ui: DeskUi, s: CockpitSnapshot, bodyColumns: number, bodyRows: number, actions: PaneActions): RenderElement {
  const { Box, Text, Markdown, Svg } = ui
  const S = t().desk
  const open: Tab = s.deskTab ?? 'now'
  // the pane scrolls as a whole (owner, 2026-11-20): the body draws every row, up to PAGE_ROWS, and the engine's own window moves over it
  void bodyRows
  const layout = deskLayout(bodyColumns, PAGE_ROWS)
  const tabs = (
    <Box key="desk:tabs" columnGap={2}>
      {TABS.map(tab => {
        const px = S.tabs[tab].length * TAB_CHAR_PX
        // text, not buttons (a desktop Button is always native chrome): the open tab bold in the accent, the others a link the press answers
        return (
          <Box key={`desk:tab:${tab}`} flexDirection="column">
            {tab === open ? (
              <Box key={`tab:${tab}`}>
                <Text color={ACCENT} weight="bold">
                  {S.tabs[tab]}
                </Text>
              </Box>
            ) : (
              <Markdown key={`tab:${tab}`} text={`[${S.tabs[tab]}](${tabHref(tab)})`} onLinkPress={() => actions.setTab(tab)} />
            )}
            <Svg source={underline(tab === open ? ACCENT : 'transparent', px)} alt={S.tabs[tab]} width={px} height={2} />
          </Box>
        )
      })}
    </Box>
  )
  const body = (
    <Box key={`desk:body:${open}`} flexDirection="column">
      {BODIES[open](ui, s, layout, actions)}
    </Box>
  )
  return (
    <Box flexDirection="column" width="100%" rowGap={1} paddingX={1} paddingBottom={FOOT_PAD}>
      {deskHead(ui, s, layout, actions)}
      {tabs}
      {body}
      {deskActions(ui, layout, actions)}
    </Box>
  )
}
