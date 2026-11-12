import { expect, test } from 'claude-code/testing'

import {
  compactInstructions,
  parseCtx,
  recordRound,
} from '../hooks/context'

// ── Compaction instructions, the worklog scope, the deliver perimeter ──

const KEEP =
  "Keep: tasks in progress, decisions made with the user and why, open questions, files touched and their state, commands with the output line that settles them, next steps. Don't keep: tool output that's already summarised, superseded attempts."

const task = (id: string, subject: string, status: 'pending' | 'in_progress' | 'completed') => ({ id, subject, status })

test('compactInstructions: the keep/drop sentence alone when nothing else is known', () => {
  expect(compactInstructions({})).toBe(KEEP)
  expect(compactInstructions({ tasks: [], perimeter: [] })).toBe(KEEP)
  // finished tasks are not open
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
  expect(text).toContain('Open tasks: in corso; primo pending; terzo.')
  expect(text).not.toContain('quarto')
  expect(text).not.toContain('chiuso')
  expect(text).toContain('Deliver perimeter (4 entries): src/a.ts, src/b/.')
  expect(text).not.toContain('tests/**/a*.ts')
  expect(text).not.toContain('docs/x.md')
  expect(text).not.toContain('Running workflow')
  expect(text.length).toBeLessThanOrEqual(400)
})

test('compactInstructions: a running workflow is named last, and only when it fits', () => {
  expect(compactInstructions({ workflow: 'release-notes' })).toBe(`${KEEP} Running workflow: release-notes.`)
  expect(compactInstructions({ tasks: [task('1', 'in corso', 'in_progress')], perimeter: ['a.ts'], workflow: 'wf' })).toBe(
    `${KEEP} Open tasks: in corso. Deliver perimeter (1 entry): a.ts. Running workflow: wf.`,
  )
  const text = compactInstructions({ workflow: 'w'.repeat(500) })
  expect(text.startsWith(KEEP)).toBe(true)
  expect([...text].length).toBeLessThanOrEqual(400)
})

test('compactInstructions: each part is optional, and long titles never push it past 400 characters', () => {
  expect(compactInstructions({ perimeter: ['a.ts'] })).toBe(`${KEEP} Deliver perimeter (1 entry): a.ts.`)
  const long = 'x'.repeat(200)
  const text = compactInstructions({
    tasks: [task('1', long, 'in_progress'), task('2', long, 'pending'), task('3', long, 'pending')],
    perimeter: [long, long, long],
  })
  expect(text.length).toBeLessThanOrEqual(400)
  expect(text.startsWith(KEEP)).toBe(true)
})

test('recordRound keeps the last twenty main-turn contexts, and a shrinking context stays in the series', () => {
  const rounds = Array.from({ length: 25 }, (_, i) => i + 1).reduce<number[]>((all, n) => recordRound(all, n * 1000), [])
  expect(rounds).toHaveLength(20)
  expect(rounds[0]).toBe(6000)
  expect(rounds.at(-1)).toBe(25_000)
  expect(recordRound([200_000], 40_000)).toEqual([200_000, 40_000])
})

test('parseCtx: the context a data file keeps, or none when any number is missing or wrong', () => {
  expect(parseCtx({ tokens: 600_000, window: 1_000_000, percent: 60 })).toEqual({ tokens: 600_000, window: 1_000_000, percent: 60 })
  expect(parseCtx({ tokens: 600_000, window: 1_000_000 })).toBeUndefined()
  expect(parseCtx({ tokens: -1, window: 1, percent: 1 })).toBeUndefined()
  expect(parseCtx('x')).toBeUndefined()
})

