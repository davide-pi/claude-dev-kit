import { expect, test } from 'claude-code/testing'

import { DESK_MIN_COLUMNS, DESK_MIN_ROWS, deskLayout } from '../hooks/desk-layout'

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

test('Given bodyRows below 8, NaN or Infinity, When deskLayout runs, Then bodyRows is 8; Given 8 or more, Then it is kept', () => {
  // Given
  const rows = [7, 0, -3, Number.NaN, Number.POSITIVE_INFINITY, 8, 40]
  // When
  const results = rows.map(r => deskLayout(80, r).bodyRows)
  // Then
  expect(results).toEqual([DESK_MIN_ROWS, DESK_MIN_ROWS, DESK_MIN_ROWS, DESK_MIN_ROWS, DESK_MIN_ROWS, 8, 40])
})
