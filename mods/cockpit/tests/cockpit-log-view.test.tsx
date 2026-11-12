import { expect, test } from 'claude-code/testing'

import { COLORS, clockTime, duration, effortGlyph, textCells } from '../hooks/shared'
import { setLang } from '../hooks/strings'
import { colorOf, mountPane, settleAll, spawnWorkflowAgent, spawns } from './cockpit-fixtures'
import { NOW, rowTexts, world } from './cockpit-world'

const WIDE = 70

/** A pane drawn from a saved session: its rows and the drawn tree (for colours). */
async function drawn($: Parameters<Parameters<typeof test>[1]>[0], on: Parameters<typeof world>[0], data: object, columns = WIDE, lang?: 'it', press?: string) {
  world(on, { dataFile: JSON.stringify({ history: [], prs: [], ...data }), ...(lang === 'it' && { files: { 'cockpit.json': '{"lang":"it"}' } }) })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, columns)
  if (press !== undefined) await ui.press({ key: press })
  const root = await ui.drawn()
  await ui.unmount()
  return { rows: rowTexts(root).map(r => r.trimEnd()), root }
}

const PROMPT = 'fix the parser in the lexer module and then clean every helper it uses around the tree'
const CLOSED = [
  { at: NOW - 200_000, kind: 'round', n: 29, ms: 50_000, usd: 0.3, ctxPct: 30, tools: { Bash: 1 } },
  { at: NOW - 100_000, kind: 'round', n: 30, ms: 61_000, usd: 0.44, ctxPct: 42, prompt: PROMPT, model: 'claude-sonnet-5-5', effort: 'high', tools: { Bash: 2 } },
]

test('Given a closed round with prompt, cost, context after a round at 30, model and high effort, When drawn, Then line 1 holds time, number and the cut prompt and line 2 the figures and the battery', { timeoutMs: 30_000 }, async ($, on) => {
  // Given / When
  const { rows, root } = await drawn($, on, { sessionLog: CLOSED }, 50)
  // Then
  const head = rows.findIndex(r => /round 030/.test(r))
  const [line1, line2] = [rows[head] ?? '', rows[head + 1] ?? '']
  expect(line1).toContain(clockTime(NOW - 100_000 - 61_000))
  expect(line1).toContain('fix the parser')
  expect(line1).toContain('…')
  expect(textCells(line1)).toBeLessThanOrEqual(50)
  expect(line2).toContain(duration(61_000))
  expect(line2).toMatch(/\$ *0\.44/)
  expect(line2).toContain('ctx 42% +12')
  expect(line2).toMatch(/son ?5\.5/)
  expect(line2).toContain(effortGlyph('high')?.icon)
  expect(colorOf(root, new RegExp(effortGlyph('high')?.icon ?? '?'))).toBe(effortGlyph('high')?.color)
})

test('Given a round after a compact entry, When drawn, Then the context delta is left out', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const log = [CLOSED[0], { at: NOW - 150_000, kind: 'compact', key: 'c1', tokens: 300_000, after: 100_000 }, CLOSED[1]]
  // When
  const { rows } = await drawn($, on, { sessionLog: log }, WIDE, undefined, 'log:all')
  // Then
  const head = rows.findIndex(r => /round 030/.test(r))
  expect(rows[head + 1]).toContain('ctx 42%')
  expect(rows[head + 1]).not.toContain('+12')
})

test('Given the open round with pending fields, When drawn, Then its header reads the prompt and the model', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const log = [{ at: NOW - 100_000, kind: 'round', n: 1 }, { at: NOW - 10_000, kind: 'commit', key: 'abc1234', text: 'fix' }]
  // When
  const { rows } = await drawn($, on, { sessionLog: log, roundPrompt: 'open work', roundSeq: 1 })
  // Then
  const head = rows.findIndex(r => /current round/.test(r))
  expect(rows[head]).toContain('open work')
  expect(rows[head + 1]).toMatch(/opu ?5\.5/)
})

test('Given a round with 3 fails, 2 waits of 50s and 90s and 4 files, When drawn, Then the summary shows the total wait time and the files row shows the files', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const round = { at: NOW - 100_000, kind: 'round', n: 5, ms: 1000, fails: { n: 3 }, waits: { n: 2, ms: 140_000, list: [{ tool: 'Bash', ms: 50_000 }, { tool: 'Bash', ms: 90_000 }] }, files: ['a', 'b', 'c', 'd'] }
  // When
  const en = await drawn($, on, { sessionLog: [round] })
  // Then
  expect(en.rows.some(r => r.includes('3 failed tools'))).toBe(true)
  expect(colorOf(en.root, /3 failed tools/)).toBe(COLORS.red)
  expect(en.rows.some(r => /2 waits 2m20s/.test(r))).toBe(true)
  expect(en.rows.some(r => r.includes('file a · b · c +1'))).toBe(true)
})

test('Given a round with fails and waits, When drawn in Italian, Then the summary uses the Italian words', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const round = { at: NOW - 100_000, kind: 'round', n: 5, ms: 1000, fails: { n: 3 }, waits: { n: 2, ms: 140_000, list: [{ tool: 'Bash', ms: 70_000 }, { tool: 'Bash', ms: 70_000 }] } }
  try {
    setLang('it')
    // When
    const { rows } = await drawn($, on, { sessionLog: [round] }, WIDE, 'it')
    // Then
    expect(rows.some(r => r.includes('strumenti falliti'))).toBe(true)
    expect(rows.some(r => r.includes('attese'))).toBe(true)
  } finally {
    setLang('en')
  }
})

test('Given ok and failed tests, a commit and a PR, When drawn, Then each has its icon and colour and the commit row shows hash and subject', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const log = [
    { at: NOW - 190_000, kind: 'test', text: 'npm test', isFailed: false },
    { at: NOW - 180_000, kind: 'test', text: 'npm test -- --bail', isFailed: true },
    { at: NOW - 170_000, kind: 'commit', key: 'abc1234', text: 'fix the parser' },
    { at: NOW - 160_000, kind: 'pr', key: '42', text: 'Add filter' },
    { at: NOW - 100_000, kind: 'round', n: 2, ms: 1000 },
  ]
  // When
  const { rows, root } = await drawn($, on, { sessionLog: log }, WIDE, undefined, 'log:all')
  // Then
  const rowOf = (re: RegExp) => rows.find(r => re.test(r)) ?? ''
  expect(rowOf(/npm test$/)).toContain('\u{F0668}')
  expect(colorOf(root, /\u{F0668}/u)).toBe(COLORS.green)
  expect(rowOf(/--bail/)).toContain('\u{F0912}')
  expect(colorOf(root, /\u{F0912}/u)).toBe(COLORS.red)
  expect(rowOf(/abc1234/)).toContain('\u{F0718}')
  expect(rowOf(/abc1234/)).toContain('fix the parser')
  expect(rowOf(/#42/)).toContain('\u{F04C2}')
})

test('Given a flow whose agents all still run, When drawn, Then its node can open: it has an arrow, not a dash', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const clock = world(on)
  spawns(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await spawnWorkflowAgent($, 'wf_1', 0)
  await spawnWorkflowAgent($, 'wf_1', 1)
  await clock.advance(1000)
  await settleAll()
  // When
  const ui = await mountPane($, WIDE)
  const rows = rowTexts(await ui.drawn())
  await ui.unmount()
  // Then
  expect(rows.some(r => /^[▾▸] \d\d:\d\d flow/.test(r))).toBe(true)
})

type Pane = Awaited<ReturnType<typeof mountPane>>
const textOf = async (ui: Pane) => rowTexts(await ui.drawn()).map(r => r.trimEnd())

const BUSY_ROUND = {
  at: NOW - 100_000,
  kind: 'round',
  n: 7,
  ms: 1000,
  prompt: 'work',
  fails: { n: 3, list: [{ tool: 'Read', text: 'no such file' }, { tool: 'Grep', text: 'bad regex' }, { tool: 'Glob', text: 'no match' }] },
  waits: { n: 2, ms: 140_000, list: [{ tool: 'Write', ms: 70_000 }, { tool: 'Edit', ms: 70_000 }] },
}

test('Given a round with 2 waits and 3 failed calls, When drawn in principali and then in tutto, Then principali shows only the counts and tutto a row for each wait and each failed command', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  world(on, { dataFile: JSON.stringify({ history: [], prs: [], sessionLog: [BUSY_ROUND] }) })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, WIDE)
  // When
  const main = await textOf(ui)
  await ui.press({ key: 'log:all' })
  const all = await textOf(ui)
  await ui.unmount()
  // Then
  for (const rows of [main, all]) {
    expect(rows.some(r => r.includes('3 failed tools'))).toBe(true)
    expect(rows.some(r => /2 waits/.test(r))).toBe(true)
  }
  expect(main.filter(r => /waited|no such file|bad regex|no match/.test(r))).toEqual([])
  expect(all.filter(r => /waited/.test(r))).toHaveLength(2)
  expect(all.filter(r => /Read: no such file|Grep: bad regex|Glob: no match/.test(r))).toHaveLength(3)
  expect(all.filter(r => /Read: no such file/.test(r) && /Grep: bad regex/.test(r))).toEqual([])
})

/** A spawn into run `wf_1` whose label names a loop round. */
const spawnInRun = ($: Parameters<Parameters<typeof test>[1]>[0], label: string, agentIndex: number) =>
  $.agent.spawn({
    tool_use_id: `wf-call-${agentIndex}`,
    prompt: 'go',
    description: label,
    subagentType: 'implementer',
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'claude-opus-5-5',
    background: true,
    fork: false,
    workflow: { runId: 'wf_1', agentIndex },
  })

test('Given a flow with agents of round 1 and 2, one running, and a commit by agent X, When drawn, Then R1 and R2 are toggle rows with the highest open, the agents come in start order with their battery, the commit sits under X and the running agent shows a spinner and its elapsed time', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const done = (key: string, type: string, label: string, ms: number, end: number) => ({ at: end, kind: 'agent', key, runId: 'wf_1', text: type, desc: label, model: 'claude-sonnet-5-5', effort: 'high', ms, usd: 0.2 })
  const log = [
    done('x1', 'implementer', 'implementer round 1', 60_000, NOW - 300_000),
    done('x2', 'reviewer', 'reviewer round 2', 50_000, NOW - 200_000),
    { at: NOW - 210_000, kind: 'commit', key: 'abc1234', text: 'fix the parser', agent: 'x2', runId: 'wf_1' },
  ]
  const clock = world(on, { dataFile: JSON.stringify({ history: [], prs: [], sessionLog: log }) })
  spawns(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await spawnInRun($, 'implementer round 2', 0)
  await clock.advance(3000)
  await settleAll()
  // When
  const ui = await mountPane($, 100)
  const before = await textOf(ui)
  const spinners = ((await ui.findAll({ type: 'Client' })) as { key?: string; props?: { props?: { kind?: string; cells?: { t: string }[] } } }[]).filter(c => c.props?.props?.kind === 'spin' && c.props.props.cells?.some(x => x.t === '\u{F1396}'))
  await ui.press({ key: 'flow:wf_1:R1' })
  const after = await textOf(ui)
  await ui.unmount()
  // Then
  const at = (rows: string[], re: RegExp) => rows.findIndex(r => re.test(r))
  expect(before.some(r => /▾ R2/.test(r))).toBe(true)
  expect(before.some(r => /▸ R1/.test(r))).toBe(true)
  // the tree rows start with a time; the flow header and the IN PROGRESS agent list name the type too
  const agentRow = /\d\d:\d\d \S+ implementer/
  expect(before.filter(r => agentRow.test(r))).toHaveLength(1)
  const [reviewer, commit, running] = [at(before, /reviewer/), at(before, /abc1234/), at(before, agentRow)]
  expect(reviewer).toBeGreaterThan(-1)
  expect(commit).toBe(reviewer + 1)
  expect(before[reviewer]).toMatch(/son ?5\.5/)
  expect(before[reviewer]).toContain(effortGlyph('high')?.icon)
  expect(running).toBeGreaterThan(commit)
  expect(before[running]).toContain('\u{F1396}')
  // the LOG row's icon is an animated cell (the IN PROGRESS list spins its own agent too, so the LOG's makes at least one more than the list's)
  expect(spinners.length).toBeGreaterThanOrEqual(2)
  expect(before[running]).toMatch(/\d\dm\d\ds/)
  expect(before[running]).not.toContain('\u{F012C}')
  expect(after.some(r => /▾ R1/.test(r))).toBe(true)
  expect(after.filter(r => agentRow.test(r))).toHaveLength(2)
  expect(after.some(r => agentRow.test(r) &&r.includes(effortGlyph('high')?.icon ?? '?'))).toBe(true)
})

/** A saved session of three rounds (figures all there, no duration, no cost) and agents of the same three kinds under the newest. */
const FIGURES_LOG = [
  { at: NOW - 400_000, kind: 'round', n: 1, ms: 60_000, usd: 0.44, prompt: 'first', model: 'claude-sonnet-5-5', effort: 'high' },
  { at: NOW - 300_000, kind: 'round', n: 2, usd: 0.3, prompt: 'second', model: 'claude-sonnet-5-5', effort: 'high' },
  { at: NOW - 130_000, kind: 'agent', key: 'g1', text: 'reviewer', model: 'claude-opus-5-5', effort: 'high', ms: 30_000, usd: 0.2 },
  { at: NOW - 120_000, kind: 'agent', key: 'g2', text: 'tester', model: 'claude-haiku-5-5', usd: 0.1 },
  { at: NOW - 110_000, kind: 'agent', key: 'g3', text: 'planner', model: 'claude-sonnet-5-5', ms: 20_000 },
  { at: NOW - 100_000, kind: 'round', n: 3, ms: 5000, prompt: 'third', model: 'claude-sonnet-5-5', effort: 'high' },
]

test('Given a LOG with haiku, sonnet and opus agents, When drawn, Then no row shows the model counters', { timeoutMs: 30_000 }, async ($, on) => {
  // Given / When
  const { rows } = await drawn($, on, { sessionLog: FIGURES_LOG }, 120, undefined, 'log:all')
  // Then
  expect(rows.filter(r => /\b(h|s|o|f) x\s*\d|\b(hai|son|op|fab) x\s*\d/.test(r))).toEqual([])
})

/** Where the first match of `re` ends in `row`, in cells; -1 when the row has none. */
const endOf = (row: string, re: RegExp): number => {
  const m = re.exec(row)
  return m === null ? -1 : textCells(row.slice(0, m.index + m[0].length))
}

test('Given rows with all figures, with no share and with no duration, When drawn at the same width, Then the $ of every row ends at the same column, and so do the duration and the share', { timeoutMs: 30_000 }, async ($, on) => {
  // Given / When
  const { rows: all } = await drawn($, on, { sessionLog: FIGURES_LOG }, 80, undefined, 'log:all')
  // Then
  const rows = all.slice(all.findIndex(r => r.startsWith('LOG')))
  const COST = /\$ *\d+\.\d\d/
  const DURATION = /\d\dm\d\ds/
  const SHARE = /\d+%$/
  const ends = (re: RegExp) => [...new Set(rows.map(r => endOf(r, re)).filter(n => n >= 0))]
  const cost = rows.filter(r => COST.test(r))
  expect(cost.length).toBeGreaterThanOrEqual(4)
  expect(ends(COST)).toHaveLength(1)
  expect(rows.filter(r => DURATION.test(r)).length).toBeGreaterThanOrEqual(4)
  expect(ends(DURATION)).toHaveLength(1)
  expect(rows.filter(r => SHARE.test(r)).length).toBeGreaterThanOrEqual(2)
  expect(ends(SHARE)).toHaveLength(1)
  // a value that is missing leaves its slot blank: the rows with no duration still hold their $ in the column
  expect(cost.some(r => !DURATION.test(r))).toBe(true)
})

test('Given a narrow pane, When drawn, Then the left text is cut before the figures, which stay whole', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const log = [
    { at: NOW - 130_000, kind: 'agent', key: 'g1', text: 'a-very-long-subagent-type-name', model: 'claude-opus-5-5', ms: 30_000, usd: 0.2 },
    { at: NOW - 100_000, kind: 'round', n: 3, ms: 5000, usd: 0.4, prompt: 'a long prompt that cannot fit in so few cells at all', model: 'claude-sonnet-5-5' },
  ]
  // When
  const { rows } = await drawn($, on, { sessionLog: log }, 36)
  // Then
  const agent = rows.find(r => r.includes('00m30s')) ?? ''
  expect(agent).toMatch(/00m30s +\$ +0\.20/)
  expect(rows.join('\n')).not.toContain('a-very-long-subagent-type-name')
  const header = rows.find(r => /\$ +0\.40/.test(r)) ?? ''
  expect(header).toMatch(/00m05s +\$ +0\.40/)
  for (const row of rows) expect(textCells(row)).toBeLessThanOrEqual(36)
})

test('Given a narrow pane and a round with context, model and effort, When drawn, Then line 2 cuts its left part and keeps the figures', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const log = [{ at: NOW - 100_000, kind: 'round', n: 4, ms: 7000, usd: 0.6, prompt: 'fix it', ctxPct: 42, model: 'claude-sonnet-5-5', effort: 'high' }]
  // When
  const { rows } = await drawn($, on, { sessionLog: log }, 36)
  // Then
  const second = rows.find(r => /\$ +0\.60/.test(r)) ?? ''
  expect(second).toMatch(/00m07s +\$ +0\.60/)
  for (const row of rows) expect(textCells(row)).toBeLessThanOrEqual(36)
})

const FLOW_ROUND = { at: NOW - 100_000, kind: 'round', n: 1, ms: 61_000, usd: 0.44, tools: { Bash: 1 } }
const flowEntry = (text: string) => ({ at: NOW - 200_000, kind: 'flow', key: 'wf_1', text, ms: 61_000, usd: 0.44 })

test('Given a flow named review-pair, When the LOG is drawn at 60 columns, Then its node reads flow review-pair whole and its figures end in the column of the other rows', { timeoutMs: 30_000 }, async ($, on) => {
  // Given / When
  const { rows } = await drawn($, on, { sessionLog: [flowEntry('review-pair'), FLOW_ROUND] }, 60)
  // Then
  const flowRow = rows.find(r => /^[▾▸-] \d\d:\d\d flow review-pair/.test(r)) ?? ''
  const roundRow = rows.find(r => /round 001/.test(r)) ?? ''
  expect(flowRow).toMatch(/\$ *0\.44/)
  expect(textCells(flowRow)).toBe(textCells(roundRow))
})

test('Given a flow with a long name, When drawn in a 30-column pane, Then the name is cut with an ellipsis and the figures stay whole', { timeoutMs: 30_000 }, async ($, on) => {
  // Given / When
  const { rows } = await drawn($, on, { sessionLog: [flowEntry('review-pair-extended'), FLOW_ROUND] }, 30)
  // Then
  // the round's launch row sits between the two nodes; a 30-column pane has no room left for the name
  const launch = rows.findIndex(r => /→ flow/.test(r))
  const flowRow = rows[launch + 1] ?? ''
  const roundRow = rows[launch - 1] ?? ''
  expect(flowRow).toMatch(/^- \d\d:\d\d…/)
  expect(flowRow).not.toContain('review-pair-extended')
  expect(flowRow).toContain(duration(61_000))
  expect(flowRow).toMatch(/\$ *0\.44/)
  expect(textCells(flowRow)).toBe(textCells(roundRow))
})

test('Given a flow launched in round 3 whose agents are still working in round 5, When drawn, Then its launch row sits under round 3', { timeoutMs: 30_000 }, async ($, on) => {
  // Given: the first agent starts now, in round 3's span; rounds 3 to 5 end later, and a second agent starts in round 5's span
  const round = (n: number, at: number) => ({ at, kind: 'round', n, ms: 10_000, tools: { Bash: 1 } })
  const log = [round(2, NOW - 100_000), round(3, NOW + 100_000), round(4, NOW + 200_000), round(5, NOW + 300_000)]
  const clock = world(on, { dataFile: JSON.stringify({ history: [], prs: [], sessionLog: log }) })
  spawns(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await spawnWorkflowAgent($, 'wf_1', 0)
  await clock.advance(250_000)
  await spawnWorkflowAgent($, 'wf_1', 1)
  await clock.advance(100_000)
  await settleAll()
  // When
  const ui = await mountPane($, WIDE)
  await ui.press({ key: `done:${NOW + 100_000}` })
  const rows = await textOf(ui)
  await ui.unmount()
  // Then
  const head = rows.findIndex(r => /round 003/.test(r))
  const next = rows.findIndex((r, i) => i > head && /round \d{3}/.test(r))
  const under = rows.slice(head + 1, next < 0 ? undefined : next)
  expect(under.some(r => /→ flow wf_1/.test(r))).toBe(true)
  expect(rows.filter(r => /→ flow wf_1/.test(r))).toHaveLength(1)
})
