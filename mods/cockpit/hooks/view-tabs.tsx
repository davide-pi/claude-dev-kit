import { andamentoBlocks, attentionBlocks, inProgressBlocks } from './view-page'
import { duration } from './shared'
import { t } from './strings'
import { pairRow } from './view-agents'
import { BUTTON_GAP, buttonRowWidth, dim, line } from './view-base'
import type { Block, Kit } from './view-kit'
import { laneBlocks } from './view-lanes'

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

/** In corso: the open round, the run and the agents, as IN PROGRESS draws them; one dim line when nothing runs. */
function nowBlocks(k: Kit): Block[] {
  const blocks = inProgressBlocks(k)
  return blocks.length === 0 ? [[line(k.ui, [dim(t().desk.now.noRequest)])]] : blocks
}

/** Analisi: where the time went, who spent the money and what to watch. */
function analysisBlocks(k: Kit): Block[] {
  const { ui, s, width, title } = k
  const A = t().desk.analysis
  const ins = s.insights
  const time: Block[] =
    ins === undefined || ins.rounds <= 0
      ? []
      : [
          [
            title(A.time),
            ...[
              [A.rounds, ins.roundMs],
              [A.tools, ins.toolMs],
              [A.waited, ins.waitMs],
            ].map(([label, ms]) => line(ui, pairRow([dim(String(label))], [dim(duration(Number(ms)))], width))),
          ],
        ]
  return [...time, ...andamentoBlocks(k), ...attentionBlocks(k)]
}

const BODIES: Record<Tab, (k: Kit) => Block[]> = { now: nowBlocks, log: laneBlocks, analysis: analysisBlocks }

/** The open tab's body. */
export const tabBody = (k: Kit, open: Tab): Block[] => BODIES[open](k)
