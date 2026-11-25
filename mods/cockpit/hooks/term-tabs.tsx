import { t } from './strings'
import { BUTTON_GAP, buttonRowWidth } from './view-base'
import type { Block, Kit } from './view-kit'
import { laneBlocks } from './view-lanes'
import { nowSections } from './view-now'

// ── The terminal page's two tabs, the same as the desktop's: In corso, Log ──

export type Tab = 'now' | 'log'
const TABS: readonly Tab[] = ['now', 'log']

/** The tab row: native buttons, the open one primary. Its direction follows the width alone, so the row never changes shape with the data. */
export function tabRow(k: Kit, open: Tab): Block {
  const { ui, width, actions } = k
  const { Box, Button } = ui
  const S = t().desk.tabs
  return [
    <Box key="tabs" flexDirection={buttonRowWidth(TABS.map(tab => S[tab])) <= width ? 'row' : 'column'} alignItems="flex-start" columnGap={BUTTON_GAP}>
      {TABS.map(tab => (
        <Button key={`tab:${tab}`} variant={tab === open ? 'primary' : 'secondary'} onPress={() => actions.setTab(tab)}>
          {S[tab]}
        </Button>
      ))}
    </Box>,
  ]
}

const BODIES: Record<Tab, (k: Kit) => Block[]> = { now: nowSections, log: laneBlocks }

/** The open tab's body. */
export const tabBody = (k: Kit, open: Tab): Block[] => BODIES[open](k)
