import { expect, test } from 'claude-code/testing'

import { makeKit } from '../hooks/view-kit'
import type { Kit } from '../hooks/view-kit'
import { nowSections } from '../hooks/view-now'
import { agent, draw, snap } from './cockpit-page-draw'

// ── The terminal In corso tab, drawn as the desktop's: request, flow, agents outside the flow ──

const at = (width: number) => (k: Kit) => nowSections(makeKit(k.ui, k.s, width, k.actions))

for (const width of [30, 58, 100]) {
  test(`Given nothing running, When the tab is drawn at ${width} columns, Then the three titles show, each with its empty line`, { timeoutMs: 30_000 }, async ($, on) => {
    // Given / When
    const { rows } = await draw($, on, snap(), at(width))
    // Then
    const text = rows.join('\n')
    for (const word of ['REQUEST', 'FLOW', 'AGENTS OUTSIDE THE FLOW']) expect(text).toContain(word)
    expect(text).toContain('no open request')
    expect(rows.every(r => [...r].length <= width + 2)).toBe(true)
  })
}

test('Given an open prompt and a running agent outside any flow, When drawn, Then the prompt and the agent with its type show', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const s = snap({ roundPrompt: 'fix the build', agents: [agent('a1', 'implementer', { description: 'wire it' })] })
  // When
  const { rows } = await draw($, on, s, at(58))
  // Then
  expect(rows.some(r => r.includes('fix the build'))).toBe(true)
  expect(rows.some(r => r.includes('implementer'))).toBe(true)
})
