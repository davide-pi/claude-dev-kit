import type { RenderElement } from 'claude-code'

import type { CockpitSnapshot } from '../types'
import { spendSplit } from './andamento'
import type { DeskLayout } from './desk-layout'
import { limitRows } from './desk-layout'
import { iconSvg } from './desk-svg'
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
const GAP = 2

/** `SECTION_ROWS` rows: a cut list ends with the `more` row, a short one is padded with blank ones, so a section keeps its height. */
const keepRows = (rows: readonly RenderElement[], more: (n: number) => RenderElement, blank: (n: number) => RenderElement): RenderElement[] => [
  ...limitRows(rows, SECTION_ROWS, more),
  ...Array.from({ length: Math.max(0, SECTION_ROWS - rows.length) }, (_, i) => blank(i)),
]

/** The page's action bar, under every tab as on the design board: compact on the left, the two retrospectives on the right (on their own line when narrow). One handler per action, these keys only here. */
export function deskActions(ui: DeskUi, layout: DeskLayout, actions: PaneActions): RenderElement {
  const { Box, Text, Button } = ui
  const A = t().desk.analysis
  const isNarrow = layout.size === 'narrow'
  return (
    <Box key="desk:actions" flexDirection={isNarrow ? 'column' : 'row'} alignItems={isNarrow ? 'flex-start' : 'center'} columnGap={1}>
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
  const title = (key: string, label: string) => (
    <Text key={key} weight="bold" size="footnote" color={TITLE} wrap="truncate">
      {label}
    </Text>
  )
  const row = (key: string, icon: string, text: string) => (
    <Box key={key} columnGap={1} alignItems="center">
      <Svg source={iconSvg(icon, ACCENT)} alt={text} width={16} height={16} />
      <Text color={TEXT} wrap="truncate">
        {text}
      </Text>
    </Box>
  )

  // TIME: the rounds, the main loop tool calls, the wait for the person
  const time =
    ins === undefined || ins.rounds <= 0
      ? []
      : [row('time:rounds', 'clock', `${A.rounds} ${duration(ins.roundMs)}`), row('time:tools', 'flow', `${A.tools} ${duration(ins.toolMs)}`), row('time:wait', 'alert', `${A.waited} ${duration(ins.waitMs)}`)]
  // SPEND: who spent the session money
  const spend = spendSplit(s).map(p => {
    const label = p.label === 'main' ? S.page.main : p.label === 'other' ? S.page.other : p.label
    return row(`spend:${p.label}`, 'check', `${label} ${Math.round(p.pct)}% ${fmtCost(p.usd)}`)
  })
  // KEEP AN EYE ON: the live notifications
  const watch = signalsOf(s).map(sig => row(`watch:${sig.kind}:${sig.key}`, 'alert', signalText(sig).what))

  const section = (key: string, label: string, rows: RenderElement[]) => (
    <Box key={`analysis:${key}`} flexDirection="column" flexGrow={1} paddingX={1} backgroundColor={CARD}>
      {title(`${key}:title`, label)}
      {keepRows(
        rows,
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
        {section('spend', A.spend, spend)}
      </Box>
      {section('watch', A.watch, watch)}
    </Box>
  )
}
