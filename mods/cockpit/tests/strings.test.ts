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
  setLang('en')
  expect(t().buttons.compact).toBe('compact')
  setLang('it')
  expect(t().buttons.compact).toBe('compatta')
  expect(t().requestsLeft(1)).toBe('~1 richiesta')
  expect(t().requestsLeft(18)).toBe('~18 richieste')
  setLang('en')
  expect(t().requestsLeft(1)).toBe('~1 request')
  expect(t().requestsLeft(18)).toBe('~18 requests')
})
