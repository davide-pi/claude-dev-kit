import { expect, test } from 'claude-code/testing'

import { isWorking } from '../hooks/session'
import { setLang } from '../hooks/strings'
import {
  IT_FILE,
  MIN,
  RED,
  colorOf,
  headerOf,
  measureWith,
  mountPane,
  openCockpit,
  paneRows,
  settleAll,
} from './cockpit-fixtures'
import { NOW, PANE, flagOf, iso, rowTexts, world } from './cockpit-world'
import { COLORS } from '../hooks/shared'
import type { World } from './cockpit-world'

/** The left margin of the drawn root: the column its content starts at. */
const marginOf = (root: unknown): number => (root as { props?: { marginLeft?: number } }).props?.marginLeft ?? 0

/** The last turn's cost, the second column of ANDAMENTO's figures row; undefined while the section is hidden (no round ended yet) or the column holds no cost. */
const lastTurn = async ($: Parameters<typeof paneRows>[0]) => {
  const { rows } = await paneRows($, 58)
  const at = rows.findIndex(r => /^\$\/prompt/.test(r))
  return at < 0 ? undefined : rows[at + 1]?.match(/^\$\S+ \S\s+(\$\S+)/)?.[1]
}

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
    expect(rowTexts(await ui.drawn()).find(r => /^5h /.test(r))).toMatch(/^5h [\u25b0\u25b1]+ 62% \u21bb 2h14m \u00b7 7d [\u25b0\u25b1]+ 41% \u21bb 3d\d\dh [+\u2212-]\d+%$/)
    // the finished agent is a row of DONE
    expect(rowTexts(await ui.drawn()).some(r => /agent code-reviewer/.test(r))).toBe(true)
    await ui.unmount()
  }
})

test('the pane has no close button of its own: the buttons row is its only buttons', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const keys = (await ui.findAll({ type: 'Button' })).map(b => b.key)
  expect(keys).toEqual(['bar:compact', 'bar:retro', 'bar:worklog'])
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

/** The CTX bar's cells and the color of each, on the drawn pane. */
async function ctxBar(ui: { drawn: (q?: { in: string }) => Promise<unknown> }): Promise<{ bar: string[]; colors: string[] }> {
  const leaves = (el: unknown): { t: string; c: string }[] => {
    const o = el as { props?: { color?: string }; children?: unknown[] } | null
    const [only] = o?.children ?? []
    return typeof only === 'string' ? [...only].map(t => ({ t, c: o?.props?.color ?? '' })) : (o?.children ?? []).flatMap(leaves)
  }
  const cells = leaves(await ui.drawn({ in: 'ctxbar' })).filter(c => /[▰▱]/.test(c.t))
  return { bar: cells.map(c => c.t), colors: cells.map(c => c.c) }
}

test('CTX bar: the cell where the engine compacts turns amber, its glyph kept, on both surfaces', async ($, on) => {
  world(on, { autoCompactAt: 150_000 })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const { bar, colors } = await ctxBar(ui)
    // the bar is 1.1 x the threshold long: the amber cell at 1/1.1 of it, still a bar cell
    expect(rowTexts(await ui.drawn()).find(r => /^CTX /.test(r))).not.toContain('┃')
    expect(colors.filter(c => c === COLORS.amber)).toHaveLength(1)
    expect(colors.indexOf(COLORS.amber)).toBe(Math.min(bar.length - 1, Math.round(bar.length / 1.1)))
    await ui.unmount()
  }
})

// The engine reports its effective window less 13k (954k of a 967k window) whatever the percent says; the window setting is already in it.
for (const { pct } of [
  { pct: '20' },
  { pct: '100' },
  { pct: 'abc' },
  { pct: '0' },
]) {
  test(`CTX bar: percent override ${pct} leaves the tick at 1/1.1 of the bar, the reported threshold`, async ($, on) => {
    world(on, { autoCompactAt: 954_000, env: { CLAUDE_CONFIG_DIR: '/cfg', CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: pct } })
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    const { bar, colors } = await ctxBar(ui)
    expect(colors.indexOf(COLORS.amber)).toBe(Math.min(bar.length - 1, Math.round(bar.length / 1.1)))
    await ui.unmount()
  })
}

test('CTX bar: a /model that changes the window reads the threshold again', async ($, on) => {
  const options = { autoCompactAt: 150_000 }
  world(on, options)
  on('session.measure', (_, e) => ({ changed: e.changed }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.measure({ context: { window: 1_000_000, tokens: 100_000, percent: 10 }, rateLimits: [], cost: { usd: 1 }, changed: ['context'] })
  // the new model's window is 200k, and the engine compacts at 160k of it
  options.autoCompactAt = 160_000
  await $.session.measure({ context: { window: 200_000, tokens: 100_000, percent: 50 }, rateLimits: [], cost: { usd: 1 }, changed: ['context'] })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const { bar, colors } = await ctxBar(ui)
  expect(colors.indexOf(COLORS.amber)).toBe(Math.min(bar.length - 1, Math.round(bar.length / 1.1)))
  await ui.unmount()
})

test('CTX bar: a /model whose threshold read fails draws no threshold of the old window', async ($, on) => {
  let isFailing = false
  world(on, {
    autoCompactAt: 150_000,
    get breakdown() {
      if (isFailing) throw new Error('usage read failed')
      return undefined
    },
  })
  on('session.measure', (_, e) => ({ changed: e.changed }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.measure({ context: { window: 1_000_000, tokens: 100_000, percent: 10 }, rateLimits: [], cost: { usd: 1 }, changed: ['context'] })
  isFailing = true
  await $.session.measure({ context: { window: 200_000, tokens: 100_000, percent: 50 }, rateLimits: [], cost: { usd: 1 }, changed: ['context'] })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ctxBar(ui)).colors).not.toContain(COLORS.amber)
  await ui.unmount()
})

test('CTX bar: no tick when the engine reports no autocompact threshold', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ctxBar(ui)).colors).not.toContain(COLORS.amber)
  await ui.unmount()
})

test('a rule closes the header, and the ATTENTION title follows it at once (title and rule on one row), with no tab bar between', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const rows = rowTexts(await ui.drawn())
  const [, first = -1] = rows.flatMap((r, i) => (/^─+$/.test(r) ? [i] : []))
  const title = rows.findIndex(r => /^ATTENTION/.test(r))
  expect(first).toBe(headerOf(rows).length)
  expect(title).toBe(first + 1)
  expect(rows[title]).toMatch(/^ATTENTION ─+$/)
  expect([...(rows[title] ?? '')].length).toBe([...(rows[first] ?? '')].length)
  expect(rows[title + 1]).toBe('✓ nothing to do')
  await ui.unmount()
})

const GREEN = '#7ec699'

test('credits: one space before each percentage and each reset, the 7d pace ending the row', async ($, on) => {
  world(on, {
    rateLimits: [
      { kind: 'five_hour', percentUsed: 13, resetsAt: iso(2 * 60 * MIN) },
      { kind: 'seven_day', percentUsed: 93, resetsAt: iso(2 * 24 * 60 * MIN) },
    ],
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const { rows } = await paneRows($)
  // both windows share one row; the figures sit one space from the bar and from the reset, never padded
  const credits = rows.find(r => /^5h /.test(r)) ?? ''
  expect(credits).toMatch(/^5h [▰▱]+ 87% ↻ \S+ · 7d [▰▱]+ 7% ↻ \S+ [+−-]\d+%$/)
  const [five, seven] = [credits.indexOf('87%'), credits.indexOf('7%', credits.indexOf(' 7d '))]
  expect(seven - credits.indexOf(' · 7d ') - 3).toBe(five + 1)
})

test('credits: 100% and 87% each take one space before them, no cell padded', async ($, on) => {
  world(on, {
    rateLimits: [
      { kind: 'five_hour', percentUsed: 0, resetsAt: iso(5 * 60 * MIN) },
      { kind: 'seven_day', percentUsed: 13, resetsAt: iso(2 * 24 * 60 * MIN) },
    ],
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const { rows } = await paneRows($)
  const credits = rows.find(r => /^5h /.test(r)) ?? ''
  expect(credits).toMatch(/^5h [▰▱]+ 100% ↻ \S+ · 7d [▰▱]+ 87% ↻ /)
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

test('header: above the page, with the model, effort, state, session cost and the git, context, credit and cache rows', async ($, on) => {
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
  {
    const header = headerOf((await paneRows($, 50)).rows)
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

test('header: the last round cost is in ANDAMENTO, the session cost alone on the first line, and no trend row in the header', async ($, on) => {
  world(on)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.session.measure({ context: { window: 1_000_000, tokens: 260_000, percent: 26 }, rateLimits: [], cost: { usd: 5.2 }, changed: ['context', 'cost'] })
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  const header = headerOf((await paneRows($)).rows)
  expect(header[0]).toMatch(/\$5\.20$/)
  expect(header[0]).not.toContain('0.38')
  expect(header.some(r => /^turn /.test(r))).toBe(false)
  expect(await lastTurn($)).toBe('$0.38')
})

for (const order of ['end, measure', 'measure, end', 'end, next start, measure'] as const) {
  test(`header: ANDAMENTO keeps the last turn's cost while the next one runs (${order})`, async ($, on) => {
    world(on)
    on('turn.start', (_, e) => ({ turnId: e.turnId }))
    on('session.measure', (_, e) => ({ changed: e.changed }))
    on('turn.complete', () => ({ text: '' }))
    const measure = (usd: number) => $.session.measure({ context: { window: 1_000_000, tokens: 260_000, percent: 26 }, rateLimits: [], cost: { usd }, changed: ['context', 'cost'] })
    const end = (turnId: string) => $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId, reason: 'answer' })
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    await $.turn.start({ text: 'go', turnId: 't1' })
    if (order === 'measure, end') await measure(5.2)
    await end('t1')
    if (order === 'end, measure') await measure(5.2)
    await $.turn.start({ text: 'next', turnId: 't2' })
    if (order === 'end, next start, measure') await measure(5.2)
    expect(await lastTurn($)).toBe('$0.38')
    await measure(5.5)
    expect(await lastTurn($)).toBe('$0.30')
  })
}

test('header: a turn under a cent does not split the next turn on a mid-turn measure', async ($, on) => {
  world(on)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('turn.complete', () => ({ text: '' }))
  const measure = (usd: number, changed: ('context' | 'cost' | 'rateLimits')[] = ['context', 'cost']) =>
    $.session.measure({ context: { window: 1_000_000, tokens: 260_000, percent: 26 }, rateLimits: [], cost: { usd }, changed })
  const end = (turnId: string) => $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId, reason: 'answer' })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'go', turnId: 't1' })
  await measure(5.2)
  await end('t1')
  // t2 costs a tenth of a cent: its measure arrives after its end
  await $.turn.start({ text: 'tiny', turnId: 't2' })
  await end('t2')
  await measure(5.201)
  await $.turn.start({ text: 'next', turnId: 't3' })
  // a rate-limit point moves while t3 runs: the turn keeps counting from its start
  await measure(5.3, ['rateLimits'])
  await measure(5.5)
  expect(await lastTurn($)).toBe('$0.30')
})

test("header: a measure that arrives after the turn ended counts in the last turn's cost", async ($, on) => {
  world(on)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('turn.complete', () => ({ text: '' }))
  const measure = (usd: number) => $.session.measure({ context: { window: 1_000_000, tokens: 260_000, percent: 26 }, rateLimits: [], cost: { usd }, changed: ['context', 'cost'] })
  const end = (turnId: string) => $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId, reason: 'answer' })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'go', turnId: 't1' })
  await measure(5.0)
  await end('t1')
  await measure(5.2)
  await $.turn.start({ text: 'next', turnId: 't2' })
  expect(await lastTurn($)).toBe('$0.38')
})

test("header: a measure without the cost does not settle the ended turn's cost", async ($, on) => {
  world(on)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('turn.complete', () => ({ text: '' }))
  const measure = (usd: number, changed: ('context' | 'cost' | 'rateLimits')[]) =>
    $.session.measure({ context: { window: 1_000_000, tokens: 260_000, percent: 26 }, rateLimits: [], cost: { usd }, changed })
  const end = (turnId: string) => $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId, reason: 'answer' })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'go', turnId: 't1' })
  await measure(5.2, ['context', 'cost'])
  await end('t1')
  await $.turn.start({ text: 'two', turnId: 't2' })
  await end('t2')
  // a rate-limit point moves before t2's cost arrives and before t3 starts
  await measure(5.2, ['rateLimits'])
  await $.turn.start({ text: 'three', turnId: 't3' })
  await measure(5.5, ['cost'])
  await measure(5.6, ['cost'])
  expect(await lastTurn($)).toBe('$0.10')
})

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
    expect(await lastTurn($)).toBeUndefined()
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

test('a state file of an earlier version with a saved tab still loads, and is written back without it', async ($, on) => {
  const writes = new Map<string, string>()
  world(on, { writes, stateFile: JSON.stringify({ open: false, tab: 'work' }) })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 58)
  expect(rowTexts(await ui.drawn()).some(r => /^ATTENTION/.test(r))).toBe(true)
  expect(flagOf(writes)).not.toHaveProperty('tab')
  await ui.unmount()
})

// ── Phase 3 follow-ups ──

test('header: the round duration stays out of the last-turn cost figure, and sits under it as its caption', async ($, on) => {
  world(on)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.session.measure({ context: { window: 1_000_000, tokens: 260_000, percent: 26 }, rateLimits: [], cost: { usd: 5.2 }, changed: ['context', 'cost'] })
  await $.turn.complete({ answer: '', durationMs: 134_000, isAborted: false, turnId: 't1', reason: 'answer' })
  expect(await lastTurn($)).toBe('$0.38')
  const { rows } = await paneRows($, 58)
  const at = rows.findIndex(r => /^\$\/prompt/.test(r))
  expect(rows[at + 1]).not.toMatch(/2m|134/)
  expect(rows[at + 2]).toMatch(/02m14s/)
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
  expect(rows[context + 1]).toMatch(/^5h [▰▱]+ 62% ↻ \S+ · 7d [▰▱]+ 41% ↻ \S+ [+−-]\d+%$/) // the 7d pace ends the credits row
  expect([...(rows[context + 1] ?? '')].length).toBeLessThanOrEqual(56)
  expect(rows[context + 2]).toMatch(/^─+$/) // the rule that closes the header
  expect(rows.some(r => /runs out|^CONTEXT$|^CREDITS/.test(r))).toBe(false)
})


/** What each language draws on a 58-column pane with one day of worklog pending: the buttons row, the header rows and the page's titles. */
const LANGUAGES = [
  { name: 'English', files: {}, compact: 'compact', page: [/^ATTENTION ─+$/, /1 day without logged hours/] },
  { name: 'Italian', files: IT_FILE, compact: 'compatta', page: [/^ATTENZIONE ─+$/, /1 giorno senza ore segnate/] },
]

for (const language of LANGUAGES) {
  test(`${language.name}: the buttons, header and page titles at 58 columns`, async ($, on) => {
    world(on, { files: language.files, hasWorklog: true, dataFile: JSON.stringify({ history: [], prs: [], notes: [{ id: 1, text: 'ask Anna' }] }) })
    try {
      await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
      const ui = await mountPane($, 58)
      expect((await ui.find({ key: 'bar:compact' }))?.text).toBe(language.compact)
      await ui.unmount()
      const { rows } = await paneRows($, 58)
      for (const re of [/^CTX /, /^5h .* · 7d /, ...language.page]) expect(rows.some(r => re.test(r))).toBe(true)
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

test('header: the CTX readout joins the cache hit with a dot, the cells before it kept', async ($, on) => {
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
  const ctx = rows.find(r => /^CTX /.test(r)) ?? ''
  expect(ctx).toMatch(/\/1M +· \u{F09D1}/u)
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
