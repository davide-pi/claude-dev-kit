import { expect, test } from 'claude-code/testing'

import { TAB_ICONS } from '../hooks/session'
import { textCells } from '../hooks/shared'
import { setLang } from '../hooks/strings'
import { FULL_LINE, IT_FILE, MIN, NAMES_IT, barLabels, fakeMonitor, mountPane, paneRows, sistemaRows, tabsAt } from './cockpit-fixtures'
import { iso, rowTexts, world } from './cockpit-world'
import type { World } from './cockpit-world'

test('English: the tabs, the buttons, the empty state and the titles of every tab are English', async ($, on) => {
  world(on, { notRepo: true })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 58)
  const label = async (key: string) => (await ui.find({ key }))?.text
  expect([await label('tab:agents'), await label('tab:context'), await label('tab:work'), await label('tab:system'), await label('bar:compact'), await label('bar:worklog')]).toEqual([`${TAB_ICONS.agents} Subagents`, TAB_ICONS.context, TAB_ICONS.work, TAB_ICONS.system, 'compact', 'log hours'])
  expect(rowTexts(await ui.drawn()).some(r => r.startsWith('SUBAGENTS · 0 running'))).toBe(true)
  await ui.press({ key: 'tab:work' })
  expect(rowTexts(await ui.drawn())).toContain('nothing to show')
  await ui.unmount()
  const narrow = await mountPane($, 40)
  expect([(await narrow.find({ key: 'tab:agents' }))?.text, (await narrow.find({ key: 'tab:context' }))?.text, (await narrow.find({ key: 'tab:work' }))?.text, (await narrow.find({ key: 'tab:system' }))?.text]).toEqual([TAB_ICONS.agents, TAB_ICONS.context, `${TAB_ICONS.work} Work`, TAB_ICONS.system])
  await narrow.unmount()
})

test('language: cockpit.json names it; a missing, unreadable, malformed or unknown one is English, and every session start reads it again', async ($, on) => {
  const options: World = { files: IT_FILE }
  world(on, options)
  const tabs = async () => (await tabsAt($, 58)).labels
  const start = () => $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const italian = barLabels('agents', {}, NAMES_IT)
  const english = barLabels('agents')
  try {
    await start()
    expect(await tabs()).toEqual(italian)

    options.files = { 'cockpit.json': '{"lang":"fr"}' }
    await start()
    expect(await tabs()).toEqual(english)

    options.files = IT_FILE
    await start()
    expect(await tabs()).toEqual(italian)
    options.files = {}
    options.unreadable = ['cockpit.json']
    await start()
    expect(await tabs()).toEqual(english)

    options.files = IT_FILE
    options.unreadable = undefined
    await start()
    expect(await tabs()).toEqual(italian)
    options.files = { 'cockpit.json': '{ "lang": ' }
    await start()
    expect(await tabs()).toEqual(english)
  } finally {
    setLang('en')
  }
})

test('language: a pane that draws before any session start (a mod enabled mid-session) reads cockpit.json once', async ($, on) => {
  const options: World = { files: IT_FILE }
  const clock = world(on, options)
  try {
    expect((await tabsAt($, 58)).labels).toEqual(barLabels('agents', {}, NAMES_IT))
    // read once: a change of the file is for the next session start
    options.files = {}
    await clock.advance(10) // the first drawing marked the language as read
    expect((await tabsAt($, 58)).labels).toEqual(barLabels('agents', {}, NAMES_IT))
  } finally {
    setLang('en')
  }
})

test('language: the toasts are in the language of the pane', async ($, on) => {
  const toasts: string[] = []
  world(on, { toasts, files: IT_FILE })
  on('session.measure', (_, e) => ({ changed: e.changed }))
  try {
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    await $.session.measure({ context: { window: 1_000_000, tokens: 850_000, percent: 85 }, rateLimits: [], cost: { usd: 5 }, changed: ['context'] })
    expect(toasts).toEqual(["contesto all'85%"])
  } finally {
    setLang('en')
  }
})

type TitleBox = { props?: { justifyContent?: string; flexDirection?: string }; children?: unknown[] }

/** The space-between Box of the title row whose text matches `re`. */
const titleBox = (el: unknown, re: RegExp): TitleBox | undefined => {
  const o = el as TitleBox | string | null
  if (o === null || typeof o === 'string') return undefined
  if (o.props?.justifyContent === 'space-between' && re.test(rowTexts({ children: [o] })[0] ?? '')) return o
  return (o.children ?? []).flatMap(c => titleBox(c, re) ?? [])[0]
}

test('Italian: the process header, the pace title and the trend title are translated, and the title rows fit 40 and 58 columns', async ($, on) => {
  const options: World = {
    files: IT_FILE,
    rateLimits: [
      { kind: 'five_hour', percentUsed: 62, resetsAt: iso(2 * 60 * MIN) },
      { kind: 'seven_day', percentUsed: 41, resetsAt: iso(2 * 24 * 60 * MIN) },
    ],
  }
  const m = fakeMonitor(on)
  world(on, options)
  try {
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    for (const columns of [40, 58]) {
      const width = Math.min(columns, 60) - 2
      const { root, rows } = await paneRows($, columns)
      // the pace sits right of the title, or under it where the pane is too narrow for both
      const row = rows.find(r => /^CREDITI RESIDUI/.test(r)) ?? ''
      expect(row).toMatch(/rispetto all'atteso 7d/)
      expect(titleBox(root, /^CREDITI RESIDUI/)?.props?.flexDirection).toBe(textCells(row) + 1 <= width ? 'row' : 'column')
      expect(textCells(row) + 1 <= width).toBe(columns === 58)
    }
    const system = await sistemaRows($, m, [FULL_LINE], 40)
    expect(system.some(r => /^ +PID NOME +CPU +RAM▾ PORTE$/.test(r))).toBe(true)
  } finally {
    setLang('en')
  }
})
