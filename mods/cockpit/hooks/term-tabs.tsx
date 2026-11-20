import { t } from './strings'
import { BUTTON_GAP, buttonRowWidth } from './view-base'
import type { Block, Kit } from './view-kit'
import { laneBlocks } from './view-lanes'
import { nowSections } from './view-now'
import { attentionBlocks, spendBlocks } from './view-page'

// ── The terminal page's three tabs, the same as the desktop's: In corso, Log, Analisi ──

export type Tab = 'now' | 'log' | 'analysis'
const TABS: readonly Tab[] = ['now', 'log', 'analysis']

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

/** Analisi: who spent the money and what to watch. */
function analysisBlocks(k: Kit): Block[] {
  return [...spendBlocks(k), ...attentionBlocks(k)]
}

const BODIES: Record<Tab, (k: Kit) => Block[]> = { now: nowSections, log: laneBlocks, analysis: analysisBlocks }

/** The open tab's body. */
export const tabBody = (k: Kit, open: Tab): Block[] => BODIES[open](k)
