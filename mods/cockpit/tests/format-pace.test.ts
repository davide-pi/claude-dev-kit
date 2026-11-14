import { expect, test } from 'claude-code/testing'

import { MAX_COMPACT_TRIES, compactInstructions, isCompactDue, isResumePrompt, parseModFile, parsePaceFile, resumePrompt, windowPct } from '../hooks/pace'
import type { ModFile, PaceFile } from '../hooks/pace'

const NOW = Date.parse('2026-11-12T10:00:00Z')
const ARMED = NOW - 3_600_000
const pace = (over: Partial<PaceFile> = {}): PaceFile => ({ sessionId: 's-1', window: 'five_hour', resetsAt: NOW - 120_000, resumeAt: NOW - 1_000, checkpoint: 'C:/repo/.git/deliver/resume-s-1.md', ready: true, armedAt: ARMED, ...over })
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

test('isCompactDue: Given an armed chat whose window reset and resumeAt not come, When asked, Then due whether ready or not; before the reset, after resumeAt, compacted since arming or out of tries is not', () => {
  // Given: reset 2 min ago, the cron resumes in 1 min
  const mod: ModFile = {}
  const armed = pace({ resumeAt: NOW + 60_000 })
  // When / Then
  expect(isCompactDue(armed, mod, 0, NOW)).toBe(true)
  expect(isCompactDue({ ...armed, ready: false }, mod, 0, NOW)).toBe(true)
  expect(isCompactDue({ ...armed, resetsAt: NOW + 1 }, mod, 0, NOW)).toBe(false)
  expect(isCompactDue(armed, mod, 0, NOW + 60_000)).toBe(false)
  expect(isCompactDue({ ...armed, compactedAt: ARMED }, mod, 0, NOW)).toBe(false)
  expect(isCompactDue(armed, { compactedAt: ARMED + 1 }, 0, NOW)).toBe(false)
  expect(isCompactDue(undefined, mod, 0, NOW)).toBe(false)
  expect(isCompactDue(armed, mod, MAX_COMPACT_TRIES, NOW)).toBe(false)
  expect(MAX_COMPACT_TRIES).toBe(3)
})

test('isCompactDue: Given a compaction of an earlier arming, When the chat arms again, Then due again', () => {
  // Given
  const armed = pace({ resumeAt: NOW + 60_000 })
  // When / Then
  expect(isCompactDue(armed, { compactedAt: ARMED - 1 }, 0, NOW)).toBe(true)
  expect(isCompactDue({ ...armed, compactedAt: ARMED - 1 }, {}, 0, NOW)).toBe(true)
})

test('windowPct: Given a window past its reset, When read, Then 0 whatever the last reading said; a missing window is undefined', () => {
  // Given / When / Then
  expect(windowPct(rates(96, 40, NOW - 1), 'five_hour', NOW)).toBe(0)
  expect(windowPct(rates(96, 40, NOW + 1), 'five_hour', NOW)).toBe(96)
  expect(windowPct(rates(96, 40), 'seven_day', NOW)).toBe(40)
  expect(windowPct([], 'five_hour', NOW)).toBeUndefined()
})

test('isResumePrompt: Given the prompt the cron sends, When the mod reads a user input, Then it recognises the resume prefix and not other text', () => {
  // Given / When / Then
  expect(isResumePrompt(resumePrompt('C:/x.md'))).toBe(true)
  expect(isResumePrompt('The usage window has reset. Read the checkpoint at C:/x.md, but first check the credits')).toBe(true)
  expect(isResumePrompt('please continue')).toBe(false)
})

test('compactInstructions and resumePrompt: Given the checkpoint, When written, Then the compact keeps its path first and verbatim, and the resume names it', () => {
  // Given
  const path = 'C:/repo/.git/deliver/resume-s-1.md'
  // When
  const text = compactInstructions(path)
  // Then
  expect(text.startsWith(`Checkpoint: ${path}`)).toBe(true)
  expect(resumePrompt(path)).toBe(`The usage window has reset. Read the checkpoint at ${path} and check the real state (git status, the perimeter, the last gate) before you continue. When the work is finished, run pace-state.mjs --done for this session.`)
})
