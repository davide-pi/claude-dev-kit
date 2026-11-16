import type { CockpitSnapshot } from '../types'
import { withLogged } from './timeline'

/** Errors the mod swallows, counted per site until the next successful write logs them. */
const pending = new Map<string, number>()

/** Counts one swallowed error at `site`. Never throws: it is called from the catch blocks it counts. */
export function noteSwallowed(site: string): void {
  pending.set(site, (pending.get(site) ?? 0) + 1)
}

/** The counts waiting for the next successful write, by site. */
export const swallowedPending = (): ReadonlyMap<string, number> => pending

/** Forgets the counts that were logged: what arrived since stays. */
export function settleSwallowed(logged: ReadonlyMap<string, number>): void {
  for (const [site, n] of logged) {
    const left = (pending.get(site) ?? 0) - n
    if (left > 0) pending.set(site, left)
    else pending.delete(site)
  }
}

/** Forgets every count: a session switch leaves them to the session that is gone. */
export const clearSwallowed = (): void => pending.clear()

/** `s` with each site's `counts` added to its 'error' entry (made at `at` when it has none), the entry moved to `at`. `s` itself when there are none. */
export function withSwallowed(s: CockpitSnapshot, counts: ReadonlyMap<string, number>, at: number): CockpitSnapshot {
  return [...counts].reduce((acc, [site, n]) => {
    const before = acc.sessionLog?.find(e => e.kind === 'error' && e.key === site)?.n ?? 0
    const rest = acc.sessionLog?.filter(e => !(e.kind === 'error' && e.key === site))
    return withLogged({ ...acc, sessionLog: rest }, { at, kind: 'error', key: site, n: before + n })
  }, s)
}
