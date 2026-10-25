import { expect, test } from 'claude-code/testing'

import { WORKFLOW_SILENCE_MS, activeRun, addWorkflowAgent, endRun, expireRun, finishWorkflowAgent, launchedRun, nameRun, roundOf, touchRun } from '../hooks/workflow'

test('roundOf reads the number after R, and none for a label without one', () => {
  expect(roundOf('fix R2')).toBe(2)
  expect(roundOf('review R12 of x')).toBe(12)
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
