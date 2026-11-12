import { expect, test } from 'claude-code/testing'

import { COLORS } from '../hooks/shared'
import { MIN, RED, colorOf, headerOf, paneRows } from './cockpit-fixtures'
import { PANE, iso, rowTexts, world } from './cockpit-world'

test('the pane shows header, context, credits and an agent that finished before its spawn was noted', { timeoutMs: 30_000 }, async ($, on) => {
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
    expect(rowTexts(await ui.drawn()).some(r => /\d\d:\d\d \S+ code-reviewer/.test(r))).toBe(true)
    await ui.unmount()
  }
})

test('the pane has no close button of its own: the buttons row is its only buttons', { timeoutMs: 30_000 }, async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const keys = (await ui.findAll({ type: 'Button' })).map(b => b.key)
  expect(keys).toEqual(['bar:compact', 'bar:retro', 'bar:worklog'])
  await ui.unmount()
})

test('the cost is shown at zero and the context reads 0% 0/1M before the first response', { timeoutMs: 30_000 }, async ($, on) => {
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

test('CTX bar: the cell where the engine compacts turns amber, its glyph kept, on both surfaces', { timeoutMs: 30_000 }, async ($, on) => {
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

test('CTX bar: a /model that changes the window reads the threshold again', { timeoutMs: 30_000 }, async ($, on) => {
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

test('CTX bar: a /model whose threshold read fails draws no threshold of the old window', { timeoutMs: 30_000 }, async ($, on) => {
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

test('CTX bar: no tick when the engine reports no autocompact threshold', { timeoutMs: 30_000 }, async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ctxBar(ui)).colors).not.toContain(COLORS.amber)
  await ui.unmount()
})

test('a rule closes the header, and the ATTENTION title follows it at once (title and rule on one row), with no tab bar between', { timeoutMs: 30_000 }, async ($, on) => {
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

test('credits: one space before each percentage and each reset, the 7d pace ending the row', { timeoutMs: 30_000 }, async ($, on) => {
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

test('credits: 100% and 87% each take one space before them, no cell padded', { timeoutMs: 30_000 }, async ($, on) => {
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

test('cache share: the last main-loop turn, at the end of the CTX row; a subagent turn and an empty one do not set it', { timeoutMs: 30_000 }, async ($, on) => {
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

test('Given the context at 87%, When the pane is drawn, Then there is no warning row and no button of its own', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  world(on, { ctxPercent: 87 })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  // When
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  // Then
  expect(rowTexts(await ui.drawn()).some(r => /^󰀦|context at/.test(r))).toBe(false)
  expect(colorOf(await ui.drawn(), /^ *87%$/)).toBe(RED)
  expect(await ui.find({ key: 'compact-now' })).toBeUndefined()
  expect((await ui.findAll({ type: 'Button' })).some(b => /compact ora/.test(b.text ?? ''))).toBe(false)
  await ui.unmount()
})

test('Given the context below and then at 80%, When the pane is drawn, Then neither draws a warning row', { timeoutMs: 30_000 }, async ($, on) => {
  // Given
  const clock = world(on, { ctxPercent: 79 })
  on('session.measure', (_, e) => ({ changed: e.changed }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  // When
  let ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  // Then
  expect(rowTexts(await ui.drawn()).some(r => /^󰀦|context at/.test(r))).toBe(false)
  await ui.unmount()
  await clock.advance(1)
  await $.session.measure({ context: { window: 1_000_000, tokens: 800_000, percent: 80 }, rateLimits: [], cost: { usd: 5 }, changed: ['context'] })
  ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(rowTexts(await ui.drawn()).some(r => /^󰀦|context at/.test(r))).toBe(false)
  await ui.unmount()
})

