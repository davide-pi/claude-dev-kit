import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { CockpitAgent, CockpitClaudeState, CockpitHistoryEntry, CockpitSnapshot, CockpitTask } from '../types'
import { addHistory, newTokens, settleUsage, stateAfterWait, toHistory, usageOf, withAgentTokens } from './agents'
import { recordCtxSample, recordRound } from './context'
import {
  addStepUsage,
  applyTodos,
  bashOutput,
  createdTask,
  isOk,
  isRefused,
  markClaudeState,
  noteEdit,
  readClaudeState,
  removeOne,
  setClaudeState,
  upsertAgent,
} from './events'
import {
  readPathOf,
  recordCompaction,
  withContextReading,
  recordRoundEnd,
  recordToolCall,
  recordWait,
  resultTokens,
  roundCost,
  toolArg,
  toolArgFull,
} from './insights'
import {
  endTurnCost,
  fastTick,
  measuredCost,
  mediumTick,
  refreshAlm,
  refreshAutoCompact,
  refreshConfig,
  refreshDoneClaims,
  refreshLastRates,
  refreshOnOpen,
  refreshUsage,
  refreshWorklog,
  slowTick,
} from './refresh'
import { diffActions, paneActions } from './pane-actions'
import { usdOf } from './pricing'
import { scheduleContextRead } from './refresh-context'
import { refreshGit } from './refresh-git'
import { SESSION_ID, adoptSession, isOpen, sessionData, setOpen, withoutSession, writeState } from './session-data'
import { DIFF_PANE, INITIAL, PANE } from './state'
import { configDir, patch } from './store'
import { t } from './strings'
import { recordAgentEvent } from './timeline'
import { PANE_MAX_COLUMNS, paneView } from './view'
import { diffView } from './view-work'
import { addWorkflowAgent, endRun, finishWorkflowAgent, launchedRun, nameRun, touchRun } from './workflow'
import { parseCreatedPr, upsertPr } from './work'

// The clock tiers: fast for elapsed times, medium for git, slow for what moves rarely (and the state file's heartbeat).
const FAST_MS = 2000
const MEDIUM_MS = 10_000
const SLOW_MS = 30_000

// The scan that checks `$.state` references reads the atom from the file that uses it.
const snapshot = atom({ plugin: 'cockpit', key: 'snapshot' } as const, INITIAL)

// The main loop's tools in flight (a `tool.call` seen before its `next` answered), in start order: the header's tool state lasts while any is left.
let mainTools: string[] = []
// The last permission waits that ended, as [from, to]: a tool call takes off its running time only the part of them inside its own span (the wait is counted on its own).
let waits: { from: number; to: number }[] = []
const WAITS_KEPT = 50
/** The error text a Cronologia row keeps. */
// The asks a person has to answer, by the id of the tool call that raised them: from the `tool.check` verdict to the end of that call.
const asks = new Map<string, { from: number; held: CockpitClaudeState | undefined }>()

const waitOverlap = (list: readonly { from: number; to: number }[], from: number, to: number): number =>
  list.reduce((sum, w) => sum + Math.max(0, Math.min(to, w.to) - Math.max(from, w.from)), 0)

/** Ends the wait the call `id` raised, if it raised one: the state goes back to what the wait interrupted, and the wait is counted. */
async function endAsk($: EngineInterface, id: string): Promise<void> {
  const ask = asks.get(id)
  if (!ask) return
  asks.delete(id)
  await setClaudeState($, stateAfterWait(ask.held, mainTools), now => now?.kind === 'waiting')
  const waitTo = await $.clock.now().catch(() => undefined)
  if (waitTo !== undefined) {
    waits = [...waits, { from: ask.from, to: waitTo }].slice(-WAITS_KEPT)
    await patch($, s => ({ ...s, insights: recordWait(s.insights, waitTo - ask.from) })).catch(() => undefined)
  }
}

const openPane = ($: EngineInterface) => $.ui.open({ id: PANE, title: 'cockpit', columns: PANE_MAX_COLUMNS })

/** Opens the pane; one that waits undrawn is not open yet: its first render says so. */
async function open($: EngineInterface) {
  const opened = await openPane($)
  await setOpen($, opened.isPlaced)
  if (opened.isPlaced) void refreshOnOpen($).catch(() => undefined)
  return opened
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // First: the command registered below is described in the language read here.
    const autoOpen = await refreshConfig($)
    const now = await $.clock.now()
    const forced = await $.env.get('CLAUDE_CODE_SUBAGENT_MODEL')
    const model = await $.session.model().catch(() => undefined)
    const effort = await $.settings.read({ key: 'effortLevel' }).catch(() => undefined)
    // The same session id (an enable, a respawn, a reload) keeps what the snapshot holds; another one starts its own.
    await adoptSession($, true)
    markClaudeState(undefined)
    await patch($, s => ({
      ...s,
      now,
      model,
      effort: s.effort ?? (typeof effort === 'string' ? effort : undefined),
      isSubagentModelForced: Boolean(forced),
      isLangRead: true,
      startedAt: s.startedAt ?? now,
    }))
    await refreshLastRates($)
    await refreshUsage($)
    await refreshAutoCompact($)
    await refreshAlm($)
    await refreshGit($)
    await refreshWorklog($, now)
    await refreshDoneClaims($)
    await writeState($, true)

    await $.command.register({ name: 'cockpit', description: t().commandDescription })
    $.clock.every(FAST_MS, () => void fastTick($).catch(() => undefined))
    $.clock.every(MEDIUM_MS, () => void mediumTick($).catch(() => undefined))
    $.clock.every(SLOW_MS, () => void slowTick($).catch(() => undefined))
    // The pane opens with the session unless cockpit.json says `"autoOpen": false`; `/cockpit` opens it any time.
    if (autoOpen) await open($).catch(() => undefined)
    return next(e)
  })

  // The ending session's file is left closed and empty, so the statusline drops its segments at once, with every
  // finished agent in its history; the statusline's hourly prune removes the file itself after 3 days (`$.fs` cannot
  // delete). Best-effort: the write is skipped when the exit's short budget is nearly spent, and any failure is swallowed.
  // The snapshot lets go of the session first (any reason), from the reading taken here, so a write cut short cannot
  // leave it in the atom: its agents go to its own history (the ones still running as `interrupted`), and the ended id
  // is remembered, since the engine answers it until it switches to the next one. The next change adopts that one.
  on('session.end', async ($, e, next) => {
    markClaudeState(undefined)
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
        // The agents still listed leave with the session: a resume starts with none, so their tokens join the count.
        const agentTokens = own && withAgentTokens(own.agentTokens, own.agents)
        const content = { open: false, at, lastTurnUsd: null, agents: { running: 0, modelWarnings: 0 }, effort: null, tasks: null, tab: own?.tab ?? 'agents', mainTokens: own?.mainTokens, agentTokens }
        await $.fs.write(`${dir}/.cache/cockpit-${e.sessionId}.json`, JSON.stringify(content))
        // The history takes the running agents as interrupted; a snapshot that is not this session's has nothing of it to write.
        if (own) await $.fs.write(`${dir}/.cache/cockpit-data-${e.sessionId}.json`, JSON.stringify(sessionData(own, history)))
      }
    } catch {
      // the files age out on their own (the data file goes with the transcript)
    }
    return next(e)
  })

  // `/cockpit` opens the pane; a command-initiated open is placed at any width.
  on('command.run', { command: 'cockpit' }, async $ => {
    const opened = await open($)
    return { text: opened.isPlaced ? t().commandOpen : t().commandWaiting(opened.reason) }
  })

  // The diff pane: drawn from the snapshot's diff, forgotten when it closes, whoever closed it.
  on('ui.render', { component: 'Pane', requestId: DIFF_PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const s = await read($, snapshot)
    return diffView(ui, s.diff, e.props.bodyColumns, diffActions($))
  })

  on('ui.close', { id: DIFF_PANE }, async ($, e, next) => {
    const closed = await next(e)
    await patch($, s => ({ ...s, diff: undefined })).catch(() => undefined)
    return closed
  })

  // Any close, whoever asked for it: the pane stays closed until `/cockpit` or the next session start (autoOpen).
  on('ui.close', { id: PANE }, async ($, e, next) => {
    const closed = await next(e)
    await setOpen($, false)
    return closed
  })

  on('session.measure', async ($, e, next) => {
    await patch($, s => ({
      ...s,
      ctx: { ...s.ctx, tokens: e.context.tokens, window: e.context.window, percent: e.context.percent },
      // the resumed value stands in only until the first live reading: a later compaction reads empty, not old
      lastCtx: e.context.percent !== undefined ? undefined : s.lastCtx,
      ...withContextReading(s, e.context.tokens),
      cost: measuredCost(s.cost, e.cost?.usd),
      rateLimits: e.rateLimits,
    }))
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    // The deltas count from where the main loop's turn began.
    if (e.agentId === undefined) {
      // A new turn has no tool in flight: one a crashed call left behind would hold the state on a tool for good.
      mainTools = []
      asks.clear()
      const now = await $.clock.now()
      await patch($, s => ({
        ...s,
        cost: { ...s.cost, startUsd: s.cost.usd ?? 0 },
        claudeState: { kind: 'working' },
        workflowRun: endRun(s.workflowRun, now),
      }))
      markClaudeState({ kind: 'working' })
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
          : { ...s, workflowRun: touchRun(s.workflowRun, agentId, now), agents: upsertAgent(s.agents, agentId, now, a => ({ ...a, model, effort })) },
      )
    } catch {
      // observing must never break the step
    }
    // The main loop's chunks tell what Claude is doing: a thinking chunk is thinking, text or a tool's start is working. A chunk
    // repeats many times a second: the state is written when the kind it derives changes, with no snapshot read in between.
    const stream = next(e)
    let lastKind: 'thinking' | 'working' | undefined
    for await (const chunk of stream) {
      if (e.agentId === undefined) {
        const kind = chunk.kind === 'thinking' ? 'thinking' : chunk.kind === 'text' || chunk.kind === 'tool' ? 'working' : undefined
        if (kind !== undefined && kind !== lastKind) {
          lastKind = kind
          await setClaudeState($, { kind })
        }
      }
      yield chunk
    }
    // The response's own usage: the four counters of an agent, live per step, and the session's share.
    try {
      const { usage } = await stream.result
      if (usage) await addStepUsage($, e.agentId, usageOf(usage))
    } catch {
      // observing must never break the step
    }
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

  // The skills the session loaded through the Skill tool (a typed `/skill` never reaches the mod), once each in the order they first ran.
  on('tool.call', { tool: 'Skill' }, async ($, e, next) => {
    const ran = await next(e)
    if (isOk(ran)) {
      try {
        await patch($, s => ({
          ...s,
          skillsUsed: s.skillsUsed?.includes(e.skill) ? s.skillsUsed : [...(s.skillsUsed ?? []), e.skill],
        }))
      } catch {
        // observing must never break the call
      }
    }
    return ran
  })

  // A workflow the session launched: its result names the script and the run the agents' spawns carry.
  on('tool.call', { tool: 'Workflow' }, async ($, e, next) => {
    const ran = await next(e)
    const launched = isOk(ran) ? launchedRun(ran.result) : undefined
    if (launched) await patch($, s => ({ ...s, workflowRun: nameRun(s.workflowRun, launched) })).catch(() => undefined)
    return ran
  })

  // The tools of each subagent, from the tool events carrying its id: the one running now (from the call to its end) and the last
  // one. The main loop's calls are no agent's: while any runs the header shows a tool by name, and the end of the last one puts
  // the state back to working.
  on('tool.call', async ($, e, next) => {
    const { agentId, tool } = e
    if (agentId !== undefined) {
      const forAgent = (change: (a: CockpitAgent) => CockpitAgent) => patch($, s => ({ ...s, agents: s.agents.map(a => (a.id === agentId ? change(a) : a)) }))
      try {
        // Only an agent the mod already knows: a call that outran the spawn makes no stub the spawn would later fill.
        const at = await $.clock.now()
        await patch($, s => ({
          ...s,
          workflowRun: touchRun(s.workflowRun, agentId, at),
          agents: s.agents.map(a => (a.id === agentId ? { ...a, lastTool: tool, activeTools: [...(a.activeTools ?? []), tool] } : a)),
        }))
      } catch {
        // observing must never break the call
      }
      try {
        const ran = await next(e)
        await noteEdit($, e, ran)
        return ran
      } finally {
        await forAgent(a => ({ ...a, activeTools: removeOne(a.activeTools, tool) })).catch(() => undefined)
      }
    }
    mainTools = [...mainTools, tool]
    await setClaudeState($, { kind: 'tool', tool })
    // A clock that fails leaves the call without a time: the row draws none, and the call adds no running time.
    const at = await $.clock.now().catch(() => undefined)
    let isSuccess = false
    let outcome: { tokens: number; error?: string } | undefined
    try {
      const ran = await next(e)
      isSuccess = isOk(ran)
      await noteEdit($, e, ran)
      outcome = { tokens: resultTokens(ran), error: ran.deny ?? ran.text }
      return ran
    } finally {
      // An ask this call raised ends with it, whether the person approved (the tool ran) or refused.
      await endAsk($, e.tool_use_id)
      mainTools = removeOne(mainTools, tool) ?? []
      // The call is listed once it ended, with how it ended (an error, a refusal or a throw is a failure).
      const ended = await $.clock.now().catch(() => undefined)
      const ms = at !== undefined && ended !== undefined ? ended - at - waitOverlap(waits, at, ended) : 0
      await patch($, s => ({
        ...s,
        insights: recordToolCall(s.insights, { tool, isOk: isSuccess, ms, readPath: readPathOf(e), arg: toolArg(e), fullArg: toolArgFull(e), tokens: outcome?.tokens, error: outcome?.error }),
      })).catch(() => undefined)
      const last = mainTools.at(-1)
      await setClaudeState($, last === undefined ? { kind: 'working' } : { kind: 'tool', tool: last }, held => held?.kind === 'tool')
    }
  })

  // A pull request this chat created (`gh pr create`, `az repos pr create`; a subagent's call too: the PR is the chat's) is
  // told by what the command printed.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (isOk(ran) && /\bpr\s+create\b/.test(e.command)) {
      const pr = parseCreatedPr(e.command, bashOutput(ran))
      if (pr) await patch($, s => ({ ...s, prs: upsertPr(s.prs, pr) })).catch(() => undefined)
    }
    return ran
  })

  // A call the person has to approve: `tool.check` settles on `ask` with a person to answer it, and the state is waiting from there.
  // The engine raises no event when the answer comes: the permission dialog or classifier runs inside the `tool.call` chain, after
  // `tool.check`, and the next thing the mod hears is the call's end. The earliest sign that the tool runs is the terminal's
  // `ToolProgress` row under it (below); a tool that draws none (a quick one, any outside the terminal) keeps the wait to its end, and an
  // ask the mode's classifier resolves cannot be told from a person's, so it counts as a wait for as long as its tool runs: known limits.
  // A gating event: whatever fails here leaves the verdict as it was.
  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)
    try {
      if (verdict.decision === 'ask' && e.approver === 'person' && e.agentId === undefined && e.tool_use_id !== undefined) {
        const held = readClaudeState()
        const from = await $.clock.now()
        asks.set(e.tool_use_id, { from, held })
        await setClaudeState($, { kind: 'waiting', since: from })
      }
    } catch {
      // observing must never break the verdict
    }
    return verdict
  })

  // The call's row shows a progress line once the tool runs, so the approval is over: the wait ends there and the tool's own time starts.
  on('ui.render', { component: 'ToolProgress' }, ($, e, next) => {
    const id = e.props.tool_use_id
    // Outside this drawing's dispatch, as the pane's own first write is.
    if (asks.has(id)) $.clock.after(0, () => void endAsk($, id).catch(() => undefined))
    return next(e)
  })

  // A compaction that stood (not a skip, not the ahead-of-time `precompute`), the main conversation's: the engine event, since the classic PostCompact never reaches the mod.
  on('session.compact', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined && e.trigger !== 'precompute' && done.skip === undefined) {
      await patch($, s => ({ ...s, insights: recordCompaction(s.insights, done.tokensBefore ?? s.ctx.tokens) })).catch(() => undefined)
    }
    return done
  })

  on('agent.spawn', async ($, e, next) => {
    const spawned = await next(e)
    if (spawned.agentId !== undefined) {
      const id = spawned.agentId
      const startedAt = await $.clock.now()
      await patch($, s => ({
        ...s,
        // A workflow agent's spawn carries its run: the count of agents started and finished is the one progress the engine exposes.
        workflowRun: e.workflow ? addWorkflowAgent(s.workflowRun, e.workflow.runId, id, e.description, startedAt) : s.workflowRun,
        agents: upsertAgent(s.agents, id, startedAt, a => ({
          ...a,
          parentId: e.parentAgentId,
          type: e.subagentType,
          description: e.description,
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
      let cacheShare: number | undefined
      if (usage && total > 0) {
        cacheShare = Math.round((100 * usage.cache_read_input_tokens) / total)
        const share = cacheShare
        // The turn's usage sums every request of the turn: the context size is the engine's last reading, whose growth the autocompact forecast averages.
        await patch($, s => ({
          ...s,
          cacheShare: share,
          ctxSamples: s.ctx.tokens ? recordCtxSample(s.ctxSamples, s.ctx.tokens) : s.ctxSamples,
        }))
      }
      // The steps already counted their part of the session's tokens: the turn's own total replaces it.
      await patch($, s => {
        const insights = recordRoundEnd(s.insights, { usd: roundCost(s.cost), ms: e.durationMs, cacheShare, endedAt: now })
        return {
          ...s,
          mainTokens: usage ? Math.max(0, (s.mainTokens ?? 0) - (s.mainStepTokens ?? 0)) + newTokens(usageOf(usage)) : s.mainTokens,
          mainStepTokens: undefined,
          // Every main turn is a round of the compact hint: the context the engine last measured.
          ctxRounds: s.ctx.tokens ? recordRound(s.ctxRounds, s.ctx.tokens) : s.ctxRounds,
          insights,
          cost: endTurnCost(s.cost),
        }
      })
      await setClaudeState($, { kind: 'idle' })
      await scheduleContextRead($).catch(() => undefined)
      // The branch and the done-claim log move with the main loop's work: one read per round, none per subagent turn.
      await refreshGit($)
      await refreshDoneClaims($)
    } else {
      await patch($, s => {
        const agents = upsertAgent(s.agents, agentId, now, a => {
          // The steps already counted their part: the turn's own total replaces it.
          const settled = settleUsage(a.usage, a.stepUsage, usage ? usageOf(usage) : undefined)
          return {
            ...a,
            status: 'done',
            endedAt: now,
            isFailed: e.reason !== 'answer',
            usage: settled,
            stepUsage: undefined,
            tokens: usage ? a.tokens - newTokens(a.stepUsage) + newTokens(usageOf(usage)) : a.tokens,
          }
        })
        const ended = agents.find(a => a.id === agentId)
        return {
          ...s,
          workflowRun: finishWorkflowAgent(s.workflowRun, agentId, now),
          agents,
          events: ended
            ? recordAgentEvent(s.events, { at: now, kind: 'agent', id: ended.id, text: ended.type, desc: ended.description, effort: ended.effort, ms: now - ended.startedAt, isFailed: ended.isFailed, model: ended.model, tokens: ended.tokens, usd: usdOf(ended.model, ended.usage) })
            : s.events,
        }
      })
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    // A pane that waited undrawn is open from its first render; the write runs outside this drawing dispatch.
    if (!isOpen) {
      $.clock.after(0, () => {
        void setOpen($, true).then(() => refreshOnOpen($)).catch(() => undefined)
      })
    }
    // Only the terminal and the desktop run a surface module: any other surface (mobile, vscode, one to come) draws its bars static, whatever the table resolved
    const table = $.ui.resolve(e)
    const ui = e.surface === 'terminal' || e.surface === 'desktop' ? table : { ...table, Client: undefined }
    const s = await read($, snapshot)
    // A pane that draws before any session start (a mod enabled mid-session) reads the language once; the mark is written outside this drawing.
    if (!s.isLangRead) {
      await refreshConfig($)
      $.clock.after(0, () => void patch($, x => ({ ...x, isLangRead: true })).catch(() => undefined))
    }
    return paneView(ui, s, e.props.bodyColumns, e.props.scroll.bodyRows, paneActions($))
  })
}
