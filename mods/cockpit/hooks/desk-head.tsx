import type { RenderElement } from 'claude-code'

import type { CockpitClaudeState, CockpitSnapshot } from '../types'
import { ctxScale } from './context'
import type { DeskLayout } from './desk-layout'
import { barSvg, donutSvg, stateBadgeSvg } from './desk-svg'
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
const BAR_PX = 14

/** The terminal palette's status colours on the desktop palette; anything else stays as it is. */
const semantic = (c: string): string => (c === COLORS.green ? OK : c === COLORS.yellow || c === COLORS.amber ? WARN : c === COLORS.red ? RED : c)

/** The state badges of the design board (V3States): mark, ring colour, disc fill. */
const STATE_ICON: Record<CockpitClaudeState['kind'], { icon: string; color: string; bg: string }> = {
  idle: { icon: 'check', color: '#A8A49B', bg: '#30302E' },
  working: { icon: 'play', color: '#B9A2FF', bg: '#3A3357' },
  thinking: { icon: 'dots', color: '#B9A2FF', bg: '#3A3357' },
  tool: { icon: 'play', color: '#B9A2FF', bg: '#3A3357' },
  waiting: { icon: 'pause', color: '#F2A65A', bg: '#4A3320' },
}

/** The desktop head as the design board lays it out: the state line with the cost at its right, a card with the context donut (the short label above it, its percent over it, tokens and cache under it) and the two credit windows (label and renewal, bar and what is left, pace), then the URGENTE card. Every part is always drawn (the unknown ones blank), so nothing appears or disappears. */
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
    const when = r?.resetMs === undefined ? ' ' : `${H.renews} ${countdown(r.resetMs, s.now).trim()} · ${kind === 'seven_day' ? `${localDate(r.resetMs).slice(5)} ` : ''}${clockTime(r.resetMs)}`
    const color = r === undefined ? DIM : semantic(r.color)
    // the last session's reading (the engine reports none yet) carries the `~`, as the context's and the terminal's do
    const left = r === undefined ? '—' : `${r.isStale ? '~' : ''}${r.rem}%`
    return (
      <Box key={`desk:window:${kind}`} flexDirection="column">
        <Box key={`desk:window:${kind}:label`} columnGap={1} alignItems="center">
          <Text wrap="truncate" weight="bold" color={TEXT}>
            {label}
          </Text>
          <Text wrap="truncate" size="footnote" color={DIM}>
            {when}
          </Text>
        </Box>
        {/* the bar takes the row (an Svg with no width fills its slot), the percent sits at its right end and never shrinks */}
        <Box key={`desk:window:${kind}:bar`} columnGap={1} alignItems="center">
          <Box key={`desk:window:${kind}:track`} flexGrow={1} flexShrink={1} minWidth={0}>
            <Svg source={barSvg({ left: r?.rem ?? 0, pace: r?.pace?.target, color })} alt={`${label} ${left} ${H.left}`} height={BAR_PX} />
          </Box>
          <Box key={`desk:window:${kind}:percent`} flexShrink={0}>
            <Text wrap="truncate" color={color} weight="bold" size="heading" tabular>
              {left}
            </Text>
          </Box>
        </Box>
        <Box key={`desk:window:${kind}:pace`}>
          <Text wrap="truncate" size="footnote" color={r?.pace === undefined ? DIM : r.pace.delta < 0 ? RED : OK}>
            {r?.pace === undefined ? ' ' : `${H.pace} ${signedPct(r.pace.delta)}`}
          </Text>
        </Box>
      </Box>
    )
  }

  const isNarrow = layout.size === 'narrow'
  return (
    <Box key="desk:head" flexDirection="column" width="100%" rowGap={1}>
      <Box key="desk:state" flexDirection="column">
        <Box columnGap={1} alignItems="center">
          <Svg source={stateBadgeSvg(look.icon, look.color, look.bg)} alt={stateWord || detail} width={ICON_PX} height={ICON_PX} />
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
      <Box key="desk:gauges" flexDirection={isNarrow ? 'column' : 'row'} alignItems={isNarrow ? 'stretch' : 'center'} columnGap={2} rowGap={1} paddingX={1} backgroundColor={CARD} borderStyle="round" borderColor={BORDER}>
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
        <Box key="desk:windows" flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0} rowGap={1}>
          {windowRow('five_hour', '5h')}
          {windowRow('seven_day', '7d')}
        </Box>
      </Box>
      {deskUrgent(ui, s, actions)}
    </Box>
  )
}
