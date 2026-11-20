import type { CockpitLogEntry, CockpitSnapshot } from '../types'
import type { LaneCell } from './desk-svg'
import { logModel } from './done-groups'
import type { LogModel } from './done-groups'
import { loggedSignal } from './signals'
import { t } from './strings'
import { signalText } from './view-kit'
import { isAllShown, isMainEntry } from './view-log-round'
import { activeRun } from './workflow'

// ── The log's rows with their flow lanes: one computation, drawn as an Svg rail on the desktop and as box-drawing glyphs in the terminal ──

export const TEXT = '#F2F0EA'
export const DIM = '#A8A49B'

export type Flow = LogModel['flows'][number]

/** One drawn row of the log: its lanes are filled in once every row is placed. */
export type Row = {
  key: string
  /** The round the row belongs to; none for the unattributed group. */
  round?: number
  text: string
  color: string
  isHeader?: boolean
  flow?: Flow
  dot?: 'session' | number
  lanes: LaneCell[]
  /** When it happened (the round's entry, the event); none for a flow's launch and the group header: its time column stays blank. */
  at?: number
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

export const flowName = (f: Flow): string => f.name ?? f.runId

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
    rows.push({ key: `round:${n}`, round: n, ...(round?.entry?.at !== undefined && { at: round.entry.at }), text: prompt === '' ? S.noPrompt : prompt, color: prompt === '' ? DIM : TEXT, isHeader: true, dot: 'session', lanes: [] })
    const events = [...(round?.events ?? []).map(e => ({ e, flow: undefined })), ...(placed.get(n) ?? [])].filter(x => shown(x.e)).sort((a, b) => b.e.at - a.e.at)
    events.forEach(({ e, flow }, i) =>
      rows.push({ key: `event:${n}:${i}`, round: n, at: e.at, text: entryText(e), color: e.isFailed === true ? '#FF5A4F' : TEXT, ...(flow !== undefined && { flow, ...(flow.lane !== undefined && { dot: flow.lane }) }), lanes: [] }),
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
      rows.push({ key: `loose:${i}`, at: e.at, text: entryText(e), color: TEXT, ...(flow !== undefined && { flow, ...(flow.lane !== undefined && { dot: flow.lane }) }), lanes: [] }),
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

/** The rows of the session log, lanes placed, as the Filter (`Important` or `All`) shows them. */
export const logRowsOf = (s: CockpitSnapshot): Row[] => {
  const log = s.sessionLog ?? []
  return buildRows(logModel(log, openFlowOf(s, log)), isAllShown(s))
}
