import { expect, test } from 'claude-code/testing'

import { subagentShare } from '../hooks/agents'
import {
  CALLS_KEEP,
  emptyInsights,
  insightHints,
  readPathOf,
  recordCall,
  recordCompaction,
  recordCtxAfter,
  recordRoundEnd,
  recordToolCall,
  recordWait,
  resultTokens,
  withContextReading,
  roundCost,
  timeSplit,
  toolArg,
} from '../hooks/insights'
import { INITIAL } from '../hooks/state'

test('toolArg: the short argument of a tool call, one line, a file by its name; none when the call carries nothing to show', () => {
  expect(toolArg({ tool: 'Bash', command: 'git  status\n  --short' })).toBe('git status --short')
  expect(toolArg({ tool: 'Read', file_path: '/w/src/orders/Filter.ts' })).toBe('Filter.ts')
  expect(toolArg({ tool: 'Edit', file_path: 'C:\\w\\x.ts', old_string: 'a' })).toBe('x.ts')
  expect(toolArg({ tool: 'Grep', pattern: 'Order' })).toBe('Order')
  expect(toolArg({ tool: 'WebFetch', url: 'https://example.org/a' })).toBe('https://example.org/a')
  expect(toolArg({ tool: 'Agent', description: 'Find the DTOs', prompt: 'long' })).toBe('Find the DTOs')
  expect(toolArg({ tool: 'TodoWrite', todos: [] })).toBeUndefined()
  expect(toolArg({ tool: 'Bash', command: '   ' })).toBeUndefined()
  expect(toolArg({ tool: 'Bash', command: 'x'.repeat(500) })?.length).toBe(120)
})

test('recordCall keeps the last eight calls, newest last', () => {
  let calls = recordCall(undefined, { tool: 'Bash', isOk: true, at: 0 })
  expect(calls).toEqual([{ tool: 'Bash', isOk: true, at: 0 }])
  for (let i = 1; i <= 9; i++) calls = recordCall(calls, { tool: 'Read', arg: String(i), isOk: i % 2 === 0, at: i })
  expect(CALLS_KEEP).toBe(8)
  expect(calls).toHaveLength(8)
  expect(calls.map(c => c.arg)).toEqual(['2', '3', '4', '5', '6', '7', '8', '9'])
})

test('toolArg: a search shows its pattern before the folder it looks in', () => {
  expect(toolArg({ tool: 'Grep', pattern: 'Order', path: '/w/src' })).toBe('Order')
  expect(toolArg({ tool: 'Glob', pattern: '**/*.ts', path: '/w/src' })).toBe('**/*.ts')
  expect(toolArg({ tool: 'Grep', path: '/w/src' })).toBe('src')
  expect(toolArg({ tool: 'Read', file_path: '/w/a.ts' })).toBe('a.ts')
})

test('insights: a round counts its cost where measured, its length and cache hit, and keeps the dearest; the cache hits are the last twenty', () => {
  expect(roundCost({ usd: 5, startUsd: 4.5 })).toBe(0.5)
  expect(roundCost({ usd: 5 })).toBeUndefined()
  expect(roundCost({ usd: 4, startUsd: 5 })).toBeUndefined()
  let ins = recordRoundEnd(undefined, { usd: 0.4, ms: 60_000, cacheShare: 90 })
  ins = recordRoundEnd(ins, { usd: 1.2, ms: 240_000, cacheShare: 40 })
  ins = recordRoundEnd(ins, { ms: 5000 })
  ins = recordRoundEnd(ins, { usd: 0.3, ms: 1000, cacheShare: 70 })
  expect(ins).toMatchObject({ rounds: 4, roundMs: 306_000, costliest: { usd: 1.2, ms: 240_000 }, cacheShares: [90, 40, 70] })
  expect(Math.round(ins.usd * 100)).toBe(190)
  for (let i = 0; i < 25; i++) ins = recordRoundEnd(ins, { ms: 1, cacheShare: i })
  expect(ins.cacheShares).toHaveLength(20)
  expect(ins.cacheShares.at(-1)).toBe(24)
})

test('insights: tool calls are counted by tool with their failures and running time; a successful Read counts its file; names and files are capped', () => {
  let ins = recordToolCall(undefined, { tool: 'Bash', isOk: true, ms: 1000 })
  ins = recordToolCall(ins, { tool: 'Bash', isOk: false, ms: 500 })
  ins = recordToolCall(ins, { tool: 'Read', isOk: true, ms: 10, readPath: '/w/a.ts' })
  ins = recordToolCall(ins, { tool: 'Read', isOk: true, ms: 10, readPath: '/w/a.ts' })
  ins = recordToolCall(ins, { tool: 'Read', isOk: false, ms: 10, readPath: '/w/b.ts' })
  expect(ins.tools).toEqual({ Bash: { calls: 2, failed: 1 }, Read: { calls: 3, failed: 1 } })
  expect(ins.reads).toEqual({ '/w/a.ts': 2 })
  expect(ins.toolMs).toBe(1530)
  let capped = emptyInsights()
  for (let i = 0; i < 60; i++) capped = recordToolCall(capped, { tool: `t${i}`, isOk: true, ms: 0, readPath: `/f${i}` })
  expect(Object.keys(capped.tools)).toHaveLength(40)
  expect(Object.keys(capped.reads)).toHaveLength(60)
  for (let i = 0; i < 300; i++) capped = recordToolCall(capped, { tool: 't0', isOk: true, ms: 0, readPath: `/g${i}` })
  expect(Object.keys(capped.reads)).toHaveLength(200)
  expect(capped.tools.t0?.calls).toBe(301)
  expect(recordToolCall(capped, { tool: 'new', isOk: true, ms: 0 }).tools.new).toBeUndefined()
  expect(readPathOf({ tool: 'Read', file_path: ['', 'w', 'a.ts'].join(String.fromCharCode(92)) })).toBe('/w/a.ts')
  expect(readPathOf({ tool: 'Edit', file_path: '/w/a.ts' })).toBeUndefined()
  expect(readPathOf({ tool: 'Read' })).toBeUndefined()
})

test('insights: the permission waits and the compactions add up; the time splits into model, tools and waiting', () => {
  expect(timeSplit(emptyInsights())).toBeUndefined()
  let ins = recordRoundEnd(undefined, { ms: 100_000 })
  ins = recordToolCall(ins, { tool: 'Bash', isOk: true, ms: 30_000 })
  ins = recordWait(ins, 10_000)
  ins = recordWait(ins, -5)
  ins = recordCompaction(recordCompaction(ins))
  expect(ins).toMatchObject({ waitMs: 10_000, compactions: 2 })
  expect(timeSplit(ins)).toEqual({ model: 60_000, tools: 30_000, wait: 10_000, total: 100_000 })
  // tools that ran side by side can add up to more than the rounds: the total is then theirs
  expect(timeSplit(recordToolCall(ins, { tool: 'Bash', isOk: true, ms: 90_000 }))).toEqual({ model: 0, tools: 120_000, wait: 10_000, total: 130_000 })
})

test('insightHints: each hint shows only while its cause holds', () => {
  const base = { ...INITIAL, sessionId: 's' }
  expect(insightHints(base)).toEqual([])
  const reads = (n: number) => ({ ...emptyInsights(), reads: { '/w/src/a.ts': n, '/w/b.ts': 2 } })
  expect(insightHints({ ...base, insights: reads(5) })).toEqual([])
  expect(insightHints({ ...base, insights: reads(6) })).toEqual([{ kind: 'rereads', file: 'a.ts', count: 6 }])
  const shares = (list: number[]) => ({ ...emptyInsights(), cacheShares: list })
  expect(insightHints({ ...base, insights: shares([10, 20]) })).toEqual([])
  expect(insightHints({ ...base, insights: shares([90, 10, 20, 49]) })).toEqual([{ kind: 'coldCache' }])
  expect(insightHints({ ...base, insights: shares([10, 20, 50]) })).toEqual([])
  const failed = (n: number) => ({ ...emptyInsights(), tools: { Bash: { calls: 20, failed: n }, Read: { calls: 9, failed: 9 } } })
  expect(insightHints({ ...base, insights: failed(6) })).toEqual([])
  expect(insightHints({ ...base, insights: failed(7) })).toEqual([{ kind: 'failures', count: 7 }])
  // subagents over 60 % of the tokens: 600 of 1000 is not over, 610 is
  expect(subagentShare({ mainTokens: 400, agents: [], agentTokens: 600 })).toBe(60)
  expect(insightHints({ ...base, mainTokens: 400, agentTokens: 600 })).toEqual([])
  expect(insightHints({ ...base, mainTokens: 390, agentTokens: 610 })).toEqual([{ kind: 'subagents', share: 61 }])
  expect(subagentShare({ agents: [], mainTokens: undefined, agentTokens: undefined })).toBeUndefined()
  expect(insightHints({ ...base, lastRoundMs: 600_000 })).toEqual([])
  expect(insightHints({ ...base, lastRoundMs: 600_001 })).toEqual([{ kind: 'longRound', ms: 600_001 }])
})

// ── Cockpit v2 follow-ups ──

test('recordToolCall: keeps the five largest results (tool, argument, tokens), biggest first, and the last failure on one line', () => {
  let ins = recordToolCall(undefined, { tool: 'Read', isOk: true, ms: 0, arg: 'a.ts', tokens: 10 })
  for (const tokens of [50, 30, 40, 20, 60]) ins = recordToolCall(ins, { tool: 'Grep', isOk: true, ms: 0, tokens })
  expect(ins.biggest?.map(b => b.tokens)).toEqual([60, 50, 40, 30, 20])
  expect(ins.biggest?.[0]).toEqual({ tool: 'Grep', tokens: 60 })
  expect(recordToolCall(undefined, { tool: 'Bash', isOk: true, ms: 0, tokens: 0 }).biggest).toBeUndefined()
  expect(ins.lastError).toBeUndefined()
  ins = recordToolCall(ins, { tool: 'Bash', isOk: false, ms: 0, error: 'exit 1\n  boom   here ' })
  expect(ins.lastError).toEqual({ tool: 'Bash', text: 'exit 1 boom here' })
  expect(recordToolCall(ins, { tool: 'Bash', isOk: true, ms: 0 }).lastError).toEqual(ins.lastError)
  expect(recordToolCall(ins, { tool: 'Bash', isOk: false, ms: 0, error: 'x'.repeat(500) }).lastError?.text).toHaveLength(200)
})

test('resultTokens: the characters of the text over four, rounded up; the JSON of the result when there is no text', () => {
  expect(resultTokens({ text: 'x'.repeat(10) })).toBe(3)
  expect(resultTokens({ result: { a: 'xxxx' } })).toBe(3)
  expect(resultTokens({})).toBe(0)
})

test('recordCompaction / recordCtxAfter: the context before each compaction, the first reading after it, the last three', () => {
  let ins = recordCompaction(undefined, 400_000)
  expect(ins.compactCtx).toEqual([{ before: 400_000 }])
  expect(recordCtxAfter(ins, 400_000)).toBe(ins) // the reading the compaction started from
  expect(recordCtxAfter(ins, undefined)).toBe(ins)
  ins = recordCtxAfter(ins, 38_000) ?? ins
  expect(ins.compactCtx).toEqual([{ before: 400_000, after: 38_000 }])
  expect(recordCtxAfter(ins, 90_000)).toBe(ins) // only the first one
  for (const before of [1, 2, 3]) ins = recordCompaction(ins, before * 1000)
  expect(ins.compactCtx?.map(c => c.before)).toEqual([1000, 2000, 3000])
  expect(ins.compactions).toBe(4)
  expect(recordCompaction(undefined).compactCtx).toBeUndefined()
  expect(recordCtxAfter(undefined, 5)).toBeUndefined()
})

test('withContextReading: a fall of the context well past the threshold is one compaction, and the next reading is its after', () => {
  const snap = (tokens: number | undefined, insights?: ReturnType<typeof emptyInsights>) => ({ ctx: { tokens }, insights }) as unknown as Parameters<typeof withContextReading>[0]
  const first = withContextReading(snap(300_000), 100_000)
  expect(first.insights?.compactions).toBe(1)
  expect(first.insights?.compactCtx?.at(-1)?.before).toBe(300_000)
  expect(withContextReading(snap(100_000, first.insights as never), 120_000).insights?.compactions).toBe(1)
  expect(withContextReading(snap(300_000), 290_000).insights?.compactions).toBeUndefined()
})
