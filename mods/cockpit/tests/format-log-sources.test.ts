import { expect, test } from 'claude-code/testing'

import type { CockpitSnapshot } from '../types'
import { withHistoryAgents } from '../hooks/agents'
import { emptyInsights } from '../hooks/insights'
import { withLoggedSignals, withSignalTimes } from '../hooks/signals'
import { INITIAL } from '../hooks/state'

const NOW = 1_800_000_000_000
const hist = (id: string, endedAt: number) => ({ id, type: 'code-reviewer', model: 'claude-sonnet-5-5', effort: 'high', startedAt: endedAt - 60_000, endedAt, tokens: 100, isFailed: false, usd: 0.25 })

test('withHistoryAgents: Given a log saved before agent entries and its history, When loaded, Then each agent of the history becomes an agent entry at its end', () => {
  // Given
  const log = [{ at: NOW - 10_000, kind: 'round' as const, ms: 5000 }]
  // When
  const out = withHistoryAgents(log, [hist('a1', NOW - 20_000), hist('a2', NOW - 5_000)])
  // Then
  expect(out?.map(e => [e.kind, e.key, e.at])).toEqual([['agent', 'a1', NOW - 20_000], ['round', undefined, NOW - 10_000], ['agent', 'a2', NOW - 5_000]])
  expect(out?.[0]).toMatchObject({ text: 'code-reviewer', model: 'claude-sonnet-5-5', effort: 'high', usd: 0.25, ms: 60_000, isFailed: false })
})

test('withHistoryAgents: Given a log that already holds an agent entry, When loaded, Then it stays as it was', () => {
  // Given
  const log = [{ at: NOW - 10_000, kind: 'agent' as const, key: 'a9', text: 'implementer' }]
  // When / Then
  expect(withHistoryAgents(log, [hist('a1', NOW - 20_000)])).toBe(log)
  expect(withHistoryAgents(undefined, [])).toBeUndefined()
})

test('withLoggedSignals: Given a signal first seen at a time of its own, When logged later, Then its entry carries the time it first held', () => {
  // Given: a command failed twice, seen at NOW - 30 s
  const s: CockpitSnapshot = { ...INITIAL, now: NOW, insights: { ...emptyInsights(), failedCmds: { 'npm test': 2 } } }
  const seen = withSignalTimes(s, NOW - 30_000)
  // When
  const logged = withLoggedSignals(seen, NOW)
  // Then
  expect(logged.sessionLog?.filter(e => e.kind === 'signal').map(e => [e.key, e.at])).toEqual([['failedCommand:npm test', NOW - 30_000]])
})
