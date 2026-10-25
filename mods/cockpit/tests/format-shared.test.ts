import { expect, test } from 'claude-code/testing'

import {
  COLORS,
  ICONS,
  abbrevTokens,
  barCells,
  cacheColor,
  countdown,
  displayModel,
  duration,
  effortGlyph,
  fmtBytes,
  fmtCost,
  fmtCostDelta,
  folderIcon,
  gridWidths,
  pctCell,
  rangeSparkline,
  rateColor,
  shade,
  shortModel,
  signedPctCell,
  spanText,
  spanWidth,
  sparkline,
  taskBarCells,
  textCells,
  truncEnd,
  truncMiddle,
  truncateSpans,
  withBackground,
} from '../hooks/shared'
import type { Span } from '../hooks/shared'
import { NOW } from './format-fixtures'

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

test('model names, from an id or from a display name', () => {
  expect(shortModel('claude-sonnet-5-5-20260101')).toBe('son 5.5')
  expect(shortModel('Opus 5.5')).toBe('opus 5.5')
  expect(shortModel('opus')).toBe('opus')
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

test('signedPctCell pads the pace delta to the width of the other percentages', () => {
  expect(signedPctCell(-5)).toBe(' −5%')
  expect(signedPctCell(5)).toBe(' +5%')
  expect(signedPctCell(-12)).toBe('−12%')
  expect(signedPctCell(100)).toBe('+100%')
})

// ── Cockpit v3, phase 1: the always-visible header ──

test('folderIcon: a plain folder, a repository and a linked worktree each have their own glyph', () => {
  expect(ICONS.folder).toBe('\u{F024B}')
  expect(ICONS.repo).toBe('\u{F0CCF}')
  expect(ICONS.tree).toBe('\u{F0CD0}')
  expect(folderIcon(undefined)).toBe('\u{F024B}')
  expect(folderIcon({ root: '/w/orders' })).toBe('\u{F0CCF}')
  expect(folderIcon({ root: '/w/orders-wt', worktreeRoot: '/w/orders-wt' })).toBe('\u{F0CD0}')
})

test('cacheColor: green from 80 %, amber from 50 to 79, red below 50', () => {
  expect([100, 80].map(cacheColor)).toEqual([COLORS.green, COLORS.green])
  expect([79, 50].map(cacheColor)).toEqual([COLORS.amber, COLORS.amber])
  expect([49, 0].map(cacheColor)).toEqual([COLORS.red, COLORS.red])
})

test('sparkline: one block per round, scaled to the tallest; empty without rounds', () => {
  expect(sparkline([])).toBe('')
  expect(sparkline([1, 2, 4, 8])).toBe('▂▃▅█')
  expect(sparkline([0, 8])).toBe('▁█')
  expect(sparkline([0, 0])).toBe('▁▁')
})

test('sparkline: a given maximum fixes the scale, so a quiet reading stays low', () => {
  expect(sparkline([5, 5], 100)).toBe('▁▁')
  expect(sparkline([0, 50, 100], 100)).toBe('▁▅█')
  expect(sparkline([5, 5])).toBe('██')
  expect(sparkline([150], 100)).toBe('█')
})

test('fmtBytes: base 1024, a space and the unit (B, KB, MB, GB), a decimal only under ten', () => {
  expect(fmtBytes(0)).toBe('0 B')
  expect(fmtBytes(512)).toBe('512 B')
  expect(fmtBytes(850 * 1024)).toBe('850 KB')
  expect(fmtBytes(1536)).toBe('1.5 KB')
  expect(fmtBytes(Math.round(1.2 * 1024 ** 2))).toBe('1.2 MB')
  expect(fmtBytes(45 * 1024 ** 2)).toBe('45 MB')
  expect(fmtBytes(340 * 1024 ** 2)).toBe('340 MB')
  expect(fmtBytes(Math.round(1.2 * 1024 ** 3))).toBe('1.2 GB')
  expect(fmtBytes(12.4 * 1024 ** 3)).toBe('12 GB')
  expect(fmtBytes(-5)).toBe('0 B')
})

test('fmtBytes: the value is rounded before the unit is chosen, so it never reads 1024 KB or 10.0 KB', () => {
  expect(fmtBytes(1024 ** 2 - 1)).toBe('1.0 MB')
  expect(fmtBytes(1023.6)).toBe('1.0 KB')
  expect(fmtBytes(10 * 1024 - 1)).toBe('10 KB')
  expect(fmtBytes(Math.round(9.96 * 1024 ** 2))).toBe('10 MB')
  expect(fmtBytes(1024 ** 3 - 1)).toBe('1.0 GB')
  expect(fmtBytes(9.94 * 1024)).toBe('9.9 KB')
  expect(fmtBytes(1023.4)).toBe('1023 B')
})

test('withBackground: the first cells of a row on a background, a span cut where the cells end', () => {
  const row: Span[] = [{ t: '■ ', c: 'x' }, { t: 'abcdef', dim: true }]
  expect(withBackground(row, 5, '#111')).toEqual([{ t: '■ ', c: 'x', bg: '#111' }, { t: 'abc', dim: true, bg: '#111' }, { t: 'def', dim: true }])
  expect(withBackground(row, 0, '#111')).toEqual(row)
  expect(withBackground(row, 8, '#111')).toEqual([{ t: '■ ', c: 'x', bg: '#111' }, { t: 'abcdef', dim: true, bg: '#111' }])
  expect(withBackground(row, 99, '#111').every(span => span.bg === '#111')).toBe(true)
})

test('shade: a color at a fraction of its brightness, as #rrggbb', () => {
  expect(shade('#ffffff', 0.5)).toBe('#808080')
  expect(shade('#7fb4ff', 0)).toBe('#000000')
  expect(shade('#102030', 1)).toBe('#102030')
})

// ── v3.1 ──

test('rangeSparkline: bars scaled between the lowest and the highest value; a flat series draws the lowest bar, never noise', () => {
  expect(rangeSparkline([])).toBe('')
  expect(rangeSparkline([20, 40, 60])).toBe('▁▅█')
  expect(rangeSparkline([30, 30, 30])).toBe('▁▁▁')
  expect(rangeSparkline([0, 100])).toBe('▁█')
  expect(rangeSparkline([5])).toBe('▁')
  expect(rangeSparkline([1000, 1001, 1002, 1003, 1004, 1005, 1006, 1007])).toBe('▁▂▃▄▅▆▇█')
})
