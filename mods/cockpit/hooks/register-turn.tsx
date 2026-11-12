import { atom, read } from 'claude-code'
import type { Register } from 'claude-code'

import { agentLog, newTokens, settleUsage, usageOf } from './agents'
import { recordCtxSample, recordRound } from './context'
import { addStepUsage, markClaudeState, setClaudeState, upsertAgent } from './events'
import { recordCompaction, recordRoundEnd, roundCost, withContextReading } from './insights'
import { isResumePrompt } from './pace'
import { endTurnCost, refreshDoneClaims, refreshUsage, startedCost } from './refresh'
import { refreshGit } from './refresh-git'
import { asks, live, pace } from './register-state'
import { nextRoundNumber, promptTitle, roundFields, withRoundPrompt } from './round-capture'
import { placeMarker } from './round-anchor'
import { withLoggedSignals } from './signals'
import { INITIAL } from './state'
import { patch } from './store'
import { CENT } from './shared'
import { usdOf } from './pricing'
import { flowUsdIn, lastRoundFlowUsd, nextCompactKey, recordAgentEvent, recordLog, withRoundLastUsd } from './timeline'
import { addWorkflowAgent, agentRunId, endRun, finishWorkflowAgent, logRunChange, recordAgentLog, touchRun } from './workflow'

// The scan that checks `$.state` references reads the atom from the file that uses it.
const snapshot = atom({ plugin: 'cockpit', key: 'snapshot' } as const, INITIAL)

/** The turn's start and its streamed steps. */
export const registerTurnStart = (on: Parameters<Register>[0]): void => {
  on('turn.start', async ($, e, next) => {
    // The deltas count from where the main loop's turn began.
    if (e.agentId === undefined) {
      // A new turn has no tool in flight: one a crashed call left behind would hold the state on a tool for good.
      live.mainTools = []
      asks.clear()
      const now = await $.clock.now()
      await patch($, s => {
        const workflowRun = endRun(s.workflowRun, now)
        const cost = startedCost(s.cost, lastRoundFlowUsd(s.sessionLog))
        const log = logRunChange(s.sessionLog, s.workflowRun, workflowRun)
        return {
          ...s,
          cost,
          claudeState: { kind: 'working' },
          workflowRun,
          // the header's figure took the flow agents that ended after the round: the round entry takes it too
          sessionLog: cost.lastUsd !== undefined && cost.lastUsd !== s.cost.lastUsd ? withRoundLastUsd(log, cost.lastUsd) : log,
        }
      })
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
}

/** The round's end: a compaction, an agent's spawn, the prompt that titles the round, the turn's completion. */
export const registerTurnEnd = (on: Parameters<Register>[0]): void => {
  // A compaction that stood (not a skip, not the ahead-of-time `precompute`), the main conversation's: the engine event, since the classic PostCompact never reaches the mod.
  on('session.compact', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined && e.trigger !== 'precompute' && done.skip === undefined) {
      const at = await $.clock.now().catch(() => undefined)
      const after = done.tokensAfter
      await patch($, s => {
        const before = done.tokensBefore ?? s.ctx.tokens
        const insights = recordCompaction(s.insights, before)
        const logged = { ...s, insights, sessionLog: recordLog(s.sessionLog, { at: at ?? s.now, kind: 'compact', key: nextCompactKey(s.sessionLog), ...(before !== undefined && before > 0 && { tokens: before }) }) }
        if (after === undefined) return logged
        // the size the compaction reports is the context now: drawn at once, and the entry's `after`, not left until the next reading
        const { window } = s.ctx
        return { ...logged, ctx: { ...s.ctx, tokens: after, percent: window !== undefined && window > 0 ? (100 * after) / window : undefined }, ...withContextReading(logged, after, at) }
      }).catch(() => undefined)
      // no size reported: the engine's own reading, rather than the context before the compaction until the next turn
      if (after === undefined) await refreshUsage($)
    }
    return done
  })

  on('agent.spawn', async ($, e, next) => {
    const spawned = await next(e)
    if (spawned.agentId !== undefined) {
      const id = spawned.agentId
      const startedAt = await $.clock.now()
      await patch($, s => {
        const workflowRun = e.workflow ? addWorkflowAgent(s.workflowRun, e.workflow.runId, id, e.description, startedAt) : s.workflowRun
        return {
        ...s,
        // A workflow agent's spawn carries its run: the count of agents started and finished is the one progress the engine exposes.
        workflowRun,
        sessionLog: logRunChange(s.sessionLog, s.workflowRun, workflowRun),
        agents: upsertAgent(s.agents, id, startedAt, a => ({
          ...a,
          parentId: e.parentAgentId,
          type: e.subagentType,
          description: e.description,
          requested: e.model,
          model: spawned.model,
          ...(e.workflow && { runId: e.workflow.runId }),
          // events that outran the spawn keep their status, tokens, effort and start
          startedAt: Math.min(a.startedAt, startedAt),
        })),
        }
      })
    }
    return spawned
  })

  // The first prompt of a round titles it. A gating event: it passes through untouched, whatever the write does.
  on('prompt.submit', async ($, e, next) => {
    try {
      if (e.isMeta !== true && !isResumePrompt(e.text)) {
        const title = promptTitle(e)
        const before = await read($, snapshot)
        // the round's first prompt places its chat marker; a refused place leaves the round without a link
        const anchor = before.roundPrompt === undefined && title !== '' ? await placeMarker($, nextRoundNumber(before)).catch(() => undefined) : undefined
        await patch($, s => {
          const titled = withRoundPrompt(s, title)
          return anchor !== undefined && titled !== s && s.roundAnchor === undefined ? { ...titled, roundAnchor: anchor } : titled
        })
      }
    } catch {
      // observing must never break the submit
    }
    return next(e)
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
        const flowUsd = flowUsdIn(s.sessionLog, now - e.durationMs, now)
        const usd = roundCost(s.cost, flowUsd)
        const insights = recordRoundEnd(s.insights, { usd, ms: e.durationMs, cacheShare, endedAt: now })
        const round = nextRoundNumber(s)
        return withLoggedSignals({
          ...s,
          sessionLog: recordLog(s.sessionLog, { at: now, kind: 'round', n: round, ms: e.durationMs, ...(usd !== undefined && usd >= CENT && { usd }), ...(s.roundTools !== undefined && { tools: s.roundTools }), ...roundFields(s) }),
          roundTools: undefined,
          roundPrompt: undefined,
          roundAnchor: undefined,
          roundFiles: undefined,
          roundFails: undefined,
          roundWaits: undefined,
          roundSeq: round,
          mainTokens: usage ? Math.max(0, (s.mainTokens ?? 0) - (s.mainStepTokens ?? 0)) + newTokens(usageOf(usage)) : s.mainTokens,
          mainStepTokens: undefined,
          // Every main turn is a round of the compact hint: the context the engine last measured.
          ctxRounds: s.ctx.tokens ? recordRound(s.ctxRounds, s.ctx.tokens) : s.ctxRounds,
          insights,
          cost: endTurnCost(s.cost, flowUsd),
        }, now)
      })
      await setClaudeState($, { kind: 'idle' })
      // The branch and the done-claim log move with the main loop's work: one read per round, none per subagent turn.
      await refreshGit($)
      await refreshDoneClaims($)
      // a compaction rejects while the turn runs: it is tried once this hook has let the turn end
      $.clock.after(0, () => pace($, 'turn'))
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
        const entry = ended && agentLog(ended, agentRunId(s.workflowRun, ended))
        const spent = ended ? usdOf(ended.model, ended.usage) : 0
        // A turn that ended twice replaces the agent's event: only the change is added to its type.
        const delta = ended ? spent - (s.events?.find(ev => ev.kind === 'agent' && ev.id === agentId)?.usd ?? 0) : 0
        return {
          ...s,
          ...(ended && delta !== 0 && { agentSpend: { ...s.agentSpend, [ended.type]: (s.agentSpend?.[ended.type] ?? 0) + delta } }),
          workflowRun: finishWorkflowAgent(s.workflowRun, agentId, now),
          agents,
          // the agent is logged as it ends; a turn that ended twice is one entry
          sessionLog: entry ? recordAgentLog(s.sessionLog, entry) : s.sessionLog,
          events: ended
            ? recordAgentEvent(s.events, { at: now, kind: 'agent', id: ended.id, text: ended.type, desc: ended.description, effort: ended.effort, ms: now - ended.startedAt, isFailed: ended.isFailed, model: ended.model, tokens: ended.tokens, usd: usdOf(ended.model, ended.usage) })
            : s.events,
        }
      })
    }
    return next(e)
  })
}
