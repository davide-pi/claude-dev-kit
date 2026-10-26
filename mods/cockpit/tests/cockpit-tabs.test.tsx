import { expect, test } from 'claude-code/testing'

import { TABS } from '../hooks/session'
import { textCells } from '../hooks/shared'
import { setLang, t } from '../hooks/strings'
import { tabBarLabels } from '../hooks/view'
import { KEEP_DROP, barLabels, mountPane, paneRows, settleAll, spawnAgent, spawns, tabsAt, until } from './cockpit-fixtures'
import { PANE, rowTexts, world } from './cockpit-world'
import type { World } from './cockpit-world'

const tabButtons = async (ui: Awaited<ReturnType<typeof mountPane>>) => (await ui.findAll({ type: 'Button' })).filter(b => /^tab:/.test(b.key ?? ''))

test('tab bar: five text buttons in order, Agents selected by default; a press on Work draws only the Work view', async ($, on) => {
  world(on, { sessionId: () => 'chat-7' })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 58)
  expect((await tabButtons(ui)).map(b => b.key)).toEqual(['tab:agents', 'tab:context', 'tab:signals', 'tab:work', 'tab:notes'])
  expect((await tabButtons(ui)).map(b => b.text)).toEqual(['Agents', 'Ctx', 'Notifications', 'Work', 'Notes'])
  const selected = async () => (await tabButtons(ui)).filter(b => b.props.variant === 'primary').map(b => b.key)
  expect(await selected()).toEqual(['tab:agents'])
  expect(await ui.find({ type: 'Text', text: /Opus 5\.5/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^SUBAGENTS/ })).toBeDefined()

  await ui.press({ key: 'tab:work' })
  expect(await selected()).toEqual(['tab:work'])
  expect(await ui.find({ type: 'Text', text: /^SUBAGENTS/ })).toBeUndefined()
  expect((await ui.find({ key: 'bar:worklog' }))?.text).toBe('log hours') // in the footer, on every tab
  expect(await ui.find({ type: 'Text', text: /Opus 5\.5/ })).toBeDefined() // the header stays on every tab

  await ui.press({ key: 'tab:signals' })
  expect((await ui.find({ key: 'bar:worklog' }))?.text).toBe('log hours')
  expect(await ui.find({ type: 'Text', text: /^no notifications/ })).toBeDefined()
  await ui.unmount()
})

test('tab labels: Agents counts the running agents, Work carries a dot when the worklog needs attention', async ($, on) => {
  world(on, { hasWorklog: true })
  spawns(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await spawnAgent($, 'code-reviewer')
  await spawnAgent($, 'implementer')
  const ui = await mountPane($, 80)
  expect((await ui.find({ key: 'tab:agents' }))?.text).toBe('Agents 2')
  expect((await ui.find({ key: 'tab:work' }))?.text).toBe('Work ●')
  expect((await ui.find({ key: 'tab:signals' }))?.text).toBe('Notif')
  await ui.unmount()
})

test('tab bar: the labels fit one row at 40, 58 and 80 columns', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  for (const columns of [58, 80]) {
    const { labels, cells } = await tabsAt($, columns)
    expect(labels).toEqual(barLabels())
    expect(cells).toBeLessThanOrEqual(Math.min(columns, 60) - 2)
  }
  // too narrow for the five names: the selected tab is whole, the others are 3 cells
  const narrow = await tabsAt($, 40)
  expect(narrow.labels).toEqual(['Agents', 'Ctx', 'Not', 'Wor', 'Not'])
})

// ── Footer: compact, retrospective, log hours: the last row of every tab ──

test('footer: compact compacts with the instructions and sends nothing else', async ($, on) => {
  const calls: string[] = []
  const instructions: (string | undefined)[] = []
  const commands: string[] = []
  world(on, { calls, instructions, commands })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ key: 'bar:compact' }))?.text).toBe('compact')
  expect((await ui.find({ key: 'bar:retro' }))?.text).toBe('retrospective')
  expect((await ui.find({ key: 'bar:worklog' }))?.text).toBe('log hours')
  expect(await ui.find({ key: 'bar:summary' })).toBeUndefined()
  await ui.press({ key: 'bar:compact' })
  expect(calls).toEqual(['compact'])
  expect(instructions).toEqual([KEEP_DROP])
  expect(commands).toEqual([])
  await ui.unmount()
})

test('footer: retrospective asks which one; the last 10 days sends /retro days 10, this session /retro, no sends nothing', async ($, on) => {
  const commands: string[] = []
  world(on, { commands })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 58)
  await ui.press({ key: 'bar:retro' })
  expect(rowTexts(await ui.drawn()).some(r => /which retrospective/.test(r))).toBe(true)
  expect((await ui.find({ key: 'confirm:days' }))?.text).toBe('last 10 days')
  expect((await ui.find({ key: 'confirm:session' }))?.text).toBe('this session')
  expect(await ui.find({ key: 'bar:retro' })).toBeUndefined()
  expect(commands).toEqual([])

  await ui.press({ key: 'confirm:no' })
  expect(commands).toEqual([])
  expect(await ui.find({ key: 'bar:retro' })).toBeDefined()

  await ui.press({ key: 'bar:retro' })
  await ui.press({ key: 'confirm:days' })
  await until(() => commands.length > 0)
  expect(commands).toEqual(['/retro days 10'])
  expect(await ui.find({ key: 'bar:retro' })).toBeDefined()

  await ui.press({ key: 'bar:retro' })
  await ui.press({ key: 'confirm:session' })
  await until(() => commands.length > 1)
  expect(commands).toEqual(['/retro days 10', '/retro'])
  await ui.unmount()
})

/** The keys of the Buttons in the last row of the drawn pane. */
const lastRowKeys = (root: unknown): string[] => {
  const keys = (el: unknown): string[] => {
    const o = el as { props?: { key?: string }; type?: string; children?: unknown[] } | null
    const own = o?.type === 'Button' && o.props?.key ? [o.props.key] : []
    return [...own, ...(o?.children ?? []).flatMap(keys)]
  }
  return keys(((root as { children?: unknown[] }).children ?? []).at(-1))
}

test('footer: the very last row of every tab, set apart by a rule', async ($, on) => {
  world(on, { hasWorklog: true })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  for (const tab of TABS) {
    const { root, rows } = await paneRows($, 50, tab)
    expect(lastRowKeys(root)).toEqual(['bar:compact', 'bar:retro', 'bar:worklog'])
    expect(rows.at(-2)).toMatch(/^─+$/)
  }
})

test('footer: the buttons close the pane height, whatever the tab: a column box of bodyRows with a growing spacer', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  type Node = { type?: string; props?: { flexGrow?: number; minHeight?: number; flexDirection?: string }; children?: Node[] }
  const mountAt = async (bodyRows: number, tab: string) => {
    const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, scroll: { offset: 0, bodyRows } }, surface: 'terminal' })
    await ui.press({ key: `tab:${tab}` })
    const root = (await ui.drawn()) as Node
    await ui.unmount()
    return root
  }
  for (const [bodyRows, tab] of [...TABS.map(t => [30, t] as const), [5, 'work'] as const]) {
    const root = await mountAt(bodyRows, tab)
    expect(root.props?.flexDirection).toBe('column')
    expect(root.props?.minHeight).toBe(bodyRows)
    const kids = root.children ?? []
    expect(kids.at(-3)?.type).toBe('Box')
    expect(kids.at(-3)?.props?.flexGrow).toBe(1)
    expect(lastRowKeys(root)).toEqual(['bar:compact', 'bar:retro', 'bar:worklog'])
  }
})

// ── Footer: log hours behind a confirmation ──

for (const [name, options] of [
  ['a feature branch', { branch: 'feature/orders-filter' }],
  ['the default branch', { branch: 'main' }],
  ['no git', { notRepo: true }],
] as const) {
  test(`footer: log hours on ${name} asks which hours, then runs /worklog oggi sessione with the id of this chat, or /worklog oggi`, async ($, on) => {
    const commands: string[] = []
    const w: World = { commands, sessionId: () => 'chat-7', ...options }
    world(on, w)
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    await settleAll()
    const ui = await mountPane($)
    expect((await ui.find({ key: 'bar:worklog' }))?.text).toBe('log hours')
    await ui.press({ key: 'bar:worklog' })
    expect(commands).toEqual([])
    expect(rowTexts(await ui.drawn()).some(r => /which hours\? sends \/worklog/.test(r))).toBe(true)
    expect([(await ui.find({ key: 'confirm:chat' }))?.text, (await ui.find({ key: 'confirm:day' }))?.text]).toEqual(['this chat', 'today'])
    await ui.press({ key: 'confirm:no' })
    expect(commands).toEqual([])
    expect(await ui.find({ key: 'confirm:chat' })).toBeUndefined()
    await ui.press({ key: 'bar:worklog' })
    await ui.press({ key: 'confirm:chat' })
    await until(() => commands.length > 0)
    expect(commands).toEqual(['/worklog oggi sessione chat-7'])
    await ui.press({ key: 'bar:worklog' })
    await ui.press({ key: 'confirm:day' })
    await until(() => commands.length > 1)
    await ui.unmount()
    expect(commands).toEqual(['/worklog oggi sessione chat-7', '/worklog oggi'])
  })
}

test('footer: between two sessions (no id) log hours is not offered', async ($, on) => {
  world(on)
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.end({ reason: 'clear', sessionId: 's-1', resume: { id: 's-1' } })
  const ui = await mountPane($)
  expect(await ui.find({ key: 'bar:worklog' })).toBeUndefined()
  await ui.unmount()
})

test('tab bar: one row at every width: full labels, then short ones (the selected tab stays full), then 3 cells; counters read 9+ past 9', () => {
  const counts = { agents: 12, signals: 3 }
  const cells = (labels: Record<string, string>, dot: boolean) => TABS.reduce((n, id) => n + textCells(labels[id] ?? '') + 4 + (id === 'work' && dot ? 2 : 0), 0) + TABS.length - 1
  for (const lang of ['en', 'it'] as const) {
    setLang(lang)
    for (const active of TABS) {
      for (const width of [30, 38, 40, 48, 56, 58, 60, 80]) {
        const labels = tabBarLabels(active, counts, { work: true }, width)
        // a width that cannot hold even the shortest labels is the only one allowed to overflow
        const shortest = tabBarLabels(active, counts, { work: true }, 0)
        if (cells(shortest, true) <= width) expect([lang, active, width, cells(labels, true) <= width]).toEqual([lang, active, width, true])
        expect(labels.agents).toMatch(/ 9\+$/)
        expect(labels.signals).toMatch(/ 3$/)
      }
    }
    // roomy: every tab full; tight: the selected tab full and the others short
    expect(tabBarLabels('work', {}, {}, 200).signals).toBe(t().tabs.signals)
    const tight = tabBarLabels('context', counts, {}, 56)
    expect(tight.context).toBe(t().tabs.context)
    expect(tight.signals).toBe(`${t().tabsShort.signals} 3`)
  }
  setLang('en')
})
