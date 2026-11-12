import { expect, test } from 'claude-code/testing'

import { usdOf } from '../hooks/pricing'
import { GH_CREATED, SPAWN, bashResult, paneRows, settleAll, spawns } from './cockpit-fixtures'
import { NOW, dataOf, world } from './cockpit-world'

type Logged = { at: number; kind: string; key?: string; text?: string; ms?: number; tokens?: number; after?: number; isFailed?: boolean }

const FAILED = (stdout: string) => ({ ...bashResult(stdout), isError: true })
const ANSWERS: Record<string, object> = {
  'git commit -m "add filter"': bashResult('[main abc1234] add filter\n 1 file changed'),
  'git commit -m "again"': bashResult('[main abc1234] again'),
  'git commit -m "refused"': FAILED('nothing to commit'),
  'npm test': bashResult('all green'),
  'npm test -- --bail': FAILED('1 failing'),
  'npm test && git commit -m "both"': bashResult('[main def5678] both'),
  'npm test && git commit -m "broken"': FAILED('1 failing'),
  'npm test -- --refused': { deny: 'no' },
  'gh pr create --title "Add filter"': bashResult(`${GH_CREATED}\n`),
  'gh pr create --title "Refused"': FAILED('no commits'),
  'az repos pr create --title "Az"': bashResult('{"pullRequestId": 77, "title": "Az"}'),
}

async function start(on: Parameters<typeof world>[0]) {
  const writes = new Map<string, string>()
  const clock = world(on, { writes, compacts: true })
  spawns(on)
  on('turn.complete', () => ({ text: '' }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('tool.call', { tool: 'Bash' }, (_, e) => ANSWERS[e.command] ?? bashResult(''))
  return { writes, clock }
}
const logOf = async (clock: { advance: (ms: number) => Promise<void> }, writes: Map<string, string>) => {
  await clock.advance(5000)
  await settleAll()
  return (dataOf(writes)?.sessionLog ?? []) as Logged[]
}

test('sessionLog: a git commit that exits 0 logs its short hash; the same hash twice is one entry; a failed commit is not logged', { timeoutMs: 30_000 }, async ($, on) => {
  const { writes, clock } = await start(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'git commit -m "add filter"' })
  await $.tool.call({ tool: 'Bash', command: 'git commit -m "again"' })
  await $.tool.call({ tool: 'Bash', command: 'git commit -m "refused"' })
  expect((await logOf(clock, writes)).map(e => [e.kind, e.key])).toEqual([['commit', 'abc1234']])
})

test('sessionLog: a test run is logged ok or failed; a command that is not one is not logged', { timeoutMs: 30_000 }, async ($, on) => {
  const { writes, clock } = await start(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  await $.tool.call({ tool: 'Bash', command: 'npm test -- --bail' })
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect((await logOf(clock, writes)).map(e => [e.kind, e.text, e.isFailed])).toEqual([['test', 'npm test', false], ['test', 'npm test -- --bail', true]])
})

test('sessionLog: a chain logs the test and the commit, the commit only on exit 0', { timeoutMs: 30_000 }, async ($, on) => {
  const { writes, clock } = await start(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'npm test && git commit -m "both"' })
  await $.tool.call({ tool: 'Bash', command: 'npm test && git commit -m "broken"' })
  expect((await logOf(clock, writes)).map(e => [e.kind, e.key ?? e.isFailed])).toEqual([['test', false], ['commit', 'def5678'], ['test', true]])
})

test('sessionLog: a PR create that exits 0 with its URL is logged by its number; a failed one is not', { timeoutMs: 30_000 }, async ($, on) => {
  const { writes, clock } = await start(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'gh pr create --title "Add filter"' })
  await $.tool.call({ tool: 'Bash', command: 'gh pr create --title "Refused"' })
  await $.tool.call({ tool: 'Bash', command: 'az repos pr create --title "Az"' })
  expect((await logOf(clock, writes)).map(e => [e.kind, e.key, e.text])).toEqual([['pr', '42', 'Add filter'], ['pr', '77', 'Az']])
})

test('sessionLog: a main turn end logs a round with its length; a subagent turn logs its agent once', { timeoutMs: 30_000 }, async ($, on) => {
  const { writes, clock } = await start(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.agent.spawn({ ...SPAWN, subagentType: 'reviewer', description: 'x' })
  await $.turn.complete({ answer: '', durationMs: 900, isAborted: false, turnId: 'a1-t', agentId: 'a1', reason: 'answer' })
  await $.turn.complete({ answer: '', durationMs: 4200, isAborted: false, turnId: 'm1', reason: 'answer' })
  expect((await logOf(clock, writes)).map(e => [e.kind, e.ms])).toEqual([['agent', 0], ['round', 4200]])
})

test('sessionLog: a compaction that reports no size logs the context before it at the hook, and the engine reading taken right after fills the entry\'s after', { timeoutMs: 30_000 }, async ($, on) => {
  const { writes, clock } = await start(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.measure({ context: { window: 1_000_000, tokens: 300_000, percent: 30 }, rateLimits: [], cost: { usd: 5 }, changed: ['context'] })
  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'hi', toolUses: [] }] } as never)
  // the world's `$.session.usage()` answers 248K
  expect((await logOf(clock, writes)).filter(e => e.kind === 'compact')).toMatchObject([{ key: 'c1', tokens: 300_000, after: 248_000 }])
})

test('sessionLog: a drop in the context readings is one compaction entry, its after the reading that showed it', { timeoutMs: 30_000 }, async ($, on) => {
  const { writes, clock } = await start(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const measure = (tokens: number) => $.session.measure({ context: { window: 1_000_000, tokens, percent: tokens / 10_000 }, rateLimits: [], cost: { usd: 5 }, changed: ['context'] })
  await measure(300_000)
  await measure(100_000)
  expect((await logOf(clock, writes)).filter(e => e.kind === 'compact')).toMatchObject([{ key: 'c1', tokens: 300_000, after: 100_000 }])
})

test('given an open pane whose session.compact hook the harness skips, when the medium tick passes after a compaction, then the engine reading shows the drop as one compaction entry', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const writes = new Map<string, string>()
  const clock = world(on, { writes, isAutoOpen: true })
  on('session.measure', (_, e) => ({ changed: e.changed }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.measure({ context: { window: 1_000_000, tokens: 900_000, percent: 90 }, rateLimits: [], cost: { usd: 5 }, changed: ['context'] })
  // When: no session.compact reaches the mod; the world's `$.session.usage()` answers 248K
  await clock.advance(10_000)
  // Then
  expect((await logOf(clock, writes)).filter(e => e.kind === 'compact')).toMatchObject([{ key: 'c1', tokens: 900_000, after: 248_000 }])
})

test('given an open pane with a measured cost, when the medium tick reads the context, then the session cost stays the measured one', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const clock = world(on, { isAutoOpen: true })
  on('session.measure', (_, e) => ({ changed: e.changed }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.measure({ context: { window: 1_000_000, tokens: 300_000, percent: 30 }, rateLimits: [], cost: { usd: 9.5 }, changed: ['context', 'cost'] })
  // When: the world's `$.session.usage()` answers $4.82
  await clock.advance(10_000)
  await settleAll()
  // Then
  expect((await paneRows($)).rows.join('\n')).toContain('$9.50')
})

const USAGE = { input_tokens: 1000, output_tokens: 10, cache_read_input_tokens: 9000, cache_creation_input_tokens: 0, model: 'claude-sonnet-5-5' }

test('agentSpend: a finished agent adds its cost to its type; a turn that ends again adds only the change (the sum of the agents\' events); the accumulator is saved with the session', { timeoutMs: 30_000 }, async ($, on) => {
  const { writes, clock } = await start(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.agent.spawn({ ...SPAWN, subagentType: 'reviewer', description: 'x' })
  await $.agent.spawn({ ...SPAWN, subagentType: 'reviewer', description: 'y' })
  const end = (id: string) => $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: `${id}-t`, agentId: id, reason: 'answer', usage: USAGE })
  await end('a1')
  await end('a1')
  await end('a2')
  await clock.advance(5000)
  await settleAll()
  const one = usdOf('claude-sonnet-5-5', { input: 1000, output: 10, cacheRead: 9000, cacheWrite: 0 })
  const spend = dataOf(writes)?.agentSpend as Record<string, number>
  // a1's second end carries a second turn's usage (its event now prices two turns): 2 + 1 turns, never 2 + 2 + 1
  expect(Math.round(spend.reviewer * 1e9)).toBe(Math.round(3 * one * 1e9))
})

test('a saved log and accumulator come back with the session and are written as they were', { timeoutMs: 30_000 }, async ($, on) => {
  const writes = new Map<string, string>()
  const log = [{ at: NOW - 5000, kind: 'commit', key: 'abc1234', text: 'abc1234' }]
  world(on, { writes, dataFile: JSON.stringify({ history: [], prs: [], sessionLog: log, agentSpend: { reviewer: 1.5 } }) })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(dataOf(writes)).toMatchObject({ sessionLog: log, agentSpend: { reviewer: 1.5 } })
})

test('a data file from before the log and the accumulator still loads, and writes neither', { timeoutMs: 30_000 }, async ($, on) => {
  const writes = new Map<string, string>()
  world(on, { writes, dataFile: JSON.stringify({ history: [], prs: [] }) })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(dataOf(writes)).not.toHaveProperty('sessionLog')
  expect(dataOf(writes)).not.toHaveProperty('agentSpend')
})

test('the session log never evicts an agent event: 2 agents and 300 test runs leave the agent spend as it is, and an agent that ends again finds its event', { timeoutMs: 60_000 }, async ($, on) => {
  const { writes, clock } = await start(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const end = (id: string) => $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: `${id}-t`, agentId: id, reason: 'answer', usage: USAGE })
  for (let i = 1; i <= 2; i++) await end(`a${i}`)
  for (let i = 0; i < 300; i++) await $.tool.call({ tool: 'Bash', command: 'npm test' })
  // a1 ends again: only the change is added, which needs its event still in the list; one shared list would hold 2 + 300 > 300 and drop it, and a1 would be counted twice
  await end('a1')
  expect((await logOf(clock, writes)).filter(e => e.kind === 'test')).toHaveLength(300)
  const one = usdOf('claude-sonnet-5-5', { input: 1000, output: 10, cacheRead: 9000, cacheWrite: 0 })
  const spend = Object.values(dataOf(writes)?.agentSpend as Record<string, number>).reduce((a, b) => a + b, 0)
  expect(Math.round(spend * 1e9)).toBe(Math.round(3 * one * 1e9))
})

test('sessionLog: a test command the person refused is not logged', { timeoutMs: 30_000 }, async ($, on) => {
  const { writes, clock } = await start(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'npm test -- --refused' })
  expect(await logOf(clock, writes)).toEqual([])
})

test('Given a compaction that reports its size afterwards, When it stands, Then the context reads that size at once and the log entry gets it as its after', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const writes = new Map<string, string>()
  const clock = world(on, { writes, compacts: true, compactAfter: 120_000 })
  on('session.measure', (_, e) => ({ changed: e.changed }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.measure({ context: { window: 1_000_000, tokens: 300_000, percent: 30 }, rateLimits: [], cost: { usd: 5 }, changed: ['context'] })
  // When
  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'hi', toolUses: [] }] } as never)
  const log = await logOf(clock, writes)
  // Then
  expect((dataOf(writes) as { ctx?: { tokens?: number; percent?: number } } | null)?.ctx).toMatchObject({ tokens: 120_000, percent: 12 })
  expect(log.filter(e => e.kind === 'compact')).toMatchObject([{ key: 'c1', tokens: 300_000, after: 120_000 }])
})

test('Given a compaction that reports no size afterwards, When it stands, Then the context is read again from the engine', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const writes = new Map<string, string>()
  const clock = world(on, { writes, compacts: true, ctxPercent: 9 })
  on('session.measure', (_, e) => ({ changed: e.changed }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.measure({ context: { window: 1_000_000, tokens: 300_000, percent: 30 }, rateLimits: [], cost: { usd: 5 }, changed: ['context'] })
  // When
  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'hi', toolUses: [] }] } as never)
  await logOf(clock, writes)
  // Then
  expect((dataOf(writes) as { ctx?: { percent?: number } } | null)?.ctx?.percent).toBe(9)
})

test('Given tool calls in a round, When the round ends, Then its log entry holds their counts and the next round starts from zero', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const { writes, clock } = await start(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  const end = () => $.turn.complete({ answer: '', durationMs: 5, isAborted: false, turnId: 't', reason: 'answer' })
  // When
  await end()
  await clock.advance(1000)
  await end()
  // Then
  const rounds = (await logOf(clock, writes)).filter(e => e.kind === 'round') as (Logged & { tools?: Record<string, number> })[]
  expect(rounds.map(r => r.tools)).toEqual([{ Bash: 2 }, undefined])
})

test('Given a command that failed twice, When the second call ends, Then the signal is logged once with its time', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const { writes, clock } = await start(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  // When
  await $.tool.call({ tool: 'Bash', command: 'npm test -- --bail' })
  await $.tool.call({ tool: 'Bash', command: 'npm test -- --bail' })
  await $.tool.call({ tool: 'Bash', command: 'npm test -- --bail' })
  // Then
  const signals = (await logOf(clock, writes)).filter(e => e.kind === 'signal')
  expect(signals.map(e => e.key)).toEqual(['failedCommand:npm test -- --bail'])
})
