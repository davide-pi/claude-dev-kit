import { expect, test } from 'claude-code/testing'

import { TABS } from '../hooks/session'
import { KEEP_DROP, barLabels, mountPane, paneRows, settleAll, spawnAgent, spawns, tabsAt, until } from './cockpit-fixtures'
import { PANE, rowTexts, world } from './cockpit-world'
import type { World } from './cockpit-world'

const tabButtons = async (ui: Awaited<ReturnType<typeof mountPane>>) => (await ui.findAll({ type: 'Button' })).filter(b => /^tab:/.test(b.key ?? ''))

test('tab bar: six text buttons in order, Ora selected by default; a press on Lavoro draws only the Lavoro view', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 58)
  expect((await tabButtons(ui)).map(b => b.key)).toEqual(['tab:agents', 'tab:signals', 'tab:history', 'tab:context', 'tab:work', 'tab:notes'])
  expect((await tabButtons(ui)).map(b => b.text)).toEqual(['Ora', 'Segnali', 'Cronologia', 'Costi', 'Lavoro', 'Note'])
  const selected = async () => (await tabButtons(ui)).filter(b => b.props.variant === 'primary').map(b => b.key)
  expect(await selected()).toEqual(['tab:agents'])
  expect(await ui.find({ type: 'Text', text: /Opus 5\.5/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^SUBAGENTS/ })).toBeDefined()

  await ui.press({ key: 'tab:work' })
  expect(await selected()).toEqual(['tab:work'])
  expect(await ui.find({ type: 'Text', text: /^SUBAGENTS/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^PROCESSI E PORTE/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Opus 5\.5/ })).toBeDefined() // the header stays on every tab

  await ui.press({ key: 'tab:signals' })
  expect(await ui.find({ type: 'Text', text: /^PROCESSI E PORTE/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^SEGNALI · 0/ })).toBeDefined()
  await ui.unmount()
})

test('tab labels: Ora counts the running agents, Lavoro carries a dot when the worklog needs attention', async ($, on) => {
  world(on, { hasWorklog: true })
  spawns(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await spawnAgent($, 'code-reviewer')
  await spawnAgent($, 'implementer')
  const ui = await mountPane($, 80)
  expect((await ui.find({ key: 'tab:agents' }))?.text).toBe('Ora 2')
  expect((await ui.find({ key: 'tab:work' }))?.text).toBe('Lavoro ●')
  expect((await ui.find({ key: 'tab:history' }))?.text).toBe('Cronologia')
  await ui.unmount()
})

test('tab bar: the labels fit at 40, 58 and 80 columns and the bar wraps rather than overflows', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  for (const columns of [40, 58, 80]) {
    const { labels } = await tabsAt($, columns)
    expect(labels).toEqual(barLabels())
    expect(Math.max(...labels.map(l => [...l].length + 4))).toBeLessThanOrEqual(columns - 2)
  }
})

// ── Footer: compact, analizza suite, copia riepilogo: the last row of every tab ──

test('footer: compact compacts with the instructions and sends nothing else', async ($, on) => {
  const calls: string[] = []
  const instructions: (string | undefined)[] = []
  const commands: string[] = []
  world(on, { calls, instructions, commands })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ key: 'bar:compact' }))?.text).toBe('compact')
  expect((await ui.find({ key: 'bar:suite' }))?.text).toBe('analizza suite')
  expect((await ui.find({ key: 'bar:summary' }))?.text).toBe('copia riepilogo')
  expect(await ui.find({ key: 'bar:worklog' })).toBeUndefined() // log hours lives in Lavoro only
  await ui.press({ key: 'bar:compact' })
  expect(calls).toEqual(['compact'])
  expect(instructions).toEqual([KEEP_DROP])
  expect(commands).toEqual([])
  await ui.unmount()
})

test('footer: analizza suite asks first; yes sends /retro, no sends nothing', async ($, on) => {
  const commands: string[] = []
  world(on, { commands })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 58)
  await ui.press({ key: 'bar:suite' })
  expect(rowTexts(await ui.drawn()).some(r => /analizzare la suite/.test(r))).toBe(true)
  expect(await ui.find({ key: 'bar:suite' })).toBeUndefined()
  expect(commands).toEqual([])

  await ui.press({ key: 'confirm:no' })
  expect(commands).toEqual([])
  expect(await ui.find({ key: 'bar:suite' })).toBeDefined()

  await ui.press({ key: 'bar:suite' })
  await ui.press({ key: 'confirm:yes' })
  await until(() => commands.length > 0)
  expect(commands).toEqual(['/retro'])
  expect(await ui.find({ key: 'bar:suite' })).toBeDefined()
  await ui.unmount()
})

test('footer: copia riepilogo appends the session cost summary to the prompt box, with no command and no model call', async ($, on) => {
  const fills: { text: string; mode?: string }[] = []
  const commands: string[] = []
  const toasts: string[] = []
  const calls: string[] = []
  world(on, { fills, commands, toasts, calls, promptText: 'already typed' })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 58)
  await ui.press({ key: 'bar:summary' })
  await until(() => fills.length > 0)
  expect(fills).toHaveLength(1)
  expect(fills[0]?.mode).toBe('append')
  expect(fills[0]?.text).toMatch(/^\nRiepilogo sessione\n/)
  expect(fills[0]?.text).toMatch(/\$4\.82/)
  expect(commands).toEqual([])
  expect(calls).toEqual([])
  expect(toasts).toHaveLength(1)
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
    expect(lastRowKeys(root)).toEqual(['bar:compact', 'bar:suite', 'bar:summary'])
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
    expect(lastRowKeys(root)).toEqual(['bar:compact', 'bar:suite', 'bar:summary'])
  }
})

// ── Lavoro: log hours behind a confirmation ──

for (const [name, options] of [
  ['a feature branch', { branch: 'feature/orders-filter' }],
  ['the default branch', { branch: 'main' }],
  ['no git', { notRepo: true }],
] as const) {
  test(`Lavoro: log hours on ${name} asks first, then runs /worklog oggi sessione with the id of this chat`, async ($, on) => {
    const commands: string[] = []
    const w: World = { commands, sessionId: () => 'chat-7', ...options }
    world(on, w)
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    await settleAll()
    const ui = await mountPane($)
    expect(await ui.find({ key: 'bar:worklog' })).toBeUndefined() // not on Ora
    await ui.press({ key: 'tab:work' })
    expect((await ui.find({ key: 'bar:worklog' }))?.text).toBe('log hours')
    await ui.press({ key: 'bar:worklog' })
    expect(commands).toEqual([])
    expect(rowTexts(await ui.drawn()).some(r => /registrare le ore/.test(r))).toBe(true)
    await ui.press({ key: 'confirm:no' })
    expect(commands).toEqual([])
    await ui.press({ key: 'bar:worklog' })
    await ui.press({ key: 'confirm:yes' })
    await until(() => commands.length > 0)
    await ui.unmount()
    expect(commands).toEqual(['/worklog oggi sessione chat-7'])
  })
}

test('Lavoro: between two sessions (no id) log hours is not offered', async ($, on) => {
  world(on)
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.end({ reason: 'clear', sessionId: 's-1', resume: { id: 's-1' } })
  const ui = await mountPane($)
  await ui.press({ key: 'tab:work' })
  expect(await ui.find({ key: 'bar:worklog' })).toBeUndefined()
  await ui.unmount()
})
