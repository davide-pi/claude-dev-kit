import { expect, test } from 'claude-code/testing'

import {
  autocompactForecast,
  compactInstructions,
  contextOf,
  ctxGrowth,
  parseCtx,
  recordCtxSample,
  recordRound,
  shouldCompact,
  staticOf,
  withDeltas,
  withStatic,
} from '../hooks/context'

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

test('ctxGrowth: the average growth per turn of the samples; none with fewer than two or a context that does not grow', () => {
  expect(ctxGrowth([100_000, 106_000, 112_000])).toBe(6000)
  expect(ctxGrowth([100_000])).toBeUndefined()
  expect(ctxGrowth(undefined)).toBeUndefined()
  expect(ctxGrowth([100_000, 100_000])).toBeUndefined()
  expect(ctxGrowth([120_000, 100_000])).toBeUndefined()
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
