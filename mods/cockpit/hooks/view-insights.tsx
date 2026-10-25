import { COLORS, abbrevTokens, padCells, truncEnd } from './shared'
import type { Span } from './shared'
import { CALL_TOOL_W, dim, padStart, sp } from './view-base'

/** Cells of a largest result's tokens (`+38k`). */
const GREW_TOKENS_W = 6

/** One of the largest results: the tool, its short argument cut to fit, and the result's estimated tokens. */
export function bigResultSpans(r: { tool: string; arg?: string; tokens: number }, width: number): Span[] {
  const argW = Math.max(0, width - CALL_TOOL_W - 1 - 1 - GREW_TOKENS_W)
  return [
    sp(padCells(truncEnd(r.tool, CALL_TOOL_W), CALL_TOOL_W)),
    sp(' '),
    dim(padCells(truncEnd(r.arg ?? '', argW), argW)),
    sp(' '),
    sp(padStart(`+${abbrevTokens(r.tokens)}`, GREW_TOKENS_W), COLORS.yellow),
  ]
}
