import { expect, test } from 'claude-code/testing'

import { headerOf, paneRows } from './cockpit-fixtures'
import { world } from './cockpit-world'

test('header: the autocompact forecast is the requests left at the recent growth; the threshold is read once, with a summary breakdown', async ($, on) => {
  const usageCalls: (string | undefined)[] = []
  world(on, { autoCompactAt: 400_000, usageCalls })
  on('turn.complete', () => ({ text: '' }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  // The context is what the engine measured; the turn's usage sums its requests (`steps` of them), so it is `steps` times the context.
  const complete = async (context: number, steps: number, agentId?: string) => {
    if (!agentId) await $.session.measure({ context: { window: 1_000_000, tokens: context, percent: 20 }, rateLimits: [], changed: ['context'] })
    await $.turn.complete({
      answer: '',
      durationMs: 1,
      isAborted: false,
      turnId: 't',
      reason: 'answer',
      ...(agentId ? { agentId } : {}),
      usage: { input_tokens: 0, output_tokens: 7, cache_read_input_tokens: context * steps, cache_creation_input_tokens: 0, model: 'm' },
    })
  }
  const forecast = async () => headerOf((await paneRows($)).rows).find(r => /requests/.test(r))
  await complete(200_000, 8)
  expect(await forecast()).toBeUndefined() // one turn: no growth to average
  await complete(210_000, 1) // a one-request turn after an eight-request one is not a compaction
  await complete(990_000, 3, 'a1') // a subagent's turn is not the main loop's growth
  await complete(220_000, 5)
  expect(await forecast()).toContain('~18 requests') // 180k left at 10k a turn
  expect(usageCalls.filter(c => c === 'summary')).toHaveLength(1)
})

test('header: the autocompact threshold survives a /clear: the forecast is still drawn', async ($, on) => {
  let id = 's-1'
  world(on, { autoCompactAt: 400_000, sessionId: () => id })
  on('turn.complete', () => ({ text: '' }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  id = 's-2'
  await $.session.end({ reason: 'clear', sessionId: 's-1', resume: { id: 's-1' } }) // no session start follows
  for (const context of [200_000, 210_000, 220_000]) {
    await $.session.measure({ context: { window: 1_000_000, tokens: context, percent: 20 }, rateLimits: [], changed: ['context'] })
    await $.turn.complete({
      answer: '',
      durationMs: 1,
      isAborted: false,
      turnId: 't',
      reason: 'answer',
      usage: { input_tokens: 0, output_tokens: 7, cache_read_input_tokens: context, cache_creation_input_tokens: 0, model: 'm' },
    })
  }
  expect(headerOf((await paneRows($)).rows).some(r => /~18 requests/.test(r))).toBe(true)
})

test('header: no forecast when auto-compaction is off', async ($, on) => {
  world(on)
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  for (const tokens of [200_000, 210_000, 220_000]) {
    await $.turn.complete({
      answer: '',
      durationMs: 1,
      isAborted: false,
      turnId: 't',
      reason: 'answer',
      usage: { input_tokens: 0, output_tokens: 7, cache_read_input_tokens: tokens, cache_creation_input_tokens: 0, model: 'm' },
    })
  }
  expect(headerOf((await paneRows($)).rows).some(r => /requests/.test(r))).toBe(false)
})
