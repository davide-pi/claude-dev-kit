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
  signalSeverity,
  signalsOf,
} from '../hooks/signals'
import { emptyInsights } from '../hooks/insights'
import { INITIAL } from '../hooks/state'
import { setLang, t } from '../hooks/strings'
import { NOW } from './format-fixtures'

const agent = (id: string, type: string, tokens: number, usd: number, model = 'claude-sonnet-5-5') => ({ id, type, model, tokens, usd })
/** 1M input tokens on Opus: $4, over the per-agent limit. */
const OPUS_4_USD = { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 }

test('heavyAgent: given an agent over $2 or over 40% of the session cost, when detected, then it fires with its cost; at either limit it holds', () => {
  // Given / When / Then: the absolute cost
  expect(detectHeavyAgents([agent('a1', 'implementer', 900_000, 2)], 100)).toEqual([])
  expect(detectHeavyAgents([agent('a1', 'implementer', 1000, 2.01)], 100)).toEqual([{ kind: 'heavyAgent', key: 'a1', label: 'implementer', n: 2.01 }])
  // the share of the session
  expect(detectHeavyAgents([agent('a2', 'reviewer', 1000, 0.4)], 1)).toEqual([])
  expect(detectHeavyAgents([agent('a2', 'reviewer', 1000, 0.41)], 1)).toHaveLength(1)
  // no session cost yet: only the absolute cost speaks
  expect(detectHeavyAgents([agent('a3', 'x', 1000, 1.5)], undefined)).toEqual([])
  expect(detectHeavyAgents([agent('a3', 'x', 1000, 1.5)], 0)).toEqual([])
  expect(detectHeavyAgents([agent('a3', 'x', 1000, 2.5)], undefined)).toHaveLength(1)
})

test('heavyAgent text: given a signal of $2.5, when written in English and Italian, then both name the cost in dollars with two decimals', () => {
  // Given
  const usd = 2.5
  // When
  setLang('it')
  const it = t().signalText.heavyAgent('implementer', usd).what
  setLang('en')
  const en = t().signalText.heavyAgent('implementer', usd).what
  // Then
  expect(en).toBe('subagent implementer costs $2.50 or too much of the spend')
  expect(it).toBe('il subagent implementer costa $2.50 o troppa parte della spesa')
})

test('heavyAgent text: given a signal saved before the dollars, holding 200000 tokens, when written, then it reads 200k tokens, never $200000.00', () => {
  // Given
  const tokens = 200_000
  // When
  setLang('it')
  const it = t().signalText.heavyAgent('implementer', tokens).what
  setLang('en')
  const en = t().signalText.heavyAgent('implementer', tokens).what
  // Then
  expect(en).toBe('subagent implementer weighs 200k tokens or too much of the spend')
  expect(it).toBe('il subagent implementer pesa 200k token o troppa parte della spesa')
})

test('heavyAgent: given an agent with many cumulative tokens but no cost, when detected, then it does not fire', () => {
  // Given
  const unpriced = { id: 'a4', type: 'implementer', tokens: 2_000_000 }
  // When
  const signals = detectHeavyAgents([unpriced], 100)
  // Then
  expect(signals).toEqual([])
})

test('opus on a read-only agent type: Explore and the other readers; Opus on a writer or a reviewer, or a reader on Sonnet, is fine', () => {
  const list = [
    { id: 'a1', type: 'Explore', model: 'claude-opus-5-5' },
    { id: 'a2', type: 'implementer', model: 'claude-opus-5-5' },
    { id: 'a3', type: 'Explore', model: 'claude-sonnet-5-5' },
    { id: 'a4', type: 'code-reviewer', model: 'opus' },
    { id: 'a5', type: 'Explore' },
  ]
  expect(detectOpusReadOnly(list).map(s => s.key)).toEqual(['a1'])
  expect(detectOpusReadOnly([])).toEqual([])
})

test('tool result over 20k characters: a result is kept as characters / 4 tokens, so 5001 tokens is over and 5000 is not', () => {
  expect(detectBigResults([{ tool: 'Read', arg: 'a.ts', tokens: 5000 }])).toEqual([])
  expect(detectBigResults([{ tool: 'Read', arg: 'a.ts', tokens: 5001 }])).toEqual([{ kind: 'bigResult', key: 'Read:a.ts', label: 'Read', n: 20_004 }])
  expect(detectBigResults(undefined)).toEqual([])
})

test('same file read four times: the count at the limit holds, under it does not', () => {
  expect(detectRereads({ '/w/a.ts': 3 })).toEqual([])
  expect(detectRereads({ '/w/a.ts': 4, '/w/b.ts': 1 })).toEqual([{ kind: 'reread', key: '/w/a.ts', label: 'a.ts', n: 4 }])
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

test('workflow: a stall (a run in flight silent over ten minutes) or a round past four', () => {
  const run = (over: object) => ({ runId: 'r1', agents: [{ id: 'a1', isDone: false }], lastAt: NOW, round: 1, ...over })
  expect(detectWorkflow(run({}), NOW + 10 * 60_000)).toEqual([])
  expect(detectWorkflow(run({}), NOW + 10 * 60_000 + 1)).toEqual([{ kind: 'workflow', key: 'r1:stall', label: 'stall' }])
  expect(detectWorkflow(run({ round: 4 }), NOW)).toEqual([])
  expect(detectWorkflow(run({ round: 5 }), NOW)).toEqual([{ kind: 'workflow', key: 'r1:round', label: 'round', n: 5 }])
  expect(detectWorkflow(run({ round: 5 }), NOW + 11 * 60_000).map(s => s.label)).toEqual(['stall', 'round'])
  // a finished run, and a run whose agents are all done, are not stalled
  expect(detectWorkflow(run({ endedAt: NOW }), NOW + 20 * 60_000)).toEqual([])
  expect(isStalled(run({ agents: [{ id: 'a1', isDone: true }] }), NOW + 20 * 60_000)).toBe(false)
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
    { at: 2, kind: 'agent' as const, id: 'a2', text: 'Explore', desc: 'Find the orders filter', model: 'claude-haiku-5', tokens: 5, usd: 0.5 },
  ]
  expect(agentCosts([live], events)).toEqual([
    { id: 'a1', type: 'implementer', model: 'claude-sonnet-5-5', tokens: 10, usd: 2 },
    { id: 'a2', type: 'Explore', model: 'claude-haiku-5', tokens: 5, usd: 0.5 },
  ])
})

test('agentCosts: a blank description is none, live or from the event, so the row falls back to the type', () => {
  const live = { id: 'a1', type: 'implementer', description: '  ', status: 'running' as const, startedAt: 0, tokens: 0 }
  const events = [{ at: 1, kind: 'agent' as const, id: 'a2', text: 'Explore', desc: '' }]
  expect(agentCosts([live], events).map(a => a.description)).toEqual([undefined, undefined])
})

test('signalsOf: the same big result read twice is one notification and a count of 1', () => {
  const biggest = [
    { tool: 'Read', arg: 'a.ts', tokens: 6000 },
    { tool: 'Read', arg: 'a.ts', tokens: 7000 },
  ]
  const found = signalsOf({ ...INITIAL, now: NOW, insights: { ...emptyInsights(), biggest } })
  expect(found.filter(x => x.kind === 'bigResult')).toHaveLength(1)
  expect(found).toHaveLength(1)
})

test('ctxGrowth: past the 20-round cap of the samples a new episode still has a new key, so it fires again', () => {
  const capped = Array.from({ length: 20 }, (_, i) => (i < 19 ? 10_000 : 140_000))
  const first = detectCtxGrowth(capped, 25)
  const second = detectCtxGrowth(capped, 26)
  expect(first).toHaveLength(1)
  expect(second).toHaveLength(1)
  expect(first[0]?.key).not.toBe(second[0]?.key)
})

test('signalsOf: every detector from the snapshot alone; a quiet snapshot has none, the thresholds block names every limit', () => {
  expect(signalsOf({ ...INITIAL, now: NOW })).toEqual([])
  const s = {
    ...INITIAL,
    now: NOW + 2 * 60_000,
    cost: { usd: 10 },
    agents: [{ id: 'a1', type: 'Explore', status: 'running' as const, startedAt: 0, tokens: 200_000, model: 'claude-opus-5-5', usage: OPUS_4_USD }],
    insights: { ...emptyInsights(), rounds: 3, reads: { '/w/a.ts': 4 }, failedCmds: { 'npm test': 2 } },
    ctxRounds: [10_000, 20_000, 30_000, 140_000],
    claudeState: { kind: 'waiting' as const, since: NOW },
  }
  expect(signalsOf(s).map(x => x.kind)).toEqual(['heavyAgent', 'opusReadOnly', 'reread', 'failedCommand', 'ctxGrowth', 'permissionWait'])
  expect(Object.keys(THRESHOLDS)).toEqual(expect.arrayContaining(['subagentUsd', 'subagentCostPct','resultChars', 'rereads', 'failedCommands', 'coldCachePct', 'idleGapMs', 'ctxGrowth', 'doneClaims', 'workflowRound', 'permissionWaitMs']))
})

test('signalSeverity: a permission wait and a workflow stall block; failed command, context growth, heavy agent, workflow round and done claims warn; the rest is info', () => {
  const sev = (kind: Parameters<typeof signalSeverity>[0]['kind'], label?: string) => signalSeverity({ kind, key: 'k', ...(label === undefined ? {} : { label }) })
  expect([sev('permissionWait'), sev('workflow', 'stall')]).toEqual(['block', 'block'])
  expect([sev('failedCommand'), sev('ctxGrowth'), sev('heavyAgent'), sev('workflow', 'round'), sev('doneClaims')]).toEqual(['warn', 'warn', 'warn', 'warn', 'warn'])
  expect([sev('reread'), sev('bigResult'), sev('opusReadOnly'), sev('coldAfterIdle')]).toEqual(['info', 'info', 'info', 'info'])
})

test('signalsOf: given agents of a workflow run on Opus and over the cost limit, when read, then they raise heavyAgent but not opusReadOnly; the same agents outside a run raise both', () => {
  // Given
  const heavyOpus = (id: string, runId?: string) => ({ id, type: 'Explore', model: 'claude-opus-5-5', tokens: 200_000, usage: OPUS_4_USD, status: 'running' as const, startedAt: 0, ...(runId !== undefined && { runId }) })
  const run = { runId: 'w1', agents: [{ id: 'a2', isDone: false }] }
  const inFlow = { ...INITIAL, now: NOW, agents: [heavyOpus('a1', 'w1')], workflowRun: run }
  const listedOnly = { ...INITIAL, now: NOW, agents: [heavyOpus('a2')], workflowRun: run }
  const outside = { ...INITIAL, now: NOW, agents: [heavyOpus('a3')] }
  // When
  const kinds = (s: typeof INITIAL) => signalsOf(s).map(x => x.kind).filter(k => k === 'heavyAgent' || k === 'opusReadOnly')
  // Then
  expect(kinds(inFlow)).toEqual(['heavyAgent'])
  expect(kinds(listedOnly)).toEqual(['heavyAgent'])
  expect(kinds(outside)).toEqual(['heavyAgent', 'opusReadOnly'])
})
