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

/** A finished agent that left the live list, as the history keeps it (and the session data file persists it). */
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
  /** Top level of the checkout the session runs in (`rev-parse --show-toplevel`): where the Lavoro tab's git reads run and the paths they list start. */
  root?: string
  /** The branch's upstream (`origin/feature/x`) and the commits ahead of it and behind it; absent without an upstream. */
  upstream?: string
  ahead?: number
  behind?: number
}

/** One changed file of the Lavoro tab: tracked with its added and deleted lines, a binary one without counts, or untracked. */
export type CockpitChange = { path: string; added?: number; deleted?: number; isBinary?: boolean; isUntracked?: boolean }

/** What the Lavoro tab draws of the repository beyond the header, read only while that tab is selected. */
export type CockpitRepo = {
  /** The changed files, tracked first then untracked, kept to a few dozen. */
  files: CockpitChange[]
  /** How many files changed in all (`files` may hold fewer). */
  total: number
}

/**
 * A pull request of this chat: seen for the branch checked out (`gh pr view`, `az repos pr list`) or created in the session
 * (`gh pr create`, `az repos pr create`). Azure DevOps lists no checks, so `checks` is then absent; `url` is absent when the
 * CLI named no web address.
 */
export type CockpitPr = {
  number: number
  title: string
  state: 'open' | 'merged' | 'closed'
  isDraft: boolean
  url?: string
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

/** One row of the Contesto tab's table: a category of the context breakdown, `kind` as the engine stamps it (`used` fills the window, `free` is what is left, `buffer` the compaction reserve, `deferred` is outside the window). */
export type CockpitContextRow = {
  name: string
  tokens: number
  kind: 'used' | 'free' | 'buffer' | 'deferred'
  /** The change of the row in the last round (negative: it shrank); absent before a round was seen. */
  delta?: number
  /** True when the tokens are those of an exact count kept from earlier, not this reading's estimate. */
  isExact?: true
}

/** What an exact (`full`) reading fixes for the rest of the session: the static rows (every one but Messages), the consumers and the skills listing. */
export type CockpitStatic = {
  rows: { name: string; tokens: number }[]
  consumers: CockpitConsumer[]
  skills?: { listed: number; total: number }
}

/** A static consumer of the window: a memory file, a loaded MCP tool's schema, a custom agent's description, or the skills listing as a whole. */
export type CockpitConsumer = { name: string; kind: 'memory' | 'mcp' | 'agent' | 'skill'; tokens: number }

/** What the Contesto tab draws from `usage({ breakdown })`: the rows, the window they are measured against, the five biggest static consumers. */
export type CockpitContext = {
  rows: CockpitContextRow[]
  /** Tokens in use and the window measured against (the compaction window), as the breakdown counts them. */
  total: number
  max: number
  /** The five biggest static consumers, biggest first. */
  consumers: CockpitConsumer[]
  /** How many skills the listing includes of those the session has; absent when the session lists none. */
  skills?: { listed: number; total: number }
  /** True when the whole breakdown was counted with the token-count API (`full`); false for the local estimate (its static rows may still be exact: `isExact` per row). */
  isExact: boolean
}

/** One tool call of the main loop, as the Lavoro tab's list keeps it: the tool, its short argument, whether it ran without error or refusal, and when it started (absent when the clock could not be read: the row then draws no time). */
export type CockpitToolCall = { tool: string; arg?: string; isOk: boolean; at?: number }

/** The parts of the Sistema tab the monitor reads, in the order the tab draws them. */
export type CockpitSystemPart = 'cpu' | 'ram' | 'net' | 'procs' | 'disk' | 'power'

/** A process of the session's tree with the TCP ports it listens on, its CPU share (percent of every core, since the monitor's last read) and its working set in bytes; the last two are absent until read. */
export type CockpitSysProc = { pid: number; name: string; ports: number[]; cpu?: number; ram?: number }

/** Where the machine's power comes from: the wall, or a battery with its charge and whether it is plugged in. */
export type CockpitPower = { kind: 'wired' } | { kind: 'battery'; percent: number; isCharging: boolean }

/** The free and total bytes of the working directory's drive, and its short name (`D:`, `/`). */
export type CockpitDisk = { free: number; total: number; label?: string }

/** One JSON line of the system monitor (`sysmon/sysmon.mjs`), narrowed: only the parts it carries; `off` names the parts it cannot read. */
export type CockpitSysLine = {
  /** CPU busy share, 0-100. */
  cpu?: number
  ram?: { used: number; total: number }
  /** Network bytes per second. */
  net?: { rx: number; tx: number }
  procs?: CockpitSysProc[]
  disk?: CockpitDisk
  power?: CockpitPower
  off?: CockpitSystemPart[]
}

/** What the Sistema tab draws: rings of the last samples (newest last), the latest slow readings, and the parts that could not be read. */
export type CockpitSystem = {
  cpu: number[]
  /** RAM used, as a percent of the total. */
  ram: number[]
  ramUsed?: number
  ramTotal?: number
  rx: number[]
  tx: number[]
  procs?: CockpitSysProc[]
  disk?: CockpitDisk
  power?: CockpitPower
  /** The parts that read "unavailable": the tool is missing or failed, or the monitor itself could not run. */
  off: CockpitSystemPart[]
}

/** The view the pane draws: the tab bar's four buttons. */
export type CockpitTab = 'agents' | 'context' | 'work' | 'system'

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
  /** New tokens of every agent that left the live list this session: the share's counterpart of `mainTokens`, kept with it in the state file (the history is cut and cannot be summed). Absent until one left. */
  agentTokens?: number
  /** The main loop's state for the header's icon; absent before any event (read as idle). */
  claudeState?: CockpitClaudeState
  /** The context size (`ctx.tokens`) at the end of the last main turns, newest last, at most six; a shrinking context starts it over. The autocompact forecast's input. */
  ctxSamples?: number[]
  /** The context size at the end of each of the last twenty main turns, newest last: the Contesto sparkline. A shrinking context stays in it (a compaction shows as a drop). */
  ctxRounds?: number[]
  /** The Contesto tab's last reading of the context breakdown; absent until the tab was opened. */
  context?: CockpitContext
  /** The number of the read that `context` holds: reads overlap, and one that started earlier than it never replaces it. */
  contextSeq?: number
  /** The static part of the session's first exact count: every later summary reading reuses it (Messages stay live); absent until one ran. */
  contextStatic?: CockpitStatic
  /** The context of the session's last state (its data file), drawn with a `~` until the engine measures the live window; never an alert's input. */
  lastCtx?: { tokens: number; window: number; percent: number }
  /** The rate limits of the status line's cache, drawn with a `~` while the engine reports none; never an alert's input. */
  lastRates?: CockpitRateLimit[]
  /** How long the last main round took (`turn.complete`'s wall-clock length), in milliseconds; absent before one ended. */
  lastRoundMs?: number
  /** The skills invoked this session (`skill.prompt`), once each, in the order they first ran. */
  skillsUsed?: string[]
  /** The token count at which auto-compaction runs, read at each session start from `usage({ breakdown: 'summary' })` and kept across /clear and resume (it does not depend on the session); absent when it is off or unread. */
  autoCompactAt?: number
  alm?: CockpitAlm
  /** The selected tab; absent is the Agenti view. */
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
  /** The pull requests of this chat, oldest first, at most ten; kept with the session in its data file. Absent without one. */
  prs?: CockpitPr[]
  /** The last eight tool calls of the main loop, oldest first (the subagents' are theirs); per session, not persisted. */
  calls?: CockpitToolCall[]
  /** The Lavoro tab's changed files; absent until that tab was selected, and without git. */
  repo?: CockpitRepo
  /** The Sistema tab's readings, kept while the monitor runs; absent when it is not (another tab, or the pane closed). */
  system?: CockpitSystem
  /** The quick note under the tab bar, kept with the session in its data file; `invia` appends it to the prompt box and clears it. Absent when empty. */
  note?: string
  /** The diff of the file pressed on the Lavoro tab, drawn by the pane `cockpit-diff`; absent when that pane is closed. */
  diff?: CockpitDiff
  /** The name of a workflow in flight in the background, as the last `Stop` / `SubagentStop` reported it (`background_tasks`); absent when none was. */
  workflow?: string
  /** The repo's default branch, as `origin/HEAD` names it: no pull request is looked for on it. Absent when `origin/HEAD` is not set. */
  defaultBranch?: string
  /** Last tick, in `$.clock.now()` milliseconds: the "now" countdowns and durations count from. */
  now: number
}

declare module 'claude-code' {
  interface PluginState {
    cockpit: { snapshot: CockpitSnapshot }
  }
}
