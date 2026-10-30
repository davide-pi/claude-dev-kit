import { expect, test } from 'claude-code/testing'

import {
  COLORS,
  ICONS,
  abbrevTokens,
  barCells,
  cacheColor,
  costCell,
  countdown,
  displayModel,
  duration,
  effortGlyph,
  fmtCost,
  fmtCostDelta,
  gridWidths,
  brighten,
  mix,
  pathToFileUri,
  pctCell,
  rateColor,
  sameSnapshot,
  shade,
  shortModel,
  spanText,
  spanWidth,
  taskBarCells,
  textCells,
  truncEnd,
  truncMiddle,
  truncateSpans,
  withBackground,
  withGlow,
  withPulse,
} from '../hooks/shared'
import type { Span } from '../hooks/shared'
import { NOW } from './format-fixtures'

test('pathToFileUri: a file:// address with the drive letter kept, each segment percent-encoded; no path, no address', () => {
  expect(pathToFileUri('C:\\work\\my repo')).toBe('file:///C:/work/my%20repo')
  expect(pathToFileUri('/work/example-repo')).toBe('file:///work/example-repo')
  expect(pathToFileUri('')).toBeUndefined()
})

test('abbrevTokens scales to k and M', () => {
  expect(abbrevTokens(248_000, true)).toBe('248K')
  expect(abbrevTokens(1_000_000, true)).toBe('1M')
  expect(abbrevTokens(38_400)).toBe('38.4k')
  expect(abbrevTokens(999)).toBe('999')
  expect(abbrevTokens(undefined)).toBe('')
})

test('countdown is always 6 cells, right-aligned: minutes, hours and minutes, days and hours', () => {
  expect(countdown(NOW + 45 * 60000, NOW)).toBe('   45m')
  expect(countdown(NOW + 5 * 60000, NOW)).toBe('    5m')
  expect(countdown(NOW + (2 * 60 + 14) * 60000, NOW)).toBe(' 2h14m')
  expect(countdown(NOW + (13 * 60 + 45) * 60000, NOW)).toBe('13h45m')
  expect(countdown(NOW + (2 * 60 + 5) * 60000, NOW)).toBe(' 2h05m') // two-digit minutes
  expect(countdown(NOW + 60 * 60000, NOW)).toBe(' 1h00m')
  expect(countdown(NOW + (3 * 1440 + 6 * 60) * 60000, NOW)).toBe(' 3d06h') // two-digit hours, unit d
  expect(countdown(NOW + (6 * 1440 + 23 * 60) * 60000, NOW)).toBe(' 6d23h')
  expect(countdown(NOW + 1440 * 60000, NOW)).toBe(' 1d00h')
  expect(countdown(NOW - 1, NOW)).toBe('')
  expect(countdown(undefined, NOW)).toBe('')
  for (const min of [1, 59, 60, 61, 1439, 1440, 1441, 7 * 1440 - 1]) expect([...countdown(NOW + min * 60000, NOW)]).toHaveLength(6)
})

test('duration reads seconds, minutes, hours', () => {
  expect(duration(41_000)).toBe('41s')
  expect(duration(134_000)).toBe('2m14s')
  expect(duration(3_720_000)).toBe('1h02m')
})

test('rateColor projects the end-of-window usage', () => {
  const week = 604800
  const halfway = NOW + (week / 2) * 1000
  expect(rateColor(30, halfway, week, NOW)).toBe(COLORS.green) // 30 used at 50% elapsed -> projects 60
  expect(rateColor(45, halfway, week, NOW)).toBe(COLORS.yellow) // projects 90
  expect(rateColor(60, halfway, week, NOW)).toBe(COLORS.red) // projects 120
  expect(rateColor(10, undefined, week, NOW)).toBe(COLORS.green) // by what is left
})

test('fmtCost and the turn delta', () => {
  expect(fmtCost(4.82)).toBe('$4.82')
  expect(fmtCost(0.382)).toBe('$0.382')
  expect(fmtCost(0)).toBe('$0.00')
  expect(fmtCost(undefined)).toBe('$0.00')
  expect(fmtCostDelta(0.38)).toBe('+0.38')
  expect(fmtCostDelta(0.001)).toBe('')
})

test('costCell: one width, `$` first and two decimals, so `$` and the point line up in a column', () => {
  expect(costCell(0.382, 7)).toBe('$  0.38')
  expect(costCell(12.4, 7)).toBe('$ 12.40')
  expect(costCell(123.456, 7)).toBe('$123.46')
  expect(costCell(0, 7)).toBe('$  0.00')
  expect(costCell(0.003, 7)).toBe('$ <0.01')
  expect(costCell(Number.NaN, 7)).toBe('$  0.00')
  for (const usd of [0, 0.003, 0.0123, 0.5, 9.99, 42, 999.99]) expect(costCell(usd, 7)).toHaveLength(7)
})

test('model names, from an id or from a display name', () => {
  expect(shortModel('claude-sonnet-5-5-20260101')).toBe('son 5.5')
  expect(shortModel('Opus 5.5')).toBe('opu 5.5')
  expect(shortModel('claude-haiku-5-5')).toBe('hai 5.5')
  expect(shortModel('fable 5.1')).toBe('fab 5.1')
  expect(shortModel('opus')).toBe('opu')
  expect(displayModel('claude-opus-5-5[1m]')).toBe('Opus 5.5')
  expect(displayModel('something-else')).toBe('something-else')
})

test('effort glyphs follow the level; a number has none', () => {
  expect(effortGlyph('high')?.icon).toBe('\u{F12A3}')
  expect(effortGlyph('max')?.icon).toBe('\u{F0083}')
  expect(effortGlyph(8000)).toBeUndefined()
})

test('truncMiddle keeps both ends', () => {
  expect(truncMiddle('feature/AB#4821-settlement-retry-backoff', 24)).toBe('feature/AB#4\u2026try-backoff')
  expect(truncMiddle('short', 24)).toBe('short')
  expect([...truncMiddle('abcdefghij', 5)].length).toBe(5)
})

test('gridWidths split 2:3 and never squeeze the diffs', () => {
  const w = gridWidths(50, 8)
  expect(w.folder + w.branch + w.diffs + 2).toBe(50)
  expect(w.diffs).toBeGreaterThanOrEqual(8)
  expect(gridWidths(50, 14).diffs).toBe(14)
})

test('barCells fills the width exactly, gap after fill', () => {
  const cells = barCells(10, [
    { pct: 40, color: 'a' },
    { pct: 10, color: 'b' },
  ])
  expect(spanWidth(cells)).toBe(10)
  expect(cells.map(c => [c.c, c.t.length])).toEqual([
    ['a', 4],
    ['b', 1],
    [COLORS.empty, 5],
  ])
  expect(spanText(barCells(4, []))).toBe('\u25b1\u25b1\u25b1\u25b1')
})

test('truncateSpans cuts to the width with an unstyled ellipsis and leaves a fitting line alone', () => {
  const spans: Span[] = [{ t: 'abcd', c: 'red' }, { t: 'efgh', dim: true }]
  expect(truncateSpans(spans, 8)).toEqual(spans)
  expect(truncateSpans(spans, 6)).toEqual([{ t: 'abcd', c: 'red' }, { t: 'e', dim: true }, { t: '…' }])
  expect(spanWidth(truncateSpans(spans, 3))).toBe(3)
  expect(spanText(truncateSpans(spans, 1))).toBe('…')
  expect(truncateSpans(spans, 0)).toEqual([])
  // wide characters count two cells: the cut row never outgrows the width
  expect(spanWidth(truncateSpans([{ t: '日本語のエージェント' }], 7))).toBeLessThanOrEqual(7)
  expect(spanText(truncateSpans([{ t: '日本語のエージェント' }], 7))).toBe('日本語…')
})

test('taskBarCells: full only when all are done, a task in progress never vanishes, never wider than the bar', () => {
  const cells = (parts: Span[]) => parts.map(p => [p.t.length, p.c])
  expect(taskBarCells(10, 10, 0, 10).map(p => p.t.length)).toEqual([10])
  const almost = taskBarCells(10, 199, 0, 200)
  expect(almost.map(p => p.t.length)).toEqual([9, 1])
  const long = taskBarCells(10, 0, 1, 100)
  expect(cells(long).map(c => c[0])).toEqual([1, 9])
  expect(spanWidth(taskBarCells(10, 3, 2, 7))).toBe(10)
  expect(spanWidth(taskBarCells(10, 5, 5, 10))).toBe(10)
  expect(spanWidth(taskBarCells(10, 9, 3, 10))).toBe(10)
  expect(taskBarCells(10, 0, 0, 0)).toEqual([])
})

test('truncEnd counts terminal cells, not characters', () => {
  expect(textCells('ab漢字')).toBe(6)
  expect(truncEnd('漢字漢字漢字', 7)).toBe('漢字漢…')
  expect(textCells(truncEnd('漢字漢字漢字', 7))).toBeLessThanOrEqual(7)
  expect(truncEnd('short', 9)).toBe('short')
})

test('pctCell pads a percentage to four cells so one, two and three digits align', () => {
  expect(pctCell(7)).toBe('  7%')
  expect(pctCell(87)).toBe(' 87%')
  expect(pctCell(100)).toBe('100%')
  expect(pctCell(0)).toBe('  0%')
})

// ── Cockpit v3, phase 1: the always-visible header ──

test('ICONS.folder: one glyph for a plain folder, a repository and a linked worktree', () => {
  expect(ICONS.folder).toBe('\u{F024B}')
})

test('cacheColor: green from 80 %, amber from 50 to 79, red below 50', () => {
  expect([100, 80].map(cacheColor)).toEqual([COLORS.green, COLORS.green])
  expect([79, 50].map(cacheColor)).toEqual([COLORS.amber, COLORS.amber])
  expect([49, 0].map(cacheColor)).toEqual([COLORS.red, COLORS.red])
})

test('withBackground: the first cells of a row on a background, a span cut where the cells end', () => {
  const row: Span[] = [{ t: '󰓛 ', c: 'x' }, { t: 'abcdef', dim: true }]
  expect(withBackground(row, 5, '#111')).toEqual([{ t: '󰓛 ', c: 'x', bg: '#111' }, { t: 'abc', dim: true, bg: '#111' }, { t: 'def', dim: true }])
  expect(withBackground(row, 0, '#111')).toEqual(row)
  expect(withBackground(row, 8, '#111')).toEqual([{ t: '󰓛 ', c: 'x', bg: '#111' }, { t: 'abcdef', dim: true, bg: '#111' }])
  expect(withBackground(row, 99, '#111').every(span => span.bg === '#111')).toBe(true)
})

test('shade: a color at a fraction of its brightness, as #rrggbb', () => {
  expect(shade('#ffffff', 0.5)).toBe('#808080')
  expect(shade('#7fb4ff', 0)).toBe('#000000')
  expect(shade('#102030', 1)).toBe('#102030')
})

// ── v3.1 ──

test('sameSnapshot: equal data under other objects is the same, a changed field is not, and a part shared by reference is never serialised', () => {
  let serialised = 0
  const shared = { toJSON: () => (serialised++, 'big') }
  expect(sameSnapshot({ a: 1, list: [1, 2], shared }, { a: 1, list: [1, 2], shared })).toBe(true)
  expect(serialised).toBe(0)
  expect(sameSnapshot({ a: 1, shared }, { a: 2, shared })).toBe(false)
  expect(sameSnapshot({ a: 1, list: [1] }, { a: 1, list: [1, 2] })).toBe(false)
  expect(sameSnapshot({ a: 1 }, { a: 1, extra: 1 })).toBe(false)
  expect(sameSnapshot({ a: 1, gone: undefined }, { a: 1 })).toBe(true)
  expect(serialised).toBe(0)
  expect(sameSnapshot({ a: 1, shared: { toJSON: () => (serialised++, 'x') } }, { a: 1, shared: { toJSON: () => (serialised++, 'x') } })).toBe(true)
  expect(serialised).toBe(2)
})

test('brighten moves a colour toward white: 0 keeps it, 1 is white, and a channel already at 255 still lights up', () => {
  expect(brighten('#204060', 0)).toBe('#204060')
  expect(brighten('#204060', 1)).toBe('#ffffff')
  expect(brighten('#ffcf8a', 0.5)).toBe('#ffe7c5')
  expect(mix('#000000', '#204060', 0.5)).toBe('#102030')
})

test('withGlow flows a 5-cell profile along the whole bar, brighter on the fill and tinted on the track, then rests past the end; the text never changes', () => {
  const bar = barCells(10, [{ pct: 50, color: '#204060' }])
  const colors = (cells: Span[]) => cells.flatMap(c => [...c.t].map(() => c.c))
  const GLOW = [0.15, 0.35, 0.6, 0.35, 0.15]
  expect(withGlow(bar, -1)).toBe(bar)
  for (const step of [0, 2, 4, 5, 8, 9, 14]) {
    expect(spanText(withGlow(bar, step))).toBe(spanText(bar))
    expect(spanWidth(withGlow(bar, step))).toBe(10)
  }
  // the head of the profile enters from the left: at step 2 its centre is on the first cell
  expect(colors(withGlow(bar, 2)).slice(0, 4)).toEqual([brighten('#204060', 0.6), brighten('#204060', 0.35), brighten('#204060', 0.15), '#204060'])
  // in the middle of the fill the profile is symmetric
  expect(colors(withGlow(bar, 4)).slice(0, 5)).toEqual(GLOW.map(k => brighten('#204060', k)))
  // on the empty track the cells take the fill's hue, so a short fill still shows the flow
  expect(colors(withGlow(bar, 9)).slice(5)).toEqual(GLOW.map(k => mix(COLORS.empty, '#204060', k)))
  // past the bar's end the glow rests, then starts again after the cycle (10 + 5 + 6 steps)
  expect(withGlow(bar, 20)).toEqual(bar)
  expect(withGlow(bar, 21)).toEqual(withGlow(bar, 0))
  expect(withGlow(barCells(10, []), 3)).toEqual(barCells(10, []))
})

test('withPulse brightens the fill while on and leaves the text and width alone', () => {
  const bar = barCells(10, [{ pct: 50, color: '#204060' }])
  expect(withPulse(bar, false)).toEqual(bar)
  expect(spanText(withPulse(bar, true))).toBe(spanText(bar))
  expect(spanWidth(withPulse(bar, true))).toBe(10)
  expect(withPulse(bar, true)[0]?.c).toBe(brighten('#204060', 0.45))
})
