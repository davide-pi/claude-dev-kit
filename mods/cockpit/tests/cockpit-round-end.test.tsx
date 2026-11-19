import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import type { CockpitLogEntry } from '../types'
import { finishAgent, mainTurnEnd, openCockpit, roundHooks, spawnWorkflowAgent, spawns } from './cockpit-fixtures'
import { dataOf, world } from './cockpit-world'

type Seen = { roundSeq: number; claudeState?: { kind: string } }

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

const isEntry = (v: unknown): v is CockpitLogEntry => isRecord(v) && typeof v.at === 'number' && typeof v.kind === 'string'

/** The session log of the last data file written. */
const logOf = (writes: Map<string, string>): CockpitLogEntry[] => {
  const log = dataOf(writes)?.sessionLog
  return Array.isArray(log) ? log.filter(isEntry) : []
}

/** What a snapshot read answered, narrowed to the two fields the round logic reads. */
function seenIn(answer: unknown): Seen | undefined {
  // The `answer.value.value` shape is observed, not documented: a change of it fails these tests loudly (the read is never found).
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

test('Given a turn end, When the single patch is applied, Then claudeState is idle', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const after = await snapshotAfterTurnEnd(on, $)
  // When
  const state = after?.claudeState
  // Then
  expect(state?.kind).toBe('idle')
})

// regression guard: passes before the change too
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
  const log = logOf(writes)
  expect(log.find(e => e.kind === 'signal' && e.key?.startsWith('ctxGrowth'))?.round).toBe(3)
})

test('Given an idle session after round 1, When a signal is logged, Then it has round 1', { timeoutMs: 30_000 }, async ($, on) => {
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
  const log = logOf(writes)
  const signal = log.find(e => e.kind === 'signal' && e.key === 'workflow:w1:stall')
  expect(signal).toBeDefined()
  expect(signal?.round).toBe(1)
})

test('Given idle after round 3, When a run starts, Then startRound is 3 and it has a lane', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const writes = new Map<string, string>()
  const clock = world(on, { writes, dataFile: JSON.stringify({ roundSeq: 3 }) })
  spawns(on)
  roundHooks(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  // When: the run's agent spawns and ends while idle; the next turn closes the run
  await spawnWorkflowAgent($, 'w1', 1)
  await finishAgent($, 'a1')
  await $.turn.start({ text: 'go', turnId: 't4' })
  await clock.advance(3000)
  // Then
  const flow = logOf(writes).find(e => e.kind === 'flow' && e.key === 'w1')
  expect(flow?.round).toBe(3)
  expect(flow?.lane).toBeDefined()
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
  const log = logOf(writes)
  expect(log.find(e => e.kind === 'flow' && e.key === 'w1')?.endRound).toBe(5)
})

test('Given round entries in the log and no roundSeq, When turn.start closes a run, Then its flow entry ends on the last round of the log', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const writes = new Map<string, string>()
  const clock = world(on, { writes, dataFile: JSON.stringify({ sessionLog: [{ at: 1, kind: 'round', n: 1 }, { at: 2, kind: 'round', n: 2 }] }) })
  spawns(on)
  roundHooks(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await spawnWorkflowAgent($, 'w1', 1)
  await finishAgent($, 'a1')
  // When
  await $.turn.start({ text: 'go', turnId: 't3' })
  await clock.advance(3000)
  // Then
  expect(logOf(writes).find(e => e.kind === 'flow' && e.key === 'w1')?.endRound).toBe(2)
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
  const flow = logOf(writes).find(e => e.kind === 'flow' && e.key === 'w1')
  expect(flow).toBeDefined()
  expect(flow?.endRound).toBeUndefined()
})
