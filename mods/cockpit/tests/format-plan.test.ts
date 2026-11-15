import { expect, test } from 'claude-code/testing'

import type { CockpitWorkflowRun } from '../types'
import { WORKFLOW_SILENCE_MS, endRun, expireRun, parseBlockLabel, roundOf, silenceRun, taskPlan, taskRows } from '../hooks/workflow'

const TASKS = [
  { id: 'T1', title: 'Log the plan', dependsOn: [] },
  { id: 'T2', title: 'Keep the plan', dependsOn: ['T1'] },
  { id: 'T3', title: 'Draw the tree', dependsOn: ['T2'] },
]
const run = (agents: CockpitWorkflowRun['agents'], tasks: CockpitWorkflowRun['tasks'] | null = TASKS): CockpitWorkflowRun => ({ runId: 'wf_1', name: 'dev-loop', ...(tasks !== null && { tasks }), agents })

test('plan: given a block agent label, when parsed, then the block, the task ids and the step come out', () => {
  // Given
  const label = 'B1 · T1 T2 · reader A'
  // When
  const parsed = parseBlockLabel(label)
  // Then
  expect(parsed).toEqual({ block: 1, ids: ['T1', 'T2'], step: 'reader A' })
  expect(parseBlockLabel('fix round 2 findings')).toBeUndefined()
  expect(parseBlockLabel('reviewer A · round 1 · code')).toBeUndefined()
})

test('plan: given a Workflow call with args.plan.tasks, when read, then the tasks (id, title, dependsOn) come out in plan order', () => {
  // Given
  const call = { tool: 'Workflow', name: 'dev-loop', args: { plan: { tasks: [{ id: 'T1', title: 'A', dependsOn: [], files: ['x'] }, { id: 'T2', title: 'B', dependsOn: ['T1'] }] } } }
  // When
  const tasks = taskPlan(call)
  // Then
  expect(tasks).toEqual([{ id: 'T1', title: 'A', dependsOn: [] }, { id: 'T2', title: 'B', dependsOn: ['T1'] }])
})

test('plan: given a Workflow call with no plan, when read, then there are no tasks', () => {
  // Given
  const calls = [{ tool: 'Workflow', name: 'review' }, { tool: 'Workflow', name: 'review', args: { brief: 'x' } }, { tool: 'Workflow', args: { plan: { tasks: 'no' } } }]
  // When
  const read = calls.map(taskPlan)
  // Then
  expect(read).toEqual([undefined, undefined, undefined])
})

test('plan: given a running implement agent of B1 T1 T2, when the rows are built, then T1 and T2 run with the implement tag and T3 is pending', () => {
  // Given
  const r = run([{ id: 'a1', isDone: false, label: 'B1 · T1 T2 · implement' }])
  // When
  const rows = taskRows(r)
  // Then
  expect(rows.map(x => [x.id, x.state, x.tag])).toEqual([['T1', 'running', 'implement'], ['T2', 'running', 'implement'], ['T3', 'pending', undefined]])
  expect(rows[0]?.block).toBe(1)
  expect(rows[2]?.block).toBeUndefined()
})

test('plan: given the reader A of the block finished, when the rows are built, then T1 and T2 are done', () => {
  // Given
  const r = run([{ id: 'a1', isDone: true, label: 'B1 · T1 T2 · implement' }, { id: 'a2', isDone: true, label: 'B1 · T1 T2 · reader A' }])
  // When
  const rows = taskRows(r)
  // Then
  expect(rows.map(x => x.state)).toEqual(['done', 'done', 'pending'])
})

test('plan: given a task with dependsOn, when the rows are built, then the row keeps the dependencies and the title', () => {
  // Given
  const r = run([])
  // When
  const rows = taskRows(r)
  // Then
  expect(rows[1]).toMatchObject({ id: 'T2', title: 'Keep the plan', dependsOn: ['T1'], state: 'pending' })
})

test('plan: given tasks in blocks 2 and 1, when the rows are built, then they order by block and then plan order, the unplaced last', () => {
  // Given
  const r = run([{ id: 'a1', isDone: false, label: 'B2 · T3 · implement' }, { id: 'a2', isDone: false, label: 'B1 · T2 · implement' }])
  // When
  const rows = taskRows(r)
  // Then
  expect(rows.map(x => x.id)).toEqual(['T2', 'T3', 'T1'])
})

test('plan: given size S with no reader A and a block 2 agent, when the rows are built, then block 1 is done and block 2 runs', () => {
  // Given
  const r = run([{ id: 'a1', isDone: true, label: 'B1 · T1 · implement' }, { id: 'a2', isDone: false, label: 'B2 · T2 · implement' }])
  // When
  const rows = taskRows(r)
  // Then
  expect(rows.map(x => [x.id, x.state])).toEqual([['T1', 'done'], ['T2', 'running'], ['T3', 'pending']])
})

test('plan: given the implement agent finished and no reader A yet, when the rows are built, then the block is still running', () => {
  // Given
  const r = run([{ id: 'a1', isDone: true, label: 'B1 · T1 · implement' }])
  // When
  const rows = taskRows(r)
  // Then
  expect(rows[0]?.state).toBe('running')
})

test('plan: given a silent run whose agents were expired, when the rows are built, then no task is marked done', () => {
  // Given
  const open = { ...run([{ id: 'a1', isDone: false, label: 'B1 · T1 · implement' }]), lastAt: 0 }
  const silent = silenceRun(endRun(expireRun(open, WORKFLOW_SILENCE_MS + 1), WORKFLOW_SILENCE_MS + 1))
  // When
  const rows = taskRows(silent)
  // Then
  expect(silent?.isSilent).toBe(true)
  expect(rows[0]?.state).not.toBe('done')
})

test('plan: given a run that ended normally, when the rows are built, then its placed tasks are done', () => {
  // Given
  const r = { ...run([{ id: 'a1', isDone: true, isFailed: true, label: 'B1 · T1 · implement' }]), endedAt: 5 }
  // When
  const rows = taskRows(r)
  // Then
  expect(rows[0]?.state).toBe('done')
})

test('plan: given a failed reader A, when the rows are built, then the block is not done', () => {
  // Given
  const r = run([{ id: 'a1', isDone: true, label: 'B1 · T1 · implement' }, { id: 'a2', isDone: true, isFailed: true, label: 'B1 · T1 · reader A' }])
  // When
  const rows = taskRows(r)
  // Then
  expect(rows[0]?.state).not.toBe('done')
})

test('plan: given a running fix after the reader A finished, when the rows are built, then the task runs with the fix tag', () => {
  // Given
  const r = run([{ id: 'a1', isDone: true, label: 'B1 · T1 · reader A' }, { id: 'a2', isDone: false, label: 'B1 · T1 · fix' }])
  // When
  const rows = taskRows(r)
  // Then
  expect(rows[0]).toMatchObject({ state: 'running', tag: 'fix' })
})

test('plan: given numeric ids and dependencies in the plan, when read, then they come out as strings', () => {
  // Given
  const call = { args: { plan: { tasks: [{ id: 1, title: 'A', dependsOn: [] }, { id: 2, title: 'B', dependsOn: [1] }] } } }
  // When
  const tasks = taskPlan(call)
  // Then
  expect(tasks).toEqual([{ id: '1', title: 'A', dependsOn: [] }, { id: '2', title: 'B', dependsOn: ['1'] }])
})

test('plan: given a block label whose task id looks like a round, when its round is read, then there is none', () => {
  // Given
  const labels = ['B1 · R2 · implement', 'fix round 2 findings', 'reviewer A · round 1 · code']
  // When
  const rounds = labels.map(roundOf)
  // Then
  expect(rounds).toEqual([undefined, 2, 1])
})

test('plan: given labels only and no plan, when the rows are built, then the task ids per block come out without titles', () => {
  // Given
  const r = run([{ id: 'a1', isDone: false, label: 'B1 · T1 T2 · implement' }, { id: 'a2', isDone: false, label: 'B2 · T3 · implement' }], null)
  // When
  const rows = taskRows(r)
  // Then
  expect(rows.map(x => [x.id, x.block, x.title])).toEqual([['T1', 1, undefined], ['T2', 1, undefined], ['T3', 2, undefined]])
})
