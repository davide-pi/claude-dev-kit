import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { CockpitAgent, CockpitHistoryEntry, CockpitSnapshot, CockpitTab, CockpitTask } from '../types'
import { AGENT_KEEP_MS, addHistory, isTab, parseGitStatus, parseHistory, parseReset, parseWorktree, recordBurnSample, resolveAlm, toHistory, worklogDays } from './format'
import type { WorklogSnapshot } from './format'
import { INITIAL, PANE } from './state'
import type { PaneActions } from './view'
import { PANE_MAX_COLUMNS, agentCounts, paneView, taskCounts } from './view'

const TICK_MS = 15_000

// The scan that checks `$.state` references reads the atom from the file that uses it.
const snapshot = atom({ plugin: 'cockpit', key: 'snapshot' } as const, INITIAL)

/** Writes `next(current)`, unless it equals the current value: a no-op must not redraw the readers. */
async function patch($: EngineInterface, next: (s: CockpitSnapshot) => CockpitSnapshot): Promise<void> {
  // After a session's end (a /clear, a resume) no session start follows: the first change under another id adopts it.
  await adoptSession($).catch(() => undefined)
  const current = await read($, snapshot)
  if (JSON.stringify(next(current)) === JSON.stringify(current)) return
  await update($, snapshot, next)
  await writeState($)
}

/** The 5h samples after a reading of the rate limits the engine reported at `now`; the window's usage and reset time are absent off a subscription. */
function withBurnSample(samples: CockpitSnapshot['fiveHourSamples'], now: number, limits: CockpitSnapshot['rateLimits']) {
  const w = limits.find(r => r.kind === 'five_hour')
  return recordBurnSample(samples, now, w?.percentUsed, parseReset(w?.resetsAt))
}

const sumUsage = (u: { input_tokens: number; output_tokens: number; cache_creation_input_tokens: number }) =>
  u.input_tokens + u.output_tokens + u.cache_creation_input_tokens

// ── Collection helpers (each one swallows its own failure: a missing datum stays absent) ──

async function refreshGit($: EngineInterface): Promise<void> {
  try {
    const cwd = await $.session.cwd()
    const base = ['git', '-C', cwd, '--no-optional-locks']
    const status = await $.process.run([...base, 'status', '--porcelain', '-b'], { timeoutMs: 2000 })
    const parsed = status.exitCode === 0 ? parseGitStatus(status.stdout) : undefined
    if (!parsed) return void (await patch($, s => ({ ...s, cwd, git: undefined })))
    const tree = await $.process.run([...base, 'rev-parse', '--git-dir', '--git-common-dir', '--show-toplevel'], { timeoutMs: 2000 })
    const worktreeRoot = tree.exitCode === 0 ? parseWorktree(tree.stdout) : undefined
    await patch($, s => ({ ...s, cwd, git: { ...parsed, worktreeRoot } }))
  } catch {
    // git missing or too slow: keep the last reading
  }
}

async function configDir($: EngineInterface): Promise<string | undefined> {
  const explicit = await $.env.get('CLAUDE_CONFIG_DIR')
  if (explicit) return explicit
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))
  return home ? `${home}/.claude` : undefined
}

// ── The statusline's state file ──
// `<configDir>/.cache/cockpit-<sessionId>.json`: what the user's statusline reads to hide itself while the pane is open
// and to show the last turn's cost and the agent counts. Same id rule as the statusline's context snapshot.

const STATE_MIN_MS = 3000
const SESSION_ID = /^[\w-]{1,128}$/

// Not an atom: the first render of a pane that waited undrawn must set it, and a render cannot write state.
// The pane starts closed, `/cockpit` opens it, the person's close shuts it. A reload starts these over.
let isOpen = false
let lastWritten = ''
let lastWriteAt = 0
let isWriteScheduled = false

/**
 * Writes the state file when its content changed, at most once per `STATE_MIN_MS`: a change inside the window is
 * written when it ends. `isForced` skips the window (open, close, session start). `isHeartbeat` rewrites unchanged
 * content with a fresh `at`: the statusline trusts `open:true` only while `at` is recent. A failure leaves the file as it was.
 */
async function writeState($: EngineInterface, isForced = false, isHeartbeat = false): Promise<void> {
  try {
    const dir = await configDir($)
    const id = await $.session.id()
    if (!dir || !SESSION_ID.test(id)) return
    const s = await read($, snapshot)
    // The snapshot belongs to another session (or none yet): its history is not this id's to write.
    if (s.sessionId !== id) return
    const { usd, startUsd } = s.cost
    const counts = taskCounts(s)
    const content = {
      open: isOpen,
      lastTurnUsd: usd !== undefined && startUsd !== undefined ? Math.round((usd - startUsd) * 100) / 100 : null,
      agents: agentCounts(s),
      effort: typeof s.effort === 'string' ? s.effort : null,
      tasks: counts ? { done: counts.done, total: counts.total } : null,
      tab: s.tab ?? 'session',
      history: s.history ?? [],
    }
    const file = `${dir}/.cache/cockpit-${id}.json`
    const key = `${file} ${JSON.stringify(content)}`
    if (key === lastWritten && !isHeartbeat) return
    const now = await $.clock.now()
    const wait = STATE_MIN_MS - (now - lastWriteAt)
    if (!isForced && wait > 0) {
      if (!isWriteScheduled) {
        isWriteScheduled = true
        $.clock.after(wait, () => {
          isWriteScheduled = false
          void writeState($).catch(() => undefined)
        })
      }
      return
    }
    const { open, ...rest } = content
    await $.fs.write(file, JSON.stringify({ open, at: now, ...rest }))
    lastWritten = key
    lastWriteAt = now
  } catch {
    // best-effort: the statusline simply shows what it showed
  }
}

/** What an earlier run of session `id` left in its state file: the tab (none for a missing file or an unknown one) and the agent history. */
async function savedState($: EngineInterface, id: string): Promise<{ tab?: CockpitTab; history: CockpitHistoryEntry[] }> {
  try {
    const dir = await configDir($)
    if (!dir || !SESSION_ID.test(id)) return { history: [] }
    const text = await $.fs.read(`${dir}/.cache/cockpit-${id}.json`)
    const parsed: unknown = JSON.parse(typeof text === 'string' ? text : '')
    if (typeof parsed !== 'object' || parsed === null) return { history: [] }
    const tab = 'tab' in parsed ? parsed.tab : undefined
    return { tab: isTab(tab) ? tab : undefined, history: parseHistory('history' in parsed ? parsed.history : undefined) }
  } catch {
    return { history: [] }
  }
}

/** The snapshot between two sessions: its agents went to the ending session's history, the per-session readings start over, no session owns it. */
const withoutSession = (s: CockpitSnapshot): CockpitSnapshot => ({
  ...s,
  sessionId: undefined,
  agents: [],
  history: [],
  tasks: [],
  cacheShare: undefined,
  fiveHourSamples: [],
})

/**
 * Makes the snapshot the session the engine answers now: the same id (a reload, an enable, a respawn) changes nothing;
 * another loads that session's saved tab and history. The id of the session that just ended is skipped (the engine
 * answers it until it switches), unless `isStart`: a session start of that same id is a resume.
 */
async function adoptSession($: EngineInterface, isStart = false): Promise<void> {
  const id = await $.session.id()
  const current = await read($, snapshot)
  if (current.sessionId === id || (!isStart && current.endedSessionId === id)) return
  const saved = await savedState($, id)
  await update($, snapshot, s =>
    s.sessionId === id ? s : { ...withoutSession(s), sessionId: id, endedSessionId: undefined, tab: saved.tab ?? s.tab, history: saved.history },
  )
}

async function setOpen($: EngineInterface, value: boolean): Promise<void> {
  isOpen = value
  await adoptSession($).catch(() => undefined)
  await writeState($, true)
}

async function refreshWorklog($: EngineInterface, now: number): Promise<void> {
  try {
    const dir = await configDir($)
    if (!dir) return
    const text = await $.fs.read(`${dir}/.worklog-pending.json`)
    const parsed: unknown = JSON.parse(typeof text === 'string' ? text : '')
    if (typeof parsed !== 'object' || parsed === null) return
    // Narrowed once here: the file is written by the worklog hook, read as that shape.
    const snap: WorklogSnapshot = parsed
    const audit = await $.fs.stat(`${dir}/worklog/pushed.json`).catch(() => undefined)
    const d = new Date(now)
    const p = (n: number) => String(n).padStart(2, '0')
    const today = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
    const worklog = worklogDays(snap, audit?.mtimeMs, today)
    await patch($, s => ({ ...s, worklog }))
  } catch {
    // no snapshot yet: no badge
  }
}

/** The ALM target of the cwd from `<config>/workspaces.json`; no file or a malformed one clears the line. */
async function refreshAlm($: EngineInterface): Promise<void> {
  try {
    const dir = await configDir($)
    if (!dir) return
    const text = await $.fs.read(`${dir}/workspaces.json`)
    const alm = resolveAlm(JSON.parse(typeof text === 'string' ? text : ''), await $.session.cwd())
    await patch($, s => ({ ...s, alm }))
  } catch {
    // no readable map: no line, and not the last map's
    await patch($, s => ({ ...s, alm: undefined })).catch(() => undefined)
  }
}

async function refreshUsage($: EngineInterface): Promise<void> {
  try {
    const u = await $.session.usage()
    const now = await $.clock.now()
    await patch($, s => ({
      ...s,
      fiveHourSamples: withBurnSample(s.fiveHourSamples, now, u.rateLimits),
      ctx: { ...s.ctx, tokens: u.context.tokens, window: u.context.window, percent: u.context.percent },
      cost: { ...s.cost, usd: u.cost?.usd },
      rateLimits: u.rateLimits,
    }))
  } catch {
    // not measured yet
  }
}

/** Ticks: the clock the countdowns and durations count from, finished agents moved to the history, the rest re-read. */
async function tick($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  const listed = await $.agent.list().catch(() => undefined)
  await patch($, s => {
    const agents = s.agents.map((a): CockpitAgent => {
      // An agent the engine no longer lists as active has ended without a turn.complete we saw.
      const info = listed?.find(l => l.id === a.id)
      const isEnded = listed !== undefined && a.status === 'running' && (!info || ['completed', 'failed', 'killed'].includes(info.status))
      return isEnded ? { ...a, status: 'done', endedAt: now, isFailed: info?.status === 'failed' || info?.status === 'killed' } : a
    })
    const isListed = (a: CockpitAgent) => a.status === 'running' || (a.endedAt !== undefined && now - a.endedAt < AGENT_KEEP_MS)
    const left = agents
      .filter(a => !isListed(a))
      .map(toHistory)
      .filter((h): h is CockpitHistoryEntry => h !== undefined)
      .sort((a, b) => b.endedAt - a.endedAt)
    return { ...s, now, agents: agents.filter(isListed), history: left.length > 0 ? addHistory(s.history, left) : s.history }
  })
  await refreshGit($)
  await refreshWorklog($, now)
  await refreshAlm($)
  // While the pane is open the file is the proof of it: a stale `at` lets the statusline ignore a leftover `open:true`.
  if (isOpen) await writeState($, true, true)
}

/** Applies `change` to the agent `id`; an agent whose events outran its spawn gets a stub the spawn later fills. */
function upsertAgent(agents: CockpitAgent[], id: string, now: number, change: (a: CockpitAgent) => CockpitAgent): CockpitAgent[] {
  const stub: CockpitAgent = { id, type: '?', status: 'running', startedAt: now, tokens: 0 }
  return agents.some(a => a.id === id)
    ? agents.map(a => (a.id === id ? change(a) : a))
    : [...agents, change(stub)]
}

// ── Tasks: the main thread's task tools and TodoWrite, one merged list ──

const TODO_PREFIX = 'todo:'

/** TodoWrite sends the whole list: it replaces the TodoWrite items, the task-tool items stay. */
function applyTodos(
  tasks: readonly CockpitTask[],
  todos: readonly { content: string; status: CockpitTask['status'] }[],
  now: number,
): CockpitTask[] {
  const before = new Map(tasks.map(t => [t.id, t]))
  const written = todos.map((todo): CockpitTask => {
    const id = TODO_PREFIX + todo.content
    const wasActive = before.get(id)?.status === 'in_progress'
    const startedAt = todo.status === 'in_progress' ? (wasActive ? before.get(id)?.startedAt : undefined) ?? now : undefined
    return { id, subject: todo.content, status: todo.status, startedAt }
  })
  return [...tasks.filter(t => !t.id.startsWith(TODO_PREFIX)), ...written]
}

/** A call that answered without error and was not refused. */
const isOk = (ran: { deny?: string; isError?: boolean }) => ran.deny === undefined && ran.isError !== true

/** A TaskUpdate result that says it did not apply (`success: false`), narrowed from `unknown`. */
function isRefused(result: unknown): boolean {
  return typeof result === 'object' && result !== null && 'success' in result && result.success === false
}

/** The `task` a TaskCreate result carries, narrowed once here: the result reaches a hook as `unknown`. */
function createdTask(result: unknown): { id: string; subject: string } | undefined {
  if (typeof result !== 'object' || result === null || !('task' in result)) return undefined
  const { task } = result
  if (typeof task !== 'object' || task === null || !('id' in task) || !('subject' in task)) return undefined
  return typeof task.id === 'string' && typeof task.subject === 'string' ? { id: task.id, subject: task.subject } : undefined
}

/** What the pane's buttons do. Each runs apart from the press and fails alone: a refused call leaves the pane as it was. */
const paneActions = ($: EngineInterface): PaneActions => ({
  selectTab: tab => void patch($, s => ({ ...s, tab })).catch(() => undefined),
  compact: () => void $.session.compact().catch(() => undefined),
  runWorklog: () => void $.command.run({ command: 'worklog' }).catch(() => undefined),
  copyBranch: (branch, surface) => void $.ui.copy({ text: branch, surface }).catch(() => undefined),
  openAgent: agentId => void $.ui.view({ agentId }).catch(() => undefined),
  toggleHistory: () => void patch($, s => ({ ...s, isHistoryOpen: !s.isHistoryOpen })).catch(() => undefined),
})

const openPane = ($: EngineInterface) => $.ui.open({ id: PANE, title: 'cockpit', columns: PANE_MAX_COLUMNS })

/** Opens the pane; one that waits undrawn is not open yet: its first render says so. */
async function open($: EngineInterface) {
  const opened = await openPane($)
  await setOpen($, opened.isPlaced)
  return opened
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const now = await $.clock.now()
    const forced = await $.env.get('CLAUDE_CODE_SUBAGENT_MODEL')
    const model = await $.session.model().catch(() => undefined)
    const effort = await $.settings.read({ key: 'effortLevel' }).catch(() => undefined)
    // The same session id (an enable, a respawn, a reload) keeps what the snapshot holds; another one starts its own.
    await adoptSession($, true)
    await patch($, s => ({
      ...s,
      now,
      model,
      effort: s.effort ?? (typeof effort === 'string' ? effort : undefined),
      isSubagentModelForced: Boolean(forced),
    }))
    await refreshUsage($)
    await refreshGit($)
    await refreshWorklog($, now)
    await refreshAlm($)
    await writeState($, true)

    await $.command.register({ name: 'cockpit', description: 'Apre il pannello cockpit' })
    $.clock.every(TICK_MS, () => void tick($).catch(() => undefined))
    // The pane starts closed: `/cockpit` opens it.
    return next(e)
  })

  // The ending session's file is left closed and empty, so the statusline drops its segments at once, with every
  // finished agent in its history; the statusline's hourly prune removes the file itself after 3 days (`$.fs` cannot
  // delete). Best-effort: the write is skipped when the exit's short budget is nearly spent, and any failure is swallowed.
  // The snapshot lets go of the session first (any reason), from the reading taken here, so a write cut short cannot
  // leave it in the atom: its agents go to its own history (the ones still running as `interrotto`), and the ended id
  // is remembered, since the engine answers it until it switches to the next one. The next change adopts that one.
  on('session.end', async ($, e, next) => {
    let s: CockpitSnapshot | undefined
    try {
      s = await read($, snapshot)
      if (s.sessionId === e.sessionId || s.sessionId === undefined) {
        await update($, snapshot, x => ({ ...withoutSession(x), endedSessionId: e.sessionId }))
      }
    } catch {
      // the snapshot keeps the old id: writeState writes nothing for another one
    }
    try {
      const dir = await configDir($)
      if (s && dir && SESSION_ID.test(e.sessionId) && next.budget.remainingMs > 500) {
        const own = s.sessionId === e.sessionId ? s : undefined
        const at = await $.clock.now()
        const left = (own?.agents ?? [])
          .map(a => toHistory(a.status === 'running' ? { ...a, endedAt: at, isInterrupted: true } : a))
          .filter((h): h is CockpitHistoryEntry => h !== undefined)
          .sort((a, b) => b.endedAt - a.endedAt)
        const history = addHistory(own?.history, left)
        const content = { open: false, at, lastTurnUsd: null, agents: { running: 0, modelWarnings: 0 }, effort: null, tasks: null, tab: own?.tab ?? 'session', history }
        await $.fs.write(`${dir}/.cache/cockpit-${e.sessionId}.json`, JSON.stringify(content))
      }
    } catch {
      // the file ages out on its own
    }
    return next(e)
  })

  // `/cockpit` opens the pane; a command-initiated open is placed at any width.
  on('command.run', { command: 'cockpit' }, async $ => {
    const opened = await open($)
    return { text: opened.isPlaced ? 'cockpit aperto' : `cockpit in attesa: ${opened.reason}` }
  })

  // Any close, whoever asked for it: the pane stays closed until `/cockpit`.
  on('ui.close', { id: PANE }, async ($, e, next) => {
    const closed = await next(e)
    await setOpen($, false)
    return closed
  })

  on('session.measure', async ($, e, next) => {
    const now = await $.clock.now()
    await patch($, s => ({
      ...s,
      fiveHourSamples: withBurnSample(s.fiveHourSamples, now, e.rateLimits),
      ctx: { ...s.ctx, tokens: e.context.tokens, window: e.context.window, percent: e.context.percent },
      cost: { ...s.cost, usd: e.cost?.usd },
      rateLimits: e.rateLimits,
    }))
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    // The deltas count from where the main loop's turn began.
    if (e.agentId === undefined) {
      await patch($, s => ({
        ...s,
        ctx: { ...s.ctx, startTokens: s.ctx.tokens ?? 0 },
        cost: { ...s.cost, startUsd: s.cost.usd ?? 0 },
      }))
    }
    return next(e)
  })

  // A streaming event: the hook is a generator and forwards what the engine streams.
  on('turn.step', async function* ($, e, next) {
    try {
      const { agentId, model, effort } = e
      const now = await $.clock.now()
      await patch($, s =>
        agentId === undefined
          ? { ...s, model, effort }
          : { ...s, agents: upsertAgent(s.agents, agentId, now, a => ({ ...a, model, effort })) },
      )
    } catch {
      // observing must never break the step
    }
    return yield* next(e)
  })

  // Tasks: TodoWrite is a per-agent list, so only the main thread (no `agentId`) feeds it; a call that failed changes nothing.
  on('tool.call', { tool: 'TodoWrite' }, async ($, e, next) => {
    const ran = await next(e)
    if (e.agentId === undefined && isOk(ran)) {
      try {
        const now = await $.clock.now()
        await patch($, s => ({ ...s, tasks: applyTodos(s.tasks ?? [], e.todos, now) }))
      } catch {
        // observing must never break the call
      }
    }
    return ran
  })

  on('tool.call', { tool: 'TaskCreate' }, async ($, e, next) => {
    const ran = await next(e)
    const created = ran.deny === undefined ? createdTask(ran.result) : undefined
    if (isOk(ran) && created) {
      try {
        const { id, subject } = created
        await patch($, s => ({
          ...s,
          tasks: [...(s.tasks ?? []).filter(t => t.id !== id), { id, subject, status: 'pending' }],
        }))
      } catch {
        // observing must never break the call
      }
    }
    return ran
  })

  on('tool.call', { tool: 'TaskUpdate' }, async ($, e, next) => {
    const ran = await next(e)
    // The task list is shared: a subagent's TaskCreate/TaskUpdate count too (TodoWrite is per agent, main thread only).
    if (isOk(ran) && !isRefused(ran.result)) {
      try {
        const now = await $.clock.now()
        const { taskId, status, subject } = e
        await patch($, s => {
          const tasks = s.tasks ?? []
          if (status === 'deleted') return { ...s, tasks: tasks.filter(t => t.id !== taskId) }
          // A task the mod never saw (created before a reload or a resume) is added by its first update.
          if (status !== undefined && !tasks.some(t => t.id === taskId)) {
            const added: CockpitTask = { id: taskId, subject: subject ?? `#${taskId}`, status, startedAt: status === 'in_progress' ? now : undefined }
            return { ...s, tasks: [...tasks, added] }
          }
          return {
            ...s,
            tasks: tasks.map((t): CockpitTask => {
              if (t.id !== taskId) return t
              const updated: CockpitTask = { ...t, subject: subject ?? t.subject }
              if (status === undefined) return updated
              if (status === 'in_progress') return { ...updated, status, startedAt: t.status === 'in_progress' ? t.startedAt : now }
              return { ...updated, status, startedAt: undefined }
            }),
          }
        })
      } catch {
        // observing must never break the call
      }
    }
    return ran
  })

  on('agent.spawn', async ($, e, next) => {
    const spawned = await next(e)
    if (spawned.agentId !== undefined) {
      const id = spawned.agentId
      const startedAt = await $.clock.now()
      await patch($, s => ({
        ...s,
        agents: upsertAgent(s.agents, id, startedAt, a => ({
          ...a,
          parentId: e.parentAgentId,
          type: e.subagentType,
          requested: e.model,
          model: spawned.model,
          // events that outran the spawn keep their status, tokens, effort and start
          startedAt: Math.min(a.startedAt, startedAt),
        })),
      }))
    }
    return spawned
  })

  on('turn.complete', async ($, e, next) => {
    const agentId = e.agentId
    const usage = e.usage
    const now = await $.clock.now()
    if (agentId === undefined) {
      // The main loop's turn: how much of its input the prompt cache served. An empty turn leaves the last share.
      const total = usage ? usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens : 0
      if (usage && total > 0) {
        const cacheShare = Math.round((100 * usage.cache_read_input_tokens) / total)
        await patch($, s => ({ ...s, cacheShare }))
      }
    } else {
      await patch($, s => ({
        ...s,
        agents: upsertAgent(s.agents, agentId, now, a => ({
          ...a,
          status: 'done',
          endedAt: now,
          isFailed: e.reason !== 'answer',
          tokens: a.tokens + (usage ? sumUsage(usage) : 0),
        })),
      }))
    }
    await refreshGit($)
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    // A pane that waited undrawn is open from its first render; the write runs outside this drawing dispatch.
    if (!isOpen) $.clock.after(0, () => void setOpen($, true).catch(() => undefined))
    const ui = $.ui.resolve(e)
    const s = await read($, snapshot)
    return paneView(ui, s, e.props.bodyColumns, paneActions($))
  })
}
