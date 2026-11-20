import type { RenderElement } from 'claude-code'

import type { CockpitSnapshot } from '../types'
import { spendSplit } from './andamento'
import type { DeskLayout } from './desk-layout'
import { limitRows } from './desk-layout'
import { iconSvg, shareSvg } from './desk-svg'
import type { DeskUi } from './desk-view'
import { duration, fmtCost } from './shared'
import { signalsOf } from './signals'
import { t } from './strings'
import type { PaneActions } from './view-kit'
import { signalText } from './view-kit'

// ── The desktop Analysis tab (time, spend, what to watch) and the page's action bar (compact, retrospectives) ──

const ACCENT = '#8B6CF6'
const TITLE = '#B9A2FF'
const TEXT = '#F2F0EA'
const DIM = '#A8A49B'
/** The background of a section's card, as on the design board. */
const CARD = '#30302E'
/** Every section always draws this many rows, so nothing jumps when the data arrives. */
const SECTION_ROWS = 3
/** The watch list's rows: small, so an empty one is one dim line and a blank, never a big empty card. */
const WATCH_ROWS = 2
const GAP = 2
const BORDER = '#403F3B'
const SHARE = '#B9A2FF'
/** The spend percent's column in cells, `100%` included: never shrunk, so a narrow pane cuts the label and never the figure. */
const PCT_COLS = 4

/** `size` rows: a cut list ends with the `more` row, a short one is padded with blank ones, so a section keeps its height. */
const keepRows = (rows: readonly RenderElement[], size: number, more: (n: number) => RenderElement, blank: (n: number) => RenderElement): RenderElement[] => [
  ...limitRows(rows, size, more),
  ...Array.from({ length: Math.max(0, size - rows.length) }, (_, i) => blank(i)),
]

/** The page's action bar, under every tab as on the design board: compact on the left, the two retrospectives on the right (on their own line when narrow). One handler per action, these keys only here. */
export function deskActions(ui: DeskUi, layout: DeskLayout, actions: PaneActions): RenderElement {
  const { Box, Text, Button } = ui
  const A = t().desk.analysis
  const isNarrow = layout.size === 'narrow'
  return (
    <Box key="desk:actions" flexDirection={isNarrow ? 'column' : 'row'} flexWrap={isNarrow ? 'nowrap' : 'wrap'} flexShrink={0} alignItems={isNarrow ? 'flex-start' : 'center'} columnGap={1} rowGap={1}>
      <Button key="analysis:compact" variant="primary" onPress={() => actions.compact()}>
        <Text wrap="truncate">{A.compactNow}</Text>
      </Button>
      <Box flexGrow={1} />
      <Box key="desk:actions:retro" columnGap={1} alignItems="center">
        <Text color={DIM} size="footnote" wrap="truncate">
          {A.retro}
        </Text>
        <Button key="analysis:retro:session" variant="secondary" onPress={() => actions.retro('session')}>
          <Text wrap="truncate">{A.retroSession}</Text>
        </Button>
        <Button key="analysis:retro:days" variant="secondary" onPress={() => actions.retro('days')}>
          <Text wrap="truncate">{A.retroDays}</Text>
        </Button>
      </Box>
    </Box>
  )
}

/** The Analysis tab: the insights the terminal page computes (time split, spend by who, watch list), each a card. */
export function deskAnalysis(ui: DeskUi, s: CockpitSnapshot, layout: DeskLayout, _actions: PaneActions): RenderElement {
  const { Box, Text, Svg } = ui
  const A = t().desk.analysis
  const S = t()
  const ins = s.insights
  // the title as the head's section titles, with an optional figure at its right
  const title = (key: string, label: string, right?: string) => (
    <Box key={key} columnGap={1} alignItems="center">
      <Box flexGrow={1} flexShrink={1} minWidth={0}>
        <Text weight="bold" size="footnote" color={TITLE} wrap="truncate">
          {label}
        </Text>
      </Box>
      <Text weight="bold" color={TEXT} tabular wrap="truncate">
        {right ?? ' '}
      </Text>
    </Box>
  )
  // two columns: the label takes the row, the value sits right-aligned in tabular figures
  const pair = (key: string, label: string, value: string) => (
    <Box key={key} columnGap={1} alignItems="center">
      <Box flexGrow={1} flexShrink={1} minWidth={0}>
        <Text color={TEXT} wrap="truncate">
          {label}
        </Text>
      </Box>
      <Text color={TEXT} weight="semibold" tabular wrap="truncate">
        {value}
      </Text>
    </Box>
  )
  const watchRow = (key: string, text: string) => (
    <Box key={key} columnGap={1} alignItems="center">
      <Svg source={iconSvg('alert', ACCENT)} alt={text} width={16} height={16} />
      <Text color={TEXT} wrap="truncate">
        {text}
      </Text>
    </Box>
  )

  // TIME: the rounds, the main loop tool calls, the wait for the person
  const time =
    ins === undefined || ins.rounds <= 0
      ? []
      : [pair('time:rounds', A.rounds, duration(ins.roundMs)), pair('time:tools', A.tools, duration(ins.toolMs)), pair('time:wait', A.waited, duration(ins.waitMs))]
  // SPEND: who spent the session money, as on the design board: share, its bar, who, cost
  const spend = spendSplit(s).map(p => {
    const label = p.label === 'main' ? S.page.main : p.label === 'other' ? S.page.other : p.label
    const pct = Math.round(p.pct)
    return (
      <Box key={`spend:${p.label}`} columnGap={1} alignItems="center">
        <Box key={`spend:${p.label}:pct`} width={PCT_COLS} flexShrink={0} justifyContent="flex-end">
          <Text color={TEXT} weight="bold" tabular>
            {`${pct}%`.padStart(4)}
          </Text>
        </Box>
        <Svg source={shareSvg(pct, SHARE)} alt={`${label} ${pct}%`} width={84} height={6} />
        <Box flexGrow={1} flexShrink={1} minWidth={0}>
          <Text color={TEXT} wrap="truncate">
            {label}
          </Text>
        </Box>
        <Text color={DIM} tabular wrap="truncate">
          {fmtCost(p.usd)}
        </Text>
      </Box>
    )
  })
  // KEEP AN EYE ON: the live notifications
  const watch = signalsOf(s).map(sig => watchRow(`watch:${sig.kind}:${sig.key}`, signalText(sig).what))

  const section = (key: string, label: string, rows: RenderElement[], size = SECTION_ROWS, right?: string) => (
    <Box key={`analysis:${key}`} flexDirection="column" flexGrow={1} paddingX={1} backgroundColor={CARD} borderStyle="round" borderColor={BORDER}>
      {title(`${key}:title`, label, right)}
      {keepRows(
        rows,
        size,
        n => (
          <Text key={`${key}:more`} color={DIM}>
            {`+${n}`}
          </Text>
        ),
        // an empty section says so on its first row; the rest stay blank, so its height holds
        n => (
          <Text key={`${key}:blank:${n}`} color={DIM} wrap="truncate">
            {n === 0 && rows.length === 0 ? A.none : ' '}
          </Text>
        ),
      )}
    </Box>
  )
  return (
    <Box key="desk:analysis" flexDirection="column" width="100%" rowGap={1}>
      <Box flexDirection={layout.size === 'wide' ? 'row' : 'column'} columnGap={GAP} rowGap={1}>
        {section('time', A.time, time)}
        {section('spend', A.spend, spend, SECTION_ROWS, fmtCost(s.cost.usd))}
      </Box>
      {section('watch', A.watch, watch, WATCH_ROWS)}
    </Box>
  )
}
