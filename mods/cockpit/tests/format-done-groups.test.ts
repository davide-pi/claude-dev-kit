import { expect, test } from 'claude-code/testing'

import { groupDone, logModel } from '../hooks/done-groups'
import type { DoneEvent } from '../hooks/done-groups'
import type { CockpitLogEntry } from '../types'

const ev = (at: number, kind: DoneEvent['kind'] = 'commit'): DoneEvent => ({ at, kind })
const round = (at: number, over: Partial<CockpitLogEntry> = {}): CockpitLogEntry => ({ at, kind: 'round', ...over })

test('groupDone: given events between rounds, when grouped, then each belongs to the round that ended it, boundary included, newest group first', () => {
  // Given
  const log = [round(100, { ms: 5_000, usd: 0.2 }), round(200, { ms: 9_000, usd: 0.4 })]
  const events = [ev(50), ev(100, 'test'), ev(150, 'agent'), ev(200, 'pr')]
  // When
  const groups = groupDone(events, log)
  // Then
  expect(groups.map(g => [g.round, g.at, g.ms, g.usd, g.events.map(e => e.at)])).toEqual([
    [2, 200, 9_000, 0.4, [200, 150]],
    [1, 100, 5_000, 0.2, [100, 50]],
  ])
})

test('groupDone: given events after the newest round, when grouped, then they make the open group first, with no round number', () => {
  // Given
  const log = [round(100)]
  // When
  const groups = groupDone([ev(90), ev(120), ev(130, 'agent')], log)
  // Then
  expect(groups.map(g => [g.key, g.isCurrent === true, g.round, g.at, g.events.map(e => e.at)])).toEqual([
    ['done:current', true, undefined, 130, [130, 120]],
    ['done:100', false, 1, 100, [90]],
  ])
})

test('groupDone: given no event after the newest round, when grouped, then there is no open group', () => {
  // Given / When
  const groups = groupDone([ev(50)], [round(100)])
  // Then
  expect(groups.some(g => g.isCurrent)).toBe(false)
})

test('groupDone: given no round at all, when grouped, then every event is in the open group; and nothing at all is no group', () => {
  // Given / When
  const groups = groupDone([ev(5), ev(9)], [])
  // Then
  expect(groups.map(g => [g.key, g.events.length])).toEqual([['done:current', 2]])
  expect(groupDone([], [])).toEqual([])
})

test('groupDone: given consecutive rounds without events, when grouped, then they merge into one row with their summed cost, and a lone one stays its round', () => {
  // Given
  const log = [round(100, { usd: 0.1 }), round(200, { usd: 0.1 }), round(300, { usd: 0.11 }), round(400, { usd: 0.5, ms: 1000 }), round(500, { usd: 0.7 })]
  // When
  const groups = groupDone([ev(350), ev(450)], log)
  // Then
  expect(groups.map(g => [g.key, g.round, g.chatOnly, g.events.length])).toEqual([
    ['done:500', 5, undefined, 1],
    ['done:400', 4, undefined, 1],
    ['done:300', undefined, 3, 0],
  ])
  expect(Math.round((groups[2]?.usd ?? 0) * 100)).toBe(31)
  // a single round with no events is not merged with anything
  expect(groupDone([ev(250)], [round(100), round(200), round(300)]).map(g => [g.round, g.chatOnly])).toEqual([[3, undefined], [undefined, 2]])
})

test('groupDone: given a round without a cost, when grouped, then the group has none; a merged run sums only the costs it has', () => {
  // Given / When
  const lone = groupDone([ev(50)], [round(100)])
  const merged = groupDone([], [round(100), round(200, { usd: 0.3 })])
  // Then
  expect(lone[0]?.usd).toBeUndefined()
  expect(merged[0]).toMatchObject({ chatOnly: 2, usd: 0.3 })
  expect(groupDone([], [round(1), round(2)])[0]?.usd).toBeUndefined()
})

test('groupDone: Given rounds with a prompt, files, waits, fails or tools but no events, When grouped, Then each is its own node and only the bare rounds merge', () => {
  // Given
  const log = [
    round(100, { prompt: 'a' }),
    round(200, { files: ['a.ts'] }),
    round(300, { waits: { n: 1, ms: 5 } }),
    round(400, { fails: { n: 1 } }),
    round(500, { tools: { Bash: 1 } }),
    round(600),
    round(700),
  ]
  // When
  const groups = groupDone([], log)
  // Then
  expect(groups.map(g => [g.key, g.chatOnly])).toEqual([['done:700', 2], ['done:500', undefined], ['done:400', undefined], ['done:300', undefined], ['done:200', undefined], ['done:100', undefined]])
})

test('groupDone: Given round entries with n, When grouped, Then the group round is n, not the position in the log', () => {
  // Given
  const log = [round(100, { n: 41 }), round(200, { n: 42 })]
  // When
  const groups = groupDone([ev(90), ev(190)], log)
  // Then
  expect(groups.map(g => g.round)).toEqual([42, 41])
})

test('groupDone: Given a commit with the runId of a flow, When grouped, Then it sits under that flow node and not under the main round', () => {
  // Given
  const log = [round(200, { n: 3 }), { at: 160, kind: 'flow' as const, key: 'wf_1' }]
  const events: DoneEvent[] = [{ at: 150, kind: 'commit', runId: 'wf_1' }, { at: 140, kind: 'agent', runId: 'wf_1' }, ev(130)]
  // When
  const groups = groupDone(events, log)
  // Then
  expect(groups.find(g => g.flow?.runId === 'wf_1')?.events.map(e => e.kind)).toEqual(['commit', 'agent'])
  expect(groups.find(g => g.round === 3)?.events.map(e => e.at)).toEqual([130])
})

test('groupDone: Given a live flow whose agents all run and appear as agent events, When grouped, Then the flow node has events', () => {
  // Given
  const open: CockpitLogEntry = { at: 500, kind: 'flow', key: 'wf_9' }
  // When
  const groups = groupDone([{ at: 490, kind: 'agent', runId: 'wf_9' }], [], open)
  // Then
  expect(groups.find(g => g.flow?.isLive)?.events).toHaveLength(1)
})

const entry = (at: number, kind: CockpitLogEntry['kind'], over: Partial<CockpitLogEntry> = {}): CockpitLogEntry => ({ at, kind, ...over })

test('logModel: Given entries with round 3 and 4, When modelled, Then two groups, newest round first, each holding its round entry and events', () => {
  // Given
  const log = [entry(10, 'round', { n: 3 }), entry(12, 'agent', { round: 3 }), entry(20, 'round', { n: 4 }), entry(22, 'commit', { round: 4 }), entry(23, 'test', { round: 4 })]
  // When
  const model = logModel(log)
  // Then
  expect(model.rounds.map(r => [r.n, r.entry?.at, r.events.map(e => e.at)])).toEqual([
    [4, 20, [23, 22]],
    [3, 10, [12]],
  ])
  expect(model.unattributed).toEqual([])
})

test('logModel: Given an entry with no round, When modelled, Then it is in unattributed', () => {
  // Given
  const log = [entry(10, 'round', { n: 1 }), entry(15, 'compact')]
  // When
  const model = logModel(log)
  // Then
  expect(model.unattributed.map(e => e.at)).toEqual([15])
  expect(model.rounds.map(r => r.n)).toEqual([1])
})

test('logModel: Given an event of a round with no round entry, When modelled, Then the group exists without an entry', () => {
  // Given
  const agent = entry(15, 'agent', { round: 7 })
  // When
  const model = logModel([agent])
  // Then
  expect(model.rounds).toEqual([{ n: 7, events: [agent] }])
})

test('logModel: Given a pre-v3 log, When modelled, Then rounds come from the round entries and every other entry is unattributed', () => {
  // Given
  const log = [entry(10, 'round', { n: 1 }), entry(12, 'agent'), entry(20, 'round'), entry(25, 'error')]
  // When
  const model = logModel(log)
  // Then
  expect(model.rounds.map(r => [r.n, r.events.length])).toEqual([[2, 0], [1, 0]])
  expect(model.unattributed.map(e => e.at)).toEqual([25, 12])
})

test('logModel: Given flows, When modelled, Then they carry the recorded rounds and lane, a flow with no lane has none, and the open one is live', () => {
  // Given
  const withLane = entry(30, 'flow', { key: 'a', text: 'build', round: 2, endRound: 4, lane: 1 })
  const bare = entry(20, 'flow', { key: 'b' })
  const open = entry(40, 'flow', { key: 'c', round: 5, lane: 0 })
  // When
  const model = logModel([withLane, bare, entry(50, 'agent', { round: 2 })], open)
  // Then
  expect(model.flows).toEqual([
    { runId: 'c', startRound: 5, lane: 0, isLive: true },
    { runId: 'a', name: 'build', startRound: 2, endRound: 4, lane: 1, isLive: false },
    { runId: 'b', isLive: false },
  ])
  expect(model.flows[2]?.lane).toBeUndefined()
  expect(model.rounds.map(r => r.n)).toEqual([2])
})

test('logModel: Given an empty log, When modelled, Then all lists are empty', () => {
  // Given / When
  const model = logModel([])
  // Then
  expect(model).toEqual({ rounds: [], unattributed: [], flows: [] })
})
