import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { CockpitHistoryEntry, CockpitNote, CockpitPr, CockpitSnapshot, CockpitTab } from '../types'
import { historyTokens, parseHistory } from './agents'
import { CTX_SAMPLES_KEEP, ROUNDS_KEEP, parseCounts, parseCtx } from './context'
import { stopMonitor, syncMonitor } from './monitor'
import { openContext } from './refresh-context'
import { parseNotes, savedTab } from './session'
import { INITIAL } from './state'
import { configDir } from './store'
import { agentCounts, taskCounts } from './view-agents'
import { parseEdited, parseSavedPrs } from './work'

// The scan that checks `$.state` references reads the atom from the file that uses it.
const snapshot = atom({ plugin: 'cockpit', key: 'snapshot' } as const, INITIAL)

// ── The statusline's state file ──
// `<configDir>/.cache/cockpit-<sessionId>.json`: what the user's statusline reads to hide itself while the pane is open
// and to show the last turn's cost and the agent counts. Same id rule as the statusline's context snapshot.

const STATE_MIN_MS = 3000
export const SESSION_ID = /^[\w-]{1,128}$/

// Not an atom: the first render of a pane that waited undrawn must set it, and a render cannot write state.
// The pane starts closed, `/cockpit` opens it, the person's close shuts it. A reload starts these over.
export let isOpen = false
let lastWritten = ''
let lastDataWritten = ''
let lastWriteAt = 0
// When the write timer was scheduled: a timer the engine refuses never runs its callback, so the mark lapses by itself after twice the throttle.
let writeScheduledAt: number | undefined

/**
 * What survives a resume: the session data file `<configDir>/.cache/cockpit-data-<sessionId>.json` holds the agent history, the
 * chat's pull requests, the saved notes, the context samples, the files the chat edited and the last measured context; the statusline's pruning keeps it while the session's transcript
 * exists. `history` is the one the file is written with (the session's end adds its running agents).
 */
export const sessionData = (s: CockpitSnapshot, history: readonly CockpitHistoryEntry[] = s.history ?? []) => {
  const { tokens, window, percent } = s.ctx
  // the live window when the engine measured it, else the one the session was resumed with
  const ctx = tokens !== undefined && window !== undefined && percent !== undefined ? { tokens, window, percent } : s.lastCtx
  return {
    history,
    prs: s.prs ?? [],
    ...(s.notes !== undefined && { notes: s.notes }),
    ...(s.ctxSamples !== undefined && { ctxSamples: s.ctxSamples }),
    ...(s.ctxRounds !== undefined && { ctxRounds: s.ctxRounds }),
    ...(s.edited !== undefined && { edited: s.edited }),
    ...(ctx && { ctx }),
  }
}

/**
 * Writes the state file (and the session data file) when its content changed, at most once per `STATE_MIN_MS`: a change inside the window is
 * written when it ends. `isForced` skips the window (open, close, session start). `isHeartbeat` rewrites unchanged
 * content with a fresh `at`: the statusline trusts `open:true` only while `at` is recent. A failure leaves the file as it was.
 */
export async function writeState($: EngineInterface, isForced = false, isHeartbeat = false): Promise<void> {
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
      tab: s.tab ?? 'agents',
      // the share is a part of the session's tokens: the main loop's and the agents' count survive a reload (the history is cut at 50)
      mainTokens: s.mainTokens,
      agentTokens: s.agentTokens,
    }
    const file = `${dir}/.cache/cockpit-${id}.json`
    const key = `${file} ${JSON.stringify(content)}`
    const dataFile = `${dir}/.cache/cockpit-data-${id}.json`
    const data = JSON.stringify(sessionData(s))
    const dataKey = `${dataFile} ${data}`
    const isStateStale = key !== lastWritten || isHeartbeat
    const isDataStale = dataKey !== lastDataWritten
    if (!isStateStale && !isDataStale) return
    const now = await $.clock.now()
    const wait = STATE_MIN_MS - (now - lastWriteAt)
    if (!isForced && wait > 0) {
      if (writeScheduledAt === undefined || now - writeScheduledAt >= 2 * STATE_MIN_MS) {
        writeScheduledAt = now
        $.clock.after(wait, () => {
          writeScheduledAt = undefined
          void writeState($).catch(() => undefined)
        })
      }
      return
    }
    if (isStateStale) {
      const { open, ...rest } = content
      await $.fs.write(file, JSON.stringify({ open, at: now, ...rest }))
      lastWritten = key
    }
    if (isDataStale) {
      await $.fs.write(dataFile, data)
      lastDataWritten = dataKey
    }
    lastWriteAt = now
  } catch {
    // best-effort: the statusline simply shows what it showed
  }
}

/** What a saved file holds, as an object; undefined for a missing or unreadable file, or any other JSON. */
async function readSaved($: EngineInterface, path: string): Promise<Record<string, unknown> | undefined> {
  try {
    const text = await $.fs.read(path)
    const parsed: unknown = JSON.parse(typeof text === 'string' ? text : '')
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? Object.fromEntries(Object.entries(parsed)) : undefined
  } catch {
    return undefined
  }
}

type Saved = {
  tab?: CockpitTab
  history: CockpitHistoryEntry[]
  prs?: CockpitPr[]
  mainTokens?: number
  agentTokens?: number
  notes?: CockpitNote[]
  ctxSamples?: number[]
  ctxRounds?: number[]
  edited?: string[]
  ctx?: { tokens: number; window: number; percent: number }
}

/**
 * What an earlier run of session `id` left: in its state file the tab (none for a missing file or an unknown one; the v2 Sessione
 * and Repo tabs map to Subagents and Work) and the tokens of the main loop and of the agents that left the list (a file from before
 * that count: the history's sum); in its session data file the agent history, the chat's pull requests, the notes and the context
 * samples. A state file from before the data file still holds the history and the pull requests: a field the data file does not
 * have is read from there, once (the next write moves it).
 */
async function savedState($: EngineInterface, id: string): Promise<Saved> {
  try {
    const dir = await configDir($)
    if (!dir || !SESSION_ID.test(id)) return { history: [] }
    const state = await readSaved($, `${dir}/.cache/cockpit-${id}.json`)
    const data = await readSaved($, `${dir}/.cache/cockpit-data-${id}.json`)
    const count = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined)
    const field = (key: 'history' | 'prs') => (data && key in data ? data[key] : state?.[key])
    const history = parseHistory(field('history'))
    const prs = parseSavedPrs(field('prs'))
    return {
      tab: savedTab(state?.tab),
      history,
      prs: prs.length > 0 ? prs : undefined,
      mainTokens: count(state?.mainTokens),
      agentTokens: count(state?.agentTokens) ?? historyTokens(history),
      notes: parseNotes(data?.notes, data?.note),
      ctxSamples: parseCounts(data?.ctxSamples, CTX_SAMPLES_KEEP),
      ctxRounds: parseCounts(data?.ctxRounds, ROUNDS_KEEP),
      edited: parseEdited(data?.edited),
      ctx: parseCtx(data?.ctx),
    }
  } catch {
    return { history: [] }
  }
}

/** The snapshot between two sessions: its agents went to the ending session's history, the per-session readings start over, no session owns it. */
export const withoutSession = (s: CockpitSnapshot): CockpitSnapshot => ({
  ...s,
  sessionId: undefined,
  agents: [],
  history: [],
  prs: undefined,
  notes: undefined,
  noteDraft: undefined,
  noteEditing: undefined,
  calls: undefined,
  insights: undefined,
  usageOpen: undefined,
  notesOpen: undefined,
  refreshedAt: undefined,
  tasks: [],
  cacheShare: undefined,
  mainTokens: undefined,
  mainStepTokens: undefined,
  agentTokens: undefined,
  claudeState: undefined,
  ctxSamples: undefined,
  ctxRounds: undefined,
  edited: undefined,
  // the window is the next session's own: nothing of this one's reading is left to pass for it
  ctx: {},
  lastCtx: undefined,
  lastRoundMs: undefined,
  context: undefined,
  contextSeq: undefined,
  contextStatic: undefined,
  skillsUsed: undefined,
  workflowRun: undefined,
  system: undefined,
})

/**
 * Makes the snapshot the session the engine answers now: the same id (a reload, an enable, a respawn) changes nothing;
 * another loads that session's saved tab and history. The id of the session that just ended is skipped (the engine
 * answers it until it switches), unless `isStart`: a session start of that same id is a resume.
 */
export async function adoptSession($: EngineInterface, isStart = false): Promise<void> {
  const id = await $.session.id()
  const current = await read($, snapshot)
  if (current.sessionId === id || (!isStart && current.endedSessionId === id)) return
  const saved = await savedState($, id)
  await update($, snapshot, s =>
    s.sessionId === id
      ? s
      : { ...withoutSession(s), sessionId: id, endedSessionId: undefined, tab: saved.tab ?? s.tab, history: saved.history, prs: saved.prs, notes: saved.notes, ctxSamples: saved.ctxSamples, ctxRounds: saved.ctxRounds, edited: saved.edited, lastCtx: saved.ctx, mainTokens: saved.mainTokens, agentTokens: saved.agentTokens },
  )
  // The monitor looked for the pid of the session it was started for: another one's gets its own, if the tab is still wanted.
  stopMonitor()
  await syncMonitor($)
}

export async function setOpen($: EngineInterface, value: boolean): Promise<void> {
  isOpen = value
  await adoptSession($).catch(() => undefined)
  await writeState($, true)
  await syncMonitor($)
  // The Context tab is read when it opens: a pane that opens on it (the tab is kept with the session) is the same moment. The
  // read is not waited for: a slow one must not hold the open (or the close) back.
  if (value && (await read($, snapshot)).tab === 'context') void openContext($).catch(() => undefined)
}
