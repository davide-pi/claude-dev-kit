import { atom, read } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import { REFRESH_COOLDOWN_MS, contextOf, staticOf, withDeltas, withStatic } from './context'
import { isOpen } from './session-data'
import { INITIAL } from './state'
import { patch } from './store'

/** A burst of main turns ends in one read of the context breakdown, this long after the first. */
const CONTEXT_DEBOUNCE_MS = 2000
/** An exact count that has not answered after this long is given up on; the Context tab reads summaries again, and a late answer older than the summary read since is discarded. */
const COUNT_TIMEOUT_MS = 60_000

// The scan that checks `$.state` references reads the atom from the file that uses it.
const snapshot = atom({ plugin: 'cockpit', key: 'snapshot' } as const, INITIAL)

// When the breakdown read the Context tab waits for was scheduled, and the exact count in flight (a second press while it runs counts nothing more).
// A timer the engine refuses never runs its callback, so a mark the callback clears could stay for ever: it lapses by itself after twice the debounce.
let contextScheduledAt: number | undefined
// When the exact count in flight started (none: no count runs) and which count it is: one that outlives `COUNT_TIMEOUT_MS` no longer counts as running.
let countingSince: number | undefined
let countRun = 0
// A main turn ended on the Context tab while the exact count ran: its read was skipped, so the count's end makes it.
let isTurnMissed = false
// Every context read takes the next number when it starts; the snapshot keeps the number of the reading it holds.
let contextSeq = 0

/**
 * Reads the context breakdown for the Context tab. `summary` estimates locally and is free; `full` counts with the token-count
 * API and so runs only from the button. A failed read leaves the last reading. Reads overlap (an exact count takes seconds): the
 * one asked last wins, so an older answer that arrives after a newer one is dropped; a summary is therefore not read at all while
 * the exact count runs (whoever asks: the tab, the pane opening, a turn), or the count, answering last, would be dropped. An exact count
 * fixes the static rows for the session and every later summary reuses them; `isRound` (the read a main turn's end asks for) stamps the
 * rows with their change from the reading before.
 */
async function refreshContext($: EngineInterface, detail: 'summary' | 'full', isRound = false): Promise<void> {
  if (detail === 'summary' && (await isCountRunning($))) {
    if (isRound) isTurnMissed = true
    return
  }
  // A reload starts the counter over while the snapshot keeps the number of the reading it holds: the counter never falls behind it.
  contextSeq = Math.max(contextSeq, (await read($, snapshot)).contextSeq ?? 0)
  const seq = ++contextSeq
  try {
    const u = await $.session.usage({ breakdown: detail })
    const breakdown = u.context.breakdown
    if (!breakdown) return
    const fresh = contextOf(breakdown, detail === 'full')
    await patch($, s => {
      if ((s.contextSeq ?? 0) > seq) return s
      const contextStatic = detail === 'full' ? staticOf(fresh) : s.contextStatic
      const reading = detail === 'summary' && contextStatic ? withStatic(fresh, contextStatic) : fresh
      return { ...s, context: withDeltas(reading, s.context, isRound && detail === 'summary'), contextSeq: seq, contextStatic }
    })
  } catch {
    // not measured: the tab keeps what it drew
  }
}

// The session whose first exact count was started (or tried): one per session, a failed one is not asked again on every open.
let exactTriedFor: string | undefined

/**
 * The Context tab opens: a summary now (free) and, the first time in a session while Claude is idle, one exact count whose static rows
 * every later summary reuses. A tab opened while Claude works reads the summary only: the count waits for an idle opening.
 */
export async function openContext($: EngineInterface): Promise<void> {
  await refreshContext($, 'summary')
  const s = await read($, snapshot)
  const isIdle = s.claudeState === undefined || s.claudeState.kind === 'idle'
  if (s.sessionId === undefined || exactTriedFor === s.sessionId || s.contextStatic !== undefined || !isIdle || (await isCountRunning($))) return
  exactTriedFor = s.sessionId
  await countExact($)
}

/** Whether an exact count is in flight and still within `COUNT_TIMEOUT_MS`: a count that never answers does not lock the tab for good. */
async function isCountRunning($: EngineInterface): Promise<boolean> {
  return countingSince !== undefined && (await $.clock.now()) - countingSince < COUNT_TIMEOUT_MS
}

/** The Context tab's `refresh`: an exact count, and no other until `REFRESH_COOLDOWN_MS` have passed (it spends token-count requests). */
export async function pressRefresh($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  const { refreshedAt } = await read($, snapshot)
  if (refreshedAt !== undefined && now - refreshedAt < REFRESH_COOLDOWN_MS) return
  await patch($, s => ({ ...s, now, refreshedAt: now }))
  await countExact($)
}

/** The exact count of the first opening and of the refresh: one at a time. */
async function countExact($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  if (countingSince !== undefined && now - countingSince < COUNT_TIMEOUT_MS) return
  const run = ++countRun
  countingSince = now
  try {
    await refreshContext($, 'full')
  } finally {
    // a count given up on does not release the one that replaced it
    if (countRun === run) {
      countingSince = undefined
      if (isTurnMissed) {
        isTurnMissed = false
        await refreshContext($, 'summary', true).catch(() => undefined)
      }
    }
  }
}

/**
 * The end of a main turn re-reads the breakdown while the pane is open on the Context tab; a burst of turns is one read. No read
 * is scheduled or made while an exact count runs: the summary would be the newer reading, and the count, answering last, dropped;
 * the turn is remembered, and the count's end reads the summary it missed.
 */
export async function scheduleContextRead($: EngineInterface): Promise<void> {
  if (!isOpen || (await read($, snapshot)).tab !== 'context') return
  if (await isCountRunning($)) {
    isTurnMissed = true
    return
  }
  const now = await $.clock.now()
  if (contextScheduledAt !== undefined && now - contextScheduledAt < 2 * CONTEXT_DEBOUNCE_MS) return
  contextScheduledAt = now
  $.clock.after(CONTEXT_DEBOUNCE_MS, () => {
    contextScheduledAt = undefined
    // a summary is not read while an exact count runs: refreshContext itself skips it
    void refreshContext($, 'summary', true).catch(() => undefined)
  })
}
