import { expect, test } from 'claude-code/testing'

import { andamento, spendSplit } from '../hooks/andamento'
import { emptyInsights } from '../hooks/insights'
import { INITIAL } from '../hooks/state'
import { costTargetOf } from '../hooks/strings'
import type { CockpitAgent, CockpitSnapshot } from '../types'

const snap = (over: Partial<CockpitSnapshot>): CockpitSnapshot => ({ ...INITIAL, ...over })
const ONE_MILLION_INPUT = { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 }
/** A Sonnet agent whose usage costs $2 (list price: $2 per million input tokens). */
const agent = (id: string, type: string, status: CockpitAgent['status']): CockpitAgent => ({ id, type, status, startedAt: 0, tokens: 0, model: 'claude-sonnet-5-5', usage: ONE_MILLION_INPUT })
const rounds = (n: number, usd: number) => ({ ...emptyInsights(), rounds: n, usd })

test('spendSplit: the main loop alone is the whole spend; no cost measured and no agent is no split', () => {
  expect(spendSplit(snap({ cost: { usd: 10 } }))).toEqual([{ label: 'main', usd: 10, pct: 100 }])
  expect(spendSplit(snap({}))).toEqual([])
})

test('spendSplit: the main loop is the total minus the agents; finished agents come from the accumulator, running ones are priced live, a finished one still listed is not counted twice', () => {
  const split = spendSplit(snap({ cost: { usd: 10 }, agentSpend: { implementer: 3, reviewer: 1 }, agents: [agent('a1', 'explorer', 'running'), agent('a2', 'implementer', 'done')] }))
  expect(split.map(p => [p.label, Math.round(p.usd * 100) / 100, Math.round(p.pct)])).toEqual([['main', 4, 40], ['implementer', 3, 30], ['explorer', 2, 20], ['reviewer', 1, 10]])
})

test('spendSplit: parts under 5% join one "other" part, last; the shares add up to 100', () => {
  const split = spendSplit(snap({ cost: { usd: 100 }, agentSpend: { big: 50, b: 3, c: 1 } }))
  expect(split.map(p => [p.label, p.usd])).toEqual([['big', 50], ['main', 46], ['other', 4]])
  expect(Math.round(split.reduce((n, p) => n + p.pct, 0))).toBe(100)
})

test('andamento: no round yet has no $/prompt, a flat trend and no compact due', () => {
  expect(andamento(snap({}))).toEqual({ trend: 'flat', isCompactDue: false })
})

test('andamento: $/prompt is the insights spend over its rounds; with a target the trend is against it (10% band), without one the last round against the mean', () => {
  const base = { insights: rounds(3, 6) }
  expect(andamento(snap({ ...base, costTarget: 1.5 }))).toMatchObject({ perPrompt: 2, target: 1.5, trend: 'up' })
  expect(andamento(snap({ ...base, costTarget: 2.1 })).trend).toBe('flat')
  expect(andamento(snap({ ...base, costTarget: 3 })).trend).toBe('down')
  expect(andamento(snap({ ...base, cost: { lastUsd: 3 } }))).toMatchObject({ perPrompt: 2, trend: 'up' })
  expect(andamento(snap({ ...base, cost: { lastUsd: 3 } }))).not.toHaveProperty('target')
  expect(andamento(snap({ ...base, cost: { lastUsd: 2 } })).trend).toBe('flat')
  expect(andamento(snap({ ...base, cost: { lastUsd: 1 } })).trend).toBe('down')
  expect(andamento(snap({ ...base })).trend).toBe('flat')
})

test('andamento: the agents\' share of the spend, and the turns left before autocompact', () => {
  expect(andamento(snap({ cost: { usd: 10 }, agentSpend: { x: 2.5 } })).agentPct).toBe(25)
  expect(andamento(snap({})).agentPct).toBeUndefined()
  expect(andamento(snap({ ctxSamples: [100_000, 110_000], autoCompactAt: 130_000 })).turnsLeft).toBe(2)
  expect(andamento(snap({ ctxSamples: [100_000, 110_000] })).turnsLeft).toBeUndefined()
})

test('andamento: a compact is due from 75% of the autocompact threshold, not at 74%', () => {
  const at = (tokens: number | undefined) => andamento(snap({ ctx: { tokens }, autoCompactAt: 200_000 })).isCompactDue
  expect(at(148_000)).toBe(false)
  expect(at(149_999)).toBe(false)
  expect(at(150_000)).toBe(true)
  expect(at(190_000)).toBe(true)
  expect(at(undefined)).toBe(false)
  expect(andamento(snap({ ctx: { tokens: 190_000 } })).isCompactDue).toBe(false)
})

test('costTargetOf: the positive number cockpit.json names; anything else is no target', () => {
  expect(costTargetOf('{"costTarget":1.5}')).toBe(1.5)
  expect(costTargetOf('{"costTarget":"1.5"}')).toBeUndefined()
  expect(costTargetOf('{"costTarget":0}')).toBeUndefined()
  expect(costTargetOf('{"costTarget":-2}')).toBeUndefined()
  expect(costTargetOf('{"lang":"it"}')).toBeUndefined()
  expect(costTargetOf('{ "costTarget": ')).toBeUndefined()
  expect(costTargetOf('')).toBeUndefined()
})
