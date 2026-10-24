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
    for (const key of ['cache', 'tokenShare', 'taskTitle', 'workflowTitle', 'hookTitle', 'prTitle', 'toolTitle', 'max'] as const) expect(it[key]).toBe(en[key])
    expect(it.tabs).not.toBe(en.tabs)
  } finally {
    setLang('en')
  }
})
