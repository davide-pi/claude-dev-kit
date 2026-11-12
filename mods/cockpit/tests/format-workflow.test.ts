import { expect, test } from 'claude-code/testing'

import type { CockpitLogEntry } from '../types'
import { agentLog, parseHistory, toHistory } from '../hooks/agents'
import { recordLog } from '../hooks/timeline'
import { WORKFLOW_SILENCE_MS, activeRun, addWorkflowAgent, agentRunId, endRun, expireRun, finishWorkflowAgent, launchedRun, logRunChange, nameRun, recordAgentLog, roundOf, runIdOf, silenceRun, touchRun } from '../hooks/workflow'

test('roundOf reads the number after R, and none for a label without one', () => {
  expect(roundOf('fix R2')).toBe(2)
  expect(roundOf('review R12 of x')).toBe(12)
  expect(roundOf('fix round 2 findings')).toBe(2)
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
  let run = addWorkflowAgent(undefined, 'w1', 'a1', 'fix R2', 1)
  run = addWorkflowAgent(run, 'w1', 'a2', 'fix R1', 2)
  run = addWorkflowAgent(run, 'w1', 'a2', 'fix R1', 3)
  expect(run).toMatchObject({ round: 2, phase: 'fix R1', lastAt: 3, agents: [{ id: 'a1' }, { id: 'a2' }] })
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
  const open = { ...addWorkflowAgent(addWorkflowAgent(undefined, 'w1', 'a1', 'fix R2', 600), 'w1', 'a2', '', 700), name: 'loop' }
  const closed = endRun(finishWorkflowAgent(finishWorkflowAgent(open, 'a1', 1000), 'a2', 1500), 1600)
  // When
  log = logRunChange(log, open, closed)
  const first = log?.find(e => e.kind === 'flow')
  const resumed = addWorkflowAgent(closed, 'w1', 'a3', 'fix R3', 2000)
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
