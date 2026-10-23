import { expect, test } from 'claude-code/testing'

import {
  abbrevTokens,
  almText,
  burnRate,
  burnText,
  pctCell,
  recordBurnSample,
  resetClock,
  resolveAlm,
  taskBarCells,
  textCells,
  truncEnd,
  barCells,
  countdown,
  displayModel,
  duration,
  effortGlyph,
  fmtCost,
  fmtCostDelta,
  gridWidths,
  parseGitStatus,
  parseWorktree,
  rateColor,
  shortModel,
  signedPct,
  signedPctCell,
  spanText,
  spanWidth,
  truncMiddle,
  truncateSpans,
  weeklyPace,
  worklogDays,
  worklogLabel,
  COLORS,
} from '../hooks/format'
import type { Span } from '../hooks/format'

const NOW = Date.parse('2026-10-22T10:00:00Z')

test('abbrevTokens scales to k and M', () => {
  expect(abbrevTokens(248_000, true)).toBe('248K')
  expect(abbrevTokens(1_000_000, true)).toBe('1M')
  expect(abbrevTokens(38_400)).toBe('38.4k')
  expect(abbrevTokens(999)).toBe('999')
  expect(abbrevTokens(undefined)).toBe('')
})

test('countdown reads days, hours, minutes', () => {
  expect(countdown(NOW + (3 * 1440 + 6 * 60) * 60000, NOW)).toBe('3d6h')
  expect(countdown(NOW + (2 * 60 + 14) * 60000, NOW)).toBe('2h14m')
  expect(countdown(NOW + 14 * 60000, NOW)).toBe('14m')
  expect(countdown(NOW - 1, NOW)).toBe('')
  expect(countdown(undefined, NOW)).toBe('')
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

test('weeklyPace is the gap to what should still be left', () => {
  const week = 604800
  const resets = NOW + (week * 0.46 * 1000) // 46% of the window to go
  expect(weeklyPace(41, resets, week, NOW)).toEqual({ target: 46, delta: -5 })
  expect(weeklyPace(41, NOW - 1, week, NOW)).toBeUndefined()
  expect(signedPct(-5)).toBe('\u22125%')
  expect(signedPct(3)).toBe('+3%')
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

test('parseGitStatus counts staged, modified, untracked', () => {
  const out = '## feature/x...origin/feature/x [ahead 1]\nM  a.ts\n M b.ts\nMM c.ts\n?? d.ts\n'
  expect(parseGitStatus(out)).toEqual({ branch: 'feature/x', staged: 2, modified: 2, untracked: 1 })
  expect(parseGitStatus('## No commits yet on main\n')?.branch).toBe('main')
  expect(parseGitStatus('')).toBeUndefined()
})

test('parseWorktree is set only in a linked worktree', () => {
  expect(parseWorktree('.git\n.git\n/work/repo')).toBeUndefined()
  expect(parseWorktree('/work/repo/.git/worktrees/w\n/work/repo/.git\n/work/wt/w')).toBe('/work/wt/w')
})

test('worklogDays is silent when the snapshot is stale', () => {
  const snap = { day: '2026-10-22', auditMtime: 1000.5, pending: [], underTarget: [{ date: '2026-10-12' }, { date: '2026-10-20' }] }
  expect(worklogDays(snap, 1000.5, '2026-10-22').underTarget).toEqual(['2026-10-12', '2026-10-20'])
  expect(worklogDays(snap, 2000, '2026-10-22').underTarget).toEqual([])
  expect(worklogDays(snap, 1000.5, '2026-10-23').underTarget).toEqual([])
  expect(worklogLabel('underTarget', ['2026-10-12', '2026-10-20'])).toBe('worklog: 2d sotto target (12/10, 20/10)')
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

// Local-time inputs: the expectations hold in any time zone.
const at = (day: number, h: number, m: number) => new Date(2026, 9, day, h, m).getTime()

test('resetClock: the clock time within 24 hours, the weekday and time beyond', () => {
  const now = at(22, 10, 0)
  expect(resetClock(at(22, 14, 30), now)).toBe('(14:30)')
  expect(resetClock(at(23, 10, 0), now)).toBe('(10:00)') // exactly 24 h: still the clock time
  expect(resetClock(at(25, 9, 0), now)).toBe('(dom 09:00)') // 2026-10-25 is a Sunday
  expect(resetClock(at(26, 7, 5), now)).toBe('(lun 07:05)')
  expect(resetClock(now - 1, now)).toBe('')
  expect(resetClock(undefined, now)).toBe('')
})

test('recordBurnSample keeps the last 30 minutes, anchors the value that held at their start, skips an unchanged reading and starts over when the window resets', () => {
  const min = 60000
  const first = recordBurnSample(undefined, 0, 38)
  expect(first).toEqual([{ at: 0, used: 38 }])
  expect(recordBurnSample(first, 5 * min, 38)).toEqual(first)
  const grown = recordBurnSample(first, 12 * min, 41)
  expect(grown).toEqual([{ at: 0, used: 38 }, { at: 12 * min, used: 41 }])
  // the reading that fell out of the window still says what the credits stood at when it opened: kept, clamped to its start
  expect(recordBurnSample(grown, 35 * min, 45)).toEqual([{ at: 5 * min, used: 38 }, { at: 12 * min, used: 41 }, { at: 35 * min, used: 45 }])
  expect(recordBurnSample(grown, 60 * min, 41)).toEqual([{ at: 30 * min, used: 41 }])
  expect(recordBurnSample([{ at: 0, used: 38 }], 50 * min, 38)).toEqual([{ at: 20 * min, used: 38 }])
  expect(recordBurnSample([{ at: 0, used: 38 }], 50 * min, 40)).toEqual([{ at: 20 * min, used: 38 }, { at: 50 * min, used: 40 }])
  expect(recordBurnSample([{ at: 0, used: 38 }, { at: 20 * min, used: 40 }], 30 * min, undefined)).toEqual([{ at: 0, used: 38 }, { at: 20 * min, used: 40 }])
  expect(recordBurnSample(grown, 40 * min, 3)).toEqual([{ at: 40 * min, used: 3 }]) // a fall is a window reset: no anchor
  expect(recordBurnSample(grown, 20 * min, undefined)).toEqual(grown)
})

test('burnRate: rate, exhaustion time and the verdict against the reset; nothing without 10 minutes or a positive rate', () => {
  const min = 60000
  const now = 20 * min
  const samples = [{ at: 0, used: 35 }]
  // 3 points in 20 min = 9 %/h; 62 left lasts 6h53, the reset comes in 2h14
  const slow = burnRate(samples, now, 38, now + 134 * min)
  expect(slow?.perHour).toBe(9)
  expect(slow?.isBeforeReset).toBe(false)
  expect(Math.round((slow?.etaMs ?? 0) / min)).toBe(413)
  expect(burnText(slow!)).toBe('−9%/h · finisce tra 6h53: arrivi al reset')
  // 30 points in 20 min = 90 %/h; 35 left lasts 23 min, the reset comes in 3 h
  const fast = burnRate([{ at: 0, used: 35 }], now, 65, now + 180 * min)
  expect(fast?.isBeforeReset).toBe(true)
  expect(burnText(fast!)).toBe('−90%/h · finisce tra 23m, prima del reset')
  // under 10 minutes of samples, a flat or falling reading, a reset unknown or gone, a spent window: no line
  expect(burnRate([{ at: 15 * min, used: 35 }], now, 38, now + 134 * min)).toBeUndefined()
  expect(burnRate(samples, now, 35, now + 134 * min)).toBeUndefined()
  expect(burnRate(samples, now, 30, now + 134 * min)).toBeUndefined()
  expect(burnRate(samples, now, 38, undefined)).toBeUndefined()
  expect(burnRate(samples, now, 38, now - 1)).toBeUndefined()
  expect(burnRate(samples, now, 100, now + 134 * min)).toBeUndefined()
  expect(burnRate([], now, 38, now + 134 * min)).toBeUndefined()
  // the last sample older than 30 minutes counts as the reading at the window's start: 28 points in 30 min = 56 %/h
  expect(burnRate([{ at: 0, used: 10 }], 40 * min, 38, 40 * min + 134 * min)?.perHour).toBe(56)
  // ... but an older one before it does not, and a flat value says nothing
  expect(burnRate([{ at: 0, used: 1 }, { at: 5 * min, used: 10 }], 40 * min, 38, 40 * min + 134 * min)?.perHour).toBe(56)
  expect(burnRate([{ at: 0, used: 38 }], 40 * min, 38, 40 * min + 134 * min)).toBeUndefined()
  // a rate that rounds to zero is not shown
  expect(burnRate([{ at: 0, used: 38 }], 30 * min, 38.1, 30 * min + 134 * min)).toBeUndefined()
})

/** A Windows spelling of a path written with slashes. */
const win = (p: string) => p.split('/').join(String.fromCharCode(92))

const WORKSPACES = {
  roots: [
    { path: win('/ws/Product'), platform: 'azure-devops', org: 'org-a', project: 'Alpha', identity: 'id-a' },
    { path: win('/ws/clients'), platform: 'azure-devops', org: 'org-b', projects: { acme: 'Acme' }, identity: 'id-b' },
    { path: win('/ws/gh'), platform: 'github', org: 'gh-org' },
    { path: win('/ws/gh/moved'), platform: 'azure-devops', org: 'org-b', project: 'Moved', identity: 'id-b' },
  ],
}

test('resolveAlm resolves a directory like the workspaces hook: longest root wins, case-insensitive, sub-project map', () => {
  expect(resolveAlm(WORKSPACES, '/WS/product/api')).toEqual({ isMapped: true, org: 'org-a', project: 'Alpha', identity: 'id-a' })
  expect(resolveAlm(WORKSPACES, win('/ws/Product'))).toEqual({ isMapped: true, org: 'org-a', project: 'Alpha', identity: 'id-a' })
  // a nested root beats the plain root it sits in
  expect(resolveAlm(WORKSPACES, win('/ws/gh/moved/x'))).toEqual({ isMapped: true, org: 'org-b', project: 'Moved', identity: 'id-b' })
  // GitHub: no project, no identity
  expect(resolveAlm(WORKSPACES, win('/ws/gh/other'))).toEqual({ isMapped: true, org: 'gh-org' })
  // first subfolder picks the project; an unlisted or missing one leaves it out
  expect(resolveAlm(WORKSPACES, win('/ws/clients/Acme/web'))).toEqual({ isMapped: true, org: 'org-b', project: 'Acme', identity: 'id-b' })
  expect(resolveAlm(WORKSPACES, win('/ws/clients/other'))).toEqual({ isMapped: true, org: 'org-b', identity: 'id-b' })
  expect(resolveAlm(WORKSPACES, win('/ws/clients'))).toEqual({ isMapped: true, org: 'org-b', identity: 'id-b' })
  // a sibling that only shares the prefix is not inside the root
  expect(resolveAlm(WORKSPACES, win('/ws/Product-old'))).toEqual({ isMapped: false })
  expect(resolveAlm(WORKSPACES, win('/elsewhere'))).toEqual({ isMapped: false })
  // project "ask" and an identity that is not a plain name are left out
  expect(resolveAlm({ roots: [{ path: '/w', org: 'o', project: 'ask', identity: '../x' }] }, '/w/a')).toEqual({ isMapped: true, org: 'o' })
  // no map or a malformed one: undefined, the line is absent
  expect(resolveAlm(undefined, '/w')).toBeUndefined()
  expect(resolveAlm({ roots: 'x' }, '/w')).toBeUndefined()
  expect(resolveAlm({}, '/w')).toBeUndefined()
})

test('almText: the target only, org / project and the identity; unmapped says so; mapped with nothing is empty', () => {
  expect(almText({ isMapped: true, org: 'org-a', project: 'Alpha', identity: 'id-a' })).toBe('org-a / Alpha · id-a')
  expect(almText({ isMapped: true, org: 'gh-org' })).toBe('gh-org')
  expect(almText({ isMapped: true, identity: 'id-a' })).toBe('id-a')
  expect(almText({ isMapped: true })).toBe('')
  expect(almText({ isMapped: false })).toBe('non mappato')
})

test('signedPctCell pads the pace delta to the width of the other percentages', () => {
  expect(signedPctCell(-5)).toBe(' −5%')
  expect(signedPctCell(5)).toBe(' +5%')
  expect(signedPctCell(-12)).toBe('−12%')
  expect(signedPctCell(100)).toBe('+100%')
})
