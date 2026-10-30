import { expect, test } from 'claude-code/testing'

import { textCells } from '../hooks/shared'
import { MIN, SPAWN, mountPane, paneRows, spawnAgent, spawns } from './cockpit-fixtures'
import { NOW, rowTexts, world } from './cockpit-world'

// ── Phase 9: Subagents rows are one cut line each ──

test('Subagents: every row is one line cut to the width, at 40, 58 and 80 columns: the agent row with its fixed columns, then (expanded) the description, the warning and the tool', async ($, on) => {
  const clock = world(on, { listed: [{ id: 'a1', status: 'running' }] })
  spawns(on)
  on('tool.call', { tool: 'Grep' }, () => ({ result: {} }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.agent.spawn({ ...SPAWN, subagentType: 'a-code-reviewer-with-a-very-long-name-that-cannot-fit-a-row', description: 'Review the orders filter and every test around it, then report back', model: 'fable' })
  await $.tool.call({ tool: 'Grep', pattern: 'Order', agentId: 'a1' })
  await clock.advance(2 * MIN)
  for (const columns of [40, 58, 80]) {
    const width = Math.min(columns, 60) - 2
    const ui = await mountPane($, columns)
    await ui.press({ key: 'tab:agents' })
    const body = async () => {
      const rows = rowTexts(await ui.drawn())
      return rows.slice(rows.findIndex(r => r.startsWith('SUBAGENTS'))).filter(r => !/^─+$/.test(r))
    }
    // collapsed: the agent is exactly one row, as wide as the pane: the name cut with …, the model, effort, share and time in fixed columns
    const collapsed = await body()
    const row = collapsed.filter(r => /^󱎖 a-co/.test(r))
    expect(row).toHaveLength(1)
    expect(textCells(row[0] ?? '')).toBe(width)
    // no usage read yet: the cost cell stays blank, never a made-up $0.00
    expect(row[0]).toMatch(/^󱎖 a-co[^ ]*… [^$]* +02m00s$/)
    expect(collapsed.some(r => /Review the orders|last tool|󰀦/.test(r))).toBe(false)

    // expanded: every row of the block is one line, none wider than the pane
    await ui.press({ key: 'agent:a1' })
    const expanded = await body()
    expect(expanded.length).toBeGreaterThan(collapsed.length + 2)
    for (const r of expanded) expect(textCells(r)).toBeLessThanOrEqual(width)
    // the description wraps instead of being cut: no expanded row ends in …, and the whole text is there
    expect(expanded.filter(r => /^ /.test(r)).some(r => /…$/.test(r))).toBe(false)
    expect(expanded.filter(r => /^ /.test(r)).map(r => r.trim()).join(' ')).toContain('Review the orders filter and every test around it, then report back')
    expect(expanded.filter(r => !/^󱎖 a-co/.test(r)).some(r => /son 5\.5/.test(r))).toBe(false) // no facts row: the model, effort and time are in the agent row
    expect(expanded.some(r => /^ +󰀦 asked fable/.test(r))).toBe(true)
    expect(expanded.some(r => /^ +last tool Grep$/.test(r))).toBe(true)

    // every pressable row of the tab is one truncating Text
    const rowsOfAgent = (n: unknown): unknown[] => {
      const o = n as { type?: string; props?: { key?: string; wrap?: string }; children?: unknown[] } | null
      return o?.type === 'Button' && o.props?.key === 'agent:a1' ? (o.children ?? []) : (o?.children ?? []).flatMap(rowsOfAgent)
    }
    const inner = rowsOfAgent(await ui.drawn())[0] as { type?: string; props?: { wrap?: string } } | undefined
    expect(inner?.type).toBe('Text')
    expect(inner?.props?.wrap).toBe('truncate')
    await ui.press({ key: 'agent:a1' })
    await ui.unmount()
  }
})

test('Subagents: a description with line breaks stays on its one row, under the expanded agent', async ($, on) => {
  const clock = world(on, { listed: [{ id: 'a1', status: 'running' }] })
  spawns(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.agent.spawn({ ...SPAWN, subagentType: 'reviewer', description: 'Review the filter\r\n\n  then report', model: 'fable' })
  await clock.advance(MIN)
  const ui = await mountPane($, 58)
  await ui.press({ key: 'tab:agents' })
  await ui.press({ key: 'agent:a1' })
  const rows = rowTexts(await ui.drawn())
  expect(rows.filter(r => /Review the filter/.test(r))).toEqual(['  Review the filter then report'])
  expect(rows.some(r => /^then report/.test(r.trim()))).toBe(false)
  await ui.unmount()
})

test('Subagents: the history rows are one row each, the name cut by display width (wide characters count two cells), and expand like a live one', async ($, on) => {
  const at = { startedAt: NOW - 60_000, endedAt: NOW - 30_000, tokens: 1234, isFailed: false }
  world(on, { dataFile: JSON.stringify({ history: [{ id: 'h1', type: 'a-reviewer-with-an-extremely-long-name-indeed', ...at }, { id: 'h2', type: '日本語のとても長いレビューアの名前です', ...at }], prs: [] }) })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 40)
  await ui.press({ key: 'tab:agents' })
  const rows = rowTexts(await ui.drawn())
  for (const re of [/^󰄬 a-re/, /^󰄬 日本/]) {
    const row = rows.find(r => re.test(r)) ?? ''
    expect(textCells(row)).toBe(38)
    expect(row).toMatch(/…/)
    expect(row).toMatch(/ +\d+% +00m30s$/)
  }
  await ui.unmount()
})

test('Subagents: every agent of the session is listed, no cap and no … +n, at 40, 58 and 80 columns', async ($, on) => {
  world(on)
  spawns(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  for (let n = 1; n <= 15; n++) await spawnAgent($, `ag${n}`)
  for (const columns of [40, 58, 80]) {
    const { rows } = await paneRows($, columns, 'agents')
    for (let n = 1; n <= 15; n++) expect([n, rows.some(r => r.startsWith(`󱎖 ag${n} `))]).toEqual([n, true])
    expect(rows.some(r => /^… \+\d+$/.test(r))).toBe(false)
  }
})
