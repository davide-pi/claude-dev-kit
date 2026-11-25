import { DIM, flowName, logRowsOf } from './log-rows'
import type { Row } from './log-rows'
import { COLORS, clockTime, spanWidth, truncateSpans } from './shared'
import type { Span } from './shared'
import { t } from './strings'
import { dim, line, sp, spanNodes } from './view-base'
import type { Block, Kit } from './view-kit'
import { ALL_KEY, isAllShown } from './view-log-round'

// ── The terminal's Log tab: the desktop's rows and lanes, one glyph column per flow ──

/** The rows the tab draws; the pane scrolls over them, so the cap only bounds the tree. */
const ROWS_MAX = 40
/** Cells of the session column (`● `) and of the time column and the space after it (`HH:MM `). */
const SESSION_CELLS = 2
const TIME_CELLS = 6
/** The text a row keeps at least, before a lane column is given up. */
const TEXT_MIN = 12
const LANE_CELLS = 2
/** The desktop rail's lanes; a flow past the columns that fit shares the last one. */
const LANES_MAX = 7
const LANE_COLORS = [COLORS.blue, COLORS.green, COLORS.amber, COLORS.lavender, COLORS.yellow]
const GLYPHS = { start: '╭', through: '│', end: '╰', dot: '●' } as const

/** What lane column `i` of `columns` draws on a row: the flow's own row a dot, else its line (`start` runs down to older rows, `end` comes from newer ones); blank where no lane runs. */
function laneGlyph(r: Row, i: number, columns: number): Span {
  const here = (lane: number): boolean => Math.min(lane, columns - 1) === i
  const cell = r.lanes.find(c => here(c.lane))
  const isOwn = typeof r.dot === 'number' && here(r.dot)
  const g = isOwn ? GLYPHS.dot : cell === undefined ? ' ' : GLYPHS[cell.kind]
  return sp(`${g} `, LANE_COLORS[i % LANE_COLORS.length])
}

/** How many lane columns fit `width`: the flows' own, at most the desktop's seven, never taking the text's minimum. */
function laneColumns(rows: readonly Row[], width: number): number {
  const used = Math.max(0, ...rows.flatMap(r => r.lanes.map(c => c.lane + 1)), ...rows.flatMap(r => (typeof r.dot === 'number' ? [r.dot + 1] : [])))
  return Math.max(0, Math.min(used, LANES_MAX,Math.floor((width - SESSION_CELLS - TIME_CELLS - TEXT_MIN) / LANE_CELLS)))
}

/** A row as spans: the session column, the lane columns, the time (dim), the round, the flow and the text; cut to `width`, never wrapped. */
function rowSpans(r: Row, columns: number, width: number): Span[] {
  const lanes = Array.from({ length: columns }, (_, i) => laneGlyph(r, i, columns))
  const rail = [sp(r.dot === 'session' ? '● ' : '│ ', COLORS.lavender), ...lanes]
  const time = dim(`${r.at === undefined ? '     ' : clockTime(r.at)} `)
  const text: Span[] = [
    ...(r.round === undefined ? [] : [dim(`#${r.round} `)]),
    ...(r.flow === undefined ? [] : [sp(`${flowName(r.flow)} `, COLORS.lavender, true)]),
    sp(r.text, r.color === DIM ? COLORS.dim : undefined, r.isHeader === true),
  ]
  return [...truncateSpans([...rail, time], width), ...truncateSpans(text, Math.max(0, width - spanWidth([...rail, time])))]
}

/** The session log with its flows' lanes: the filter row, one row per round, event and flow (newest on top), then a hint that is always there so nothing shifts. */
export function laneBlocks(k: Kit): Block[] {
  const { ui, s, width, actions } = k
  const { Box, Button, Text } = ui
  const S = t().desk.log
  const isAll = isAllShown(s)
  const rows = logRowsOf(s)
  const shown = rows.slice(0, ROWS_MAX)
  const columns = laneColumns(shown, width)
  const filter = (
    <Box key="lanes:filter" columnGap={1}>
      <Text wrap="truncate" color={COLORS.title} weight="bold">
        {isAll ? S.all : S.important}
      </Text>
      <Button key="lanes:all" plain onPress={() => actions.toggleOpen(ALL_KEY)}>
        <Text wrap="truncate" color={COLORS.dim}>
          {isAll ? S.onlyImportant : S.showAll}
        </Text>
      </Button>
    </Box>
  )
  const drawn =
    rows.length === 0
      ? [line(ui, [dim(S.empty)])]
      : shown.map(r => (
          <Box key={`lanes:row:${r.key}`}>
            <Text wrap="truncate">{spanNodes(ui, rowSpans(r, columns, width))}</Text>
          </Box>
        ))
  const hint = <Text key="lanes:hint" color={COLORS.dim}>{rows.length > ROWS_MAX ? `1–${shown.length} / ${rows.length}` : ' '}</Text>
  return [[filter, drawn, hint]]
}
