import type { CockpitProcSort, CockpitSysProc, CockpitSystem } from '../types'
import { COLORS, ICONS, fmtBytes, padCells, spanWidth, truncEnd, truncateSpans } from './shared'
import type { Span } from './shared'
import { t } from './strings'
import { dim, padStart, sp } from './view-base'

/** Cells of a process row's columns: pid, name (at most), CPU, RAM and the ports' header (` PORTS`). */
const SYS_PID_W = 6
const SYS_NAME_W = 14
const SYS_CPU_W = 4
const SYS_RAM_W = 6
const SYS_PORTS_W = 6

/** The color of a load in percent: green, yellow from 60, red from 85. */
const loadColor = (pct: number): string => (pct >= 85 ? COLORS.red : pct >= 60 ? COLORS.yellow : COLORS.green)

/** The System tab's first numbers, one item each: CPU, RAM and network; a part that could not be read says so, one not read yet draws `…`. */
function usageItems(sys: CockpitSystem): Span[][] {
  const item = (label: string, isOff: boolean, value: Span[]): Span[] => [dim(`${label} `), ...(isOff ? [dim(t().unavailable)] : value)]
  const cpu = sys.cpu.at(-1)
  const ram = sys.ram.at(-1)
  const rx = sys.rx.at(-1)
  const tx = sys.tx.at(-1)
  return [
    item('CPU', sys.off.includes('cpu'), cpu === undefined ? [dim('…')] : [sp(`${Math.round(cpu)}%`, loadColor(cpu), true)]),
    item('RAM', sys.off.includes('ram'), ram === undefined ? [dim('…')] : [sp(`${ram}%`, loadColor(ram), true)]),
    item('NET', sys.off.includes('net'), rx === undefined || tx === undefined ? [dim('…')] : [dim('↓'), sp(`${fmtBytes(rx)}/s`), dim(' ↑'), sp(`${fmtBytes(tx)}/s`)]),
  ]
}

/** The free room of the working directory's drive, with its icon. */
function diskSpans(sys: CockpitSystem): Span[] {
  const { disk } = sys
  if (sys.off.includes('disk')) return [dim(`${ICONS.disk} `), dim(t().unavailable)]
  if (!disk) return [dim(`${ICONS.disk} `), dim('…')]
  const color = disk.total > 0 && disk.free / disk.total < 0.1 ? COLORS.red : disk.total > 0 && disk.free / disk.total < 0.2 ? COLORS.yellow : undefined
  return [dim(`${ICONS.disk} `), sp(`${disk.label ? `${disk.label} ` : ''}${fmtBytes(disk.free)} ${t().diskFree}`, color)]
}

/** The System tab's two rows of numbers, one item each (the pane lays an item out beside the last, wrapping where they do not fit): CPU, RAM and network; the disk. */
export const systemRowItems = (sys: CockpitSystem): Span[][][] => [usageItems(sys), [diskSpans(sys)]]

/** A CPU share in its cell: a tenth under 10 %, whole above (`0.4%`, `12%`); empty until two reads gave one. */
const cpuCell = (cpu: number | undefined): string => (cpu === undefined ? '' : cpu >= 10 ? `${Math.round(cpu)}%` : `${cpu.toFixed(1)}%`)

/** The width of a process row's name column: what the width leaves after the other columns, at most `SYS_NAME_W`. */
const procNameWidth = (width: number): number => Math.max(4, Math.min(SYS_NAME_W, width - (SYS_PID_W + SYS_CPU_W + SYS_RAM_W + SYS_PORTS_W + 3)))

/**
 * The process table's header, in the columns `procParts` draws: `PID NAME` before the CPU and RAM cells (which the pane makes buttons: the
 * press sorts by that column, and the sorted one carries a `▾`), then `PORTS`. The cells are the label padded to their column.
 */
export function procHeader(sort: CockpitProcSort, width: number): { start: Span[]; cpu: string; ram: string; ports: Span[] } {
  const H = t().procHeader
  const nameW = procNameWidth(width)
  const mark = (by: CockpitProcSort, label: string) => padStart(sort === by ? `${label}▾` : label, by === 'cpu' ? SYS_CPU_W : SYS_RAM_W)
  return {
    start: [dim(padStart(H.pid, SYS_PID_W)), sp(' '), dim(padCells(H.name, nameW)), sp(' ')],
    cpu: mark('cpu', H.cpu),
    ram: mark('ram', H.ram),
    ports: truncateSpans([sp(' '), dim(H.ports)], Math.max(0, width - (SYS_PID_W + 1 + nameW + 1 + SYS_CPU_W + 1 + SYS_RAM_W))),
  }
}

/**
 * One row of the process table: pid, name (cut to what the width leaves), CPU, RAM, then the ports that fit after them (each is a link the
 * pane draws); `more` when a port was left out for lack of room. The head is cut to `width`.
 */
export function procParts(p: CockpitSysProc, width: number): { head: Span[]; ports: number[]; more: boolean } {
  const nameW = procNameWidth(width)
  const head = truncateSpans(
    [
      dim(padStart(String(p.pid), SYS_PID_W)),
      sp(' '),
      sp(padCells(truncEnd(p.name, nameW), nameW)),
      sp(' '),
      sp(padStart(cpuCell(p.cpu), SYS_CPU_W)),
      sp(' '),
      dim(padStart(p.ram === undefined ? '' : fmtBytes(p.ram), SYS_RAM_W)),
    ],
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
