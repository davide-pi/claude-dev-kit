import { expect, test } from 'claude-code/testing'

import type { CockpitLogEntry } from '../types'
import { roundCost } from '../hooks/insights'
import { endTurnCost, measuredCost, startedCost, withSettledRound } from '../hooks/refresh'
import { SESSION_LOG_KEEP, flowUsdIn, lastRoundFlowUsd, commitHash, isCommitCommand, isTestCommand, parseLog, recordLog, nextCompactKey, withCompactAfter, withRoundLastUsd, withRoundUsd } from '../hooks/timeline'

test('recordLog: the newest 300 stay, ordered by time; the same kind and key is one entry', () => {
  let log = recordLog(undefined, { at: 20, kind: 'commit', key: 'abc1234', text: 'abc1234' })
  log = recordLog(log, { at: 10, kind: 'round', ms: 5 })
  log = recordLog(log, { at: 30, kind: 'commit', key: 'abc1234', text: 'abc1234' })
  expect(log.map(e => [e.at, e.kind])).toEqual([[10, 'round'], [20, 'commit']])
  // the same key of another kind is another entry
  expect(recordLog(log, { at: 40, kind: 'pr', key: 'abc1234' })).toHaveLength(3)
  let full = log
  for (let i = 0; i < 350; i++) full = recordLog(full, { at: 100 + i, kind: 'round' })
  expect(full).toHaveLength(SESSION_LOG_KEEP)
  expect(SESSION_LOG_KEEP).toBe(300)
  expect(full.at(-1)?.at).toBe(449)
})

test('withCompactAfter: the compact entry of that key takes the reading once, no other entry changes', () => {
  const log = recordLog(recordLog(undefined, { at: 1, kind: 'compact', key: 'c1', tokens: 300_000 }), { at: 2, kind: 'compact', key: 'c2', tokens: 280_000 })
  const filled = withCompactAfter(log, 'c1', 90_000)
  expect(filled.map(e => e.after)).toEqual([90_000, undefined])
  expect(withCompactAfter(filled, 'c1', 10)[0]?.after).toBe(90_000)
  expect(withCompactAfter(log, 'c9', 5)).toEqual(log)
  expect(withCompactAfter(undefined, 'c1', 5)).toBeUndefined()
})

test('withRoundUsd: given a newest round without a cost, when the cost settles, then only that round takes it, once', () => {
  // Given
  const log = recordLog(recordLog(recordLog(undefined, { at: 1, kind: 'round', usd: 0.1 }), { at: 2, kind: 'commit', key: 'abc' }), { at: 3, kind: 'round' })
  // When
  const filled = withRoundUsd(log, 0.7)
  // Then
  expect(filled?.map(e => e.usd)).toEqual([0.1, undefined, 0.7])
  expect(withRoundUsd(filled, 9)?.map(e => e.usd)).toEqual([0.1, undefined, 0.7])
  expect(withRoundUsd(undefined, 1)).toBeUndefined()
  expect(withRoundUsd([{ at: 1, kind: 'commit' }], 1)).toEqual([{ at: 1, kind: 'commit' }])
})

test('parseLog: given a data file written before rounds carried a cost, when read, then the round loads without one', () => {
  // Given / When
  const log = parseLog([{ at: 5, kind: 'round', ms: 1000 }, { at: 6, kind: 'round', ms: 2000, usd: 0.4 }])
  // Then
  expect(log).toEqual([{ at: 5, kind: 'round', ms: 1000 }, { at: 6, kind: 'round', ms: 2000, usd: 0.4 }])
})

test('isTestCommand: a test run by the common runners, alone or in a chain; not a command that only mentions test', () => {
  for (const cmd of ['npm test', 'npm run test -- --bail', 'pnpm test', 'yarn test', 'dotnet test src/A.sln', 'pytest -q', 'claude plugin test mods/cockpit', 'node --test tools/usage-pace.test.mjs', 'go test ./...', 'cargo test', 'npx vitest run', 'cd app && npm test']) {
    expect(isTestCommand(cmd)).toBe(true)
  }
  for (const cmd of ['ls', 'git commit -m "add a test"', 'echo test', 'npm install', 'cat tests.md', 'git status']) {
    expect(isTestCommand(cmd)).toBe(false)
  }
})

test('isCommitCommand and commitHash: a git commit (in a chain too) and the short hash its output prints', () => {
  expect(isCommitCommand('git commit -m "x"')).toBe(true)
  expect(isCommitCommand('npm test && git commit -am y')).toBe(true)
  expect(isCommitCommand('git -C /w commit -m y')).toBe(true)
  expect(isCommitCommand('git status')).toBe(false)
  expect(isCommitCommand('echo git committed')).toBe(false)
  expect(commitHash('[main abc1234] x\n 1 file changed')).toBe('abc1234')
  expect(commitHash('[feat/x (root-commit) 0a1b2c3] first')).toBe('0a1b2c3')
  expect(commitHash('nothing to commit')).toBeUndefined()
})

test('nextCompactKey: after the highest key the log holds, so a resumed session never meets a saved one', () => {
  expect(nextCompactKey(undefined)).toBe('c1')
  const log = recordLog(recordLog(undefined, { at: 1, kind: 'compact', key: 'c1' }), { at: 2, kind: 'compact', key: 'c2' })
  expect(nextCompactKey(log)).toBe('c3')
  expect(nextCompactKey(recordLog(log, { at: 3, kind: 'commit', key: 'c9' }))).toBe('c3')
})

test('Given a data file with agent, signal and tool-count fields and an unknown kind, When parsed, Then the new kinds and fields load and the unknown kind is dropped', () => {
  // Given
  const file = [
    { at: 1, kind: 'agent', key: 'a1', text: 'reviewer', model: 'claude-sonnet-5-5', effort: 'high', usd: 0.5, ms: 4000, isFailed: false },
    { at: 2, kind: 'signal', key: 'failedCommand:npm test', text: 'npm test', n: 3, severity: 'warn' },
    { at: 3, kind: 'round', ms: 10, tools: { Read: 20, Bash: 0, Edit: 'x' } },
    { at: 4, kind: 'mystery', key: 'm' },
  ]
  // When
  const log = parseLog(file)
  // Then
  expect(log).toEqual([
    { at: 1, kind: 'agent', key: 'a1', text: 'reviewer', model: 'claude-sonnet-5-5', effort: 'high', usd: 0.5, ms: 4000, isFailed: false },
    { at: 2, kind: 'signal', key: 'failedCommand:npm test', text: 'npm test', n: 3, severity: 'warn' },
    { at: 3, kind: 'round', ms: 10, tools: { Read: 20 } },
  ])
})

test('parseLog: given a saved log without runId, when it loads, then its entries are unchanged; a runId that is not a string is dropped', () => {
  // Given
  const saved = [{ at: 1, kind: 'agent', key: 'a1', usd: 0.2 }, { at: 2, kind: 'agent', key: 'a2', runId: 'w1' }, { at: 3, kind: 'agent', key: 'a3', runId: 5 }, { at: 4, kind: 'flow', key: 'w1' }]
  // When
  const log = parseLog(saved)
  // Then
  expect(log).toEqual([{ at: 1, kind: 'agent', key: 'a1', usd: 0.2 }, { at: 2, kind: 'agent', key: 'a2', runId: 'w1' }, { at: 3, kind: 'agent', key: 'a3' }, { at: 4, kind: 'flow', key: 'w1' }])
})

test('recordLog: given a flow entry already there, when the same run is recorded again, then it is replaced in place by time; other kinds keep the first', () => {
  // Given
  const log = recordLog(recordLog(undefined, { at: 5, kind: 'flow', key: 'w1', usd: 1 }), { at: 9, kind: 'commit', key: 'abc' })
  // When
  const again = recordLog(log, { at: 12, kind: 'flow', key: 'w1', usd: 2 })
  const same = recordLog(log, { at: 20, kind: 'commit', key: 'abc' })
  // Then
  expect(again.map(e => [e.kind, e.at, e.usd])).toEqual([['commit', 9, undefined], ['flow', 12, 2]])
  expect(same).toHaveLength(2)
  expect(same[1]?.at).toBe(9)
})

test('round cost: given a $1.00 round with a $0.40 flow agent ended inside it, when it is costed, then the round is $0.60 in the header, the turn end and the log', () => {
  // Given
  const log: CockpitLogEntry[] = [{ at: 900, kind: 'agent', key: 'a1', runId: 'w1', usd: 0.4 }, { at: 100, kind: 'agent', key: 'o1', usd: 0.3 }, { at: 1000, kind: 'round', ms: 800 }]
  const cost = { usd: 5, startUsd: 4 }
  // When
  const flow = flowUsdIn(log, 200, 1000)
  // Then
  expect(Math.round(100 * (roundCost(cost, flow) ?? 0))).toBe(Math.round(100 * 0.6))
  expect(Math.round(100 * (endTurnCost(cost, flow).lastUsd ?? 0))).toBe(Math.round(100 * 0.6))
  expect(Math.round(100 * (startedCost(cost, lastRoundFlowUsd(log)).lastUsd ?? 0))).toBe(Math.round(100 * 0.6))
  expect(Math.round(100 * (withRoundUsd(log, 1)?.find(e => e.kind === 'round')?.usd ?? 0))).toBe(Math.round(100 * 0.6))
})

test('round cost: given flow cost larger than the round delta, when it is costed, then the round is 0, never negative, and a measured round is not left waiting', () => {
  // Given
  const log: CockpitLogEntry[] = [{ at: 900, kind: 'agent', key: 'a1', runId: 'w1', usd: 3 }, { at: 1000, kind: 'round', ms: 800 }]
  // When
  const flow = flowUsdIn(log, 200, 1000)
  // Then
  expect(roundCost({ usd: 5, startUsd: 4.5 }, flow)).toBe(0)
  expect(endTurnCost({ usd: 5, startUsd: 4.5 }, flow)).toMatchObject({ lastUsd: 0, pendingUsd: undefined })
  expect(withRoundUsd(log, 0.5)?.find(e => e.kind === 'round')?.usd).toBe(0)
  expect(roundCost({ usd: undefined, startUsd: 4 }, flow)).toBeUndefined()
})

test('round cost: given a flow agent that ended after the round, when the next turn starts, then the header leaves its cost out', () => {
  // Given
  const log: CockpitLogEntry[] = [{ at: 1000, kind: 'round', ms: 800 }, { at: 1500, kind: 'agent', key: 'a1', runId: 'w1', usd: 0.4 }]
  // When
  const started = startedCost({ usd: 5, startUsd: 4, lastUsd: 0.1 }, lastRoundFlowUsd(log))
  // Then
  expect(Math.round(100 * (started.lastUsd ?? 0))).toBe(Math.round(100 * 0.6))
  expect(Math.round(100 * (withRoundUsd(log, 1)?.find(e => e.kind === 'round')?.usd ?? 0))).toBe(Math.round(100 * 0.6))
})

test('round cost: given flow cost that empties a measured round, when the turn ends, then it is settled at 0, not left waiting for the next measure', () => {
  // Given
  const cost = { usd: 5, startUsd: 4.6 }
  // When
  const ended = endTurnCost(cost, 0.4)
  // Then
  expect(ended.pendingUsd).toBeUndefined()
  expect(Math.round(100 * (ended.lastUsd ?? 1))).toBe(0)
})

test('round cost: given a pending round of $1.00 with a $0.40 flow agent, when the measure settles it, then the header and the log both hold $0.60', () => {
  // Given
  const log: CockpitLogEntry[] = [{ at: 1000, kind: 'round', ms: 800 }, { at: 900, kind: 'agent', key: 'a1', runId: 'w1', usd: 0.4 }]
  const next = { cost: { usd: 5, startUsd: 5, lastUsd: 1 }, sessionLog: log } as unknown as Parameters<typeof withSettledRound>[1]
  // When
  const out = withSettledRound({ usd: 4, startUsd: 4, pendingUsd: 4 }, next)
  // Then
  expect(Math.round(100 * (out.cost.lastUsd ?? 0))).toBe(Math.round(100 * 0.6))
  expect(Math.round(100 * (out.sessionLog?.find(e => e.kind === 'round')?.usd ?? 0))).toBe(Math.round(100 * 0.6))
})

test('round cost: given a round settled by a later measure and a flow agent that ended in the idle, when the next turn starts, then the header keeps the settled figure', () => {
  // Given: the measure of 1100 settles the round while only a1 (0.40) had ended
  const log: CockpitLogEntry[] = [{ at: 1000, kind: 'round', ms: 800 }, { at: 900, kind: 'agent', key: 'a1', runId: 'w1', usd: 0.4 }]
  const measured = measuredCost({ usd: 4, startUsd: 4, pendingUsd: 4 }, 5)
  const settled = withSettledRound({ usd: 4, startUsd: 4, pendingUsd: 4 }, { cost: { ...measured, usd: 5 }, sessionLog: log } as unknown as Parameters<typeof withSettledRound>[1])
  // When: a2 (0.30) ends at 1500, after the measure, and the next turn starts at 5.3
  const later = recordLog(log, { at: 1500, kind: 'agent', key: 'a2', runId: 'w1', usd: 0.3 })
  const started = startedCost({ ...settled.cost, usd: 5.3 }, lastRoundFlowUsd(later))
  // Then
  expect(Math.round(100 * (settled.cost.lastUsd ?? 0))).toBe(Math.round(100 * 0.6))
  expect(started.lastUsd).toBe(settled.cost.lastUsd)
  expect(started.isSettled).toBeUndefined()
})

test('round cost: given a turn settled by a measure while the next one ran, when it ends, a late measure comes and the next starts, then the header takes the turn whole less the flow', () => {
  // Given: R1 ended unmeasured, R2 started, the measure of 5 settled R1 while R2 ran
  const r1 = endTurnCost({ usd: 4, startUsd: 4 })
  const r2 = startedCost(r1)
  const measured = measuredCost(r2, 5)
  // When: R2 ends at 6, its last request is measured late at 6.5, R3 starts
  const ended = endTurnCost({ ...measured, usd: 6 }, 0)
  const late = measuredCost(ended, 6.5)
  const r3 = startedCost(late, 0.2)
  // Then
  expect(measured.isSettled).toBe(true)
  expect(ended.isSettled).toBeUndefined()
  expect(Math.round(100 * (r3.lastUsd ?? 0))).toBe(Math.round(100 * 1.3))
})

test('round cost: given a measured round whose flow agent ended after it, when the next turn starts, then the round entry takes the header figure', () => {
  // Given
  const log: CockpitLogEntry[] = [{ at: 1000, kind: 'round', ms: 800, usd: 0.3 }, { at: 1500, kind: 'agent', key: 'a1', runId: 'w1', usd: 0.4 }]
  // When
  const started = startedCost({ usd: 4.4, startUsd: 4, lastUsd: 0.3 }, lastRoundFlowUsd(log))
  const out = withRoundLastUsd(log, started.lastUsd ?? -1)
  // Then
  expect(Math.round(100 * (started.lastUsd ?? 1))).toBe(0)
  expect(out?.find(e => e.kind === 'round')?.usd).toBe(started.lastUsd)
})
