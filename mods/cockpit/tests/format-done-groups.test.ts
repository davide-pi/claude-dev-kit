import { expect, test } from 'claude-code/testing'

import { groupDone } from '../hooks/done-groups'
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
