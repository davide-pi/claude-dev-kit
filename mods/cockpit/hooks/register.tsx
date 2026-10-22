import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { CockpitAgent, CockpitSnapshot, CockpitTask } from '../types'
import { AGENT_KEEP_MS, parseGitStatus, parseWorktree, worklogDays } from './format'
import type { WorklogSnapshot } from './format'
import { INITIAL, PANE } from './state'
import { PANE_MAX_COLUMNS, agentCounts, paneView, taskCounts } from './view'

const TICK_MS = 15_000

// The scan that checks `$.state` references reads the atom from the file that uses it.
const snapshot = atom({ plugin: 'cockpit', key: 'snapshot' } as const, INITIAL)

/** Writes `next(current)`, unless it equals the current value: a no-op must not redraw the readers. */
async function patch($: EngineInterface, next: (s: CockpitSnapshot) => CockpitSnapshot): Promise<void> {
  const current = await read($, snapshot)
  if (JSON.stringify(next(current)) === JSON.stringify(current)) return
  await update($, snapshot, next)
  await writeState($)
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
    const { usd, startUsd } = s.cost
    const counts = taskCounts(s)
    const content = {
      open: isOpen,
      lastTurnUsd: usd !== undefined && startUsd !== undefined ? Math.round((usd - startUsd) * 100) / 100 : null,
      agents: agentCounts(s),
      effort: typeof s.effort === 'string' ? s.effort : null,
      tasks: counts ? { done: counts.done, total: counts.total } : null,
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

async function setOpen($: EngineInterface, value: boolean): Promise<void> {
  isOpen = value
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

async function refreshUsage($: EngineInterface): Promise<void> {
  try {
    const u = await $.session.usage()
    await patch($, s => ({
      ...s,
      ctx: { ...s.ctx, tokens: u.context.tokens, window: u.context.window, percent: u.context.percent },
      cost: { ...s.cost, usd: u.cost?.usd },
      rateLimits: u.rateLimits,
    }))
  } catch {
    // not measured yet
  }
}

/** Ticks: the clock the countdowns and durations count from, finished agents pruned, the rest re-read. */
async function tick($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  const listed = await $.agent.list().catch(() => undefined)
  await patch($, s => ({
    ...s,
    now,
    agents: s.agents
      .map((a): CockpitAgent => {
        // An agent the engine no longer lists as active has ended without a turn.complete we saw.
        const info = listed?.find(l => l.id === a.id)
        const isEnded = listed !== undefined && a.status === 'running' && (!info || ['completed', 'failed', 'killed'].includes(info.status))
        return isEnded ? { ...a, status: 'done', endedAt: now } : a
      })
      .filter(a => a.status === 'running' || (a.endedAt !== undefined && now - a.endedAt < AGENT_KEEP_MS)),
  }))
  await refreshGit($)
  await refreshWorklog($, now)
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
    await patch($, s => ({
      ...s,
      now,
      model,
      effort: s.effort ?? (typeof effort === 'string' ? effort : undefined),
      isSubagentModelForced: Boolean(forced),
      tasks: [],
    }))
    await refreshUsage($)
    await refreshGit($)
    await refreshWorklog($, now)
    // Every start, `/clear` included, has its own session id and so its own file.
    await writeState($, true)

    await $.command.register({ name: 'cockpit', description: 'Apre il pannello cockpit' })
    $.clock.every(TICK_MS, () => void tick($).catch(() => undefined))
    // The pane starts closed: `/cockpit` opens it.
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
    await patch($, s => ({
      ...s,
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
    if (agentId !== undefined) {
      await patch($, s => ({
        ...s,
        agents: upsertAgent(s.agents, agentId, now, a => ({
          ...a,
          status: 'done',
          endedAt: now,
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
    return paneView(ui, s, e.props.bodyColumns)
  })
}
