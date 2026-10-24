// State contract of the cockpit mod: everything a drawing reads lives in one value,
// so a hot reload loses nothing and every write redraws the readers.

export type CockpitRateLimit = { kind: string; percentUsed: number; resetsAt?: string }

/** The four token counters the API reports for a response, kept as the agent's running totals. */
export type CockpitUsage = { input: number; output: number; cacheRead: number; cacheWrite: number }

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
  /** The spawn's `description` of the task (a few words); absent for an agent only seen through its events. */
  description?: string
  /** The last tool the agent called, from the `tool.call` events carrying its id; absent before its first call. */
  lastTool?: string
  /** The tools the agent has in flight (a `tool.call` seen before its `next` answered), in start order; the last one is the tool running now. */
  activeTools?: string[]
  status: 'running' | 'done'
  startedAt: number
  endedAt?: number
  /** True when the agent ended on an error, an interruption or a refusal, or the engine lists it failed or killed. */
  isFailed?: boolean
  /** True when the session ended with the agent still running: the history's third outcome, `interrotto`. */
  isInterrupted?: boolean
  /** New tokens the agent's turns used: input + cache writes + output (cache reads left out). */
  tokens: number
  /** The four counters of the agent's turns, live: each step adds its own, the turn's end replaces them with the turn's total. Absent before any usage was seen. */
  usage?: CockpitUsage
  /** The part of `usage` that the steps of the turn in progress added; the turn's end swaps it for the turn's own total. */
  stepUsage?: CockpitUsage
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
  /** Top level of the checkout the session runs in (`rev-parse --show-toplevel`): where the Repo tab's git reads run and the paths they list start. */
  root?: string
  /** The branch's upstream (`origin/feature/x`) and the commits ahead of it and behind it; absent without an upstream. */
  upstream?: string
  ahead?: number
  behind?: number
}

/** One changed file of the Repo tab: tracked with its added and deleted lines, a binary one without counts, or untracked. */
export type CockpitChange = { path: string; added?: number; deleted?: number; isBinary?: boolean; isUntracked?: boolean }

/** One checkout of the repository (`git worktree list`); `branch` is absent for a detached one. */
export type CockpitWorktree = { path: string; branch?: string }

/** What the Repo tab draws beyond the git grid, read only while that tab is selected. */
export type CockpitRepo = {
  /** The changed files, tracked first then untracked, kept to a few dozen. */
  files: CockpitChange[]
  /** How many files changed in all (`files` may hold fewer). */
  total: number
  /** Commits on HEAD that the repo's default branch lacks; absent when the default branch is unknown. */
  commits?: number
  worktrees: CockpitWorktree[]
}

/** The open pull request of the branch checked out. Azure DevOps lists no checks, so `checks` is then absent. */
export type CockpitPr = {
  number: number
  title: string
  isDraft: boolean
  review?: 'approved' | 'changes' | 'pending'
  checks?: { passed: number; failed: number; pending: number }
}

/** The diff the second pane draws: `text` is what `Code` takes (unified hunks); `isCut` when it was cut to fit; `isUnreadable` when the file is too big or cannot be read (no text). */
export type CockpitDiff = { file: string; text: string; isCut?: boolean; isUnreadable?: boolean }

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

/** The changed files of the worktree against HEAD (tracked and untracked) and those the active deliver perimeter does not cover. */
export type CockpitPerimeterCheck = { files: number; outside: string[] }

/** The agents of the workflow run in flight that the engine let the mod see (its spawns), and which of them finished. */
export type CockpitWorkflowRun = { runId: string; agents: { id: string; isDone: boolean }[] }

/** One line of `<config>/.cache/done-claim.log`: when, which rule fired, the words around the claim. */
export type CockpitDoneClaim = { at: string; rule: string; excerpt: string }

/** One reading of the 5h window's usage, `at` in `$.clock.now()` milliseconds. */
export type CockpitBurnSample = { at: number; used: number }

/** The ALM target the cwd resolves to in `workspaces.json`; absent from the snapshot when there is no usable map. */
export type CockpitAlm = { isMapped: boolean; org?: string; project?: string; identity?: string }

/**
 * What Claude is doing now, derived from the events the mod hears (the engine has no state of its own): a main turn
 * starting or a text chunk is `working`, a thinking chunk `thinking`, a main-loop tool call in flight `tool` (its name),
 * a permission request or a notification `waiting`, the main turn's end `idle`.
 */
export type CockpitClaudeState = { kind: 'idle' | 'working' | 'thinking' | 'tool' | 'waiting'; tool?: string }

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
  /** New tokens the main loop used this session (same count as an agent's `tokens`), live like an agent's `usage`; absent before any usage was seen. With the agents' it is the session's tokens. */
  mainTokens?: number
  /** The part of `mainTokens` that the steps of the turn in progress added. */
  mainStepTokens?: number
  /** The main loop's state for the header's icon; absent before any event (read as idle). */
  claudeState?: CockpitClaudeState
  /** The context size (`ctx.tokens`) at the end of the last main turns, newest last, at most six; a shrinking context starts it over. The autocompact forecast's input. */
  ctxSamples?: number[]
  /** The token count at which auto-compaction runs, read at each session start from `usage({ breakdown: 'summary' })` and kept across /clear and resume (it does not depend on the session); absent when it is off or unread. */
  autoCompactAt?: number
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
  /** Entries of the active deliver perimeter of the branch checked out (`<git-dir>/deliver/perimeter.md`); absent without one. */
  perimeter?: string[]
  /** The changed files outside `perimeter`, checked against HEAD like `hooks/scope-guard.js --check`; absent without a perimeter or when git could not say. */
  perimeterCheck?: CockpitPerimeterCheck
  /** The workflow run whose agents the mod saw spawn; cleared by a stop that reports no workflow in flight. */
  workflowRun?: CockpitWorkflowRun
  /** The last entries of `done-claim.log`, newest first; absent without a readable log. */
  doneClaims?: CockpitDoneClaim[]
  /** The open pull request of the branch checked out, read in the background (`gh pr view` on GitHub, `az repos pr list` on Azure DevOps). Absent without one. */
  pr?: CockpitPr
  /** The Repo tab's changed files and worktrees; absent until that tab was selected, and without git. */
  repo?: CockpitRepo
  /** The diff of the file pressed on the Repo tab, drawn by the pane `cockpit-diff`; absent when that pane is closed. */
  diff?: CockpitDiff
  /** The name of a workflow in flight in the background, as the last `Stop` / `SubagentStop` reported it (`background_tasks`); absent when none was. */
  workflow?: string
  /** The repo's default branch, as `origin/HEAD` names it: the commits of the Repo tab count from it. Absent when `origin/HEAD` is not set. */
  defaultBranch?: string
  /** Last tick, in `$.clock.now()` milliseconds: the "now" countdowns and durations count from. */
  now: number
}

declare module 'claude-code' {
  interface PluginState {
    cockpit: { snapshot: CockpitSnapshot }
  }
}
