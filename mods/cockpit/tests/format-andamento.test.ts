import { expect, test } from 'claude-code/testing'

import { andamento } from '../hooks/andamento'
import { INITIAL } from '../hooks/state'
import type { CockpitSnapshot } from '../types'

const snap = (over: Partial<CockpitSnapshot>): CockpitSnapshot => ({ ...INITIAL, ...over })

test('andamento: Given no measure, When it is read, Then no compact is due', () => {
  // Given / When
  const figures = andamento(snap({}))
  // Then
  expect(figures).toEqual({ isCompactDue: false })
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
