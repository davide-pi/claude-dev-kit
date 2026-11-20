import { spendRows } from './andamento'
import { COLORS, fmtCost, localDate } from './shared'
import { signalId, signalSeverity, signalsOf } from './signals'
import type { Signal, SignalKind } from './signals'
import { t } from './strings'
import { pairRow } from './view-agents'
import { BUTTON_GAP, dim, line, sp } from './view-base'
import { collapsible, signalRow, worklogBehindRows } from './view-kit'
import type { Block, Kit } from './view-kit'
import { dayRow } from './view-log'

// ── The single page: its sections, each hidden when empty (ATTENZIONE says there is nothing to do) ──

/** ATTENZIONE and IN CORSO show this many rows; the rest sits behind a toggle so the footer stays in view. */
const MAX_ROWS = 5
/** ATTENZIONE also stops at this many drawn lines: a closed notification takes two (what, then what to do), so four of them fill it. */
const ATTENTION_LINES = 8

/** The notifications that cost money; every other kind that is not blocking comes after them. */
const COST_KINDS: readonly SignalKind[] = ['heavyAgent', 'opusReadOnly', 'bigResult', 'reread', 'coldAfterIdle', 'ctxGrowth']

const rankOf = (sig: Signal): number => (signalSeverity(sig) === 'block' ? 0 : COST_KINDS.includes(sig.kind) ? 1 : 2)

// ── ATTENZIONE ──

/** How many rows, each as tall as its entry of `lines`, fit in `maxRows` rows and `maxLines` drawn lines; the first row always shows. */
function rowsWithin(lines: readonly number[], maxRows: number, maxLines: number): number {
  let used = 0
  let n = 0
  for (const cost of lines) {
    if (n >= maxRows || (n > 0 && used + cost > maxLines)) break
    used += cost
    n++
  }
  return n
}

/** The live notifications: blocking first, then the worklog behind, then the rest newest first; "nothing to do" when there is neither. */
export function attentionBlocks(k: Kit): Block[] {
  const { ui, s, title, actions } = k
  const { Box, Button } = ui
  const S = t()
  // newest first by the time each first held; at the same time a blocking one, then a costly one, first
  const since = (sig: Signal) => s.signalsAt?.[signalId(sig)] ?? 0
  // a blocking one stays on top (the collapse must never hide it), the others newest first
  const pinned = (sig: Signal): number => (signalSeverity(sig) === 'block' ? 0 : 1)
  const signals = [...signalsOf(s)].sort((a, b) => pinned(a) - pinned(b) || since(b) - since(a) || rankOf(a) - rankOf(b))
  const rows: Block[] = []
  const lines: number[] = []
  const add = (sig: Signal) => {
    rows.push(signalRow(k, sig))
    lines.push(2)
  }
  // a day row only when the signals span two or more local days; the blocking ones stay on top, outside any day
  const dayOf = (sig: Signal) => localDate(s.signalsAt?.[signalId(sig)] ?? s.now)
  signals.filter(sig => signalSeverity(sig) === 'block').forEach(add)
  // the worklog behind asks an action, not a look: pinned under the blocking ones, above every notification, so the collapse never hides it
  const late = worklogBehindRows(k, n => S.worklog.withoutHours(n))
  if (late !== undefined) {
    const hasLog = s.sessionId !== undefined && !s.isWorklogSkillMissing
    // the toggle on the left, the button right-aligned on the same row
    rows.push([
      <Box justifyContent="space-between" columnGap={BUTTON_GAP}>
        {late.toggle}
        {hasLog && (
          <Box flexShrink={0}>
            <Button key="attention:worklog" onPress={() => actions.ask('worklog')}>
              {S.buttons.logHours}
            </Button>
          </Box>
        )}
      </Box>,
      late.days,
    ])
    lines.push(1)
  }

  const actionRows = rows.length
  const rest = signals.filter(sig => signalSeverity(sig) !== 'block')
  if (new Set(rest.map(dayOf)).size < 2) rest.forEach(add)
  else {
    ;[...new Set(rest.map(dayOf))].forEach((date, i) => {
      const key = `day:att:${date}`
      const isOpen = s.groupsOpen?.[key] ?? i === 0
      rows.push(dayRow(k, key, date, isOpen, []))
      lines.push(1)
      if (isOpen) rest.filter(sig => dayOf(sig) === date).forEach(add)
    })
  }

  // a thin rule closes the last action row when notifications follow; it is part of that row, so the collapse keeps it with it, and it costs no line of the budget
  const last = rows[actionRows - 1]
  if (last !== undefined && rows.length > actionRows) {
    rows[actionRows - 1] = [...last, line(ui, [sp('─'.repeat(k.width), COLORS.rule)])]
  }

  if (rows.length === 0) return [[title(S.page.attention), line(ui, [sp('✓ ', COLORS.green), dim(S.page.nothingToDo)])]]
  return [[title(S.page.attention), collapsible(k, 'attention', rows, rowsWithin(lines, MAX_ROWS, ATTENTION_LINES), s.openKeys?.includes('attention') === true, () => actions.toggleOpen('attention'))]]
}

// ── SPESA ──

/** Cells of a spend row's share bar. */
const SHARE_CELLS = 10
/** The spend percent's column in cells, `100%` included. */
const PCT_COLS = 4

/** The session cost at the title's right; then one row per spender: its share, a block bar, who, and its cost right-aligned. */
export function spendBlocks(k: Kit): Block[] {
  const { ui, s, width, title } = k
  const rows = spendRows(s).map(({ label, pct, usd }) => {
    const filled = Math.round((SHARE_CELLS * pct) / 100)
    const left = [sp(`${pct}%`.padStart(PCT_COLS), COLORS.text, true), sp(' '), sp('█'.repeat(filled), COLORS.title), sp('░'.repeat(SHARE_CELLS - filled), COLORS.rule), sp(` ${label}`, COLORS.text)]
    return line(ui, pairRow(left, [dim(fmtCost(usd))], width))
  })
  return [[title(t().page.trend, fmtCost(s.cost.usd)), ...(rows.length === 0 ? [line(ui, [dim(t().desk.analysis.none)])] : rows)]]
}

// ── LOG ──

export { doneBlocks } from './view-log'
