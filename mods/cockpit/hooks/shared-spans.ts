import type { Span } from './shared-style'
import { spanWidth } from './shared-style'
import { takeCells, textCells } from './shared-cells'

/** Cut spans to `max` cells: the cut leaves an unstyled `…` as its last cell (as the statusline's truncateAnsi). */
export function truncateSpans(spans: readonly Span[], max: number): Span[] {
  if (spanWidth(spans) <= max) return [...spans]
  if (max <= 0) return []
  const out: Span[] = []
  let room = max - 1
  for (const s of spans) {
    if (room <= 0) break
    const w = textCells(s.t)
    out.push(w <= room ? s : { ...s, t: takeCells(s.t, room) })
    room -= w
  }
  out.push({ t: '…' })
  return out
}
