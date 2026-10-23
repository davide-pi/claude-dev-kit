import type { CockpitSnapshot } from '../types'

export const PANE = 'cockpit'
/** The second pane: the diff of the file pressed on the Repo tab. */
export const DIFF_PANE = 'cockpit-diff'

export const INITIAL: CockpitSnapshot = {
  cwd: '',
  isSubagentModelForced: false,
  ctx: {},
  cost: {},
  rateLimits: [],
  agents: [],
  tasks: [],
  worklog: { pending: [], underTarget: [] },
  now: 0,
}
