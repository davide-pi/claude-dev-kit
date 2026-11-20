import { expect, test } from 'claude-code/testing'

import { addWorkflowAgent, endRun, finishWorkflowAgent, laneFor, logRunChange } from '../hooks/workflow'

test('Given a flow closed while no round was open, When a run starts 9 rounds later, Then it takes lane 0', () => {
  // Given: the log was written with the last round counted (11) as the flow's end
  const open = addWorkflowAgent(undefined, 'wf1', 'a1', 'step', 1000, 11, [])
  const done = finishWorkflowAgent(open, 'a1', 2000)
  const closed = endRun(done, 3000)
  const log = logRunChange([], done, closed, 11)
  // When
  const lane = laneFor(log, 20)
  // Then
  expect(log?.find(e => e.kind === 'flow')).toMatchObject({ round: 11, endRound: 11, lane: 0 })
  expect(lane).toBe(0)
})

test('Given a flow entry written without endRound, When a run starts 9 rounds later, Then the old entry does not hold its lane', () => {
  // Given
  const log = [{ at: 1000, kind: 'flow', key: 'wf1', round: 11, lane: 0 }]
  // When
  const lane = laneFor(log, 20)
  // Then
  expect(lane).toBe(0)
})
