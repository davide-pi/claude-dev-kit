import { expect, test } from 'claude-code/testing'

import { mountPane } from './cockpit-fixtures'
import { NOW, rowTexts, world } from './cockpit-world'

const TABS = ['tab:now', 'tab:log', 'tab:analysis']
const round = (n: number) => ({ at: NOW - 100_000 + n * 1000, kind: 'round', n, prompt: `prompt ${n}` })
const flow = (runId: string, lane: number, from: number, to: number) => ({ at: NOW - 50_000, kind: 'flow', key: runId, text: runId, round: from, endRound: to, lane })
const LOG = [round(1), round(2), round(3), flow('alpha', 0, 1, 3), flow('beta', 1, 2, 3)]

async function start($: Parameters<Parameters<typeof test>[1]>[0], on: Parameters<typeof world>[0], columns: number) {
  world(on, { dataFile: JSON.stringify({ history: [], prs: [], sessionLog: LOG }) })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  return mountPane($, columns)
}

test('Given the terminal pane, When it is drawn and the tabs pressed, Then the open tab is primary and each body shows its own section', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const ui = await start($, on, 58)
  const variants = async () => Promise.all(TABS.map(async k => ((await ui.find({ key: k })) as { props?: { variant?: string } } | undefined)?.props?.variant))
  // When
  const first = await variants()
  await ui.press({ key: 'tab:log' })
  const log = await variants()
  const logRows = rowTexts(await ui.drawn())
  await ui.press({ key: 'tab:analysis' })
  const analysisRows = rowTexts(await ui.drawn())
  // Then
  expect(first).toEqual(['primary', 'secondary', 'secondary'])
  expect(log).toEqual(['secondary', 'primary', 'secondary'])
  expect(logRows.some(r => /prompt 2/.test(r))).toBe(true)
  expect(analysisRows.some(r => /^ATTENTION/.test(r))).toBe(true)
  await ui.unmount()
})

for (const columns of [30, 58, 100]) {
  test(`Given two overlapping flows, When the Log tab is drawn at ${columns} columns, Then each row has lane glyphs, a time and its ids, and none is wider than the pane`, { timeoutMs: 30_000 }, async ($, on) => {
    // Given
    const ui = await start($, on, columns)
    // When
    await ui.press({ key: 'tab:log' })
    const rows = rowTexts(await ui.drawn()).map(r => r.trimEnd())
    // Then
    expect(rows.some(r => /^[●│] [●│╭╰] [●│╭╰] .*#2 /.test(r))).toBe(true)
    expect(rows.some(r => /^● .*\d\d:\d\d #3 /.test(r))).toBe(true)
    expect(rows.some(r => /╭/.test(r)) && rows.some(r => /│ ●/.test(r))).toBe(true)
    expect(rows.every(r => [...r].length <= Math.min(columns, 60))).toBe(true)
    await ui.unmount()
  })
}
