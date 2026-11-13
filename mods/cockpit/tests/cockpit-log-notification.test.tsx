import { expect, test } from 'claude-code/testing'

import { setLang } from '../hooks/strings'
import { bashResult, mountPane, permissionChecks, settleAll, spawns } from './cockpit-fixtures'
import { rowTexts, world } from './cockpit-world'

type Session = Parameters<Parameters<typeof test>[1]>[0]

const notification = (kind: 'Workflow' | 'Agent', status: string) =>
  [
    '<task-notification>',
    '<task-id>wf_abc123</task-id>',
    `<status>${status}</status>`,
    `<summary>${kind} "review" ${status}</summary>`,
    '<output-file>C:/tmp/out.txt</output-file>',
    '</task-notification>',
  ].join('\n')

/** A round opened by `text` and holding a commit, so its node is drawn; the pane's rows at 100 columns. */
async function rowsFor($: Session, on: Parameters<typeof world>[0], text: string, lang?: 'it') {
  setLang(lang ?? 'en')
  world(on, { ...(lang === 'it' && { files: { 'cockpit.json': '{"lang":"it"}' } }) })
  spawns(on)
  permissionChecks(on)
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', { tool: 'Bash' }, () => bashResult('[main abc1234] fix the parser'))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text } as never)
  await $.tool.call({ tool: 'Bash', command: 'git commit -m "fix the parser"' })
  await settleAll()
  const ui = await mountPane($, 100)
  const rows = rowTexts(await ui.drawn()).map(r => r.trimEnd())
  await ui.unmount()
  return rows.join('\n')
}

test('Given a prompt holding a task-notification for a completed workflow, When the log draws it, Then it shows a short label and no raw tag', { timeoutMs: 30_000 }, async ($, on) => {
  // Given / When
  const drawn = await rowsFor($, on, notification('Workflow', 'completed'))
  // Then
  expect(drawn).toContain('workflow completed')
  expect(drawn).not.toMatch(/task-notification|<task-id|<status|<summary/)
})

test('Given a task-notification for a completed agent, When the log draws it, Then the label names the agent', { timeoutMs: 30_000 }, async ($, on) => {
  // Given / When
  const drawn = await rowsFor($, on, notification('Agent', 'completed'))
  // Then
  expect(drawn).toContain('agent completed')
  expect(drawn).not.toContain('task-notification')
})

test('Given a task-notification with status failed or killed, When the log draws it, Then the label says so', { timeoutMs: 30_000 }, async ($, on) => {
  // Given / When
  const failed = await rowsFor($, on, notification('Workflow', 'failed'))
  // Then
  expect(failed).toContain('workflow failed')
  expect(failed).not.toContain('task-notification')
})

test('Given a task-notification for a killed agent, When the log draws it, Then the label says killed', { timeoutMs: 30_000 }, async ($, on) => {
  // Given / When
  const killed = await rowsFor($, on, notification('Agent', 'killed'))
  // Then
  expect(killed).toContain('agent killed')
  expect(killed).not.toContain('task-notification')
})

test('Given the UI language is Italian, When the log draws a completed workflow notification, Then the label is in Italian', { timeoutMs: 30_000 }, async ($, on) => {
  try {
    // Given / When
    const drawn = await rowsFor($, on, notification('Workflow', 'completed'), 'it')
    // Then
    expect(drawn).toContain('workflow completato')
    expect(drawn).not.toContain('task-notification')
  } finally {
    setLang('en')
  }
})

test('Given a normal user prompt, When the log draws it, Then it is unchanged', { timeoutMs: 30_000 }, async ($, on) => {
  // Given / When
  const drawn = await rowsFor($, on, 'fix the parser')
  // Then
  expect(drawn).toContain('fix the parser')
  expect(drawn).not.toMatch(/completed|failed|killed/)
})
