import { expect, test } from 'claude-code/testing'

import { isLinkShown, placeMarker, resetAnchors, scrollToAnchor } from '../hooks/round-anchor'
import { setLang } from '../hooks/strings'
import type { CockpitLogEntry } from '../types'
import { bashResult, permissionChecks, settleAll, spawns } from './cockpit-fixtures'
import { dataOf, world } from './cockpit-world'

type Hooks = Parameters<typeof world>[0]

async function start(on: Hooks, options: { dataFile?: object; files?: Record<string, string> } = {}) {
  resetAnchors()
  setLang('en')
  const writes = new Map<string, string>()
  const placed: string[] = []
  const clock = world(on, { writes, compacts: true, ...(options.dataFile && { dataFile: JSON.stringify(options.dataFile) }), ...(options.files && { files: options.files }) })
  spawns(on)
  permissionChecks(on)
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('turn.complete', () => ({ text: '' }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('tool.call', { tool: 'Bash' }, () => bashResult('ok'))
  on('ui.place', (_, e) => {
    placed.push(e.id)
    return { value: { isPlaced: true, requestId: `req-${e.id}` } }
  })
  return { writes, clock, placed }
}

type Session = Parameters<Parameters<typeof test>[1]>[0]
const oneRound = async ($: Session, clock: { advance: (ms: number) => Promise<void> }, writes: Map<string, string>) => {
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text: 'first' } as never)
  await $.prompt.submit({ text: 'second' } as never)
  await $.turn.complete({ answer: '', durationMs: 5, isAborted: false, turnId: 't', reason: 'answer' })
  await clock.advance(5000)
  await settleAll()
  return ((dataOf(writes)?.sessionLog ?? []) as CockpitLogEntry[]).filter(e => e.kind === 'round')
}

test('Given two prompts in one round, When the turn completes, Then one marker was placed and the round entry names it as its anchor', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const { writes, clock, placed } = await start(on)
  // When
  const rounds = await oneRound($, clock, writes)
  // Then
  expect(placed).toEqual(['round-1'])
  expect(rounds.map(r => r.anchor)).toEqual(['req-round-1'])
})

/** An engine whose scroll answers `answer`; the test world has none for a transcript row, so the call is observed here. */
const fakeEngine = (answer: object, calls: unknown[]) =>
  ({
    ui: {
      place: async ({ id }: { id: string }) => ({ isPlaced: true, requestId: `req-${id}` }),
      scroll: async (args: unknown) => (calls.push(args), answer),
      invalidate: () => undefined,
    },
  }) as never

test('Given a round with a marker placed by this process, When its link is pressed, Then the chat scrolls to that marker', async () => {
  // Given
  resetAnchors()
  const calls: unknown[] = []
  const $ = fakeEngine({}, calls)
  const anchor = (await placeMarker($, 1)) ?? ''
  // When
  await scrollToAnchor($, anchor)
  // Then
  expect(calls).toEqual([{ to: { requestId: 'req-round-1' } }])
  expect(isLinkShown(anchor)).toBe(true)
})

test('Given an engine that denies the scroll, When the link is pressed, Then no link shows for the rest of the session', async () => {
  // Given
  resetAnchors()
  const $ = fakeEngine({ deny: 'not person-initiated' }, [])
  const anchor = (await placeMarker($, 1)) ?? ''
  const other = (await placeMarker($, 2)) ?? ''
  // When
  await scrollToAnchor($, anchor)
  // Then
  expect(isLinkShown(anchor)).toBe(false)
  expect(isLinkShown(other)).toBe(false)
})

