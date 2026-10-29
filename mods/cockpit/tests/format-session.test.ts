import { expect, test } from 'claude-code/testing'

import {
  TABS,
  WORKING_MARGIN_MS,
  activeAlerts,
  isWorking,
  parseRateCache,
  parseReset,
  resolveAlm,
  savedTab,
  tabNeeds,
  weeklyPace,
  worklogDays,
  worklogLabel,
} from '../hooks/session'
import { signedPct } from '../hooks/shared'
import { INITIAL } from '../hooks/state'
import { NOW } from './format-fixtures'

test('weeklyPace is the gap to what should still be left', () => {
  const week = 604800
  const resets = NOW + (week * 0.46 * 1000) // 46% of the window to go
  expect(weeklyPace(41, resets, week, NOW)).toEqual({ target: 46, delta: -5 })
  expect(weeklyPace(41, NOW - 1, week, NOW)).toBeUndefined()
  expect(signedPct(-5)).toBe('\u22125%')
  expect(signedPct(3)).toBe('+3%')
})

test('worklogDays is silent when the snapshot is stale', () => {
  const snap = { day: '2026-10-22', auditMtime: 1000.5, pending: [], underTarget: [{ date: '2026-10-12' }, { date: '2026-10-20' }] }
  expect(worklogDays(snap, 1000.5, '2026-10-22').underTarget).toEqual(['2026-10-12', '2026-10-20'])
  expect(worklogDays(snap, 2000, '2026-10-22').underTarget).toEqual([])
  expect(worklogDays(snap, 1000.5, '2026-10-23').underTarget).toEqual([])
  expect(worklogLabel('underTarget', ['2026-10-12', '2026-10-20'])).toBe('worklog: 2d under target (12/10, 20/10)')
})

test('parseReset reads the engine reset text; absent or not a date is undefined', () => {
  expect(parseReset('2026-10-22T10:00:00Z')).toBe(NOW)
  expect(parseReset(undefined)).toBeUndefined()
  expect(parseReset('soon')).toBeUndefined()
})

/** A Windows spelling of a path written with slashes. */
const win = (p: string) => p.split('/').join(String.fromCharCode(92))

const WORKSPACES = {
  roots: [
    { path: win('/ws/Product'), platform: 'azure-devops', org: 'org-a', project: 'Alpha', identity: 'id-a' },
    { path: win('/ws/clients'), platform: 'azure-devops', org: 'org-b', projects: { acme: 'Acme' }, identity: 'id-b' },
    { path: win('/ws/gh'), platform: 'github', org: 'gh-org' },
    { path: win('/ws/gh/moved'), platform: 'azure-devops', org: 'org-b', project: 'Moved', identity: 'id-b' },
  ],
}

test('resolveAlm resolves a directory like the workspaces hook: longest root wins, case-insensitive, sub-project map', () => {
  expect(resolveAlm(WORKSPACES, '/WS/product/api')).toEqual({ isMapped: true, org: 'org-a', project: 'Alpha', identity: 'id-a' })
  expect(resolveAlm(WORKSPACES, win('/ws/Product'))).toEqual({ isMapped: true, org: 'org-a', project: 'Alpha', identity: 'id-a' })
  // a nested root beats the plain root it sits in
  expect(resolveAlm(WORKSPACES, win('/ws/gh/moved/x'))).toEqual({ isMapped: true, org: 'org-b', project: 'Moved', identity: 'id-b' })
  // GitHub: no project, no identity
  expect(resolveAlm(WORKSPACES, win('/ws/gh/other'))).toEqual({ isMapped: true, org: 'gh-org' })
  // first subfolder picks the project; an unlisted or missing one leaves it out
  expect(resolveAlm(WORKSPACES, win('/ws/clients/Acme/web'))).toEqual({ isMapped: true, org: 'org-b', project: 'Acme', identity: 'id-b' })
  expect(resolveAlm(WORKSPACES, win('/ws/clients/other'))).toEqual({ isMapped: true, org: 'org-b', identity: 'id-b' })
  expect(resolveAlm(WORKSPACES, win('/ws/clients'))).toEqual({ isMapped: true, org: 'org-b', identity: 'id-b' })
  // a sibling that only shares the prefix is not inside the root
  expect(resolveAlm(WORKSPACES, win('/ws/Product-old'))).toEqual({ isMapped: false })
  expect(resolveAlm(WORKSPACES, win('/elsewhere'))).toEqual({ isMapped: false })
  // project "ask" and an identity that is not a plain name are left out
  expect(resolveAlm({ roots: [{ path: '/w', org: 'o', project: 'ask', identity: '../x' }] }, '/w/a')).toEqual({ isMapped: true, org: 'o' })
  // no map or a malformed one: undefined, the line is absent
  expect(resolveAlm(undefined, '/w')).toBeUndefined()
  expect(resolveAlm({ roots: 'x' }, '/w')).toBeUndefined()
  expect(resolveAlm({}, '/w')).toBeUndefined()
})

test('tabNeeds: the fast tier is the only one a selected tab asks for (git runs at the medium tier whenever the pane is open)', () => {
  expect(tabNeeds('agents')).toEqual({ fast: true })
  expect(tabNeeds('signals')).toEqual({ fast: true })
  expect(tabNeeds('work')).toEqual({ fast: true })
  expect(tabNeeds('notes')).toEqual({ fast: false })
  expect(tabNeeds('context')).toEqual({ fast: true }) // the refresh countdown
  expect(tabNeeds(undefined)).toEqual({ fast: true })
})

test('savedTab: the five tabs, and the older ones a state file may still hold mapped to where their content went', () => {
  expect(TABS).toEqual(['agents', 'context', 'signals', 'work', 'notes'])
  for (const tab of TABS) expect(savedTab(tab)).toBe(tab)
  expect(savedTab('session')).toBe('agents')
  expect(savedTab('history')).toBe('agents')
  expect(savedTab('repo')).toBe('work')
  expect(savedTab('system')).toBe('work')
  expect(savedTab('insights')).toBe('context')
  expect(savedTab('nope')).toBeUndefined()
  expect(savedTab(undefined)).toBeUndefined()
  expect(savedTab(3)).toBeUndefined()
})

test('activeAlerts: context from 80 %, 5h credits at 10 % left or less, a failed subagent; one entry per cause', () => {
  const alerts = (patch: Partial<typeof INITIAL>) => activeAlerts({ ...INITIAL, ...patch }).map(a => a.key)
  expect(alerts({})).toEqual([])
  expect(alerts({ ctx: { percent: 79.9 } })).toEqual([])
  expect(alerts({ ctx: { percent: 80 } })).toEqual(['context'])
  expect(alerts({ rateLimits: [{ kind: 'five_hour', percentUsed: 89 }, { kind: 'seven_day', percentUsed: 99 }] })).toEqual([])
  expect(alerts({ rateLimits: [{ kind: 'five_hour', percentUsed: 90 }] })).toEqual(['credits'])
  const agent = { type: 'reviewer', status: 'done' as const, startedAt: 0, tokens: 0 }
  expect(alerts({ agents: [{ ...agent, id: 'a1' }, { ...agent, id: 'a2', isFailed: true }, { ...agent, id: 'a3', isFailed: false }] })).toEqual(['agent:a2'])
  const texts = activeAlerts({ ...INITIAL, ctx: { percent: 85.4 }, rateLimits: [{ kind: 'five_hour', percentUsed: 93 }] }).map(a => a.text)
  expect(texts).toEqual(['context at 85%', 'credits 5h: 7% left'])
  const failed = activeAlerts({ ...INITIAL, agents: [{ ...agent, id: 'a9', isFailed: true }] }).map(a => a.text)
  expect(failed).toEqual(['subagent reviewer failed'])
})

test('parseRateCache: the status line cache read as rate limits (resets_at in seconds); a window already over is back to 0 % with no reset; garbage is none', () => {
  const now = 1_700_000_000_000
  expect(parseRateCache({ five_hour: { used_percentage: 40, resets_at: 1_800_000_000 }, seven_day: { used_percentage: 20, resets_at: 1_900_000_000 } }, now)).toEqual([
    { kind: 'five_hour', percentUsed: 40, resetsAt: new Date(1_800_000_000_000).toISOString() },
    { kind: 'seven_day', percentUsed: 20, resetsAt: new Date(1_900_000_000_000).toISOString() },
  ])
  expect(parseRateCache({ five_hour: { used_percentage: 90, resets_at: 1_600_000_000 } }, now)).toEqual([{ kind: 'five_hour', percentUsed: 0 }])
  expect(parseRateCache({ five_hour: { used_percentage: 12 } }, now)).toEqual([{ kind: 'five_hour', percentUsed: 12 }])
  expect(parseRateCache({ five_hour: { used_percentage: 'x', resets_at: 1 }, seven_day: null }, now)).toEqual([])
  expect(parseRateCache('nope', now)).toEqual([])
  expect(parseRateCache(null, now)).toEqual([])
})

test('isWorking: any Claude state but idle, or a main round ended within the 15 minute margin', () => {
  const s = INITIAL
  const now = 1_000_000_000
  expect(isWorking(s, now)).toBe(false)
  expect(isWorking({ ...s, claudeState: { kind: 'idle' } }, now)).toBe(false)
  for (const kind of ['working', 'thinking', 'tool', 'waiting'] as const) expect(isWorking({ ...s, claudeState: { kind } } as typeof s, now)).toBe(true)
  const ended = (ago: number) => ({ ...s, claudeState: { kind: 'idle' as const }, insights: { ...s.insights, lastRoundEnd: now - ago } }) as typeof s
  expect(isWorking(ended(WORKING_MARGIN_MS), now)).toBe(true)
  expect(isWorking(ended(WORKING_MARGIN_MS + 1), now)).toBe(false)
})
