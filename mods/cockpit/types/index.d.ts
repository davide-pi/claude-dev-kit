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
  /** True when the agent ended on an error, an interruption or a refusal, or the engine lists it failed or killed. */
  isFailed?: boolean
  /** True when the session ended with the agent still running: the history's third outcome, `interrotto`. */
  isInterrupted?: boolean
  /** New tokens the agent's turns used: input + cache writes + output (cache reads left out). */
  tokens: number
}

/** A finished agent that left the live list, as the history keeps it (and the state file persists it). */
export type CockpitHistoryEntry = {
  id: string
  type: string
  model?: string
  startedAt: number
  endedAt: number
  tokens: number
  isFailed: boolean
  /** Present (true) only for an agent still running when its session ended. */
  isInterrupted?: boolean
}

export type CockpitGit = {
  branch: string
  /** HEAD points at a commit, not a branch: `branch` then reads `HEAD`. */
  isDetached?: boolean
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

/** One reading of the 5h window's usage, `at` in `$.clock.now()` milliseconds. */
export type CockpitBurnSample = { at: number; used: number }

/** The ALM target the cwd resolves to in `workspaces.json`; absent from the snapshot when there is no usable map. */
export type CockpitAlm = { isMapped: boolean; org?: string; project?: string; identity?: string }

/** The view the pane draws: the tab bar's four buttons. */
export type CockpitTab = 'session' | 'agents' | 'work' | 'repo'

export type CockpitSnapshot = {
  /** The session the per-session fields (agents, history, tasks, cache share, 5h samples) belong to; absent between a session's end and the next one's first event. */
  sessionId?: string
  /** The id of the session that ended last: while the engine still answers it, no change takes it back (it answers it until the switch to the next id). */
  endedSessionId?: string
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
  /** 5h usage readings of the last 30 minutes, the burn rate's input. */
  fiveHourSamples?: CockpitBurnSample[]
  /** Share of the last main-loop turn's input served from the prompt cache, 0-100; absent before the first turn. */
  cacheShare?: number
  alm?: CockpitAlm
  /** The selected tab; absent (a state written before tabs existed) is the Sessione view. */
  tab?: CockpitTab
  agents: CockpitAgent[]
  /** Finished agents that left the live list, newest first; absent in a state written before the history existed. */
  history?: CockpitHistoryEntry[]
  /** The STORICO list is expanded; absent is collapsed. */
  isHistoryOpen?: boolean
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
