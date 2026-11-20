import type { RenderElement } from 'claude-code'

import type { CockpitClaudeState, CockpitSnapshot } from '../types'
import { ctxScale } from './context'
import type { DeskLayout } from './desk-layout'
import { donutSvg, iconSvg } from './desk-svg'
import { deskUrgent } from './desk-urgent'
import type { DeskUi } from './desk-view'
import { COLORS, abbrevTokens, clockTime, countdown, displayModel, fmtCost, localDate, signedPct } from './shared'
import { t } from './strings'
import { rateRow } from './view-header'
import type { RateRow } from './view-header'
import type { PaneActions } from './view-kit'

const TEXT = '#F2F0EA'
const SOFT = '#C9C5BB'
const DIM = '#A8A49B'
const LINK = '#B9A2FF'
const OK = '#7CC79A'
const WARN = '#F5C542'
const RED = '#FF5A4F'
/** The background of the head's cards and their border, as on the design board. */
const CARD = '#30302E'
const BORDER = '#403F3B'
const ICON_PX = 20
/** A credit ring's column: wide enough for its renewal lines under a ring of any gauge size. */
const WINDOW_PX = 104

/** The terminal palette's status colours on the desktop palette; anything else stays as it is. */
const semantic = (c: string): string => (c === COLORS.green ? OK : c === COLORS.yellow || c === COLORS.amber ? WARN : c === COLORS.red ? RED : c)

const STATE_ICON: Record<CockpitClaudeState['kind'], { icon: string; color: string }> = {
  idle: { icon: 'check', color: DIM },
  working: { icon: 'flow', color: COLORS.blue },
  thinking: { icon: 'clock', color: COLORS.lavender },
  tool: { icon: 'flow', color: OK },
  waiting: { icon: 'alert', color: WARN },
}

/** The desktop head as the design board lays it out: the state line with the cost at its right, a card with the context donut (the short label above it, its percent over it, tokens and cache under it) and, beside it, the two credit windows as rings of the same size (label above, what is left over the ring, renewal and pace under it; the row wraps when narrow), then the URGENTE card. Every part is always drawn (the unknown ones blank), so nothing appears or disappears. */
export function deskHead(ui: DeskUi, s: CockpitSnapshot, layout: DeskLayout, actions: PaneActions): RenderElement {
  const { Box, Text, Svg } = ui
  const S = t()
  const H = S.desk.head
  const state = s.claudeState
  const look = STATE_ICON[state?.kind ?? 'idle']
  const effort = typeof s.effort === 'string' ? ` · ${s.effort.toLowerCase()}` : ' '
  const stateWord = state?.kind === 'tool' ? '' : S.state[state?.kind ?? 'idle']
  const detail = state?.kind === 'tool' && state.tool ? state.tool : ''

  const isStale = s.ctx.percent === undefined && s.lastCtx !== undefined
  const { tokens, window, percent } = isStale && s.lastCtx ? s.lastCtx : s.ctx
  const scale = ctxScale(s)
  const shown = scale.limit === undefined ? (percent ?? 0) : Math.round(scale.pct)
  const limit = scale.limit === undefined ? window : Math.round(scale.limit / 1000) * 1000
  const ctxColor = semantic(scale.color)

  const windowRow = (kind: 'five_hour' | 'seven_day', label: string) => {
    const r: RateRow | undefined = rateRow(s, kind)
    const renews = r?.resetMs === undefined ? ' ' : `${H.renews} ${countdown(r.resetMs, s.now).trim()}`
    const at = r?.resetMs === undefined ? ' ' : `${kind === 'seven_day' ? `${localDate(r.resetMs).slice(5)} ` : ''}${clockTime(r.resetMs)}`
    const color = r === undefined ? DIM : semantic(r.color)
    // the last session's reading (the engine reports none yet) carries the `~`, as the context's and the terminal's do
    const left = r === undefined ? '—' : `${r.isStale ? '~' : ''}${r.rem}%`
    return (
      <Box key={`desk:window:${kind}`} flexDirection="column" alignItems="center" flexShrink={0} minWidth={WINDOW_PX}>
        <Box key={`desk:window:${kind}:label`}>
          <Text wrap="truncate" size="caption" weight="bold" color={DIM}>
            {label}
          </Text>
        </Box>
        <Box key={`desk:window:${kind}:ring`}>
          <Svg source={donutSvg({ percent: r?.rem ?? 0, pace: r?.pace?.target, color })} alt={`${label} ${left} ${H.left}`} width={layout.gaugeSize} height={layout.gaugeSize} />
          {/* the percent over the ring, centred, as the context's */}
          <Box key={`desk:window:${kind}:percent`} position="absolute" top={0} left={0} right={0} bottom={0} flexDirection="column" alignItems="center" justifyContent="center">
            <Text wrap="truncate" size="heading" weight="bold" tabular color={color}>
              {left}
            </Text>
          </Box>
        </Box>
        <Box key={`desk:window:${kind}:when`}>
          <Text wrap="truncate" size="footnote" color={SOFT}>
            {renews}
          </Text>
        </Box>
        <Text wrap="truncate" size="footnote" color={DIM}>
          {at}
        </Text>
        <Box key={`desk:window:${kind}:pace`}>
          <Text wrap="truncate" size="footnote" color={r?.pace === undefined ? DIM : r.pace.delta < 0 ? RED : OK}>
            {r?.pace === undefined ? ' ' : `${H.pace} ${signedPct(r.pace.delta)}`}
          </Text>
        </Box>
      </Box>
    )
  }

  return (
    <Box key="desk:head" flexDirection="column" width="100%" rowGap={1}>
      <Box key="desk:state" flexDirection="column">
        <Box columnGap={1} alignItems="center">
          <Svg source={iconSvg(look.icon, look.color)} alt={stateWord || detail} width={ICON_PX} height={ICON_PX} />
          <Box flexGrow={1} flexShrink={1} minWidth={0}>
            <Text wrap="truncate" weight="semibold" color={TEXT}>
              {displayModel(s.model) || '—'}
              <Text color={LINK} weight="regular">
                {effort}
              </Text>
            </Text>
          </Box>
          <Text wrap="truncate" size="heading" weight="bold" tabular color={TEXT}>
            {fmtCost(s.cost.usd)}
          </Text>
        </Box>
        <Text wrap="truncate" color={SOFT}>
          <Text color={look.color} weight="semibold">
            {stateWord || ' '}
          </Text>
          {detail || ' '}
        </Text>
      </Box>
      <Box key="desk:gauges" flexDirection="row" flexWrap="wrap" alignItems="flex-start" justifyContent="center" columnGap={2} rowGap={1} paddingX={1} backgroundColor={CARD} borderStyle="round" borderColor={BORDER}>
        <Box key="desk:context" flexDirection="column" alignItems="center" flexShrink={0}>
          <Text key="desk:context:label" wrap="truncate" size="caption" weight="bold" color={DIM}>
            {H.contextShort}
          </Text>
          <Box key="desk:context:donut">
            <Svg source={donutSvg({ percent: shown, threshold: scale.markPct === undefined ? undefined : scale.markPct / 100, color: ctxColor })} alt={`${H.context} ${shown}%`} width={layout.gaugeSize} height={layout.gaugeSize} />
            {/* the percent over the donut, centred: it spans the Svg's box, so it follows the gauge size */}
            <Box key="desk:context:over" position="absolute" top={0} left={0} right={0} bottom={0} flexDirection="column" alignItems="center" justifyContent="center">
              <Text wrap="truncate" size="heading" weight="bold" tabular color={ctxColor}>
                {`${isStale ? '~' : ''}${shown}%`}
              </Text>
            </Box>
          </Box>
          <Text wrap="truncate" size="footnote" color={SOFT}>
            {`${abbrevTokens(tokens ?? 0, true)} / ${limit ? abbrevTokens(limit, true) : '—'}`}
          </Text>
          <Text wrap="truncate" size="footnote" color={DIM}>
            {s.cacheShare === undefined ? ' ' : `${H.cache} `}
            <Text color={OK} weight="bold">
              {s.cacheShare === undefined ? ' ' : `${s.cacheShare}%`}
            </Text>
          </Text>
        </Box>
        {windowRow('five_hour', '5H')}
        {windowRow('seven_day', '7D')}
      </Box>
      {deskUrgent(ui, s, actions)}
    </Box>
  )
}
