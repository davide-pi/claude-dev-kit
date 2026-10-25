import type { RenderElement } from 'claude-code'

import type { CockpitChange, CockpitDiff, CockpitPr } from '../types'
import { COLORS, textCells, truncEnd, truncMiddle } from './shared'
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

/** What follows a pull request's number on its row: its title, cut to fit `width` (the number's own cells included). */
export function prSpans(pr: CockpitPr, width: number): Span[] {
  const titleW = width - textCells(`#${pr.number} `)
  return pr.title !== '' && titleW >= 4 ? [sp(' '), sp(truncEnd(pr.title, titleW))] : []
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
