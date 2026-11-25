import type { CockpitLogEntry } from '../types'
import { agentLog } from './agents'
import { groupDone } from './done-groups'
import { COLORS } from './shared'
import { visibleAgents } from './view-agents'
import { sp } from './view-base'
import { signalText } from './view-kit'
import type { Kit } from './view-kit'
import { isAllShown, isMainEntry } from './view-log-round'
import { activeRun, agentRunId } from './workflow'
import type { DoneEntry, G } from './view-log-entries'
import { liveAgentEntry, logEntry } from './view-log-entries'

export type Tree = {
  /** The open nodes (IN CORSO): the open round and the run still open or silent. */
  live: G[]
  /** The closed nodes (LOG), newest first. */
  closed: G[]
  /** What a live run's node shows after its name. */
  detail: Map<string, { text: string; isSilent: boolean }>
}

export function buildTree(k: Kit): Tree {
  const { s } = k
  const log = s.sessionLog ?? []
  // An agent that just finished is logged as it ends; one still listed and not yet in the log shows once all the same.
  const logged = new Set(log.filter(e => e.kind === 'agent').map(e => e.key))
  const pending = visibleAgents(s).filter(a => a.status === 'done' && !logged.has(a.id)).flatMap(a => agentLog(a, agentRunId(s.workflowRun, a)) ?? [])
  const all = [...log, ...pending]
  // a flow agent still running is an event of its flow, so a flow whose agents all run can open
  const running = visibleAgents(s).filter(a => a.status === 'running').flatMap(a => {
    const runId = agentRunId(s.workflowRun, a)
    return runId === undefined ? [] : [liveAgentEntry(a, runId, s.now)]
  })
  const entries = [...all.filter(e => isAllShown(s) || isMainEntry(e)).flatMap(e => logEntry(e) ?? []), ...running]

  // the run not logged yet (open, or closed by silence) is a node of IN CORSO
  const run = s.workflowRun
  const detail: Tree['detail'] = new Map()
  let openFlow: CockpitLogEntry | undefined
  // a run reopened by a new spawn is live again: its logged node (closed) gives way to the open one
  const isReopened = run !== undefined && (activeRun(run) !== undefined || run.isSilent === true)
  const flowLog = isReopened ? log.filter(e => !(e.kind === 'flow' && e.key === run?.runId)) : log
  if (run !== undefined && !flowLog.some(e => e.kind === 'flow' && e.key === run.runId)) {
    const mine = all.filter(e => e.kind === 'agent' && e.runId === run.runId)
    // the run's start counts its working agents too: the launch row stays under the round that launched it
    const starts = [...mine.map(e => e.at - (e.ms ?? 0)), ...running.filter(e => e.runId === run.runId).map(e => e.start ?? e.at)]
    const at = run.lastAt ?? s.now
    openFlow = { at, kind: 'flow', key: run.runId, usd: mine.reduce((n, e) => n + (e.usd ?? 0), 0), ...(run.name !== undefined && { text: run.name }), ...(starts.length > 0 && { ms: Math.max(0, at - Math.min(...starts)) }) }
    const progress = [run.phase ?? '—', `${run.agents.filter(a => a.isDone).length}/${run.agents.length}`].join(' · ')
    detail.set(`flow:${run.runId}`, run.isSilent === true ? { text: signalText({ kind: 'workflow', key: `${run.runId}:stall`, label: 'stall' }).what.replace(/^workflow /i, ''), isSilent: true } : { text: progress, isSilent: false })
  }
  const launches = [...flowLog.filter(e => e.kind === 'flow'), ...(openFlow ? [openFlow] : [])].map((f): DoneEntry => ({ at: f.at - (f.ms ?? 0), kind: 'launch', icon: sp('→', COLORS.blue), text: `flow ${f.text ?? f.key ?? ''}` }))

  const groups = groupDone([...entries, ...launches], flowLog, openFlow)
  const live = groups.filter(g => g.isCurrent === true || g.flow?.isLive === true)
  const closed = groups.filter(g => !live.includes(g))
  return { live, closed, detail }
}
