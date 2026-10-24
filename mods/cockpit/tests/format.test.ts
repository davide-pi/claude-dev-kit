import { expect, test } from 'claude-code/testing'

import {
  HISTORY_KEEP,
  ICONS,
  abbrevTokens,
  addHistory,
  addUsage,
  aheadBehindSpans,
  almText,
  autocompactForecast,
  burnRate,
  burnText,
  cacheColor,
  checkPerimeter,
  claudeStateSpans,
  folderIcon,
  recordCtxSample,
  tabNeeds,
  newTokens,
  sessionTokens,
  settleUsage,
  stateAfterWait,
  tokenShare,
  usageOf,
  contextOf,
  recordRound,
  shouldCompact,
  sparkline,
  withAgentTokens,
  claimTime,
  compactInstructions,
  isGithubRemote,
  parseDoneClaims,
  parseDefaultBranch,
  parsePerimeter,
  parseGithubPr,
  parseAzurePr,
  parseNumstat,
  parseWorktrees,
  isAzureRemote,
  azureRepo,
  diffHunks,
  capDiff,
  additionsDiff,
  isDefaultBranch,
  pctCell,
  recordBurnSample,
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
  expect(parseGitStatus(out)).toEqual({ branch: 'feature/x', isDetached: false, staged: 2, modified: 2, untracked: 1, upstream: 'origin/feature/x', ahead: 1, behind: 0 })
  expect(parseGitStatus('## feature/x\nM  a.ts\n')).toEqual({ branch: 'feature/x', isDetached: false, staged: 1, modified: 0, untracked: 0 })
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
  expect(burnText(slow!)).toBe('−9%/h · finisce tra  6h53m: arrivi al reset')
  // 30 points in 20 min = 90 %/h; 35 left lasts 23 min, the reset comes in 3 h
  const fast = burnRate([{ at: 0, used: 35 }], now, 65, now + 180 * min)
  expect(fast?.isBeforeReset).toBe(true)
  expect(burnText(fast!)).toBe('−90%/h · finisce tra    23m, prima del reset')
  // the duration is the countdown's 6 cells, days included
  expect(burnText({ perHour: 3, etaMs: (1440 + 6 * 60) * min, isBeforeReset: false })).toBe('−3%/h · finisce tra  1d06h: arrivi al reset')
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

test('compactInstructions: the open tasks (in progress first, at most 3) and the perimeter (its size and first 2 entries)', () => {
  const text = compactInstructions({
    tasks: [
      task('1', 'primo pending', 'pending'),
      task('2', 'in corso', 'in_progress'),
      task('3', 'terzo', 'pending'),
      task('4', 'quarto', 'pending'),
      task('5', 'chiuso', 'completed'),
    ],
    perimeter: ['src/a.ts', 'src/b/', 'tests/**/a*.ts', 'docs/x.md'],
  })
  expect(text.startsWith(KEEP)).toBe(true)
  expect(text).toContain('Task aperti: in corso; primo pending; terzo.')
  expect(text).not.toContain('quarto')
  expect(text).not.toContain('chiuso')
  expect(text).toContain('Perimetro deliver (4 voci): src/a.ts, src/b/.')
  expect(text).not.toContain('tests/**/a*.ts')
  expect(text).not.toContain('docs/x.md')
  expect(text).not.toContain('Workflow')
  expect(text.length).toBeLessThanOrEqual(400)
})

test('compactInstructions: a running workflow is named last, and only when it fits', () => {
  expect(compactInstructions({ workflow: 'release-notes' })).toBe(`${KEEP} Workflow in corso: release-notes.`)
  expect(compactInstructions({ tasks: [task('1', 'in corso', 'in_progress')], perimeter: ['a.ts'], workflow: 'wf' })).toBe(
    `${KEEP} Task aperti: in corso. Perimetro deliver (1 voce): a.ts. Workflow in corso: wf.`,
  )
  const text = compactInstructions({ workflow: 'w'.repeat(500) })
  expect(text.startsWith(KEEP)).toBe(true)
  expect([...text].length).toBeLessThanOrEqual(400)
})

test('compactInstructions: each part is optional, and long titles never push it past 400 characters', () => {
  expect(compactInstructions({ perimeter: ['a.ts'] })).toBe(`${KEEP} Perimetro deliver (1 voce): a.ts.`)
  const long = 'x'.repeat(200)
  const text = compactInstructions({
    tasks: [task('1', long, 'in_progress'), task('2', long, 'pending'), task('3', long, 'pending')],
    perimeter: [long, long, long],
  })
  expect(text.length).toBeLessThanOrEqual(400)
  expect(text.startsWith(KEEP)).toBe(true)
})

test('isDefaultBranch: main, master, develop and the repo own default, nothing else', () => {
  for (const branch of ['main', 'master', 'develop']) expect(isDefaultBranch(branch)).toBe(true)
  expect(isDefaultBranch('trunk')).toBe(false)
  expect(isDefaultBranch('trunk', 'trunk')).toBe(true)
  expect(isDefaultBranch('feature/trunk', 'trunk')).toBe(false)
})

test('parseGitStatus: the upstream with the commits ahead and behind it', () => {
  expect(parseGitStatus('## feature/x...origin/feature/x [ahead 2, behind 1]\n')).toMatchObject({ branch: 'feature/x', upstream: 'origin/feature/x', ahead: 2, behind: 1 })
  expect(parseGitStatus('## feature/x...origin/feature/x [ahead 3]\n')).toMatchObject({ ahead: 3, behind: 0 })
  expect(parseGitStatus('## feature/x...origin/feature/x [behind 4]\n')).toMatchObject({ ahead: 0, behind: 4 })
  expect(parseGitStatus('## feature/x...origin/feature/x\n')).toMatchObject({ upstream: 'origin/feature/x', ahead: 0, behind: 0 })
  // no upstream, or one that is gone: nothing to count against
  expect(parseGitStatus('## feature/x\n')?.upstream).toBeUndefined()
  expect(parseGitStatus('## feature/x...origin/feature/x [gone]\n')?.upstream).toBeUndefined()
  expect(parseGitStatus('## HEAD (no branch)\n')?.upstream).toBeUndefined()
})

test('parseNumstat: tracked files with +/-, a binary one, then the untracked ones', () => {
  expect(parseNumstat('12\t3\tsrc/a.ts\0-\t-\timg.png\0', ['notes.md'])).toEqual([
    { path: 'src/a.ts', added: 12, deleted: 3 },
    { path: 'img.png', isBinary: true },
    { path: 'notes.md', isUntracked: true },
  ])
  expect(parseNumstat('0\t5\tdir with space/b c.ts\0', [])).toEqual([{ path: 'dir with space/b c.ts', added: 0, deleted: 5 }])
  expect(parseNumstat('', [])).toEqual([])
  expect(parseNumstat('garbage\0', [])).toEqual([])
})

test('parseWorktrees: the path and branch of each checkout, a detached one without a branch, a bare one left out', () => {
  const text = 'worktree /w/a\nHEAD 111\nbranch refs/heads/feature/x\n\nworktree /w/b\nHEAD 222\ndetached\n\nworktree /w/c.git\nbare\n'
  expect(parseWorktrees(text)).toEqual([{ path: '/w/a', branch: 'feature/x' }, { path: '/w/b' }])
  expect(parseWorktrees('')).toEqual([])
})

test('parseGithubPr: an open PR with its title, review decision and the checks told passed, failed, pending', () => {
  const checks = [
    { __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SUCCESS' },
    { __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SKIPPED' },
    { __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'TIMED_OUT' },
    { __typename: 'CheckRun', status: 'QUEUED', conclusion: '' },
    { __typename: 'StatusContext', state: 'SUCCESS' },
    { __typename: 'StatusContext', state: 'PENDING' },
    { __typename: 'StatusContext', state: 'ERROR' },
  ]
  const json = (o: object) => JSON.stringify({ number: 42, title: 'Fix', state: 'OPEN', isDraft: false, ...o })
  expect(parseGithubPr(json({ reviewDecision: 'APPROVED', statusCheckRollup: checks }))).toEqual({
    number: 42,
    title: 'Fix',
    isDraft: false,
    review: 'approved',
    checks: { passed: 3, failed: 2, pending: 2 },
  })
  expect(parseGithubPr(json({ reviewDecision: 'CHANGES_REQUESTED', isDraft: true }))).toEqual({ number: 42, title: 'Fix', isDraft: true, review: 'changes' })
  expect(parseGithubPr(json({ reviewDecision: 'REVIEW_REQUIRED', statusCheckRollup: [] }))?.review).toBe('pending')
  expect(parseGithubPr(json({ reviewDecision: '' }))?.review).toBeUndefined()
  expect(parseGithubPr(json({ state: 'MERGED' }))).toBeUndefined()
  expect(parseGithubPr(json({ state: 'CLOSED' }))).toBeUndefined()
  expect(parseGithubPr(json({ number: 0 }))).toBeUndefined()
  expect(parseGithubPr(json({ number: '42' }))).toBeUndefined()
  expect(parseGithubPr('{}')).toBeUndefined()
  expect(parseGithubPr('not json')).toBeUndefined()
  expect(parseGithubPr('')).toBeUndefined()
})

test('parseAzurePr: the first active PR of az repos pr list, its review from the reviewers votes, no checks', () => {
  const list = (o: object) => JSON.stringify([{ pullRequestId: 7, title: 'Faster', status: 'active', isDraft: false, ...o }])
  expect(parseAzurePr(list({ reviewers: [{ vote: 10 }, { vote: 0 }] }))).toEqual({ number: 7, title: 'Faster', isDraft: false, review: 'approved' })
  expect(parseAzurePr(list({ isDraft: true }))).toEqual({ number: 7, title: 'Faster', isDraft: true })
  expect(parseAzurePr(list({ reviewers: [{ vote: 10 }, { vote: -10 }] }))?.review).toBe('changes')
  expect(parseAzurePr(list({ reviewers: [{ vote: -5 }] }))?.review).toBe('changes')
  expect(parseAzurePr(list({ reviewers: [{ vote: 0 }, { vote: 0 }] }))?.review).toBe('pending')
  expect(parseAzurePr(list({ reviewers: [] }))?.review).toBeUndefined()
  expect(parseAzurePr(list({ status: 'completed' }))).toBeUndefined()
  expect(parseAzurePr(list({ pullRequestId: 'x' }))).toBeUndefined()
  expect(parseAzurePr('[]')).toBeUndefined()
  expect(parseAzurePr('{}')).toBeUndefined()
  expect(parseAzurePr('not json')).toBeUndefined()
})

test('isAzureRemote and azureRepo: the project and repository an Azure DevOps remote names', () => {
  const SSH_USER = 'git' // kept apart so the URLs below are not read as e-mail addresses
  const https = 'https://dev.azure.com/<org>/proj/_git/orders'
  const ssh = `${SSH_USER}@ssh.dev.azure.com:v3/<org>/proj/orders`
  const old = 'https://<org>.visualstudio.com/proj/_git/orders'
  for (const url of [https, ssh, old]) {
    expect(isAzureRemote(`${url}\n`)).toBe(true)
    expect(azureRepo(url)).toEqual({ project: 'proj', repo: 'orders' })
  }
  expect(azureRepo('https://dev.azure.com/<org>/My%20Proj/_git/my%20repo')).toEqual({ project: 'My Proj', repo: 'my repo' })
  // the project's default repository carries the project's name
  expect(azureRepo('https://dev.azure.com/<org>/_git/orders')).toEqual({ repo: 'orders' })
  expect(isAzureRemote('https://github.com/example/orders')).toBe(false)
  expect(isAzureRemote('')).toBe(false)
  expect(azureRepo('https://github.com/example/orders')).toBeUndefined()
})

test('diffHunks: git diff without its header lines; a diff with no hunks is empty; carriage returns go', () => {
  const raw = 'diff --git a/x b/x\r\nindex 1..2 100644\r\n--- a/x\r\n+++ b/x\r\n@@ -1 +1 @@\r\n-a\r\n+b\r\n'
  expect(diffHunks(raw)).toBe('--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n')
  expect(diffHunks('diff --git a/i.png b/i.png\nBinary files a/i.png and b/i.png differ\n')).toBe('')
  expect(diffHunks('')).toBe('')
})

test('capDiff: a long diff is cut before a hunk, else at a line, never mid-line', () => {
  const hunk = (n: number) => `@@ -${n},1 +${n},1 @@\n-${'a'.repeat(30)}\n+${'b'.repeat(30)}\n`
  const head = '--- a/x\n+++ b/x\n'
  const text = head + hunk(1) + hunk(2) + hunk(3)
  expect(capDiff(text, 10_000)).toEqual({ text, isCut: false })
  const cut = capDiff(text, head.length + hunk(1).length + 20)
  expect(cut).toEqual({ text: head + hunk(1), isCut: true })
  const one = capDiff(head + hunk(1), head.length + 30)
  expect(one.isCut).toBe(true)
  expect(one.text.endsWith('\n')).toBe(true)
  expect(one.text.length).toBeLessThanOrEqual(head.length + 30)
})

test('capDiff: a first hunk over the limit is cut at a line with its header counts rewritten to the lines kept', () => {
  const body = Array.from({ length: 50 }, (_, i) => `+line ${i}`).join('\n')
  const added = `--- /dev/null\n+++ b/a\n@@ -0,0 +1,50 @@\n${body}\n`
  const cut = capDiff(added, 120)
  expect(cut.isCut).toBe(true)
  const lines = cut.text.split('\n')
  lines.pop()
  const kept = lines.filter(l => l.startsWith('+') && !l.startsWith('+++')).length
  expect(kept).toBeGreaterThan(0)
  expect(kept).toBeLessThan(50)
  expect(lines[2]).toBe(`@@ -0,0 +1,${kept} @@`)

  const mixed = '--- a/x\n+++ b/x\n@@ -1,5 +1,5 @@\n ctx one\n-old one\n+new one\n ctx two\n-old two\n+new two\n'
  const two = capDiff(mixed, 60)
  expect(two).toEqual({ text: '--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@\n ctx one\n-old one\n+new one\n', isCut: true })
})

test('additionsDiff: a whole file as one hunk of added lines', () => {
  expect(additionsDiff('notes.md', 'one\r\ntwo\n')).toBe('--- /dev/null\n+++ b/notes.md\n@@ -0,0 +1,2 @@\n+one\n+two\n')
  expect(additionsDiff('a', 'x')).toBe('--- /dev/null\n+++ b/a\n@@ -0,0 +1,1 @@\n+x\n')
  expect(additionsDiff('empty', '')).toBe('')
})

test('parsePerimeter: the entries of an active perimeter on the branch checked out, else nothing', () => {
  const file = 'branch: feat/x\r\nstatus: active\r\n- src/a.ts\r\n- src/b/\r\n-   \r\nnote\r\n'
  expect(parsePerimeter(file, 'feat/x')).toEqual(['src/a.ts', 'src/b/'])
  expect(parsePerimeter(file, 'feat/y')).toBeUndefined()
  expect(parsePerimeter(file.replace('active', 'closed'), 'feat/x')).toBeUndefined()
  expect(parsePerimeter('branch: feat/x\nstatus: active\n', 'feat/x')).toBeUndefined()
  expect(parsePerimeter('{}', 'feat/x')).toBeUndefined()
})

test('parseDefaultBranch: the branch origin/HEAD points at, without the remote', () => {
  expect(parseDefaultBranch('origin/main\n')).toBe('main')
  expect(parseDefaultBranch('origin/release/2026\n')).toBe('release/2026')
  expect(parseDefaultBranch('')).toBeUndefined()
  expect(parseDefaultBranch('upstream/main')).toBeUndefined()
})

test('isGithubRemote: ssh and https URLs of github.com, nothing else', () => {
  const SSH_USER = 'git' // the user part, kept apart so the URLs below are not read as e-mail addresses
  expect(isGithubRemote(`${SSH_USER}@github.com:example/orders.git\n`)).toBe(true)
  expect(isGithubRemote('https://github.com/example/orders')).toBe(true)
  expect(isGithubRemote(`https://${SSH_USER}@github.com/example/orders.git`)).toBe(true)
  expect(isGithubRemote(`ssh://${SSH_USER}@github.com/example/orders.git`)).toBe(true)
  expect(isGithubRemote('https://dev.azure.com/<org>/proj/_git/orders')).toBe(false)
  expect(isGithubRemote(`${SSH_USER}@ssh.dev.azure.com:v3/<org>/proj/orders`)).toBe(false)
  expect(isGithubRemote('https://notgithub.com/example/orders')).toBe(false)
  expect(isGithubRemote('')).toBe(false)
})

// ── Lavoro: the deliver perimeter check and the done-claim log ──

test('checkPerimeter: the changed files no entry covers, as scope-guard --check lists them', () => {
  const entries = ['src/a.ts', 'src/b/', 'tests/**/Orders*.cs']
  const changed = ['src/a.ts', 'src/b/x/y.ts', 'tests/unit/OrdersTests.cs', 'SRC/A.ts', 'src/c.ts', 'README.md', 'docs/plans/x.md', '.git/config', 'src/c.ts']
  // case-insensitive, a directory entry covers its subtree, docs/plans and .git are never outside, a path counts once
  expect(checkPerimeter(changed, entries)).toEqual({ files: 8, outside: ['src/c.ts', 'README.md'] })
  expect(checkPerimeter([], entries)).toEqual({ files: 0, outside: [] })
  expect(checkPerimeter(['a\\b.ts'], ['a/b.ts'])).toEqual({ files: 1, outside: [] })
})

test('parseDoneClaims: the last three log lines, newest first; a line without time or rule is skipped', () => {
  const line = (n: number, rule = 'unproven-row') => JSON.stringify({ at: `2026-10-22T0${n}:00:00.000Z`, session: 's', rule, word: 'fatto', excerpt: `claim ${n}` })
  const text = [line(1), 'not json', line(2, 'tail-truncated'), JSON.stringify({ rule: 'x' }), line(3), line(4), ''].join('\n')
  expect(parseDoneClaims(text).map(c => c.excerpt)).toEqual(['claim 4', 'claim 3', 'claim 2'])
  expect(parseDoneClaims(text)[2]).toEqual({ at: '2026-10-22T02:00:00.000Z', rule: 'tail-truncated', excerpt: 'claim 2' })
  expect(parseDoneClaims('')).toEqual([])
  expect(parseDoneClaims('{}')).toEqual([])
})

test('claimTime: day/month and hour:minute of the log entry, in the local clock', () => {
  expect(claimTime(new Date(2026, 9, 22, 9, 5).toISOString())).toBe('22/10 09:05')
  expect(claimTime('garbage')).toBe('')
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

test('claudeStateSpans: an icon and a word per state, the tool by name, a long name cut', () => {
  expect(spanText(claudeStateSpans(undefined))).toContain('pronto')
  expect(spanText(claudeStateSpans({ kind: 'idle' }))).toContain('pronto')
  expect(spanText(claudeStateSpans({ kind: 'working' }))).toContain('lavora')
  expect(spanText(claudeStateSpans({ kind: 'thinking' }))).toContain('pensa')
  expect(spanText(claudeStateSpans({ kind: 'waiting' }))).toContain('attesa')
  expect(spanText(claudeStateSpans({ kind: 'tool', tool: 'Bash' }))).toContain('Bash')
  const long = spanText(claudeStateSpans({ kind: 'tool', tool: 'mcp__server__a_very_long_tool_name' }))
  expect(long.endsWith('…')).toBe(true)
  expect([...long].length).toBeLessThanOrEqual(16)
})

test('aheadBehindSpans: the commits ahead and behind the upstream, nothing when level or without one', () => {
  const git = { branch: 'x', staged: 0, modified: 0, untracked: 0 }
  expect(spanText(aheadBehindSpans({ ...git, upstream: 'origin/x', ahead: 2, behind: 1 }))).toBe(' ↑2 ↓1')
  expect(spanText(aheadBehindSpans({ ...git, upstream: 'origin/x', ahead: 3, behind: 0 }))).toBe(' ↑3')
  expect(aheadBehindSpans({ ...git, upstream: 'origin/x', ahead: 0, behind: 0 })).toEqual([])
  expect(aheadBehindSpans(git)).toEqual([])
})

test('recordCtxSample: keeps the last six readings and starts over when the context shrinks (a compaction)', () => {
  expect(recordCtxSample(undefined, 100)).toEqual([100])
  expect(recordCtxSample([100, 200], 300)).toEqual([100, 200, 300])
  expect(recordCtxSample([1, 2, 3, 4, 5, 6], 7)).toEqual([2, 3, 4, 5, 6, 7])
  expect(recordCtxSample([100, 200, 300], 50)).toEqual([50])
})

test('autocompactForecast: requests left from the average growth; absent without two readings, a threshold or growth', () => {
  // growth 10k per turn, 60k left to the threshold
  expect(autocompactForecast([100_000, 110_000, 120_000], 180_000)).toBe(6)
  expect(autocompactForecast([100_000, 110_000, 121_000], 180_000)).toBe(6)
  expect(autocompactForecast([100_000], 180_000)).toBeUndefined()
  expect(autocompactForecast(undefined, 180_000)).toBeUndefined()
  expect(autocompactForecast([100_000, 110_000], undefined)).toBeUndefined()
  expect(autocompactForecast([110_000, 110_000], 180_000)).toBeUndefined()
  // past the threshold already
  expect(autocompactForecast([170_000, 190_000], 180_000)).toBe(0)
})

test('tabNeeds: the fast tier is the only one a selected tab asks for (git runs at the medium tier whenever the pane is open)', () => {
  expect(tabNeeds('agents')).toEqual({ fast: true })
  expect(tabNeeds('session')).toEqual({ fast: true })
  expect(tabNeeds('work')).toEqual({ fast: true })
  expect(tabNeeds('repo')).toEqual({ fast: false })
  expect(tabNeeds('context')).toEqual({ fast: false })
  expect(tabNeeds(undefined)).toEqual({ fast: true })
})

test('stateAfterWait: a tool still in flight wins (the held one when it is), else what the wait interrupted', () => {
  expect(stateAfterWait({ kind: 'tool', tool: 'Bash' }, ['Bash', 'Read'])).toEqual({ kind: 'tool', tool: 'Bash' })
  expect(stateAfterWait({ kind: 'tool', tool: 'Bash' }, ['Read'])).toEqual({ kind: 'tool', tool: 'Read' })
  expect(stateAfterWait({ kind: 'thinking' }, ['Read'])).toEqual({ kind: 'tool', tool: 'Read' })
  expect(stateAfterWait({ kind: 'tool', tool: 'Bash' }, [])).toEqual({ kind: 'working' })
  expect(stateAfterWait({ kind: 'thinking' }, [])).toEqual({ kind: 'thinking' })
  expect(stateAfterWait({ kind: 'waiting' }, [])).toEqual({ kind: 'working' })
  expect(stateAfterWait(undefined, [])).toEqual({ kind: 'working' })
})

test('usage counters: summed, new tokens leave the cache reads out, a turn total replaces its steps', () => {
  const step = usageOf({ input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 20 })
  expect(step).toEqual({ input: 10, output: 5, cacheRead: 100, cacheWrite: 20 })
  expect(newTokens(step)).toBe(35)
  expect(newTokens(undefined)).toBe(0)
  const two = addUsage(addUsage(undefined, step), step)
  expect(two).toEqual({ input: 20, output: 10, cacheRead: 200, cacheWrite: 40 })
  // an earlier turn's counters stay, the steps' part is swapped for the turn's own total
  const before = { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 }
  const total = addUsage(before, two)
  expect(settleUsage(total, two, { input: 21, output: 11, cacheRead: 201, cacheWrite: 41 })).toEqual({ input: 22, output: 12, cacheRead: 202, cacheWrite: 42 })
  expect(settleUsage(total, two, undefined)).toEqual(total)
  expect(settleUsage(undefined, undefined, step)).toEqual(step)
})

test('tokenShare and sessionTokens: the share of main, listed agents and the cumulative count of the agents that left the list', () => {
  const agent = (id: string, tokens: number) => ({ id, type: 't', status: 'running' as const, startedAt: 0, tokens })
  expect(sessionTokens({ mainTokens: 500, agents: [agent('a', 100), agent('b', 100)], agentTokens: 300 })).toBe(1000)
  expect(sessionTokens({ agents: [] })).toBe(0)
  expect(tokenShare(250, 1000)).toBe('25%')
  expect(tokenShare(2, 1000)).toBe('<1%')
  expect(tokenShare(0, 1000)).toBe('0%')
  expect(tokenShare(5, 0)).toBeUndefined()
  expect(tokenShare(1500, 1000)).toBe('100%')
})

test('withAgentTokens: the cumulative count grows by the tokens of the agents leaving the list, and stays absent until one does', () => {
  expect(withAgentTokens(undefined, [])).toBeUndefined()
  expect(withAgentTokens(200, [])).toBe(200)
  expect(withAgentTokens(undefined, [{ tokens: 100 }, { tokens: 50 }])).toBe(150)
  expect(withAgentTokens(200, [{ tokens: 50 }])).toBe(250)
})

test('contextOf: the rows and the window, and the top five static consumers over memory files, loaded MCP tools, agents and the skills listing', () => {
  const row = (name: string, tokens: number, kind: 'used' | 'free' | 'buffer' | 'deferred') => ({ name, tokens, color: 'promptBorder', isDeferred: kind === 'deferred', kind })
  const context = contextOf(
    {
      categories: [row('System prompt', 8000, 'used'), row('Messages', 90_000, 'used'), row('Free space', 700_000, 'free')],
      totalTokens: 248_000,
      rawMaxTokens: 1_000_000,
      memoryFiles: [
        { path: '/home/u/.claude/CLAUDE.md', type: 'User', tokens: 3000 },
        { path: '/w/proj/CLAUDE.md', type: 'Project', tokens: 900 },
      ],
      mcpTools: [
        { name: 'mcp__a__big', serverName: 'a', tokens: 5000, isLoaded: true },
        { name: 'mcp__a__off', serverName: 'a', tokens: 9000, isLoaded: false },
      ],
      agents: [
        { agentType: 'code-reviewer', source: 'plugin', tokens: 400 },
        { agentType: 'tiny', source: 'plugin', tokens: 100 },
      ],
      skills: { totalSkills: 60, includedSkills: 41, tokens: 4200, skillFrontmatter: [] },
    },
    false,
  )
  expect(context.rows).toEqual([
    { name: 'System prompt', tokens: 8000, kind: 'used' },
    { name: 'Messages', tokens: 90_000, kind: 'used' },
    { name: 'Free space', tokens: 700_000, kind: 'free' },
  ])
  expect([context.total, context.max, context.isExact]).toEqual([248_000, 1_000_000, false])
  // an unloaded MCP schema is outside the window; the sixth and smallest consumer is cut
  expect(context.consumers).toEqual([
    { name: 'mcp__a__big', kind: 'mcp', tokens: 5000 },
    { name: 'skills', kind: 'skill', tokens: 4200 },
    { name: 'User CLAUDE.md', kind: 'memory', tokens: 3000 },
    { name: 'Project CLAUDE.md', kind: 'memory', tokens: 900 },
    { name: 'code-reviewer', kind: 'agent', tokens: 400 },
  ])
  expect(context.skills).toEqual({ listed: 41, total: 60 })
  // no skill listing: none claimed
  expect(contextOf({ categories: [], totalTokens: 0, rawMaxTokens: 0, memoryFiles: [], mcpTools: [], agents: [] }, true)).toEqual({
    rows: [],
    total: 0,
    max: 0,
    consumers: [],
    isExact: true,
  })
})

test('recordRound keeps the last twenty main-turn contexts, and a shrinking context stays in the series', () => {
  const rounds = Array.from({ length: 25 }, (_, i) => i + 1).reduce<number[]>((all, n) => recordRound(all, n * 1000), [])
  expect(rounds).toHaveLength(20)
  expect(rounds[0]).toBe(6000)
  expect(rounds.at(-1)).toBe(25_000)
  expect(recordRound([200_000], 40_000)).toEqual([200_000, 40_000])
})

test('sparkline: one block per round, scaled to the tallest; empty without rounds', () => {
  expect(sparkline([])).toBe('')
  expect(sparkline([1, 2, 4, 8])).toBe('▂▃▅█')
  expect(sparkline([0, 8])).toBe('▁█')
  expect(sparkline([0, 0])).toBe('▁▁')
})

test('shouldCompact: from 70 % with the last three rounds each growing over 5 %, or with a forecast of 3 requests or fewer', () => {
  const grown = [100, 106, 113, 120] // +6 %, +6.6 %, +6.2 %
  expect(shouldCompact({ percent: 70, rounds: grown })).toBe(true)
  expect(shouldCompact({ percent: 69, rounds: grown })).toBe(false)
  expect(shouldCompact({ percent: 90, rounds: [100, 106, 113, 118] })).toBe(false) // the last grew 4.4 %
  expect(shouldCompact({ percent: 90, rounds: grown.slice(1) })).toBe(false) // only two growths seen
  expect(shouldCompact({ percent: 90, rounds: [100, 100, 100, 100] })).toBe(false)
  expect(shouldCompact({ percent: 10, forecast: 3 })).toBe(true)
  expect(shouldCompact({ percent: 10, forecast: 4 })).toBe(false)
  expect(shouldCompact({})).toBe(false)
})
