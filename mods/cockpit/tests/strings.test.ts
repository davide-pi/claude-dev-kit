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
    expect([t().page.attention, t().page.trend, t().page.inProgress, t().page.done, t().page.nothingToDo]).toEqual(['ATTENTION', 'TREND', 'IN PROGRESS', 'LOG', 'nothing to do'])
    expect(t().signalText.workflow('stall').todo).toContain('IN PROGRESS')
    setLang('it')
    expect([t().page.attention, t().page.trend, t().page.inProgress, t().page.done, t().page.nothingToDo]).toEqual(['ATTENZIONE', 'ANDAMENTO', 'IN CORSO', 'LOG', 'niente da fare'])
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

const deskKeys = (): string[] => Object.entries(t().desk).flatMap(([group, texts]) => Object.entries(texts).map(([key, text]) => `${group}.${key}:${typeof text === 'string' && text !== '' ? 'ok' : 'bad'}`))

test('Given lang it and en, When the desk block is read, Then every key is a non-empty string and both languages have the same keys', () => {
  try {
    // Given
    setLang('en')
    const en = deskKeys()
    setLang('it')
    // When
    const it = deskKeys()
    // Then
    expect(en.length).toBeGreaterThan(20)
    expect(it).toEqual(en)
    expect(en.filter(k => k.endsWith(':bad'))).toEqual([])
  } finally {
    setLang('en')
  }
})

test('Given the desk block, When read in both languages, Then the tab, head, log and now words are the planned ones', () => {
  const words = (d: ReturnType<typeof t>['desk']): string[] => [d.tabs.now, d.tabs.log, d.tabs.analysis, d.head.context, d.head.urgent, d.head.urgentHint, d.log.important, d.log.all, d.log.newestTop, d.now.request, d.now.flow, d.now.outside, d.analysis.compactNow, d.log.unattributed]
  try {
    // Given
    setLang('it')
    // When
    const it = words(t().desk)
    setLang('en')
    const en = words(t().desk)
    // Then
    expect(it).toEqual(['In corso', 'Log', 'Analisi', 'Contesto', 'URGENTE', 'solo ciò che aspetta te', 'Importanti', 'Tutto', 'il più recente in alto', 'RICHIESTA', 'FLOW', 'AGENTI FUORI DAL FLOW', 'Compatta ora', 'Fuori da un giro'])
    expect(en).toEqual(['In progress', 'Log', 'Analysis', 'Context', 'URGENT', 'only what waits for you', 'Important', 'All', 'newest on top', 'REQUEST', 'FLOW', 'AGENTS OUTSIDE THE FLOW', 'Compact now', 'Outside a round'])
  } finally {
    setLang('en')
  }
})
