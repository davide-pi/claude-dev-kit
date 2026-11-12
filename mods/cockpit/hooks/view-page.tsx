import { spendSplit } from './andamento'
import { openTasks } from './context'
import { COLORS, barCells, localDate, padCells, spanWidth, truncateSpans } from './shared'
import type { Span } from './shared'
import { signalId, signalSeverity, signalsOf } from './signals'
import type { Signal, SignalKind } from './signals'
import { t } from './strings'
import { orderAgents, taskCounts, visibleAgents } from './view-agents'
import { BUTTON_GAP, dim, line, sp } from './view-base'
import { collapsible, makeAgentBlock, signalRow, worklogBehindRows } from './view-kit'
import type { Block, Kit } from './view-kit'
import { dayRow, liveBlocks } from './view-log'

// ── The single page: four sections, each hidden when empty (ATTENZIONE says there is nothing to do) ──

/** ATTENZIONE and IN CORSO show this many rows; the rest sits behind a toggle so the footer stays in view. */
const MAX_ROWS = 5
/** ATTENZIONE also stops at this many drawn lines: a closed notification takes two (what, then what to do), so four of them fill it. */
const ATTENTION_LINES = 8
/** Cells the caption of a bar takes, so the bar and its legend line up. */
const CAPTION_W = 9
/** A bar's parts beyond this many tools join "other". */
const TOP_TOOLS = 3

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

// ── ANDAMENTO ──

const PALETTE = [COLORS.blue, COLORS.green, COLORS.amber, COLORS.lavender, COLORS.yellow]

/** `short` is the label on a legend too long for the pane; absent, `shortLabel` makes it. */
type BarPart = { label: string; pct: number; isOther?: boolean; short?: string }

/** The last hyphen-separated segment of a label, its first 4 letters and a dot when it is longer (`code-reviewer` -> `revi.`). */
export function shortLabel(label: string): string {
  const letters = [...(label.split('-').at(-1) ?? label)]
  return letters.length > 4 ? `${letters.slice(0, 4).join('')}.` : letters.join('')
}

/** A bar behind its dim caption and the legend under it, from the first column: each part's glyph in its colour, its label and share in the text colour. */
function barRows(k: Kit, caption: string, parts: readonly BarPart[]): Block {
  const { ui, width } = k
  const colors = parts.map((p, i) => (p.isOther ? COLORS.gray : (PALETTE[i % PALETTE.length] ?? COLORS.blue)))
  const legendOf = (name: (p: BarPart) => string): Span[] => parts.flatMap((p, i) => [...(i > 0 ? [sp('  ')] : []), sp('▰ ', colors[i]), sp(`${name(p)} ${Math.round(p.pct)}%`)])
  // full labels while they fit, else each shortened; still too long is cut
  const full = legendOf(p => p.label)
  const legend = spanWidth(full) <= width ? full : legendOf(p => p.short ?? (p.isOther ? p.label : shortLabel(p.label)))
  return [
    line(ui, [dim(padCells(caption, CAPTION_W)), ...barCells(Math.max(1, width - CAPTION_W), parts.map((p, i) => ({ pct: p.pct, color: colors[i] ?? COLORS.blue })))]),
    line(ui, truncateSpans(legend, width)),
  ]
}

/** The tools that filled the context, the biggest three and the rest as "other", by their share. */
function toolParts(byTool: Record<string, number> | undefined, other: string): BarPart[] {
  const tools = Object.entries(byTool ?? {}).filter(([, tokens]) => tokens > 0).sort((a, b) => b[1] - a[1])
  const total = tools.reduce((n, [, tokens]) => n + tokens, 0)
  if (total <= 0) return []
  const rest = tools.slice(TOP_TOOLS).reduce((n, [, tokens]) => n + tokens, 0)
  return [...tools.slice(0, TOP_TOOLS).map(([label, tokens]) => ({ label, pct: (100 * tokens) / total })), ...(rest > 0 ? [{ label: other, pct: (100 * rest) / total, isOther: true }] : [])]
}

/** The spend bar and the context bar, each with its legend; hidden before the first round. */
export function andamentoBlocks(k: Kit): Block[] {
  const { s, title } = k
  const S = t()
  if (s.insights === undefined || s.insights.rounds <= 0) return []

  const label = (p: { label: string }) => (p.label === 'main' ? S.page.main : p.label === 'other' ? S.page.other : p.label)
  const spend = spendSplit(s).map((p): BarPart => ({ label: label(p), pct: p.pct, isOther: p.label === 'other', ...(p.label === 'main' && { short: S.page.mainShort }) }))
  const context = toolParts(s.insights.byTool, S.page.other)
  return [[title(S.page.trend), spend.length > 0 && barRows(k, S.page.spend, spend), context.length > 0 && barRows(k, S.page.context, context)]]
}

// ── IN CORSO ──

/** The deliver tasks and their perimeter, the open nodes (the open round, the workflow run still open or silent) and the running agents; hidden when nothing runs and no task is open. */
export function inProgressBlocks(k: Kit): Block[] {
  const { ui, s, width, title, actions } = k
  const S = t()
  const running = visibleAgents(s).filter(a => a.status === 'running')
  const nodes = liveBlocks(k)
  if (running.length === 0 && nodes.length === 0 && openTasks(s).length === 0) return []

  const rows: Block[] = []
  const counts = taskCounts(s)
  if (counts !== null) {
    const current = s.tasks?.find(task => task.status === 'in_progress')
    const icon = counts.inProgress > 0 ? sp('󱎖 ', COLORS.blue) : dim('󰄰 ')
    rows.push([line(ui, truncateSpans([icon, sp(S.page.tasks(counts.done, counts.total)), ...(current === undefined ? [] : [dim(` · ${current.subject}`)])], width))])
  }
  if (s.perimeter !== undefined) {
    const outside = s.perimeterCheck?.outside ?? []
    const spans = outside.length > 0 ? [sp(S.filesOutside(outside.length), COLORS.red)] : s.perimeterCheck ? [sp('󰄬 ', COLORS.green), dim(S.perimeter(s.perimeter.length))] : [dim(S.perimeter(s.perimeter.length))]
    rows.push([line(ui, truncateSpans(spans, width))])
  }
  rows.push(...nodes)
  const agentBlock = makeAgentBlock(k)
  rows.push(...orderAgents(running).map(({ agent, depth }) => agentBlock(`agent:${agent.id}`, agent, depth)))

  return [[title(S.page.inProgress), collapsible(k, 'inProgress', rows, MAX_ROWS, s.openKeys?.includes('inProgress') === true, () => actions.toggleOpen('inProgress'))]]
}

// ── LOG ──

export { doneBlocks } from './view-log'
