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
    expect(t().requestsLeft(1)).toBe('~1 richiesta')
    expect(t().requestsLeft(18)).toBe('~18 richieste')
    setLang('en')
    expect(t().requestsLeft(1)).toBe('~1 request')
    expect(t().requestsLeft(18)).toBe('~18 requests')
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
    expect(it.consumerKinds).toBe(en.consumerKinds)
    expect(it.diffTitle).toBe(en.diffTitle)
    for (const key of ['cache', 'tokenShare', 'taskTitle', 'hookTitle', 'prTitle'] as const) expect(it[key]).toBe(en[key])
    expect(it.tabs).not.toBe(en.tabs)
    expect(it.procHeader).not.toEqual(en.procHeader)
  } finally {
    setLang('en')
  }
})

test('Italian: the process header, the pace, the trend title and the context block title are translated', () => {
  try {
    setLang('it')
    expect(t().procHeader).toEqual({ pid: 'PID', name: 'NOME', cpu: 'CPU', ram: 'RAM', ports: 'PORTE' })
    expect(t().vsExpected).toBe("rispetto all'atteso 7d ")
    expect(t().trendTitle(1)).toBe('ANDAMENTO · 1 giro')
    expect(t().trendTitle(5)).toBe('ANDAMENTO · 5 giri')
    expect(t().contextDetailsTitle).toBe('DETTAGLI CONTESTO')
    expect(t().tabs.insights).toBe('Analisi')
    setLang('en')
    expect(t().procHeader.name).toBe('NAME')
    expect(t().contextDetailsTitle).toBe('CONTEXT DETAILS')
    expect(t().tabs.insights).toBe('Insights')
  } finally {
    setLang('en')
  }
})

test('Italian: a percent after its article elides it before a number read with a vowel', () => {
  try {
    setLang('it')
    for (const [share, text] of [[61, 'il 61%'], [85, "l'85%"], [90, 'il 90%'], [100, 'il 100%'], [11, "l'11%"], [18, 'il 18%'], [80, "l'80%"], [89, "l'89%"]] as const) {
      expect(t().hints.subagents(share)).toBe(`⚠ i subagent hanno usato ${text} dei token`)
    }
    for (const [pct, text] of [[80, "all'80%"], [85, "all'85%"], [90, 'al 90%'], [100, 'al 100%']] as const) {
      expect(t().contextAt(pct)).toBe(`⚠ contesto ${text}`)
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
