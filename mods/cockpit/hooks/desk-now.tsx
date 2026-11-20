import type { RenderElement } from 'claude-code'

import type { CockpitSnapshot } from '../types'
import type { DeskUi } from './desk-view'
import type { DeskLayout } from './desk-layout'
import { iconSvg } from './desk-svg'
import { nextRoundNumber } from './round-capture'
import { clockTime, costCell, duration, shownTurnUsd } from './shared'
import { t } from './strings'
import { orderAgents, visibleAgents } from './view-agents'
import type { PaneActions } from './view-kit'
import { activeRun, agentRunId, parseBlockLabel, taskRows } from './workflow'

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
/** A value the open request does not know yet. */
const NONE = '—'
/** Rows of the tab the agents' list leaves to the other sections (request 2, flow 3, the list's title, 2 gaps) and to its `+n` row; below this, the list still shows `MIN_AGENT_ROWS`. */
const OTHER_ROWS = 9
const MIN_AGENT_ROWS = 3
const COST_W = 7

type Segment = { step: string; color: string }

/** The step segments of the flow's newest block: each distinct step in the order it began, green when done, red when failed, accent while it runs. */
function segmentsOf(s: CockpitSnapshot): Segment[] {
  const run = s.workflowRun
  const labelled = (run?.agents ?? []).flatMap(a => {
    const parsed = a.label === undefined ? undefined : parseBlockLabel(a.label)
    return parsed === undefined ? [] : [{ ...parsed, isDone: a.isDone, isFailed: a.isFailed === true }]
  })
  const newest = Math.max(0, ...labelled.map(l => l.block))
  const steps = new Map<string, Segment>()
  for (const l of labelled.filter(x => x.block === newest)) {
    const step = l.step.replace(/\s*\(.*\)$/, '')
    steps.set(step, { step, color: l.isFailed ? RED : l.isDone ? OK : ACCENT })
  }
  return [...steps.values()]
}

/** The `In corso` tab: the open request, the workflow run and the agents outside it, each a title row and a card under it, one column or two as the layout says. An empty section says so in one dim line and keeps its rows. */
export function deskNow(ui: DeskUi, s: CockpitSnapshot, layout: DeskLayout, _actions: PaneActions): RenderElement {
  const { Box, Text, Svg } = ui
  const S = t().desk.now
  const E = t().page.events

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
  const isOpen = s.roundPrompt !== undefined || (s.claudeState !== undefined && s.claudeState.kind !== 'idle')
  const lastRound = (s.sessionLog ?? []).filter(e => e.kind === 'round').at(-1)
  const since = s.roundStartedAt ?? lastRound?.at ?? s.startedAt
  const turnUsd = shownTurnUsd(s.cost)
  const requestFacts = isOpen
    ? [E.round(nextRoundNumber(s)), since === undefined ? NONE : clockTime(since), since === undefined ? NONE : duration(Math.max(0, s.now - since)), turnUsd === undefined ? NONE : `$${costCell(turnUsd, COST_W).slice(1).trim()}`].join(' · ')
    : ' '
  const prompt = isOpen ? (s.roundPrompt ?? ' ') : S.noRequest
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
  const run = s.workflowRun
  const isLive = run !== undefined && (activeRun(run) !== undefined || run.isSilent === true)
  const blocks = isLive ? taskRows(run).flatMap(r => (r.block === undefined ? [] : [r.block])) : []
  const total = blocks.length === 0 ? undefined : Math.max(run?.round ?? 0, ...blocks)
  const cycle = !isLive || run?.round === undefined ? NONE : `${S.cycle} ${run.round}${total === undefined ? '' : `/${total}`}`
  const segments = isLive ? segmentsOf(s) : []
  const flow = (
    <Box key="now:flow" flexDirection="column">
      {heading('now:flow:title', S.flow)}
      {card(
        'now:flow:card',
        [
          icon(isLive ? 'flow' : '', run?.isSilent === true ? WARN : ACCENT),
          <Box key="now:flow:lines" flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0}>
            <Box key="now:flow:name">
              <Text wrap="truncate" color={!isLive ? DIM : run?.isSilent === true ? WARN : TEXT}>
                {isLive ? <Text weight="semibold">{run?.name ?? run?.runId ?? NONE}</Text> : S.noFlow}
                {isLive ? ` · ${cycle}` : ''}
              </Text>
            </Box>
            <Box key="now:flow:steps">
              <Text wrap="truncate" color={DIM}>
                {segments.length === 0 ? ' ' : `${S.step} `}
                {segments.map((seg, i) => (
                  <Text key={`now:step:${seg.step}`} color={seg.color}>
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
  const outside = orderAgents(visibleAgents(s).filter(a => a.status === 'running' && agentRunId(s.workflowRun, a) === undefined))
  const cap = Math.max(MIN_AGENT_ROWS, layout.bodyRows - OTHER_ROWS)
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
        ...(outside.length > shown.length
          ? [
              <Text key="now:outside:more" wrap="truncate" color={DIM}>
                {`+${outside.length - shown.length}`}
              </Text>,
            ]
          : []),
      ])}
    </Box>
  )

  if (layout.nowColumns === 2) {
    return (
      <Box key="now:body" width="100%" columnGap={2}>
        <Box flexDirection="column" rowGap={1} width="50%">
          {request}
          {flow}
        </Box>
        <Box flexDirection="column" flexGrow={1}>
          {agents}
        </Box>
      </Box>
    )
  }
  return (
    <Box key="now:body" flexDirection="column" width="100%" rowGap={1}>
      {request}
      {flow}
      {agents}
    </Box>
  )
}
