import type { RenderElement } from 'claude-code'

import { scrollbarSvg } from './desk-svg'
import type { DeskUi } from './desk-view'
import type { PaneActions } from './view-kit'

const ACCENT = '#8B6CF6'
/** An arrow that would do nothing (at its end, or nothing to scroll): drawn, so the column holds still, but barely there. */
const OFF = '#55534D'
/** The rows the two arrow buttons and their gaps take of the section, in CSS pixels: the scrollbar takes the rest. */
const ARROWS_PX = 76
const MIN_TRACK_PX = 24

/** Where a section's window is: the first unit shown, the furthest one, how many show at once, how many there are, and the section's height in px. */
export type ScrollState = { offset: number; max: number; window: number; total: number; heightPx: number }

/**
 * A scrolling section: its content and, at its right, a column always reserved (no shift when the list outgrows the window): `▲`, the
 * scrollbar, `▼`. A press moves a window less one unit (at least one) through `scrollBody`; at an end the arrow is dim and does nothing.
 */
export function scrolling(ui: DeskUi, key: string, content: RenderElement | RenderElement[], p: ScrollState, actions: PaneActions): RenderElement {
  const { Box, Text, Button, Svg } = ui
  // everything fits (always, now that the pane scrolls as a whole): the content alone, no column
  if (p.max <= 0)
    return (
      <Box key={key} flexDirection="column" width="100%">
        {content}
      </Box>
    )
  const step = Math.max(1, p.window - 1)
  const size = p.max <= 0 || p.total <= 0 ? 1 : Math.min(1, p.window / p.total)
  const start = p.max <= 0 ? 0 : (p.offset / p.max) * (1 - size)
  const isTop = p.offset <= 0
  const isEnd = p.offset >= p.max
  const track = Math.max(MIN_TRACK_PX, Math.round(p.heightPx - ARROWS_PX))
  return (
    <Box key={key} flexDirection="row" columnGap={1} width="100%">
      <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0}>
        {content}
      </Box>
      <Box key="desk:scroll" flexDirection="column" alignItems="center" flexShrink={0} rowGap={1}>
        <Button key="desk:scroll:up" onPress={() => (isTop ? undefined : actions.scrollBody(-step, p.max))}>
          <Text color={isTop ? OFF : ACCENT}>▲</Text>
        </Button>
        <Svg source={scrollbarSvg({ height: track, start, size, color: ACCENT })} alt={`${Math.min(p.offset + 1, p.total)}–${Math.min(p.offset + p.window, p.total)} / ${p.total}`} width={6} height={track} />
        <Button key="desk:scroll:down" onPress={() => (isEnd ? undefined : actions.scrollBody(step, p.max))}>
          <Text color={isEnd ? OFF : ACCENT}>▼</Text>
        </Button>
      </Box>
    </Box>
  )
}
