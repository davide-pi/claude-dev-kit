/** `+5%` / `−5%` (true minus sign, as the mockup). */
export const signedPct = (delta: number): string => `${delta < 0 ? '−' : '+'}${Math.abs(delta)}%`

/** Cost with precision that scales down; `$0.00` for an untouched session. */
export function fmtCost(usd: number | undefined): string {
  if (usd === undefined || !Number.isFinite(usd) || usd <= 0) return '$0.00'
  return `$${usd < 0.01 ? usd.toFixed(4) : usd < 1 ? usd.toFixed(3) : usd.toFixed(2)}`
}

/** A cost in a table cell of `w` cells: `$` first, the amount right-aligned with two decimals (`$  0.38`, `$ 12.40`), so `$` and the point line up row after row; `<0.01` below a cent. */
export function costCell(usd: number, w: number): string {
  const amount = Number.isFinite(usd) && usd > 0 && usd < 0.005 ? '<0.01' : (Number.isFinite(usd) ? Math.max(0, usd) : 0).toFixed(2)
  return `$${amount.padStart(w - 1)}`
}

/** Below a cent a turn's cost reads as not yet measured. */
export const CENT = 0.005

/** The turn cost to show: the running turn's once it reaches a cent, else the last ended turn's. */
export function shownTurnUsd(cost: { usd?: number; startUsd?: number; lastUsd?: number }): number | undefined {
  const d = cost.usd !== undefined && cost.startUsd !== undefined ? cost.usd - cost.startUsd : undefined
  return d !== undefined && d >= CENT ? d : cost.lastUsd
}

/** The last turn's cost, `+0.38`; empty below a cent. */
export const fmtCostDelta = (d: number | undefined): string =>
  d !== undefined && d >= CENT ? `+${d.toFixed(2)}` : ''

export type ModelFamily = 'opus' | 'sonnet' | 'haiku' | 'fable'

export function modelFamily(model: string | undefined): ModelFamily | undefined {
  const m = model?.toLowerCase().match(/opus|sonnet|haiku|fable/)
  return m ? (m[0] as ModelFamily) : undefined // the regex only yields one of the four names
}

/** `claude-opus-5-5-20260101[1m]` or `Opus 5.5` -> version `5.5`; empty when none is spelled. */
function modelVersion(model: string): string {
  const m = model.match(/(?:opus|sonnet|haiku|fable)[\s-]+(\d+)(?:[-.](\d{1,2})(?!\d))?/i)
  if (!m) return ''
  return m[2] === undefined ? (m[1] ?? '') : `${m[1]}.${m[2]}`
}

/** Three letters each, so the version after them lines up in a column. */
export const FAMILY_SHORT: Record<ModelFamily, string> = { opus: 'opu', sonnet: 'son', haiku: 'hai', fable: 'fab' }

/** `son 5.5`, `opu 5.5`: the agent rows and counts. Unknown names pass through. */
export function shortModel(model: string | undefined): string {
  if (!model) return ''
  const family = modelFamily(model)
  if (!family) return model
  const v = modelVersion(model)
  return v ? `${FAMILY_SHORT[family]} ${v}` : FAMILY_SHORT[family]
}

/** `Opus 5.5`: the header. Unknown names pass through. */
export function displayModel(model: string | undefined): string {
  if (!model) return ''
  const family = modelFamily(model)
  if (!family) return model
  const name = family.charAt(0).toUpperCase() + family.slice(1)
  const v = modelVersion(model)
  return v ? `${name} ${v}` : name
}
