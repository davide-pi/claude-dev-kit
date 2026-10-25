import type { Elements, RenderElement, RenderSurface } from 'claude-code'

import type { Span } from './shared'

/** The elements the views draw with; every surface's table has them. */
export type Ui = Pick<Elements[RenderSurface], 'Box' | 'Text' | 'Button' | 'Code' | 'Link'> & {
  /** Every surface but the mobile app's draws a text field: there the note is left out. */
  Input?: Elements['terminal']['Input']
}

/** Cells a terminal Button adds around its label (`[ label ]`), and between two of a row. */
const BUTTON_CHROME = 4
export const BUTTON_GAP = 1

/** Cells of a tool row: the tool's name, and the time it started (`HH:MM`). */
export const CALL_TOOL_W = 7

// ── Spans ────────────────────────────────────────────────────────────────────

export const dim = (t: string): Span => ({ t, dim: true })
export const sp = (t: string, c?: string, bold?: boolean): Span => ({ t, c, bold })

/** One `Text` per span: the children of a row and of a pressable row. */
export function spanNodes({ Text }: Ui, spans: readonly Span[]): RenderElement[] {
  return spans.map(s => (
    <Text color={s.c} backgroundColor={s.bg} dimColor={s.dim} weight={s.bold ? 'bold' : undefined}>
      {s.t}
    </Text>
  ))
}

export function line(ui: Ui, spans: readonly Span[]): RenderElement {
  const { Text } = ui
  return <Text wrap="truncate">{spanNodes(ui, spans)}</Text>
}

/** Cells a row of terminal Buttons takes with these labels. */
export const buttonRowWidth = (labels: readonly string[]): number =>
  labels.reduce((n, l) => n + [...l].length + BUTTON_CHROME, 0) + BUTTON_GAP * Math.max(0, labels.length - 1)

export const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - [...s].length))
export const padStart = (s: string, n: number) => ' '.repeat(Math.max(0, n - [...s].length)) + s

export const delta = (now: number | undefined, start: number | undefined): number | undefined =>
  now !== undefined && start !== undefined ? now - start : undefined
