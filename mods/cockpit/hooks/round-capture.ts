import type { CockpitLogEntry, CockpitSnapshot } from '../types'
import { ROUND_LIST_KEEP } from './timeline'

/** The prompt a round entry keeps: its first line, cut to this many characters. */
export const PROMPT_KEEP = 120
const FAIL_TEXT_KEEP = 200
const FILES_KEEP = 100

/** The title of the round a submit opens: a slash command as `/name`, else the first non-empty line with its whitespace collapsed. */
export function promptTitle(input: { text: string; command?: { name: string } }): string {
  if (input.command) return `/${input.command.name}`
  const first = input.text.split(/\r?\n/).find(l => l.trim() !== '') ?? ''
  return [...first.replace(/\s+/g, ' ').trim()].slice(0, PROMPT_KEEP).join('')
}

/** `s` with the open round's prompt set; a round that has one (a mid-turn message) keeps the first. */
export const withRoundPrompt = (s: CockpitSnapshot, title: string): CockpitSnapshot => (s.roundPrompt !== undefined || title === '' ? s : { ...s, roundPrompt: title })

/** `s` with a file the main loop edited added to the open round, once. */
export const withRoundFile = (s: CockpitSnapshot, path: string): CockpitSnapshot =>
  s.roundFiles?.includes(path) ? s : { ...s, roundFiles: [...(s.roundFiles ?? []), path].slice(0, FILES_KEEP) }

/** `s` with one more failed main-loop call in the open round: the count, and the newest ten with their error text. */
export const withRoundFail = (s: CockpitSnapshot, tool: string, text: string): CockpitSnapshot => ({
  ...s,
  roundFails: { n: (s.roundFails?.n ?? 0) + 1, list: [...(s.roundFails?.list ?? []), { tool, text: text.slice(0, FAIL_TEXT_KEEP) }].slice(-ROUND_LIST_KEEP) },
})

/** `s` with one more permission wait in the open round: the count, the total, and the newest ten. */
export const withRoundWait = (s: CockpitSnapshot, tool: string, ms: number): CockpitSnapshot => ({
  ...s,
  roundWaits: { n: (s.roundWaits?.n ?? 0) + 1, ms: (s.roundWaits?.ms ?? 0) + ms, list: [...(s.roundWaits?.list ?? []), { tool, ms }].slice(-ROUND_LIST_KEEP) },
})

/** The number the round that ends now gets: after the last one counted, the log's own count for a session saved before the counter. */
export const nextRoundNumber = (s: CockpitSnapshot): number => {
  const rounds = (s.sessionLog ?? []).filter(e => e.kind === 'round')
  return (s.roundSeq ?? Math.max(rounds.length, ...rounds.map(e => e.n ?? 0))) + 1
}

/** What the open round gives the entry that ends it. */
export const roundFields = (s: CockpitSnapshot): Partial<CockpitLogEntry> => ({
  ...(s.roundPrompt !== undefined && { prompt: s.roundPrompt }),
  ...(s.roundAnchor !== undefined && { anchor: s.roundAnchor }),
  ...(s.roundFiles !== undefined && { files: s.roundFiles }),
  ...(s.ctx.percent !== undefined && { ctxPct: Math.round(s.ctx.percent) }),
  ...(s.model !== undefined && { model: s.model }),
  ...(s.effort !== undefined && { effort: s.effort }),
  ...(s.roundWaits !== undefined && { waits: s.roundWaits }),
  ...(s.roundFails !== undefined && { fails: s.roundFails }),
})
