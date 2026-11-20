import { expect, test } from 'claude-code/testing'

import { isMainEntry } from '../hooks/view-log-round'
import { parseLog } from '../hooks/timeline'
import type { CockpitLogEntry } from '../types'
import { bashResult, mountLanes, settleAll } from './cockpit-fixtures'
import { NOW, dataOf, rowTexts, world } from './cockpit-world'

type Engine = Parameters<Parameters<typeof test>[1]>[0]

async function start(on: Parameters<typeof world>[0], options: { dataFile?: object; failWrites?: () => boolean; sessionId?: () => string } = {}) {
  const writes = new Map<string, string>()
  const { dataFile, ...rest } = options
  const clock = world(on, { writes, ...rest, ...(dataFile && { dataFile: JSON.stringify(dataFile) }) })
  on('tool.call', { tool: 'Bash' }, () => bashResult('[main abc1234] fix'))
  on('prompt.submit', (_, e) => ({ text: e.text ?? '' }))
  return { writes, clock }
}

/** A swallowed error of the engine's own: a prompt with no text makes the submit hook's body throw, and the hook swallows it. */
const swallow = ($: Engine) => $.prompt.submit({} as never).catch(() => undefined)

/** A write that changes the session log: a commit logged by a tool call, then the throttled write. */
const write = async ($: Engine, clock: { advance: (ms: number) => Promise<void> }) => {
  await $.tool.call({ tool: 'Bash', command: 'git commit -m "fix"' })
  await clock.advance(5000)
  await settleAll()
}

const errorsOf = (writes: Map<string, string>) => ((dataOf(writes)?.sessionLog ?? []) as CockpitLogEntry[]).filter(e => e.kind === 'error')

test('Given a site that throws twice, When the next write succeeds, Then the log holds one error entry with key = site and n = 2', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const { writes, clock } = await start(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  // When
  await swallow($)
  await swallow($)
  await write($, clock)
  // Then
  expect(errorsOf(writes).map(e => [e.key, e.n])).toEqual([['register-turn:submit', 2]])
})

test('Given an error entry with n = 5 from before a restart, When the site fails once more and a write succeeds, Then n = 6 on the one entry', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const saved = { at: NOW - 60_000, kind: 'error', key: 'register-turn:submit', n: 5 }
  const { writes, clock } = await start(on, { dataFile: { history: [], prs: [], sessionLog: [saved] } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  // When
  await swallow($)
  await write($, clock)
  // Then
  expect(errorsOf(writes).map(e => [e.key, e.n])).toEqual([['register-turn:submit', 6]])
})

test('Given the flush write fails, When the next write succeeds, Then the pending count was kept and is counted once', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  let isCut = false
  const { writes, clock } = await start(on, { failWrites: () => isCut })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await swallow($)
  await swallow($)
  // When
  isCut = true
  await write($, clock)
  isCut = false
  await write($, clock)
  // Then
  expect(errorsOf(writes).find(e => e.key === 'register-turn:submit')?.n).toBe(2)
})

test('Given a data write the disk refuses, When the next write succeeds, Then the log holds a session-data:write error entry', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  let isCut = false
  const { writes, clock } = await start(on, { failWrites: () => isCut })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  isCut = true
  await write($, clock)
  // When
  isCut = false
  await write($, clock)
  await write($, clock)
  // Then
  expect(errorsOf(writes).find(e => e.key === 'session-data:write')?.n).toBeGreaterThanOrEqual(1)
})

test('Given a data file with an unknown kind, When read, Then that entry is dropped, the rest load and an error entry parses back with key and n', () => {
  // Given
  const raw = [{ at: 1, kind: 'mystery', key: 'x' }, { at: 2, kind: 'error', key: 'events:read', n: 3 }, { at: 3, kind: 'round' }]
  // When
  const log = parseLog(raw)
  // Then
  expect(log?.map(e => e.kind)).toEqual(['error', 'round'])
  expect(log?.[0]).toMatchObject({ key: 'events:read', n: 3 })
})

test('Given pending swallowed errors, When the session switches, Then the next session logs none', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  let id = 's-1'
  const { writes, clock } = await start(on, { sessionId: () => id })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await swallow($)
  // When
  id = 's-2'
  await write($, clock)
  // Then
  const path = [...writes.keys()].find(k => /cockpit-data-s-2\.json$/.test(k)) ?? ''
  const log = (JSON.parse(writes.get(path) ?? 'null')?.sessionLog ?? []) as CockpitLogEntry[]
  expect(log.some(e => e.kind === 'error')).toBe(false)
})

test('Given an error entry, When asked if it is a main entry, Then it is', () => {
  // Given / When / Then
  expect(isMainEntry({ at: 1, kind: 'error', key: 'events:read', n: 2 })).toBe(true)
})

test('Given an error entry in the log, When the Log tab renders, Then a row shows the site and the count', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const log = [{ at: NOW - 60_000, kind: 'error', key: 'events:read', n: 2 }]
  const data = { history: [], prs: [], sessionLog: log }
  const en = world(on, { dataFile: JSON.stringify(data) })
  void en
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  // When
  const ui = await mountLanes($, 70)
  const root = await ui.drawn()
  await ui.unmount()
  // Then
  expect(rowTexts(root).join('\n')).toContain('events:read swallowed 2 errors')
})

test('Given an error entry in the log, When the Log tab renders in Italian, Then the row reads in Italian', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const log = [{ at: NOW - 60_000, kind: 'error', key: 'events:read', n: 2 }]
  world(on, { dataFile: JSON.stringify({ history: [], prs: [], sessionLog: log }), files: { 'cockpit.json': '{"lang":"it"}' } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  // When
  const ui = await mountLanes($, 70)
  const text = rowTexts(await ui.drawn()).join('\n')
  await ui.unmount()
  // Then
  expect(text).toContain('events:read: 2 errori ignorati')
})
