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
  CALLS_KEEP,
  TABS,
  historyTokens,
  parseCreatedPr,
  parseSavedPrs,
  recordCall,
  savedTab,
  toolArg,
  upsertPr,
  safeUrl,
  fmtBytes,
  parseSysLine,
  recordSystem,
  systemOff,
  SYSTEM_KEEP,
  isAzureRemote,
  azureRepo,
  diffHunks,
  capDiff,
  additionsDiff,
  isDefaultBranch,
  pctCell,
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
  activeAlerts,
  parseCtx,
  parseRateCache,
  rangeSparkline,
  staticOf,
  withDeltas,
  withStatic,
  claimsOf,
  ctxGrowth,
  emptyInsights,
  insightHints,
  parseCommits,
  readPathOf,
  editedPathOf,
  parseEdited,
  recordCompaction,
  recordCtxAfter,
  recordEdited,
  repoRelative,
  resultTokens,
  recordRoundEnd,
  recordToolCall,
  recordWait,
  roundCost,
  shade,
  sortProcs,
  subagentShare,
  timeSplit,
  withBackground,
} from '../hooks/format'
import type { Span } from '../hooks/format'
import { INITIAL } from '../hooks/state'

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
  expect(worklogLabel('underTarget', ['2026-10-12', '2026-10-20'])).toBe('worklog: 2d under target (12/10, 20/10)')
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

test('HISTORY_KEEP holds the 300 entries a session with workflows can reach', () => {
  expect(HISTORY_KEEP).toBeGreaterThanOrEqual(300)
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
  expect(almText({ isMapped: false })).toBe('unmapped')
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
    state: 'open',
    isDraft: false,
    review: 'approved',
    checks: { passed: 3, failed: 2, pending: 2 },
  })
  expect(parseGithubPr(json({ reviewDecision: 'CHANGES_REQUESTED', isDraft: true }))).toEqual({ number: 42, title: 'Fix', state: 'open', isDraft: true, review: 'changes' })
  expect(parseGithubPr(json({ url: 'https://github.com/example/orders/pull/42' }))?.url).toBe('https://github.com/example/orders/pull/42')
  expect(parseGithubPr(json({ reviewDecision: 'REVIEW_REQUIRED', statusCheckRollup: [] }))?.review).toBe('pending')
  expect(parseGithubPr(json({ reviewDecision: '' }))?.review).toBeUndefined()
  expect(parseGithubPr(json({ state: 'MERGED' }))?.state).toBe('merged')
  expect(parseGithubPr(json({ state: 'CLOSED' }))?.state).toBe('closed')
  expect(parseGithubPr(json({ state: 'WEIRD' }))).toBeUndefined()
  expect(parseGithubPr(json({ number: 0 }))).toBeUndefined()
  expect(parseGithubPr(json({ number: '42' }))).toBeUndefined()
  expect(parseGithubPr('{}')).toBeUndefined()
  expect(parseGithubPr('not json')).toBeUndefined()
  expect(parseGithubPr('')).toBeUndefined()
})

test('parseAzurePr: the first PR of az repos pr list (active, completed or abandoned), its review from the reviewers votes, no checks', () => {
  const list = (o: object) => JSON.stringify([{ pullRequestId: 7, title: 'Faster', status: 'active', isDraft: false, ...o }])
  expect(parseAzurePr(list({ reviewers: [{ vote: 10 }, { vote: 0 }] }))).toEqual({ number: 7, title: 'Faster', state: 'open', isDraft: false, review: 'approved' })
  expect(parseAzurePr(list({ isDraft: true }))).toEqual({ number: 7, title: 'Faster', state: 'open', isDraft: true })
  expect(parseAzurePr(list({ repository: { webUrl: 'https://dev.azure.com/o/p/_git/r' } }))?.url).toBe('https://dev.azure.com/o/p/_git/r/pullrequest/7')
  expect(parseAzurePr(list({ reviewers: [{ vote: 10 }, { vote: -10 }] }))?.review).toBe('changes')
  expect(parseAzurePr(list({ reviewers: [{ vote: -5 }] }))?.review).toBe('changes')
  expect(parseAzurePr(list({ reviewers: [{ vote: 0 }, { vote: 0 }] }))?.review).toBe('pending')
  expect(parseAzurePr(list({ reviewers: [] }))?.review).toBeUndefined()
  expect(parseAzurePr(list({ status: 'completed' }))?.state).toBe('merged')
  expect(parseAzurePr(list({ status: 'abandoned' }))?.state).toBe('closed')
  expect(parseAzurePr(list({ status: 'notSet' }))).toBeUndefined()
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

test('parseDoneClaims: the log lines that were blocks, newest first, with their session; a line without time or rule, and a rule that only counted, is skipped', () => {
  const line = (n: number, rule = 'unproven-row', session = 's') => JSON.stringify({ at: `2026-10-22T0${n}:00:00.000Z`, session, rule, word: 'fatto', excerpt: `claim ${n}` })
  const text = [line(1), 'not json', line(2, 'tail-cut'), JSON.stringify({ rule: 'x' }), line(3, 'shell-ran'), line(4, 'tail-truncated'), line(5, 'claim-without-evidence', 'other'), ''].join('\n')
  expect(parseDoneClaims(text, 's').map(c => c.excerpt)).toEqual(['claim 2', 'claim 1'])
  expect(parseDoneClaims(text, 's')[0]).toEqual({ at: '2026-10-22T02:00:00.000Z', session: 's', rule: 'tail-cut', excerpt: 'claim 2' })
  expect(parseDoneClaims(text, 'other').map(c => c.excerpt)).toEqual(['claim 5'])
  expect(parseDoneClaims(text, undefined)).toEqual([])
  expect(parseDoneClaims('', 's')).toEqual([])
  expect(parseDoneClaims('{}', 's')).toEqual([])
})

test('parseDoneClaims: the session is filtered before the last entries are kept, so a busy other session cannot push its blocks out', () => {
  const line = (n: number, session: string) => JSON.stringify({ at: new Date(2026, 9, 22, 8, n).toISOString(), session, rule: 'unproven-row', excerpt: `${session} ${n}` })
  const text = [line(1, 'mine'), line(2, 'mine'), ...Array.from({ length: 40 }, (_, i) => line(3 + i, 'busy'))].join('\n')
  expect(parseDoneClaims(text, 'mine').map(c => c.excerpt)).toEqual(['mine 2', 'mine 1'])
  expect(parseDoneClaims(text, 'busy')).toHaveLength(30)
})

test('claimsOf: the last three blocks of the session, newest first; none without a session', () => {
  const claim = (at: string, session?: string) => ({ at, ...(session && { session }), rule: 'unproven-row', excerpt: at })
  const list = [claim('5', 'b'), claim('4', 'a'), claim('3'), claim('2', 'a'), claim('1', 'a'), claim('0', 'a')]
  expect(claimsOf(list, 'a').map(c => c.at)).toEqual(['4', '2', '1'])
  expect(claimsOf(list, 'c')).toEqual([])
  expect(claimsOf(list, undefined)).toEqual([])
  expect(claimsOf(undefined, 'a')).toEqual([])
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
  expect(spanText(claudeStateSpans(undefined))).toContain('ready')
  expect(spanText(claudeStateSpans({ kind: 'idle' }))).toContain('ready')
  expect(spanText(claudeStateSpans({ kind: 'working' }))).toContain('working')
  expect(spanText(claudeStateSpans({ kind: 'thinking' }))).toContain('thinking')
  expect(spanText(claudeStateSpans({ kind: 'waiting' }))).toContain('waiting')
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
  expect(autocompactForecast([100_000, 110_000], 150_000)).toBe(4)
})

test('tabNeeds: the fast tier is the only one a selected tab asks for (git runs at the medium tier whenever the pane is open)', () => {
  expect(tabNeeds('agents')).toEqual({ fast: true })
  expect(tabNeeds('work')).toEqual({ fast: true })
  expect(tabNeeds('system')).toEqual({ fast: false })
  expect(tabNeeds('insights')).toEqual({ fast: false })
  expect(tabNeeds('notes')).toEqual({ fast: false })
  expect(tabNeeds('context')).toEqual({ fast: true }) // the refresh countdown
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
  // biggest first, free space last
  expect(context.rows).toEqual([
    { name: 'Messages', tokens: 90_000, kind: 'used' },
    { name: 'System prompt', tokens: 8000, kind: 'used' },
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

test('savedTab: the six tabs, and the two v2 ones a state file may still hold mapped to where their content went', () => {
  expect(TABS).toEqual(['agents', 'context', 'work', 'insights', 'system', 'notes'])
  for (const tab of TABS) expect(savedTab(tab)).toBe(tab)
  expect(savedTab('session')).toBe('agents')
  expect(savedTab('repo')).toBe('work')
  expect(savedTab('nope')).toBeUndefined()
  expect(savedTab(undefined)).toBeUndefined()
  expect(savedTab(3)).toBeUndefined()
})

test('toolArg: the short argument of a tool call, one line, a file by its name; none when the call carries nothing to show', () => {
  expect(toolArg({ tool: 'Bash', command: 'git  status\n  --short' })).toBe('git status --short')
  expect(toolArg({ tool: 'Read', file_path: '/w/src/orders/Filter.ts' })).toBe('Filter.ts')
  expect(toolArg({ tool: 'Edit', file_path: 'C:\\w\\x.ts', old_string: 'a' })).toBe('x.ts')
  expect(toolArg({ tool: 'Grep', pattern: 'Order' })).toBe('Order')
  expect(toolArg({ tool: 'WebFetch', url: 'https://example.org/a' })).toBe('https://example.org/a')
  expect(toolArg({ tool: 'Agent', description: 'Find the DTOs', prompt: 'long' })).toBe('Find the DTOs')
  expect(toolArg({ tool: 'TodoWrite', todos: [] })).toBeUndefined()
  expect(toolArg({ tool: 'Bash', command: '   ' })).toBeUndefined()
  expect(toolArg({ tool: 'Bash', command: 'x'.repeat(500) })?.length).toBe(120)
})

test('recordCall keeps the last eight calls, newest last', () => {
  let calls = recordCall(undefined, { tool: 'Bash', isOk: true, at: 0 })
  expect(calls).toEqual([{ tool: 'Bash', isOk: true, at: 0 }])
  for (let i = 1; i <= 9; i++) calls = recordCall(calls, { tool: 'Read', arg: String(i), isOk: i % 2 === 0, at: i })
  expect(CALLS_KEEP).toBe(8)
  expect(calls).toHaveLength(8)
  expect(calls.map(c => c.arg)).toEqual(['2', '3', '4', '5', '6', '7', '8', '9'])
})

test('parseCreatedPr: the pull request a gh or az create printed, with the title the command gave; nothing for any other command or output', () => {
  const GH = 'https://github.com/example/orders/pull/42'
  expect(parseCreatedPr('gh pr create --title "Add filter" --body "x"', `Creating...\n${GH}\n`)).toEqual({ number: 42, title: 'Add filter', state: 'open', isDraft: false, url: GH })
  expect(parseCreatedPr("gh pr create -t 'Add filter' --draft", GH)).toEqual({ number: 42, title: 'Add filter', state: 'open', isDraft: true, url: GH })
  expect(parseCreatedPr('gh pr create --fill', GH)?.title).toBe('')
  expect(parseCreatedPr('gh pr create --title "x"', 'no url here')).toBeUndefined()
  expect(parseCreatedPr('gh pr view --title "x"', GH)).toBeUndefined()
  const az = JSON.stringify({ pullRequestId: 9, title: 'Faster', status: 'active', isDraft: false, repository: { webUrl: 'https://dev.azure.com/o/p/_git/r' } })
  expect(parseCreatedPr('az repos pr create --title Faster --source-branch x', az)).toEqual({
    number: 9,
    title: 'Faster',
    state: 'open',
    isDraft: false,
    url: 'https://dev.azure.com/o/p/_git/r/pullrequest/9',
  })
  expect(parseCreatedPr('az repos pr create', JSON.stringify({ pullRequestId: 9, title: 'No web url' }))).toEqual({ number: 9, title: 'No web url', state: 'open', isDraft: false })
  expect(parseCreatedPr('az repos pr create', 'ERROR: failed')).toBeUndefined()
  expect(parseCreatedPr('git status', az)).toBeUndefined()
})

test('upsertPr: a PR seen again replaces its entry in place (by url, else by number); the list keeps the last ten', () => {
  const pr = (number: number, extra: object = {}) => ({ number, title: `t${number}`, state: 'open' as const, isDraft: false, ...extra })
  const first = upsertPr(undefined, pr(1, { url: 'u/1' }))
  const two = upsertPr(first, pr(2))
  expect(upsertPr(two, pr(1, { url: 'u/1', state: 'merged' })).map(p => `${p.number}:${p.state}`)).toEqual(['1:merged', '2:open'])
  // a read without a url still finds the entry that has one
  expect(upsertPr(two, pr(1, { state: 'closed' })).map(p => `${p.number}:${p.state}`)).toEqual(['1:closed', '2:open'])
  // the same number under another url is another PR
  expect(upsertPr(two, pr(1, { url: 'other/1' }))).toHaveLength(3)
  let list = first
  for (let n = 2; n <= 12; n++) list = upsertPr(list, pr(n))
  expect(list.map(p => p.number)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
})

test('parseSavedPrs: the entries of a state file that have a number and a title, any state; none for anything else', () => {
  const ok = { number: 7, title: 'Old', state: 'merged', isDraft: false, url: 'https://github.com/example/orders/pull/7', review: 'approved', checks: { passed: 1, failed: 0, pending: 0 } }
  expect(parseSavedPrs([ok, { number: 'x', title: 't' }, { title: 'no number' }, null, 5])).toEqual([ok])
  expect(parseSavedPrs([{ number: 8, title: 't' }])).toEqual([{ number: 8, title: 't', state: 'open', isDraft: false }])
  expect(parseSavedPrs('nope')).toEqual([])
  expect(parseSavedPrs(undefined)).toEqual([])
})

test('historyTokens: the new tokens of the agents a history lists', () => {
  const h = (tokens: number) => ({ id: String(tokens), type: 't', startedAt: 0, endedAt: 1, tokens, isFailed: false })
  expect(historyTokens([h(3000), h(2000)])).toBe(5000)
  expect(historyTokens([])).toBeUndefined()
  expect(historyTokens(undefined)).toBeUndefined()
})

// ── Cockpit v3, phase 5: the Sistema tab, and the phase 4 follow-ups ──

test('safeUrl: only an http(s) address without control characters; anything else is none', () => {
  expect(safeUrl('https://github.com/example/orders/pull/42')).toBe('https://github.com/example/orders/pull/42')
  expect(safeUrl('HTTP://localhost:3000/x')).toBe('HTTP://localhost:3000/x')
  expect(safeUrl('javascript:alert(1)')).toBeUndefined()
  expect(safeUrl('file:///etc/passwd')).toBeUndefined()
  expect(safeUrl('https://')).toBeUndefined()
  expect(safeUrl('https://example.org/a\u001b]8;;x')).toBeUndefined()
  expect(safeUrl('https://example.org/a\nb')).toBeUndefined()
  expect(safeUrl('https://example.org/a\u007f')).toBeUndefined()
  expect(safeUrl('https://example.org/a\u009b')).toBeUndefined()
  expect(safeUrl('')).toBeUndefined()
  expect(safeUrl(42)).toBeUndefined()
  expect(safeUrl(undefined)).toBeUndefined()
})

test('safeUrl: every source of a PR address goes through it (gh url, az webUrl, gh create output, saved state)', () => {
  const gh = (url: string) => parseGithubPr(JSON.stringify({ number: 1, state: 'OPEN', title: 't', url }))
  expect(gh('https://github.com/example/orders/pull/1')?.url).toBe('https://github.com/example/orders/pull/1')
  expect(gh('javascript:alert(1)')?.number).toBe(1)
  expect(gh('javascript:alert(1)')?.url).toBeUndefined()
  const az = (webUrl: string) => parseAzurePr(JSON.stringify([{ pullRequestId: 7, status: 'active', repository: { webUrl } }]))
  expect(az('https://dev.azure.com/o/p/_git/r')?.url).toBe('https://dev.azure.com/o/p/_git/r/pullrequest/7')
  expect(az('javascript:alert(1)')?.url).toBeUndefined()
  expect(az('ftp://host/r')?.url).toBeUndefined()
  // a refused address costs the link, never the pull request
  expect(az('javascript:alert(1)')?.number).toBe(7)
  expect(az('ftp://host/r')?.number).toBe(7)
  const created = parseCreatedPr('gh pr create --title T', 'https://github.com/a\u001b/b/pull/42')
  expect(created?.number).toBe(42)
  expect(created?.url).toBeUndefined()
  const azCreated = parseCreatedPr('az repos pr create', JSON.stringify({ pullRequestId: 9, repository: { webUrl: 'javascript:x' } }))
  expect(azCreated?.number).toBe(9)
  expect(azCreated?.url).toBeUndefined()
  const saved = parseSavedPrs([{ number: 3, title: 't', url: 'javascript:alert(1)' }, { number: 4, title: 't', url: 'https://example.org/pr/4' }])
  expect(saved.map(p => p.url)).toEqual([undefined, 'https://example.org/pr/4'])
})

test('parseCreatedPr: the title and draft flags are read only from the create command, not from the rest of a compound command', () => {
  const out = 'https://github.com/example/orders/pull/42\n'
  const title = (command: string) => parseCreatedPr(command, out)?.title
  const draft = (command: string) => parseCreatedPr(command, out)?.isDraft
  expect(title('echo --title "Wrong" && gh pr create --title "Right"')).toBe('Right')
  expect(title('gh pr create --fill && git log -t nope --title other')).toBe('')
  expect(title('gh pr create --fill; echo -t nope')).toBe('')
  expect(title('gh pr create -t Short | tee log')).toBe('Short')
  expect(draft('docker run -d x && gh pr create --title T')).toBe(false)
  expect(draft('gh pr create --title T && git branch -d old')).toBe(false)
  expect(draft('git fetch -d || gh pr create --fill')).toBe(false)
  expect(draft('gh pr create --title T --draft')).toBe(true)
  expect(draft('cd repo\ngh pr create -d --title T')).toBe(true)
  // an operator inside a quoted title does not end the command
  expect(title('gh pr create --title "a && b" --draft')).toBe('a && b')
  expect(draft('gh pr create --title "a && b" --draft')).toBe(true)
  expect(title("gh pr create --title 'x; y' --body z")).toBe('x; y')
})

test('parseCreatedPr: a -t or -d inside a quoted argument is text, not a flag', () => {
  const out = 'https://github.com/example/orders/pull/42\n'
  const title = (command: string) => parseCreatedPr(command, out)?.title
  const draft = (command: string) => parseCreatedPr(command, out)?.isDraft
  expect(title('gh pr create --body "fix -t nope" --title Right')).toBe('Right')
  expect(title("gh pr create --body 'see -t nope' --fill")).toBe('')
  expect(draft('gh pr create --title T --body "use -d for a draft"')).toBe(false)
  expect(draft("gh pr create --title T --body 'x -d'")).toBe(false)
  expect(draft('gh pr create --title T --body "x" -d')).toBe(true)
  expect(title('gh pr create --title="a -t b" --draft')).toBe('a -t b')
  expect(title('gh pr create -t "a -d b"')).toBe('a -d b')
  expect(draft('gh pr create -t "a -d b"')).toBe(false)
})

test('toolArg: a search shows its pattern before the folder it looks in', () => {
  expect(toolArg({ tool: 'Grep', pattern: 'Order', path: '/w/src' })).toBe('Order')
  expect(toolArg({ tool: 'Glob', pattern: '**/*.ts', path: '/w/src' })).toBe('**/*.ts')
  expect(toolArg({ tool: 'Grep', path: '/w/src' })).toBe('src')
  expect(toolArg({ tool: 'Read', file_path: '/w/a.ts' })).toBe('a.ts')
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

test('ctxGrowth: the average growth per turn of the samples; none with fewer than two or a context that does not grow', () => {
  expect(ctxGrowth([100_000, 106_000, 112_000])).toBe(6000)
  expect(ctxGrowth([100_000])).toBeUndefined()
  expect(ctxGrowth(undefined)).toBeUndefined()
  expect(ctxGrowth([100_000, 100_000])).toBeUndefined()
  expect(ctxGrowth([120_000, 100_000])).toBeUndefined()
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

test('sortProcs: by the column asked, biggest first, the other column breaking a tie and a value not read yet last', () => {
  const procs = [
    { pid: 1, name: 'a', ports: [], cpu: 5, ram: 100 },
    { pid: 2, name: 'b', ports: [], cpu: 1, ram: 900 },
    { pid: 3, name: 'c', ports: [], ram: 500 },
    { pid: 4, name: 'd', ports: [], cpu: 5, ram: 50 },
  ]
  expect(sortProcs(procs, 'ram').map(p => p.pid)).toEqual([2, 3, 1, 4])
  expect(sortProcs(procs, 'cpu').map(p => p.pid)).toEqual([1, 4, 2, 3])
  expect(procs.map(p => p.pid)).toEqual([1, 2, 3, 4]) // the list given is not touched
  expect(sortProcs([], 'cpu')).toEqual([])
})

test('parseCommits: hash and subject per line, newest first; a line without a tab or a subject is skipped', () => {
  expect(parseCommits('abc1234\tAdd the filter\ndef5678\tFix: a\tb\nnotab\n\n9999999\t \n')).toEqual([
    { hash: 'abc1234', subject: 'Add the filter' },
    { hash: 'def5678', subject: 'Fix: a\tb' },
  ])
  expect(parseCommits('')).toEqual([])
})

test('insights: a round counts its cost where measured, its length and cache hit, and keeps the dearest; the cache hits are the last twenty', () => {
  expect(roundCost({ usd: 5, startUsd: 4.5 })).toBe(0.5)
  expect(roundCost({ usd: 5 })).toBeUndefined()
  expect(roundCost({ usd: 4, startUsd: 5 })).toBeUndefined()
  let ins = recordRoundEnd(undefined, { usd: 0.4, ms: 60_000, cacheShare: 90 })
  ins = recordRoundEnd(ins, { usd: 1.2, ms: 240_000, cacheShare: 40 })
  ins = recordRoundEnd(ins, { ms: 5000 })
  ins = recordRoundEnd(ins, { usd: 0.3, ms: 1000, cacheShare: 70 })
  expect(ins).toMatchObject({ rounds: 4, roundMs: 306_000, costliest: { usd: 1.2, ms: 240_000 }, cacheShares: [90, 40, 70] })
  expect(Math.round(ins.usd * 100)).toBe(190)
  for (let i = 0; i < 25; i++) ins = recordRoundEnd(ins, { ms: 1, cacheShare: i })
  expect(ins.cacheShares).toHaveLength(20)
  expect(ins.cacheShares.at(-1)).toBe(24)
})

test('insights: tool calls are counted by tool with their failures and running time; a successful Read counts its file; names and files are capped', () => {
  let ins = recordToolCall(undefined, { tool: 'Bash', isOk: true, ms: 1000 })
  ins = recordToolCall(ins, { tool: 'Bash', isOk: false, ms: 500 })
  ins = recordToolCall(ins, { tool: 'Read', isOk: true, ms: 10, readPath: '/w/a.ts' })
  ins = recordToolCall(ins, { tool: 'Read', isOk: true, ms: 10, readPath: '/w/a.ts' })
  ins = recordToolCall(ins, { tool: 'Read', isOk: false, ms: 10, readPath: '/w/b.ts' })
  expect(ins.tools).toEqual({ Bash: { calls: 2, failed: 1 }, Read: { calls: 3, failed: 1 } })
  expect(ins.reads).toEqual({ '/w/a.ts': 2 })
  expect(ins.toolMs).toBe(1530)
  let capped = emptyInsights()
  for (let i = 0; i < 60; i++) capped = recordToolCall(capped, { tool: `t${i}`, isOk: true, ms: 0, readPath: `/f${i}` })
  expect(Object.keys(capped.tools)).toHaveLength(40)
  expect(Object.keys(capped.reads)).toHaveLength(60)
  for (let i = 0; i < 300; i++) capped = recordToolCall(capped, { tool: 't0', isOk: true, ms: 0, readPath: `/g${i}` })
  expect(Object.keys(capped.reads)).toHaveLength(200)
  expect(capped.tools.t0?.calls).toBe(301)
  expect(recordToolCall(capped, { tool: 'new', isOk: true, ms: 0 }).tools.new).toBeUndefined()
  expect(readPathOf({ tool: 'Read', file_path: ['', 'w', 'a.ts'].join(String.fromCharCode(92)) })).toBe('/w/a.ts')
  expect(readPathOf({ tool: 'Edit', file_path: '/w/a.ts' })).toBeUndefined()
  expect(readPathOf({ tool: 'Read' })).toBeUndefined()
})

test('insights: the permission waits and the compactions add up; the time splits into model, tools and waiting', () => {
  expect(timeSplit(emptyInsights())).toBeUndefined()
  let ins = recordRoundEnd(undefined, { ms: 100_000 })
  ins = recordToolCall(ins, { tool: 'Bash', isOk: true, ms: 30_000 })
  ins = recordWait(ins, 10_000)
  ins = recordWait(ins, -5)
  ins = recordCompaction(recordCompaction(ins))
  expect(ins).toMatchObject({ waitMs: 10_000, compactions: 2 })
  expect(timeSplit(ins)).toEqual({ model: 60_000, tools: 30_000, wait: 10_000, total: 100_000 })
  // tools that ran side by side can add up to more than the rounds: the total is then theirs
  expect(timeSplit(recordToolCall(ins, { tool: 'Bash', isOk: true, ms: 90_000 }))).toEqual({ model: 0, tools: 120_000, wait: 10_000, total: 130_000 })
})

test('insightHints: each hint shows only while its cause holds', () => {
  const base = { ...INITIAL, sessionId: 's' }
  expect(insightHints(base)).toEqual([])
  const reads = (n: number) => ({ ...emptyInsights(), reads: { '/w/src/a.ts': n, '/w/b.ts': 2 } })
  expect(insightHints({ ...base, insights: reads(5) })).toEqual([])
  expect(insightHints({ ...base, insights: reads(6) })).toEqual([{ kind: 'rereads', file: 'a.ts', count: 6 }])
  const shares = (list: number[]) => ({ ...emptyInsights(), cacheShares: list })
  expect(insightHints({ ...base, insights: shares([10, 20]) })).toEqual([])
  expect(insightHints({ ...base, insights: shares([90, 10, 20, 49]) })).toEqual([{ kind: 'coldCache' }])
  expect(insightHints({ ...base, insights: shares([10, 20, 50]) })).toEqual([])
  const failed = (n: number) => ({ ...emptyInsights(), tools: { Bash: { calls: 20, failed: n }, Read: { calls: 9, failed: 9 } } })
  expect(insightHints({ ...base, insights: failed(6) })).toEqual([])
  expect(insightHints({ ...base, insights: failed(7) })).toEqual([{ kind: 'failures', count: 7 }])
  // subagents over 60 % of the tokens: 600 of 1000 is not over, 610 is
  expect(subagentShare({ mainTokens: 400, agents: [], agentTokens: 600 })).toBe(60)
  expect(insightHints({ ...base, mainTokens: 400, agentTokens: 600 })).toEqual([])
  expect(insightHints({ ...base, mainTokens: 390, agentTokens: 610 })).toEqual([{ kind: 'subagents', share: 61 }])
  expect(subagentShare({ agents: [], mainTokens: undefined, agentTokens: undefined })).toBeUndefined()
  expect(insightHints({ ...base, lastRoundMs: 600_000 })).toEqual([])
  expect(insightHints({ ...base, lastRoundMs: 600_001 })).toEqual([{ kind: 'longRound', ms: 600_001 }])
})

test('activeAlerts: context from 80 %, 5h credits at 10 % left or less, a failed subagent, a PR with red checks; one entry per cause', () => {
  const alerts = (patch: Partial<typeof INITIAL>) => activeAlerts({ ...INITIAL, ...patch }).map(a => a.key)
  expect(alerts({})).toEqual([])
  expect(alerts({ ctx: { percent: 79.9 } })).toEqual([])
  expect(alerts({ ctx: { percent: 80 } })).toEqual(['context'])
  expect(alerts({ rateLimits: [{ kind: 'five_hour', percentUsed: 89 }, { kind: 'seven_day', percentUsed: 99 }] })).toEqual([])
  expect(alerts({ rateLimits: [{ kind: 'five_hour', percentUsed: 90 }] })).toEqual(['credits'])
  const agent = { type: 'reviewer', status: 'done' as const, startedAt: 0, tokens: 0 }
  expect(alerts({ agents: [{ ...agent, id: 'a1' }, { ...agent, id: 'a2', isFailed: true }, { ...agent, id: 'a3', isFailed: false }] })).toEqual(['agent:a2'])
  const pr = { title: 't', state: 'open' as const, isDraft: false }
  expect(alerts({ prs: [{ ...pr, number: 1, checks: { passed: 3, failed: 0, pending: 1 } }, { ...pr, number: 2, checks: { passed: 1, failed: 2, pending: 0 } }, { ...pr, number: 3 }] })).toEqual(['pr:2'])
  const texts = activeAlerts({ ...INITIAL, ctx: { percent: 85.4 }, rateLimits: [{ kind: 'five_hour', percentUsed: 93 }] }).map(a => a.text)
  expect(texts).toEqual(['context at 85%', 'credits 5h: 7% left'])
  const failed = activeAlerts({ ...INITIAL, agents: [{ ...agent, id: 'a9', isFailed: true }], prs: [{ ...pr, number: 5, checks: { passed: 0, failed: 1, pending: 0 } }] }).map(a => a.text)
  expect(failed).toEqual(['subagent reviewer failed', 'PR #5: checks failing'])
})

test('parseSysLine: one JSON line of the monitor, narrowed field by field; a bad line or a bad field is dropped, never thrown', () => {
  expect(parseSysLine('{"cpu":37,"ram":{"used":8,"total":16},"net":{"rx":1200,"tx":40}}')).toEqual({ cpu: 37, ram: { used: 8, total: 16 }, net: { rx: 1200, tx: 40 } })
  expect(parseSysLine('{"cpu":"x","ram":{"used":8},"net":null}')).toEqual({})
  expect(parseSysLine('nope')).toBeUndefined()
  expect(parseSysLine('[1]')).toBeUndefined()
  expect(parseSysLine('')).toBeUndefined()
  expect(parseSysLine('{"procs":[{"pid":1,"name":"node","ports":[3000,"x"]},{"pid":"z","name":"q"},{"pid":2,"name":"dotnet"}]}')).toEqual({
    procs: [
      { pid: 1, name: 'node', ports: [3000] },
      { pid: 2, name: 'dotnet', ports: [] },
    ],
  })
  expect(parseSysLine('{"disk":{"free":10,"total":100,"label":"D:"}}')).toEqual({ disk: { free: 10, total: 100, label: 'D:' } })
  expect(parseSysLine('{"disk":{"free":1}}')).toEqual({})
  expect(parseSysLine('{"off":["net","bogus","procs"]}')).toEqual({ off: ['net', 'procs'] })
})

test('recordSystem: samples go into rings of the last thirty, a part reported off is cleared and marked, a later reading brings it back', () => {
  const first = recordSystem(undefined, { cpu: 10, ram: { used: 4, total: 8 }, net: { rx: 100, tx: 50 } })
  expect(first).toEqual({ cpu: [10], ram: [50], rx: [100], tx: [50], off: [] })
  let s = first
  for (let i = 0; i < 40; i++) s = recordSystem(s, { cpu: i })
  expect(s.cpu).toHaveLength(SYSTEM_KEEP)
  expect(s.cpu.at(-1)).toBe(39)
  expect(s.ram).toEqual([50]) // a line without ram leaves it
  const off = recordSystem(s, { off: ['net'] })
  expect(off.off).toEqual(['net'])
  expect(off.rx).toEqual([])
  expect(off.tx).toEqual([])
  expect(recordSystem(off, { net: { rx: 1, tx: 2 } }).off).toEqual([])
  const slow = recordSystem(first, { procs: [{ pid: 1, name: 'node', ports: [3000] }], disk: { free: 5, total: 10 } })
  expect(slow.procs).toEqual([{ pid: 1, name: 'node', ports: [3000] }])
  expect(recordSystem(slow, { cpu: 1 }).procs).toEqual(slow.procs)
  expect(recordSystem(slow, { off: ['procs'] }).procs).toBeUndefined()
})

test('systemOff: every part marked unavailable, no samples', () => {
  expect(systemOff()).toEqual({ cpu: [], ram: [], rx: [], tx: [], off: ['cpu', 'ram', 'net', 'procs', 'disk'] })
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

test('parseRateCache: the status line cache read as rate limits (resets_at in seconds); a window already over is back to 0 % with no reset; garbage is none', () => {
  const now = 1_700_000_000_000
  expect(parseRateCache({ five_hour: { used_percentage: 40, resets_at: 1_800_000_000 }, seven_day: { used_percentage: 20, resets_at: 1_900_000_000 } }, now)).toEqual([
    { kind: 'five_hour', percentUsed: 40, resetsAt: new Date(1_800_000_000_000).toISOString() },
    { kind: 'seven_day', percentUsed: 20, resetsAt: new Date(1_900_000_000_000).toISOString() },
  ])
  expect(parseRateCache({ five_hour: { used_percentage: 90, resets_at: 1_600_000_000 } }, now)).toEqual([{ kind: 'five_hour', percentUsed: 0 }])
  expect(parseRateCache({ five_hour: { used_percentage: 12 } }, now)).toEqual([{ kind: 'five_hour', percentUsed: 12 }])
  expect(parseRateCache({ five_hour: { used_percentage: 'x', resets_at: 1 }, seven_day: null }, now)).toEqual([])
  expect(parseRateCache('nope', now)).toEqual([])
  expect(parseRateCache(null, now)).toEqual([])
})

test('parseCtx: the context a data file keeps, or none when any number is missing or wrong', () => {
  expect(parseCtx({ tokens: 600_000, window: 1_000_000, percent: 60 })).toEqual({ tokens: 600_000, window: 1_000_000, percent: 60 })
  expect(parseCtx({ tokens: 600_000, window: 1_000_000 })).toBeUndefined()
  expect(parseCtx({ tokens: -1, window: 1, percent: 1 })).toBeUndefined()
  expect(parseCtx('x')).toBeUndefined()
})

const ctxRow = (name: string, tokens: number, kind: 'used' | 'free' | 'buffer' | 'deferred' = 'used') => ({ name, tokens, kind })

test('staticOf and withStatic: the static rows of an exact reading replace the estimate of a later one, Messages stay live, free space gives back what the used rows took', () => {
  const exact = {
    rows: [ctxRow('Messages', 91_000), ctxRow('System prompt', 9500), ctxRow('MCP tools', 4000, 'deferred'), ctxRow('Free space', 690_000, 'free'), ctxRow('Autocompact buffer', 33_000, 'buffer')],
    total: 100_500,
    max: 1_000_000,
    consumers: [{ name: 'User CLAUDE.md', kind: 'memory' as const, tokens: 3000 }],
    skills: { listed: 4, total: 5 },
    isExact: true,
  }
  expect(staticOf(exact)).toEqual({
    rows: [
      { name: 'System prompt', tokens: 9500 },
      { name: 'MCP tools', tokens: 4000 },
    ],
    consumers: exact.consumers,
    skills: { listed: 4, total: 5 },
  })
  const summary = {
    rows: [ctxRow('Messages', 95_000), ctxRow('System prompt', 8000), ctxRow('MCP tools', 3000, 'deferred'), ctxRow('Free space', 700_000, 'free'), ctxRow('Autocompact buffer', 33_000, 'buffer')],
    total: 103_000,
    max: 1_000_000,
    consumers: [],
    isExact: false,
  }
  const merged = withStatic(summary, staticOf(exact))
  expect(merged.rows).toEqual([
    { name: 'Messages', tokens: 95_000, kind: 'used' },
    { name: 'System prompt', tokens: 9500, kind: 'used', isExact: true },
    { name: 'MCP tools', tokens: 4000, kind: 'deferred', isExact: true },
    { name: 'Free space', tokens: 698_500, kind: 'free' },
    { name: 'Autocompact buffer', tokens: 33_000, kind: 'buffer' },
  ])
  expect([merged.total, merged.isExact, merged.consumers, merged.skills]).toEqual([104_500, false, exact.consumers, { listed: 4, total: 5 }])
})

test('withDeltas: a round read stamps each row with its change from the reading before; any other read keeps the deltas it had', () => {
  const before = { rows: [ctxRow('Messages', 91_000), ctxRow('System prompt', 9500)], total: 100_500, max: 1_000_000, consumers: [], isExact: false }
  const next = { ...before, rows: [ctxRow('Messages', 95_000), ctxRow('System prompt', 9500), ctxRow('Skills', 2000)] }
  const round = withDeltas(next, before, true)
  expect(round.rows.map(r => r.delta)).toEqual([4000, 0, undefined])
  const later = withDeltas({ ...next, rows: [ctxRow('Messages', 96_000), ctxRow('System prompt', 9500), ctxRow('Skills', 2000)] }, round, false)
  expect(later.rows.map(r => r.delta)).toEqual([4000, 0, undefined])
  expect(withDeltas(next, undefined, true).rows.map(r => r.delta)).toEqual([undefined, undefined, undefined])
})

test('parseSysLine: a process carries its CPU share and working set when they are counts', () => {
  expect(parseSysLine('{"procs":[{"pid":1,"name":"node","ports":[],"cpu":12.5,"ram":1048576},{"pid":2,"name":"x","cpu":"hi","ram":-1}]}')).toEqual({
    procs: [
      { pid: 1, name: 'node', ports: [], cpu: 12.5, ram: 1048576 },
      { pid: 2, name: 'x', ports: [] },
    ],
  })
})

// ── Cockpit v2 follow-ups ──

test('recordToolCall: keeps the five largest results (tool, argument, tokens), biggest first, and the last failure on one line', () => {
  let ins = recordToolCall(undefined, { tool: 'Read', isOk: true, ms: 0, arg: 'a.ts', tokens: 10 })
  for (const tokens of [50, 30, 40, 20, 60]) ins = recordToolCall(ins, { tool: 'Grep', isOk: true, ms: 0, tokens })
  expect(ins.biggest?.map(b => b.tokens)).toEqual([60, 50, 40, 30, 20])
  expect(ins.biggest?.[0]).toEqual({ tool: 'Grep', tokens: 60 })
  expect(recordToolCall(undefined, { tool: 'Bash', isOk: true, ms: 0, tokens: 0 }).biggest).toBeUndefined()
  expect(ins.lastError).toBeUndefined()
  ins = recordToolCall(ins, { tool: 'Bash', isOk: false, ms: 0, error: 'exit 1\n  boom   here ' })
  expect(ins.lastError).toEqual({ tool: 'Bash', text: 'exit 1 boom here' })
  expect(recordToolCall(ins, { tool: 'Bash', isOk: true, ms: 0 }).lastError).toEqual(ins.lastError)
  expect(recordToolCall(ins, { tool: 'Bash', isOk: false, ms: 0, error: 'x'.repeat(500) }).lastError?.text).toHaveLength(200)
})

test('resultTokens: the characters of the text over four, rounded up; the JSON of the result when there is no text', () => {
  expect(resultTokens({ text: 'x'.repeat(10) })).toBe(3)
  expect(resultTokens({ result: { a: 'xxxx' } })).toBe(3)
  expect(resultTokens({})).toBe(0)
})

test('recordCompaction / recordCtxAfter: the context before each compaction, the first reading after it, the last three', () => {
  let ins = recordCompaction(undefined, 400_000)
  expect(ins.compactCtx).toEqual([{ before: 400_000 }])
  expect(recordCtxAfter(ins, 400_000)).toBe(ins) // the reading the compaction started from
  expect(recordCtxAfter(ins, undefined)).toBe(ins)
  ins = recordCtxAfter(ins, 38_000) ?? ins
  expect(ins.compactCtx).toEqual([{ before: 400_000, after: 38_000 }])
  expect(recordCtxAfter(ins, 90_000)).toBe(ins) // only the first one
  for (const before of [1, 2, 3]) ins = recordCompaction(ins, before * 1000)
  expect(ins.compactCtx?.map(c => c.before)).toEqual([1000, 2000, 3000])
  expect(ins.compactions).toBe(4)
  expect(recordCompaction(undefined).compactCtx).toBeUndefined()
  expect(recordCtxAfter(undefined, 5)).toBeUndefined()
})

test('editedPathOf / recordEdited / repoRelative / parseEdited: the files an edit call writes, once each, made relative to the checkout', () => {
  expect(editedPathOf({ tool: 'Edit', file_path: '/w/a.ts' })).toBe('/w/a.ts')
  expect(editedPathOf({ tool: 'Write', file_path: ['', 'w', 'b.ts'].join(String.fromCharCode(92)) })).toBe('/w/b.ts')
  expect(editedPathOf({ tool: 'MultiEdit', file_path: '/w/c.ts' })).toBe('/w/c.ts')
  expect(editedPathOf({ tool: 'NotebookEdit', notebook_path: '/w/n.ipynb' })).toBe('/w/n.ipynb')
  expect(editedPathOf({ tool: 'Read', file_path: '/w/a.ts' })).toBeUndefined()
  expect(editedPathOf({ tool: 'Edit', file_path: '' })).toBeUndefined()
  expect(recordEdited(recordEdited(undefined, '/w/a.ts'), '/w/a.ts')).toEqual(['/w/a.ts'])
  expect(recordEdited(Array.from({ length: 200 }, (_, i) => `/f${i}`), '/new').at(-1)).toBe('/new')
  expect(recordEdited(Array.from({ length: 200 }, (_, i) => `/f${i}`), '/new')).toHaveLength(200)
  expect(repoRelative('/w/repo', '/w/repo/src/a.ts')).toBe('src/a.ts')
  expect(repoRelative('/w/repo/', '/w/repo/src/a.ts')).toBe('src/a.ts')
  expect(repoRelative('/W/Repo', '/w/repo/src/a.ts')).toBe('src/a.ts')
  expect(repoRelative('/w/repo', '/w/repo2/a.ts')).toBeUndefined()
  expect(repoRelative(undefined, '/w/repo/a.ts')).toBeUndefined()
  expect(parseEdited(['/a', 7, '', '/b'])).toEqual(['/a', '/b'])
  expect(parseEdited('x')).toBeUndefined()
  expect(parseEdited([])).toBeUndefined()
})
