import { expect, test } from 'claude-code/testing'

import type { CockpitLogEntry } from '../types'
import { agentLog, parseHistory, toHistory } from '../hooks/agents'
import { SESSION_LOG_KEEP, recordLog } from '../hooks/timeline'
import { WORKFLOW_SILENCE_MS, activeRun, addWorkflowAgent, agentRunId, endRun, expireRun, finishWorkflowAgent, laneFor, launchedRun, logRunChange, nameRun, recordAgentLog, roundOf, runIdOf, silenceRun, touchRun } from '../hooks/workflow'

test('roundOf reads the number after R, and none for a label without one', () => {
  expect(roundOf('review round 2')).toBe(2)
  expect(roundOf('fix R2.js')).toBeUndefined()
  expect(roundOf('review R12 of x')).toBe(12)
  expect(roundOf('fix round 2 findings')).toBeUndefined()
  expect(roundOf('reviewer A1 · round 3 · code, files 1/2')).toBe(3)
  expect(roundOf('R')).toBeUndefined()
  expect(roundOf('fix')).toBeUndefined()
})

test('launchedRun reads the run id and name of a launch, and nothing from any other result', () => {
  expect(launchedRun({ runId: 'wf_1', workflowName: 'loop' })).toEqual({ runId: 'wf_1', name: 'loop' })
  expect(launchedRun({ runId: 'wf_1' })).toEqual({ runId: 'wf_1' })
  expect(launchedRun({ runId: '' })).toBeUndefined()
  expect(launchedRun('text')).toBeUndefined()
})

test('addWorkflowAgent keeps the highest round and counts an agent once; nameRun names the run it announces, another id starts a new count', () => {
  let run = addWorkflowAgent(undefined, 'w1', 'a1', 'review round 2', 1)
  run = addWorkflowAgent(run, 'w1', 'a2', 'review round 1', 2)
  run = addWorkflowAgent(run, 'w1', 'a2', 'review round 1', 3)
  expect(run).toMatchObject({ round: 2, phase: 'review round 1', lastAt: 3, agents: [{ id: 'a1' }, { id: 'a2' }] })
  expect(run.agents).toHaveLength(2)
  expect(nameRun(run, { runId: 'w1', name: 'loop' }).name).toBe('loop')
  expect(nameRun(run, { runId: 'w2', name: 'other' })).toEqual({ runId: 'w2', name: 'other', agents: [] })
})

test('endRun closes only a run with agents that are all done; a spawn reopens it, touchRun ignores a closed one, activeRun hides it', () => {
  expect(endRun(undefined, 9)).toBeUndefined()
  const empty = { runId: 'w1', agents: [] }
  expect(endRun(empty, 9)).toBe(empty)
  const open = addWorkflowAgent(addWorkflowAgent(undefined, 'w1', 'a1', '', 1), 'w1', 'a2', '', 2)
  const partial = finishWorkflowAgent(open, 'a1', 3)
  expect(endRun(partial, 9)?.endedAt).toBeUndefined()
  const done = endRun(finishWorkflowAgent(partial, 'a2', 4), 9)
  expect(done?.endedAt).toBe(9)
  expect(activeRun(done)).toBeUndefined()
  expect(touchRun(done, 'a1', 20)).toBe(done)
  expect(touchRun(partial, 'a1', 20)?.lastAt).toBe(20)
  const reopened = addWorkflowAgent(done, 'w1', 'a3', '', 30)
  expect(reopened.endedAt).toBeUndefined()
  expect(activeRun(reopened)).toBe(reopened)
})

test('expireRun marks every open agent finished once the run has been silent past the limit, and leaves any other run alone', () => {
  const open = addWorkflowAgent(addWorkflowAgent(undefined, 'w1', 'a1', '', 1000), 'w1', 'a2', '', 1000)
  expect(expireRun(open, 1000 + WORKFLOW_SILENCE_MS)).toBe(open)
  const expired = expireRun(open, 1001 + WORKFLOW_SILENCE_MS)
  expect(expired?.agents.every(a => a.isDone)).toBe(true)
  expect(endRun(expired, 9)?.endedAt).toBe(9)
  const touched = touchRun(open, 'a1', 1000 + WORKFLOW_SILENCE_MS)
  expect(expireRun(touched, 1001 + WORKFLOW_SILENCE_MS)).toBe(touched)
  const closed = { ...open, endedAt: 5 }
  expect(expireRun(closed, 9e9)).toBe(closed)
  expect(expireRun(undefined, 9e9)).toBeUndefined()
})

// ── The flow node of the session log ──

const agentEntry = (key: string, at: number, ms: number, usd: number, runId?: string): CockpitLogEntry => ({ at, kind: 'agent', key, ms, usd, ...(runId !== undefined && { runId }) })

test('agentRunId: given run w2 replacing w1 while agent a1 of w1 runs, when a1 ends, then its log entry still carries w1', () => {
  // Given
  const w1 = addWorkflowAgent(undefined, 'w1', 'a1', '', 1)
  const w2 = addWorkflowAgent(w1, 'w2', 'a9', '', 2)
  const agent = { id: 'a1', type: 'fixer', startedAt: 10, endedAt: 50, tokens: 0, status: 'done' as const, runId: 'w1' }
  // When
  const entry = agentLog(agent, agentRunId(w2, agent))
  // Then
  expect(runIdOf(w2, 'a1')).toBeUndefined()
  expect(entry?.runId).toBe('w1')
  expect(agentRunId(w2, { ...agent, runId: undefined })).toBeUndefined()
  expect(agentRunId(w1, { ...agent, runId: undefined })).toBe('w1')
})

test('agentLog and runIdOf: given an agent of the current run, when its entry is made, then it carries the run id; an agent outside the run carries none', () => {
  // Given
  const run = addWorkflowAgent(undefined, 'w1', 'a1', '', 1)
  const agent = { id: 'a1', type: 'fixer', startedAt: 10, endedAt: 50, tokens: 0, status: 'done' as const }
  // When
  const inRun = agentLog(agent, runIdOf(run, 'a1'))
  const outside = agentLog({ ...agent, id: 'b1' }, runIdOf(run, 'b1'))
  // Then
  expect(inRun?.runId).toBe('w1')
  expect(outside).not.toHaveProperty('runId')
  expect(toHistory(agent, 'w1')?.runId).toBe('w1')
  expect(parseHistory([{ id: 'a1', type: 'x', startedAt: 1, endedAt: 2, runId: 'w1' }, { id: 'a2', type: 'x', startedAt: 1, endedAt: 2, runId: 7 }]).map(h => h.runId)).toEqual(['w1', undefined])
})

test('logRunChange: given a run that closes, resumes and closes again, when it is logged each time, then one flow node holds the updated cost and length', () => {
  // Given
  let log: CockpitLogEntry[] | undefined = [agentEntry('a1', 1000, 400, 0.3, 'w1'), agentEntry('a2', 1500, 800, 0.2, 'w1')]
  const open = { ...addWorkflowAgent(addWorkflowAgent(undefined, 'w1', 'a1', 'review round 2', 600), 'w1', 'a2', '', 700), name: 'loop' }
  const closed = endRun(finishWorkflowAgent(finishWorkflowAgent(open, 'a1', 1000), 'a2', 1500), 1600)
  // When
  log = logRunChange(log, open, closed)
  const first = log?.find(e => e.kind === 'flow')
  const resumed = addWorkflowAgent(closed, 'w1', 'a3', 'review round 3', 2000)
  log = recordLog(log, agentEntry('a3', 2500, 500, 0.1, 'w1'))
  const closedAgain = endRun(finishWorkflowAgent(resumed, 'a3', 2500), 2600)
  log = logRunChange(log, resumed, closedAgain)
  // Then
  expect(first).toMatchObject({ at: 1600, key: 'w1', text: 'loop', ms: 1000, n: 2 })
  expect(Math.round(100 * (first?.usd ?? 0))).toBe(Math.round(100 * 0.5))
  const flows = log?.filter(e => e.kind === 'flow') ?? []
  expect(flows).toHaveLength(1)
  expect(flows[0]?.at).toBe(2600)
  expect(Math.round(100 * (flows[0]?.usd ?? 0))).toBe(Math.round(100 * 0.6))
  expect(flows[0]?.ms).toBe(2000)
  expect(flows[0]?.isFailed).toBeUndefined()
})

test('logRunChange: given the agents of a closed flow pruned from the log, when it closes again, then the stored cost is kept and only the new agents add to it', () => {
  // Given
  const stored: CockpitLogEntry = { at: 1600, kind: 'flow', key: 'w1', usd: 0.5, ms: 1000 }
  const log = [stored, agentEntry('a3', 2500, 500, 0.1, 'w1')]
  const resumed = { ...addWorkflowAgent(undefined, 'w1', 'a3', '', 2000), agents: [{ id: 'a3', isDone: true }] }
  // When
  const out = logRunChange(log, resumed, endRun(resumed, 2600))
  // Then
  expect(out?.find(e => e.kind === 'flow')).toMatchObject({ at: 2600, ms: 2000 })
  expect(Math.round(100 * (out?.find(e => e.kind === 'flow')?.usd ?? 0))).toBe(Math.round(100 * 0.6))
})

test('logRunChange: given a silent run the tick closed, when nothing replaces it, then it is not logged; when a newer run replaces it, then it is logged failed', () => {
  // Given
  const open = addWorkflowAgent(addWorkflowAgent(undefined, 'w1', 'a1', '', 1000), 'w1', 'a2', '', 1000)
  const expired = expireRun(open, 1001 + WORKFLOW_SILENCE_MS)
  const silent = silenceRun(endRun(expired, 2000 + WORKFLOW_SILENCE_MS))
  const log: CockpitLogEntry[] = [agentEntry('a1', 1500, 400, 0.2, 'w1')]
  // When
  const notYet = logRunChange(log, open, silent)
  const afterTurn = logRunChange(log, silent, endRun(silent, 9e9))
  const replacing = addWorkflowAgent(silent, 'w2', 'b1', '', 9e9)
  const replaced = logRunChange(log, silent, replacing)
  // Then
  expect(notYet).toBe(log)
  expect(afterTurn).toBe(log) // a main turn.start is not a real end: the silent run waits for a newer run
  expect(replaced?.find(e => e.kind === 'flow')).toMatchObject({ key: 'w1', at: 2000 + WORKFLOW_SILENCE_MS, isFailed: true, usd: 0.2 })
  expect(addWorkflowAgent(silent, 'w1', 'a9', '', 9e9).isSilent).toBeUndefined()
})

test('logRunChange: given a run still open when another run arrives, when it is logged, then its node is written failed', () => {
  // Given
  const open = addWorkflowAgent(undefined, 'w1', 'a1', '', 1000)
  const log: CockpitLogEntry[] = [agentEntry('a1', 1500, 400, 0.2, 'w1')]
  // When
  const out = logRunChange(log, open, addWorkflowAgent(open, 'w2', 'b1', '', 2000))
  // Then
  expect(out?.find(e => e.kind === 'flow')).toMatchObject({ key: 'w1', isFailed: true, usd: 0.2 })
})

test('recordAgentLog: given a run replaced while its agent still worked, when that agent ends, then its cost joins the run\'s flow node, which ends with it', () => {
  // Given: w1's node was written at its replacement, $0.10 so far
  const log: CockpitLogEntry[] = [{ at: 1000, kind: 'flow', key: 'w1', usd: 0.1, ms: 500, isFailed: true }]
  const late: CockpitLogEntry = { at: 3000, kind: 'agent', key: 'a1', runId: 'w1', usd: 0.4, ms: 2500 }
  // When
  const once = recordAgentLog(log, late)
  const twice = recordAgentLog(once, late)
  // Then
  expect(once.find(e => e.kind === 'flow')).toEqual({ at: 3000, kind: 'flow', key: 'w1', usd: 0.5, ms: 2500, isFailed: true })
  expect(twice).toEqual(once)
})

test('recordAgentLog: given an agent outside any run, or of a run with no node yet, when it ends, then only its own entry is added', () => {
  // Given
  const log: CockpitLogEntry[] = [{ at: 1000, kind: 'flow', key: 'w1', usd: 0.1 }]
  // When
  const plain = recordAgentLog(log, { at: 2000, kind: 'agent', key: 'a2', usd: 0.3 })
  const open = recordAgentLog(log, { at: 2000, kind: 'agent', key: 'a3', runId: 'w2', usd: 0.3 })
  // Then
  expect(plain.find(e => e.kind === 'flow')?.usd).toBe(0.1)
  expect(open.find(e => e.kind === 'flow')?.usd).toBe(0.1)
  expect(open).toHaveLength(2)
})

// ── The conversation rounds a flow spans, and its lane ──

const flowNode = (key: string, round: number, lane: number, endRound?: number, at = 1000): CockpitLogEntry => ({ at, kind: 'flow', key, round, lane, ...(endRound !== undefined && { endRound }) })
const closed = (runId: string, startRound: number, lane: number, endedAt: number) => {
  const before = { runId, agents: [{ id: `${runId}-a`, isDone: true }], lastAt: endedAt - 1, startRound, lane }
  return { before, after: { ...before, endedAt } }
}

test('Given a run first seen in round 11 and closed in round 13, When its flow is written, Then the entry has round 11 and endRound 13', () => {
  // Given: the run is created by nameRun in round 11, before any spawn
  let run = nameRun(undefined, { runId: 'w1', name: 'loop' }, 11, [])
  run = addWorkflowAgent(run, 'w1', 'a1', '', 1000, 11, [])
  const open = finishWorkflowAgent(run, 'a1', 2000)
  const ended = endRun(open, 3000)
  // When
  const log = logRunChange(undefined, open, ended, 13)
  // Then
  expect(run).toMatchObject({ startRound: 11, lane: 0 })
  expect(log?.find(e => e.kind === 'flow')).toMatchObject({ key: 'w1', round: 11, endRound: 13, lane: 0 })
})

test('Given a flow entry over 11-13, When a run starts in round 13, Then it takes lane 1; in round 14, Then lane 0', () => {
  // Given
  const log = [flowNode('w1', 11, 0, 13)]
  // When
  const overlapping = nameRun(undefined, { runId: 'w2' }, 13, log)
  const after = nameRun(undefined, { runId: 'w3' }, 14, log)
  // Then
  expect(overlapping).toMatchObject({ startRound: 13, lane: 1 })
  expect(after).toMatchObject({ startRound: 14, lane: 0 })
  expect(laneFor(log, 13)).toBe(1)
  expect(laneFor(log, 14)).toBe(0)
})

test('Given a flow entry with no endRound, When a run starts in a later round, Then the entry holds its lane only in its own round; the lowest free lane is taken', () => {
  // Given
  const old = [flowNode('w1', 11, 0)]
  const two = [flowNode('w1', 11, 0, 13), flowNode('w2', 12, 1)]
  // When / Then
  expect(laneFor(old, 11)).toBe(1)
  expect(laneFor(old, 20)).toBe(0)
  expect(laneFor(two, 12)).toBe(2)
  expect(laneFor(two, 13)).toBe(1)
  expect(laneFor(two, 14)).toBe(0)
  expect(laneFor(undefined, 5)).toBe(0)
})

test('Given a closed flow entry, When a late agent rewrites it, Then round and lane stay', () => {
  // Given
  const log = [flowNode('w1', 11, 1, 13, 1000)]
  const late: CockpitLogEntry = { at: 5000, kind: 'agent', key: 'a9', runId: 'w1', text: 'implementer', usd: 1 }
  // When
  const next = recordAgentLog(log, late)
  // Then
  expect(next.find(e => e.kind === 'flow')).toMatchObject({ round: 11, lane: 1, endRound: 13 })
})

test('Given a flow entry over 11-13, When the resumed run closes it again in round 16, Then round and lane stay and endRound moves to 16', () => {
  // Given: the resumed run was created later, so it carries another startRound and lane
  const log = [flowNode('w1', 11, 1, 13, 1000)]
  const { before, after } = closed('w1', 15, 0, 9000)
  // When
  const next = logRunChange(log, before, after, 16)
  // Then
  expect(next?.find(e => e.kind === 'flow')).toMatchObject({ round: 11, lane: 1, endRound: 16 })
})

test('Given two flow entries, When the oldest is evicted from the log, Then the other keeps its lane', () => {
  // Given
  const one = closed('w1', 11, 0, 1000)
  const two = closed('w2', 11, 1, 2000)
  let log = logRunChange(undefined, { ...one.before, endedAt: undefined }, one.after, 12)
  log = logRunChange(log, { ...two.before, endedAt: undefined }, two.after, 12)
  // When
  for (let i = 0; i < SESSION_LOG_KEEP - 1; i++) log = recordLog(log, { at: 5000 + i, kind: 'round' })
  // Then
  expect(log?.some(e => e.key === 'w1')).toBe(false)
  expect(log?.find(e => e.key === 'w2')).toMatchObject({ round: 11, lane: 1, endRound: 12 })
})