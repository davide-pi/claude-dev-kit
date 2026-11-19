import type { Elements, RenderElement } from 'claude-code'

import type { CockpitSnapshot } from '../types'
import { deskAnalysis } from './desk-analysis'
import { deskHead } from './desk-head'
import { DESK_WIDE_FROM, deskLayout } from './desk-layout'
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
/** Rows the head takes of a wide pane (its 5-row URGENTE card included); the tab body gets what is left, never fewer than `MIN_BODY_ROWS`. */
const HEAD_ROWS = 18
/** Below the wide layout each of the two credit rows takes a second line. */
const HEAD_ROWS_STACKED = HEAD_ROWS + 2
const MIN_BODY_ROWS = 8

/** The rows the tab body may take of a pane `bodyRows` tall, so the head stays in view. */
export const bodyLimit = (bodyRows: number, bodyColumns: number = DESK_WIDE_FROM): number =>
  Math.max(bodyRows - (bodyColumns < DESK_WIDE_FROM ? HEAD_ROWS_STACKED : HEAD_ROWS), MIN_BODY_ROWS)

export { limitRows } from './desk-layout'

/** The tab's underline: always there, the accent under the open tab and transparent under the others, so the row never changes size. */
const underline = (color: string): string => `<svg width="100%" height="2" viewBox="0 0 100 2" preserveAspectRatio="none"><rect width="100" height="2" fill="${color}"/></svg>`

const BODIES = { now: deskNow, log: deskLog, analysis: deskAnalysis } as const

/** The desktop page: the head, the tab row, then the open tab's body. Widths are the pane's own (`100%`) or the layout's, never a fixed column count. */
export function deskView(ui: DeskUi, s: CockpitSnapshot, bodyColumns: number, bodyRows: number, actions: PaneActions): RenderElement {
  const { Box, Text, Button, Svg } = ui
  const S = t().desk
  const open: Tab = s.deskTab ?? 'now'
  const layout = deskLayout(bodyColumns, bodyLimit(bodyRows, bodyColumns))
  const tabs = (
    <Box key="desk:tabs" columnGap={2}>
      {TABS.map(tab => (
        <Box key={`desk:tab:${tab}`} flexDirection="column">
          <Button key={`tab:${tab}`} onPress={() => actions.setTab(tab)}>
            <Text color={tab === open ? TEXT : DIM}>{S.tabs[tab]}</Text>
          </Button>
          <Svg source={underline(tab === open ? ACCENT : 'transparent')} alt={S.tabs[tab]} height={2} />
        </Box>
      ))}
    </Box>
  )
  const body = (
    <Box key={`desk:body:${open}`} flexDirection="column">
      {BODIES[open](ui, s, layout, actions)}
    </Box>
  )
  return (
    <Box flexDirection="column" width="100%" rowGap={1}>
      {deskHead(ui, s, layout, actions)}
      {tabs}
      {body}
    </Box>
  )
}
