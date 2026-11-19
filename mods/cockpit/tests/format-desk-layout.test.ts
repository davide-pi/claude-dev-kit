import { expect, test } from 'claude-code/testing'

import { DESK_BAR_MAX, DESK_BAR_MIN, DESK_MIN_COLUMNS, DESK_MIN_ROWS, deskLayout, limitRows } from '../hooks/desk-layout'

test('Given more rows than the limit, When limitRows runs, Then it keeps limit rows with the more row last, counting the rest', () => {
  // Given
  const rows = ['a', 'b', 'c', 'd', 'e']
  // When
  const cut = limitRows(rows, 3, n => `+${n}`)
  // Then
  expect(cut).toEqual(['a', 'b', '+3'])
})

test('Given as many rows as the limit or fewer, When limitRows runs, Then every row is kept and no more row', () => {
  // Given
  const [full, few] = [['a', 'b', 'c'], ['a']]
  // When
  const [a, b] = [limitRows(full, 3, n => `+${n}`), limitRows(few, 3, n => `+${n}`)]
  // Then
  expect(a).toEqual(['a', 'b', 'c'])
  expect(b).toEqual(['a'])
})

test('Given 55 and 56 columns, When deskLayout runs, Then 55 is narrow and 56 is medium', () => {
  // Given
  const widths = [55, 56]
  // When
  const [a, b] = widths.map(w => deskLayout(w, 30))
  // Then
  expect(a?.size).toBe('narrow')
  expect(a?.gaugeSize).toBe(72)
  expect(b?.size).toBe('medium')
  expect(b?.gaugeSize).toBe(96)
})

test('Given 109 and 110 columns, When deskLayout runs, Then 109 is medium and 110 is wide', () => {
  // Given
  const widths = [109, 110]
  // When
  const [a, b] = widths.map(w => deskLayout(w, 30))
  // Then
  expect(a?.size).toBe('medium')
  expect(a?.nowColumns).toBe(1)
  expect(b?.size).toBe('wide')
  expect(b?.gaugeSize).toBe(120)
  expect(b?.nowColumns).toBe(2)
})

test('Given 0, NaN, negative or a width below the minimum, When deskLayout runs, Then columns is 28 and size narrow', () => {
  // Given
  const widths = [0, Number.NaN, -40, 10]
  // When
  const layouts = widths.map(w => deskLayout(w, 30))
  // Then
  for (const layout of layouts) {
    expect(layout.columns).toBe(DESK_MIN_COLUMNS)
    expect(layout.size).toBe('narrow')
    expect(layout.barWidth).toBe(DESK_BAR_MIN)
  }
})

test('Given Infinity columns, When deskLayout runs, Then it falls back to the minimum width', () => {
  // Given
  const width = Number.POSITIVE_INFINITY
  // When
  const layout = deskLayout(width, 30)
  // Then
  expect(layout.columns).toBe(DESK_MIN_COLUMNS)
  expect(layout.size).toBe('narrow')
})

test('Given growing widths, When deskLayout runs, Then barWidth never decreases and stays within its bounds', () => {
  // Given
  const widths = Array.from({ length: 300 }, (_, i) => i)
  // When
  const bars = widths.map(w => deskLayout(w, 30).barWidth)
  // Then
  bars.forEach((bar, i) => {
    expect(bar).toBeGreaterThanOrEqual(DESK_BAR_MIN)
    expect(bar).toBeLessThanOrEqual(DESK_BAR_MAX)
    if (i > 0) expect(bar).toBeGreaterThanOrEqual(bars[i - 1] ?? 0)
  })
  expect(bars[bars.length - 1]).toBe(DESK_BAR_MAX)
})

test('Given bodyRows below 8, NaN or Infinity, When deskLayout runs, Then bodyRows is 8; Given 8 or more, Then it is kept', () => {
  // Given
  const rows = [7, 0, -3, Number.NaN, Number.POSITIVE_INFINITY, 8, 40]
  // When
  const results = rows.map(r => deskLayout(80, r).bodyRows)
  // Then
  expect(results).toEqual([DESK_MIN_ROWS, DESK_MIN_ROWS, DESK_MIN_ROWS, DESK_MIN_ROWS, DESK_MIN_ROWS, 8, 40])
})
