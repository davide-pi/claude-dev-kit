import { expect, test } from 'claude-code/testing'

import { textCells } from '../hooks/shared'
import { setLang, t } from '../hooks/strings'
import { IT_FILE, MIN, mountPane, paneRows } from './cockpit-fixtures'
import { flagOf, iso, rowTexts, settle, world } from './cockpit-world'
import type { World } from './cockpit-world'

test('English is the default: the tab labels, the footer and the titles', async ($, on) => {
  world(on, { notRepo: true })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 58)
  const label = async (key: string) => (await ui.find({ key }))?.text
  expect([await label('tab:agents'), await label('tab:context'), await label('tab:signals'), await label('tab:work'), await label('tab:notes'), await label('bar:compact'), await label('bar:retro'), await label('bar:worklog')]).toEqual(['Agents', 'Ctx', 'Notifications', 'Work', 'Notes', 'compact', 'retrospective', 'log hours'])
  expect(rowTexts(await ui.drawn()).some(r => r.startsWith('SUBAGENTS · 0 running'))).toBe(true)
  await ui.unmount()
})

test('both languages draw every tab, with every label of the bundles in both and no key missing', async ($, on) => {
  const options: World = { sessionId: () => 'chat-7', branch: 'feature/AB#512-reports', workspaces: { roots: [{ path: '/', platform: 'azure-devops', org: 'org-a', project: 'Alpha', identity: 'id-a' }] } }
  world(on, options)
  const keys = (o: unknown, prefix = ''): string[] =>
    Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => (v !== null && typeof v === 'object' ? keys(v, prefix + k + '.') : [prefix + k]))
  try {
    setLang('en')
    const named = (k: string) => !k.startsWith('contextCategories.') // the engine's own names stay as they are in English
    const en = keys(t()).filter(named).sort()
    setLang('it')
    expect(keys(t()).filter(named).sort()).toEqual(en)
    for (const [lang, files, tabs] of [
      ['en', {}, ['Agents', 'Context', 'Notifications', 'Work', 'Notes']],
      ['it', IT_FILE, ['Agenti', 'Contesto', 'Notifiche', 'Lavoro', 'Note']],
    ] as const) {
      options.files = files
      await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
      const ui = await mountPane($, 58)
      const ids = ['agents', 'context', 'signals', 'work', 'notes']
      for (const [i, id] of ids.entries()) {
        await ui.press({ key: 'tab:' + id })
        expect((await ui.find({ key: 'tab:' + id }))?.text).toBe(tabs[i]) // the selected tab keeps its full name
        const drawn = rowTexts(await ui.drawn()).join('\n')
        // an undefined or raw key would show as "undefined" or a dotted path
        expect(drawn, lang + ' ' + id).not.toMatch(/undefined|\[object|\bbuttons\.|\bsignalText\./)
      }
      expect(rowTexts(await ui.drawn()).some(r => (lang === 'en' ? /^no saved notes/ : /^nessuna nota salvata/).test(r))).toBe(true)
      await ui.unmount()
    }
  } finally {
    setLang('en')
  }
})

test('language: cockpit.json names it; a missing, unreadable, malformed or unknown one is English, and every session start reads it again', async ($, on) => {
  const options: World = { files: IT_FILE }
  world(on, options)
  const tabs = async () => ((await paneRows($, 58)).rows.some(r => /^SUBAGENTI · /.test(r)) ? 'it' : 'en')
  const start = () => $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const italian = 'it'
  const english = 'en'
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
    const isItalian = async () => (await paneRows($, 58)).rows.some(r => /^SUBAGENTI · /.test(r))
    expect(await isItalian()).toBe(true)
    // read once: a change of the file is for the next session start
    options.files = {}
    await clock.advance(10) // the first drawing marked the language as read
    expect(await isItalian()).toBe(true)
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

test('Italian: the credit windows share one row at 58 columns and take one row each at 40, never wider than the pane', async ($, on) => {
  const options: World = {
    files: IT_FILE,
    rateLimits: [
      { kind: 'five_hour', percentUsed: 62, resetsAt: iso(2 * 60 * MIN) },
      { kind: 'seven_day', percentUsed: 41, resetsAt: iso(2 * 24 * 60 * MIN) },
    ],
  }
  world(on, options)
  try {
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    for (const columns of [40, 58]) {
      const width = Math.min(columns, 60) - 2
      const { rows } = await paneRows($, columns)
      const credits = rows.filter(r => /^(5h|7d) /.test(r))
      expect(credits.length).toBe(columns === 58 ? 1 : 2)
      if (columns === 58) expect(credits[0]).toMatch(/^5h .* · 7d /)
      for (const r of credits) expect(textCells(r)).toBeLessThanOrEqual(width)
    }
  } finally {
    setLang('en')
  }
})

test('the pane opens at session start when cockpit.json is missing or holds no autoOpen, and the state file says open', async ($, on) => {
  const opened: string[] = []
  const writes = new Map<string, string>()
  const options: World = { opened, writes, isAutoOpen: true }
  world(on, options)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await settle()
  expect(opened).toEqual(['cockpit'])
  expect(flagOf(writes)).toMatchObject({ open: true })

  opened.length = 0
  options.files = { 'cockpit.json': '{"lang":"it"}' }
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await settle()
  expect(opened).toEqual(['cockpit'])
})

test('the pane is not opened at session start when cockpit.json says autoOpen:false; /cockpit still opens it', async ($, on) => {
  const opened: string[] = []
  world(on, { opened, files: { 'cockpit.json': '{"autoOpen":false}' } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await settle()
  expect(opened).toEqual([])
  await $.command.run({ command: 'cockpit', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 80 } })
  expect(opened).toEqual(['cockpit'])
})
