import { expect, test } from 'claude-code/testing'

import {
  THRESHOLDS,
  agentCosts,
  detectBigResults,
  detectColdAfterIdle,
  detectCtxGrowth,
  detectDoneClaims,
  detectFailedCommands,
  detectHeavyAgents,
  detectOpusReadOnly,
  detectPermissionWait,
  detectRereads,
  detectWorkflow,
  isStalled,
  signalsOf,
} from '../hooks/signals'
import { emptyInsights } from '../hooks/insights'
import { INITIAL } from '../hooks/state'
import { NOW } from './format-fixtures'

const agent = (id: string, type: string, tokens: number, usd: number, model = 'claude-sonnet-5-5') => ({ id, type, model, tokens, usd })

test('heavy agent: over 150k tokens, or over 40% of the session cost; at the limit it holds', () => {
  expect(detectHeavyAgents([agent('a1', 'implementer', 150_000, 1)], 100)).toEqual([])
  expect(detectHeavyAgents([agent('a1', 'implementer', 150_001, 1)], 100)).toEqual([{ kind: 'heavyAgent', key: 'a1', label: 'implementer', n: 150_001 }])
  expect(detectHeavyAgents([agent('a2', 'reviewer', 1000, 40)], 100)).toEqual([])
  expect(detectHeavyAgents([agent('a2', 'reviewer', 1000, 41)], 100)).toHaveLength(1)
  // no session cost yet: only the tokens speak
  expect(detectHeavyAgents([agent('a3', 'x', 1000, 5)], undefined)).toEqual([])
  expect(detectHeavyAgents([agent('a3', 'x', 1000, 5)], 0)).toEqual([])
})

test('opus on a read-only agent type: Explore and the other readers; Opus on a writer, or a reader on Sonnet, is fine', () => {
  const list = [
    { id: 'a1', type: 'Explore', model: 'claude-opus-5-5' },
    { id: 'a2', type: 'implementer', model: 'claude-opus-5-5' },
    { id: 'a3', type: 'Explore', model: 'claude-sonnet-5-5' },
    { id: 'a4', type: 'code-reviewer', model: 'opus' },
    { id: 'a5', type: 'Explore' },
  ]
  expect(detectOpusReadOnly(list).map(s => s.key)).toEqual(['a1', 'a4'])
  expect(detectOpusReadOnly([])).toEqual([])
})

test('tool result over 20k characters: a result is kept as characters / 4 tokens, so 5001 tokens is over and 5000 is not', () => {
  expect(detectBigResults([{ tool: 'Read', arg: 'a.ts', tokens: 5000 }])).toEqual([])
  expect(detectBigResults([{ tool: 'Read', arg: 'a.ts', tokens: 5001 }])).toEqual([{ kind: 'bigResult', key: 'Read:a.ts', label: 'Read', n: 20_004 }])
  expect(detectBigResults(undefined)).toEqual([])
})

test('same file read three times: the count at the limit holds, under it does not', () => {
  expect(detectRereads({ '/w/a.ts': 2 })).toEqual([])
  expect(detectRereads({ '/w/a.ts': 3, '/w/b.ts': 1 })).toEqual([{ kind: 'reread', key: '/w/a.ts', label: 'a.ts', n: 3 }])
  expect(detectRereads(undefined)).toEqual([])
})

test('same command failed twice', () => {
  expect(detectFailedCommands({ 'npm test': 1 })).toEqual([])
  expect(detectFailedCommands({ 'npm test': 2 })).toEqual([{ kind: 'failedCommand', key: 'npm test', label: 'npm test', n: 2 }])
  expect(detectFailedCommands(undefined)).toEqual([])
})

test('cache under 50% after an idle gap over five minutes: both conditions, and only for the last round', () => {
  const cold = (over: object) => ({ ...emptyInsights(), rounds: 7, idleCold: { round: 7, share: 20, gapMs: 6 * 60_000 }, ...over })
  expect(detectColdAfterIdle(cold({}))).toEqual([{ kind: 'coldAfterIdle', key: '7', n: 20 }])
  expect(detectColdAfterIdle(cold({ idleCold: { round: 7, share: 50, gapMs: 6 * 60_000 } }))).toEqual([])
  expect(detectColdAfterIdle(cold({ idleCold: { round: 7, share: 20, gapMs: 5 * 60_000 } }))).toEqual([])
  expect(detectColdAfterIdle(cold({ rounds: 8 }))).toEqual([]) // a later round came back warm
  expect(detectColdAfterIdle(undefined)).toEqual([])
})

test('context +100k within three rounds: against the smallest of the three before; a compaction drop in between does not hide it', () => {
  expect(detectCtxGrowth([100_000, 150_000, 190_000])).toEqual([])
  expect(detectCtxGrowth([100_000, 150_000, 200_000])).toEqual([{ kind: 'ctxGrowth', key: '3', n: 100_000 }])
  expect(detectCtxGrowth([500_000, 20_000, 60_000, 130_000])).toEqual([{ kind: 'ctxGrowth', key: '4', n: 110_000 }])
  expect(detectCtxGrowth([1, 2])).toEqual([])
  expect(detectCtxGrowth([300_000])).toEqual([])
  expect(detectCtxGrowth(undefined)).toEqual([])
  // four rounds back is out of the window
  expect(detectCtxGrowth([10_000, 150_000, 160_000, 170_000, 180_000])).toEqual([])
})

test('two done-claim blocks', () => {
  expect(detectDoneClaims(1)).toEqual([])
  expect(detectDoneClaims(2)).toEqual([{ kind: 'doneClaims', key: 'claims', n: 2 }])
})

test('workflow: a stall (a run in flight silent over five minutes) or a round past three', () => {
  const run = (over: object) => ({ runId: 'r1', agents: [{ id: 'a1', isDone: false }], lastAt: NOW, round: 1, ...over })
  expect(detectWorkflow(run({}), NOW + 5 * 60_000)).toEqual([])
  expect(detectWorkflow(run({}), NOW + 5 * 60_000 + 1)).toEqual([{ kind: 'workflow', key: 'r1:stall', label: 'stall' }])
  expect(detectWorkflow(run({ round: 3 }), NOW)).toEqual([])
  expect(detectWorkflow(run({ round: 4 }), NOW)).toEqual([{ kind: 'workflow', key: 'r1:round', label: 'round', n: 4 }])
  expect(detectWorkflow(run({ round: 4 }), NOW + 6 * 60_000).map(s => s.label)).toEqual(['stall', 'round'])
  // a finished run, and a run whose agents are all done, are not stalled
  expect(detectWorkflow(run({ endedAt: NOW }), NOW + 10 * 60_000)).toEqual([])
  expect(isStalled(run({ agents: [{ id: 'a1', isDone: true }] }), NOW + 10 * 60_000)).toBe(false)
  expect(detectWorkflow(undefined, NOW)).toEqual([])
})

test('permission waiting over 60 seconds', () => {
  expect(detectPermissionWait({ kind: 'waiting', since: NOW }, NOW + 60_000)).toEqual([])
  expect(detectPermissionWait({ kind: 'waiting', since: NOW }, NOW + 60_001)).toEqual([{ kind: 'permissionWait', key: String(NOW), n: 60_001 }])
  expect(detectPermissionWait({ kind: 'working' }, NOW + 999_999)).toEqual([])
  expect(detectPermissionWait({ kind: 'waiting' }, NOW + 999_999)).toEqual([])
  expect(detectPermissionWait(undefined, NOW)).toEqual([])
})

test('agentCosts: a live agent priced from its counters, a finished one from its Cronologia row, never twice', () => {
  const live = { id: 'a1', type: 'implementer', status: 'running' as const, startedAt: 0, tokens: 10, model: 'claude-sonnet-5-5', usage: { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 } }
  const events = [
    { at: 1, kind: 'agent' as const, id: 'a1', text: 'implementer', usd: 99 },
    { at: 2, kind: 'agent' as const, id: 'a2', text: 'Explore', model: 'claude-haiku-5', tokens: 5, usd: 0.5, hit: 80 },
    { at: 3, kind: 'round' as const, usd: 1 },
  ]
  expect(agentCosts([live], events)).toEqual([
    { id: 'a1', type: 'implementer', model: 'claude-sonnet-5-5', tokens: 10, usd: 2, hit: 0 },
    { id: 'a2', type: 'Explore', model: 'claude-haiku-5', tokens: 5, usd: 0.5, hit: 80 },
  ])
})

test('signalsOf: every detector from the snapshot alone; a quiet snapshot has none, the thresholds block names every limit', () => {
  expect(signalsOf({ ...INITIAL, now: NOW })).toEqual([])
  const s = {
    ...INITIAL,
    now: NOW + 2 * 60_000,
    cost: { usd: 10 },
    agents: [{ id: 'a1', type: 'Explore', status: 'running' as const, startedAt: 0, tokens: 200_000, model: 'claude-opus-5-5' }],
    insights: { ...emptyInsights(), rounds: 3, reads: { '/w/a.ts': 4 }, failedCmds: { 'npm test': 2 } },
    ctxRounds: [10_000, 20_000, 30_000, 140_000],
    claudeState: { kind: 'waiting' as const, since: NOW },
  }
  expect(signalsOf(s).map(x => x.kind)).toEqual(['heavyAgent', 'opusReadOnly', 'reread', 'failedCommand', 'ctxGrowth', 'permissionWait'])
  expect(Object.keys(THRESHOLDS)).toEqual(expect.arrayContaining(['subagentTokens', 'resultChars', 'rereads', 'failedCommands', 'coldCachePct', 'idleGapMs', 'ctxGrowth', 'doneClaims', 'workflowRound', 'permissionWaitMs']))
})
