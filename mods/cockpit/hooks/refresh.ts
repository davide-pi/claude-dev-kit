import { atom, read } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { CockpitAgent, CockpitHistoryEntry } from '../types'
import { AGENT_KEEP_MS, addHistory, toHistory, withAgentTokens } from './agents'
import { recordCtxAfter } from './insights'
import { refreshGit } from './refresh-git'
import { parseRateCache, resolveAlm, tabNeeds, worklogDays } from './session'
import type { WorklogSnapshot } from './session'
import { isOpen, writeState } from './session-data'
import { INITIAL } from './state'
import { configDir, patch } from './store'
import { langOf, setLang } from './strings'
import { parseDoneClaims } from './work'

// The scan that checks `$.state` references reads the atom from the file that uses it.
const snapshot = atom({ plugin: 'cockpit', key: 'snapshot' } as const, INITIAL)

/** The language of the pane's texts: the `lang` of `<config dir>/cockpit.json`; a missing or unreadable file is English. */
export async function refreshLang($: EngineInterface): Promise<void> {
  try {
    const dir = await configDir($)
    const text = dir ? await $.fs.read(`${dir}/cockpit.json`) : undefined
    setLang(langOf(typeof text === 'string' ? text : ''))
  } catch {
    setLang('en')
  }
}

export async function refreshWorklog($: EngineInterface, now: number): Promise<void> {
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
export async function refreshAlm($: EngineInterface): Promise<void> {
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

// The size, modification time and session of `done-claim.log` as last read: the log is read again only when one changed.
let lastClaimsStat: { size: number; mtimeMs: number; sessionId: string | undefined } | undefined

/** The last entries of the done-claim hook's log, read when its size or mtime changed; no readable log clears them. */
export async function refreshDoneClaims($: EngineInterface): Promise<void> {
  try {
    const dir = await configDir($)
    if (!dir) return
    const file = `${dir}/.cache/done-claim.log`
    const { sessionId } = await read($, snapshot)
    const { size, mtimeMs } = await $.fs.stat(file)
    if (lastClaimsStat?.size === size && lastClaimsStat.mtimeMs === mtimeMs && lastClaimsStat.sessionId === sessionId) return
    const text = await $.fs.read(file)
    const claims = parseDoneClaims(typeof text === 'string' ? text : '', sessionId)
    await patch($, s => ({ ...s, doneClaims: claims.length > 0 ? claims : undefined }))
    lastClaimsStat = { size, mtimeMs, sessionId }
  } catch {
    lastClaimsStat = undefined
    await patch($, s => ({ ...s, doneClaims: undefined })).catch(() => undefined)
  }
}

/** The rate limits of the status line's cache, kept as the last known ones: drawn with a `~` until the engine reports its own. No readable cache leaves none. */
export async function refreshLastRates($: EngineInterface): Promise<void> {
  try {
    const dir = await configDir($)
    if (!dir) return
    const text = await $.fs.read(`${dir}/.statusline-rate-limits.json`)
    const lastRates = parseRateCache(JSON.parse(typeof text === 'string' ? text : ''), await $.clock.now())
    await patch($, s => ({ ...s, lastRates: lastRates.length > 0 ? lastRates : undefined }))
  } catch {
    // no cache yet: nothing to draw until the engine measures
  }
}

export async function refreshUsage($: EngineInterface): Promise<void> {
  try {
    const u = await $.session.usage()
    const now = await $.clock.now()
    await patch($, s => ({
      ...s,
      ctx: { ...s.ctx, tokens: u.context.tokens, window: u.context.window, percent: u.context.percent },
      lastCtx: u.context.percent !== undefined ? undefined : s.lastCtx,
      insights: recordCtxAfter(s.insights, u.context.tokens),
      cost: { ...s.cost, usd: u.cost?.usd },
      rateLimits: u.rateLimits,
    }))
  } catch {
    // not measured yet
  }
}

/**
 * Reads the auto-compaction threshold once per session start: a `summary` breakdown estimates locally, it asks the model for
 * nothing. Off, or a failed read, leaves it absent (the header then draws no forecast).
 */
export async function refreshAutoCompact($: EngineInterface): Promise<void> {
  try {
    const u = await $.session.usage({ breakdown: 'summary' })
    const autoCompactAt = u.context.breakdown?.autoCompactThreshold
    await patch($, s => ({ ...s, autoCompactAt }))
  } catch {
    // not measured: no forecast
  }
}

/**
 * The clock the countdowns and durations count from, and the agents that ended moved to the history: every tier runs it, so
 * `now` is never older than the tier's own period.
 */
async function tickClock($: EngineInterface): Promise<number> {
  const now = await $.clock.now()
  const listed = await $.agent.list().catch(() => undefined)
  await patch($, s => {
    const inRun = new Set(s.workflowRun?.agents.map(a => a.id))
    const agents = s.agents.map((a): CockpitAgent => {
      // An agent the engine no longer lists as active has ended without a turn.complete we saw. A workflow's agents are never
      // listed: theirs end by their own turn, an explicit failed or killed listing, or the end of their run.
      const info = listed?.find(l => l.id === a.id)
      const endedBy = inRun.has(a.id) ? ['failed', 'killed'] : ['completed', 'failed', 'killed']
      const isEnded = listed !== undefined && a.status === 'running' && (info ? endedBy.includes(info.status) : !inRun.has(a.id))
      return isEnded ? { ...a, status: 'done', endedAt: now, isFailed: info?.status === 'failed' || info?.status === 'killed' } : a
    })
    const isListed = (a: CockpitAgent) => a.status === 'running' || (a.endedAt !== undefined && now - a.endedAt < AGENT_KEEP_MS)
    const gone = agents.filter(a => !isListed(a))
    const left = gone
      .map(toHistory)
      .filter((h): h is CockpitHistoryEntry => h !== undefined)
      .sort((a, b) => b.endedAt - a.endedAt)
    return {
      ...s,
      now,
      agents: agents.filter(isListed),
      history: left.length > 0 ? addHistory(s.history, left) : s.history,
      // An agent leaving the list (type `?` ones too: they used tokens) joins the count that the share keeps.
      agentTokens: withAgentTokens(s.agentTokens, gone),
    }
  })
  return now
}

/** Whether the pane is open and its selected tab asks for the fast tier. */
async function isFastWanted($: EngineInterface): Promise<boolean> {
  if (!isOpen) return false
  const { tab } = await read($, snapshot)
  return tabNeeds(tab).fast
}

/** Fast tier (2 s): the elapsed times of a tab that draws them. */
export async function fastTick($: EngineInterface): Promise<void> {
  if (await isFastWanted($)) await tickClock($)
}

/** Medium tier (10 s): git (and, with the Work tab, its reads), whatever the tab while the pane is open: the header shows it on every tab. */
export async function mediumTick($: EngineInterface): Promise<void> {
  if (!isOpen) return
  await tickClock($)
  await refreshGit($)
}

/** Slow tier (30 s), whatever the tab: the state file's heartbeat, the ALM line, git (and the pull request through it), the worklog, the done-claim log. */
export async function slowTick($: EngineInterface): Promise<void> {
  // While the pane is open the file is the proof of it: a stale `at` lets the statusline ignore a leftover `open:true`. First, so a slow or failing read cannot delay or skip it.
  if (isOpen) await writeState($, true, true)
  // A failed clock tick must not skip the reads below.
  const now = await tickClock($).catch(() => $.clock.now())
  // The ALM line first: an Azure DevOps pull request is asked about with its org.
  await refreshAlm($)
  await refreshGit($)
  await refreshWorklog($, now)
  await refreshDoneClaims($)
}
