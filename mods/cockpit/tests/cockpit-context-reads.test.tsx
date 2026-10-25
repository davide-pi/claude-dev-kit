import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { CONTEXT_ROWS, holds, mainTurnEnd, mountPane, openCockpit, settleAll } from './cockpit-fixtures'
import { world } from './cockpit-world'

test('follow-up: an older context read never replaces a newer one: the exact count asked after a slow summary wins, whichever answers last', async ($, on) => {
  const h = holds()
  world(on, { holdUsage: h.holdUsage, breakdown: { categories: CONTEXT_ROWS, totalTokens: 98_000, rawMaxTokens: 1_000_000 } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 50)
  const kind = async () => (await ui.find({ type: 'Text', text: /^(estimate|exact|✓ = exact)$/ }))?.text
  const releaseSummary = h.hold('summary')
  await ui.press({ key: 'tab:context' }) // summary read #1, held
  const releaseFull = h.hold('full')
  await ui.press({ key: 'ctx:refresh' }) // full read #2, held
  releaseFull()
  await settleAll()
  expect(await kind()).toBe('exact')
  releaseSummary() // the older read answers last
  await settleAll()
  expect(await kind()).toBe('exact')
  await ui.unmount()
})

test('follow-up: a summary read asked by a tab change while the exact count runs is skipped: the exact result is never discarded', async ($, on) => {
  const h = holds()
  const usageCalls: (string | undefined)[] = []
  world(on, { usageCalls, holdUsage: h.holdUsage, breakdown: { categories: CONTEXT_ROWS, totalTokens: 98_000, rawMaxTokens: 1_000_000 } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 50)
  const kind = async () => (await ui.find({ type: 'Text', text: /^(estimate|exact|✓ = exact)$/ }))?.text
  const summaries = () => usageCalls.filter(c => c === 'summary').length
  await ui.press({ key: 'tab:context' })
  await settleAll()
  const releaseFull = h.hold('full')
  await ui.press({ key: 'ctx:refresh' }) // full read #2, held
  const before = summaries()
  await ui.press({ key: 'tab:agents' })
  await ui.press({ key: 'tab:context' }) // would be summary read #3: skipped while counting
  await settleAll()
  expect(summaries()).toBe(before)
  releaseFull() // the count answers
  await settleAll()
  expect(await kind()).toBe('exact')
  await ui.press({ key: 'tab:agents' })
  await ui.press({ key: 'tab:context' }) // the count is over: a tab change reads a summary again
  await settleAll()
  expect(summaries()).toBe(before + 1)
  expect(await kind()).toBe('✓ = exact')
  await ui.unmount()
})

/** `on` with the first `clock.after` of the context debounce refused (the hook throws, so the engine skips it and runs nothing): the timer never fires. */
function refusingFirstAfter(on: On): On {
  let isRefused = false
  // `on` is overloaded on its pattern and matcher; this wrapper only forwards, so the loose signature cannot reach a caller
  const wrapped = (pattern: string, ...rest: unknown[]) => {
    const hook = rest.pop() as (...args: unknown[]) => unknown
    const guarded =
      pattern === 'clock.after'
        ? (...args: unknown[]) => {
            // only the context read's debounce (2 s) is refused, once
            if (isRefused || (args[1] as { ms?: number } | undefined)?.ms !== 2000) return hook(...args)
            isRefused = true
            throw new Error('refused')
          }
        : hook
    return (on as unknown as (...a: unknown[]) => unknown)(pattern, ...rest, guarded)
  }
  return wrapped as unknown as On
}

test('follow-up: a context read timer the engine refused does not stop the next turn from scheduling its read', async ($, on) => {
  const usageCalls: (string | undefined)[] = []
  const clock = world(refusingFirstAfter(on), { usageCalls, breakdown: { categories: CONTEXT_ROWS, totalTokens: 98_000, rawMaxTokens: 1_000_000 } })
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await openCockpit($)
  const ui = await mountPane($, 50)
  const summaries = () => usageCalls.filter(c => c === 'summary').length
  await ui.press({ key: 'tab:context' })
  await settleAll()
  const opened = summaries()
  await mainTurnEnd($) // its timer is refused: the read never runs
  await clock.advance(5000)
  await settleAll()
  expect(summaries()).toBe(opened)
  await mainTurnEnd($) // the refused timer must not hold the next one back
  await clock.advance(5000)
  await settleAll()
  expect(summaries()).toBe(opened + 1)
  await ui.unmount()
})

// ── Cockpit v3, phase 4 follow-ups, round 2 ──

test('follow-up: an exact context count in flight is not overwritten by the scheduled summary of a turn that ends meanwhile', async ($, on) => {
  const h = holds()
  const usageCalls: (string | undefined)[] = []
  const clock = world(on, { usageCalls, holdUsage: h.holdUsage, breakdown: { categories: CONTEXT_ROWS, totalTokens: 98_000, rawMaxTokens: 1_000_000 } })
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await openCockpit($)
  const ui = await mountPane($, 50)
  const kind = async () => (await ui.find({ type: 'Text', text: /^(estimate|exact|✓ = exact)$/ }))?.text
  const summaries = () => usageCalls.filter(c => c === 'summary').length
  await ui.press({ key: 'tab:context' })
  await settleAll()
  const release = h.hold('full')
  await ui.press({ key: 'ctx:refresh' }) // counting, held
  const before = summaries()
  await mainTurnEnd($) // schedules a summary read in 2 s
  await clock.advance(5000)
  await settleAll()
  expect(summaries()).toBe(before) // skipped while the count runs
  release()
  await settleAll()
  // the turn that ended meanwhile is read once the count is over, laid over the count's static rows
  expect(summaries()).toBe(before + 1)
  expect(await kind()).toBe('✓ = exact')
  await mainTurnEnd($) // the next turn's read runs again
  await clock.advance(5000)
  await settleAll()
  expect(summaries()).toBe(before + 2)
  await ui.unmount()
})

test('follow-up: a turn that ended just before the exact count started does not read a summary into it either, and is read once the count is over', async ($, on) => {
  const h = holds()
  const usageCalls: (string | undefined)[] = []
  const clock = world(on, { usageCalls, holdUsage: h.holdUsage, breakdown: { categories: CONTEXT_ROWS, totalTokens: 98_000, rawMaxTokens: 1_000_000 } })
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await openCockpit($)
  const ui = await mountPane($, 50)
  await ui.press({ key: 'tab:context' })
  await settleAll()
  const summaries = () => usageCalls.filter(c => c === 'summary').length
  await mainTurnEnd($) // the summary is scheduled, not yet read
  const before = summaries()
  const release = h.hold('full')
  await ui.press({ key: 'ctx:refresh' })
  await clock.advance(5000) // its timer fires while the count is in flight
  await settleAll()
  expect(summaries()).toBe(before)
  release()
  await settleAll()
  expect(summaries()).toBe(before + 1) // the read its timer could not make
  expect((await ui.find({ type: 'Text', text: /^(estimate|exact|✓ = exact)$/ }))?.text).toBe('✓ = exact')
  await ui.unmount()
})

test('follow-up: opening the pane on the Context tab while the exact count runs reads no summary', async ($, on) => {
  const h = holds()
  const usageCalls: (string | undefined)[] = []
  world(on, { usageCalls, holdUsage: h.holdUsage, stateFile: JSON.stringify({ open: false, tab: 'context' }), breakdown: { categories: CONTEXT_ROWS, totalTokens: 98_000, rawMaxTokens: 1_000_000 } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 50)
  const summaries = () => usageCalls.filter(c => c === 'summary').length
  const releaseFull = h.hold('full')
  await ui.press({ key: 'ctx:refresh' })
  const before = summaries()
  await openCockpit($)
  await settleAll()
  expect(summaries()).toBe(before)
  releaseFull()
  await settleAll()
  await ui.unmount()
})

test('follow-up: an exact count that never answers is released after a timeout, so the Context tab reads again', async ($, on) => {
  const h = holds()
  const usageCalls: (string | undefined)[] = []
  const clock = world(on, { usageCalls, holdUsage: h.holdUsage, breakdown: { categories: CONTEXT_ROWS, totalTokens: 98_000, rawMaxTokens: 1_000_000 } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 50)
  const summaries = () => usageCalls.filter(c => c === 'summary').length
  await ui.press({ key: 'tab:context' })
  await settleAll()
  const releaseFull = h.hold('full') // never answers, until the end of the test
  await ui.press({ key: 'ctx:refresh' })
  const before = summaries()
  await ui.press({ key: 'tab:agents' })
  await ui.press({ key: 'tab:context' })
  await settleAll()
  expect(summaries()).toBe(before) // still counting
  await clock.advance(61_000)
  await ui.press({ key: 'tab:agents' })
  await ui.press({ key: 'tab:context' })
  await settleAll()
  expect(summaries()).toBe(before + 1) // released
  releaseFull()
  await settleAll()
  await ui.unmount()
})
