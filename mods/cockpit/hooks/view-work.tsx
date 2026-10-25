import type { RenderElement } from 'claude-code'

import type { CockpitChange, CockpitDiff, CockpitPr } from '../types'
import { COLORS, textCells, truncEnd, truncMiddle, truncateSpans } from './shared'
import type { Span } from './shared'
import { t } from './strings'
import { dim, padStart, sp } from './view-base'
import type { Ui } from './view-base'

/** Cells before a changed file's path: the added column, the deleted one and their gaps. */
const CHANGE_COUNTS_W = 12

/** One changed file's row: its added and deleted lines (`bin` for a binary file, `?` for an untracked one), then its path cut to fit, and `●` after it when this chat edited the file. */
export function changeSpans(c: CockpitChange, width: number, isEdited = false): Span[] {
  const counts: Span[] = c.isUntracked
    ? [dim(padStart('?', 5)), sp(' '.repeat(6))]
    : c.isBinary
      ? [dim(padStart('bin', 5)), sp(' '.repeat(6))]
      : [sp(padStart(`+${c.added ?? 0}`, 5), COLORS.green), sp(' '), sp(padStart(`-${c.deleted ?? 0}`, 5), COLORS.red)]
  const pathW = Math.max(4, width - CHANGE_COUNTS_W - (isEdited ? 2 : 0))
  return [...counts, sp(' '), sp(truncMiddle(c.path, pathW)), ...(isEdited ? [sp(' ●', COLORS.lavender)] : [])]
}

const PR_COLORS = { open: COLORS.green, draft: COLORS.yellow, merged: COLORS.violet, closed: COLORS.red } as const

/** The state word of a pull request, a draft told apart from an open one. */
const prState = (pr: CockpitPr) => {
  const state = pr.state === 'open' && pr.isDraft ? 'draft' : pr.state
  return { text: t().prStates[state], color: PR_COLORS[state] }
}

/** What follows a pull request's number on its row: its state and its title, cut to fit `width` (the number's own cells included). */
export function prSpans(pr: CockpitPr, width: number): Span[] {
  const { text, color } = prState(pr)
  const head = ` · ${text}`
  const titleW = width - textCells(`#${pr.number}${head} · `)
  return [sp(' · ', COLORS.dim), sp(text, color), ...(pr.title !== '' && titleW >= 4 ? [sp(' · ', COLORS.dim), sp(truncEnd(pr.title, titleW))] : [])]
}

/** The row under a pull request's: its review and its checks, when known; empty when neither is. */
export function prDetailSpans(pr: CockpitPr, indent: string, width: number): Span[] {
  const review = reviewSpans(pr)
  const checks = checksSpans(pr)
  if (review.length + checks.length === 0) return []
  return truncateSpans([sp(indent), ...review, ...(review.length > 0 && checks.length > 0 ? [dim(' · ')] : []), ...checks], width)
}

const REVIEW_COLORS: Record<NonNullable<CockpitPr['review']>, string> = { approved: COLORS.green, changes: COLORS.red, pending: COLORS.yellow }

/** The review row of a pull request: `review approved`; empty when no review is known. */
export function reviewSpans(pr: CockpitPr): Span[] {
  return pr.review === undefined ? [] : [dim(t().review), sp(t().reviews[pr.review], REVIEW_COLORS[pr.review])]
}

/** The checks row of a pull request: `checks 2/4 · ✗ 1 · ◐ 1` (passed of all, then the failed and the undecided); empty when none are known. */
export function checksSpans(pr: CockpitPr): Span[] {
  const c = pr.checks
  if (!c) return []
  const total = c.passed + c.failed + c.pending
  const color = c.failed > 0 ? COLORS.red : c.pending > 0 ? COLORS.yellow : COLORS.green
  return [
    dim(t().checks),
    sp(`${c.passed}/${total}`, color, true),
    ...(c.failed > 0 ? [dim(' · '), sp(`✗ ${c.failed}`, COLORS.red)] : []),
    ...(c.pending > 0 ? [dim(' · '), sp(`◐ ${c.pending}`, COLORS.yellow)] : []),
  ]
}

/** What the diff pane's button does. */
export type DiffActions = { close: () => void }

/** The second pane: the diff of the file pressed on the Work tab, drawn by the engine's `Code` as unified hunks; empty when none is open. */
export function diffView(ui: Ui, diff: CockpitDiff | undefined, bodyColumns: number, actions: DiffActions): RenderElement {
  const { Box, Text, Button, Code } = ui
  const S = t()
  if (!diff) return <Text dimColor>{S.nothingToShow}</Text>
  return (
    <Box flexDirection="column" width={bodyColumns}>
      <Box justifyContent="space-between">
        <Text wrap="truncate" color={COLORS.title}>
          {S.diffTitle(diff.file)}
        </Text>
        <Button key="diff:close" onPress={() => actions.close()}>
          {S.buttons.close}
        </Button>
      </Box>
      {diff.isUnreadable === true ? (
        <Text dimColor>{S.diffUnreadable}</Text>
      ) : diff.text === '' ? (
        <Text dimColor>{S.noHunk}</Text>
      ) : (
        <Code source={diff.text} format="diff" wrap="truncate-end" />
      )}
      {diff.isCut === true && <Text dimColor>{S.diffCut}</Text>}
    </Box>
  )
}
