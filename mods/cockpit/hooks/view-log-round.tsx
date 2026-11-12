import type { CockpitLogEntry, CockpitSnapshot } from '../types'
import type { DoneEvent, DoneGroup } from './done-groups'
import { COLORS, baseName, effortGlyph, shortModel, textCells, truncEnd } from './shared'
import type { Span } from './shared'
import { isLinkShown } from './round-anchor'
import { t } from './strings'
import { pairRow } from './view-agents'
import { dim, sp } from './view-base'

/** A round's tools in the summary: the top three. */
const TOP_TOOLS = 3
/** The files a round's row names; the rest is a count. */
const FILES_SHOWN = 3
/** The cells of a node's label. */
export const LABEL_W = 10

type Node = DoneGroup<DoneEvent>

/** The LOG filter's state key (per session, like the other toggles): set, the log shows everything; unset, only the main rows. */
export const ALL_KEY = 'log:all'
export const isAllShown = (s: CockpitSnapshot): boolean => s.openKeys?.includes(ALL_KEY) === true

/** Whether a log entry is a main row: a failed test or a blocking signal stays, an ok test and any other signal wait for the full log. */
export const isMainEntry = (e: CockpitLogEntry): boolean => (e.kind === 'test' ? e.isFailed === true : e.kind === 'signal' ? e.severity === 'block' : true)

/** What a round's header, summary and files row read: the entry of a closed round, the session's pending fields for the open one. */
type Facts = Pick<CockpitLogEntry, 'prompt' | 'files' | 'fails' | 'waits' | 'ctxPct' | 'model' | 'effort' | 'anchor'> & { ctxDelta?: number }

/** The facts of a round node; none for a flow and a merged run of chat-only rounds. */
function roundFacts(g: Node, s: CockpitSnapshot): Facts | undefined {
  if (g.flow !== undefined || g.chatOnly !== undefined) return undefined
  if (!g.isCurrent) return g.entry === undefined ? undefined : { ...g.entry, ...(g.ctxDelta !== undefined && { ctxDelta: g.ctxDelta }) }
  const log = s.sessionLog ?? []
  const last = log.filter(e => e.kind === 'round').at(-1)
  const ctxPct = s.ctx.percent === undefined ? undefined : Math.round(s.ctx.percent)
  const isCompacted = last !== undefined && log.some(e => e.kind === 'compact' && e.at > last.at)
  return {
    ...(s.roundPrompt !== undefined && { prompt: s.roundPrompt }),
    ...(s.roundAnchor !== undefined && { anchor: s.roundAnchor }),
    ...(s.roundFiles !== undefined && { files: s.roundFiles }),
    ...(s.roundFails !== undefined && { fails: s.roundFails }),
    ...(s.roundWaits !== undefined && { waits: s.roundWaits }),
    ...(ctxPct !== undefined && { ctxPct }),
    ...(ctxPct !== undefined && last?.ctxPct !== undefined && !isCompacted && { ctxDelta: ctxPct - last.ctxPct }),
    ...(s.model !== undefined && { model: s.model }),
    ...(s.effort !== undefined && { effort: s.effort }),
  }
}

/** `1m10s`, `45s`: a wait's length. */
const waitText = (ms: number): string => {
  const sec = Math.max(0, Math.round(ms / 1000))
  return sec >= 60 ? `${Math.floor(sec / 60)}m${String(sec % 60).padStart(2, '0')}s` : `${sec}s`
}

/** The summary of a node, in spans: what it holds by kind (`2 agents · 1 commit`), its failed calls (red) and permission waits, then its tool calls (`34 tools: Read 20 · Bash 9 · Edit 5`, the top three); empty when it holds nothing. */
export function summarySpans(g: Node, s: CockpitSnapshot): Span[] {
  const S = t().page.events.summary
  const facts = roundFacts(g, s)
  const kinds = (['agent', 'signal', 'commit', 'test', 'pr', 'compact'] as const).flatMap(kind => {
    const n = g.events.filter(e => e.kind === kind).length
    return n > 0 ? [dim(S[kind](n))] : []
  })
  const tools = Object.entries(g.tools ?? {}).sort((a, b) => b[1] - a[1])
  const total = tools.reduce((n, [, count]) => n + count, 0)
  const top = tools.slice(0, TOP_TOOLS).map(([name, count]) => `${name} ${count}`).join(' · ')
  const fails = facts?.fails !== undefined && facts.fails.n > 0 ? [sp(S.fails(facts.fails.n), COLORS.red)] : []
  const waits = facts?.waits !== undefined && facts.waits.n > 0 ? [sp(S.waits(facts.waits.n, waitText(facts.waits.ms)), COLORS.amber)] : []
  return [...kinds, ...fails, ...waits, ...(total > 0 && isAllShown(s) ? [dim(S.tools(total, top))] : [])].flatMap((span, i) => (i === 0 ? [span] : [dim(' · '), span]))
}

/** `file a · b · c +1`: the files the round edited, by name; none when it edited none. */
export function filesText(g: Node, s: CockpitSnapshot): string | undefined {
  const files = roundFacts(g, s)?.files ?? []
  if (files.length === 0) return undefined
  const extra = files.length - FILES_SHOWN
  return `${t().page.events.files} ${files.slice(0, FILES_SHOWN).map(baseName).join(' · ')}${extra > 0 ? ` +${extra}` : ''}`
}

/** The marker a round's link scrolls to; none when the round has none, this process did not place it, or a scroll was refused. */
export const linkAnchor = (g: Node, s: CockpitSnapshot): string | undefined => {
  const anchor = roundFacts(g, s)?.anchor
  return isLinkShown(anchor) ? anchor : undefined
}

/** The rows of the full log under a round: each permission wait (tool, length) and each failed call (tool, error), the newest ten of each. */
export function detailRows(g: Node, s: CockpitSnapshot): Span[][] {
  if (!isAllShown(s)) return []
  const facts = roundFacts(g, s)
  return [
    ...(facts?.waits?.list ?? []).map(w => [dim(`${w.tool} ${t().page.events.wait} ${waitText(w.ms)}`)]),
    ...(facts?.fails?.list ?? []).map(f => [sp(`${f.tool}${f.text === '' ? '' : `: ${f.text.replace(/\s+/g, ' ')}`}`, COLORS.red)]),
  ]
}

/** Whether a node holds anything to open: events, or for a round a summary or a files row. */
export const isExpandable = (g: Node, s: CockpitSnapshot): boolean => g.events.length > 0 || summarySpans(g, s).length > 0 || filesText(g, s) !== undefined

/** `son5.5` and the effort battery (an effort with no battery, its value), whichever there is; the model cell of an agent row and of a round header. */
export function modelSpans(model: string | undefined, effort: string | number | undefined): Span[] {
  const name = shortModel(model).replace(' ', '')
  const battery = effortGlyph(effort)
  const tail = battery ? [sp(battery.icon, battery.color)] : effort === undefined ? [] : [dim(String(effort))]
  return [...(name === '' ? [] : [dim(name)]), ...(name !== '' && tail.length > 0 ? [sp(' ')] : []), ...tail]
}

/** `ctx 42% +12`: the context at the round's end and what it gained; the change is left out after a compaction. */
const ctxText = (pct: number, delta: number | undefined): string => `ctx ${pct}%${delta === undefined ? '' : ` ${delta < 0 ? '−' : '+'}${Math.abs(delta)}`}`

/**
 * The two header lines of a round node, beside its arrow. Line 1: start time, label and the prompt cut with an ellipsis to the width.
 * Line 2 (none when the round has no figures): `figures` (length, cost, share), the context, the model and its effort battery; the figures sit at the row's end.
 * A round with a link shows it in front of line 2 (the caller draws it, 2 cells), so line 2 is laid 2 cells narrower and its figures keep the other rows' columns.
 */
export function roundHeader(g: Node, s: CockpitSnapshot, parts: { time: Span[]; label: Span; figures: Span[]; width: number }): { first: Span[]; second: Span[] } | undefined {
  const facts = roundFacts(g, s)
  // a round saved before the log kept its prompt, context and model keeps its one line
  if (facts === undefined || (facts.prompt === undefined && facts.ctxPct === undefined && facts.model === undefined)) return undefined
  const { time, label, figures, width } = parts
  const lead = [...time, { ...label, t: label.t.padEnd(LABEL_W) }]
  const room = width - 2 - lead.reduce((n, sp0) => n + textCells(sp0.t), 0) - 1
  const first = [...lead, ...(facts.prompt === undefined || room < 2 ? [] : [sp(' '), sp(truncEnd(facts.prompt, room))])]
  const cells: Span[][] = [
    ...(facts.ctxPct === undefined ? [] : [[dim(ctxText(facts.ctxPct, facts.ctxDelta))]]),
    ...(facts.model === undefined && facts.effort === undefined ? [] : [modelSpans(facts.model, facts.effort)]),
  ]
  const left = cells.flatMap((c, i) => [...(i > 0 ? [sp(' ')] : []), ...c])
  return { first, second: left.length === 0 && figures.length === 0 ? [] : linkAnchor(g, s) === undefined ? pairRow([sp('  '), ...left], figures, width) : pairRow(left, figures, width - 2) }
}
