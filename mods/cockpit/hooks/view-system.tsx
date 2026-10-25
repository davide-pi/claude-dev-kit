import type { CockpitSysProc } from '../types'
import { fmtBytes, padCells, spanWidth, truncEnd, truncateSpans } from './shared'
import type { Span } from './shared'
import { dim, padStart, sp } from './view-base'

/** Cells of a process row's columns: pid, name (at most) and RAM. */
const PROC_PID_W = 6
const PROC_NAME_W = 14
const PROC_RAM_W = 6

/** The width of a process row's name column: what the width leaves after the other columns, at most `PROC_NAME_W`. */
const procNameWidth = (width: number): number => Math.max(4, Math.min(PROC_NAME_W, width - (PROC_PID_W + PROC_RAM_W + 2)))

/**
 * One row of the process list: pid, name (cut to what the width leaves), RAM, then the ports that fit after them (each is a link the
 * pane draws); `more` when a port was left out for lack of room. The head is cut to `width`.
 */
export function procParts(p: CockpitSysProc, width: number): { head: Span[]; ports: number[]; more: boolean } {
  const nameW = procNameWidth(width)
  const head = truncateSpans(
    [dim(padStart(String(p.pid), PROC_PID_W)), sp(' '), sp(padCells(truncEnd(p.name, nameW), nameW)), sp(' '), dim(padStart(p.ram === undefined ? '' : fmtBytes(p.ram), PROC_RAM_W))],
    width,
  )
  const ports: number[] = []
  let used = spanWidth(head)
  for (const port of p.ports) {
    const cells = 1 + String(port).length + 1
    if (used + cells > width) break
    ports.push(port)
    used += cells
  }
  // ` …` says a port was left out, when it fits after the ones shown
  return { head, ports, more: ports.length < p.ports.length && used + 2 <= width }
}
