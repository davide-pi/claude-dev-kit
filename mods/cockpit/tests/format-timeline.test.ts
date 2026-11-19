import { expect, test } from 'claude-code/testing'

import type { CockpitLogEntry } from '../types'
import { roundCost } from '../hooks/insights'
import { openRound } from '../hooks/round-capture'
import { endTurnCost, measuredCost, startedCost, withSettledRound } from '../hooks/refresh'
import { EVENTS_KEEP, SESSION_LOG_KEEP, bashLog, recordLogCount, recordAgentEvent, recordEvent, flowUsdIn, lastRoundFlowUsd, commitHash, isCommitCommand, isTestCommand, parseLog, recordLog, nextCompactKey, withLogEntries, withCompactAfter, withRoundLastUsd, withRoundUsd, withLogged } from '../hooks/timeline'

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

test('Given a state with 2 agent events, When more than EVENTS_KEEP test runs are logged the way a Bash call logs them, Then the events ring is untouched and the agent event is still found', () => {
  // Given
  let events = recordAgentEvent(undefined, { at: 1, kind: 'agent', id: 'a1', text: 'reviewer', usd: 0.5 })
  events = recordAgentEvent(events, { at: 2, kind: 'agent', id: 'a2', text: 'reviewer', usd: 0.5 })
  let s: { events?: typeof events, sessionLog?: CockpitLogEntry[] } = { events }
  // When: the same state step register-tools runs after each test run
  for (let i = 0; i <= EVENTS_KEEP; i++) s = withLogEntries(s, [{ at: 100 + i, kind: 'test', text: 'npm test', isFailed: false }])
  // Then
  expect(s.events).toBe(events)
  expect(s.events?.find(e => e.kind === 'agent' && e.id === 'a1')?.usd).toBe(0.5)
  expect(s.sessionLog).toHaveLength(SESSION_LOG_KEEP)
  expect(s.sessionLog?.every(e => e.kind === 'test')).toBe(true)
})

test('Given 2 agent events, When more than EVENTS_KEEP other events share their ring, Then the agent events are the oldest and go first (why test runs have a ring of their own)', () => {
  // Given
  let events = recordAgentEvent(undefined, { at: 1, kind: 'agent', id: 'a1', text: 'reviewer' })
  events = recordAgentEvent(events, { at: 2, kind: 'agent', id: 'a2', text: 'reviewer' })
  // When
  for (let i = 0; i < EVENTS_KEEP; i++) events = recordEvent(events, { at: 100 + i, kind: 'test', text: 'npm test' } as never)
  // Then
  expect(events).toHaveLength(EVENTS_KEEP)
  expect(events.some(e => e.kind === 'agent')).toBe(false)
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

test('bashLog: Given a git commit output with a subject, When logged, Then the commit entry has the hash as key and the subject as text', () => {
  // Given
  const out = '[feat/x abc1234] fix the parser\n 1 file changed, 2 insertions(+)'
  // When
  const entries = bashLog({ command: 'git commit -m "fix the parser"', out, isOk: true, at: 7 })
  // Then
  expect(entries).toEqual([{ at: 7, kind: 'commit', key: 'abc1234', text: 'fix the parser' }])
})

test('parseLog: Given a round entry with every new field, When it is saved and parsed, Then each field comes back equal and the lists keep at most ten', () => {
  // Given
  const round: CockpitLogEntry = {
    at: 9,
    kind: 'round',
    n: 12,
    prompt: 'fix the parser',
    files: ['a.ts', 'b.ts'],
    ctxPct: 42,
    model: 'claude-opus-5-5',
    effort: 'high',
    anchor: 'req-1',
    waits: { n: 1, ms: 70_000, list: [{ tool: 'Bash', ms: 70_000 }] },
    fails: { n: 1, list: [{ tool: 'Read', text: 'no such file' }] },
  }
  const many = Array.from({ length: 12 }, (_, i) => ({ tool: 'Bash', ms: i }))
  // When
  const parsed = parseLog(JSON.parse(JSON.stringify([round, { at: 10, kind: 'round', waits: { n: 12, ms: 5, list: many } }])))
  // Then
  expect(parsed?.[0]).toEqual(round)
  expect(parsed?.[1]?.waits?.list?.length).toBeLessThanOrEqual(10)
})

test('parseLog: Given a round entry with malformed new fields, When parsed, Then each bad field is dropped and the rest stays', () => {
  // Given
  const bad = { at: 9, kind: 'round', ms: 5, prompt: 7, files: 'a.ts', ctxPct: 'high', anchor: 3, waits: { n: 'x' }, fails: [1], agent: 4 }
  // When
  const parsed = parseLog([bad, { at: 11, kind: 'commit', key: 'abc', agent: 'a1', runId: 'wf_1' }])
  // Then
  expect(parsed).toEqual([{ at: 9, kind: 'round', ms: 5 }, { at: 11, kind: 'commit', key: 'abc', runId: 'wf_1', agent: 'a1' }])
})

const fullLog = (): CockpitLogEntry[] => Array.from({ length: SESSION_LOG_KEEP }, (_, i) => ({ at: 1000 + i, kind: 'test' as const, text: `t${i}`, isFailed: true }))

test('Given a log of SESSION_LOG_KEEP entries, When one newer entry is recorded, Then the oldest is dropped and the trimmed count is 1', () => {
  // Given
  const log = fullLog()
  // When
  const out = recordLogCount(log, { at: 5000, kind: 'commit', key: 'abc1234' })
  // Then
  expect(out.log).toHaveLength(SESSION_LOG_KEEP)
  expect(out.log[0]?.text).toBe('t1')
  expect(out.trimmed).toBe(1)
})

test('Given a full log, When an entry older than all kept ones is recorded, Then it is the one dropped and the trimmed count is 1', () => {
  // Given
  const log = fullLog()
  // When
  const out = recordLogCount(log, { at: 1, kind: 'commit', key: 'old' })
  // Then
  expect(out.log.some(e => e.key === 'old')).toBe(false)
  expect(out.log[0]?.text).toBe('t0')
  expect(out.trimmed).toBe(1)
})

test('Given a full log with a flow entry, When the flow entry is recorded again, Then it replaces its node and the trimmed count is 0', () => {
  // Given
  const log = [...fullLog().slice(1), { at: 4000, kind: 'flow' as const, key: 'wf_1', text: 'run' }]
  // When
  const out = recordLogCount(log, { at: 4100, kind: 'flow', key: 'wf_1', text: 'run' })
  // Then
  expect(out.log).toHaveLength(SESSION_LOG_KEEP)
  expect(out.trimmed).toBe(0)
})

test('Given a log with room, When an entry is recorded, Then the trimmed count is 0', () => {
  // Given / When
  const out = recordLogCount(undefined, { at: 1, kind: 'round' })
  // Then
  expect(out.trimmed).toBe(0)
})

// ── The conversation round of a log entry ──

type Open = { sessionLog?: CockpitLogEntry[]; roundSeq?: number; claudeState?: { kind: 'idle' | 'working' } }

test('Given last round 2 and a round open, When a commit is logged, Then it carries round 3', () => {
  // Given
  const s: Open = { roundSeq: 2, claudeState: { kind: 'working' } }
  // When
  const logged = withLogged(s, { at: 10, kind: 'commit', key: 'abc1234' })
  // Then
  expect(openRound(s)).toBe(3)
  expect(logged.sessionLog?.[0]?.round).toBe(3)
})

test('Given a commit run in a Bash call and a round open, When withLogEntries logs it, Then it carries the open round', () => {
  // Given
  const s: Open = { roundSeq: 2, claudeState: { kind: 'working' } }
  const entries = bashLog({ command: 'git commit -m x', out: '[main abc1234] x', isOk: true, at: 10 })
  // When
  const logged = withLogEntries(s, entries)
  // Then
  expect(logged.sessionLog?.map(e => e.round)).toEqual([3])
})

test('Given no round open, When an error is logged, Then it has no round', () => {
  // Given
  const idle: Open = { roundSeq: 2, claudeState: { kind: 'idle' } }
  const fresh: Open = {}
  // When
  const a = withLogged(idle, { at: 10, kind: 'error', key: 'site', n: 1 })
  const b = withLogged(fresh, { at: 10, kind: 'error', key: 'site', n: 1 })
  // Then
  expect(openRound(idle)).toBeUndefined()
  expect(openRound(fresh)).toBeUndefined()
  expect(a.sessionLog?.[0]).not.toHaveProperty('round')
  expect(b.sessionLog?.[0]).not.toHaveProperty('round')
})

test('Given an explicit round, When an entry is logged, Then the explicit round wins; a round entry is left alone', () => {
  // Given
  const s: Open = { roundSeq: 2, claudeState: { kind: 'working' } }
  // When
  const explicit = withLogged(s, { at: 10, kind: 'signal', key: 'k:1' }, 7)
  const own = withLogged(s, { at: 20, kind: 'round', n: 3 })
  // Then
  expect(explicit.sessionLog?.[0]?.round).toBe(7)
  expect(own.sessionLog?.[0]).not.toHaveProperty('round')
})

test('Given an entry already logged with round 3, When the same key is logged in round 4, Then round 3 stays', () => {
  // Given
  const first = withLogged<Open>({ roundSeq: 2, claudeState: { kind: 'working' } }, { at: 10, kind: 'commit', key: 'abc1234' })
  // When
  const again = withLogged<Open>({ ...first, roundSeq: 3 }, { at: 20, kind: 'commit', key: 'abc1234' })
  // Then
  expect(again.sessionLog).toHaveLength(1)
  expect(again.sessionLog?.[0]?.round).toBe(3)
})

test('Given a saved entry with round x, 0, -1 or 1.5, When the log is read, Then the entry has no round; a whole number from 1 on is kept', () => {
  // Given
  const saved = ['x', 0, -1, 1.5].map((round, i) => ({ at: 10 + i, kind: 'commit', round, endRound: round }))
  const good = { at: 50, kind: 'flow', key: 'w1', round: 3, endRound: 5, lane: 0 }
  // When
  const log = parseLog([...saved, good]) ?? []
  // Then
  expect(log.slice(0, 4).map(e => [e.round, e.endRound])).toEqual([[undefined, undefined], [undefined, undefined], [undefined, undefined], [undefined, undefined]])
  expect(log[4]).toMatchObject({ round: 3, endRound: 5, lane: 0 })
})

test('Given a saved flow with lane -1, 1.5 or x, When the log is read, Then it has no lane; lane 0 is kept', () => {
  // Given
  const saved = [-1, 1.5, 'x', 0].map((lane, i) => ({ at: 10 + i, kind: 'flow', key: `w${i}`, lane }))
  // When
  const log = parseLog(saved) ?? []
  // Then
  expect(log.map(e => e.lane)).toEqual([undefined, undefined, undefined, 0])
})