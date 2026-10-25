import { expect, test } from 'claude-code/testing'

import { TABS } from '../hooks/session'
import { setLang } from '../hooks/strings'
import {
  IT_FILE,
  MIN,
  RED,
  barLabels,
  colorOf,
  createTask,
  headerOf,
  mountPane,
  openCockpit,
  paneRows,
  settleAll,
  tabsAt,
  taskRows,
  updateTask,
} from './cockpit-fixtures'
import { PANE, flagOf, iso, rowTexts, world } from './cockpit-world'
import type { World } from './cockpit-world'

/** The left margin of the drawn root: the column its content starts at. */
const marginOf = (root: unknown): number => (root as { props?: { marginLeft?: number } }).props?.marginLeft ?? 0

test('the pane shows header, context, credits and an agent that finished before its spawn was noted', async ($, on) => {
  world(on)
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'a1' }))
  on('turn.complete', () => ({ text: '' }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  // the agent's own events can outrun the spawn's bookkeeping: they must not be lost
  await $.turn.complete({
    answer: '',
    durationMs: 1,
    isAborted: false,
    turnId: 'a1-turn',
    agentId: 'a1',
    reason: 'answer',
    usage: { input_tokens: 30_000, output_tokens: 8_000, cache_read_input_tokens: 90_000, cache_creation_input_tokens: 0, model: 'm' },
  })
  await $.agent.spawn({
    tool_use_id: 't1',
    prompt: 'review',
    description: 'review',
    subagentType: 'code-reviewer',
    provider: { plugin: 'engine', tier: 'core' },
    model: 'fable',
    parentModel: 'claude-opus-5-5',
    background: true,
    fork: false,
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const text = async (re: RegExp) => (await ui.find({ type: 'Text', text: re }))?.text
    expect(await text(/Opus 5\.5/)).toContain('Opus 5.5')
    expect(await text(/example-repo/)).toContain('example-repo')
    expect(await text(/^\+1 ~1 \?1$/)).toBe('+1 ~1 ?1')
    expect(await text(/25% 248K\/1M/)).toBe(' 25% 248K/1M')
    expect(await text(/^ 62% 5h/)).toBe(' 62% 5h \u21bb  2h14m')
    expect(await text(/^ 41% 7d/)).toMatch(/^ 41% 7d \u21bb  3d\d\dh$/)
    expect(await text(/vs expected/)).toBe('vs expected 7d  \u22125%')
    // Subagents is the tab the pane opens on: the row is one pressable Button: its text is the whole row
    const row = (await ui.find({ key: 'agent:a1' }))?.text
    expect(row).toContain('\u2713 code-reviewer')
    expect(await text(/son 5\.5/)).toContain('son 5.5')
    // the four counters are one press away: collapsed on the first mount, open once pressed (the state outlives a mount)
    const toggle = (await ui.find({ key: 'usage:a1' }))?.text ?? ''
    expect(toggle).toMatch(/^ +[▸▾] tokens$/)
    if (toggle.includes('▸')) {
      expect(await text(/^ *in 30k/)).toBeUndefined()
      await ui.press({ key: 'usage:a1' })
    }
    expect(await text(/^ *in 30k/)).toContain('out 8k  cr 90k')
    expect(await text(/asked/)).toContain('asked fable \u2192 sonnet')
    expect(await text(/SUBAGENTS/)).toBe('SUBAGENTS \u00b7 0 running')
    await ui.unmount()
  }
})

test('the pane has no close button of its own: the tab bar and the buttons row are its only buttons', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const keys = (await ui.findAll({ type: 'Button' })).map(b => b.key)
  expect(keys).toEqual(['tab:agents', 'tab:context', 'tab:signals', 'tab:work', 'tab:notes', 'bar:compact', 'bar:suite', 'bar:summary'])
  await ui.unmount()
})

test('the cost is shown at zero and the context reads 0% 0/1M before the first response', async ($, on) => {
  world(on, { isFresh: true })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const text = async (re: RegExp) => (await ui.find({ type: 'Text', text: re }))?.text
  expect(await text(/^\$0\.00$/)).toBe('$0.00')
  expect(await text(/^ {2}0% /)).toBe('  0% 0/1M')
  await ui.unmount()
})

test('a rule closes the header and the tab bar, and sets the SUBAGENTS title (after an empty row) apart from them', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const rows = rowTexts(await ui.drawn())
  const [, , first = -1, second = -1] = rows.flatMap((r, i) => (/^\u2500+$/.test(r) ? [i] : []))
  const title = rows.findIndex(r => /^SUBAGENTS/.test(r))
  // header, rule, tab bar, rule, then the tab's own content: an empty row first
  expect(first).toBe(headerOf(rows).length)
  expect(second).toBeGreaterThan(first + 1) // the six labels wrap to a second row where the pane is narrow
  expect(rows[second + 1]).toBe(' ') // the tab's own content starts with an empty row (Ora: Claude's state first)
  expect(title).toBeGreaterThan(second + 1)
  expect(rows[title - 1]).toBe(' ')
  await ui.unmount()
})

test('the header holds the context bar and its readout, with no session-share line', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const rows = rowTexts(await ui.drawn())
  expect(headerOf(rows).some(r => /25% 248K\/1M/.test(r))).toBe(true)
  expect(rows.some(r => /sessione/.test(r))).toBe(false)
  await ui.unmount()
})

test('the pane opens 60 columns wide; in a wider dock its block stops at 60 (58 of content between its margins) and the empty space is on the left', async ($, on) => {
  const openedColumns: (number | undefined)[] = []
  world(on, { openedColumns })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'cockpit', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 80 } })
  expect(openedColumns).toEqual([60])

  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 90 }, surface: 'terminal' })
  const root = await ui.drawn()
  const rules = rowTexts(root).filter(r => /^─+$/.test(r))
  expect(rules.length).toBeGreaterThan(0)
  for (const r of rules) expect([...r].length).toBe(58)
  // the 60-column block is pushed right: it starts at column 30 of 90
  expect(marginOf(root)).toBe(30)
  await ui.unmount()

  const narrow = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 50 }, surface: 'terminal' })
  const narrowRoot = await narrow.drawn()
  for (const r of rowTexts(narrowRoot).filter(r => /^─+$/.test(r))) expect([...r].length).toBe(48)
  expect(marginOf(narrowRoot)).toBe(0)
  await narrow.unmount()
})

test('deltas count from the turn start', async ($, on) => {
  world(on)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('session.measure', (_, e) => ({ changed: e.changed }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.session.measure({
    context: { window: 1_000_000, tokens: 260_000, percent: 26 },
    rateLimits: [],
    cost: { usd: 5.2 },
    changed: ['context', 'cost'],
  })
  await $.turn.complete({
    answer: '',
    durationMs: 1,
    isAborted: false,
    turnId: 't1',
    reason: 'answer',
    usage: { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 199_900, cache_creation_input_tokens: 0, model: 'm' },
  })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const text = async (re: RegExp) => (await ui.find({ type: 'Text', text: re }))?.text
  expect(await text(/^\$5\.20/)).toContain('$5.20')
  expect(await text(/^\+0\.38/)).toBe('+0.38')
  expect(await text(/^ 26% /)).toBe(' 26% 260K/1M +12K')
  await ui.unmount()
})

test('a TaskUpdate that answers success:false changes nothing', async ($, on) => {
  world(on)
  on('tool.call', { tool: 'TaskCreate' }, (_, e) => ({ result: { task: { id: '1', subject: e.subject } } }))
  on('tool.call', { tool: 'TaskUpdate' }, (_, e) => ({ result: { success: false, taskId: e.taskId, updatedFields: [], error: 'no such task' } }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await createTask($, 'Only one')
  await updateTask($, '1', 'completed')
  await updateTask($, '2', 'in_progress')
  const { rows, i } = await taskRows($)
  expect(rows[i]).toMatch(/^TASK · 0\/1◐ 0 {2}○ 1 {2}✓ 0$/)
})

const GREEN = '#7ec699'

test('percentages are right-aligned: 87% and 7% start their label in the same column, context included', async ($, on) => {
  world(on, {
    rateLimits: [
      { kind: 'five_hour', percentUsed: 13, resetsAt: iso(2 * 60 * MIN) },
      { kind: 'seven_day', percentUsed: 93, resetsAt: iso(2 * 24 * 60 * MIN) },
    ],
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const { rows } = await paneRows($)
  const five = rows.find(r => /87% 5h/.test(r))
  const seven = rows.find(r => /7% 7d/.test(r))
  const context = rows.find(r => /25% 248K/.test(r))
  expect(five).toMatch(/^[▰▱]+ 87% 5h/)
  expect(seven).toMatch(/^[▰▱]+ {2}7% 7d/)
  expect(seven?.indexOf('%')).toBe(five?.indexOf('%'))
  expect(context?.indexOf('%')).toBe(five?.indexOf('%'))
})

test('percentages are right-aligned with three digits too: 100% and 87% start their label in the same column', async ($, on) => {
  world(on, {
    rateLimits: [
      { kind: 'five_hour', percentUsed: 0, resetsAt: iso(5 * 60 * MIN) },
      { kind: 'seven_day', percentUsed: 13, resetsAt: iso(2 * 24 * 60 * MIN) },
    ],
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const { rows } = await paneRows($)
  const five = rows.find(r => /100% 5h/.test(r))
  const seven = rows.find(r => /87% 7d/.test(r))
  expect(five).toMatch(/^[▰▱]+100% 5h/)
  expect(seven).toMatch(/^[▰▱]+ 87% 7d/)
  expect(seven?.indexOf('%')).toBe(five?.indexOf('%'))
})

test('cache share: the last main-loop turn, right of CONTEXT; a subagent turn and an empty one do not set it', async ($, on) => {
  world(on)
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const complete = (usage: { input: number; read: number; write: number }, agentId?: string) =>
    $.turn.complete({
      answer: '',
      durationMs: 1,
      isAborted: false,
      turnId: 't',
      reason: 'answer',
      ...(agentId ? { agentId } : {}),
      usage: {
        input_tokens: usage.input,
        output_tokens: 7,
        cache_read_input_tokens: usage.read,
        cache_creation_input_tokens: usage.write,
        model: 'm',
      },
    })
  // the title row reads as its text joined with the right side: CONTEXT, then the cache share
  const title = async () => (await paneRows($)).rows.find(r => /^CONTEXT.*cache/.test(r))?.slice('CONTEXT'.length)

  expect(await title()).toBeUndefined()
  await complete({ input: 600, read: 94_000, write: 5_400 }, 'a1')
  expect(await title()).toBeUndefined()
  await complete({ input: 0, read: 0, write: 0 })
  expect(await title()).toBeUndefined()
  await complete({ input: 600, read: 94_000, write: 5_400 })
  expect(await title()).toBe('cache  94%')
  await complete({ input: 9_000, read: 500, write: 500 })
  expect(await title()).toBe('cache   5%')
})

// ── The header's context warning ──

test('the context line at 80% or more is red, with no button of its own', async ($, on) => {
  world(on, { ctxPercent: 87 })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^⚠ context at 87%$/ })).toBeDefined()
  expect(colorOf(await ui.drawn(), /^⚠ context at 87%$/)).toBe(RED)
  expect(await ui.find({ key: 'compact-now' })).toBeUndefined()
  expect((await ui.findAll({ type: 'Button' })).some(b => /compact ora/.test(b.text ?? ''))).toBe(false)
  await ui.unmount()
})

test('below 80% there is no warning; 80% exactly has it', async ($, on) => {
  const clock = world(on, { ctxPercent: 79 })
  on('session.measure', (_, e) => ({ changed: e.changed }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  let ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^⚠/ })).toBeUndefined()
  await ui.unmount()
  await clock.advance(1)
  await $.session.measure({ context: { window: 1_000_000, tokens: 800_000, percent: 80 }, rateLimits: [], cost: { usd: 5 }, changed: ['context'] })
  ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^⚠ context at 80%$/ })).toBeDefined()
  await ui.unmount()
})

// ── Phase 1 follow-ups ──

test('a session start (/clear) forgets the cache share', async ($, on) => {
  let id = 's-1'
  world(on, { sessionId: () => id })
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.complete({
    answer: '',
    durationMs: 1,
    isAborted: false,
    turnId: 't',
    reason: 'answer',
    usage: { input_tokens: 600, output_tokens: 7, cache_read_input_tokens: 94_000, cache_creation_input_tokens: 5_400, model: 'm' },
  })
  const before = (await paneRows($)).rows
  expect(before.some(r => /^CONTEXT.*cache {2}94%/.test(r))).toBe(true)

  id = 's-2'
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const after = (await paneRows($)).rows
  expect(after.some(r => /cache/.test(r))).toBe(false)
})

test('layout: the content is min(bodyColumns, 60) - 2 wide with one column of margin each side, at 40, 58 and 80 columns', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  // [bodyColumns, drawn block width, empty columns on its left]
  for (const [columns, block, left] of [[40, 40, 0], [58, 58, 0], [80, 60, 20]] as const) {
    const { root, rows } = await paneRows($, columns)
    const props = (root as { props?: { width?: number; paddingX?: number } }).props
    expect(props?.width).toBe(block)
    expect(props?.paddingX).toBe(1)
    expect(marginOf(root)).toBe(left)
    const rules = rows.filter(r => /^─+$/.test(r))
    expect(rules.length).toBeGreaterThan(0)
    for (const r of rules) expect([...r].length).toBe(block - 2)
    // no row of the header is wider than the content
    for (const r of headerOf(rows)) expect([...r].length).toBeLessThanOrEqual(block - 2)
  }
})

test('header: above the tab bar on every tab, with the model, effort, state, session cost and the git, context, credit and cache rows', async ($, on) => {
  world(on, { upstream: 'origin/feature/x [ahead 2, behind 1]' })
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.complete({
    answer: '',
    durationMs: 1,
    isAborted: false,
    turnId: 't',
    reason: 'answer',
    usage: { input_tokens: 600, output_tokens: 7, cache_read_input_tokens: 94_000, cache_creation_input_tokens: 5_400, model: 'm' },
  })
  for (const tab of TABS) {
    const header = headerOf((await paneRows($, 50, tab)).rows)
    expect(header[0]).toMatch(/^Opus 5\.5/)
    expect(header[0]).toContain('HIGH')
    expect(header[0]).toContain('ready')
    expect(header[0]).toContain('$4.82')
    expect(header.some(r => /example-repo/.test(r) && /feature\/x/.test(r) && /↑2 ↓1/.test(r))).toBe(true)
    expect(header.some(r => /\+1 ~1 \?1/.test(r))).toBe(true)
    expect(header.some(r => /25% 248K\/1M/.test(r))).toBe(true)
    expect(header.some(r => /5h/.test(r))).toBe(true)
    expect(header.some(r => /7d/.test(r))).toBe(true)
    expect(header.some(r => /cache {2}94%/.test(r))).toBe(true)
  }
})

test('header: the last round cost sits beside the session cost', async ($, on) => {
  world(on)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.session.measure({ context: { window: 1_000_000, tokens: 260_000, percent: 26 }, rateLimits: [], cost: { usd: 5.2 }, changed: ['context', 'cost'] })
  const [first] = headerOf((await paneRows($)).rows)
  expect(first).toMatch(/\$5\.20 \+0\.38$/)
})

test('header: the folder icon of a folder that is not a repository is U+F024B', async ($, on) => {
  world(on, { notRepo: true })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const row = headerOf((await paneRows($)).rows).find(r => /example-repo/.test(r))
  expect(row).toContain('\u{F024B} example-repo')
})

test('header: the folder icon of a repository is U+F0CCF', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const row = headerOf((await paneRows($)).rows).find(r => /example-repo/.test(r))
  expect(row).toContain('\u{F0CCF} example-repo')
})

test('header: the folder icon of a linked worktree is U+F0CD0', async ($, on) => {
  world(on, { isLinkedWorktree: true })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const row = headerOf((await paneRows($)).rows).find(r => /example-repo/.test(r))
  expect(row).toContain('\u{F0CD0} example-repo')
})

test('header: the cache hit is green from 80 %, amber from 50 to 79, red below 50', async ($, on) => {
  world(on)
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const complete = (read: number, other: number) =>
    $.turn.complete({
      answer: '',
      durationMs: 1,
      isAborted: false,
      turnId: 't',
      reason: 'answer',
      usage: { input_tokens: other, output_tokens: 7, cache_read_input_tokens: read, cache_creation_input_tokens: 0, model: 'm' },
    })
  await complete(94, 6)
  expect(colorOf((await paneRows($)).root, /^ 94%$/)).toBe(GREEN)
  await complete(60, 40)
  expect(colorOf((await paneRows($)).root, /^ 60%$/)).toBe('#e8a35a')
  await complete(20, 80)
  expect(colorOf((await paneRows($)).root, /^ 20%$/)).toBe(RED)
})

test('header: the autocompact forecast is the requests left at the recent growth; the threshold is read once, with a summary breakdown', async ($, on) => {
  const usageCalls: (string | undefined)[] = []
  world(on, { autoCompactAt: 400_000, usageCalls })
  on('turn.complete', () => ({ text: '' }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  // The context is what the engine measured; the turn's usage sums its requests (`steps` of them), so it is `steps` times the context.
  const complete = async (context: number, steps: number, agentId?: string) => {
    if (!agentId) await $.session.measure({ context: { window: 1_000_000, tokens: context, percent: 20 }, rateLimits: [], changed: ['context'] })
    await $.turn.complete({
      answer: '',
      durationMs: 1,
      isAborted: false,
      turnId: 't',
      reason: 'answer',
      ...(agentId ? { agentId } : {}),
      usage: { input_tokens: 0, output_tokens: 7, cache_read_input_tokens: context * steps, cache_creation_input_tokens: 0, model: 'm' },
    })
  }
  const forecast = async () => headerOf((await paneRows($)).rows).find(r => /requests/.test(r))
  await complete(200_000, 8)
  expect(await forecast()).toBeUndefined() // one turn: no growth to average
  await complete(210_000, 1) // a one-request turn after an eight-request one is not a compaction
  await complete(990_000, 3, 'a1') // a subagent's turn is not the main loop's growth
  await complete(220_000, 5)
  expect(await forecast()).toContain('~18 requests') // 180k left at 10k a turn
  expect(usageCalls.filter(c => c === 'summary')).toHaveLength(1)
})

test('header: the autocompact threshold survives a /clear: the forecast is still drawn', async ($, on) => {
  let id = 's-1'
  world(on, { autoCompactAt: 400_000, sessionId: () => id })
  on('turn.complete', () => ({ text: '' }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  id = 's-2'
  await $.session.end({ reason: 'clear', sessionId: 's-1', resume: { id: 's-1' } }) // no session start follows
  for (const context of [200_000, 210_000, 220_000]) {
    await $.session.measure({ context: { window: 1_000_000, tokens: context, percent: 20 }, rateLimits: [], changed: ['context'] })
    await $.turn.complete({
      answer: '',
      durationMs: 1,
      isAborted: false,
      turnId: 't',
      reason: 'answer',
      usage: { input_tokens: 0, output_tokens: 7, cache_read_input_tokens: context, cache_creation_input_tokens: 0, model: 'm' },
    })
  }
  expect(headerOf((await paneRows($)).rows).some(r => /~18 requests/.test(r))).toBe(true)
})

test('header: no forecast when auto-compaction is off', async ($, on) => {
  world(on)
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  for (const tokens of [200_000, 210_000, 220_000]) {
    await $.turn.complete({
      answer: '',
      durationMs: 1,
      isAborted: false,
      turnId: 't',
      reason: 'answer',
      usage: { input_tokens: 0, output_tokens: 7, cache_read_input_tokens: tokens, cache_creation_input_tokens: 0, model: 'm' },
    })
  }
  expect(headerOf((await paneRows($)).rows).some(r => /requests/.test(r))).toBe(false)
})

// A tab a state file of an earlier version holds goes where its content went.
for (const [saved, shown] of [
  ['session', 'tab:agents'],
  ['repo', 'tab:work'],
  ['system', 'tab:work'],
  ['insights', 'tab:context'],
  ['context', 'tab:context'],
] as const) {
  test(`a saved tab ${saved} brings back ${shown}, and the state file writes it that way`, async ($, on) => {
    const writes = new Map<string, string>()
    world(on, { writes, stateFile: JSON.stringify({ open: false, tab: saved }) })
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    const ui = await mountPane($, 58)
    const selected = (await ui.findAll({ type: 'Button' })).filter(b => /^tab:/.test(b.key ?? '') && b.props.variant === 'primary').map(b => b.key)
    expect(selected).toEqual([shown])
    expect(flagOf(writes)).toMatchObject({ tab: shown.slice(4) })
    await ui.unmount()
  })
}

// ── Phase 3 follow-ups ──

test('follow-up: opening the pane on the Context tab does not wait for the breakdown read', async ($, on) => {
  let gate: Promise<void> | undefined
  world(on, { stateFile: JSON.stringify({ open: false, tab: 'context' }), holdUsage: () => gate })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  let release = () => {}
  gate = new Promise<void>(resolve => (release = resolve))
  let isOpened = false
  const opening = openCockpit($).then(() => {
    isOpened = true
  })
  await settleAll()
  expect(isOpened).toBe(true) // the read is still held
  release()
  await opening
  await settleAll()
})

test('header: the last round duration sits beside the round cost, from the main turn only', async ($, on) => {
  world(on)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.session.measure({ context: { window: 1_000_000, tokens: 260_000, percent: 26 }, rateLimits: [], cost: { usd: 5.2 }, changed: ['context', 'cost'] })
  expect(headerOf((await paneRows($)).rows)[0]).toMatch(/\$5\.20 \+0\.38$/) // no round finished yet
  await $.turn.complete({ answer: '', durationMs: 134_000, isAborted: false, turnId: 't1', reason: 'answer' })
  expect(headerOf((await paneRows($)).rows)[0]).toMatch(/\$5\.20 \+0\.38 · 2m14s$/)
  await $.turn.complete({ answer: '', durationMs: 5000, isAborted: false, turnId: 'a-t', reason: 'answer', agentId: 'a9' })
  expect(headerOf((await paneRows($)).rows)[0]).toMatch(/\$5\.20 \+0\.38 · 2m14s$/)
})

test('header: CONTEXT and CREDITS each have an empty row before and after the title, the cache share and the week pace right of it, and no burn line', async ($, on) => {
  world(on)
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.complete({
    answer: '',
    durationMs: 1,
    isAborted: false,
    turnId: 't',
    reason: 'answer',
    usage: { input_tokens: 600, output_tokens: 7, cache_read_input_tokens: 94_000, cache_creation_input_tokens: 5_400, model: 'm' },
  })
  const { rows } = await paneRows($, 58)
  const at = (re: RegExp) => rows.findIndex(r => re.test(r))
  const context = at(/^CONTEXT/)
  const credits = at(/^CREDITS/)
  expect(rows[context]).toBe('CONTEXTcache  94%')
  expect(rows[context - 1]).toBe(' ')
  expect(rows[context - 2]).toMatch(/^─+$/) // a rule between the model / ALM block and the CONTEXT block
  expect(rows[context + 1]).toBe(' ')
  expect(rows[context + 2]).toMatch(/^[▰▱]+ 25% 248K\/1M$/)
  expect(rows[credits]).toBe('CREDITSvs expected 7d  \u22125%')
  expect(rows[credits - 1]).toBe(' ')
  expect(rows[credits - 2]).toMatch(/^─+$/) // and one between the CONTEXT and the CREDITS block
  expect(rows[credits + 1]).toBe(' ')
  expect(rows[credits + 2]).toMatch(/ 62% 5h/)
  expect(rows[credits + 3]).toBe(' ') // the two windows are told apart by an empty row
  expect(rows[credits + 4]).toMatch(/ 41% 7d/)
  expect(rows.some(r => /runs out/.test(r))).toBe(false)
})


/** What each language draws on a 58-column pane with one day of worklog pending: the tab labels, the buttons row, the header titles and a title or empty state of every tab. */
const LANGUAGES = [
  {
    name: 'English',
    files: {},
    tabs: barLabels({ work: ' ●' }),
    bareTabs: () => barLabels(),
    buttons: { compact: 'compact', save: 'save', edit: 'edit', send: 'send', delete: 'delete' },
    header: [/^CONTEXT/, /^CREDITS/, /vs expected 7d/],
    byTab: { agents: [/^SUBAGENTS · 0 running/], context: [/^CONTEXT DETAILS · 248K\/1M/], signals: [/^no notifications/], work: [/^MAIN$/, /^CHANGES · 0$/, /^no changes$/, /^● worklog: 1d to log/], notes: [/^NOTES · 1$/, /^ask Anna/] },
  },
  {
    name: 'Italian',
    files: IT_FILE,
    tabs: barLabels({ work: ' ●' }, 'it'),
    bareTabs: () => barLabels({}, 'it'),
    buttons: { compact: 'compatta', save: 'salva', edit: 'modifica', send: 'invia', delete: 'elimina' },
    header: [/^CONTESTO/, /^CREDITI RESIDUI/, /rispetto all'atteso 7d/],
    byTab: { agents: [/^SUBAGENTI · 0 in corso/], context: [/^DETTAGLI CONTESTO · 248K\/1M/], signals: [/^nessuna notifica/], work: [/^PRINCIPALE$/, /^MODIFICHE · 0$/, /^nessuna modifica$/, /^● worklog: 1g da registrare/], notes: [/^NOTE · 1$/, /^ask Anna/] },
  },
]

for (const language of LANGUAGES) {
  test(`${language.name}: the tabs, buttons, header and every tab's titles at 58 columns`, async ($, on) => {
    const options: World = { files: language.files, hasWorklog: true, dataFile: JSON.stringify({ history: [], prs: [], notes: [{ id: 1, text: 'ask Anna' }] }) }
    world(on, options)
    try {
      await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

      const { labels } = await tabsAt($, 58)
      expect(labels).toEqual(language.tabs)
      const ui = await mountPane($, 58)
      expect((await ui.find({ key: 'bar:compact' }))?.text).toBe(language.buttons.compact)
      await ui.press({ key: 'tab:notes' })
      for (const [key, text] of [['note:save', language.buttons.save], ['note:edit:1', language.buttons.edit], ['note:send:1', language.buttons.send], ['note:delete:1', language.buttons.delete]] as const) {
        expect((await ui.find({ key }))?.text).toBe(text)
      }
      await ui.unmount()

      for (const [tab, patterns] of Object.entries(language.byTab)) {
        const { rows } = await paneRows($, 58, tab)
        for (const re of [...language.header, ...patterns]) expect(rows.some(r => re.test(r))).toBe(true)
      }
      // without the dot
      options.hasWorklog = false
      await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
      const bare = await tabsAt($, 58)
      expect(bare.labels).toEqual(language.bareTabs()) // the tab the loop above ended on
    } finally {
      setLang('en')
    }
  })
}
