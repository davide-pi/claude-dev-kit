import type { CockpitProcSort, CockpitSysLine, CockpitSysProc, CockpitSystem, CockpitSystemPart } from '../types'
import { isCount, isRecord } from './shared'

// ── System: the monitor's lines, the rings the tab draws ──

/** Samples a ring keeps: a minute of the monitor's 2 s ticks. */
export const SYSTEM_KEEP = 30

/** Processes a line carries at most: the monitor lists every one of the session's tree, in this number. */
const PROCS_KEEP = 200

/** The parts of the tab, in the order it draws them. */
const SYSTEM_PARTS: readonly CockpitSystemPart[] = ['cpu', 'ram', 'net', 'procs', 'disk']

/** One JSON line of the system monitor, narrowed field by field: a field that is not the expected shape is dropped; text that is no JSON object is none. */
export function parseSysLine(text: string): CockpitSysLine | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return undefined
  }
  if (!isRecord(parsed)) return undefined
  const { cpu, ram, net, procs, disk, off } = parsed
  const out: CockpitSysLine = {}
  if (isCount(cpu)) out.cpu = Math.min(100, cpu)
  if (isRecord(ram) && isCount(ram.used) && isCount(ram.total)) out.ram = { used: ram.used, total: ram.total }
  if (isRecord(net) && isCount(net.rx) && isCount(net.tx)) out.net = { rx: net.rx, tx: net.tx }
  if (Array.isArray(procs)) {
    out.procs = procs.slice(0, PROCS_KEEP).flatMap((p): CockpitSysProc[] =>
      isRecord(p) && isCount(p.pid) && typeof p.name === 'string'
        ? [{ pid: p.pid, name: p.name, ports: Array.isArray(p.ports) ? p.ports.filter(isCount) : [], ...(isCount(p.cpu) && { cpu: p.cpu }), ...(isCount(p.ram) && { ram: p.ram }) }]
        : [],
    )
  }
  if (isRecord(disk) && isCount(disk.free) && isCount(disk.total)) out.disk = { free: disk.free, total: disk.total, ...(typeof disk.label === 'string' && { label: disk.label }) }
  if (Array.isArray(off)) out.off = SYSTEM_PARTS.filter(part => off.includes(part))
  return out
}

/** The tab's readings with every part unavailable: the monitor could not start, or it ended. */
export const systemOff = (): CockpitSystem => ({ cpu: [], ram: [], rx: [], tx: [], off: [...SYSTEM_PARTS] })

/** `system` after one line of the monitor: samples join their rings, a slow reading replaces the last one, a part the line reports off is cleared and marked, a part it carries is no longer off. */
export function recordSystem(system: CockpitSystem | undefined, line: CockpitSysLine): CockpitSystem {
  const s: CockpitSystem = system ?? { cpu: [], ram: [], rx: [], tx: [], off: [] }
  const ring = (list: readonly number[], v: number) => [...list, v].slice(-SYSTEM_KEEP)
  const next: CockpitSystem = { ...s }
  if (line.cpu !== undefined) next.cpu = ring(s.cpu, line.cpu)
  if (line.ram) {
    next.ram = ring(s.ram, line.ram.total > 0 ? Math.round((100 * line.ram.used) / line.ram.total) : 0)
  }
  if (line.net) {
    next.rx = ring(s.rx, line.net.rx)
    next.tx = ring(s.tx, line.net.tx)
  }
  if (line.procs) next.procs = line.procs
  if (line.disk) next.disk = line.disk
  const carried = new Set<CockpitSystemPart>([
    ...(line.cpu !== undefined ? ['cpu' as const] : []),
    ...(line.ram ? ['ram' as const] : []),
    ...(line.net ? ['net' as const] : []),
    ...(line.procs ? ['procs' as const] : []),
    ...(line.disk ? ['disk' as const] : []),
  ])
  const off = new Set([...s.off.filter(part => !carried.has(part)), ...(line.off ?? [])])
  if (off.has('cpu')) next.cpu = []
  if (off.has('ram')) next.ram = []
  if (off.has('net')) Object.assign(next, { rx: [], tx: [] })
  if (off.has('procs')) next.procs = undefined
  if (off.has('disk')) next.disk = undefined
  next.off = SYSTEM_PARTS.filter(part => off.has(part))
  return next
}

// ── System: the processes' sort ──

/** The processes by `by`, biggest first, the other measure breaking a tie and one that is not read yet after those that are. */
export function sortProcs(procs: readonly CockpitSysProc[], by: CockpitProcSort): CockpitSysProc[] {
  const other = by === 'ram' ? 'cpu' : 'ram'
  return [...procs].sort((a, b) => (b[by] ?? -1) - (a[by] ?? -1) || (b[other] ?? -1) - (a[other] ?? -1) || a.pid - b.pid)
}
