import { expect, test } from 'claude-code/testing'

import { finishAgent, mainTurnEnd, roundHooks, spawnAgent, spawns } from './cockpit-fixtures'
import { dataOf, world } from './cockpit-world'

type Logged = { kind: string; key?: string; round?: number }

test('Given a step event before the spawn and round 3 open, When the agent spawns in round 3 and ends in round 5, Then its log entry carries round 3', { timeoutMs: 30_000 }, async ($, on) => {
  // Given: the session resumed after round 2; the agent's first step outran its spawn (no round open yet)
  const writes = new Map<string, string>()
  const clock = world(on, { writes, dataFile: JSON.stringify({ roundSeq: 2 }) })
  spawns(on)
  roundHooks(on)
  on('turn.step', async function* (_, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  for await (const chunk of $.turn.step({ turnId: 't', index: 0, model: 'claude-sonnet-5-5', messageCount: 1, agentId: 'a1' })) void chunk
  // When: round 3 opens and the agent spawns in it; rounds 3 and 4 end; the agent ends while round 5 is open
  await $.turn.start({ text: 'go', turnId: 't3' })
  await spawnAgent($, 'implementer')
  await mainTurnEnd($)
  await $.turn.start({ text: 'next', turnId: 't4' })
  await mainTurnEnd($)
  await $.turn.start({ text: 'again', turnId: 't5' })
  await finishAgent($, 'a1')
  await clock.advance(3000)
  // Then
  const log = (dataOf(writes)?.sessionLog ?? []) as Logged[]
  expect(log.find(e => e.kind === 'agent' && e.key === 'a1')?.round).toBe(3)
})
