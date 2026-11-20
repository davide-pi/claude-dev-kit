import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { t } from '../hooks/strings'
import { mountPane } from './cockpit-fixtures'
import { settle, world } from './cockpit-world'
import type { World } from './cockpit-world'

/** The terminal pane, its compact button pressed: what the world heard (`session.compact` instructions, `/compact` runs, toasts). */
async function pressCompact($: Engine, on: On, options: World, isTurnRunning: boolean, commandRefuses = false) {
  const commands: string[] = []
  const toasts: string[] = []
  const instructions: (string | undefined)[] = []
  world(on, { ...options, toasts, instructions })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  // no hook for /compact: the engine refuses the run
  if (!commandRefuses)
    on('command.run', { command: 'compact' }, (_, e) => {
      commands.push(`/${e.command} ${e.args}`)
      return { text: 'ok' }
    })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mountPane($)
  if (isTurnRunning) await $.turn.start({ text: 'go', turnId: 't1' })
  await ui.press({ key: 'bar:compact' })
  await settle()
  await ui.unmount()
  return { commands, toasts, instructions }
}

test('Given session.compact resolves, When compact is pressed, Then there is no toast and no /compact', { timeoutMs: 30_000 }, async ($, on) => {
  // Given / When
  const { commands, toasts, instructions } = await pressCompact($, on, { compacts: true }, false)
  // Then
  expect(instructions).toHaveLength(1)
  expect(commands).toEqual([])
  expect(toasts).toEqual([])
})

test('Given session.compact rejects, When compact is pressed, Then /compact runs with the instructions', { timeoutMs: 30_000 }, async ($, on) => {
  // Given / When
  const { commands, toasts, instructions } = await pressCompact($, on, { compactIsCore: true }, true)
  // Then
  expect(commands).toEqual([`/compact ${instructions[0]}`])
  expect(toasts).toEqual([])
})

test('Given session.compact skips, When compact is pressed, Then the toast tells the reason and /compact does not run', { timeoutMs: 30_000 }, async ($, on) => {
  // Given / When
  const { commands, toasts } = await pressCompact($, on, {}, false)
  // Then
  expect(toasts).toEqual(['test'])
  expect(commands).toEqual([])
})

test('Given session.compact and /compact both reject, When compact is pressed, Then the toast says it cannot compact now', { timeoutMs: 30_000 }, async ($, on) => {
  // Given / When
  const { toasts } = await pressCompact($, on, { compactIsCore: true }, true, true)
  // Then
  expect(toasts).toEqual([t().compactRefused])
})
