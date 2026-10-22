// State contract of the cockpit mod: everything a drawing reads lives in one value,
// so a hot reload loses nothing and every write redraws the readers.

export type CockpitRateLimit = { kind: string; percentUsed: number; resetsAt?: string }

export type CockpitAgent = {
  id: string
  parentId?: string
  /** `subagentType` of the spawn. */
  type: string
  /** The `model` the Agent call asked for, as given (an alias or an id). */
  requested?: string
  /** What the agent runs on: the resolved id from the spawn, then the latest `turn.step`'s. */
  model?: string
  effort?: string | number
  status: 'running' | 'done'
  startedAt: number
  endedAt?: number
  /** New tokens the agent's turns used: input + cache writes + output (cache reads left out). */
  tokens: number
}

export type CockpitGit = {
  branch: string
  staged: number
  modified: number
  untracked: number
  /** Root of the linked worktree the session runs in; absent in a main checkout. */
  worktreeRoot?: string
}

export type CockpitWorklog = {
  /** Days with work that never reached a work item (ISO dates). */
  pending: string[]
  /** Days logged under target (ISO dates). */
  underTarget: string[]
}

export type CockpitTask = {
  /** The task tool's `task.id`, or `todo:<content>` for a TodoWrite item. */
  id: string
  subject: string
  status: 'pending' | 'in_progress' | 'completed'
  /** `$.clock.now()` when it went in progress; absent otherwise. */
  startedAt?: number
}

export type CockpitSnapshot = {
  cwd: string
  /** Raw model id or name of the main loop. */
  model?: string
  effort?: string | number
  /** True when CLAUDE_CODE_SUBAGENT_MODEL forces the subagents' model. */
  isSubagentModelForced: boolean
  /** Context window of the main loop; `startTokens` is the fill when the last turn began. */
  ctx: { tokens?: number; window?: number; percent?: number; startTokens?: number }
  /** Session cost in USD; `startUsd` is the total when the last turn began. */
  cost: { usd?: number; startUsd?: number }
  rateLimits: CockpitRateLimit[]
  agents: CockpitAgent[]
  git?: CockpitGit
  worklog: CockpitWorklog
  /** The main thread's tasks (task tools and TodoWrite, merged); absent in a state written before tasks existed. */
  tasks?: CockpitTask[]
  /** Last tick, in `$.clock.now()` milliseconds: the "now" countdowns and durations count from. */
  now: number
}

declare module 'claude-code' {
  interface PluginState {
    cockpit: { snapshot: CockpitSnapshot }
  }
}
