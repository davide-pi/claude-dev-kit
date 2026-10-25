import type { CockpitAlm, CockpitNote, CockpitRateLimit, CockpitSnapshot, CockpitTab } from '../types'
import { isRecord, shortDate } from './shared'
import { t } from './strings'

/** How much should still be left now (`target`) and the signed gap to what is (`delta`, + is ahead). */
export function weeklyPace(
  remainingPct: number,
  resetsAtMs: number | undefined,
  windowSec: number,
  now: number,
): { target: number; delta: number } | undefined {
  if (resetsAtMs === undefined) return undefined
  const remainSec = (resetsAtMs - now) / 1000
  if (remainSec <= 0 || remainSec > windowSec) return undefined
  const target = Math.round((remainSec / windowSec) * 100)
  return { target, delta: remainingPct - target }
}

/**
 * What a selected tab asks of the clock tiers: `fast` (2 s) for the elapsed times it draws (Ora's, Segnali's wait, Costi's refresh countdown). The medium tier
 * (10 s, git) runs whenever the pane is open, the header shows git on every tab; the slow tier (30 s) runs whatever the tab; none of them
 * while the pane is closed.
 */
export function tabNeeds(tab: CockpitTab | undefined): { fast: boolean } {
  switch (tab ?? 'agents') {
    case 'notes':
      return { fast: false }
    default:
      return { fast: true }
  }
}

export type WorklogSnapshot = {
  day?: string
  auditMtime?: number
  pending?: { date: string }[]
  underTarget?: { date: string }[]
}

/**
 * The worklog days to flag, with the statusline's staleness rule: a snapshot from another day, or
 * from before /worklog last wrote its audit, is silent (which is how the badge clears itself).
 */
export function worklogDays(
  snap: WorklogSnapshot,
  auditMtimeMs: number | undefined,
  todayIso: string,
): { pending: string[]; underTarget: string[] } {
  const none = { pending: [], underTarget: [] }
  if (snap.day !== todayIso) return none
  if (snap.auditMtime === undefined || auditMtimeMs === undefined) return none
  if (Math.abs(snap.auditMtime - auditMtimeMs) >= 1) return none
  return {
    pending: (snap.pending ?? []).map(d => d.date),
    underTarget: (snap.underTarget ?? []).map(d => d.date),
  }
}

/** The `wl` / `worklog:` text of the footer for one kind of day. */
export function worklogLabel(kind: 'pending' | 'underTarget', dates: readonly string[]): string {
  const { worklog } = t()
  return worklog.label(dates.length, worklog[kind], dates.map(shortDate).join(', '))
}

// ── Rate limits ──────────────────────────────────────────────────────────────

/**
 * The status line's rate-limit cache (`.statusline-rate-limits.json`, `resets_at` in seconds) as the engine's limits, reconciled the way the
 * status line does: a window whose reset is over is back to 0 % used with no reset time. A window of the wrong shape is left out.
 */
export function parseRateCache(value: unknown, now: number): CockpitRateLimit[] {
  if (!isRecord(value)) return []
  const window = (kind: 'five_hour' | 'seven_day'): CockpitRateLimit[] => {
    const w = value[kind]
    if (!isRecord(w) || typeof w.used_percentage !== 'number' || !Number.isFinite(w.used_percentage)) return []
    const resetsMs = typeof w.resets_at === 'number' && Number.isFinite(w.resets_at) && w.resets_at > 0 ? w.resets_at * 1000 : undefined
    if (resetsMs !== undefined && resetsMs <= now) return [{ kind, percentUsed: 0 }]
    return [{ kind, percentUsed: w.used_percentage, ...(resetsMs !== undefined && { resetsAt: new Date(resetsMs).toISOString() }) }]
  }
  return [...window('five_hour'), ...window('seven_day')]
}

/** A reset time as the engine reports it (ISO text) in milliseconds; undefined when absent or not a date. */
export function parseReset(resetsAt: string | undefined): number | undefined {
  const ms = resetsAt ? Date.parse(resetsAt) : Number.NaN
  return Number.isNaN(ms) ? undefined : ms
}

// ── ALM target of the working directory ──────────────────────────────────────

// A directory in the form the roots are compared in: forward slashes, no trailing one, lowercase.
const normDir = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

/**
 * The ALM target of `cwd` from the parsed `workspaces.json`, by the rules of hooks/lib/workspaces.js: the longest
 * root whose path contains the directory, case-insensitively (a port: the mod cannot require a Node module). A root
 * names its `project`, or maps the first subfolder through `projects`; `"ask"`, an unlisted subfolder and a GitHub
 * root leave the project out. Undefined when there is no usable map: the hook is silent then, and so is the line.
 */
export function resolveAlm(map: unknown, cwd: string): CockpitAlm | undefined {
  const rawRoots = isRecord(map) ? map.roots : undefined
  if (!Array.isArray(rawRoots)) return undefined
  const roots = rawRoots
    .filter((r): r is Record<string, unknown> & { path: string } => isRecord(r) && typeof r.path === 'string')
    .map(r => ({ entry: r, root: normDir(r.path) }))
    .sort((a, b) => b.root.length - a.root.length)
  const dir = normDir(cwd)
  const hit = roots.find(({ root }) => dir === root || dir.startsWith(`${root}/`))
  if (!hit) return { isMapped: false }
  const { entry, root } = hit
  const alm: CockpitAlm = { isMapped: true }
  if (typeof entry.org === 'string') alm.org = entry.org
  const project = projectOf(entry, dir.slice(root.length + 1).split('/')[0] ?? '')
  if (project && entry.platform !== 'github') alm.project = project
  if (typeof entry.identity === 'string' && /^[\w.-]+$/.test(entry.identity)) alm.identity = entry.identity
  return alm
}

function projectOf(entry: Record<string, unknown>, firstSubfolder: string): string | undefined {
  if (isRecord(entry.projects)) {
    const key = Object.keys(entry.projects).find(k => k.toLowerCase() === firstSubfolder)
    const name = key === undefined ? undefined : entry.projects[key]
    return typeof name === 'string' ? name : undefined
  }
  return typeof entry.project === 'string' && entry.project !== 'ask' && entry.project !== '' ? entry.project : undefined
}

/** The cockpit's tabs, in the order the bar draws them: Agents, Context, Notifications, Work, Notes. */
export const TABS: readonly CockpitTab[] = ['agents', 'context', 'signals', 'work', 'notes']

export const isTab = (v: unknown): v is CockpitTab => TABS.some(tab => tab === v)

/** The tab a state file names; the tabs of the older versions went where their content did (Insights to Context, System to Work, History to Agents). */
export const savedTab = (v: unknown): CockpitTab | undefined =>
  v === 'session' || v === 'history' ? 'agents' : v === 'repo' || v === 'system' ? 'work' : v === 'insights' ? 'context' : isTab(v) ? v : undefined

// ── Alerts (D4) and the session data file ──

/** The context fill from which the cockpit alerts, and the 5h credits left (percent) at or under which it does. */
const ALERT_CTX_PCT = 80
const ALERT_CREDITS_LEFT_PCT = 10

/** One cause the person is told about: `key` names the episode (it ends when the cause is no longer in the list), `text` is the toast. */
export type CockpitAlert = { key: string; text: string }

/** The causes of an alert in `s` now: context at 80 % or more, 5h credits at 10 % left or less, each failed subagent. */
export function activeAlerts(s: CockpitSnapshot): CockpitAlert[] {
  const out: CockpitAlert[] = []
  const pct = s.ctx.percent
  if (pct !== undefined && pct >= ALERT_CTX_PCT) out.push({ key: 'context', text: t().alertContext(Math.round(pct)) })
  const five = s.rateLimits.find(r => r.kind === 'five_hour')
  if (five && 100 - five.percentUsed <= ALERT_CREDITS_LEFT_PCT) out.push({ key: 'credits', text: t().alertCredits(Math.max(0, Math.round(100 - five.percentUsed))) })
  for (const a of s.agents) if (a.isFailed === true) out.push({ key: `agent:${a.id}`, text: t().alertSubagent(a.type) })
  return out
}

/** A note's longest text. */
export const NOTE_MAX = 2000

/** A note's text with CRLF and lone CR as LF: a paste from Windows or a file keeps its lines, never a stray `\r`. */
export const normalizeNewlines = (text: string): string => text.replace(/\r\n?/g, '\n')

/**
 * The saved notes out of a parsed data file: the `notes` list (entries with a numeric id and a text, each cut to `NOTE_MAX`; a blank
 * one, a repeated id or anything else is left out). A file from before the list holds one `note` text: that becomes the first entry.
 */
export function parseNotes(notes: unknown, legacyNote?: unknown): CockpitNote[] | undefined {
  const list: CockpitNote[] = []
  if (Array.isArray(notes)) {
    for (const entry of notes as unknown[]) {
      const { id, text } = (typeof entry === 'object' && entry !== null ? entry : {}) as { id?: unknown; text?: unknown }
      if (typeof id !== 'number' || !Number.isSafeInteger(id) || typeof text !== 'string' || text.trim() === '' || list.some(n => n.id === id)) continue
      list.push({ id, text: normalizeNewlines(text).slice(0, NOTE_MAX) })
    }
  } else if (typeof legacyNote === 'string' && legacyNote.trim() !== '') {
    list.push({ id: 1, text: normalizeNewlines(legacyNote).slice(0, NOTE_MAX) })
  }
  return list.length > 0 ? list : undefined
}
