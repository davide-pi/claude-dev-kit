import type { RenderElement } from 'claude-code'

import type { CockpitSnapshot } from '../types'
import { iconSvg } from './desk-svg'
import type { DeskUi } from './desk-view'
import { signalSeverity, signalsOf } from './signals'
import { t } from './strings'
import { signalText } from './view-kit'

const DIM = '#A8A49B'
const RED = '#FF5A4F'
const PAGE = '#262624'
const BLOCK_CARD = '#3B2723'
const ICON_PX = 16
/** The rows the blocking notifications always take, blank when none (the card is 2 rows: title, this): a second one joins the first as `+1`, so nothing jumps. */
const SIGNAL_SLOTS = 1

/** The URGENTE card: only what waits for the person (the blocking notifications). Every row is always drawn, so nothing jumps and no hole opens under the title. */
export function deskUrgent(ui: DeskUi, s: CockpitSnapshot): RenderElement {
  const { Box, Text, Svg } = ui
  const H = t().desk.head
  const blocking = signalsOf(s)
    .filter(sig => signalSeverity(sig) === 'block')
    .map(sig => signalText(sig).what)
  const waiting = blocking.length

  // the last slot carries the count of those left out after its own text, never a bare `+n` in place of a notification
  const kept = blocking.slice(0, SIGNAL_SLOTS)
  const rest = blocking.length - kept.length
  const shown = kept.map((what, i) => (i === kept.length - 1 && rest > 0 ? `${what} +${rest}` : what))
  // with nothing waiting at all, the first slot says so
  const slots = Array.from({ length: SIGNAL_SLOTS }, (_, i) => {
    const text = shown[i]
    return (
      <Box key={`desk:urgent:slot:${i}`} columnGap={1} alignItems="center" paddingX={1} backgroundColor={text === undefined ? undefined : BLOCK_CARD}>
        <Svg source={iconSvg(text === undefined ? '' : 'alert', RED)} alt={text ?? ' '} width={ICON_PX} height={ICON_PX} />
        {text === undefined ? (
          <Text color={DIM} wrap="truncate">
            {waiting === 0 && i === 0 ? H.nothingWaiting : ' '}
          </Text>
        ) : (
          <Text color={RED} weight="semibold" wrap="truncate">
            {text}
          </Text>
        )}
      </Box>
    )
  })
  return (
    <Box key="desk:urgent" flexDirection="column">
      <Box key="desk:urgent:title" columnGap={1} alignItems="center">
        <Text weight="bold" size="footnote" color={waiting > 0 ? RED : DIM}>
          {H.urgent}
        </Text>
        <Text weight="bold" size="footnote" color={PAGE} backgroundColor={waiting > 0 ? RED : DIM}>
          {` ${waiting} `}
        </Text>
        <Box flexGrow={1} flexShrink={1} minWidth={0} justifyContent="flex-end">
          <Text color={DIM} size="footnote" wrap="truncate">
            {H.urgentHint}
          </Text>
        </Box>
      </Box>
      {slots}
    </Box>
  )
}
