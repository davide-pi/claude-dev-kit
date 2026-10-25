import type { CockpitSysProc } from '../types'
import { isCount, isRecord } from './shared'

// ── The processes the Lavoro tab lists: the one line `sysmon/procs.mjs` prints ──

/** Processes a line carries at most. */
const PROCS_KEEP = 200

/** The processes of the reader's line, narrowed field by field; none (undefined) for text that is no line with a `procs` list. */
export function parseProcs(text: string): { procs: CockpitSysProc[] } | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(text.trim().split(String.fromCharCode(10)).at(-1) ?? '')
  } catch {
    return undefined
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.procs)) return undefined
  const procs = parsed.procs.slice(0, PROCS_KEEP).flatMap((p): CockpitSysProc[] =>
    isRecord(p) && isCount(p.pid) && typeof p.name === 'string'
      ? [{ pid: p.pid, name: p.name, ports: Array.isArray(p.ports) ? p.ports.filter(isCount) : [], ...(isCount(p.ram) && { ram: p.ram }) }]
      : [],
  )
  return { procs }
}
