import { expect, test } from 'claude-code/testing'

import { isLinkShown, placeMarker, resetAnchors, scrollToAnchor } from '../hooks/round-anchor'
import { textCells } from '../hooks/shared'
import { setLang } from '../hooks/strings'
import type { CockpitLogEntry } from '../types'
import { bashResult, mountPane, permissionChecks, settleAll, spawns } from './cockpit-fixtures'
import { NOW, dataOf, rowTexts, world } from './cockpit-world'

const LINK = '\u{F0337}'
type Hooks = Parameters<typeof world>[0]

async function start(on: Hooks, options: { dataFile?: object } = {}) {
  resetAnchors()
  setLang('en')
  const writes = new Map<string, string>()
  const placed: string[] = []
  const clock = world(on, { writes, compacts: true, ...(options.dataFile && { dataFile: JSON.stringify(options.dataFile) }) })
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

test('Given two prompts in one round, When the turn completes, Then one marker was placed and the round entry names it as its anchor', async ($, on) => {
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

test('Given a pane whose engine cannot scroll to the placed row, When its link is pressed, Then the links are hidden', async ($, on) => {
  // Given
  const { writes, clock } = await start(on)
  const [round] = await oneRound($, clock, writes)
  const ui = await mountPane($, 70)
  // When
  await ui.press({ key: `done:${round?.at}:link` })
  await settleAll()
  // Then
  expect(rowTexts(await ui.drawn()).join('\n')).not.toContain(LINK)
  await ui.unmount()
})

test('Given a round with a placed anchor and one without, When drawn, Then the figures of both second lines end at the same column', async ($, on) => {
  // Given: an older round saved with figures, then a round this process places a marker for
  const old = { at: NOW - 300_000, kind: 'round', n: 1, ms: 61_000, usd: 0.3, prompt: 'old', model: 'claude-sonnet-5-5' }
  const { writes, clock } = await start(on, { dataFile: { history: [], prs: [], sessionLog: [old] } })
  await oneRound($, clock, writes)
  // When
  const ui = await mountPane($, 70)
  const rows = rowTexts(await ui.drawn()).map(r => r.trimEnd())
  await ui.unmount()
  // Then
  const ends = rows.flatMap(r => {
    const m = /\d\dm\d\ds/.exec(r)
    return m === null ? [] : [textCells(r.slice(0, m.index + m[0].length))]
  })
  expect(rows.filter(r => r.includes(LINK))).toHaveLength(1)
  expect(ends.length, rows.join('\n')).toBe(2)
  expect(new Set(ends).size, rows.join('\n')).toBe(1)
})

test('Given a round saved with an anchor an earlier process placed, When drawn, Then it shows no link', async ($, on) => {
  // Given
  await start(on, { dataFile: { history: [], prs: [], sessionLog: [{ at: 1, kind: 'round', n: 1, prompt: 'old', anchor: 'req-gone' }] } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  // When
  const ui = await mountPane($, 70)
  const text = rowTexts(await ui.drawn()).join('\n')
  await ui.unmount()
  // Then
  expect(text).toContain('old')
  expect(text).not.toContain(LINK)
})

test('Given a round with a failed call and a wait, When drawn in principali and then in tutto, Then the wait and failed-call rows show only in tutto', async ($, on) => {
  // Given
  resetAnchors()
  setLang('en')
  world(on, {
    dataFile: JSON.stringify({
      history: [],
      prs: [],
      sessionLog: [{ at: Date.now(), kind: 'round', n: 1, prompt: 'work', fails: { n: 1, list: [{ tool: 'Read', text: 'no such file' }] }, waits: { n: 1, ms: 70_000, list: [{ tool: 'Write', ms: 70_000 }] } }],
    }),
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 70)
  // When
  const main = rowTexts(await ui.drawn()).join('\n')
  await ui.press({ key: 'log:all' })
  const all = rowTexts(await ui.drawn()).join('\n')
  await ui.unmount()
  // Then
  expect(main).not.toContain('Read: no such file')
  expect(main).not.toContain('Write waited 1m10s')
  expect(all).toContain('Read: no such file')
  expect(all).toContain('Write waited 1m10s')
})
