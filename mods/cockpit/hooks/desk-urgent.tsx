import type { RenderElement } from 'claude-code'

import type { CockpitSnapshot } from '../types'
import { limitRows } from './desk-layout'
import { iconSvg } from './desk-svg'
import type { DeskUi } from './desk-view'
import { signalSeverity, signalsOf } from './signals'
import { t } from './strings'
import type { PaneActions } from './view-kit'
import { signalText } from './view-kit'

const DIM = '#A8A49B'
const WARN = '#F2A65A'
const RED = '#FF9A85'
const ACCENT = '#8B6CF6'
const LAVENDER = '#D5C8FF'
const PAGE = '#262624'
/** The worklog notification's card and a blocking one's, as on the design board. */
const WORKLOG_CARD = '#2F2A40'
const BLOCK_CARD = '#3B2723'
const ICON_PX = 16
/** The rows the blocking notifications always take, blank when fewer (the card is 4 rows: title, worklog, these). */
const SIGNAL_SLOTS = 2

/** The URGENTE card: only what waits for the person (the worklog days behind and the blocking notifications), with the page's only log-hours button. Every row is always drawn and the blank ones sit at the bottom, so nothing jumps and no hole opens under the title. */
export function deskUrgent(ui: DeskUi, s: CockpitSnapshot, actions: PaneActions): RenderElement {
  const { Box, Text, Button, Svg } = ui
  const S = t()
  const H = S.desk.head
  const blocking = signalsOf(s)
    .filter(sig => signalSeverity(sig) === 'block')
    .map(sig => signalText(sig).what)
  const lateDays = new Set([...s.worklog.pending, ...s.worklog.underTarget]).size
  const waiting = blocking.length + (lateDays > 0 ? 1 : 0)
  // the same gate as the terminal's footer: logging hours needs a session and the worklog skill
  const hasLog = s.sessionId !== undefined && !s.isWorklogSkillMissing

  const shown = limitRows(blocking, SIGNAL_SLOTS, n => `+${n}`)
  const slots = Array.from({ length: SIGNAL_SLOTS }, (_, i) => {
    const text = shown[i]
    return (
      <Box key={`desk:urgent:slot:${i}`} columnGap={1} alignItems="center" paddingX={1} backgroundColor={text === undefined ? undefined : BLOCK_CARD}>
        <Svg source={iconSvg(text === undefined ? '' : 'alert', RED)} alt={text ?? ' '} width={ICON_PX} height={ICON_PX} />
        <Text color={RED} weight="semibold" wrap="truncate">
          {text ?? ' '}
        </Text>
      </Box>
    )
  })
  // the worklog notification, or its scope choice while it waits for the answer; with nothing waiting at all, the line that says so
  const worklog =
    s.confirm === 'worklog' && hasLog ? (
      <Box key="desk:urgent:worklog" columnGap={2} alignItems="center" paddingX={1} backgroundColor={WORKLOG_CARD}>
        <Box flexGrow={1} flexShrink={1} minWidth={0}>
          <Text color={WARN} wrap="truncate">
            {S.confirmLog}
          </Text>
        </Box>
        <Button key="urgent:confirm:chat" onPress={() => actions.worklog('session')}>
          <Text color={ACCENT}>{S.buttons.logSession}</Text>
        </Button>
        <Button key="urgent:confirm:day" onPress={() => actions.worklog('day')}>
          <Text color={ACCENT}>{S.buttons.logDay}</Text>
        </Button>
        <Button key="urgent:confirm:no" onPress={() => actions.answer(false)}>
          <Text color={DIM}>{S.buttons.no}</Text>
        </Button>
      </Box>
    ) : (
      <Box key="desk:urgent:worklog" columnGap={1} alignItems="center" paddingX={1} backgroundColor={lateDays > 0 ? WORKLOG_CARD : undefined}>
        <Svg source={iconSvg(lateDays > 0 ? 'clock' : '', LAVENDER)} alt={S.buttons.logHours} width={ICON_PX} height={ICON_PX} />
        <Box flexGrow={1} flexShrink={1} minWidth={0}>
          <Text color={lateDays > 0 ? LAVENDER : DIM} weight={lateDays > 0 ? 'semibold' : undefined} wrap="truncate">
            {lateDays > 0 ? S.worklog.withoutHours(lateDays) : waiting === 0 ? H.nothingWaiting : ' '}
          </Text>
        </Box>
        {hasLog ? (
          <Button key="urgent:log" onPress={() => actions.ask('worklog')}>
            <Text color={LAVENDER}>{S.buttons.logHours}</Text>
          </Button>
        ) : (
          <Text> </Text>
        )}
      </Box>
    )
  // what waits comes first: with no worklog notification, the blocking ones sit under the title and the blank worklog row goes last
  const rows = lateDays > 0 || blocking.length === 0 ? [worklog, ...slots] : [...slots, worklog]
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
      {rows}
    </Box>
  )
}
