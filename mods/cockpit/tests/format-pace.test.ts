import { expect, test } from 'claude-code/testing'

import { MAX_COMPACT_TRIES, PUSH_MS, compactInstructions, isCompactDue, parseModFile, parsePaceFile, resumePrompt, resumeStep, windowPct } from '../hooks/pace'
import type { ModFile, PaceFile } from '../hooks/pace'

const NOW = Date.parse('2026-11-12T10:00:00Z')
const ARMED = NOW - 3_600_000
const pace = (over: Partial<PaceFile> = {}): PaceFile => ({ sessionId: 's-1', window: 'five_hour', resetsAt: NOW - 120_000, resumeAt: NOW - 1_000, checkpoint: 'C:/repo/.git/deliver/resume-s-1.md', ready: true, armedAt: ARMED, ...over })
const fresh = { five_hour: { kind: 'five_hour', percentUsed: 3 }, seven_day: { kind: 'seven_day', percentUsed: 40 } }
const rates = (five: number, seven: number, fiveReset?: number) => [
  { kind: 'five_hour', percentUsed: five, ...(fiveReset !== undefined && { resetsAt: new Date(fiveReset).toISOString() }) },
  { kind: 'seven_day', percentUsed: seven },
]

test('parsePaceFile: Given the chat file as pace-state.mjs writes it, When parsed, Then its fields come back; another session, a bad shape or no ready are refused or false', () => {
  // Given
  const file = { v: 1, sessionId: 's-1', window: 'seven_day', resetsAt: NOW, resumeAt: NOW + 60_000, checkpoint: 'C:/x.md', ready: true, armedAt: ARMED, compactedAt: ARMED + 5 }
  // When / Then
  expect(parsePaceFile(file, 's-1')).toEqual({ sessionId: 's-1', window: 'seven_day', resetsAt: NOW, resumeAt: NOW + 60_000, checkpoint: 'C:/x.md', ready: true, armedAt: ARMED, compactedAt: ARMED + 5 })
  expect(parsePaceFile(file, 's-2')).toBeUndefined()
  expect(parsePaceFile({ ...file, resumeAt: 'soon' }, 's-1')).toBeUndefined()
  expect(parsePaceFile({ ...file, window: 'daily' }, 's-1')).toBeUndefined()
  expect(parsePaceFile(null, 's-1')).toBeUndefined()
  expect(parsePaceFile({ ...file, ready: 'yes' }, 's-1')?.ready).toBe(false)
})

test('parseModFile: Given the mod file, When parsed, Then only finite times are kept; a torn file is empty', () => {
  // Given / When / Then
  expect(parseModFile({ v: 1, compactedAt: 5, resumedAt: 'x', aliveAt: 7 })).toEqual({ compactedAt: 5, aliveAt: 7 })
  expect(parseModFile('{')).toEqual({})
})

test('isCompactDue: Given a ready chat not compacted since it armed, When asked, Then due; not ready, compacted by the chat or by the mod after arming, or out of tries is not', () => {
  // Given
  const mod: ModFile = {}
  // When / Then
  expect(isCompactDue(pace(), mod, 0)).toBe(true)
  expect(isCompactDue(pace({ ready: false }), mod, 0)).toBe(false)
  expect(isCompactDue(pace({ compactedAt: ARMED }), mod, 0)).toBe(false)
  expect(isCompactDue(pace(), { compactedAt: ARMED + 1 }, 0)).toBe(false)
  expect(isCompactDue(undefined, mod, 0)).toBe(false)
  expect(isCompactDue(pace(), mod, MAX_COMPACT_TRIES)).toBe(false)
  expect(MAX_COMPACT_TRIES).toBe(3)
})

test('isCompactDue: Given a compaction of an earlier arming, When the chat arms again, Then due again', () => {
  // Given / When / Then
  expect(isCompactDue(pace(), { compactedAt: ARMED - 1 }, 0)).toBe(true)
  expect(isCompactDue(pace({ compactedAt: ARMED - 1 }), {}, 0)).toBe(true)
})

test('windowPct: Given a window past its reset, When read, Then 0 whatever the last reading said; a missing window is undefined', () => {
  // Given / When / Then
  expect(windowPct(rates(96, 40, NOW - 1), 'five_hour', NOW)).toBe(0)
  expect(windowPct(rates(96, 40, NOW + 1), 'five_hour', NOW)).toBe(96)
  expect(windowPct(rates(96, 40), 'seven_day', NOW)).toBe(40)
  expect(windowPct([], 'five_hour', NOW)).toBeUndefined()
})

test('resumeStep: Given the resume time come and the windows low, When the chat is idle, Then resume; before resumeAt, not idle, without a file or already resumed it waits', () => {
  // Given
  const low = [fresh.five_hour, fresh.seven_day]
  // When / Then
  expect(resumeStep(pace(), {}, low, NOW, true)).toBe('resume')
  expect(resumeStep(pace({ resumeAt: NOW + 1 }), {}, low, NOW, true)).toBe('wait')
  expect(resumeStep(pace(), {}, low, NOW, false)).toBe('wait')
  expect(resumeStep(undefined, {}, low, NOW, true)).toBe('wait')
  expect(resumeStep(pace(), { resumedAt: ARMED + 1 }, low, NOW, true)).toBe('wait')
  // a resume of an earlier arming does not count
  expect(resumeStep(pace(), { resumedAt: ARMED - 1 }, low, NOW, true)).toBe('resume')
})

test('resumeStep: Given the resume time come, When the new window is at 50% or more, or the other at 98% or more or missing, Then push by ten minutes', () => {
  // Given: a reading of the new window resets after the one the chat armed on
  const next = NOW + 4 * 3_600_000
  // When / Then
  expect(PUSH_MS).toBe(10 * 60_000)
  expect(resumeStep(pace(), {}, rates(50, 40, next), NOW, true)).toBe('push')
  expect(resumeStep(pace(), {}, rates(49.9, 97.9, next), NOW, true)).toBe('resume')
  expect(resumeStep(pace(), {}, rates(10, 98, next), NOW, true)).toBe('push')
  expect(resumeStep(pace({ window: 'seven_day' }), {}, rates(98, 10), NOW, true)).toBe('push')
  expect(resumeStep(pace(), {}, [fresh.five_hour], NOW, true)).toBe('push')
})

test('resumeStep: Given the resume time come, When the reading of the window that reset is the old one or none, Then it reads 0 and resumes', () => {
  // Given / When / Then: the old window's 96%, whether its reset passed or the reading never moved on
  expect(resumeStep(pace(), {}, rates(96, 40, NOW - 1), NOW, true)).toBe('resume')
  expect(resumeStep(pace(), {}, rates(96, 40, NOW - 120_000), NOW, true)).toBe('resume')
  expect(resumeStep(pace(), {}, rates(96, 40), NOW, true)).toBe('resume')
  expect(resumeStep(pace(), {}, [fresh.seven_day], NOW, true)).toBe('resume')
})

test('compactInstructions and resumePrompt: Given the checkpoint, When written, Then the compact keeps its path first and verbatim, and the resume names it as the launcher does', () => {
  // Given
  const path = 'C:/repo/.git/deliver/resume-s-1.md'
  // When
  const text = compactInstructions(path)
  // Then
  expect(text.startsWith(`Checkpoint: ${path}`)).toBe(true)
  expect(resumePrompt(path)).toBe(`The usage window has reset. Read the checkpoint at ${path} and check the real state (git status, the perimeter, the last gate) before you continue. When the work is finished, run pace-state.mjs --done for this session.`)
})
