import type { CockpitEvent } from '../types'

/** The events kept: the oldest go first. */
export const EVENTS_KEEP = 300

/** `list` with `event` last; one with a `key` already in the list is not added twice. The list keeps the newest `EVENTS_KEEP`. */
export function recordEvent(list: readonly CockpitEvent[] | undefined, event: CockpitEvent): CockpitEvent[] {
  const events = list ?? []
  if (event.key !== undefined && events.some(e => e.kind === event.kind && e.key === event.key)) return events.slice()
  // a row older than the newest (a block read from the log) takes its place by time
  return [...events, event].map((e, i) => ({ e, i })).sort((a, b) => a.e.at - b.e.at || a.i - b.i).map(x => x.e).slice(-EVENTS_KEEP)
}

/** `list` with the entry of agent `id` of `kind` agent replaced (a turn that ended twice is one row). */
export const recordAgentEvent = (list: readonly CockpitEvent[] | undefined, event: CockpitEvent): CockpitEvent[] =>
  recordEvent((list ?? []).filter(e => !(e.kind === 'agent' && e.id !== undefined && e.id === event.id)), event)
