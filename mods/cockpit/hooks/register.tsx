import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { CockpitHistoryEntry, CockpitSnapshot } from '../types'
import { addHistory, toHistory, withAgentTokens } from './agents'
import { markClaudeState } from './events'
import { withContextReading } from './insights'
import { PACE_TICK_MS } from './pace'
import { paneActions } from './pane-actions'
import { fastTick, measuredCost, mediumTick, refreshAlm, refreshAutoCompact, refreshConfig, refreshDoneClaims, refreshLastRates, refreshOnOpen, refreshUsage, refreshWorklog, slowTick, withSettledRound } from './refresh'
import { refreshGit } from './refresh-git'
import { FAST_MS, MEDIUM_MS, SLOW_MS, open, pace } from './register-state'
import { registerTools } from './register-tools'
import { registerTurnEnd, registerTurnStart } from './register-turn'
import { markerRound } from './round-anchor'
import { SESSION_ID, adoptSession, isOpen, sessionData, setOpen, withoutSession, writeState } from './session-data'
import { INITIAL, PANE } from './state'
import { configDir, patch } from './store'
import { t } from './strings'
import { withLoggedSignals } from './signals'
import { paneView } from './view'
import { runIdOf } from './workflow'

// The scan that checks `$.state` references reads the atom from the file that uses it.
const snapshot = atom({ plugin: 'cockpit', key: 'snapshot' } as const, INITIAL)

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // First: the command registered below is described in the language read here.
    const { autoOpen, costTarget } = await refreshConfig($)
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
      costTarget,
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
    $.clock.every(PACE_TICK_MS, () => pace($, 'tick'))
    pace($, 'tick')
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
          .map(a => toHistory(a.status === 'running' ? { ...a, endedAt: at, isInterrupted: true } : a, runIdOf(own?.workflowRun, a.id)))
          .filter((h): h is CockpitHistoryEntry => h !== undefined)
          .sort((a, b) => b.endedAt - a.endedAt)
        const history = addHistory(own?.history, left)
        // The agents still listed leave with the session: a resume starts with none, so their tokens join the count.
        const agentTokens = own && withAgentTokens(own.agentTokens, own.agents)
        const content = { open: false, at, lastTurnUsd: null, agents: { running: 0, modelWarnings: 0 }, effort: null, tasks: null, mainTokens: own?.mainTokens, agentTokens }
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

  // Any close, whoever asked for it: the pane stays closed until `/cockpit` or the next session start (autoOpen).
  on('ui.close', { id: PANE }, async ($, e, next) => {
    const closed = await next(e)
    await setOpen($, false)
    return closed
  })

  on('session.measure', async ($, e, next) => {
    // another window (a /model) moves where the engine compacts
    let isNewWindow = false
    const at = await $.clock.now().catch(() => undefined)
    await patch($, s => {
      isNewWindow = s.ctx.window !== undefined && e.context.window !== undefined && s.ctx.window !== e.context.window
      return withLoggedSignals(withSettledRound(s.cost, {
        ...s,
        ctx: { ...s.ctx, tokens: e.context.tokens, window: e.context.window, percent: e.context.percent },
        // the resumed value stands in only until the first live reading: a later compaction reads empty, not old
        lastCtx: e.context.percent !== undefined ? undefined : s.lastCtx,
        ...withContextReading(s, e.context.tokens, at),
        cost: measuredCost(s.cost, e.cost?.usd, e.changed.includes('cost')),
        rateLimits: e.rateLimits,
        // the old threshold is the old window's: a failed read draws none rather than a wrong one
        ...(isNewWindow && { autoCompactAt: undefined }),
      }), at ?? s.now)
    })
    // the measure goes on before the read, and two window changes still read in order
    const out = await next(e)
    if (isNewWindow) await refreshAutoCompact($)
    return out
  })

  registerTurnStart(on)
  registerTools(on)
  registerTurnEnd(on)

  // The marker a round's first prompt placed in the chat: a dim rule with the round's label, which its link scrolls to.
  on('ui.render', { component: 'Placed' }, ($, e, next) => {
    const n = e.props.plugin === 'cockpit' ? markerRound(e.props.id) : undefined
    if (n === undefined) return next(e)
    const { Text } = $.ui.resolve(e)
    return <Text dimColor>{`── ${t().page.events.round(n)} ──`}</Text>
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
      const { costTarget } = await refreshConfig($)
      $.clock.after(0, () => void patch($, x => ({ ...x, isLangRead: true, costTarget })).catch(() => undefined))
    }
    return paneView(ui, s, e.props.bodyColumns, e.props.scroll.bodyRows, paneActions($))
  })

  // The compact button of a pane where a compaction is due is drawn by a surface module, which can only post: the press runs here.
  on('ui.message', ($, e, next) => {
    const { data } = e
    if (typeof data === 'object' && data !== null && 'action' in data && data.action === 'compact') {
      paneActions($).compact()
      return {}
    }
    return next(e)
  })
}
