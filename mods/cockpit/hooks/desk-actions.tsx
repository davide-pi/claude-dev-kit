import type { RenderElement } from 'claude-code'

import type { DeskLayout } from './desk-layout'
import type { DeskUi } from './desk-view'
import { t } from './strings'
import type { PaneActions } from './view-kit'

/** The page's action bar, under every tab as on the design board: the compact button. One handler per action, this key only here. */
export function deskActions(ui: DeskUi, layout: DeskLayout, actions: PaneActions): RenderElement {
  const { Box, Text, Button } = ui
  const A = t().desk.buttons
  const isNarrow = layout.size === 'narrow'
  return (
    <Box key="desk:actions" flexDirection={isNarrow ? 'column' : 'row'} flexWrap={isNarrow ? 'nowrap' : 'wrap'} flexShrink={0} alignItems={isNarrow ? 'flex-start' : 'center'} columnGap={1} rowGap={1}>
      <Button key="desk:compact" variant="primary" onPress={() => actions.compact()}>
        <Text wrap="truncate">{A.compact}</Text>
      </Button>
    </Box>
  )
}
