import type { Register } from 'claude-code'

import type { CockpitAgent, CockpitLogEntry, CockpitTask } from '../types'
import { applyTodos, bashOutput, createdTask, isOk, isRefused, noteEdit, readClaudeState, removeOne, setClaudeState } from './events'
import { readPathOf, recordToolCall, resultTokens, toolArg, toolArgFull } from './insights'
import { withRoundFail, withRoundFile } from './round-capture'
import { withLoggedSignals } from './signals'
import { asks, endAsk, live, waitOverlap } from './register-state'
import { patch } from './store'
import { bashLog, recordLog } from './timeline'
import { agentRunId, launchedRun, logRunChange, nameRun, runIdOf, touchRun } from './workflow'
import { editedPathOf, parseCreatedPr, upsertPr } from './work'

/** The tool handlers: the tasks, skills and workflows a call feeds, the tools in flight, a created PR, the asks a person answers. */
export const registerTools = (on: Parameters<Register>[0]): void => {
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
    if (launched) {
      await patch($, s => {
        const workflowRun = nameRun(s.workflowRun, launched)
        return { ...s, workflowRun, sessionLog: logRunChange(s.sessionLog, s.workflowRun, workflowRun) }
      }).catch(() => undefined)
    }
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
    live.mainTools = [...live.mainTools, tool]
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
      live.mainTools = removeOne(live.mainTools, tool) ?? []
      // The call is listed once it ended, with how it ended (an error, a refusal or a throw is a failure).
      const ended = await $.clock.now().catch(() => undefined)
      const ms = at !== undefined && ended !== undefined ? ended - at - waitOverlap(live.waits, at, ended) : 0
      const edited = isSuccess ? editedPathOf(e) : undefined
      await patch($, s => {
        // the round's tool counts, files and failures, which its log entry takes when it ends
        const counted = {
          ...s,
          roundTools: { ...s.roundTools, [tool]: (s.roundTools?.[tool] ?? 0) + 1 },
          insights: recordToolCall(s.insights, { tool, isOk: isSuccess, ms, readPath: readPathOf(e), arg: toolArg(e), fullArg: toolArgFull(e), tokens: outcome?.tokens, error: outcome?.error }),
        }
        const noted = edited === undefined ? counted : withRoundFile(counted, edited)
        return withLoggedSignals(isSuccess ? noted : withRoundFail(noted, tool, outcome?.error ?? ''), ended ?? s.now)
      }).catch(() => undefined)
      const last = live.mainTools.at(-1)
      await setClaudeState($, last === undefined ? { kind: 'working' } : { kind: 'tool', tool: last }, held => held?.kind === 'tool')
    }
  })

  // A pull request this chat created (`gh pr create`, `az repos pr create`; a subagent's call too: the PR is the chat's) is
  // told by what the command printed.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    const isRan = isOk(ran)
    const out = bashOutput(ran)
    const pr = isRan && /\bpr\s+create\b/.test(e.command) ? parseCreatedPr(e.command, out) : undefined
    const at = await $.clock.now().catch(() => undefined)
    // The same call feeds the session log: a test run, a commit that exited 0, the PR above.
    await patch($, s => {
      // a flow agent's call belongs to its flow, only when the run it works in is known
      const agent = e.agentId === undefined ? undefined : s.agents.find(a => a.id === e.agentId)
      const runId = e.agentId === undefined ? undefined : agent ? agentRunId(s.workflowRun, agent) : runIdOf(s.workflowRun, e.agentId)
      const flow = e.agentId !== undefined && runId !== undefined ? { agent: e.agentId, runId } : undefined
      // a call the person or a rule refused never ran: it makes no entry
      const entries = ran.deny !== undefined ? [] : bashLog({ command: e.command, arg: toolArg(e), out, isOk: isRan, at: at ?? s.now, pr, ...(flow && { flow }) })
      return entries.length === 0 && !pr ? s : { ...s, ...(pr && { prs: upsertPr(s.prs, pr) }), sessionLog: entries.reduce<CockpitLogEntry[] | undefined>(recordLog, s.sessionLog) }
    }).catch(() => undefined)
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
        asks.set(e.tool_use_id, { from, held, tool: e.tool })
        await setClaudeState($, { kind: 'waiting', since: from })
        await patch($, s => withLoggedSignals(s, from))
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
}
