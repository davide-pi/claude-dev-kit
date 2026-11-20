import type { RenderElement } from 'claude-code'

import type { CockpitSnapshot } from '../types'
import type { DeskLayout } from './desk-layout'
import { railSvg } from './desk-svg'
import type { DeskUi } from './desk-view'
import { DIM, TEXT, flowName, logRowsOf } from './log-rows'
import type { Row } from './log-rows'
import { clockTime } from './shared'
import { t } from './strings'
import { ALL_KEY, isAllShown } from './view-log-round'
import type { PaneActions } from './view-kit'

const LINK = '#B9A2FF'
const RAIL_WIDTH = 86
/** The rail's height in CSS pixels: the row takes it, so the lanes of two rows meet. */
const RAIL_PX = 28
/** The cells of `bodyRows` one row takes: a 28px rail over a code-font line of about 21px (measured on a capture), with a margin. */
const ROW_CELLS = 1.4
/** The cells the filter row (native buttons) takes above the rows. */
const FILTER_CELLS = 2
/** The time column's width in cells: `HH:MM`. */
const TIME_COLS = 5
/** The cells the position hint takes under the rows. */
const HINT_CELLS = 1

/** The rows a window of the Log holds: what `layout.bodyRows` leaves under the filter and over the hint, a rail's height each. */
const windowRows = (layout: DeskLayout): number => Math.max(2, Math.floor((layout.bodyRows - FILTER_CELLS - HINT_CELLS) / ROW_CELLS))

/** The Log tab of the desktop page: the filter and legend, then one row per round, event and flow, each a fixed-width rail and a text column that takes the rest. */
export function deskLog(ui: DeskUi, s: CockpitSnapshot, layout: DeskLayout, actions: PaneActions): RenderElement {
  const { Box, Text, Button, Svg } = ui
  const S = t().desk.log
  const isAll = isAllShown(s)
  const rows = logRowsOf(s)

  // the time column is always there, a fixed width in tabular figures (blank without a time), so the text column never moves
  const line = (key: string, rail: string, alt: string, at: number | undefined, content: RenderElement): RenderElement => (
    <Box key={key} flexDirection="row" alignItems="center" columnGap={1}>
      <Svg source={rail} alt={alt} width={RAIL_WIDTH} height={RAIL_PX} />
      <Box key={`${key}:time`} width={TIME_COLS} flexShrink={0}>
        <Text color={DIM} tabular>
          {at === undefined ? ' ' : clockTime(at)}
        </Text>
      </Box>
      <Box flexGrow={1} flexShrink={1} minWidth={0}>
        {content}
      </Box>
    </Box>
  )
  const drawRow = (r: Row): RenderElement => {
    const id = r.round === undefined ? '' : `#${r.round}`
    const parts: RenderElement[] = [
      ...(id === '' ? [] : [<Text color={DIM}>{`${id} `}</Text>]),
      ...(r.flow === undefined ? [] : [<Text color={LINK} weight="medium">{`${flowName(r.flow)} `}</Text>]),
      <Text color={r.color} weight={r.isHeader === true ? 'bold' : undefined}>
        {r.text}
      </Text>,
    ]
    return line(`desk:log:row:${r.key}`, railSvg({ lanes: r.lanes, ...(r.dot !== undefined && { dot: r.dot }), height: RAIL_PX }), id === '' ? r.text : id, r.at, <Text wrap="truncate">{parts}</Text>)
  }
  // the newest `cap` rows: the pane scrolls over them, the cap only bounds the tree
  const cap = windowRows(layout)
  const shown = rows.slice(0, cap)
  // always drawn, one cell tall, blank when every row shows: the rows above never shift
  const hint = (
    <Box key="desk:log:hint" height={HINT_CELLS} paddingLeft={1}>
      <Text color={DIM}>{rows.length > cap ? `1–${shown.length} / ${rows.length}` : ' '}</Text>
    </Box>
  )
  const drawn =
    rows.length === 0
      ? [line('desk:log:empty', railSvg({ lanes: [], height: RAIL_PX }), S.empty, undefined, <Text wrap="truncate" color={DIM}>{S.empty}</Text>), hint]
      : [...shown.map(drawRow), hint]

  // one filter for both pages on purpose: the same ALL_KEY the terminal log toggles; the mode is plain text, one button switches to the other
  return (
    <Box key="desk:log" flexDirection="column" width="100%">
      <Box key="desk:log:filter" flexDirection="row" columnGap={1} alignItems="center">
        <Text color={LINK} weight="bold">
          {isAll ? S.all : S.important}
        </Text>
        <Box flexGrow={1} flexShrink={1} minWidth={0}>
          <Text wrap="truncate" color={DIM}>{`· ${S.newestTop}`}</Text>
        </Box>
        <Button key={isAll ? 'desk:log:important' : 'desk:log:all'} onPress={() => actions.toggleOpen(ALL_KEY)}>
          <Text color={DIM}>{isAll ? S.onlyImportant : S.showAll}</Text>
        </Button>
      </Box>
      <Box key="desk:log:window" flexDirection="column" width="100%">
        {drawn}
      </Box>
    </Box>
  )
}
