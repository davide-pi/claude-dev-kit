import { settleAll } from './cockpit-fixtures'
import type { world } from './cockpit-world'

/** The left margin of the drawn root: the column its content starts at. */
export const marginOf = (root: unknown): number => (root as { props?: { marginLeft?: number } }).props?.marginLeft ?? 0

/** The last turn's cost as the state file holds it once its write window has passed (`$0.38`); undefined where it holds none. */
export const lastTurn = async (writes: Map<string, string>, clock: ReturnType<typeof world>, id = 's-1') => {
  await clock.advance(5000)
  await settleAll()
  const path = [...writes.keys()].find(k => k.endsWith(`cockpit-${id}.json`))
  const usd = (JSON.parse(writes.get(path ?? '') ?? 'null') as { lastTurnUsd?: number | null } | null)?.lastTurnUsd
  return typeof usd === 'number' ? `$${usd.toFixed(2)}` : undefined
}

export const GREEN = '#7ec699'
