import { atom, read } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { CockpitClaudeState } from '../types'
import { stateAfterWait } from './agents'
import { setClaudeState } from './events'
import { recordWait } from './insights'
import { paceCheck } from './pace'
import { refreshOnOpen } from './refresh'
import { withRoundWait } from './round-capture'
import { WORKING_MARGIN_MS } from './session'
import { setOpen } from './session-data'
import { INITIAL, PANE } from './state'
import { patch } from './store'
import { PANE_MAX_COLUMNS } from './view'

// The clock tiers: fast for elapsed times, medium for git, slow for what moves rarely (and the state file's heartbeat).
export const FAST_MS = 2000
export const MEDIUM_MS = 10_000
export const SLOW_MS = 30_000

// The scan that checks `$.state` references reads the atom from the file that uses it.
const snapshot = atom({ plugin: 'cockpit', key: 'snapshot' } as const, INITIAL)

// The module's live state, shared by the handler files (one object: an imported binding cannot be reassigned).
export const live: {
  // The main loop's tools in flight (a `tool.call` seen before its `next` answered), in start order: the header's tool state lasts while any is left.
  mainTools: string[]
  // The last permission waits that ended, as [from, to]: a tool call takes off its running time only the part of them inside its own span (the wait is counted on its own).
  waits: { from: number; to: number }[]
} = { mainTools: [], waits: [] }
const WAITS_KEPT = 50
// The asks a person has to answer, by the id of the tool call that raised them: from the `tool.check` verdict to the end of that call.
export const asks = new Map<string, { from: number; held: CockpitClaudeState | undefined; tool: string }>()

export const waitOverlap = (list: readonly { from: number; to: number }[], from: number, to: number): number =>
  list.reduce((sum, w) => sum + Math.max(0, Math.min(to, w.to) - Math.max(from, w.from)), 0)

/** Ends the wait the call `id` raised, if it raised one: the state goes back to what the wait interrupted, and the wait is counted. */
export async function endAsk($: EngineInterface, id: string): Promise<void> {
  const ask = asks.get(id)
  if (!ask) return
  asks.delete(id)
  await setClaudeState($, stateAfterWait(ask.held, live.mainTools), now => now?.kind === 'waiting')
  const waitTo = await $.clock.now().catch(() => undefined)
  if (waitTo !== undefined) {
    live.waits = [...live.waits, { from: ask.from, to: waitTo }].slice(-WAITS_KEPT)
    await patch($, s => withRoundWait({ ...s, insights: recordWait(s.insights, waitTo - ask.from) }, ask.tool, waitTo - ask.from)).catch(() => undefined)
  }
}

/**
 * One look at the usage pace, from the snapshot: open or closed pane alike (the heartbeat tells the chat the mod runs).
 * Idle: no state, `idle`, or a working state older than the working margin (its end event was lost).
 */
export function pace($: EngineInterface, trigger: 'tick' | 'turn'): void {
  void Promise.all([read($, snapshot), $.clock.now()])
    .then(([s, now]) => {
      const st = s.claudeState
      const isIdle = st === undefined || st.kind === 'idle' || (st.since !== undefined && now - st.since > WORKING_MARGIN_MS)
      return paceCheck($, s.sessionId, s.rateLimits.length > 0 ? s.rateLimits : (s.lastRates ?? []), isIdle, trigger)
    })
    .catch(() => undefined)
}

function openPane($: EngineInterface) {
  return $.ui.open({ id: PANE, title: 'cockpit', columns: PANE_MAX_COLUMNS })
}

/** Opens the pane; one that waits undrawn is not open yet: its first render says so. */
export async function open($: EngineInterface) {
  const opened = await openPane($)
  await setOpen($, opened.isPlaced)
  if (opened.isPlaced) void refreshOnOpen($).catch(() => undefined)
  return opened
}
