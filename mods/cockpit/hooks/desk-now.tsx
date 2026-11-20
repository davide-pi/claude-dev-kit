import type { RenderElement } from 'claude-code'

import type { CockpitSnapshot } from '../types'
import type { DeskUi } from './desk-view'
import type { DeskLayout } from './desk-layout'
import { iconSvg } from './desk-svg'
import { flowOf, outsideAgents, requestOf } from './now-model'
import type { StepState } from './now-model'
import { duration } from './shared'
import { t } from './strings'
import type { PaneActions } from './view-kit'

const TEXT = '#F2F0EA'
const DIM = '#A8A49B'
const OK = '#7CC79A'
const WARN = '#F5C542'
const RED = '#FF5A4F'
const ACCENT = '#8B6CF6'
const TITLE = '#B9A2FF'
/** The background of a section's card, as on the design board. */
const CARD = '#30302E'
const ICON_PX = 16
/** Rows of the tab the agents' list leaves to the other sections (request 2, flow 3, the list's title, 2 gaps) and to its `+n` row; below this, the list still shows `MIN_AGENT_ROWS`. */
const OTHER_ROWS = 9
const MIN_AGENT_ROWS = 3
const STEP_COLOR: Record<StepState, string> = { done: OK, failed: RED, running: ACCENT }

/** The `In corso` tab: the open request, the workflow run and the agents outside it, each a title row and a card under it, one column or two as the layout says. An empty section says so in one dim line and keeps its rows. */
export function deskNow(ui: DeskUi, s: CockpitSnapshot, layout: DeskLayout, actions: PaneActions): RenderElement {
  const { Box, Text, Svg } = ui
  const S = t().desk.now

  const heading = (key: string, label: string, right?: RenderElement): RenderElement => (
    <Box key={key} columnGap={1} alignItems="center">
      <Text wrap="truncate" weight="bold" size="footnote" color={TITLE}>
        {label}
      </Text>
      {right}
    </Box>
  )
  const card = (key: string, children: RenderElement | RenderElement[], direction: 'row' | 'column' = 'column'): RenderElement => (
    <Box key={key} flexDirection={direction} columnGap={1} paddingX={1} backgroundColor={CARD} borderStyle="round" borderColor="#403F3B">
      {children}
    </Box>
  )
  const icon = (name: string, color: string): RenderElement => <Svg source={iconSvg(name, color)} alt={name} width={ICON_PX} height={ICON_PX} />

  // ── REQUEST: open while the main loop works or a prompt waits for its round to end ──
  const { isOpen, prompt, facts: requestFacts } = requestOf(s)
  const request = (
    <Box key="now:request" flexDirection="column">
      {heading(
        'now:request:title',
        S.request,
        <Box key="now:request:facts" flexGrow={1} flexShrink={1} minWidth={0} justifyContent="flex-end">
          <Text wrap="truncate" size="footnote" color={DIM}>
            {requestFacts}
          </Text>
        </Box>,
      )}
      {card(
        'now:request:prompt',
        <Text wrap="truncate" color={isOpen ? TEXT : DIM}>
          {prompt}
        </Text>,
      )}
    </Box>
  )

  // ── FLOW: the run still open (or silent), its cycle and the steps of its newest block ──
  const { isLive, isSilent, name, cycle, segments } = flowOf(s)
  const flow = (
    <Box key="now:flow" flexDirection="column">
      {heading('now:flow:title', S.flow)}
      {card(
        'now:flow:card',
        [
          icon(isLive ? 'flow' : '', isSilent ? WARN : ACCENT),
          <Box key="now:flow:lines" flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0}>
            <Box key="now:flow:name">
              <Text wrap="truncate" color={!isLive ? DIM : isSilent ? WARN : TEXT}>
                {isLive ? <Text weight="semibold">{name}</Text> : S.noFlow}
                {isLive ? ` · ${cycle}` : ''}
              </Text>
            </Box>
            <Box key="now:flow:steps">
              <Text wrap="truncate" color={DIM}>
                {segments.length === 0 ? ' ' : `${S.step} `}
                {segments.map((seg, i) => (
                  <Text key={`now:step:${seg.step}`} color={STEP_COLOR[seg.state]}>
                    {`${i > 0 ? ' › ' : ''}${seg.step}`}
                  </Text>
                ))}
              </Text>
            </Box>
          </Box>,
        ],
        'row',
      )}
    </Box>
  )

  // ── AGENTS OUTSIDE THE FLOW: the running ones no run claims ──
  const outside = outsideAgents(s)
  const cap = agentWindow(layout)
  const shown = outside.slice(0, cap)
  const agents = (
    <Box key="now:outside" flexDirection="column">
      {heading('now:outside:title', S.outside)}
      {card('now:outside:list', [
        ...(outside.length === 0
          ? [
              <Text key="now:outside:none" wrap="truncate" color={DIM}>
                {S.noAgents}
              </Text>,
            ]
          : shown.map(({ agent, depth }) => (
              <Box key={`now:agent:${agent.id}`} columnGap={1} alignItems="center" paddingLeft={2 * depth}>
                {icon('clock', ACCENT)}
                <Box flexGrow={1} flexShrink={1} minWidth={0}>
                  <Text wrap="truncate" color={TEXT}>
                    <Text weight="semibold">{agent.type}</Text>
                    <Text color={DIM}>{agent.description === undefined || agent.description === '' ? ' ' : ` · ${agent.description}`}</Text>
                  </Text>
                </Box>
                <Text wrap="truncate" size="footnote" color={DIM}>
                  {duration(Math.max(0, s.now - agent.startedAt))}
                </Text>
              </Box>
            ))),
      ])}
    </Box>
  )

  if (layout.nowColumns === 2) {
    return (
      <Box key="now:scroll" flexDirection="column" width="100%">
        <Box key="now:body" width="100%" columnGap={2}>
          <Box flexDirection="column" rowGap={1} width="50%">
            {request}
            {flow}
          </Box>
          <Box flexDirection="column" flexGrow={1}>
            {agents}
          </Box>
        </Box>
      </Box>
    )
  }
  return (
    <Box key="now:scroll" flexDirection="column" width="100%">
      <Box key="now:body" flexDirection="column" width="100%" rowGap={1}>
        {request}
        {flow}
        {agents}
      </Box>
    </Box>
  )
}

/** How many agent rows the window shows: what the body leaves under the request and flow cards. */
const agentWindow = (layout: DeskLayout): number => Math.max(MIN_AGENT_ROWS, layout.bodyRows - OTHER_ROWS)
