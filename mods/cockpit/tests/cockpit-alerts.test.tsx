import { expect, test } from 'claude-code/testing'

import { finishAgent, measureWith, RL_FILE, rlCache, settleAll, spawnAgent, spawns } from './cockpit-fixtures'
import { world } from './cockpit-world'

// ── Phase 6: alerts ──

test('alerts: context at 80 % toasts once per episode, and again once it cleared', async ($, on) => {
  const toasts: string[] = []
  world(on, { toasts })
  on('session.measure', (_, e) => ({ changed: e.changed }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(toasts).toEqual([])
  const measure = (percent: number) => $.session.measure({ context: { window: 1_000_000, tokens: percent * 10_000, percent }, rateLimits: [], cost: { usd: 5 }, changed: ['context'] })
  await measure(85)
  expect(toasts).toEqual(['context at 85%'])
  await measure(90)
  await measure(81)
  expect(toasts).toHaveLength(1) // the same episode
  await measure(40) // cleared
  await measure(82)
  expect(toasts).toEqual(['context at 85%', 'context at 82%'])
})

test('alerts: a context under 80 % at the start of a session toasts nothing', async ($, on) => {
  const toasts: string[] = []
  world(on, { toasts, ctxPercent: 79 })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(toasts).toEqual([])
})

test('alerts: 5h credits at 10 % left or less toast once; the 7d window does not count', async ($, on) => {
  const toasts: string[] = []
  world(on, { toasts, rateLimits: [{ kind: 'five_hour', percentUsed: 50 }, { kind: 'seven_day', percentUsed: 99 }] })
  on('session.measure', (_, e) => ({ changed: e.changed }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(toasts).toEqual([]) // the 7d window at 99 % is no cause
  const measure = (used: number) => $.session.measure({ context: { window: 1_000_000, tokens: 1, percent: 1 }, rateLimits: [{ kind: 'five_hour', percentUsed: used }], cost: { usd: 5 }, changed: ['rateLimits'] })
  await measure(92)
  expect(toasts).toEqual(['credits 5h: 8% left'])
  await measure(95)
  expect(toasts).toHaveLength(1)
  await measure(50)
  await measure(91)
  expect(toasts).toEqual(['credits 5h: 8% left', 'credits 5h: 9% left'])
})

test('alerts: a subagent that failed toasts once; one that answered does not', async ($, on) => {
  const toasts: string[] = []
  world(on, { toasts })
  spawns(on)
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await spawnAgent($, 'reviewer')
  await spawnAgent($, 'writer')
  await finishAgent($, 'a2', 'answer')
  expect(toasts).toEqual([])
  await finishAgent($, 'a1', 'error')
  expect(toasts).toEqual(['subagent reviewer failed'])
})

test('alerts: a session resumed above a threshold raises nothing for it; the first live readings are the seed, a rise later toasts', async ($, on) => {
  const toasts: string[] = []
  world(on, { toasts, ctxPercent: 85, rateLimits: [{ kind: 'five_hour', percentUsed: 95 }], dataFile: JSON.stringify({ history: [] }) })
  on('session.measure', (_, e) => ({ changed: e.changed }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await settleAll()
  expect(toasts).toEqual([])
  await measureWith($, 90, [{ kind: 'five_hour', percentUsed: 96 }])
  expect(toasts).toEqual([])
  await measureWith($, 40, [{ kind: 'five_hour', percentUsed: 50 }])
  await measureWith($, 82, [{ kind: 'five_hour', percentUsed: 93 }])
  expect(toasts).toEqual(['context at 82%', 'credits 5h: 7% left'])
})

test('alerts: a resumed session whose context and credits are measured only after its first response raises nothing for them', async ($, on) => {
  const toasts: string[] = []
  world(on, { toasts, isFresh: true, rateLimits: [], files: { [RL_FILE]: rlCache(95, 10) }, dataFile: JSON.stringify({ history: [], ctx: { tokens: 850_000, window: 1_000_000, percent: 85 } }) })
  on('session.measure', (_, e) => ({ changed: e.changed }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await settleAll()
  expect(toasts).toEqual([]) // the last-known values are shown, never alerted
  await measureWith($, 85, [{ kind: 'five_hour', percentUsed: 95 }])
  expect(toasts).toEqual([])
  await measureWith($, 40, [{ kind: 'five_hour', percentUsed: 50 }])
  await measureWith($, 82, [{ kind: 'five_hour', percentUsed: 50 }])
  expect(toasts).toEqual(['context at 82%'])
})
