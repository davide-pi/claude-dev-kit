import { expect, test } from 'claude-code/testing'

import type { CockpitWorkflowRun } from '../types'
import { segmentsOf } from '../hooks/now-model'
import { INITIAL } from '../hooks/state'
import { WORKFLOW_SILENCE_MS, endRun, expireRun, parseStepLabel, roundOf, silenceRun, taskPlan, taskRows } from '../hooks/workflow'

const TASKS = [
  { id: 'T1', title: 'Log the plan', dependsOn: [] },
  { id: 'T2', title: 'Keep the plan', dependsOn: ['T1'] },
  { id: 'T3', title: 'Draw the tree', dependsOn: ['T2'] },
]
const run = (agents: CockpitWorkflowRun['agents'], tasks: CockpitWorkflowRun['tasks'] | null = TASKS): CockpitWorkflowRun => ({ runId: 'wf_1', name: 'build', ...(tasks !== null && { tasks }), agents })

test('plan: given a build agent label, when parsed, then the step and the task id come out', () => {
  // Given
  const labels = ['implement T1', 'retry T1', 'verify T1 (retry)', 'red T1', 'red T1 (retry)', 'red verify T1', 'red verify T1 (retry)', 'suite', 'review round 2', 'fix src/a.ts', 'reviewer A · round 1 · code', 'list the files to review', 'review A · whole change', 'review B · whole change', 'merge the reviews into one report']
  // When
  const parsed = labels.map(parseStepLabel)
  // Then
  expect(parsed).toEqual([{ step: 'implement', id: 'T1' }, { step: 'retry', id: 'T1' }, { step: 'verify', id: 'T1' }, { step: 'red', id: 'T1' }, { step: 'red', id: 'T1' }, { step: 'red verify', id: 'T1' }, { step: 'red verify', id: 'T1' }, { step: 'suite' }, { step: 'review' }, { step: 'fix' }, undefined, { step: 'list' }, { step: 'review A' }, { step: 'review B' }, { step: 'merge' }])
})

test('plan: given a Workflow call with args.tasks, when read, then the tasks (id, title, dependsOn) come out in plan order', () => {
  // Given
  const call = { tool: 'Workflow', name: 'build', args: { tasks: [{ id: 'T1', title: 'A', dependsOn: [], files: ['x'] }, { id: 'T2', title: 'B', dependsOn: ['T1'] }] } }
  // When
  const tasks = taskPlan(call)
  // Then
  expect(tasks).toEqual([{ id: 'T1', title: 'A', dependsOn: [] }, { id: 'T2', title: 'B', dependsOn: ['T1'] }])
})

test('plan: given a Workflow call with no plan, when read, then there are no tasks', () => {
  // Given
  const calls = [{ tool: 'Workflow', name: 'review' }, { tool: 'Workflow', name: 'review', args: { brief: 'x' } }, { tool: 'Workflow', args: { tasks: 'no' } }]
  // When
  const read = calls.map(taskPlan)
  // Then
  expect(read).toEqual([undefined, undefined, undefined])
})

test('plan: given a running implement agents of T1 and T2, when the rows are built, then T1 and T2 run with the implement tag and T3 is pending', () => {
  // Given
  const r = run([{ id: 'a1', isDone: false, label: 'implement T1' }, { id: 'a2', isDone: false, label: 'implement T2' }], [{ ...TASKS[0]!, dependsOn: [] }, { ...TASKS[1]!, dependsOn: [] }, TASKS[2]!])
  // When
  const rows = taskRows(r)
  // Then
  expect(rows.map(x => [x.id, x.state, x.tag])).toEqual([['T1', 'running', 'implement'], ['T2', 'running', 'implement'], ['T3', 'pending', undefined]])
  expect(rows[0]?.block).toBe(1)
  expect(rows[2]?.block).toBeUndefined()
})

test('plan: given the verify of T1 finished and nothing after it, when the rows are built, then T1 is still running (a red gate also finishes its agent)', () => {
  // Given
  const r = run([{ id: 'a1', isDone: true, label: 'implement T1' }, { id: 'a2', isDone: true, label: 'verify T1' }])
  // When
  const rows = taskRows(r)
  // Then
  expect(rows.map(x => x.state)).toEqual(['running', 'pending', 'pending'])
})

test('plan: given the retry verify of T1 finished and the suite started, when the rows are built, then T1 is done', () => {
  // Given
  const r = run([{ id: 'a1', isDone: true, label: 'verify T1 (retry)' }, { id: 'a2', isDone: false, label: 'suite' }])
  // When
  const rows = taskRows(r)
  // Then
  expect(rows[0]?.state).toBe('done')
})

test('plan: given a red verify of T1 and no retry spawned yet, when the rows are built, then T1 is not drawn done', () => {
  // Given
  const r = run([{ id: 'a1', isDone: true, label: 'implement T1' }, { id: 'a2', isDone: true, label: 'verify T1' }])
  // When
  const rows = taskRows(r)
  // Then
  expect(rows[0]?.state).not.toBe('done')
})

test('flow: given a step run by several agents, when the segments are built, then the step runs if one runs, fails if one failed and is done only when all are done', () => {
  // Given
  const withAgents = (agents: CockpitWorkflowRun['agents']) => ({ ...INITIAL, workflowRun: run(agents, [{ id: 'T1', title: '', dependsOn: [] }, { id: 'T2', title: '', dependsOn: [] }]) })
  // When
  const running = segmentsOf(withAgents([{ id: 'a1', isDone: false, label: 'implement T1' }, { id: 'a2', isDone: true, label: 'implement T2' }]))
  const runningFirst = segmentsOf(withAgents([{ id: 'a1', isDone: true, label: 'implement T1' }, { id: 'a2', isDone: false, label: 'implement T2' }]))
  const failed = segmentsOf(withAgents([{ id: 'a1', isDone: true, isFailed: true, label: 'implement T1' }, { id: 'a2', isDone: true, label: 'implement T2' }]))
  const done = segmentsOf(withAgents([{ id: 'a1', isDone: true, label: 'implement T1' }, { id: 'a2', isDone: true, label: 'implement T2' }]))
  // Then
  expect([running, runningFirst, failed, done].map(x => x[0]?.state)).toEqual(['running', 'running', 'failed', 'done'])
})

test('plan: given a task with dependsOn, when the rows are built, then the row keeps the dependencies and the title', () => {
  // Given
  const r = run([])
  // When
  const rows = taskRows(r)
  // Then
  expect(rows[1]).toMatchObject({ id: 'T2', title: 'Keep the plan', dependsOn: ['T1'], state: 'pending' })
})

test('plan: given tasks in waves 2 and 1, when the rows are built, then they order by block and then plan order, the unplaced last', () => {
  // Given
  const r = run([{ id: 'a1', isDone: false, label: 'implement T3' }, { id: 'a2', isDone: false, label: 'implement T2' }])
  // When
  const rows = taskRows(r)
  // Then
  expect(rows.map(x => x.id)).toEqual(['T2', 'T3', 'T1'])
})

test('plan: given no verify yet and an agent of a later wave, when the rows are built, then wave 1 is done and wave 2 runs', () => {
  // Given
  const r = run([{ id: 'a1', isDone: true, label: 'implement T1' }, { id: 'a2', isDone: false, label: 'implement T2' }])
  // When
  const rows = taskRows(r)
  // Then
  expect(rows.map(x => [x.id, x.state])).toEqual([['T1', 'done'], ['T2', 'running'], ['T3', 'pending']])
})

test('plan: given the implement agent finished and no verify yet, when the rows are built, then the task is still running', () => {
  // Given
  const r = run([{ id: 'a1', isDone: true, label: 'implement T1' }])
  // When
  const rows = taskRows(r)
  // Then
  expect(rows[0]?.state).toBe('running')
})

test('plan: given a silent run whose agents were expired, when the rows are built, then no task is marked done', () => {
  // Given
  const open = { ...run([{ id: 'a1', isDone: false, label: 'implement T1' }]), lastAt: 0 }
  const silent = silenceRun(endRun(expireRun(open, WORKFLOW_SILENCE_MS + 1), WORKFLOW_SILENCE_MS + 1))
  // When
  const rows = taskRows(silent)
  // Then
  expect(silent?.isSilent).toBe(true)
  expect(rows[0]?.state).not.toBe('done')
})

test('plan: given a run that ended normally, when the rows are built, then its placed tasks are done', () => {
  // Given
  const r = { ...run([{ id: 'a1', isDone: true, isFailed: true, label: 'implement T1' }]), endedAt: 5 }
  // When
  const rows = taskRows(r)
  // Then
  expect(rows[0]?.state).toBe('done')
})

test('plan: given a failed verify, when the rows are built, then the task is not done', () => {
  // Given
  const r = run([{ id: 'a1', isDone: true, label: 'implement T1' }, { id: 'a2', isDone: true, isFailed: true, label: 'verify T1' }])
  // When
  const rows = taskRows(r)
  // Then
  expect(rows[0]?.state).not.toBe('done')
})

test('plan: given a running retry after the verify finished, when the rows are built, then the task runs with the retry tag', () => {
  // Given
  const r = run([{ id: 'a1', isDone: true, label: 'verify T1' }, { id: 'a2', isDone: false, label: 'retry T1' }])
  // When
  const rows = taskRows(r)
  // Then
  expect(rows[0]).toMatchObject({ state: 'running', tag: 'retry' })
})

test('plan: given numeric ids and dependencies in the plan, when read, then they come out as strings', () => {
  // Given
  const call = { args: { tasks: [{ id: 1, title: 'A', dependsOn: [] }, { id: 2, title: 'B', dependsOn: [1] }] } }
  // When
  const tasks = taskPlan(call)
  // Then
  expect(tasks).toEqual([{ id: '1', title: 'A', dependsOn: [] }, { id: '2', title: 'B', dependsOn: ['1'] }])
})

test('plan: given a task label whose id looks like a round, when its round is read, then there is none', () => {
  // Given
  const labels = ['implement R2', 'review round 2', 'reviewer A · round 1 · code']
  // When
  const rounds = labels.map(roundOf)
  // Then
  expect(rounds).toEqual([undefined, 2, 1])
})

test('plan: given labels only and no plan, when the rows are built, then the task ids and their wave come out without titles', () => {
  // Given
  const r = run([{ id: 'a1', isDone: false, label: 'implement T1' }, { id: 'a2', isDone: false, label: 'implement T2' }, { id: 'a3', isDone: false, label: 'implement T3' }], null)
  // When
  const rows = taskRows(r)
  // Then
  expect(rows.map(x => [x.id, x.block, x.title])).toEqual([['T1', 1, undefined], ['T2', 1, undefined], ['T3', 1, undefined]])
})
