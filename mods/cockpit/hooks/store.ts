import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { CockpitSnapshot } from '../types'
import { activeAlerts } from './session'
import { adoptSession, writeState } from './session-data'
import { INITIAL } from './state'

// The scan that checks `$.state` references reads the atom from the file that uses it.
const snapshot = atom({ plugin: 'cockpit', key: 'snapshot' } as const, INITIAL)

/** Writes `next(current)`, unless it equals the current value: a no-op must not redraw the readers. */
export async function patch($: EngineInterface, next: (s: CockpitSnapshot) => CockpitSnapshot): Promise<void> {
  // After a session's end (a /clear, a resume) no session start follows: the first change under another id adopts it.
  await adoptSession($).catch(() => undefined)
  const current = await read($, snapshot)
  if (JSON.stringify(next(current)) === JSON.stringify(current)) return
  await update($, snapshot, next)
  await writeState($)
  await raiseAlerts($)
}

// ── Alerts (D4) ──
// A toast per cause, once per episode: the keys of the causes in force are remembered, and a cause that is gone is forgotten
// (so it can raise again). What a session was adopted with is not news (D5): its first reading of everything only remembers, and so does
// the first live reading of the context and of the credits (a resumed session is measured only after its first response).
let alerted = new Set<string>()
let alertedSession: string | undefined
/** The causes that still wait for their first live reading to be seeded. */
let unseeded = new Set<string>()

async function raiseAlerts($: EngineInterface): Promise<void> {
  try {
    const s = await read($, snapshot)
    const active = activeAlerts(s)
    const isFirst = alertedSession !== s.sessionId
    const before = alerted
    alertedSession = s.sessionId
    if (isFirst) unseeded = new Set(['context', 'credits'])
    const isLive = (key: string) => (key === 'context' ? s.ctx.percent !== undefined : key === 'credits' && s.rateLimits.some(r => r.kind === 'five_hour'))
    const seeds = new Set(active.filter(a => isFirst || (unseeded.has(a.key) && isLive(a.key))).map(a => a.key))
    for (const key of [...unseeded]) if (isLive(key)) unseeded.delete(key)
    alerted = new Set(active.map(a => a.key))
    for (const a of active) if (!before.has(a.key) && !seeds.has(a.key)) $.ui.toast(a.text)
  } catch {
    // an alert that cannot be raised is lost; observing must never break the change
  }
}

export async function configDir($: EngineInterface): Promise<string | undefined> {
  const explicit = await $.env.get('CLAUDE_CONFIG_DIR')
  if (explicit) return explicit
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))
  return home ? `${home}/.claude` : undefined
}
