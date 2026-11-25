import { textCells } from './shared-cells'

export const COLORS = {
  text: '#d6d8dc',
  dim: '#9aa0aa',
  title: '#a98fd4',
  rule: '#332b44',
  sep: '#4a4f59',
  folder: '#b89ad9',
  violet: '#7d5ba6',
  lavender: '#a082c8',
  blue: '#7fb4ff',
  green: '#7ec699',
  yellow: '#ffcf8a',
  amber: '#e8a35a',
  orange: '#ff9e5e',
  red: '#f07a6f',
  gap: '#8a3b33',
  empty: '#33363c',
  band: 'subtle', // the odd rows of a list: the theme's own faint grey, so the band follows a light or dark theme and stays quiet
  gray: '#8c8c8c',
} as const

export const ICONS = {
  folder: '\u{F024B}', // nf-md-folder: the folder, whether a plain one, a repository or a linked worktree
  branch: '\u{F062C}', // nf-md-source_branch
  disk: '\u{F02CA}', // nf-md-harddisk
} as const

// Nerd Font Material Design glyphs (supplementary private use area, hence \u{...}).
const EFFORT: Record<string, { icon: string; color: string }> = {
  low: { icon: '\u{F12A1}', color: COLORS.gray },
  medium: { icon: '\u{F12A2}', color: COLORS.green },
  high: { icon: '\u{F12A3}', color: COLORS.yellow },
  xhigh: { icon: '\u{F12A6}', color: COLORS.orange },
  max: { icon: '\u{F0083}', color: COLORS.red },
}

/** Icon and color of an effort level; undefined for a level this build does not name (a number). */
export function effortGlyph(effort: string | number | undefined): { icon: string; color: string } | undefined {
  return typeof effort === 'string' ? EFFORT[effort] : undefined
}

/** A run of text with one style: the unit both views are built from. */
export type Span = { t: string; c?: string; dim?: boolean; bold?: boolean; bg?: string }

export const spanWidth = (spans: readonly Span[]): number =>
  spans.reduce((n, s) => n + textCells(s.t), 0)

export const spanText = (spans: readonly Span[]): string => spans.map(s => s.t).join('')
