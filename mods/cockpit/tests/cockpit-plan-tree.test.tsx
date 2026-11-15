import { expect, test } from 'claude-code/testing'

import { inProgressBlocks } from '../hooks/view-page'
import type { CockpitWorkflowRun } from '../types'
import { mountPane, settleAll, spawnWorkflowAgent, spawns } from './cockpit-fixtures'
import { WIDTH, agent, draw, snap } from './cockpit-page-draw'
import { NOW, rowTexts, world } from './cockpit-world'

const TASKS = [
  { id: 'T1', title: 'Log the plan per block and tag the block agents with the task ids', dependsOn: [] },
  { id: 'T2', title: 'Keep the plan', dependsOn: ['T1'] },
  { id: 'T3', title: 'Draw the tree', dependsOn: ['T2'] },
]
const run = (agents: CockpitWorkflowRun['agents'], tasks: CockpitWorkflowRun['tasks'] | null = TASKS): CockpitWorkflowRun => ({ runId: 'wf_1', name: 'dev-loop', phase: 'x', ...(tasks !== null && { tasks }), agents, lastAt: NOW - 5_000 })
const rowOf = (rows: string[], id: string) => rows.find(r => new RegExp(`\\b${id}\\b`).test(r) && !/^[▾▸]/.test(r))

test('plan tree: given a running implement agent of B1 T1 T2, when IN CORSO renders, then T1 and T2 show running with the implement tag and T3 is pending', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const s = snap({ workflowRun: run([{ id: 'a1', isDone: false, label: 'B1 · T1 T2 · implement' }]), agents: [agent('a1', 'implementer', { runId: 'wf_1', description: 'B1 · T1 T2 · implement' })], groupsOpen: { 'flow:wf_1': true } })
  // When
  const { rows } = await draw($, on, s, inProgressBlocks)
  // Then
  expect(rowOf(rows, 'T1')).toMatch(/implement/)
  expect(rowOf(rows, 'T2')).toMatch(/implement/)
  expect(rowOf(rows, 'T3')).not.toMatch(/implement/)
  expect(rows.findIndex(r => /\bT1\b/.test(r))).toBeLessThan(rows.findIndex(r => /\bT3\b/.test(r)))
})

test('plan tree: given a title with runs of whitespace and a newline, when IN CORSO renders, then they collapse to single spaces', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const tasks = [{ id: 'T1', title: 'Log   the\n  plan', dependsOn: [] }]
  const s = snap({ workflowRun: run([{ id: 'a1', isDone: false, label: 'B1 · T1 · implement' }], tasks), agents: [agent('a1', 'implementer', { runId: 'wf_1' })], groupsOpen: { 'flow:wf_1': true } })
  // When
  const { rows } = await draw($, on, s, inProgressBlocks)
  // Then
  expect(rowOf(rows, 'T1')).toMatch(/Log the plan/)
})

test('plan tree: given 2 finished tasks and a running one, when IN CORSO renders, then the finished ones collapse into one +2 done row', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const s = snap({ workflowRun: run([{ id: 'a1', isDone: true, label: 'B1 · T1 T2 · implement' }, { id: 'a2', isDone: true, label: 'B1 · T1 T2 · reader A' }, { id: 'a3', isDone: false, label: 'B2 · T3 · implement' }]), agents: [agent('a3', 'implementer', { runId: 'wf_1' })], groupsOpen: { 'flow:wf_1': true } })
  // When
  const { rows } = await draw($, on, s, inProgressBlocks)
  // Then
  expect(rows.filter(r => /\+2 done/.test(r))).toHaveLength(1)
  expect(rows.filter(r => /Log the plan|Keep the plan/.test(r))).toHaveLength(0)
  expect(rowOf(rows, 'T3')).toMatch(/implement/)
})

test('plan tree: given a task with dependsOn and a long title, when IN CORSO renders, then its row shows ← T1 and fits the pane cut with …', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const long = [{ id: 'T1', title: 'Root task', dependsOn: [] }, { id: 'T2', title: 'A very long title that cannot fit the sixty column pane at all, not even close', dependsOn: ['T1'] }]
  const s = snap({ workflowRun: run([{ id: 'a1', isDone: false, label: 'B1 · T1 T2 · implement' }], long), agents: [agent('a1', 'implementer', { runId: 'wf_1' })], groupsOpen: { 'flow:wf_1': true } })
  // When
  const { rows } = await draw($, on, s, inProgressBlocks)
  // Then
  const row = rowOf(rows, 'T2') ?? ''
  expect(row).toMatch(/← T1/)
  expect(row).toMatch(/…/)
  expect([...row].length).toBeLessThanOrEqual(WIDTH)
})

test('plan tree: given labels only and no plan, when IN CORSO renders, then the task ids per block appear without titles', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const s = snap({ workflowRun: run([{ id: 'a1', isDone: false, label: 'B1 · T1 T2 · implement' }], null), agents: [agent('a1', 'implementer', { runId: 'wf_1' })], groupsOpen: { 'flow:wf_1': true } })
  // When
  const { rows } = await draw($, on, s, inProgressBlocks)
  // Then
  expect(rowOf(rows, 'T1')).toMatch(/implement/)
  expect(rowOf(rows, 'T2')).toMatch(/implement/)
})

test('plan tree: given a Workflow call with a plan and a labelled agent spawn, when the pane is drawn, then the task rows sit under the flow', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const clock = world(on)
  spawns(on)
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', { tool: 'Workflow' }, () => ({ result: { status: 'async_launched', taskId: 'wt', runId: 'wf_1', workflowName: 'dev-loop' } }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Workflow', name: 'dev-loop', args: { plan: { tasks: TASKS } } } as never)
  // When
  await spawnWorkflowAgent($, 'wf_1', 1, 'B1 · T1 T2 · implement')
  await settleAll($)
  await clock.advance(30_000)
  const ui = await mountPane($)
  // Then
  const rows = rowTexts(await ui.drawn())
  expect(rowOf(rows, 'T1')).toMatch(/implement/)
  expect(rowOf(rows, 'T3')).toMatch(/Draw the tree/)
  await ui.unmount()
})
