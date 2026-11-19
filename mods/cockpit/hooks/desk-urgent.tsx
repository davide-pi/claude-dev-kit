import type { RenderElement } from 'claude-code'

import type { CockpitSnapshot } from '../types'
import { limitRows } from './desk-layout'
import { iconSvg } from './desk-svg'
import type { DeskUi } from './desk-view'
import { signalSeverity, signalsOf } from './signals'
import { t } from './strings'
import type { PaneActions } from './view-kit'
import { signalText } from './view-kit'

const TEXT = '#F2F0EA'
const DIM = '#A8A49B'
const WARN = '#F2A65A'
const RED = '#FF9A85'
const ACCENT = '#8B6CF6'
const ICON_PX = 16
/** The rows the blocking notifications always take, padded with blank ones (the card is 5 rows: title, reserved line, these, worklog). */
const SIGNAL_SLOTS = 2

/** The URGENTE card: only what waits for the person (the blocking notifications and the worklog days behind), with the page's only log-hours button. Every row is always drawn, so nothing jumps. */
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

  const slot = (key: string, icon: string, color: string, text: string): RenderElement => (
    <Box key={key} columnGap={1} alignItems="center">
      <Svg source={iconSvg(icon, color)} alt={text} height={ICON_PX} />
      <Text color={color} wrap="truncate">
        {text}
      </Text>
    </Box>
  )
  const shown = limitRows(blocking, SIGNAL_SLOTS, n => `+${n}`)
  const slots = Array.from({ length: SIGNAL_SLOTS }, (_, i) => {
    const text = shown[i]
    if (text !== undefined) return slot(`desk:urgent:slot:${i}`, 'alert', RED, text)
    return slot(`desk:urgent:slot:${i}`, '', DIM, i === 0 && waiting === 0 ? H.nothingWaiting : ' ')
  })
  // the reserved second line: the hint, or the worklog's scope choice while it waits for its answer
  const second =
    s.confirm === 'worklog' && hasLog ? (
      <Box key="desk:urgent:line" columnGap={2} alignItems="center">
        <Text color={WARN} wrap="truncate">
          {S.confirmLog}
        </Text>
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
      <Box key="desk:urgent:line">
        <Text color={DIM} wrap="truncate">
          {H.urgentHint}
        </Text>
      </Box>
    )
  return (
    <Box key="desk:urgent" flexDirection="column">
      <Box key="desk:urgent:title" columnGap={1} alignItems="center">
        <Svg source={iconSvg('alert', waiting > 0 ? RED : DIM)} alt={H.urgent} height={ICON_PX} />
        <Text weight="bold" color={TEXT}>
          {H.urgent}
        </Text>
        <Text weight="bold" color={RED}>
          {String(waiting)}
        </Text>
      </Box>
      {second}
      {slots}
      <Box key="desk:urgent:worklog" columnGap={1} alignItems="center">
        <Svg source={iconSvg(lateDays > 0 ? 'clock' : '', WARN)} alt={S.buttons.logHours} height={ICON_PX} />
        <Box flexGrow={1} flexShrink={1} minWidth={0}>
          <Text color={WARN} wrap="truncate">
            {lateDays > 0 ? S.worklog.withoutHours(lateDays) : ' '}
          </Text>
        </Box>
        {hasLog ? (
          <Button key="urgent:log" onPress={() => actions.ask('worklog')}>
            <Text color={ACCENT}>{S.buttons.logHours}</Text>
          </Button>
        ) : (
          <Text> </Text>
        )}
      </Box>
    </Box>
  )
}
