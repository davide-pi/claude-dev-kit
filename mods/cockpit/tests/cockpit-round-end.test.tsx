import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { withLogged } from '../hooks/timeline'
import { finishAgent, mainTurnEnd, openCockpit, roundHooks, spawnWorkflowAgent, spawns } from './cockpit-fixtures'
import { dataOf, world } from './cockpit-world'

type Logged = { kind: string; key?: string; round?: number; endRound?: number }
type Seen = { roundSeq: number; claudeState?: { kind: string } }

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

/** What a snapshot read answered, narrowed to the two fields the round logic reads. */
function seenIn(answer: unknown): Seen | undefined {
  const outer = isRecord(answer) ? answer.value : undefined
  const snap = isRecord(outer) ? outer.value : undefined
  if (!isRecord(snap) || typeof snap.roundSeq !== 'number') return undefined
  const kind = isRecord(snap.claudeState) ? snap.claudeState.kind : undefined
  return { roundSeq: snap.roundSeq, ...(typeof kind === 'string' && { claudeState: { kind } }) }
}

/** The snapshot the first read after the turn-end patch (the one that made round 3 the last one counted) answers: the state before the later setClaudeState call. */
async function snapshotAfterTurnEnd(on: On, $: Engine): Promise<Seen | undefined> {
  const seen: Seen[] = []
  let isEnding = false
  world(on, { dataFile: JSON.stringify({ roundSeq: 2 }) })
  roundHooks(on)
  on('state.get', async (_, e, next) => {
    const answer = await next(e)
    const read = isEnding ? seenIn(answer) : undefined
    if (read !== undefined) seen.push(read)
    return answer
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'go', turnId: 't3' })
  isEnding = true
  await mainTurnEnd($)
  return seen.find(s => s.roundSeq === 3)
}

test('Given round 3 ends, When an entry is logged right after the turn-end patch, Then it has no round', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const after = await snapshotAfterTurnEnd(on, $)
  // When
  const logged = after && withLogged(after, { at: 1, kind: 'signal', key: 'x' })
  // Then
  expect(logged?.sessionLog?.find(e => e.key === 'x')).toBeDefined()
  expect(logged?.sessionLog?.find(e => e.key === 'x')?.round).toBeUndefined()
})

test('Given a turn end, When the single patch is applied, Then claudeState is idle', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const after = await snapshotAfterTurnEnd(on, $)
  // When
  const state = after?.claudeState
  // Then
  expect(state?.kind).toBe('idle')
})

test('Given round 3 open with a signal in force, When the main turn ends, Then the signal entry has round 3', { timeoutMs: 30_000 }, async ($, on) => {
  // Given: the context grew over the last rounds, so the turn end raises ctxGrowth
  const writes = new Map<string, string>()
  const clock = world(on, { writes, dataFile: JSON.stringify({ roundSeq: 2, ctxRounds: [100_000, 100_000, 100_000] }) })
  roundHooks(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'go', turnId: 't3' })
  // When
  await mainTurnEnd($)
  await clock.advance(3000)
  // Then
  const log = (dataOf(writes)?.sessionLog ?? []) as Logged[]
  expect(log.find(e => e.kind === 'signal' && e.key?.startsWith('ctxGrowth'))?.round).toBe(3)
})

test('Given an idle session, When a signal is logged, Then it has no round', { timeoutMs: 30_000 }, async ($, on) => {
  // Given: a round ended with a run's agent still working, so the main loop is idle
  const writes = new Map<string, string>()
  const clock = world(on, { writes })
  spawns(on)
  roundHooks(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await openCockpit($)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await spawnWorkflowAgent($, 'w1', 1)
  await mainTurnEnd($)
  // When: the run stays silent past the stall limit
  await clock.advance(11 * 60_000)
  // Then
  const log = (dataOf(writes)?.sessionLog ?? []) as Logged[]
  const signal = log.find(e => e.kind === 'signal' && e.key === 'workflow:w1:stall')
  expect(signal).toBeDefined()
  expect(signal?.round).toBeUndefined()
})

test('Given roundSeq 4 and a run whose agent finished, When turn.start closes it after round 5 ended, Then its flow entry has endRound 5', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const writes = new Map<string, string>()
  const clock = world(on, { writes, dataFile: JSON.stringify({ roundSeq: 4 }) })
  spawns(on)
  roundHooks(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'go', turnId: 't5' })
  await spawnWorkflowAgent($, 'w1', 1)
  await finishAgent($, 'a1')
  await mainTurnEnd($)
  // When
  await $.turn.start({ text: 'next', turnId: 't6' })
  await clock.advance(3000)
  // Then
  const log = (dataOf(writes)?.sessionLog ?? []) as Logged[]
  expect(log.find(e => e.kind === 'flow' && e.key === 'w1')?.endRound).toBe(5)
})

test('Given no roundSeq, When turn.start closes a run, Then the flow entry has no endRound', { timeoutMs: 30_000 }, async ($, on) => {
  // Given: the run spawned and finished while the main loop was idle, before any round
  const writes = new Map<string, string>()
  const clock = world(on, { writes })
  spawns(on)
  roundHooks(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await spawnWorkflowAgent($, 'w1', 1)
  await finishAgent($, 'a1')
  // When
  await $.turn.start({ text: 'go', turnId: 't1' })
  await clock.advance(3000)
  // Then
  const log = (dataOf(writes)?.sessionLog ?? []) as Logged[]
  const flow = log.find(e => e.kind === 'flow' && e.key === 'w1')
  expect(flow).toBeDefined()
  expect(flow?.endRound).toBeUndefined()
})
