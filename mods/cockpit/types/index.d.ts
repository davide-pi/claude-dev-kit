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
  /** True when the session ended with the agent still running: the history's third outcome, `interrupted`. */
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
  effort?: string | number
  /** The spawn's `description` of the task, kept so an expanded history row still says what the agent did; absent when it had none. */
  description?: string
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
  /** Top level of the checkout the session runs in (`rev-parse --show-toplevel`): where the Work tab's git reads run and the paths they list start. */
  root?: string
  /** The branch's upstream (`origin/feature/x`) and the commits ahead of it and behind it; absent without an upstream. */
  upstream?: string
  ahead?: number
  behind?: number
}

/** One changed file of the Work tab: tracked with its added and deleted lines, a binary one without counts, or untracked. */
export type CockpitChange = { path: string; added?: number; deleted?: number; isBinary?: boolean; isUntracked?: boolean }

/** What the Work tab draws of the repository beyond the header, read only while that tab is selected. */
export type CockpitRepo = {
  /** The changed files, tracked first then untracked, kept to a few dozen. */
  files: CockpitChange[]
  /** How many files changed in all (`files` may hold fewer). */
  total: number
  /** The commit the files are compared with: where the branch left the default branch (`git merge-base`). Absent when no default branch is known: the files are then the uncommitted ones, against HEAD. */
  base?: string
  /** The name of the default branch the branch is counted from (`main`). */
  from?: string
}

/** A pull request of this chat, as a link: seen for the branch checked out (`gh pr view`, `az repos pr list`) or created in the session. `url` is absent when the CLI named no web address. */
export type CockpitPr = {
  number: number
  title: string
  url?: string
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

/**
 * The workflow run in flight, as far as the engine lets the mod see it: its name (the `Workflow` tool's result), the agents it spawned
 * and which of them finished, the label of the newest one (`phase`: the engine exposes no phase) and the round its `R<n>` names, and when
 * any of its agents last did something. `endedAt` is set when a main turn starts or a clock tick finds every agent done (a silent run's agents are taken as done); a later spawn reopens the run.
 */
export type CockpitWorkflowRun = {
  runId: string
  name?: string
  agents: { id: string; isDone: boolean }[]
  phase?: string
  round?: number
  lastAt?: number
  endedAt?: number
}

/** One line of `<config>/.cache/done-claim.log`: when, which rule fired, the words around the claim. */
export type CockpitDoneClaim = { at: string; session?: string; rule: string; excerpt: string }

/** The ALM target the cwd resolves to in `workspaces.json`; absent from the snapshot when there is no usable map. */
export type CockpitAlm = { isMapped: boolean; org?: string; project?: string; identity?: string }

/**
 * What Claude is doing now, derived from the events the mod hears (the engine has no state of its own): a main turn
 * starting or a text chunk is `working`, a thinking chunk `thinking`, a main-loop tool call in flight `tool` (its name),
 * a tool call the person has to approve (`tool.check` asks) `waiting` until that call ends, the main turn's end `idle`.
 */
export type CockpitClaudeState = { kind: 'idle' | 'working' | 'thinking' | 'tool' | 'waiting'; tool?: string; /** `$.clock.now()` when the wait for the person began (`waiting` only). */ since?: number }

/** One row of the Context tab's table: a category of the context breakdown, `kind` as the engine stamps it (`used` fills the window, `free` is what is left, `buffer` the compaction reserve, `deferred` is outside the window). */
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

/** What the Context tab draws from `usage({ breakdown })`: the rows, the window they are measured against, the five biggest static consumers. */
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

/** The view the pane draws, the tab bar's five buttons: `agents` is Agenti, `context` Contesto, `signals` Notifiche, `work` Lavoro, `notes` Note. */
export type CockpitTab = 'agents' | 'context' | 'signals' | 'work' | 'notes'

/** What an entry of the event ring buffer is about: a finished agent (the Context tab prices it). */
export type CockpitEventKind = 'agent'

/** One entry of the event buffer: when, what, and the numbers an agent carries (its cost, model, effort, tokens, cache hit, duration `ms` and whether it failed; `text` is the agent type, `desc` its spawn description). `key` makes an entry once-only. */
export type CockpitEvent = { at: number; kind: CockpitEventKind; key?: string; text?: string; desc?: string; effort?: string | number; ms?: number; isFailed?: boolean; usd?: number; model?: string; tokens?: number; hit?: number; id?: string }

/**
 * What the Insights tab adds up of the session's main loop, from the events the mod already hears (nothing is asked of the engine
 * for it); per session, not persisted.
 */
export type CockpitInsights = {
  /** Main turns that ended. */
  rounds: number
  /** Their cost in USD where the engine measured it, and the dearest one with its length. */
  usd: number
  costliest?: { usd: number; ms: number }
  /** Compactions the session went through, manual or automatic. */
  compactions: number
  /** Wall-clock milliseconds: the rounds', the main loop's tool calls', and the permission requests' wait for the person. */
  roundMs: number
  toolMs: number
  waitMs: number
  /** Calls and failures (an error, a refusal or a throw) by tool name. */
  tools: Record<string, { calls: number; failed: number }>
  /** Successful reads by file path. */
  reads: Record<string, number>
  /** The cache hit of the last twenty main turns, oldest first. */
  cacheShares: number[]
  /** The five main-loop calls whose result was the largest since the last compaction, biggest first: the tool, its short argument and the result's estimated tokens (characters / 4). */
  biggest?: { tool: string; arg?: string; tokens: number }[]
  /** How many times each Bash command failed (its short argument). */
  failedCmds?: Record<string, number>
  /** When the last main round ended (`$.clock.now()`). */
  lastRoundEnd?: number
  /** The last round that began after an idle gap over the signals' limit: its number, its cache hit and the gap. */
  idleCold?: { round: number; share: number; gapMs: number }
  /** The last main-loop call that failed: the tool and its error message on one line. */
  lastError?: { tool: string; text: string }
  /** The context before and after each of the last three compactions, oldest first; `after` is the first reading that followed (absent until one did). */
  compactCtx?: { before: number; after?: number }[]
}

/** A note saved on the Notes tab; `id` is stable, the list keeps the order the notes were saved in. */
export type CockpitNote = { id: number; text: string }

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
  /** The context size at the end of each of the last twenty main turns, newest last: the Context tab's trend line. A shrinking context stays in it (a compaction shows as a drop). */
  ctxRounds?: number[]
  /** The absolute paths (forward slashes) this chat edited, main loop or subagents, in the order first edited: the Work tab marks them among the changes. Kept in the session data file. */
  edited?: string[]
  /** The Costi tab's last reading of the context breakdown; absent until the tab was opened. */
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
  /** The skills invoked this session (`skill.prompt`), once each, in the order they first ran: the Insights tab lists them. */
  skillsUsed?: string[]
  /** The token count at which auto-compaction runs, read at each session start from `usage({ breakdown: 'summary' })` and kept across /clear and resume (it does not depend on the session); absent when it is off or unread. */
  autoCompactAt?: number
  alm?: CockpitAlm
  /** The selected tab; absent is the Subagents view. */
  tab?: CockpitTab
  agents: CockpitAgent[]
  /** Finished agents that left the live list, newest first; absent in a state written before the history existed. */
  history?: CockpitHistoryEntry[]
  /** The HISTORY list shows every entry; absent shows the newest few. */
  isHistoryOpen?: boolean
  /** The TOP AGENTS list shows every agent; absent shows the dearest few. */
  isCostAgentsOpen?: boolean
  /** The notification whose why and what-to-do are shown (`kind:key`); absent shows none. */
  signalOpen?: string
  /** The notifications the person has seen (the ids the Notifications tab listed when it was open); the tab label counts the others. */
  seenSignals?: string[]
  /** When each notification in force first held (`kind:key` → ms): the time on its row. One that stops holding is dropped. */
  signalsAt?: Record<string, number>
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
  /** The last blocks of `done-claim.log` (this session's), newest first; the Insights tab shows this session's three newest. Absent without a readable log. */
  doneClaims?: CockpitDoneClaim[]
  /** The pull requests of this chat, oldest first, at most ten; kept with the session in its data file. Absent without one. */
  prs?: CockpitPr[]
  /** The Work tab's changed files; absent until that tab was selected, and without git. */
  repo?: CockpitRepo
  /** The ring buffer of finished rounds and agents, oldest first. */
  events?: CockpitEvent[]
  /** `$.clock.now()` of the session's first reading: the Costi tab's $/h counts from it. */
  startedAt?: number
  /** A button waiting for its confirmation: the footer's `analizza suite` or Lavoro's `log hours`. */
  confirm?: 'suite' | 'worklog' | `note:${number}`
  /** What the Insights tab shows; absent before the first round or tool call. */
  insights?: CockpitInsights
  /** The agents expanded on the Agents tab (the others show their one line): description, facts, warning, four token counters, tool. */
  agentsOpen?: string[]
  /** The notes shown in full on the Notes tab (the others show their first lines). */
  notesOpen?: number[]
  /** `$.clock.now()` when the Context tab's `refresh` was last pressed: the button waits a minute from it. */
  refreshedAt?: number
  /** The Notes tab's saved notes, kept with the session in its data file; `send` appends one to the prompt box and keeps it. Absent when none. */
  notes?: CockpitNote[]
  /** What the Notes tab's field holds (not kept in the data file); absent when empty. */
  noteDraft?: string
  /** True once the pane's language was read (a session start or the first drawing); not kept in any file. */
  isLangRead?: boolean
  /** The id of the note the field was loaded from: `save` replaces that note instead of adding one. */
  noteEditing?: number
  /** The diff of the file pressed on the Work tab, drawn by the pane `cockpit-diff`; absent when that pane is closed. */
  diff?: CockpitDiff
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
