import type { CockpitToolCall } from '../types'
import type { CockpitHint } from './insights'
import { COLORS, abbrevTokens, duration, hhmm, padCells, truncEnd } from './shared'
import type { Span } from './shared'
import { t } from './strings'
import { CALL_TOOL_W, dim, padStart, sp } from './view-base'

const CALL_TIME_W = 5
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

/** One tool call of the main loop: how it ended, the tool, its short argument cut to fit, the time it started (none when the clock could not give it). */
export function toolCallSpans(c: CockpitToolCall, width: number): Span[] {
  const timeW = c.at === undefined ? 0 : 1 + CALL_TIME_W
  const argW = Math.max(0, width - 2 - CALL_TOOL_W - 1 - timeW)
  return [
    c.isOk ? sp('✓', COLORS.green) : sp('✗', COLORS.red),
    sp(' '),
    sp(padCells(truncEnd(c.tool, CALL_TOOL_W), CALL_TOOL_W)),
    sp(' '),
    // a call whose start the clock could not give has no time to draw: its argument takes the cells
    ...(c.at === undefined ? [dim(truncEnd(c.arg ?? '', argW))] : [dim(padCells(truncEnd(c.arg ?? '', argW), argW)), sp(' '), dim(hhmm(c.at))]),
  ]
}

/** The text of an Insights hint. */
export function hintText(h: CockpitHint): string {
  const S = t().hints
  switch (h.kind) {
    case 'rereads':
      return S.rereads(h.file, h.count)
    case 'coldCache':
      return S.coldCache
    case 'failures':
      return S.failures(h.count)
    case 'subagents':
      return S.subagents(h.share)
    case 'longRound':
      return S.longRound(duration(h.ms))
  }
}
