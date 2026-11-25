import { expect, test } from 'claude-code/testing'

import { wrapCells } from '../hooks/shared'
import {
  askPerson,
  callAs,
  gatedBash,
  launchWorkflow,
  paneRows,
  permissionChecks,
  settleAll,
  workflowLaunches,
} from './cockpit-fixtures'
import { world } from './cockpit-world'

test('wrapCells: breaks at the space that fits, a word longer than the row is cut, a wide character under a narrow row still advances', () => {
  expect(wrapCells('aaa bbb ccc', 7)).toEqual(['aaa bbb', 'ccc'])
  expect(wrapCells('abcdefgh ij', 4)).toEqual(['abcd', 'efgh', 'ij'])
  expect(wrapCells('漢字', 1)).toEqual(['漢', '字'])
  expect(wrapCells('', 5)).toEqual([])
})

// ── IN PROGRESS: the workflow run in one row ──

test('Given a workflow run open, When the In corso tab is drawn, Then the FLOW title is followed by the run name', { timeoutMs: 30_000 }, async ($, on) => {
  const clock = world(on)
  permissionChecks(on)
  workflowLaunches(on, 'release-notes')
  const release = gatedBash(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await launchWorkflow($, 'release-notes')
  const call = callAs($, 'c1', { tool: 'Bash', command: 'rm x' })
  await settleAll()
  await askPerson($, 'c1')
  await clock.advance(7000)
  await settleAll()
  const { rows } = await paneRows($, 64)
  const run = rows.findIndex(r => /^◆ release-notes/.test(r))
  expect(run).toBeGreaterThan(-1)
  expect(rows.findIndex(r => /^FLOW ─+$/.test(r))).toBeLessThan(run)
  release('rm x')
  await call
})

// ── Context: the breakdown first, then what the session costs ──

// ── Work: links, no processes ──
