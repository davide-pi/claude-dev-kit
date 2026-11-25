import { expect, test } from 'claude-code/testing'

import { COMPACT_WAIT_MS, PACE_TICK_MS, resetPaceState } from '../hooks/pace'
import { settleAll } from './cockpit-fixtures'
import { NOW, world } from './cockpit-world'

const CHECKPOINT = '/repo/.git/deliver/resume-s-1.md'
// Armed by the chat: the window reset a second ago, the cron resumes in ten minutes (the mod compacts in between, and never submits).
const paceFile = (over: object = {}) => JSON.stringify({ v: 1, sessionId: 's-1', window: 'five_hour', resetsAt: NOW - 1000, resumeAt: NOW + 600_000, checkpoint: CHECKPOINT, ready: true, armedAt: NOW - 60_000, ...over })
/** The chat's file under both separators: the engine hands the path in the platform's own. */
const armed = (text: string) => ({ 'pace/s-1.json': text, 'pace\\s-1.json': text })
/** Every write of the mod file, in order (the world answers its reads empty, so each write stands alone). */
const modLog = (log: string[]) => log.filter(text => text.startsWith('{"v":1')).map(text => JSON.parse(text) as Record<string, number | undefined>)
const turn = (turnId: string) => ({ answer: '', durationMs: 1, isAborted: false, turnId, reason: 'answer' as const })

test('pace: Given an armed chat whose window reset, When main turns end, Then the mod compacts once with the checkpoint first and writes compactedAt and its heartbeat', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  resetPaceState()
  const instructions: (string | undefined)[] = []
  const log: string[] = []
  const clock = world(on, { files: armed(paceFile()), compacts: true, instructions, log })
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await settleAll()
  // When: a second turn does not compact again, the mod already did for this arming
  await $.turn.complete(turn('t1'))
  await clock.advance(1)
  await settleAll()
  await $.turn.complete(turn('t2'))
  await clock.advance(1)
  await settleAll()
  // Then
  expect(instructions.length).toBe(1)
  expect(instructions[0]?.startsWith(`Checkpoint: ${CHECKPOINT}`)).toBe(true)
  const mods = modLog(log)
  expect(mods.some(m => m.aliveAt !== undefined)).toBe(true)
  // each later write carries it on: one compaction is one value
  expect(new Set(mods.map(m => m.compactedAt).filter(v => v !== undefined)).size).toBe(1)
})

test('pace: Given an armed chat before its reset, When a turn ends with ready set, Then the mod does not compact', { timeoutMs: 30_000 }, async ($, on) => {
  // Given: the window resets in a minute
  resetPaceState()
  const instructions: (string | undefined)[] = []
  const clock = world(on, { files: armed(paceFile({ resetsAt: NOW + 60_000, ready: true })), compacts: true, instructions })
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await settleAll()
  // When
  await $.turn.complete(turn('t1'))
  await clock.advance(30_000)
  await settleAll()
  // Then
  expect(instructions).toEqual([])
})

test('pace: Given an armed chat whose window reset, When an idle tick comes before resumeAt, Then the mod compacts once with the checkpoint instructions and submits no prompt', { timeoutMs: 30_000 }, async ($, on) => {
  // Given: the window resets in a minute, the cron resumes in two
  resetPaceState()
  const instructions: (string | undefined)[] = []
  const submitted: string[] = []
  const clock = world(on, { files: armed(paceFile({ ready: false, resetsAt: NOW + 60_000, resumeAt: NOW + 120_000 })), compacts: true, instructions })
  on('prompt.submit', (_, e) => {
    submitted.push(e.text)
    return { text: e.text }
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await settleAll()
  // When
  await clock.advance(30_000)
  await settleAll()
  const early = instructions.length
  await clock.advance(60_000)
  await settleAll()
  await clock.advance(10 * 60_000)
  await settleAll()
  // Then
  expect(early).toBe(0)
  expect(instructions.length).toBe(1)
  expect(instructions[0]?.startsWith(`Checkpoint: ${CHECKPOINT}`)).toBe(true)
  expect(submitted).toEqual([])
})

test('pace: Given no pace file for the session, When the ticks and a main turn run, Then nothing compacts and no mod file is written', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  resetPaceState()
  const instructions: (string | undefined)[] = []
  const log: string[] = []
  const clock = world(on, { compacts: true, instructions, log })
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  // When
  await $.turn.complete(turn('t1'))
  await clock.advance(5 * 60_000)
  await settleAll()
  // Then
  expect(instructions).toEqual([])
  expect(modLog(log)).toEqual([])
})

test('pace: Given a reset chat whose compaction is vetoed, When the idle ticks keep coming, Then the mod tries three times and stops', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  resetPaceState()
  const instructions: (string | undefined)[] = []
  const clock = world(on, { files: armed(paceFile()), compacts: false, instructions })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await settleAll()
  // When
  for (let i = 0; i < 10; i++) {
    await clock.advance(30_000)
    await settleAll()
  }
  // Then
  expect(instructions.length).toBe(3)
})

test('pace: Given no pace file and the 5h window at 75%, When the tick runs, Then the mod beats so the chat sees the mod alive, and nothing compacts', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  resetPaceState()
  const instructions: (string | undefined)[] = []
  const log: string[] = []
  const clock = world(on, { compacts: true, instructions, log })
  on('session.measure', (_, e) => ({ changed: e.changed }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.measure({ context: { window: 1_000_000, tokens: 1000, percent: 1 }, rateLimits: [{ kind: 'five_hour', percentUsed: 75, resetsAt: new Date(NOW + 3_600_000).toISOString() }, { kind: 'seven_day', percentUsed: 40 }], cost: { usd: 1 }, changed: ['context'] })
  await settleAll()
  // When
  await clock.advance(30_000)
  await settleAll()
  // Then
  expect(modLog(log).some(m => m.aliveAt !== undefined)).toBe(true)
  expect(instructions).toEqual([])
})

test('pace: Given session s-1 compacted, When the chat moves to session s-2 armed before that compaction, Then s-2 compacts too', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  resetPaceState()
  const instructions: (string | undefined)[] = []
  let sid = 's-1'
  const second = paceFile({ sessionId: 's-2' })
  const clock = world(on, { files: { ...armed(paceFile()), 'pace/s-2.json': second, 'pace\\s-2.json': second }, compacts: true, instructions, sessionId: () => sid })
  on('turn.complete', () => ({ text: '' }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.complete(turn('t1'))
  await clock.advance(1)
  await settleAll()
  // When: /clear moves the chat to s-2
  sid = 's-2'
  await $.session.end({ reason: 'clear', sessionId: 's-1', resume: { id: 's-1' } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(PACE_TICK_MS)
  await settleAll()
  // Then
  expect(instructions.length).toBe(2)
})

test('pace: Given a compaction that never answers, When the ticks go on past the wait, Then the heartbeat keeps beating and no second compaction starts', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  resetPaceState()
  const instructions: (string | undefined)[] = []
  const log: string[] = []
  const clock = world(on, { files: armed(paceFile({ resumeAt: NOW + 3_600_000 })), compactHangs: true, instructions, log })
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.complete(turn('t1'))
  await clock.advance(1)
  // When
  await clock.advance(COMPACT_WAIT_MS + 2 * PACE_TICK_MS)
  await settleAll()
  // Then
  expect(modLog(log).some(m => (m.aliveAt ?? 0) > NOW + COMPACT_WAIT_MS)).toBe(true)
  expect(instructions.length).toBe(1)
})
