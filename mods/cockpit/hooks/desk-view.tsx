import type { Elements, RenderElement } from 'claude-code'

import type { CockpitSnapshot } from '../types'
import { deskActions, deskAnalysis } from './desk-analysis'
import { deskHead } from './desk-head'
import { deskLayout } from './desk-layout'
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
/** Rows kept free under the action bar: on Desktop the pane's 100% runs under its own title bar, so the bar would sit half out of view. */
const FOOT_PAD = 3
/** The rows a body may draw: the pane scrolls over them, so the cap only bounds the tree (a long Log ends on its "a–b / n" hint). */
const PAGE_ROWS = 240

export { limitRows } from './desk-layout'


const BODIES = { now: deskNow, log: deskLog, analysis: deskAnalysis } as const

/**
 * The desktop page: the head, the tab row, the open tab's body, then the action bar. The page is at least the pane's height (the body grows, so the bar sits at the bottom of an
 * empty page) and otherwise as tall as its content, and the pane scrolls over
 * it as a whole, head and bar included (the engine has no scrolling Box, and a Desktop wheel never reaches a hook while the page fits).
 * Widths are the pane's own (`100%`) or the layout's, never a fixed column count.
 */
export function deskView(ui: DeskUi, s: CockpitSnapshot, bodyColumns: number, actions: PaneActions): RenderElement {
  const { Box, Button } = ui
  const S = t().desk
  const open: Tab = s.deskTab ?? 'now'
  // the pane scrolls as a whole (owner, 2026-11-20): the body draws every row, up to PAGE_ROWS, and the engine's own window moves over it
  const layout = deskLayout(bodyColumns, PAGE_ROWS)
  const tabs = (
    <Box key="desk:tabs" columnGap={2}>
      {TABS.map(tab => {
        // native buttons (owner's choice): the open one is the purple button itself, no line under it; the others keep the same size
        return (
          <Box key={`desk:tab:${tab}`} {...(tab === open ? { backgroundColor: ACCENT } : {})}>
            <Button key={`tab:${tab}`} variant={tab === open ? 'primary' : 'secondary'} onPress={() => actions.setTab(tab)}>
              {S.tabs[tab]}
            </Button>
          </Box>
        )
      })}
    </Box>
  )
  const body = (
    <Box key={`desk:body:${open}`} flexDirection="column" flexGrow={1}>
      {BODIES[open](ui, s, layout, actions)}
    </Box>
  )
  return (
    <Box flexDirection="column" width="100%" minHeight="100%" rowGap={1} paddingX={1} paddingBottom={FOOT_PAD}>
      {deskHead(ui, s, layout, actions)}
      {tabs}
      {body}
      {deskActions(ui, layout, actions)}
    </Box>
  )
}
