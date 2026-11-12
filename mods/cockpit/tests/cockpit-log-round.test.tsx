import { expect, test } from 'claude-code/testing'

import { resumePrompt } from '../hooks/pace'
import type { CockpitLogEntry } from '../types'
import { askPerson, bashResult, callAs, permissionChecks, settleAll, spawnWorkflowAgent, spawns } from './cockpit-fixtures'
import { NOW, dataOf, world } from './cockpit-world'

type Round = CockpitLogEntry & { kind: 'round' }

async function start(on: Parameters<typeof world>[0], dataFile?: object) {
  const writes = new Map<string, string>()
  const clock = world(on, { writes, compacts: true, ...(dataFile && { dataFile: JSON.stringify(dataFile) }) })
  spawns(on)
  permissionChecks(on)
  const seen: Record<string, unknown>[] = []
  on('prompt.submit', (_, e) => {
    seen.push(e as never)
    return { text: e.text }
  })
  on('turn.complete', () => ({ text: '' }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('tool.call', { tool: 'Bash' }, (_, e) => bashResult(e.command.includes('"main"') ? '[main def5678] main' : '[main abc1234] fix the parser'))
  on('tool.call', { tool: 'Edit' }, () => ({ result: {} }))
  on('tool.call', { tool: 'Read' }, () => ({ result: {}, isError: true, text: 'no such file' }))
  return { writes, clock, seen }
}

const logOf = async (clock: { advance: (ms: number) => Promise<void> }, writes: Map<string, string>) => {
  await clock.advance(5000)
  await settleAll()
  return (dataOf(writes)?.sessionLog ?? []) as CockpitLogEntry[]
}
const endTurn = ($: Parameters<Parameters<typeof test>[1]>[0], id = 't') => $.turn.complete({ answer: '', durationMs: 5, isAborted: false, turnId: id, reason: 'answer' })
const submit = ($: Parameters<Parameters<typeof test>[1]>[0], text: string, extra: object = {}) => $.prompt.submit({ text, ...extra } as never)
const roundsOf = (log: CockpitLogEntry[]) => log.filter((e): e is Round => e.kind === 'round')

test('Given a Bash call made by a flow agent, When it logs a commit, Then the entry carries the agent and its run; a main-loop call carries neither', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const { writes, clock } = await start(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await spawnWorkflowAgent($, 'wf_1', 0)
  // When
  await $.tool.call({ tool: 'Bash', command: 'git commit -m "fix the parser"', agentId: 'a1' } as never)
  await $.tool.call({ tool: 'Bash', command: 'npm test', agentId: 'a1' } as never)
  await $.tool.call({ tool: 'Bash', command: 'git commit -m "main"' })
  // Then
  const log = (await logOf(clock, writes)).filter(e => e.kind === 'commit' || e.kind === 'test')
  expect(log.map(e => [e.kind, e.agent, e.runId])).toEqual([['commit', 'a1', 'wf_1'], ['test', 'a1', 'wf_1'], ['commit', undefined, undefined]])
})

test('Given a person submits a prompt with leading spaces and a line break, When the turn completes, Then the round entry prompt is its first line, whitespace collapsed', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const { writes, clock } = await start(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  // When
  await submit($, '  fix\n the   bug')
  await endTurn($)
  // Then
  expect(roundsOf(await logOf(clock, writes)).map(r => r.prompt)).toEqual(['fix'])
})

test('Given a prompt longer than 120 characters or a slash command, When the turn completes, Then the prompt is cut to 120 and the command stores its name', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const { writes, clock } = await start(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  // When
  await submit($, 'x'.repeat(300))
  await endTurn($)
  await clock.advance(1000)
  await submit($, '/commit fix all', { command: { name: 'commit', args: 'fix all' } })
  await endTurn($)
  // Then
  const [long, command] = roundsOf(await logOf(clock, writes))
  expect(long?.prompt).toHaveLength(120)
  expect(command?.prompt).toBe('/commit')
})

test('Given a round with a prompt, When a mid-turn message, a meta submit and the pace resume arrive, Then the prompt stays the first and every submit passes through unchanged', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const { writes, clock, seen } = await start(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const inputs = [{ text: 'first' }, { text: 'second' }, { text: 'meta', isMeta: true }, { text: resumePrompt('/tmp/checkpoint.md') }]
  // When
  for (const input of inputs) await submit($, input.text, input)
  await endTurn($)
  // Then
  expect(seen).toEqual(inputs)
  expect(roundsOf(await logOf(clock, writes)).map(r => r.prompt)).toEqual(['first'])
})

test('Given the main loop edits two files, one call fails and a permission wait lasts 70s, When the turn completes, Then the round entry holds them and the pending fields start over', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const { writes, clock } = await start(on, { history: [], prs: [], sessionLog: [{ at: NOW - 60_000, kind: 'round', n: 4 }], roundSeq: 4 })
  let release = () => {}
  on('tool.call', { tool: 'Write' }, () => new Promise(resolve => void (release = () => resolve({ result: {} }))))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.measure({ context: { window: 1_000_000, tokens: 420_000, percent: 42 }, rateLimits: [], cost: { usd: 1 }, changed: ['context'] })
  // When
  await $.tool.call({ tool: 'Edit', file_path: 'a.ts' } as never)
  await $.tool.call({ tool: 'Read', file_path: 'nope.ts' } as never)
  const write = callAs($, 'w1', { tool: 'Write', file_path: 'b.ts' })
  await settleAll()
  await askPerson($, 'w1')
  await clock.advance(70_000)
  release()
  await write
  await endTurn($)
  await clock.advance(1000)
  await endTurn($, 't2')
  // Then
  const [first, second] = roundsOf(await logOf(clock, writes)).slice(-2)
  expect(first).toMatchObject({ n: 5, files: ['a.ts', 'b.ts'], ctxPct: 42, model: 'claude-opus-5-5', effort: 'high', waits: { n: 1, ms: 70_000 }, fails: { n: 1, list: [{ tool: 'Read', text: 'no such file' }] } })
  expect(second).toMatchObject({ n: 6 })
  expect(second).not.toHaveProperty('files')
  expect(second).not.toHaveProperty('fails')
  expect(second).not.toHaveProperty('waits')
  expect(second).not.toHaveProperty('prompt')
})

test('Given pending round fields in a saved session, When the session loads and saves, Then they come back as they were', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const pending = { roundPrompt: 'fix', roundFiles: ['a.ts'], roundFails: { n: 1, list: [{ tool: 'Read', text: 'no' }] }, roundWaits: { n: 1, ms: 70_000 }, roundSeq: 4 }
  const { writes } = await start(on, { history: [], prs: [], ...pending })
  // When
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  // Then
  expect(dataOf(writes)).toMatchObject(pending)
})

