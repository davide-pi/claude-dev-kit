import { expect, test } from 'claude-code/testing'

import { mainTurnEnd, openCockpit, settleAll, spawnAgent, spawnWorkflowAgent, spawns } from './cockpit-fixtures'
import { world } from './cockpit-world'

test('refresh cost: with no agent running no tier reads or writes anything while the pane is closed', async ($, on) => {
  const statusCalls: string[] = []
  const listCalls: string[] = []
  const claimReads: string[] = []
  const log: string[] = []
  const clock = world(on, { statusCalls, listCalls, claimReads, log })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await settleAll()
  const before = { status: statusCalls.length, list: listCalls.length, claims: claimReads.length, writes: log.length }
  await clock.advance(5 * 60_000)
  await settleAll()
  expect({ status: statusCalls.length, list: listCalls.length, claims: claimReads.length, writes: log.length }).toEqual(before)
})

test('refresh cost: opening the pane brings git and the agents up to date once, and the tiers then run', async ($, on) => {
  const statusCalls: string[] = []
  const listCalls: string[] = []
  const clock = world(on, { statusCalls, listCalls })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await settleAll()
  const before = { status: statusCalls.length, list: listCalls.length }
  await openCockpit($)
  await settleAll()
  expect(statusCalls.length).toBe(before.status + 1)
  expect(listCalls.length).toBe(before.list + 1)
  await clock.advance(10_000)
  await settleAll()
  expect(statusCalls.length).toBeGreaterThan(before.status + 1)
})

test('refresh cost: git and the done-claim log are read at the end of a main round, never of a subagent turn', async ($, on) => {
  const statusCalls: string[] = []
  const claimReads: string[] = []
  let mtime = 1
  world(on, { statusCalls, claimReads, doneClaims: 'x', claimsMtime: () => mtime })
  spawns(on)
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await spawnAgent($, 'reviewer')
  await settleAll()
  const git = statusCalls.length
  const claims = claimReads.length
  mtime = 2
  await mainTurnEnd($, 'a1') // a subagent's turn
  await settleAll()
  expect(statusCalls.length).toBe(git)
  expect(claimReads.length).toBe(claims)
  await mainTurnEnd($)
  await settleAll()
  expect(statusCalls.length).toBe(git + 1)
  expect(claimReads.length).toBe(claims + 1)
})

test('refresh cost: while the pane is closed the slow tick reads the agents only while one runs, so the status line badge does not stay lit', async ($, on) => {
  const listCalls: string[] = []
  const clock = world(on, { listCalls })
  spawns(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await settleAll()
  await clock.advance(30_000)
  await settleAll()
  expect(listCalls).toHaveLength(0)
  await spawnAgent($, 'one')
  await clock.advance(30_000)
  await settleAll()
  expect(listCalls.length).toBeGreaterThan(0)
})

test('refresh cost: a workflow agent that never reports its end keeps the closed-pane tick only until its run has been silent too long', async ($, on) => {
  const listCalls: string[] = []
  const clock = world(on, { listCalls })
  spawns(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await spawnWorkflowAgent($, 'wf_1', 1)
  await clock.advance(10 * 60_000)
  await settleAll()
  const whileRunning = listCalls.length
  expect(whileRunning).toBeGreaterThan(0)
  await clock.advance(10 * 60_000) // past the silence limit: the agent and its run end
  await settleAll()
  const afterEnd = listCalls.length
  await clock.advance(10 * 60_000)
  await settleAll()
  expect(listCalls.length).toBe(afterEnd)
})
