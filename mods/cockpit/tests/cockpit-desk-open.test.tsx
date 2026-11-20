import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { settle, world } from './cockpit-world'

const cockpit = ($: Engine, args: string) => $.command.run({ command: 'cockpit', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 80 } })

// ── T6: the size the pane asks for when it opens ──

for (const [surface, columns] of [['desktop', 110], ['terminal', 60]] as const) {
  test(`Given a session drawn on ${surface}, When the pane opens, Then it asks for ${columns} columns`, { timeoutMs: 30_000 }, async ($, on) => {
    // Given
    const openedColumns: (number | undefined)[] = []
    world(on, { openedColumns })
    on('session.surfaces', () => ({ value: [surface] }))
    await $.session.start({ cwd: '/', surface, isInteractive: true })
    // When
    await cockpit($, '')
    // Then
    expect(openedColumns).toEqual([columns])
  })
}

test('Given a REPL session with the desktop attached, When the pane opens, Then it asks for the terminal width, 60 columns', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const openedColumns: (number | undefined)[] = []
  world(on, { openedColumns })
  on('session.surfaces', () => ({ value: ['terminal', 'desktop'] }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  // When
  await cockpit($, '')
  // Then
  expect(openedColumns).toEqual([60])
})

test('Given a pane opened at start with no client, When the desktop attaches, Then the pane is opened again with 110 columns', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const openedColumns: (number | undefined)[] = []
  const opened: string[] = []
  let surfaces: string[] = []
  world(on, { openedColumns, opened, isAutoOpen: true })
  on('session.surfaces', () => ({ value: surfaces }))
  on('session.attach', (_, e) => ({ clientId: e.clientId }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await settle()
  // When
  surfaces = ['desktop']
  await $.session.attach({ surface: 'desktop', clientId: 'desktop:default' })
  await settle()
  // Then
  expect(openedColumns).toEqual([60, 110])
  expect(opened).toEqual(['cockpit', 'cockpit'])
})

test('Given a pane opened in a REPL session, When the desktop attaches, Then the pane keeps its 60 columns', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const openedColumns: (number | undefined)[] = []
  let surfaces: string[] = ['terminal']
  world(on, { openedColumns, isAutoOpen: true })
  on('session.surfaces', () => ({ value: surfaces }))
  on('session.attach', (_, e) => ({ clientId: e.clientId }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await settle()
  // When
  surfaces = ['terminal', 'desktop']
  await $.session.attach({ surface: 'desktop', clientId: 'desktop:default' })
  await settle()
  // Then
  expect(openedColumns).toEqual([60])
})
