import { expect, test } from 'claude-code/testing'

import { creditProjection, modelRows, perHour, roundCosts, topRounds } from '../hooks/costs'
import { workItemIds, workItemUrl } from '../hooks/links'
import { cacheHit, usdOf } from '../hooks/pricing'
import { EVENTS_KEEP, recordAgentEvent, recordEvent } from '../hooks/timeline'
import { NOW } from './format-fixtures'

const MILLION = { input: 1_000_000, output: 1_000_000, cacheRead: 1_000_000, cacheWrite: 1_000_000 }

test('usdOf: list prices per family (current generation), a cache write a quarter more than the input; unknown models are priced as Sonnet', () => {
  expect(usdOf('claude-opus-5-5', { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 })).toBe(4)
  expect(usdOf('claude-opus-5-5', { input: 0, output: 1_000_000, cacheRead: 0, cacheWrite: 0 })).toBe(20)
  expect(Math.round(usdOf('claude-haiku-5', { input: 1_000_000, output: 1_000_000, cacheRead: 0, cacheWrite: 0 }) * 1e6)).toBe(600_000)
  expect(Math.round(usdOf('claude-sonnet-5-5', MILLION) * 1e6)).toBe(Math.round((2 + 10 + 0.2 + 2.5) * 1e6))
  expect(usdOf('mystery', { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 })).toBe(2)
  expect(usdOf(undefined, undefined)).toBe(0)
})

test('cacheHit: the share of the input a cache served, none without input', () => {
  expect(cacheHit({ input: 100, output: 5, cacheRead: 300, cacheWrite: 100 })).toBe(60)
  expect(cacheHit({ input: 0, output: 5, cacheRead: 0, cacheWrite: 0 })).toBeUndefined()
  expect(cacheHit(undefined)).toBeUndefined()
})

test('recordEvent: oldest first, a key seen again is not added, a row older than the newest takes its place by time', () => {
  let list = recordEvent(undefined, { at: 10, kind: 'agent', text: 'commit' })
  list = recordEvent(list, { at: 30, kind: 'round', key: 'k1', text: 'unproven-row' })
  list = recordEvent(list, { at: 30, kind: 'round', key: 'k1', text: 'again' })
  expect(list.map(e => e.text)).toEqual(['commit', 'unproven-row'])
  list = recordEvent(list, { at: 20, kind: 'round', key: 'k0', text: 'older' })
  expect(list.map(e => e.at)).toEqual([10, 20, 30])
  // the same key under another kind is another row
  expect(recordEvent(list, { at: 40, kind: 'agent', key: 'k1' })).toHaveLength(4)
})

test('recordEvent: a ring buffer of 300, the oldest go first', () => {
  let list = recordEvent(undefined, { at: 0, kind: 'round' })
  for (let i = 1; i < EVENTS_KEEP + 50; i++) list = recordEvent(list, { at: i, kind: 'round', usd: i })
  expect(list).toHaveLength(EVENTS_KEEP)
  expect(list[0]?.at).toBe(50)
  expect(list.at(-1)?.at).toBe(EVENTS_KEEP + 49)
})

test('recordAgentEvent: an agent that ended twice is one row', () => {
  let list = recordEvent(undefined, { at: 1, kind: 'round', usd: 1 })
  list = recordAgentEvent(list, { at: 3, kind: 'agent', id: 'a1', usd: 1 })
  list = recordAgentEvent(list, { at: 4, kind: 'agent', id: 'a1', usd: 2 })
  expect(list.map(e => e.kind)).toEqual(['round', 'agent'])
  expect(list.filter(e => e.kind === 'agent').map(e => e.usd)).toEqual([2])
})

test('roundCosts and topRounds: the rounds with a cost, the three dearest first, the earlier round on a tie', () => {
  const events = [1, 5, 3, 5, 2].map((usd, i) => ({ at: i, kind: 'round' as const, key: String(i + 1), usd, ms: 1000 }))
  const rounds = roundCosts([...events, { at: 9, kind: 'agent' as const, text: 'x' }])
  expect(rounds.map(r => r.usd)).toEqual([1, 5, 3, 5, 2])
  expect(topRounds(rounds).map(r => r.n)).toEqual([2, 4, 3])
  expect(roundCosts(undefined)).toEqual([])
})

test('perHour: the cost over the session so far, none before a minute', () => {
  expect(perHour(6, NOW, NOW + 30 * 60_000)).toBe(12)
  expect(perHour(6, NOW, NOW + 59_000)).toBeUndefined()
  expect(perHour(undefined, NOW, NOW + 3_600_000)).toBeUndefined()
  expect(perHour(6, undefined, NOW + 3_600_000)).toBeUndefined()
})

test('creditProjection: the 5h credits run out before the reset at the pace so far, else they hold; none without a reading', () => {
  const reset = (msFromNow: number) => new Date(NOW + msFromNow).toISOString()
  const H = 3_600_000
  // 2h into the window with 80% used: 20% left lasts 30 minutes, the reset is 3h away
  const out = creditProjection([{ kind: 'five_hour', percentUsed: 80, resetsAt: reset(3 * H) }], NOW)
  expect(out).toEqual({ kind: 'runOut', inMs: 0.5 * H, resetsAt: NOW + 3 * H })
  // 2h in with 20% used: 80% left lasts 8h, past the reset
  expect(creditProjection([{ kind: 'five_hour', percentUsed: 20, resetsAt: reset(3 * H) }], NOW)).toEqual({ kind: 'hold' })
  expect(creditProjection([{ kind: 'five_hour', percentUsed: 0, resetsAt: reset(3 * H) }], NOW)).toBeUndefined()
  expect(creditProjection([{ kind: 'five_hour', percentUsed: 50 }], NOW)).toBeUndefined()
  expect(creditProjection([{ kind: 'seven_day', percentUsed: 50, resetsAt: reset(H) }], NOW)).toBeUndefined()
  expect(creditProjection([{ kind: 'five_hour', percentUsed: 50, resetsAt: reset(-H) }], NOW)).toBeUndefined()
})

test('modelRows: the counters per model priced and ranked, dearest first', () => {
  const rows = modelRows({
    'claude-haiku-5': { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 },
    'claude-opus-5-5': { input: 1_000_000, output: 0, cacheRead: 1_000_000, cacheWrite: 0 },
  })
  expect(rows.map(r => r.model)).toEqual(['claude-opus-5-5', 'claude-haiku-5'])
  expect(rows[0]?.hit).toBe(50)
  expect(modelRows(undefined)).toEqual([])
})

test('workItemIds and workItemUrl: AB# ids of the branch and the PR titles, once each; a URL needs the org and the project', () => {
  const s = { git: { branch: 'feature/AB#512-reports' }, prs: [{ number: 1, title: 'Fix AB#512 and AB#7' }, { number: 2, title: 'none' }] } as Parameters<typeof workItemIds>[0]
  expect(workItemIds(s)).toEqual([512, 7])
  expect(workItemIds({})).toEqual([])
  expect(workItemUrl({ isMapped: true, org: 'contoso', project: 'My Proj' }, 7)).toBe('https://dev.azure.com/contoso/My%20Proj/_workitems/edit/7')
  expect(workItemUrl({ isMapped: true, org: 'https://dev.azure.com/contoso/', project: 'P' }, 7)).toBe('https://dev.azure.com/contoso/P/_workitems/edit/7')
  expect(workItemUrl({ isMapped: true, org: 'contoso' }, 7)).toBeUndefined()
  expect(workItemUrl(undefined, 7)).toBeUndefined()
})
