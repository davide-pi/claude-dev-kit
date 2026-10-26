import { expect, test } from 'claude-code/testing'

import {
  HISTORY_KEEP,
  addHistory,
  addUsage,
  claudeStateSpans,
  historyTokens,
  newTokens,
  parseHistory,
  sessionTokens,
  settleUsage,
  stateAfterWait,
  toHistory,
  tokenShare,
  usageOf,
  withAgentTokens,
} from '../hooks/agents'
import { spanText } from '../hooks/shared'

const finished = (id: string, endedAt: number, extra: object = {}) => ({
  id,
  type: 'code-reviewer',
  model: 'claude-sonnet-5-5',
  status: 'done' as const,
  startedAt: endedAt - 60_000,
  endedAt,
  tokens: 1200,
  ...extra,
})

test('toHistory keeps a finished agent with its outcome; an agent seen only through its events is left out', () => {
  expect(toHistory(finished('a1', 5000))).toEqual({ id: 'a1', type: 'code-reviewer', model: 'claude-sonnet-5-5', startedAt: -55_000, endedAt: 5000, tokens: 1200, isFailed: false })
  expect(toHistory(finished('a2', 5000, { isFailed: true }))?.isFailed).toBe(true)
  expect(toHistory(finished('a2', 5000, { isInterrupted: true }))?.isInterrupted).toBe(true)
  expect(toHistory(finished('a2', 5000, { effort: 'high' }))?.effort).toBe('high')
  expect(toHistory(finished('a2', 5000, { description: 'Review the filter' }))?.description).toBe('Review the filter')
  expect(toHistory(finished('a2', 5000))).not.toHaveProperty('description')
  expect(toHistory(finished('a3', 5000, { type: '?' }))).toBeUndefined()
  expect(toHistory({ ...finished('a4', 5000), endedAt: undefined })).toBeUndefined()
})

test('addHistory puts the new entries first, replaces an id it already has and keeps HISTORY_KEEP of them', () => {
  const entry = (id: string) => ({ id, type: 't', startedAt: 0, endedAt: 1, tokens: 0, isFailed: false })
  expect(addHistory(undefined, [entry('a')]).map(e => e.id)).toEqual(['a'])
  expect(addHistory([entry('a'), entry('b')], [entry('c'), entry('b')]).map(e => e.id)).toEqual(['c', 'b', 'a'])
  const many = Array.from({ length: HISTORY_KEEP }, (_, i) => entry(`old${i}`))
  const next = addHistory(many, [entry('new')])
  expect(next.length).toBe(HISTORY_KEEP)
  expect(next[0]?.id).toBe('new')
  expect(next.at(-1)?.id).toBe(`old${HISTORY_KEEP - 2}`)
})

test('HISTORY_KEEP holds the 300 entries a session with workflows can reach', () => {
  expect(HISTORY_KEEP).toBeGreaterThanOrEqual(300)
})

test('parseHistory takes the entries with their fields from a parsed state file and drops the rest', () => {
  const ok = { id: 'a1', type: 'implementer', model: 'claude-sonnet-5-5', startedAt: 1, endedAt: 2, tokens: 30, isFailed: true }
  expect(parseHistory([ok, { id: 'a2', type: 'x', startedAt: 1, endedAt: 2 }])).toEqual([
    ok,
    { id: 'a2', type: 'x', model: undefined, startedAt: 1, endedAt: 2, tokens: 0, isFailed: false },
  ])
  expect(parseHistory([{ ...ok, isInterrupted: true }])).toEqual([{ ...ok, isInterrupted: true }])
  expect(parseHistory([{ ...ok, effort: 'high' }, { ...ok, effort: 3 }, { ...ok, effort: {} }]).map(h => h.effort)).toEqual(['high', 3, undefined])
  expect(parseHistory([{ ...ok, description: 'Review the filter' }])).toEqual([{ ...ok, description: 'Review the filter' }])
  expect(parseHistory([{ ...ok, description: 3 }])[0]).not.toHaveProperty('description')
  expect(parseHistory([{ id: 'a3', type: 'x', startedAt: 'now', endedAt: 2 }, null, 'text', { type: 'x' }])).toEqual([])
  expect(parseHistory('not a list')).toEqual([])
  expect(parseHistory(undefined)).toEqual([])
})

test('claudeStateSpans: an icon and a word per state, the tool by name, a long name cut', () => {
  expect(spanText(claudeStateSpans(undefined))).toContain('ready')
  expect(spanText(claudeStateSpans({ kind: 'idle' }))).toContain('ready')
  expect(spanText(claudeStateSpans({ kind: 'working' }))).toContain('working')
  expect(spanText(claudeStateSpans({ kind: 'thinking' }))).toContain('thinking')
  expect(spanText(claudeStateSpans({ kind: 'waiting' }))).toContain('waiting')
  expect(spanText(claudeStateSpans({ kind: 'tool', tool: 'Bash' }))).toContain('Bash')
  const long = spanText(claudeStateSpans({ kind: 'tool', tool: 'mcp__server__a_very_long_tool_name' }))
  expect(long.endsWith('…')).toBe(true)
  expect([...long].length).toBeLessThanOrEqual(16)
})

test('stateAfterWait: a tool still in flight wins (the held one when it is), else what the wait interrupted', () => {
  expect(stateAfterWait({ kind: 'tool', tool: 'Bash' }, ['Bash', 'Read'])).toEqual({ kind: 'tool', tool: 'Bash' })
  expect(stateAfterWait({ kind: 'tool', tool: 'Bash' }, ['Read'])).toEqual({ kind: 'tool', tool: 'Read' })
  expect(stateAfterWait({ kind: 'thinking' }, ['Read'])).toEqual({ kind: 'tool', tool: 'Read' })
  expect(stateAfterWait({ kind: 'tool', tool: 'Bash' }, [])).toEqual({ kind: 'working' })
  expect(stateAfterWait({ kind: 'thinking' }, [])).toEqual({ kind: 'thinking' })
  expect(stateAfterWait({ kind: 'waiting' }, [])).toEqual({ kind: 'working' })
  expect(stateAfterWait(undefined, [])).toEqual({ kind: 'working' })
})

test('usage counters: summed, new tokens leave the cache reads out, a turn total replaces its steps', () => {
  const step = usageOf({ input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 20 })
  expect(step).toEqual({ input: 10, output: 5, cacheRead: 100, cacheWrite: 20 })
  expect(newTokens(step)).toBe(35)
  expect(newTokens(undefined)).toBe(0)
  const two = addUsage(addUsage(undefined, step), step)
  expect(two).toEqual({ input: 20, output: 10, cacheRead: 200, cacheWrite: 40 })
  // an earlier turn's counters stay, the steps' part is swapped for the turn's own total
  const before = { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 }
  const total = addUsage(before, two)
  expect(settleUsage(total, two, { input: 21, output: 11, cacheRead: 201, cacheWrite: 41 })).toEqual({ input: 22, output: 12, cacheRead: 202, cacheWrite: 42 })
  expect(settleUsage(total, two, undefined)).toEqual(total)
  expect(settleUsage(undefined, undefined, step)).toEqual(step)
})

test('tokenShare and sessionTokens: the share of main, listed agents and the cumulative count of the agents that left the list', () => {
  const agent = (id: string, tokens: number) => ({ id, type: 't', status: 'running' as const, startedAt: 0, tokens })
  expect(sessionTokens({ mainTokens: 500, agents: [agent('a', 100), agent('b', 100)], agentTokens: 300 })).toBe(1000)
  expect(sessionTokens({ agents: [] })).toBe(0)
  expect(tokenShare(250, 1000)).toBe('25%')
  expect(tokenShare(2, 1000)).toBe('<1%')
  expect(tokenShare(0, 1000)).toBe('0%')
  expect(tokenShare(5, 0)).toBeUndefined()
  expect(tokenShare(1500, 1000)).toBe('100%')
})

test('withAgentTokens: the cumulative count grows by the tokens of the agents leaving the list, and stays absent until one does', () => {
  expect(withAgentTokens(undefined, [])).toBeUndefined()
  expect(withAgentTokens(200, [])).toBe(200)
  expect(withAgentTokens(undefined, [{ tokens: 100 }, { tokens: 50 }])).toBe(150)
  expect(withAgentTokens(200, [{ tokens: 50 }])).toBe(250)
})

test('historyTokens: the new tokens of the agents a history lists', () => {
  const h = (tokens: number) => ({ id: String(tokens), type: 't', startedAt: 0, endedAt: 1, tokens, isFailed: false })
  expect(historyTokens([h(3000), h(2000)])).toBe(5000)
  expect(historyTokens([])).toBeUndefined()
  expect(historyTokens(undefined)).toBeUndefined()
})
