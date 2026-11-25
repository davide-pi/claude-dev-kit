import type { CockpitSnapshot } from '../types'

export const PANE = 'cockpit'

export const INITIAL: CockpitSnapshot = {
  cwd: '',
  isSubagentModelForced: false,
  ctx: {},
  cost: {},
  rateLimits: [],
  agents: [],
  tasks: [],
  now: 0,
}
