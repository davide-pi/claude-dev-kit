import { expect, test } from 'claude-code/testing'

import { finishAgent, openCockpit, roundHooks, spawnWorkflowAgent, spawns } from './cockpit-fixtures'
import { dataOf, world } from './cockpit-world'

type Logged = { kind: string; key?: string; round?: number; endRound?: number; lane?: number }

test('Given a workflow whose agents all finished in round 11, When the clock tick closes the run, Then its flow entry has endRound 11', { timeoutMs: 30_000 }, async ($, on) => {
  // Given: round 11 is open and the run's only agent spawned in it
  const writes = new Map<string, string>()
  const clock = world(on, { writes, dataFile: JSON.stringify({ roundSeq: 10 }) })
  spawns(on)
  roundHooks(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await openCockpit($)
  await $.turn.start({ text: 'go', turnId: 't11' })
  await spawnWorkflowAgent($, 'w1', 1)
  await finishAgent($, 'a1')
  // When
  await clock.advance(3000)
  // Then
  const log = (dataOf(writes)?.sessionLog ?? []) as Logged[]
  expect(log.find(e => e.kind === 'flow' && e.key === 'w1')).toMatchObject({ round: 11, endRound: 11, lane: 0 })
})
