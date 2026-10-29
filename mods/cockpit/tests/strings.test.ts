import { expect, test } from 'claude-code/testing'

import { langOf, setLang, t } from '../hooks/strings'

test('langOf: the lang of cockpit.json; anything that is not it is English', () => {
  expect(langOf('{"lang":"it"}')).toBe('it')
  expect(langOf('{ "lang": "en" }')).toBe('en')
  expect(langOf('{"lang":"fr"}')).toBe('en')
  expect(langOf('{"lang":1}')).toBe('en')
  expect(langOf('{}')).toBe('en')
  for (const text of ['', 'not json', 'null', '[]', '"it"', '7']) expect(langOf(text)).toBe('en')
})

test('t: answers the language set, and English until one is', () => {
  try {
    setLang('en')
    expect(t().buttons.compact).toBe('compact')
    setLang('it')
    expect(t().buttons.compact).toBe('compatta')
    setLang('en')
  } finally {
    setLang('en')
  }
})

test('what reads the same in both languages is one value, shared by both bundles', () => {
  try {
    setLang('en')
    const en = t()
    setLang('it')
    const it = t()
    expect(it.tokenLabels).toBe(en.tokenLabels)
    expect(it.diffTitle).toBe(en.diffTitle)
    for (const key of ['cache', 'taskTitle', 'costCacheHit'] as const) expect(it[key]).toBe(en[key])
    // the texts of the v4 views are not shared: each language has its own
    for (const key of ['tabs', 'signalText', 'tabsShort', 'signalFields', 'buttons'] as const) expect(it[key]).not.toBe(en[key])
    expect(it.buttons.retro).not.toBe(en.buttons.retro)
  } finally {
    setLang('en')
  }
})

test('Italian: the context details title and the tabs are translated', () => {
  try {
    setLang('it')
    expect(t().contextDetailsTitle).toBe('DETTAGLI CONTESTO')
    expect(t().tabs).toEqual({ agents: 'Agenti', context: 'Contesto', signals: 'Notifiche', work: 'Lavoro', notes: 'Note' })
    setLang('en')
    expect(t().contextDetailsTitle).toBe('CONTEXT DETAILS')
    expect(t().tabs).toEqual({ agents: 'Agents', context: 'Context', signals: 'Notifications', work: 'Work', notes: 'Notes' })
  } finally {
    setLang('en')
  }
})

test('Italian: a percent after its article elides it before a number read with a vowel', () => {
  try {
    setLang('it')
    for (const [pct, text] of [[80, "all'80%"], [85, "all'85%"], [90, 'al 90%'], [100, 'al 100%']] as const) {
      expect(t().contextAt(pct)).toBe(`󰀦 contesto ${text}`)
      expect(t().alertContext(pct)).toBe(`contesto ${text}`)
    }
  } finally {
    setLang('en')
  }
})

test('Italian: the context category names are translated, one the engine adds shows as it is; English shows them as they are', () => {
  try {
    setLang('it')
    expect(t().contextCategories.Messages).toBe('Messaggi')
    expect(t().contextCategories['System prompt']).toBe('Prompt di sistema')
    expect(t().contextCategories['Free space']).toBe('Spazio libero')
    expect(t().contextCategories['A new category']).toBeUndefined()
    setLang('en')
    expect(t().contextCategories.Messages).toBeUndefined()
  } finally {
    setLang('en')
  }
})

test('the context growth and changes additions are translated', () => {
  try {
    setLang('en')
    expect([t().grewTitle, t().editedHere]).toEqual(['WHAT GREW THE CONTEXT', '󰧞 this chat'])
    setLang('it')
    expect([t().grewTitle, t().editedHere]).toEqual(['COSA HA GONFIATO IL CONTESTO', '󰧞 questa chat'])
  } finally {
    setLang('en')
  }
})
