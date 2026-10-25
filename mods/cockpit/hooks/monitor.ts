import { atom, read } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import { isOpen } from './session-data'
import { INITIAL } from './state'
import { configDir, patch } from './store'
import { parseSysLine, recordSystem, systemOff } from './system'

// The scan that checks `$.state` references reads the atom from the file that uses it.
const snapshot = atom({ plugin: 'cockpit', key: 'snapshot' } as const, INITIAL)

// ── The System tab's monitor: a child process that lives only while the pane is open on that tab ──

/** The running monitor: its stream (ending the loop that reads it kills the child) and whether it was stopped on purpose. */
type Monitor = { stream?: ReturnType<EngineInterface['process']['spawn']>; isStopped: boolean }
let monitor: Monitor | undefined

/**
 * Runs `sysmon/sysmon.mjs` and keeps what it prints (one JSON line per reading) in the snapshot until it is stopped or ends. A
 * child that cannot start, or ends by itself, leaves every part unavailable: the tab draws `unavailable`, nothing throws.
 */
async function runMonitor($: EngineInterface, m: Monitor): Promise<void> {
  let pending = ''
  try {
    const id = await $.session.id()
    const dir = await configDir($)
    // The tab may have been left while the session id and config folder were read: no child is started for a stopped monitor.
    if (m.isStopped) return
    m.stream = $.process.spawn({
      argv: ['node', `${$.plugin.root}/sysmon/sysmon.mjs`],
      env: { COCKPIT_SESSION_ID: id, ...(dir && { COCKPIT_CONFIG_DIR: dir }) },
    })
    for await (const chunk of m.stream) {
      if (m.isStopped) break
      if (chunk.stream !== 'stdout') continue
      // a line may span two chunks, and a chunk may hold several lines
      const lines = (pending + chunk.text).split('\n')
      pending = lines.pop() ?? ''
      for (const text of lines) {
        const line = parseSysLine(text)
        if (line && !m.isStopped) await patch($, s => ({ ...s, system: recordSystem(s.system, line) })).catch(() => undefined)
      }
    }
  } catch {
    // the child could not start or broke: the parts read as unavailable below
  }
  if (monitor === m) monitor = undefined
  if (!m.isStopped) await patch($, s => ({ ...s, system: systemOff() })).catch(() => undefined)
}

/** Ends the running monitor: the loop that reads it stops, and closing its stream kills the child. */
export function stopMonitor(): void {
  const m = monitor
  if (!m) return
  monitor = undefined
  m.isStopped = true
  void m.stream?.return({ code: null, signal: null }).catch(() => undefined)
}

/** The monitor runs exactly while the pane is open on the System tab: started when it is wanted and not running, stopped (and its readings forgotten) when it runs and is not wanted. */
export async function syncMonitor($: EngineInterface): Promise<void> {
  try {
    const current = await read($, snapshot)
    const isWanted = isOpen && current.tab === 'system'
    if (isWanted && !monitor) {
      const m: Monitor = { isStopped: false }
      monitor = m
      void runMonitor($, m)
    } else if (!isWanted) {
      // Also with no monitor left: one that crashed left the tab reading "unavailable", which the next visit must not start from.
      stopMonitor()
      if (current.system !== undefined) await patch($, s => ({ ...s, system: undefined }))
    }
  } catch {
    // the snapshot could not be read: the monitor stays as it is
  }
}
