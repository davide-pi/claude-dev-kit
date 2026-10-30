import { expect, test } from 'claude-code/testing'

import { TABS, isWorking } from '../hooks/session'
import { setLang } from '../hooks/strings'
import {
  IT_FILE,
  MIN,
  RED,
  barLabels,
  colorOf,
  createTask,
  headerOf,
  measureWith,
  mountPane,
  openCockpit,
  paneRows,
  settleAll,
  tabsAt,
  taskRows,
  updateTask,
} from './cockpit-fixtures'
import { NOW, PANE, flagOf, iso, rowTexts, world } from './cockpit-world'
import { textCells } from '../hooks/shared'
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
    // the readout keeps its cells: the tokens are right-aligned in theirs
    expect(rowTexts(await ui.drawn()).find(r => /^CTX /.test(r))).toMatch(/^CTX [\u25b0\u25b1]+ {2}25% {3}248K\/1M/)
    // the two credit windows share one row: label, bar, remaining, reset countdown
    expect(rowTexts(await ui.drawn()).find(r => /^5h /.test(r))).toMatch(/^5h [\u25b0\u25b1]+ {2}62% \u21bb +2h14m \u00b7 7d [\u25b0\u25b1]+ {2}41% \u21bb +3d\d\dh$/)
    // Subagents is the tab the pane opens on: the row is one pressable Button: its text is the whole row, the model a word
    const row = (await ui.find({ key: 'agent:a1' }))?.text
    expect(row).toContain('󰄬 code-reviewer')
    expect(row).toContain('son 5.5')
    // the rest (the four counters) is one press away: collapsed on the first mount, open once pressed (the state outlives a mount)
    if ((await text(/^ *in 30k/)) === undefined) await ui.press({ key: 'agent:a1' })
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
  expect(keys).toEqual(['tab:agents', 'tab:context', 'tab:signals', 'tab:work', 'tab:notes', 'bar:compact', 'bar:retro', 'bar:worklog'])
  await ui.unmount()
})

test('the cost is shown at zero and the context reads 0% 0/1M before the first response', async ($, on) => {
  world(on, { isFresh: true })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const text = async (re: RegExp) => (await ui.find({ type: 'Text', text: re }))?.text
  expect(await text(/^\$0\.00$/)).toBe('$0.00')
  // no cache hit yet: its cells stay blank, so the bar keeps the length it has once there is one
  expect(rowTexts(await ui.drawn()).find(r => /^CTX /.test(r))).toMatch(/^CTX [▰▱]+ {3}0% {6}0\/1M {10}$/)
  await ui.unmount()
})

test('CTX bar: a tick where the engine compacts, on both surfaces', async ($, on) => {
  world(on, { autoCompactAt: 150_000 })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const bar = rowTexts(await ui.drawn()).find(r => /^CTX /.test(r))?.match(/^CTX ([▰▱┃]+)/)?.[1] ?? ''
    // 150k of the 1M window: the tick at 15% of the bar
    expect([...bar].filter(c => c === '┃')).toHaveLength(1)
    expect([...bar].indexOf('┃')).toBe(Math.min(bar.length - 1, Math.round(0.15 * bar.length)))
    await ui.unmount()
  }
})

test('CTX bar: no tick when the engine reports no autocompact threshold', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(rowTexts(await ui.drawn()).find(r => /^CTX /.test(r))).not.toContain('┃')
  await ui.unmount()
})

test('a rule closes the header and the tab bar, and sets the SUBAGENTS title (after an empty row) apart from them', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const rows = rowTexts(await ui.drawn())
  const [, first = -1, second = -1] = rows.flatMap((r, i) => (/^\u2500+$/.test(r) ? [i] : []))
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
  expect(headerOf(rows).some(r => /25% +248K\/1M/.test(r))).toBe(true)
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
  expect(await text(/^\$5\.20$/)).toBe('$5.20')
  // the round's cost is on the row under the credits, not beside the session cost; the token growth is shown nowhere
  const rows = rowTexts(await ui.drawn())
  expect(rows.find(r => /^CTX /.test(r))).toMatch(/^CTX [▰▱]+ {2}26% {3}260K\/1M/)
  expect(rows.find(r => /^CTX /.test(r))).not.toContain('+12K')
  expect(rows.find(r => /^turn /.test(r))).toMatch(/^turn +\$\+0\.38 · pace 7d/)
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
  expect(rows[i]).toMatch(/^TASK · 0\/1󱎖 0 {2}󰄰 1 {2}󰄬 0$/)
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
  // both windows share one row, each half drawn the same width: the 7d percent sits one half after the 5h one
  const credits = rows.find(r => /^5h /.test(r)) ?? ''
  expect(credits).toMatch(/^5h [▰▱]+ {2}87% .* · 7d [▰▱]+ {3}7% /)
  const [five, seven] = [credits.indexOf('87%'), credits.indexOf('7%', credits.indexOf(' 7d '))]
  expect(seven - credits.indexOf(' · 7d ') - 3).toBe(five + 1)
})

test('percentages are right-aligned with three digits too: 100% fills the cell the two-digit 87% pads', async ($, on) => {
  world(on, {
    rateLimits: [
      { kind: 'five_hour', percentUsed: 0, resetsAt: iso(5 * 60 * MIN) },
      { kind: 'seven_day', percentUsed: 13, resetsAt: iso(2 * 24 * 60 * MIN) },
    ],
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const { rows } = await paneRows($)
  const credits = rows.find(r => /^5h /.test(r)) ?? ''
  expect(credits).toMatch(/^5h [▰▱]+ 100% .* · 7d [▰▱]+ {2}87% /)
})

test('cache share: the last main-loop turn, at the end of the CTX row; a subagent turn and an empty one do not set it', async ($, on) => {
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
  // the CTX row ends with the cache share
  const title = async () => (await paneRows($)).rows.find(r => /^CTX .*\u{F09D1}/u.test(r))?.replace(/^.* (?=\u{F09D1})/u, '')

  expect(await title()).toBeUndefined()
  await complete({ input: 600, read: 94_000, write: 5_400 }, 'a1')
  expect(await title()).toBeUndefined()
  await complete({ input: 0, read: 0, write: 0 })
  expect(await title()).toBeUndefined()
  await complete({ input: 600, read: 94_000, write: 5_400 })
  expect(await title()).toBe('\u{F09D1}  94%')
  await complete({ input: 9_000, read: 500, write: 500 })
  expect(await title()).toBe('\u{F09D1}   5%')
})

// ── The header's context warning ──

test('the context line at 80% or more is red, with no button of its own', async ($, on) => {
  world(on, { ctxPercent: 87 })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^󰀦 context at 87%$/ })).toBeDefined()
  expect(colorOf(await ui.drawn(), /^󰀦 context at 87%$/)).toBe(RED)
  expect(await ui.find({ key: 'compact-now' })).toBeUndefined()
  expect((await ui.findAll({ type: 'Button' })).some(b => /compact ora/.test(b.text ?? ''))).toBe(false)
  await ui.unmount()
})

test('below 80% there is no warning; 80% exactly has it', async ($, on) => {
  const clock = world(on, { ctxPercent: 79 })
  on('session.measure', (_, e) => ({ changed: e.changed }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  let ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^󰀦/ })).toBeUndefined()
  await ui.unmount()
  await clock.advance(1)
  await $.session.measure({ context: { window: 1_000_000, tokens: 800_000, percent: 80 }, rateLimits: [], cost: { usd: 5 }, changed: ['context'] })
  ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^󰀦 context at 80%$/ })).toBeDefined()
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
  expect(before.some(r => /^CTX .*\u{F09D1} {2}94%$/u.test(r))).toBe(true)

  id = 's-2'
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const after = (await paneRows($)).rows
  expect(after.some(r => /\u{F09D1}/u.test(r))).toBe(false)
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
    expect(header.some(r => /example-repo/.test(r) && /feature\/x/.test(r) && /󰁝2 󰁅1/.test(r))).toBe(true)
    expect(header.some(r => /\+1 ~1 \?1/.test(r))).toBe(true)
    expect(header.some(r => /25% +248K\/1M/.test(r))).toBe(true)
    expect(header.some(r => /5h/.test(r))).toBe(true)
    expect(header.some(r => /7d/.test(r))).toBe(true)
    expect(header.some(r => /\u{F09D1} {2}94%/u.test(r))).toBe(true)
  }
})

test('header: the last round cost is on the trend row, the session cost alone on the first line', async ($, on) => {
  world(on)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.session.measure({ context: { window: 1_000_000, tokens: 260_000, percent: 26 }, rateLimits: [], cost: { usd: 5.2 }, changed: ['context', 'cost'] })
  const header = headerOf((await paneRows($)).rows)
  expect(header[0]).toMatch(/\$5\.20$/)
  expect(header[0]).not.toContain('0.38')
  expect(header.find(r => /^turn /.test(r))).toMatch(/^turn +\$\+0\.38 · pace 7d/)
})

for (const order of ['end, measure', 'measure, end', 'end, next start, measure'] as const) {
  test(`header: the trend row keeps the last turn's cost while the next one runs (${order})`, async ($, on) => {
    world(on)
    on('turn.start', (_, e) => ({ turnId: e.turnId }))
    on('session.measure', (_, e) => ({ changed: e.changed }))
    on('turn.complete', () => ({ text: '' }))
    const measure = (usd: number) => $.session.measure({ context: { window: 1_000_000, tokens: 260_000, percent: 26 }, rateLimits: [], cost: { usd }, changed: ['context', 'cost'] })
    const end = (turnId: string) => $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId, reason: 'answer' })
    const trend = async () => headerOf((await paneRows($)).rows).find(r => /^turn /.test(r))
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    await $.turn.start({ text: 'go', turnId: 't1' })
    if (order === 'measure, end') await measure(5.2)
    await end('t1')
    if (order === 'end, measure') await measure(5.2)
    await $.turn.start({ text: 'next', turnId: 't2' })
    if (order === 'end, next start, measure') await measure(5.2)
    expect(await trend()).toMatch(/^turn +\$\+0\.38 /)
    await measure(5.5)
    expect(await trend()).toMatch(/^turn +\$\+0\.30 /)
  })
}

for (const order of ['measure, end', 'end only'] as const) {
  test(`header: a new session (/clear) does not show the previous session's turn cost (${order})`, async ($, on) => {
    let id = 's-1'
    world(on, { sessionId: () => id })
    on('turn.start', (_, e) => ({ turnId: e.turnId }))
    on('session.measure', (_, e) => ({ changed: e.changed }))
    on('turn.complete', () => ({ text: '' }))
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    await $.turn.start({ text: 'go', turnId: 't1' })
    if (order === 'measure, end') await $.session.measure({ context: { window: 1_000_000, tokens: 260_000, percent: 26 }, rateLimits: [], cost: { usd: 5.2 }, changed: ['context', 'cost'] })
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
    id = 's-2'
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    const trend = headerOf((await paneRows($)).rows).find(r => /^turn /.test(r)) ?? ''
    expect(trend).not.toMatch(/\$\+\d/)
  })
}

test('header: the folder icon of a folder that is not a repository is U+F024B', async ($, on) => {
  world(on, { notRepo: true })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const row = headerOf((await paneRows($)).rows).find(r => /example-repo/.test(r))
  expect(row).toContain('\u{F024B} example-repo')
})

test('header: the folder icon of a repository is U+F024B too', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const row = headerOf((await paneRows($)).rows).find(r => /example-repo/.test(r))
  expect(row).toContain('\u{F024B} example-repo')
})

test('header: the folder icon of a linked worktree is U+F024B too', async ($, on) => {
  world(on, { isLinkedWorktree: true })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const row = headerOf((await paneRows($)).rows).find(r => /example-repo/.test(r))
  expect(row).toContain('\u{F024B} example-repo')
})

test('header: the folder is a Link to the worktree root as a file:// address, keeping its name', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mountPane($)
  const link = (await ui.findAll({ type: 'Link' })).find(l => String(l.props.href).startsWith('file://'))
  expect(link?.props.href).toBe('file:///work/example-repo')
  expect(link?.text).toContain('example-repo')
  await ui.unmount()
  expect(colorOf((await paneRows($)).root, /example-repo/)).toBe('#b89ad9')
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

test('header: no round duration beside the round cost on the trend row', async ($, on) => {
  world(on)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.session.measure({ context: { window: 1_000_000, tokens: 260_000, percent: 26 }, rateLimits: [], cost: { usd: 5.2 }, changed: ['context', 'cost'] })
  const trend = async () => headerOf((await paneRows($)).rows).find(r => /^turn /.test(r))
  expect(await trend()).toMatch(/\$\+0\.38 · pace 7d/) // no round finished yet
  await $.turn.complete({ answer: '', durationMs: 134_000, isAborted: false, turnId: 't1', reason: 'answer' })
  expect(await trend()).toMatch(/\$\+0\.38 · pace 7d/)
  expect(await trend()).not.toMatch(/2m|134/)
})

test('header: after a rule, the CTX row with the cache share, then the 5h and 7d windows on one row, and no burn line', async ($, on) => {
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
  const context = at(/^CTX /)
  expect(rows[context - 1]).toMatch(/^─+$/) // a rule between the model / ALM block and the budgets
  expect(rows[context]).toMatch(/^CTX [▰▱]+ {2}25% {3}248K\/1M {2}· \u{F09D1}.*94%$/u)
  expect(rows[context + 1]).toMatch(/^5h [▰▱]+ {2}62% .* · 7d [▰▱]+ {2}41% /)
  expect(rows[context + 2]).toMatch(/^turn .* · pace 7d +[+−-]\d+%$/) // the turn's growth and the week's pace
  expect(rows[context + 3]).toMatch(/^─+$/) // the rule that closes the header
  expect(rows.some(r => /runs out|^CONTEXT$|^CREDITS/.test(r))).toBe(false)
})


/** What each language draws on a 58-column pane with one day of worklog pending: the tab labels, the buttons row, the header titles and a title or empty state of every tab. */
const LANGUAGES = [
  {
    name: 'English',
    files: {},
    tabs: barLabels({ signals: ' 󰧞' }, 'en', 'agents', 2),
    bareTabs: () => barLabels({}, 'en', 'notes'),
    buttons: { compact: 'compact', save: '\u{F0193}', edit: '\u{F03EB}', send: '\u{F048A}', delete: '\u{F0A79}' },
    header: [/^CTX /, /^5h .* · 7d /],
    byTab: { agents: [/^SUBAGENTS · 0 running/], context: [/^CONTEXT DETAILS · 248K\/1M/], signals: [/^WORKLOG$/, /^▸ 1 day behind$/, /^no notifications/], work: [/^CHANGES · 0$/, /^no changes$/], notes: [/^NOTES · 1$/, /^ask Anna/] },
  },
  {
    name: 'Italian',
    files: IT_FILE,
    tabs: barLabels({ signals: ' 󰧞' }, 'it'),
    bareTabs: () => barLabels({}, 'it', 'notes'),
    buttons: { compact: 'compatta', save: '\u{F0193}', edit: '\u{F03EB}', send: '\u{F048A}', delete: '\u{F0A79}' },
    header: [/^CTX /, /^5h .* · 7d /],
    byTab: { agents: [/^SUBAGENTI · 0 in corso/], context: [/^DETTAGLI CONTESTO · 248K\/1M/], signals: [/^REGISTRO ORE$/, /^▸ 1 giorno indietro/, /^nessuna notifica/], work: [/^MODIFICHE · 0$/, /^nessuna modifica$/], notes: [/^NOTE · 1$/, /^ask Anna/] },
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
      for (const [key, text] of [['note:edit:1', language.buttons.edit], ['note:send:1', language.buttons.send], ['note:delete:1', language.buttons.delete]] as const) {
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

test('header: the CTX bar glows while Claude works, the glow flowing a cell each 90 ms, and rests still once idle', { timeout: 60_000 }, async ($, on) => {
  const clock = world(on)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const leaves = (el: unknown): string[] => {
    const o = el as { props?: { color?: string }; children?: unknown[] } | null
    const [only] = o?.children ?? []
    return typeof only === 'string' ? [...only].map(() => o?.props?.color ?? '') : (o?.children ?? []).flatMap(leaves)
  }
  const ui = await mountPane($, 50)
  const still = leaves(await ui.drawn({ in: 'ctxbar' }))
  expect(new Set(still.filter(c => c !== '#33363c')).size).toBe(1) // idle: one colour for the fill
  await $.turn.start({ text: 'go', turnId: 't1' })
  await ui.advance(0)
  const first = leaves(await ui.drawn({ in: 'ctxbar' }))
  expect(first[0]).not.toBe(still[0])
  await ui.advance(400)
  const later = leaves(await ui.drawn({ in: 'ctxbar' }))
  expect(later[2]).not.toBe(still[2])
  expect(later).not.toEqual(first)
  // the round ends: the glow keeps flowing through the worklog's margin, then the bar rests still
  await $.turn.complete({ answer: '', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' })
  await clock.advance(10_000)
  await ui.advance(400)
  expect(leaves(await ui.drawn({ in: 'ctxbar' }))).not.toEqual(still)
  await clock.advance(16 * 60_000)
  await ui.advance(400)
  expect(leaves(await ui.drawn({ in: 'ctxbar' }))).toEqual(still)
  await ui.unmount()
})

// ── The credit bars pulse when their colour changes ──

const FIVE_H = (percentUsed: number) => [{ kind: 'five_hour', percentUsed, resetsAt: iso(2 * 60 * MIN + 14 * MIN) }]

/** The fill's colour of the `bar:5h` region on each of `steps` frames, 90 ms apart. */
async function pulseFrames(ui: Awaited<ReturnType<typeof mountPane>>, steps: number): Promise<string[]> {
  const first = (el: unknown): string => {
    const o = el as { props?: { color?: string }; children?: unknown[] } | null
    const [only] = o?.children ?? []
    return typeof only === 'string' ? (o?.props?.color ?? '') : ((o?.children ?? []).map(first).find(c => c !== '') ?? '')
  }
  const frames: string[] = []
  for (let i = 0; i < steps; i++) {
    frames.push(first(await ui.drawn({ in: 'bar:5h' })))
    await ui.advance(90)
  }
  return frames
}

test('credits: a window whose colour changes pulses its bar 3 times, then rests', async ($, on) => {
  world(on)
  on('session.measure', (_, e) => ({ changed: e.changed }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 58)
  await measureWith($, 25, FIVE_H(38))
  await settleAll()
  const calm = await pulseFrames(ui, 16)
  expect(new Set(calm).size).toBe(1) // no change of colour, no pulse
  await measureWith($, 25, FIVE_H(95)) // projected over the window: red
  await settleAll()
  await ui.advance(0)
  const frames = await pulseFrames(ui, 16)
  const rest = frames[frames.length - 1]
  expect(rest).not.toBe(calm[0])
  const isOn = frames.map(c => c !== rest)
  expect(isOn.filter((on2, i) => on2 && !isOn[i - 1])).toHaveLength(3) // three bright phases
  expect(frames.slice(-3).every(c => c === rest)).toBe(true) // and then it stops
  await ui.unmount()
})

test('credits: the first live reading after a stale one (the status line cache, with its own colour) does not pulse its bar', async ($, on) => {
  // a resumed session: the cache holds a green 38 % reading the bar draws with a `~`, then the live one is red
  const cache = JSON.stringify({ five_hour: { used_percentage: 38, resets_at: Math.floor((NOW + 134 * MIN) / 1000) } })
  world(on, { rateLimits: [], files: { '.statusline-rate-limits.json': cache } })
  on('session.measure', (_, e) => ({ changed: e.changed }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 58)
  expect(rowTexts(await ui.drawn()).some(r => /^5h .*~/.test(r))).toBe(true) // the stale reading is drawn
  await measureWith($, 25, FIVE_H(95))
  await settleAll()
  await ui.advance(0)
  expect(new Set(await pulseFrames(ui, 16)).size).toBe(1)
  await ui.unmount()
})

test('header: a surface without a surface module (mobile) draws the CTX row with the same text and width as the terminal', async ($, on) => {
  world(on)
  // every string of a node, in order: how a surface without the module draws the cells (spans as nested Texts)
  const flat = (el: unknown): string => {
    if (typeof el === 'string') return el
    const o = el as { text?: string; children?: unknown[] } | null
    return (o?.children ?? []).length > 0 ? (o?.children ?? []).map(flat).join('') : (o?.text ?? '')
  }
  const ctxOf = async (surface: 'terminal' | 'mobile') => {
    await $.session.start({ cwd: '/', surface, isInteractive: true })
    const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 58 }, surface })
    const root = await ui.drawn()
    const row = surface === 'terminal' ? rowTexts(root).find(r => /^CTX /.test(r)) : ((root as { children?: unknown[] }).children ?? []).map(flat).find(r => /^CTX /.test(r))
    await ui.unmount()
    return row ?? ''
  }
  const terminal = await ctxOf('terminal')
  const mobile = await ctxOf('mobile')
  expect(terminal).toMatch(/^CTX [▰▱]+ /)
  expect(mobile).toBe(terminal)
  expect([...mobile].length).toBe([...terminal].length)
})

test('header: the CTX readout joins the cache hit with a dot, the cells before it kept; the trend row shows a duck for a value not computed yet', async ($, on) => {
  world(on)
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 58)
  const trend = rowTexts(await ui.drawn()).find(r => /^turn /.test(r)) ?? ''
  expect(trend.match(/\u{F01E5}/gu)).toHaveLength(1) // no cost delta yet
  await ui.unmount()
  await $.turn.complete({
    answer: '',
    durationMs: 1,
    isAborted: false,
    turnId: 't',
    reason: 'answer',
    usage: { input_tokens: 600, output_tokens: 7, cache_read_input_tokens: 94_000, cache_creation_input_tokens: 5_400, model: 'm' },
  })
  const { rows } = await paneRows($, 58)
  const ctx = rows.find(r => /^CTX /.test(r)) ?? ''
  expect(ctx).toMatch(/\/1M +· \u{F09D1}/u)
})

test('header: the trend row keeps its `·` column when a value is a duck (one cell, two UTF-16 units) or a number', async ($, on) => {
  world(on)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const columnOf = (row: string) => textCells(row.slice(0, row.indexOf('·')))
  const duckUi = await mountPane($, 58)
  const duck = rowTexts(await duckUi.drawn()).find(r => /^turn /.test(r)) ?? ''
  await duckUi.unmount()
  expect(duck).toContain('\u{F01E5}')
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.session.measure({ context: { window: 1_000_000, tokens: 260_000, percent: 26 }, rateLimits: [], cost: { usd: 5.2 }, changed: ['context', 'cost'] })
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer', usage: { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 199_900, cache_creation_input_tokens: 0, model: 'm' } })
  const valuesUi = await mountPane($, 58)
  const values = rowTexts(await valuesUi.drawn()).find(r => /^turn /.test(r)) ?? ''
  await valuesUi.unmount()
  expect(values).toMatch(/^turn +\$\+0\.38 ·/)
  expect(columnOf(duck)).toBe(columnOf(values))
})

test('header: every surface but terminal and desktop draws the bars as plain text (no Client), vscode included', async ($, on) => {
  world(on)
  const ctxOf = async (surface: 'terminal' | 'vscode') => {
    await $.session.start({ cwd: '/', surface, isInteractive: true })
    const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 58 }, surface })
    const row = rowTexts(await ui.drawn()).find(r => /^CTX /.test(r)) ?? ''
    const clients = (await ui.findAll({ type: 'Client' })).length
    await ui.unmount()
    return { row, clients }
  }
  const terminal = await ctxOf('terminal')
  const vscode = await ctxOf('vscode')
  expect(terminal.clients).toBeGreaterThan(0)
  expect(vscode.clients).toBe(0)
  expect(vscode.row).toMatch(/^CTX [▰▱]+ /)
})

test('credits: a window whose reset has passed does not pulse when its colour changes with a new reading', async ($, on) => {
  world(on)
  on('session.measure', (_, e) => ({ changed: e.changed }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 58)
  const past = (percentUsed: number) => [{ kind: 'five_hour', percentUsed, resetsAt: iso(-MIN) }]
  await measureWith($, 25, past(38))
  await settleAll()
  await measureWith($, 25, past(95))
  await settleAll()
  await ui.advance(0)
  expect(new Set(await pulseFrames(ui, 16)).size).toBe(1)
  await ui.unmount()
})

test('header: a waiting state older than the margin (a lost event) is not work; a recent one, a working one with no age and a recent round end are', () => {
  const NOW_MS = 10_000_000
  const snap = (claudeState: { kind: 'idle' | 'working' | 'waiting'; since?: number } | undefined, lastRoundEnd?: number) =>
    ({ claudeState, ...(lastRoundEnd === undefined ? {} : { insights: { lastRoundEnd } }) }) as unknown as Parameters<typeof isWorking>[0]
  expect(isWorking(snap({ kind: 'waiting', since: NOW_MS - 16 * MIN }), NOW_MS)).toBe(false)
  expect(isWorking(snap({ kind: 'waiting', since: NOW_MS - 5 * MIN }), NOW_MS)).toBe(true)
  expect(isWorking(snap({ kind: 'working' }), NOW_MS)).toBe(true)
  expect(isWorking(snap({ kind: 'idle' }), NOW_MS)).toBe(false)
  expect(isWorking(snap({ kind: 'waiting', since: NOW_MS - 16 * MIN }, NOW_MS - MIN), NOW_MS)).toBe(true)
})
