import type { RenderElement } from 'claude-code'

import type { CockpitClaudeState, CockpitSnapshot } from '../types'
import { ctxScale } from './context'
import type { DeskLayout } from './desk-layout'
import { barSvg, donutSvg, iconSvg } from './desk-svg'
import { deskUrgent } from './desk-urgent'
import type { DeskUi } from './desk-view'
import { parseReset } from './session'
import { COLORS, abbrevTokens, clockTime, countdown, displayModel, fmtCost, localDate, signedPct } from './shared'
import { t } from './strings'
import { rateRow } from './view-header'
import type { RateRow } from './view-header'
import type { PaneActions } from './view-kit'

const TEXT = '#F2F0EA'
const DIM = '#A8A49B'
const OK = '#7CC79A'
const WARN = '#F2A65A'
const RED = '#FF9A85'
const ACCENT = '#8B6CF6'
const ICON_PX = 20
const BAR_PX = 8
const FIVE_HOURS_MS = 5 * 3_600_000

/** The terminal palette's status colours on the desktop palette; anything else stays as it is. */
const semantic = (c: string): string => (c === COLORS.green ? OK : c === COLORS.yellow || c === COLORS.amber ? WARN : c === COLORS.red ? RED : c)

const STATE_ICON: Record<CockpitClaudeState['kind'], { icon: string; color: string }> = {
  idle: { icon: 'check', color: DIM },
  working: { icon: 'flow', color: COLORS.blue },
  thinking: { icon: 'clock', color: COLORS.lavender },
  tool: { icon: 'flow', color: OK },
  waiting: { icon: 'alert', color: WARN },
}

/** The 5h window's end-of-window usage when it keeps its pace, in percent; only once it is past a tenth of its length and only when it would run out. */
function forecastText(s: CockpitSnapshot): string {
  const w = s.rateLimits.find(r => r.kind === 'five_hour')
  const resetMs = parseReset(w?.resetsAt)
  if (w === undefined || resetMs === undefined) return ' '
  const elapsed = (FIVE_HOURS_MS - (resetMs - s.now)) / FIVE_HOURS_MS
  if (elapsed < 0.1 || elapsed > 1) return ' '
  const projected = Math.round(w.percentUsed / elapsed)
  return projected > 100 ? `5h → ${projected}%` : ' '
}

/** The desktop head: state line, context donut with its numbers, the two credit windows as what is left (beside the donut, below it when narrow), a forecast line, the URGENTE card. Every part is always drawn (the unknown ones empty), so nothing appears or disappears. */
export function deskHead(ui: DeskUi, s: CockpitSnapshot, layout: DeskLayout, actions: PaneActions): RenderElement {
  const { Box, Text, Svg } = ui
  const S = t()
  const H = S.desk.head
  const state = s.claudeState
  const look = STATE_ICON[state?.kind ?? 'idle']
  const effort = typeof s.effort === 'string' ? s.effort.toUpperCase() : ''
  const stateLine = [displayModel(s.model) || '—', effort, fmtCost(s.cost.usd)].filter(Boolean).join(' · ')
  const stateWord = state?.kind === 'tool' ? '' : S.state[state?.kind ?? 'idle']
  const detail = state?.kind === 'tool' && state.tool ? state.tool : ' '

  const isStale = s.ctx.percent === undefined && s.lastCtx !== undefined
  const { tokens, window, percent } = isStale && s.lastCtx ? s.lastCtx : s.ctx
  const scale = ctxScale(s)
  const shown = scale.limit === undefined ? (percent ?? 0) : Math.round(scale.pct)
  const limit = scale.limit === undefined ? window : Math.round(scale.limit / 1000) * 1000

  const windowRow = (kind: 'five_hour' | 'seven_day', label: string) => {
    const r: RateRow | undefined = rateRow(s, kind)
    const when = r?.resetMs === undefined ? ' ' : `${H.renews} ${countdown(r.resetMs, s.now).trim()} · ${kind === 'seven_day' ? `${localDate(r.resetMs).slice(5)} ` : ''}${clockTime(r.resetMs)}`
    const color = r === undefined ? DIM : semantic(r.color)
    const bar = (
      <Box flexGrow={1}>
        <Svg source={barSvg({ left: r?.rem ?? 0, pace: r?.pace?.target, color })} alt={`${label} ${H.left}`} width={layout.barWidth} height={BAR_PX} />
      </Box>
    )
    // the last session's reading (the engine reports none yet) carries the `~`, as the context's and the terminal's do
    const left = <Text wrap="truncate" color={color} weight="bold">{r === undefined ? '—' : `${r.isStale ? '~' : ''}${r.rem}% ${H.left}`}</Text>
    const renews = <Text wrap="truncate" color={DIM}>{when}</Text>
    const pace = <Text wrap="truncate" color={r?.pace === undefined ? DIM : r.pace.delta < 0 ? RED : OK}>{r?.pace === undefined ? ' ' : `${H.pace} ${signedPct(r.pace.delta)}`}</Text>
    // wide: one line; narrower: the renewal and the pace on a second line under the bar, always drawn (empty without data), so the row count is fixed
    if (layout.size !== 'wide') {
      return (
        <Box key={`desk:window:${kind}`} flexDirection="column">
          <Box columnGap={1} alignItems="center">
            <Text wrap="truncate" color={DIM}>{label}</Text>
            {bar}
            {left}
          </Box>
          <Box key={`desk:window:${kind}:when`} columnGap={1}>
            {renews}
            {pace}
          </Box>
        </Box>
      )
    }
    return (
      <Box key={`desk:window:${kind}`} columnGap={1} alignItems="center">
        <Text wrap="truncate" color={DIM}>{label}</Text>
        {bar}
        {left}
        {renews}
        {pace}
      </Box>
    )
  }

  return (
    <Box key="desk:head" flexDirection="column" width="100%" rowGap={1}>
      <Box key="desk:state" flexDirection="column">
        <Box columnGap={1} alignItems="center">
          <Svg source={iconSvg(look.icon, look.color)} alt={stateWord || state?.tool || ''} height={ICON_PX} />
          <Text wrap="truncate" weight="bold" color={TEXT}>{stateLine}</Text>
          <Text wrap="truncate" color={look.color}>{stateWord}</Text>
        </Box>
        <Text wrap="truncate" color={DIM}>{detail}</Text>
      </Box>
      <Box key="desk:gauges" flexDirection={layout.size === 'narrow' ? 'column' : 'row'} columnGap={2} rowGap={1}>
        <Box key="desk:context" columnGap={2} alignItems="center">
          <Svg source={donutSvg({ percent: shown, threshold: scale.markPct === undefined ? undefined : scale.markPct / 100, cachePct: s.cacheShare, color: semantic(scale.color) })} alt={H.context} width={layout.gaugeSize} height={layout.gaugeSize} />
          <Box flexDirection="column">
            <Text wrap="truncate" color={TEXT} weight="bold">{`${H.context} ${isStale ? '~' : ''}${shown}%`}</Text>
            <Text wrap="truncate" color={DIM}>{`${abbrevTokens(tokens ?? 0, true)} / ${limit ? abbrevTokens(limit, true) : '—'}`}</Text>
            <Text wrap="truncate" color={s.cacheShare === undefined ? DIM : ACCENT}>{s.cacheShare === undefined ? ' ' : `${H.cache} ${s.cacheShare}%`}</Text>
          </Box>
        </Box>
        <Box key="desk:windows" flexDirection="column" flexGrow={1}>
          {windowRow('five_hour', '5h')}
          {windowRow('seven_day', '7d')}
        </Box>
      </Box>
      <Box key="desk:forecast">
        <Text wrap="truncate" color={WARN}>{forecastText(s)}</Text>
      </Box>
      {deskUrgent(ui, s, actions)}
    </Box>
  )
}
