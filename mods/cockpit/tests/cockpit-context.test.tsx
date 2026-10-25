import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { spanWidth, textCells } from '../hooks/shared'
import { setLang } from '../hooks/strings'
import { categorySpans } from '../hooks/view-context'
import {
  CONTEXT_ROWS,
  IT_FILE,
  KEEP_DROP,
  breakdownRow,
  holds,
  launchWorkflow,
  loadSkill,
  mainTurnEnd,
  mountPane,
  openCockpit,
  paneRows,
  roundHooks,
  settleAll,
  skillTool,
  spawnWorkflowAgent,
  spawns,
  taskTools,
  todo,
  workflowLaunches,
} from './cockpit-fixtures'
import { rowTexts, world } from './cockpit-world'
import type { World } from './cockpit-world'

test('buttons row: the instructions name the open tasks and the active deliver perimeter of the branch', async ($, on) => {
  const instructions: (string | undefined)[] = []
  world(on, {
    instructions,
    branch: 'feat/x',
    perimeter: 'branch: feat/x\nstatus: active\n- src/a.ts\n- src/b/\n- docs/c.md\n',
  })
  taskTools(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'TodoWrite', todos: [todo('Scrivere i test', 'in_progress'), todo('Poi il codice', 'pending'), todo('Fatto', 'completed')] })
  const ui = await mountPane($)
  await ui.press({ key: 'bar:compact' })
  await ui.unmount()
  expect(instructions).toHaveLength(1)
  expect(instructions[0]?.startsWith(KEEP_DROP)).toBe(true)
  expect(instructions[0]).toContain('Task aperti: Scrivere i test; Poi il codice.')
  expect(instructions[0]).toContain('Perimetro deliver (3 voci): src/a.ts, src/b/.')
  expect(instructions[0]).not.toContain('docs/c.md')
  expect(instructions[0]).not.toContain('Workflow')
  expect(instructions[0]).not.toContain('Fatto')
  expect([...(instructions[0] ?? '')].length).toBeLessThanOrEqual(400)
})

test('buttons row: the instructions name the workflow the session launched, until its run ends', async ($, on) => {
  const instructions: (string | undefined)[] = []
  world(on, { instructions })
  workflowLaunches(on, 'release-notes')
  spawns(on)
  roundHooks(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await launchWorkflow($, 'release-notes')
  await spawnWorkflowAgent($, 'wf_1', 1)
  const ui = await mountPane($)
  await ui.press({ key: 'bar:compact' })
  expect(instructions[0]).toContain('Workflow in corso: release-notes.')
  expect([...(instructions[0] ?? '')].length).toBeLessThanOrEqual(400)
  await mainTurnEnd($, 'a1')
  await $.turn.start({ text: 'next', turnId: 't2' })
  await ui.press({ key: 'bar:compact' })
  await ui.unmount()
  expect(instructions[1]).toBe(KEEP_DROP)
})

test('buttons row: a perimeter of another branch, or a closed one, is not named', async ($, on) => {
  const instructions: (string | undefined)[] = []
  world(on, { instructions, branch: 'feat/x', perimeter: 'branch: feat/other\nstatus: active\n- src/a.ts\n' })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mountPane($)
  await ui.press({ key: 'bar:compact' })
  await ui.unmount()
  expect(instructions).toEqual([KEEP_DROP])
})

test('Context: opening the tab reads a summary breakdown and draws the bar and a row per category; the first opening, idle, also counts exactly once, and the button counts again', async ($, on) => {
  const usageCalls: (string | undefined)[] = []
  world(on, { usageCalls, breakdown: { categories: CONTEXT_ROWS, totalTokens: 98_000, rawMaxTokens: 1_000_000 } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const summaries = () => usageCalls.filter(c => c === 'summary').length
  const atStart = summaries() // the autocompact threshold's read
  const ui = await mountPane($, 50)
  expect(summaries()).toBe(atStart) // nothing is read until the tab opens

  await ui.press({ key: 'tab:context' })
  await settleAll()
  expect(summaries()).toBe(atStart + 1)
  const rows = rowTexts(await ui.drawn())
  expect(rows.some(r => /^CONTEXT/.test(r))).toBe(true)
  // every row is as wide as the pane's content (its background bar spans it)
  expect(rows.find(r => /System prompt/.test(r))).toMatch(/^■ System prompt +8k +1% *$/)
  expect(rows.find(r => /Messages/.test(r))).toMatch(/^■ Messages +90k +9% *$/)
  expect(rows.find(r => /Free space/.test(r))).toMatch(/Free space +700k +70% *$/)
  expect(textCells(rows.find(r => /Messages/.test(r)) ?? '')).toBe(48)
  expect((await ui.find({ type: 'Text', text: /^(estimate|exact|✓ = exact)$/ }))?.text).toBe('exact')
  expect(usageCalls.filter(c => c === 'full')).toHaveLength(1) // the first opening, idle, counts once by itself

  await ui.press({ key: 'ctx:refresh' })
  await settleAll()
  expect(usageCalls.filter(c => c === 'full')).toHaveLength(2)
  expect((await ui.find({ type: 'Text', text: /^(estimate|exact|✓ = exact)$/ }))?.text).toBe('exact')
  await ui.unmount()
})

test('Context: a main turn reads the breakdown again, debounced, only while the pane is open on this tab', async ($, on) => {
  const usageCalls: (string | undefined)[] = []
  const clock = world(on, { usageCalls, breakdown: { categories: CONTEXT_ROWS, totalTokens: 98_000, rawMaxTokens: 1_000_000 } })
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await openCockpit($)
  const ui = await mountPane($, 50)
  const summaries = () => usageCalls.filter(c => c === 'summary').length

  // another tab is selected: the end of a turn reads nothing
  const base = summaries()
  await mainTurnEnd($)
  await clock.advance(5000)
  await settleAll()
  expect(summaries()).toBe(base)

  await ui.press({ key: 'tab:context' })
  await settleAll()
  const opened = summaries()
  expect(opened).toBe(base + 1)
  // a burst of turns (a subagent turn too) is one read, once the debounce is over
  await mainTurnEnd($)
  await mainTurnEnd($)
  await mainTurnEnd($, 'a1')
  await settleAll()
  expect(summaries()).toBe(opened)
  await clock.advance(5000)
  await settleAll()
  expect(summaries()).toBe(opened + 1)
  await ui.unmount()
})

test('Context: the fast tier runs while the tab is selected (the refresh countdown), and not on the Cronologia tab', async ($, on) => {
  const listCalls: string[] = []
  const clock = world(on, { listCalls })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await openCockpit($)
  const ui = await mountPane($, 50)
  await ui.press({ key: 'tab:context' })
  await settleAll()
  listCalls.length = 0
  await clock.advance(6000)
  await settleAll()
  expect(listCalls.length).toBeGreaterThan(0)
  await ui.press({ key: 'tab:history' })
  await settleAll()
  listCalls.length = 0
  await clock.advance(3000) // t = 9 s: before the medium tier's tick
  await settleAll()
  expect(listCalls).toHaveLength(0)
  await ui.unmount()
})

test('Context: the top five static consumers by tokens, and the skills invoked this session with the listing count', async ($, on) => {
  world(on, {
    breakdown: {
      categories: CONTEXT_ROWS,
      totalTokens: 98_000,
      rawMaxTokens: 1_000_000,
      memoryFiles: [
        { path: '/home/u/.claude/CLAUDE.md', type: 'User', tokens: 3000 },
        { path: '/w/proj/CLAUDE.md', type: 'Project', tokens: 900 },
      ],
      mcpTools: [
        { name: 'mcp__a__big', serverName: 'a', tokens: 5000, isLoaded: true },
        { name: 'mcp__a__off', serverName: 'a', tokens: 9000, isLoaded: false },
      ],
      agents: [
        { agentType: 'code-reviewer', source: 'plugin', tokens: 400 },
        { agentType: 'tiny', source: 'plugin', tokens: 100 },
      ],
      skills: { totalSkills: 60, includedSkills: 41, tokens: 4200, skillFrontmatter: [] },
    },
  })
  skillTool(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await loadSkill($, 'commit')
  await loadSkill($, 'react')
  await loadSkill($, 'commit') // a skill is listed once

  const ui = await mountPane($, 50)
  await ui.press({ key: 'tab:context' })
  await settleAll()
  const rows = rowTexts(await ui.drawn())
  const consumers = rows.filter(r => /^(file|mcp|agent|skill) /.test(r))
  expect(consumers).toHaveLength(5)
  expect(consumers[0]).toMatch(/^mcp +mcp__a__big +5k$/)
  expect(consumers[1]).toMatch(/^skill +skills +4\.2k$/)
  expect(consumers[2]).toMatch(/^file +User CLAUDE\.md +3k$/)
  expect(consumers[3]).toMatch(/^file +Project CLAUDE\.md +900$/)
  expect(consumers[4]).toMatch(/^agent +code-reviewer +400$/)
  expect(rows.some(r => /^SKILLS/.test(r))).toBe(false)
  await ui.unmount()
})

/** A main turn's end with the context the engine measured, at `percent` of the window. */
const contextRound = async ($: Engine, tokens: number, percent: number) => {
  await $.session.measure({ context: { window: 1_000_000, tokens, percent }, rateLimits: [], changed: ['context'] })
  await $.turn.complete({
    answer: '',
    durationMs: 1,
    isAborted: false,
    turnId: 't',
    reason: 'answer',
    usage: { input_tokens: 0, output_tokens: 7, cache_read_input_tokens: tokens, cache_creation_input_tokens: 0, model: 'm' },
  })
}

test('Context: the sparkline holds the context at each main turn, the last twenty; worth compacting from 70 % with three rounds each over 5 % up', async ($, on) => {
  world(on)
  on('turn.complete', () => ({ text: '' }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const view = async () => (await paneRows($, 50, 'context')).rows
  expect((await view()).some(r => /^[▁-█]+/.test(r))).toBe(false) // no round yet: no sparkline

  for (let i = 0; i < 20; i++) await contextRound($, 100_000, 10)
  let rows = await view()
  // one line: the last rounds as bars (a flat run is the lowest bar), where the context went; no growth, so no rate
  expect(rows.find(r => /^[▁-█]{8} /.test(r))).toMatch(/^▁{8} {2}100k → 100k$/)
  expect(rows.some(r => /worth compacting/.test(r))).toBe(false)

  // 72 % and three rounds up by more than 5 % each: 100k, 106k, 113k, 120k
  for (const [tokens, percent] of [[106_000, 70], [113_000, 71], [120_000, 72]] as const) await contextRound($, tokens, percent)
  rows = await view()
  // eight bars, the oldest rounds gone; the rate is the growth per round of the samples the forecast uses (4k over the last five)
  expect(rows.find(r => /^[▁-█]{8} /.test(r))).toMatch(/^▁{5}▃▆█ {2}100k → 120k \(\+4k\/round\)$/)
  expect(rows.some(r => /worth compacting/.test(r))).toBe(true)
})

test('Context: worth compacting also when the autocompact forecast is three requests or fewer, whatever the fill', async ($, on) => {
  world(on, { autoCompactAt: 150_000 })
  on('turn.complete', () => ({ text: '' }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  for (const tokens of [100_000, 110_000]) await contextRound($, tokens, 10)
  // 40k left at 10k a turn: four requests
  expect((await paneRows($, 50, 'context')).rows.some(r => /worth compacting/.test(r))).toBe(false)
  await contextRound($, 120_000, 10) // 30k left: three requests
  expect((await paneRows($, 50, 'context')).rows.some(r => /worth compacting/.test(r))).toBe(true)
})

const CTX_SUMMARY = [breakdownRow('System prompt', 8000), breakdownRow('Messages', 90_000), breakdownRow('Autocompact buffer', 33_000, 'buffer'), breakdownRow('Free space', 700_000, 'free')]
const categoryNames = (rows: string[]) => rows.flatMap(r => (/^■ (\S+(?: \S+)*)/.exec(r) ? [/^■ (\S+(?: \S+)*)/.exec(r)?.[1] ?? ''] : []))

test('Context: the categories go by tokens, biggest first, the free space and the buffer last', async ($, on) => {
  const categories = [
    breakdownRow('Free space', 700_000, 'free'),
    breakdownRow('System prompt', 8000),
    breakdownRow('Autocompact buffer', 33_000, 'buffer'),
    breakdownRow('Skills', 20_000),
    breakdownRow('Messages', 90_000),
  ]
  world(on, { breakdown: { categories, totalTokens: 118_000, rawMaxTokens: 1_000_000 } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 50)
  await ui.press({ key: 'tab:context' })
  await settleAll()
  expect(categoryNames(rowTexts(await ui.drawn()))).toEqual(['Messages', 'Skills', 'System prompt', 'Free space', 'Autocompact buffer'])
  await ui.unmount()
})

test('Context: the first time the tab opens while idle one exact count runs; its static rows are reused by later summaries, marked, and Messages stay live with their change', async ($, on) => {
  const usageCalls: (string | undefined)[] = []
  const options: World = {
    usageCalls,
    breakdown: { categories: CTX_SUMMARY, totalTokens: 98_000, rawMaxTokens: 1_000_000 },
    exactBreakdown: { categories: [breakdownRow('System prompt', 9500), breakdownRow('Messages', 91_000), breakdownRow('Autocompact buffer', 33_000, 'buffer'), breakdownRow('Free space', 690_000, 'free')], totalTokens: 100_500 },
  }
  const clock = world(on, options)
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await openCockpit($)
  const ui = await mountPane($, 50)
  const fulls = () => usageCalls.filter(c => c === 'full').length
  const kind = async () => (await ui.find({ type: 'Text', text: /^(estimate|exact|✓ = exact)$/ }))?.text
  await ui.press({ key: 'tab:context' })
  await settleAll()
  expect(fulls()).toBe(1)
  expect(await kind()).toBe('exact')
  await ui.press({ key: 'tab:agents' })
  await ui.press({ key: 'tab:context' })
  await settleAll()
  expect(fulls()).toBe(1) // once per session
  // the next round: a summary whose Messages grew; the static rows keep their exact count
  options.breakdown = { categories: [breakdownRow('System prompt', 8000), breakdownRow('Messages', 95_000), breakdownRow('Autocompact buffer', 33_000, 'buffer'), breakdownRow('Free space', 700_000, 'free')], totalTokens: 103_000, rawMaxTokens: 1_000_000 }
  await mainTurnEnd($)
  await clock.advance(5000)
  await settleAll()
  expect(fulls()).toBe(1)
  expect(await kind()).toBe('✓ = exact')
  const rows = rowTexts(await ui.drawn())
  expect(rows.find(r => /^■ System prompt/.test(r))).toMatch(/^■ System prompt +9\.5k +1% ✓ *$/)
  expect(rows.find(r => /^■ Messages/.test(r))).toMatch(/^■ Messages +95k +10% +\+5k$/) // from the summary read of the reopened tab, 90k
  expect(rows.some(r => /^CONTEXT DETAILS · 104\.5K\/1M/.test(r))).toBe(true)
  expect((await ui.find({ key: 'ctx:refresh' }))?.text).toBe('refresh') // the button stays
  await ui.unmount()
})

test('Context: no exact count while Claude is working; the next time the tab opens idle it runs, once', async ($, on) => {
  const usageCalls: (string | undefined)[] = []
  world(on, { usageCalls, breakdown: { categories: CTX_SUMMARY, totalTokens: 98_000, rawMaxTokens: 1_000_000 } })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 50)
  const fulls = () => usageCalls.filter(c => c === 'full').length
  await $.turn.start({ text: 'go', turnId: 't1' })
  await ui.press({ key: 'tab:context' })
  await settleAll()
  expect(fulls()).toBe(0)
  await mainTurnEnd($)
  await ui.press({ key: 'tab:agents' })
  await ui.press({ key: 'tab:context' })
  await settleAll()
  expect(fulls()).toBe(1)
  await ui.press({ key: 'tab:agents' })
  await ui.press({ key: 'tab:context' })
  await settleAll()
  expect(fulls()).toBe(1)
  await ui.unmount()
})

// ── Phase 9, K5: the Context tab follows the turns ──

const messagesRow = (rows: string[]) => rows.find(r => /^■ Messages/.test(r))?.replace(/ +/g, ' ').trim()
const withMessages = (tokens: number) => ({
  categories: [breakdownRow('System prompt', 8000), breakdownRow('Messages', tokens), breakdownRow('Autocompact buffer', 33_000, 'buffer'), breakdownRow('Free space', 700_000, 'free')],
  totalTokens: 8000 + tokens,
  rawMaxTokens: 1_000_000,
})

test('Context: a turn that ends while the exact count runs is on the tab once the count is over', async ($, on) => {
  const h = holds()
  const options: World = { holdUsage: h.holdUsage, breakdown: withMessages(90_000) }
  const clock = world(on, options)
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await openCockpit($)
  const ui = await mountPane($, 50)
  const releaseFull = h.hold('full')
  await ui.press({ key: 'tab:context' }) // a summary, then the first exact count, held
  await settleAll()
  expect(messagesRow(rowTexts(await ui.drawn()))).toBe('■ Messages 90k 9%')
  // the conversation grows and a turn ends while the count is still running: no read is made for it
  options.breakdown = withMessages(120_000)
  await mainTurnEnd($)
  await clock.advance(5000)
  await settleAll()
  options.breakdown = withMessages(150_000)
  releaseFull() // the count answers with what the conversation held when it started
  await settleAll()
  expect(messagesRow(rowTexts(await ui.drawn()))).toMatch(/^■ Messages 150k 15%/)
  await ui.unmount()
})

// ── Phase 9: Context ──

test('Context: `refresh` waits a minute after a press, with a countdown in its place', async ($, on) => {
  const usageCalls: (string | undefined)[] = []
  const clock = world(on, { usageCalls, breakdown: { categories: CONTEXT_ROWS, totalTokens: 98_000, rawMaxTokens: 1_000_000 } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await openCockpit($)
  const ui = await mountPane($, 50)
  const fulls = () => usageCalls.filter(c => c === 'full').length
  await ui.press({ key: 'tab:context' })
  await settleAll()
  expect(fulls()).toBe(1) // the first opening, idle, counted by itself: no wait for it
  expect((await ui.find({ key: 'ctx:refresh' }))?.text).toBe('refresh')
  await ui.press({ key: 'ctx:refresh' })
  await settleAll()
  expect(fulls()).toBe(2)
  expect(await ui.find({ key: 'ctx:refresh' })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /^refresh \d+s$/ }))?.text).toBe('refresh 60s')
  await clock.advance(20_000)
  await settleAll()
  expect((await ui.find({ type: 'Text', text: /^refresh \d+s$/ }))?.text).toBe('refresh 40s')
  await clock.advance(38_000)
  await settleAll()
  expect((await ui.find({ type: 'Text', text: /^refresh \d+s$/ }))?.text).toBe('refresh 2s')
  expect(fulls()).toBe(2)
  await clock.advance(2000)
  await settleAll()
  expect((await ui.find({ key: 'ctx:refresh' }))?.text).toBe('refresh')
  await ui.press({ key: 'ctx:refresh' })
  await settleAll()
  expect(fulls()).toBe(3)
  await ui.unmount()
})

test('Context: every row carries a background bar in proportion to its share of the window, at least one cell for what is there', () => {
  const row = { name: 'Messages', tokens: 90_000, kind: 'used' as const }
  const barred = (tokens: number) => {
    const spans = categorySpans({ ...row, tokens }, '#fff', '#222', 1_000_000, 48)
    expect(spanWidth(spans)).toBe(48)
    return spans.filter(s => s.bg === '#222').reduce((n, s) => n + [...s.t].length, 0)
  }
  expect(barred(90_000)).toBe(4)
  expect(barred(500_000)).toBe(24)
  expect(barred(100)).toBe(1)
  expect(barred(0)).toBe(0)
})

test('Context: the trend is one line: the bars, where the context went, the growth per round and the rounds left before compaction', async ($, on) => {
  world(on, { autoCompactAt: 150_000 })
  roundHooks(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  for (const tokens of [100_000, 110_000, 120_000]) await contextRound($, tokens, 10)
  const line = (columns: number) => paneRows($, columns, 'context').then(r => r.rows.find(x => /→/.test(x)))
  expect(await line(58)).toBe('▁▅█  100k → 120k (+10k/round), compact in ~3 rounds')
  // too narrow for bars and the whole text: the text goes first, cut at the end
  const narrow = (await line(40)) ?? ''
  expect(narrow.startsWith('100k → 120k (+10k/round)')).toBe(true)
  expect(textCells(narrow)).toBeLessThanOrEqual(38)
})

test('Context: a reload that restarts the read counter does not leave the tab behind the number of the reading the snapshot kept', async ($, on) => {
  const options: World = { breakdown: withMessages(90_000) }
  world(on, options)
  // the snapshot outlives a hot reload and remembers the number of its last read, while the module's own counter starts at zero again
  let isAhead = false
  on('state.get', async (_, e, next) => {
    const answer = await next(e)
    const read = answer.value
    const held: unknown = read?.value
    if (!isAhead || !read || typeof held !== 'object' || held === null || !('contextSeq' in held)) return answer
    return { value: { ...read, value: { ...held, contextSeq: 50 } } }
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 50)
  await ui.press({ key: 'tab:context' })
  await settleAll()
  expect(messagesRow(rowTexts(await ui.drawn()))).toBe('■ Messages 90k 9%')
  isAhead = true
  options.breakdown = withMessages(120_000)
  await ui.press({ key: 'ctx:refresh' })
  await settleAll()
  expect(messagesRow(rowTexts(await ui.drawn()))).toBe('■ Messages 120k 12%')
  await ui.unmount()
})

test('scoping: the refresh cooldown of a session does not hold the next one\'s button', async ($, on) => {
  let id = 's-1'
  const options: World = { breakdown: withMessages(90_000), sessionId: () => id }
  world(on, options)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 50)
  await ui.press({ key: 'tab:context' })
  await settleAll()
  await ui.press({ key: 'ctx:refresh' })
  await settleAll()
  expect(await ui.find({ key: 'ctx:refresh' })).toBeUndefined() // the countdown stands in for it
  id = 's-2'
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await settleAll()
  expect(await ui.find({ key: 'ctx:refresh' })).toBeDefined()
  await ui.unmount()
})

test('Context: in Italian the category names are translated, an unknown one shows as the engine names it, and the block is titled DETTAGLI CONTESTO', async ($, on) => {
  const categories = [breakdownRow('Free space', 700_000, 'free'), breakdownRow('System prompt', 8000), breakdownRow('Messages', 90_000), breakdownRow('Brand new', 1000)]
  world(on, { files: IT_FILE, breakdown: { categories, totalTokens: 99_000, rawMaxTokens: 1_000_000 } })
  try {
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    const rows = (await paneRows($, 50, 'context')).rows
    expect(categoryNames(rows)).toEqual(['Messaggi', 'Prompt di sistema', 'Brand new', 'Spazio libero'])
    expect(rows.some(r => /^DETTAGLI CONTESTO · 99K\/1M/.test(r))).toBe(true)
  } finally {
    setLang('en')
  }
})
