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
const WARN = '#F2A65A'
const RED = '#FF9A85'
const ACCENT = '#8B6CF6'
/** The empty state of every value: the section keeps its rows. */
const NONE = '—'
/** Rows of the page the agents' list leaves to the other sections; below this, the list still shows `MIN_AGENT_ROWS`. */
const OTHER_ROWS = 16
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

/** The `In corso` tab: the open request, the workflow run and the agents outside it, one column or two as the layout says. */
export function deskNow(ui: DeskUi, s: CockpitSnapshot, layout: DeskLayout, _actions: PaneActions): RenderElement {
  const { Box, Text, Svg } = ui
  const S = t().desk.now
  const E = t().page.events

  const heading = (label: string): RenderElement => (
    <Text key={`now:title:${label}`} wrap="truncate" weight="bold" color={DIM}>
      {label}
    </Text>
  )
  const icon = (name: string, color: string): RenderElement => <Svg source={iconSvg(name, color)} alt={name} height={16} />

  // ── REQUEST: open while the main loop works or a prompt waits for its round to end ──
  const isOpen = s.roundPrompt !== undefined || (s.claudeState !== undefined && s.claudeState.kind !== 'idle')
  const lastRound = (s.sessionLog ?? []).filter(e => e.kind === 'round').at(-1)
  const since = lastRound?.at ?? s.startedAt
  const turnUsd = shownTurnUsd(s.cost)
  const requestFacts = isOpen
    ? [E.round(nextRoundNumber(s)), since === undefined ? NONE : clockTime(since), since === undefined ? NONE : duration(Math.max(0, s.now - since)), turnUsd === undefined ? NONE : `$${costCell(turnUsd, COST_W).slice(1).trim()}`]
    : [NONE]
  const request = (
    <Box key="now:request" flexDirection="column">
      {heading(S.request)}
      <Box columnGap={1}>
        {icon('clock', isOpen ? ACCENT : DIM)}
        <Text wrap="truncate" color={isOpen ? TEXT : DIM}>
          {requestFacts.join(' · ')}
        </Text>
      </Box>
      <Text wrap="truncate" color={DIM}>
        {isOpen && s.roundPrompt !== undefined ? s.roundPrompt : NONE}
      </Text>
    </Box>
  )

  // ── FLOW: the run still open (or silent), its cycle and the steps of its newest block ──
  const run = s.workflowRun
  const isLive = run !== undefined && (activeRun(run) !== undefined || run.isSilent === true)
  const blocks = isLive ? taskRows(run).flatMap(r => (r.block === undefined ? [] : [r.block])) : []
  const total = blocks.length === 0 ? undefined : Math.max(run?.round ?? 0, ...blocks)
  const cycle = !isLive || run?.round === undefined ? NONE : `${S.cycle} ${run.round}${total === undefined ? '' : `/${total}`}`
  const segments = isLive ? segmentsOf(s) : []
  const flowColor = !isLive ? DIM : run?.isSilent === true ? WARN : TEXT
  const flow = (
    <Box key="now:flow" flexDirection="column">
      {heading(S.flow)}
      <Box columnGap={1}>
        {icon('flow', isLive ? (run?.isSilent === true ? WARN : ACCENT) : DIM)}
        <Text wrap="truncate" color={flowColor}>
          {isLive ? `${run?.name ?? run?.runId ?? NONE} · ${cycle}` : NONE}
        </Text>
      </Box>
      <Text wrap="truncate" color={DIM}>
        {segments.length === 0 ? NONE : `${S.step} `}
        {segments.map((seg, i) => (
          <Text key={`now:step:${seg.step}`} color={seg.color}>
            {`${i > 0 ? ' › ' : ''}${seg.step}`}
          </Text>
        ))}
      </Text>
    </Box>
  )

  // ── AGENTS OUTSIDE THE FLOW: the running ones no run claims ──
  const outside = orderAgents(visibleAgents(s).filter(a => a.status === 'running' && agentRunId(s.workflowRun, a) === undefined))
  const cap = Math.max(MIN_AGENT_ROWS, layout.bodyRows - OTHER_ROWS)
  const shown = outside.slice(0, cap)
  const agents = (
    <Box key="now:outside" flexDirection="column">
      {heading(S.outside)}
      {outside.length === 0 ? (
        <Text key="now:outside:none" wrap="truncate" color={DIM}>
          {NONE}
        </Text>
      ) : (
        shown.map(({ agent, depth }) => (
          <Box key={`now:agent:${agent.id}`} columnGap={1}>
            {icon('clock', ACCENT)}
            <Text wrap="truncate" color={TEXT}>
              {`${'  '.repeat(depth)}${agent.type}`}
              <Text color={DIM}>{agent.description === undefined || agent.description === '' ? '' : ` · ${agent.description}`}</Text>
              <Text color={DIM}>{` · ${duration(Math.max(0, s.now - agent.startedAt))}`}</Text>
            </Text>
          </Box>
        ))
      )}
      {outside.length > shown.length && (
        <Text key="now:outside:more" wrap="truncate" dimColor>
          {`+${outside.length - shown.length}`}
        </Text>
      )}
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
