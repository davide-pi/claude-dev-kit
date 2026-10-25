import { expect, test } from 'claude-code/testing'

import { TABS, TAB_ICONS } from '../hooks/session'
import { setLang } from '../hooks/strings'
import {
  IT_FILE,
  KEEP_DROP,
  NAMES_EN,
  NAMES_IT,
  barLabels,
  mountPane,
  paneRows,
  settleAll,
  spawnAgent,
  spawns,
  tabsAt,
  taskTools,
  todo,
} from './cockpit-fixtures'
import { PANE, world } from './cockpit-world'
import type { World } from './cockpit-world'

test('tab bar: six buttons, Subagents selected by default; a press on Work draws the Work view', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 58)
  const tabs = async () => (await ui.findAll({ type: 'Button' })).filter(b => /^tab:/.test(b.key ?? ''))
  expect((await tabs()).map(b => b.text)).toEqual(LONG_TABS)
  const selected = async () => (await tabs()).filter(b => b.props.variant === 'primary').map(b => b.key)
  expect(await selected()).toEqual(['tab:agents'])
  expect(await ui.find({ type: 'Text', text: /Opus 5\.5/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^SUBAGENTS/ })).toBeDefined()

  await ui.press({ key: 'tab:work' })
  expect(await selected()).toEqual(['tab:work'])
  expect(await ui.find({ type: 'Text', text: /^SUBAGENTS/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Opus 5\.5/ })).toBeDefined() // the header stays on every tab
  expect(await ui.find({ type: 'Text', text: /^CREDITI/ })).toBeUndefined()

  await ui.press({ key: 'tab:agents' })
  expect(await ui.find({ type: 'Text', text: /^SUBAGENTS/ })).toBeDefined()
  await ui.unmount()
})

test('tab labels: Subagents counts the running agents, Work carries a dot when the worklog needs attention', async ($, on) => {
  world(on, { hasWorklog: true })
  spawns(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await spawnAgent($, 'code-reviewer')
  await spawnAgent($, 'implementer')
  const ui = await mountPane($, 80)
  expect((await ui.find({ key: 'tab:agents' }))?.text).toBe(`${TAB_ICONS.agents} Subagents 2`)
  expect((await ui.find({ key: 'tab:work' }))?.text).toBe(`${TAB_ICONS.work} ●`)
  expect((await ui.find({ key: 'tab:system' }))?.text).toBe(TAB_ICONS.system)
  await ui.unmount()
})

test('tab labels without agents or warnings carry no badge', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 58)
  expect((await ui.findAll({ type: 'Button' })).filter(b => /^tab:/.test(b.key ?? '')).map(b => b.text)).toEqual(LONG_TABS)
  await ui.unmount()
})

// ── Buttons row: compact and log hours, the last row of every tab ──

test('buttons row: compact compacts with the instructions, log hours submits the /worklog of this chat', async ($, on) => {
  const calls: string[] = []
  const instructions: (string | undefined)[] = []
  const commands: string[] = []
  world(on, { calls, instructions, commands, branch: 'feature/1234-orders' })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ key: 'bar:compact' }))?.text).toBe('compact')
  expect((await ui.find({ key: 'bar:worklog' }))?.text).toBe('log hours')
  // the quick row's buttons are gone
  for (const key of ['quick:compact', 'quick:worklog', 'quick:branch']) expect(await ui.find({ key })).toBeUndefined()

  await ui.press({ key: 'bar:compact' })
  expect(calls).toEqual(['compact'])
  expect(instructions).toEqual([KEEP_DROP])
  expect(commands).toEqual([])
  await ui.press({ key: 'bar:worklog' })
  expect(commands).toEqual(['/worklog oggi sessione s-1'])
  expect(calls).toEqual(['compact'])
  await ui.unmount()
})

// log hours logs the hours of THIS chat, whatever the branch: the button is there whenever the session has an id
for (const [name, options] of [
  ['a feature branch', { branch: 'feature/orders-filter' }],
  ['a branch with a work item id', { branch: 'feature/AB#512-reports' }],
  ['the default branch', { branch: 'main' }],
  ['a detached HEAD', { detached: true }],
  ['no git', { notRepo: true }],
] as const) {
  test(`buttons row: log hours on ${name} runs /worklog oggi sessione with the id of this chat`, async ($, on) => {
    const commands: string[] = []
    world(on, { commands, sessionId: () => 'chat-7', ...options })
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    await settleAll()
    const ui = await mountPane($)
    expect((await ui.find({ key: 'bar:worklog' }))?.text).toBe('log hours')
    expect((await ui.find({ key: 'bar:compact' }))?.text).toBe('compact')
    await ui.press({ key: 'bar:worklog' })
    await ui.unmount()
    expect(commands).toEqual(['/worklog oggi sessione chat-7'])
  })
}

test('buttons row: between two sessions (no id) log hours is not offered; compact stays', async ($, on) => {
  world(on)
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.end({ reason: 'clear', sessionId: 's-1', resume: { id: 's-1' } })
  const ui = await mountPane($)
  expect(await ui.find({ key: 'bar:worklog' })).toBeUndefined()
  expect(await ui.find({ key: 'bar:compact' })).toBeDefined()
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

test('buttons row: the very last row of every tab', async ($, on) => {
  world(on, { hasWorklog: true })
  taskTools(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'TodoWrite', todos: [todo('Uno', 'pending')] })
  for (const tab of TABS) {
    const { root, rows } = await paneRows($, 50, tab)
    expect(lastRowKeys(root)).toEqual(['bar:compact', 'bar:worklog'])
    // a rule sets it apart from the tab's content
    expect(rows.at(-2)).toMatch(/^─+$/)
  }
})

/** The `flexWrap` of the Box that holds the Button keyed `key`. */
const wrapAround = (root: unknown, key: string): string | undefined => {
  const o = root as { type?: string; props?: { flexWrap?: string }; children?: { props?: { key?: string } }[] } | null
  if (o?.type === 'Box' && (o.children ?? []).some(c => c?.props?.key === key)) return o.props?.flexWrap
  for (const c of o?.children ?? []) {
    const found = wrapAround(c, key)
    if (found !== undefined) return found
  }
  return undefined
}

const LONG_TABS = barLabels('agents')

/** The text of the hover tooltips the tab bar draws: the Boxes drawn `display: none` that a hover reveals. */
const tooltips = (root: unknown): { text: string; isAbsolute: boolean }[] => {
  const o = root as { type?: string; props?: { display?: string; position?: string }; hover?: { display?: string }; children?: unknown[]; text?: string } | string | null
  if (typeof o !== 'object' || o === null) return []
  const text = (el: unknown): string => (typeof el === 'string' ? el : ((el as { text?: string; children?: unknown[] }).text ?? ((el as { children?: unknown[] }).children ?? []).map(text).join('')))
  if (o.type === 'Box' && o.props?.display === 'none' && o.hover?.display === 'flex') return [{ text: text(o), isAbsolute: o.props.position === 'absolute' }]
  return (o.children ?? []).flatMap(tooltips)
}

test('tab bar: an icon per tab and the name on the selected one only, at 40, 58 and 80 columns; the bar wraps rather than overflow', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  for (const columns of [40, 58, 80]) {
    const { labels, cells, root } = await tabsAt($, columns)
    expect(labels).toEqual(barLabels('agents'))
    expect(wrapAround(root, 'tip:agents')).toBe('wrap')
    // a button never needs more than the content's width; the bar is one row where all of them fit
    expect(Math.max(...labels.map(l => [...l].length + 4))).toBeLessThanOrEqual(columns - 2)
    if (columns >= 58) expect(cells).toBeLessThanOrEqual(Math.min(columns, 60) - 2)
  }
  const ui = await mountPane($, 58)
  await ui.press({ key: 'tab:insights' })
  expect((await ui.findAll({ type: 'Button' })).filter(b => /^tab:/.test(b.key ?? '')).map(b => b.text)).toEqual(barLabels('insights'))
  await ui.unmount()
})

test('tab bar: a running agent and a worklog day add their badge to the tab, selected or not', async ($, on) => {
  world(on, { hasWorklog: true })
  spawns(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await spawnAgent($, 'code-reviewer')
  for (const columns of [40, 58]) expect((await tabsAt($, columns)).labels).toEqual(barLabels('agents', { agents: ' 1', work: ' ●' }))
  const ui = await mountPane($, 58)
  await ui.press({ key: 'tab:work' })
  expect((await ui.findAll({ type: 'Button' })).filter(b => /^tab:/.test(b.key ?? '')).map(b => b.text)).toEqual(barLabels('work', { agents: ' 1', work: ' ●' }))
  await ui.unmount()
})

test('tab bar: every tab has a hover tooltip with its name, in both languages, placed inside the pane', async ($, on) => {
  const options: World = {}
  world(on, options)
  try {
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    const names = (await tabsAt($, 58)).root
    expect(tooltips(names).map(t => t.text)).toEqual(TABS.map(tab => ` ${NAMES_EN[tab]} `))
    expect(tooltips(names).every(t => t.isAbsolute)).toBe(true)
    options.files = IT_FILE
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    expect(tooltips((await tabsAt($, 58)).root).map(t => t.text)).toEqual(TABS.map(tab => ` ${NAMES_IT[tab]} `))
  } finally {
    setLang('en')
  }
})

/** The `flexDirection` of the Box that holds the Button keyed `key`. */
const directionAround = (root: unknown, key: string): string | undefined => {
  const o = root as { type?: string; props?: { flexDirection?: string }; children?: { props?: { key?: string } }[] } | null
  if (o?.type === 'Box' && (o.children ?? []).some(c => c?.props?.key === key)) return o.props?.flexDirection
  for (const c of o?.children ?? []) {
    const found = directionAround(c, key)
    if (found !== undefined) return found
  }
  return undefined
}

test('buttons row: side by side, and the row fits 40 columns', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  // compact + log hours: 12 + 13 cells and one gap
  for (const columns of [60, 50, 40]) expect(directionAround((await paneRows($, columns)).root, 'bar:compact')).toBe('row')
  const ui = await mountPane($, 40)
  const labels = (await ui.findAll({ type: 'Button' })).filter(b => (b.key ?? '').startsWith('bar:')).map(b => b.text ?? '')
  await ui.unmount()
  expect(labels.reduce((n, l) => n + [...l].length + 4, 0) + labels.length - 1).toBeLessThanOrEqual(40)
})

test('buttons: compact and log hours close the pane height, whatever the tab: a column box of bodyRows with a growing spacer', async ($, on) => {
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
  // a short tab in a tall pane, and a tall tab (the header alone is taller than 5 rows) in a short one
  // every tab in a tall pane, and the tallest one in a short one
  for (const [bodyRows, tab] of [...TABS.map(t => [30, t] as const), [5, 'work'] as const]) {
    const root = await mountAt(bodyRows, tab)
    expect(root.props?.flexDirection).toBe('column')
    expect(root.props?.minHeight).toBe(bodyRows)
    const kids = root.children ?? []
    expect(kids.at(-3)?.type).toBe('Box')
    expect(kids.at(-3)?.props?.flexGrow).toBe(1) // the spacer
    expect(lastRowKeys(root)).toEqual(['bar:compact', 'bar:worklog'])
  }
})

test('tabs: exactly Subagents, Context, Work, Insights, System, Notes, Subagents selected by default; System draws its own section', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 58)
  const tabs = (await ui.findAll({ type: 'Button' })).filter(b => /^tab:/.test(b.key ?? ''))
  expect(tabs.map(b => b.key)).toEqual(['tab:agents', 'tab:context', 'tab:work', 'tab:insights', 'tab:system', 'tab:notes'])
  expect(tabs.map(b => b.text)).toEqual(LONG_TABS)
  expect(tabs.filter(b => b.props.variant === 'primary').map(b => b.key)).toEqual(['tab:agents'])
  expect(await ui.find({ type: 'Text', text: /^SUBAGENTS/ })).toBeDefined()
  await ui.press({ key: 'tab:system' })
  expect(await ui.find({ type: 'Text', text: /^SYSTEM$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^in arrivo$/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^SUBAGENTS/ })).toBeUndefined()
  await ui.unmount()
})
