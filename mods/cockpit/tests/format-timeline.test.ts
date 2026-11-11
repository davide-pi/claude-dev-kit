import { expect, test } from 'claude-code/testing'

import { SESSION_LOG_KEEP, commitHash, isCommitCommand, isTestCommand, parseLog, recordLog, nextCompactKey, withCompactAfter, withRoundUsd } from '../hooks/timeline'

test('recordLog: the newest hundred stay, ordered by time; the same kind and key is one entry', () => {
  let log = recordLog(undefined, { at: 20, kind: 'commit', key: 'abc1234', text: 'abc1234' })
  log = recordLog(log, { at: 10, kind: 'round', ms: 5 })
  log = recordLog(log, { at: 30, kind: 'commit', key: 'abc1234', text: 'abc1234' })
  expect(log.map(e => [e.at, e.kind])).toEqual([[10, 'round'], [20, 'commit']])
  // the same key of another kind is another entry
  expect(recordLog(log, { at: 40, kind: 'pr', key: 'abc1234' })).toHaveLength(3)
  let full = log
  for (let i = 0; i < 150; i++) full = recordLog(full, { at: 100 + i, kind: 'round' })
  expect(full).toHaveLength(SESSION_LOG_KEEP)
  expect(SESSION_LOG_KEEP).toBe(100)
  expect(full.at(-1)?.at).toBe(249)
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
  for (const cmd of ['npm test', 'npm run test -- --bail', 'pnpm test', 'yarn test', 'dotnet test src/A.sln', 'pytest -q', 'claude plugin test mods/cockpit', 'node --test tools/x.test.mjs', 'go test ./...', 'cargo test', 'npx vitest run', 'cd app && npm test']) {
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
