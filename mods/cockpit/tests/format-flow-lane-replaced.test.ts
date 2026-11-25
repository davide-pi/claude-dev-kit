import { expect, test } from 'claude-code/testing'

import { addWorkflowAgent, logRunChange, nameRun } from '../hooks/workflow'

test('Given run A open in lane 0, When run B replaces it in round 13, Then B takes lane 1 and A keeps lane 0', () => {
  // Given
  const before = addWorkflowAgent(undefined, 'wfA', 'a2', 'step', 1000, 11, [])
  // When
  const after = nameRun(before, { runId: 'wfB' }, 13, [])
  const log = logRunChange([], before, after, 13)
  // Then
  expect(log?.find(e => e.kind === 'flow' && e.key === 'wfA')).toMatchObject({ round: 11, endRound: 13, lane: 0 })
  expect(after).toMatchObject({ startRound: 13, lane: 1 })
})

test('Given run A open in lane 0, When an agent of run B spawns in round 13, Then B takes lane 1', () => {
  // Given
  const before = addWorkflowAgent(undefined, 'wfA', 'a2', 'step', 1000, 11, [])
  // When
  const after = addWorkflowAgent(before, 'wfB', 'b1', 'step', 2000, 13, [])
  // Then
  expect(after).toMatchObject({ runId: 'wfB', startRound: 13, lane: 1 })
})
