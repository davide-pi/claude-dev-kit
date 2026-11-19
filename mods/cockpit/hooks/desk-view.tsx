import type { Elements, RenderElement } from 'claude-code'

import type { CockpitSnapshot } from '../types'
import { deskActions, deskAnalysis } from './desk-analysis'
import { deskHead } from './desk-head'
import { DESK_MEDIUM_FROM, DESK_WIDE_FROM, deskLayout } from './desk-layout'
import { deskLog } from './desk-log'
import { deskNow } from './desk-now'
import { t } from './strings'
import type { Ui } from './view-base'
import type { PaneActions } from './view-kit'

/** What the desktop page draws with: the shared elements and the desktop's `Svg`. */
export type DeskUi = Ui & Pick<Elements['desktop'], 'Svg'>

type Tab = 'now' | 'log' | 'analysis'
const TABS: readonly Tab[] = ['now', 'log', 'analysis']

const ACCENT = '#8B6CF6'
const TEXT = '#F2F0EA'
const DIM = '#A8A49B'
/**
 * Rows the head and the tab row take by layout size, each followed by a 1-row gap: the state lines 3 (a 20px icon, the cost in heading size), the gauges
 * card (the donut, 72/96/120px, with its 2 lines under it beside the credit windows' 7 rows: 8 medium, 10 wide; narrow stacks them: 15), the URGENTE
 * card 5 (its worklog row holds a native button, 2 rows) and the tab row 3 (a native button and its underline). Medium: 3+1+8+1+5+1+3+1 = 23.
 */
const HEAD_ROWS = { narrow: 30, medium: 23, wide: 25 } as const
/** Rows the action bar takes with the gap above it: one row of native buttons, two when narrow (compact, then the retrospectives). */
const ACTION_ROWS = { narrow: 5, medium: 3, wide: 3 } as const
const MIN_BODY_ROWS = 8
/** The underline's width per letter of the tab's label and for the button's own padding, in CSS pixels: the label's drawn width is not known, so an estimate. */
const TAB_CHAR_PX = 8
const TAB_PAD_PX = 24

const sizeOf = (columns: number): keyof typeof HEAD_ROWS => (columns >= DESK_WIDE_FROM ? 'wide' : columns >= DESK_MEDIUM_FROM ? 'medium' : 'narrow')

/** The rows the tab body may take of a pane `bodyRows` tall, so the head above and the action bar below both stay in view. */
export const bodyLimit = (bodyRows: number, bodyColumns: number = DESK_WIDE_FROM): number => {
  const size = sizeOf(bodyColumns)
  return Math.max(bodyRows - HEAD_ROWS[size] - ACTION_ROWS[size], MIN_BODY_ROWS)
}

export { limitRows } from './desk-layout'

/** The tab's underline, `px` wide: always there, the accent under the open tab and transparent under the others, so the row never changes size. */
const underline = (color: string, px: number): string => `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="2" viewBox="0 0 ${px} 2" preserveAspectRatio="none"><rect width="${px}" height="2" fill="${color}"/></svg>`

const BODIES = { now: deskNow, log: deskLog, analysis: deskAnalysis } as const

/** The desktop page: the head, the tab row, the open tab's body (its rows reserved, so the bar below never moves), then the action bar. Widths are the pane's own (`100%`) or the layout's, never a fixed column count. */
export function deskView(ui: DeskUi, s: CockpitSnapshot, bodyColumns: number, bodyRows: number, actions: PaneActions): RenderElement {
  const { Box, Text, Button, Svg } = ui
  const S = t().desk
  const open: Tab = s.deskTab ?? 'now'
  const limit = bodyLimit(bodyRows, bodyColumns)
  const layout = deskLayout(bodyColumns, limit)
  const tabs = (
    <Box key="desk:tabs" columnGap={2}>
      {TABS.map(tab => {
        const px = S.tabs[tab].length * TAB_CHAR_PX + TAB_PAD_PX
        return (
          <Box key={`desk:tab:${tab}`} flexDirection="column">
            <Button key={`tab:${tab}`} onPress={() => actions.setTab(tab)}>
              <Text color={tab === open ? TEXT : DIM} weight="semibold">
                {S.tabs[tab]}
              </Text>
            </Button>
            <Svg source={underline(tab === open ? ACCENT : 'transparent', px)} alt={S.tabs[tab]} width={px} height={2} />
          </Box>
        )
      })}
    </Box>
  )
  const body = (
    <Box key={`desk:body:${open}`} flexDirection="column" minHeight={limit}>
      {BODIES[open](ui, s, layout, actions)}
    </Box>
  )
  return (
    <Box flexDirection="column" width="100%" rowGap={1} paddingX={1}>
      {deskHead(ui, s, layout, actions)}
      {tabs}
      {body}
      {deskActions(ui, layout, actions)}
    </Box>
  )
}
