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
    for (const key of ['cache'] as const) expect(it[key]).toBe(en[key])
    // the texts of the v4 views are not shared: each language has its own
    for (const key of ['signalText', 'signalFields', 'buttons', 'page'] as const) expect(it[key]).not.toBe(en[key])
    expect(it.buttons.retro).not.toBe(en.buttons.retro)
  } finally {
    setLang('en')
  }
})

test('Italian: a percent after its article elides it before a number read with a vowel', () => {
  try {
    setLang('it')
    for (const [pct, text] of [[80, "all'80%"], [85, "all'85%"], [90, 'al 90%'], [100, 'al 100%']] as const) {
      expect(t().alertContext(pct)).toBe(`contesto ${text}`)
    }
  } finally {
    setLang('en')
  }
})
test('the four page sections are titled in both languages, and no todo points at a tab', () => {
  try {
    setLang('en')
    expect([t().page.attention, t().page.trend, t().page.inProgress, t().page.done, t().page.nothingToDo]).toEqual(['ATTENTION', 'TREND', 'IN PROGRESS', 'DONE', 'nothing to do'])
    expect(t().signalText.workflow('stall').todo).toContain('IN PROGRESS')
    setLang('it')
    expect([t().page.attention, t().page.trend, t().page.inProgress, t().page.done, t().page.nothingToDo]).toEqual(['ATTENZIONE', 'ANDAMENTO', 'IN CORSO', 'FATTO', 'niente da fare'])
    expect(t().signalText.workflow('stall').todo).toContain('IN CORSO')
    for (const lang of ['en', 'it'] as const) {
      setLang(lang)
      expect(t().signalText.ctxGrowth(50_000).todo).not.toMatch(/\(Contes|\(Context/)
      expect(t().signalText.workflow('stall').todo).not.toMatch(/tab/i)
    }
  } finally {
    setLang('en')
  }
})

test('a compact event without tokens reads "compacted" with no double space, in both languages', () => {
  try {
    for (const [lang, word] of [['en', 'compacted'], ['it', 'compattato']] as const) {
      setLang(lang)
      expect(t().page.events.compact('', '')).toBe(word)
      expect(t().page.events.compact('120k', '40k')).toBe(`${word} 120k → 40k`)
      expect(t().page.events.compact('', '40k')).toBe(`${word} → 40k`)
    }
  } finally {
    setLang('en')
  }
})
