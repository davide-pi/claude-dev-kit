import { expect, test } from 'claude-code/testing'

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
  list = recordEvent(list, { at: 30, kind: 'agent', key: 'k1', text: 'unproven-row' })
  list = recordEvent(list, { at: 30, kind: 'agent', key: 'k1', text: 'again' })
  expect(list.map(e => e.text)).toEqual(['commit', 'unproven-row'])
  list = recordEvent(list, { at: 20, kind: 'agent', key: 'k0', text: 'older' })
  expect(list.map(e => e.at)).toEqual([10, 20, 30])
})

test('recordEvent: a ring buffer of 300, the oldest go first', () => {
  let list = recordEvent(undefined, { at: 0, kind: 'agent' })
  for (let i = 1; i < EVENTS_KEEP + 50; i++) list = recordEvent(list, { at: i, kind: 'agent', usd: i })
  expect(list).toHaveLength(EVENTS_KEEP)
  expect(list[0]?.at).toBe(50)
  expect(list.at(-1)?.at).toBe(EVENTS_KEEP + 49)
})

test('recordAgentEvent: an agent that ended twice is one row', () => {
  let list = recordEvent(undefined, { at: 1, kind: 'agent', id: 'other', usd: 1 })
  list = recordAgentEvent(list, { at: 3, kind: 'agent', id: 'a1', usd: 1 })
  list = recordAgentEvent(list, { at: 4, kind: 'agent', id: 'a1', usd: 2 })
  expect(list.map(e => e.kind)).toEqual(['agent', 'agent'])
  expect(list.map(e => e.usd)).toEqual([1, 2])
})

test('workItemIds and workItemUrl: AB# ids of the PR titles only (not the branch), once each; a URL needs the org and the project', () => {
  const s = { git: { branch: 'feature/AB#99-reports' }, prs: [{ number: 1, title: 'Fix AB#512 and AB#7' }, { number: 2, title: 'none' }, { number: 3, title: 'AB#512 again' }] } as Parameters<typeof workItemIds>[0]
  expect(workItemIds(s)).toEqual([512, 7])
  expect(workItemIds({})).toEqual([])
  expect(workItemUrl({ isMapped: true, org: 'contoso', project: 'My Proj' }, 7)).toBe('https://dev.azure.com/contoso/My%20Proj/_workitems/edit/7')
  expect(workItemUrl({ isMapped: true, org: 'https://dev.azure.com/contoso/', project: 'P' }, 7)).toBe('https://dev.azure.com/contoso/P/_workitems/edit/7')
  expect(workItemUrl({ isMapped: true, org: 'contoso' }, 7)).toBeUndefined()
  expect(workItemUrl(undefined, 7)).toBeUndefined()
})
