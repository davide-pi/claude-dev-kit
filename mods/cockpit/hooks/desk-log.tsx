import type { RenderElement } from 'claude-code'

import type { CockpitLogEntry, CockpitSnapshot } from '../types'
import type { DeskLayout } from './desk-layout'
import { railSvg } from './desk-svg'
import type { LaneCell } from './desk-svg'
import type { DeskUi } from './desk-view'
import { logModel } from './done-groups'
import type { LogModel } from './done-groups'
import { loggedSignal } from './signals'
import { t } from './strings'
import { ALL_KEY, isAllShown, isMainEntry } from './view-log-round'
import type { PaneActions } from './view-kit'
import { signalText } from './view-kit'
import { activeRun } from './workflow'

const TEXT = '#F2F0EA'
const DIM = '#A8A49B'
const ACCENT = '#8B6CF6'
const LINK = '#B9A2FF'
const RAIL_WIDTH = 86
/** The rail's height in CSS pixels: the row takes it, so the lanes of two rows meet. */
const RAIL_PX = 28
/** The cells of `bodyRows` one row takes: a 28px rail over a code-font line of about 21px (measured on a capture), with a margin. */
const ROW_CELLS = 1.4
/** The cells the filter row (native buttons) takes above the rows. */
const FILTER_CELLS = 2

type Flow = LogModel['flows'][number]

/** One drawn row of the log: its rail is filled in once every row is placed. */
type Row = {
  key: string
  /** The round the row belongs to; none for the unattributed group. */
  round?: number
  text: string
  color: string
  isHeader?: boolean
  flow?: Flow
  dot?: 'session' | number
  lanes: LaneCell[]
}

/** The run still open (or reopened, or silent) as the entry `logModel` takes, under the same condition as the terminal log: a closed run that is logged stays closed. */
function openFlowOf(s: CockpitSnapshot, log: readonly CockpitLogEntry[]): CockpitLogEntry | undefined {
  const run = s.workflowRun
  if (run === undefined) return undefined
  const isReopened = activeRun(run) !== undefined || run.isSilent === true
  if (!isReopened && log.some(e => e.kind === 'flow' && e.key === run.runId)) return undefined
  return {
    at: run.lastAt ?? s.now,
    kind: 'flow',
    key: run.runId,
    ...(run.name !== undefined && { text: run.name }),
    ...(run.startRound !== undefined && { round: run.startRound }),
    ...(run.lane !== undefined && { lane: run.lane }),
  }
}

/** What an entry's row reads. */
function entryText(e: CockpitLogEntry): string {
  const E = t().page.events
  switch (e.kind) {
    case 'commit':
      return E.commit(e.key ?? e.text ?? '', e.text ?? '')
    case 'test':
      return E.test(e.text ?? '', e.isFailed === true)
    case 'pr':
      return E.pr(e.key ?? '', e.text ?? '')
    case 'error':
      return E.error(e.key ?? '?', e.n ?? 1)
    case 'compact':
      return E.compact('', '')
    case 'signal': {
      const sig = loggedSignal(e)
      return sig === undefined ? (e.text ?? '') : signalText(sig).what
    }
    case 'agent':
      return [e.text, e.desc].filter(Boolean).join(' ')
    default:
      return [e.kind, e.desc ?? e.text ?? e.key ?? ''].filter(Boolean).join(' ')
  }
}

const flowName = (f: Flow): string => f.name ?? f.runId

/** The rounds a laned flow spans: from its start to its end; no end, its own round, or the newest row while it is live. */
function spanOf(f: Flow, newest: number): [number, number] | undefined {
  if (f.startRound === undefined) return undefined
  const end = f.endRound ?? (f.isLive ? Math.max(newest, f.startRound) : f.startRound)
  return [f.startRound, end]
}

/** The rows of the log, newest round on top; the unattributed group last. */
function buildRows(model: LogModel, isAll: boolean): Row[] {
  const S = t().desk.log
  const shown = (e: CockpitLogEntry): boolean => isAll || isMainEntry(e)
  // a flow's own events sit in their round (else the flow's), on its lane; none, they join the unattributed group
  const placed = new Map<number, { e: CockpitLogEntry; flow: Flow }[]>()
  const loose: { e: CockpitLogEntry; flow?: Flow }[] = model.unattributed.map(e => ({ e }))
  for (const flow of model.flows) {
    for (const e of flow.events) {
      const n = e.round ?? flow.endRound ?? flow.startRound
      if (n === undefined) loose.push({ e, flow })
      else placed.set(n, [...(placed.get(n) ?? []), { e, flow }])
    }
  }
  const numbers = new Set<number>([...model.rounds.map(r => r.n), ...placed.keys(), ...model.flows.flatMap(f => (f.startRound === undefined ? [] : [f.startRound]))])
  const rows: Row[] = []
  for (const n of [...numbers].sort((a, b) => b - a)) {
    const round = model.rounds.find(r => r.n === n)
    const prompt = round?.entry?.prompt ?? ''
    rows.push({ key: `round:${n}`, round: n, text: prompt === '' ? S.noPrompt : prompt, color: prompt === '' ? DIM : TEXT, isHeader: true, dot: 'session', lanes: [] })
    const events = [...(round?.events ?? []).map(e => ({ e, flow: undefined })), ...(placed.get(n) ?? [])].filter(x => shown(x.e)).sort((a, b) => b.e.at - a.e.at)
    events.forEach(({ e, flow }, i) =>
      rows.push({ key: `event:${n}:${i}`, round: n, text: entryText(e), color: e.isFailed === true ? '#FF9A85' : TEXT, ...(flow !== undefined && { flow, ...(flow.lane !== undefined && { dot: flow.lane }) }), lanes: [] }),
    )
    // the flow's launch: the oldest row of the round it started in
    for (const flow of model.flows.filter(f => f.startRound === n)) {
      rows.push({ key: `flow:${flow.runId}`, round: n, text: S.flow, color: DIM, flow, ...(flow.lane !== undefined && { dot: flow.lane }), lanes: [] })
    }
  }
  const outside = loose.filter(x => shown(x.e)).sort((a, b) => b.e.at - a.e.at)
  const unstarted = model.flows.filter(f => f.startRound === undefined)
  if (outside.length > 0 || unstarted.length > 0) {
    rows.push({ key: 'unattributed', text: S.unattributed, color: DIM, isHeader: true, lanes: [] })
    for (const flow of unstarted) rows.push({ key: `flow:${flow.runId}`, text: S.flow, color: DIM, flow, ...(flow.lane !== undefined && { dot: flow.lane }), lanes: [] })
    outside.forEach(({ e, flow }, i) =>
      rows.push({ key: `loose:${i}`, text: entryText(e), color: TEXT, ...(flow !== undefined && { flow, ...(flow.lane !== undefined && { dot: flow.lane }) }), lanes: [] }),
    )
  }
  return withLanes(rows, model.flows)
}

/** Each laned flow's column over its rows: top row `start` (the line runs down to older rows), bottom row `end`, `through` between, `dot` alone. */
function withLanes(rows: Row[], flows: readonly Flow[]): Row[] {
  const numbers = rows.flatMap(r => (r.round === undefined ? [] : [r.round]))
  const newest = numbers.length === 0 ? 0 : Math.max(...numbers)
  for (const flow of flows) {
    const lane = flow.lane
    const span = spanOf(flow, newest)
    if (lane === undefined || span === undefined) continue
    const [lo, hi] = span
    const inside = rows.flatMap((r, i) => (r.round !== undefined && ((r.round >= lo && r.round <= hi) || r.flow === flow) ? [i] : []))
    const first = inside[0]
    const last = inside.at(-1)
    if (first === undefined || last === undefined) continue
    for (let i = first; i <= last; i++) {
      const kind: LaneCell['kind'] = first === last ? 'dot' : i === first ? 'start' : i === last ? 'end' : 'through'
      rows[i]?.lanes.push({ lane, kind })
    }
  }
  return rows
}

/** The Log tab of the desktop page: the filter and legend, then one row per round, event and flow, each a fixed-width rail and a text column that takes the rest. */
export function deskLog(ui: DeskUi, s: CockpitSnapshot, layout: DeskLayout, actions: PaneActions): RenderElement {
  const { Box, Text, Button, Svg } = ui
  const S = t().desk.log
  const log = s.sessionLog ?? []
  const isAll = isAllShown(s)
  const rows = buildRows(logModel(log, openFlowOf(s, log)), isAll)

  const line = (key: string, rail: string, alt: string, content: RenderElement): RenderElement => (
    <Box key={key} flexDirection="row" alignItems="center" columnGap={1}>
      <Svg source={rail} alt={alt} width={RAIL_WIDTH} height={RAIL_PX} />
      <Box flexGrow={1} flexShrink={1} minWidth={0}>
        {content}
      </Box>
    </Box>
  )
  const drawRow = (r: Row): RenderElement => {
    const id = r.round === undefined ? '' : `#${r.round}`
    const parts: RenderElement[] = [
      ...(id === '' ? [] : [<Text color={DIM}>{`${id} `}</Text>]),
      ...(r.flow === undefined ? [] : [<Text color={LINK} weight="medium">{`${flowName(r.flow)} `}</Text>]),
      <Text color={r.color} weight={r.isHeader === true ? 'bold' : undefined}>
        {r.text}
      </Text>,
    ]
    return line(`desk:log:row:${r.key}`, railSvg({ lanes: r.lanes, ...(r.dot !== undefined && { dot: r.dot }), height: RAIL_PX }), id === '' ? r.text : id, <Text wrap="truncate">{parts}</Text>)
  }
  // all rows when they fit; else pages of `cap - 1` rows and the pager row (more, back to top), the page clamped as the filter changes the count
  const cap = Math.max(2, Math.floor((layout.bodyRows - FILTER_CELLS) / ROW_CELLS))
  const perPage = cap - 1
  const pages = rows.length <= cap ? 1 : Math.ceil(rows.length / perPage)
  const page = Math.min(Math.max(0, Math.floor(s.deskLogPage ?? 0)), pages - 1)
  const pageRows = pages === 1 ? rows : rows.slice(page * perPage, (page + 1) * perPage)
  const left = pages === 1 ? 0 : rows.length - (page + 1) * perPage
  const pager = (
    <Box key="desk:log:pager" flexDirection="row" alignItems="center" columnGap={2} paddingLeft={1}>
      {left > 0 ? (
        <Button key="desk:log:more" onPress={() => actions.setLogPage(page + 1)}>
          <Text color={LINK}>{`+${left}`}</Text>
        </Button>
      ) : null}
      {page > 0 ? (
        <Button key="desk:log:top" onPress={() => actions.setLogPage(0)}>
          <Text color={DIM}>{S.toTop}</Text>
        </Button>
      ) : null}
    </Box>
  )
  const drawn =
    rows.length === 0
      ? [line('desk:log:empty', railSvg({ lanes: [], height: RAIL_PX }), S.empty, <Text wrap="truncate" color={DIM}>{S.empty}</Text>)]
      : [...pageRows.map(drawRow), ...(pages === 1 ? [] : [pager])]

  // one filter for both pages on purpose: the same ALL_KEY the terminal log toggles; pressing the active choice changes nothing
  const choice = (key: string, label: string, isOn: boolean): RenderElement => (
    <Button key={key} onPress={() => (isOn ? undefined : actions.toggleOpen(ALL_KEY))}>
      <Text color={isOn ? ACCENT : DIM} weight={isOn ? 'bold' : undefined}>
        {label}
      </Text>
    </Button>
  )
  return (
    <Box key="desk:log" flexDirection="column" width="100%">
      <Box key="desk:log:filter" flexDirection="row" columnGap={2} alignItems="center">
        {choice('desk:log:important', S.important, !isAll)}
        {choice('desk:log:all', S.all, isAll)}
        <Box flexGrow={1} flexShrink={1} minWidth={0}>
          <Text wrap="truncate" color={DIM}>{`${S.session} · ${S.flow} · ${S.newestTop}`}</Text>
        </Box>
      </Box>
      {drawn}
    </Box>
  )
}
