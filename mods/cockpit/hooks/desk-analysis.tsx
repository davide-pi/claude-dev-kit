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

// ── The desktop Analysis tab: time, spend, what to watch, and the three buttons that act on them ──

const ACCENT = '#8B6CF6'
const TEXT = '#F2F0EA'
const DIM = '#A8A49B'
/** Every section always draws this many rows, so nothing jumps when the data arrives. */
const SECTION_ROWS = 3
const GAP = 2

/** `SECTION_ROWS` rows: a cut list ends with the `more` row, a short one is padded with blank ones, so a section keeps its height. */
const keepRows = (rows: readonly RenderElement[], more: (n: number) => RenderElement, blank: (n: number) => RenderElement): RenderElement[] => [
  ...limitRows(rows, SECTION_ROWS, more),
  ...Array.from({ length: Math.max(0, SECTION_ROWS - rows.length) }, (_, i) => blank(i)),
]

/** The Analysis tab: the insights the terminal page computes (time split, spend by who, watch list) and the compact and retrospective buttons. */
export function deskAnalysis(ui: DeskUi, s: CockpitSnapshot, layout: DeskLayout, actions: PaneActions): RenderElement {
  const { Box, Text, Button, Svg } = ui
  const A = t().desk.analysis
  const S = t()
  const ins = s.insights
  const title = (key: string, label: string) => (
    <Text key={key} weight="bold" color={ACCENT} wrap="truncate">
      {label}
    </Text>
  )
  const row = (key: string, icon: string, text: string) => (
    <Box key={key} columnGap={1}>
      <Svg source={iconSvg(icon, ACCENT)} alt={text} height={16} />
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
    <Box key={`analysis:${key}`} flexDirection="column" flexGrow={1}>
      {title(`${key}:title`, label)}
      {keepRows(
        rows,
        n => (
          <Text key={`${key}:more`} color={DIM}>
            {`+${n}`}
          </Text>
        ),
        n => (
        <Text key={`${key}:blank:${n}`} color={DIM}>
          {' '}
        </Text>
      ))}
    </Box>
  )
  const buttons = (
    <Box key="analysis:buttons" flexDirection={layout.size === 'narrow' ? 'column' : 'row'} columnGap={GAP}>
      <Button key="analysis:compact" onPress={() => actions.compact()}>
        <Text color={ACCENT} wrap="truncate">
          {A.compactNow}
        </Text>
      </Button>
      <Button key="analysis:retro:session" onPress={() => actions.retro('session')}>
        <Text color={TEXT} wrap="truncate">
          {`/retro ${A.retroSession}`}
        </Text>
      </Button>
      <Button key="analysis:retro:days" onPress={() => actions.retro('days')}>
        <Text color={TEXT} wrap="truncate">
          {`/retro ${A.retroDays}`}
        </Text>
      </Button>
    </Box>
  )
  return (
    <Box key="desk:analysis" flexDirection="column" width="100%" rowGap={1}>
      <Box flexDirection={layout.size === 'wide' ? 'row' : 'column'} columnGap={GAP} rowGap={1}>
        {section('time', A.time, time)}
        {section('spend', A.spend, spend)}
      </Box>
      {section('watch', A.watch, watch)}
      {buttons}
    </Box>
  )
}
