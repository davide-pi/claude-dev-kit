import { expect, test } from 'claude-code/testing'

import {
  HISTORY_KEEP,
  abbrevTokens,
  addHistory,
  almText,
  burnRate,
  burnText,
  compactInstructions,
  parsePerimeter,
  worklogScope,
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
  parseHistory,
  parseReset,
  parseWorktree,
  rateColor,
  shortModel,
  signedPct,
  signedPctCell,
  spanText,
  spanWidth,
  toHistory,
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
  expect(parseGitStatus(out)).toEqual({ branch: 'feature/x', isDetached: false, staged: 2, modified: 2, untracked: 1 })
  expect(parseGitStatus('## No commits yet on main\n')?.branch).toBe('main')
  // a detached HEAD has no branch: git says `HEAD (no branch)`
  expect(parseGitStatus('## HEAD (no branch)\n M a.ts\n')).toEqual({ branch: 'HEAD', isDetached: true, staged: 0, modified: 1, untracked: 0 })
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

test('a reading from before the current 5h window opened is never the start of the burn rate', () => {
  const min = 60000
  const now = 400 * min
  const resetsAt = now + 100 * min // the window opened at minute 200
  expect(burnRate([{ at: 100 * min, used: 5 }], now, 38, resetsAt)).toBeUndefined()
  // the same reading inside the window counts: 33 points in 30 minutes = 66 %/h
  expect(burnRate([{ at: 250 * min, used: 5 }], now, 38, resetsAt)?.perHour).toBe(66)
  // an older one before a newer one is not the anchor either
  expect(burnRate([{ at: 100 * min, used: 1 }, { at: 250 * min, used: 5 }], now, 38, resetsAt)?.perHour).toBe(66)
  // recorded: the old reading is dropped, so no anchor is kept across the reset
  expect(recordBurnSample([{ at: 100 * min, used: 5 }], now, 38, resetsAt)).toEqual([{ at: now, used: 38 }])
  expect(recordBurnSample([{ at: 250 * min, used: 5 }], now, 38, resetsAt)).toEqual([{ at: now - 30 * min, used: 5 }, { at: now, used: 38 }])
  // no reset time known: no bound
  expect(recordBurnSample([{ at: 100 * min, used: 5 }], now, 38)).toEqual([{ at: now - 30 * min, used: 5 }, { at: now, used: 38 }])
})

test('parseReset reads the engine reset text; absent or not a date is undefined', () => {
  expect(parseReset('2026-10-22T10:00:00Z')).toBe(NOW)
  expect(parseReset(undefined)).toBeUndefined()
  expect(parseReset('soon')).toBeUndefined()
})

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

test('parseHistory takes the entries with their fields from a parsed state file and drops the rest', () => {
  const ok = { id: 'a1', type: 'implementer', model: 'claude-sonnet-5-5', startedAt: 1, endedAt: 2, tokens: 30, isFailed: true }
  expect(parseHistory([ok, { id: 'a2', type: 'x', startedAt: 1, endedAt: 2 }])).toEqual([
    ok,
    { id: 'a2', type: 'x', model: undefined, startedAt: 1, endedAt: 2, tokens: 0, isFailed: false },
  ])
  expect(parseHistory([{ ...ok, isInterrupted: true }])).toEqual([{ ...ok, isInterrupted: true }])
  expect(parseHistory([{ id: 'a3', type: 'x', startedAt: 'now', endedAt: 2 }, null, 'text', { type: 'x' }])).toEqual([])
  expect(parseHistory('not a list')).toEqual([])
  expect(parseHistory(undefined)).toEqual([])
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

// ── Compaction instructions, the worklog scope, the deliver perimeter ──

const KEEP =
  "Tieni: task in corso, decisioni prese con l'utente e il loro perché, domande aperte, file toccati e stato, comandi con la riga di output che decide, prossimi passi. Butta: output di tool già riassunti, tentativi superati."

const task = (id: string, subject: string, status: 'pending' | 'in_progress' | 'completed') => ({ id, subject, status })

test('compactInstructions: the keep/drop sentence alone when nothing else is known', () => {
  expect(compactInstructions({})).toBe(KEEP)
  expect(compactInstructions({ tasks: [], perimeter: [] })).toBe(KEEP)
  // finished tasks are not "in corso"
  expect(compactInstructions({ tasks: [task('1', 'fatto', 'completed')] })).toBe(KEEP)
})

test('compactInstructions: the open tasks (in progress first, at most 3), the perimeter and the running workflow', () => {
  const text = compactInstructions({
    tasks: [
      task('1', 'primo pending', 'pending'),
      task('2', 'in corso', 'in_progress'),
      task('3', 'terzo', 'pending'),
      task('4', 'quarto', 'pending'),
      task('5', 'chiuso', 'completed'),
    ],
    perimeter: ['src/a.ts', 'src/b/', 'tests/**/a*.ts', 'docs/x.md'],
    workflow: { name: 'impl-review-loop' },
  })
  expect(text.startsWith(KEEP)).toBe(true)
  expect(text).toContain('Task aperti: in corso; primo pending; terzo.')
  expect(text).not.toContain('quarto')
  expect(text).not.toContain('chiuso')
  expect(text).toContain('Perimetro deliver (4 voci): src/a.ts, src/b/, tests/**/a*.ts.')
  expect(text).not.toContain('docs/x.md')
  expect(text).toContain('Workflow in corso: impl-review-loop.')
  expect(text.length).toBeLessThanOrEqual(400)
})

test('compactInstructions: each part is optional, and long titles never push it past 400 characters', () => {
  expect(compactInstructions({ workflow: { name: 'w' } })).toBe(`${KEEP} Workflow in corso: w.`)
  expect(compactInstructions({ perimeter: ['a.ts'] })).toBe(`${KEEP} Perimetro deliver (1 voce): a.ts.`)
  const long = 'x'.repeat(200)
  const text = compactInstructions({
    tasks: [task('1', long, 'in_progress'), task('2', long, 'pending'), task('3', long, 'pending')],
    perimeter: [long, long, long],
    workflow: { name: long },
  })
  expect(text.length).toBeLessThanOrEqual(400)
  expect(text.startsWith(KEEP)).toBe(true)
})

const gitOn = (branch: string, isDetached = false) => ({ branch, isDetached, staged: 0, modified: 0, untracked: 0 })

test('worklogScope: the work item id of the branch, else the PR, else the branch as a topic', () => {
  expect(worklogScope(gitOn('feature/AB#1234-orders'))).toBe('AB#1234')
  expect(worklogScope(gitOn('users/me/1234-orders-filter'))).toBe('AB#1234')
  expect(worklogScope(gitOn('feature/1234'))).toBe('AB#1234')
  expect(worklogScope(gitOn('fix/AB#77'), 9)).toBe('AB#77')
  // no id in the name: the PR when known
  expect(worklogScope(gitOn('feature/orders-filter'), 42)).toBe('PR 42')
  // else the branch itself
  expect(worklogScope(gitOn('feature/orders-filter'))).toBe('topic feature/orders-filter')
  expect(worklogScope(gitOn('main'))).toBe('topic main')
  // a number that is not an id (too short, mid-word) is not read as one
  expect(worklogScope(gitOn('feature/v2-ui'))).toBe('topic feature/v2-ui')
  expect(worklogScope(gitOn('release-2026x'))).toBe('topic release-2026x')
})

test('worklogScope: nothing on a detached HEAD or without git', () => {
  expect(worklogScope(gitOn('HEAD', true), 42)).toBeUndefined()
  expect(worklogScope(undefined, 42)).toBeUndefined()
})

test('parsePerimeter: the entries of an active perimeter on the branch checked out, else nothing', () => {
  const file = 'branch: feat/x\r\nstatus: active\r\n- src/a.ts\r\n- src/b/\r\n-   \r\nnote\r\n'
  expect(parsePerimeter(file, 'feat/x')).toEqual(['src/a.ts', 'src/b/'])
  expect(parsePerimeter(file, 'feat/y')).toBeUndefined()
  expect(parsePerimeter(file.replace('active', 'closed'), 'feat/x')).toBeUndefined()
  expect(parsePerimeter('branch: feat/x\nstatus: active\n', 'feat/x')).toBeUndefined()
  expect(parsePerimeter('{}', 'feat/x')).toBeUndefined()
})
