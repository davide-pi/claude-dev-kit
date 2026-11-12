import type { EngineInterface } from 'claude-code'

/** The id of the chat marker row of round `n`. */
export const markerId = (n: number): string => `round-${n}`

/** The round a marker id names; none for any other id. */
export const markerRound = (id: string): number | undefined => {
  const found = /^round-(\d+)$/.exec(id)
  return found?.[1] === undefined ? undefined : Number(found[1])
}

// The request ids this process placed: an id saved by an earlier process names no row now, so it shows no link.
const placed = new Set<string>()
// The first refused scroll hides every link for the session: the surface cannot reach a placed row.
let isDenied = false

/** Places the marker of round `n` in the chat; its request id, or none when no surface draws it. */
export async function placeMarker($: EngineInterface, n: number): Promise<string | undefined> {
  const result = await $.ui.place({ id: markerId(n) })
  if (!result.isPlaced) return undefined
  placed.add(result.requestId)
  return result.requestId
}

/** Whether a round's link shows: its marker was placed by this process and no scroll has been refused yet. */
export const isLinkShown = (anchor: string | undefined): boolean => anchor !== undefined && !isDenied && placed.has(anchor)

/** Scrolls the chat to a marker; a refusal, or an engine with no scroll to a transcript row, hides the links for the rest of the session and redraws. */
export async function scrollToAnchor($: EngineInterface, anchor: string): Promise<void> {
  const result = await $.ui.scroll({ to: { requestId: anchor } }).catch((): { deny?: string } => ({ deny: 'scroll failed' }))
  if (result.deny === undefined) return
  isDenied = true
  $.ui.invalidate('ui.render')
}

/** Forgets what was placed and refused: for a test. */
export function resetAnchors(): void {
  placed.clear()
  isDenied = false
}
