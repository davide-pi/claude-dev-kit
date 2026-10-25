import { atom, read } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import { isOpen } from './session-data'
import { INITIAL } from './state'
import { configDir, patch } from './store'
import { parseProcs } from './system'

// The scan that checks `$.state` references reads the atom from the file that uses it.
const snapshot = atom({ plugin: 'cockpit', key: 'snapshot' } as const, INITIAL)

let isReading = false

/**
 * The session's processes and listening ports, one read of `sysmon/procs.mjs`, only while the pane is open on the Lavoro tab. A read that
 * fails or cannot run here leaves the list marked unavailable; nothing throws.
 */
export async function refreshProcs($: EngineInterface): Promise<void> {
  if (isReading || !isOpen) return
  isReading = true
  try {
    const s = await read($, snapshot)
    if (s.tab !== 'work' || s.sessionId === undefined) return
    const dir = await configDir($)
    const out = await $.process.run(['node', `${$.plugin.root}/sysmon/procs.mjs`], { timeoutMs: 15_000, env: { COCKPIT_SESSION_ID: s.sessionId, ...(dir && { COCKPIT_CONFIG_DIR: dir }) } })
    const line = out.exitCode === 0 ? parseProcs(out.stdout) : undefined
    await patch($, x => (x.tab === 'work' ? { ...x, procs: line?.procs, isProcsOff: line?.procs === undefined ? true : undefined } : x))
  } catch {
    await patch($, x => ({ ...x, procs: undefined, isProcsOff: true })).catch(() => undefined)
  } finally {
    isReading = false
  }
}
