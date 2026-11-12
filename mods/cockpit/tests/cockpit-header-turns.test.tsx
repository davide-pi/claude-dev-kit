import { expect, test } from 'claude-code/testing'

import { isWorking } from '../hooks/session'
import { setLang } from '../hooks/strings'
import { IT_FILE, MIN, RED, colorOf, headerOf, measureWith, mountPane, paneRows, settleAll } from './cockpit-fixtures'
import { GREEN, lastTurn, marginOf } from './cockpit-header-kit'
import { NOW, PANE, flagOf, iso, rowTexts, world } from './cockpit-world'

// ── Phase 1 follow-ups ──

test('a session start (/clear) forgets the cache share', { timeoutMs: 30_000 }, async ($, on) => {
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

test('layout: the content is min(bodyColumns, 60) - 2 wide with one column of margin each side, at 40, 58 and 80 columns', { timeoutMs: 30_000 }, async ($, on) => {
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

test('header: above the page, with the model, effort, state, session cost and the git, context, credit and cache rows', { timeoutMs: 30_000 }, async ($, on) => {
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

test('header: the last round cost is in the state file, the session cost alone on the first line, and no trend row in the header', { timeoutMs: 30_000 }, async ($, on) => {
  const writes = new Map<string, string>()
  const clock = world(on, { writes })
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
  expect(await lastTurn(writes, clock)).toBe('$0.38')
})

for (const order of ['end, measure', 'measure, end', 'end, next start, measure'] as const) {
  test(`header: the last turn's cost stays while the next one runs (${order})`, async ($, on) => {
    const writes = new Map<string, string>()
  const clock = world(on, { writes })
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
    expect(await lastTurn(writes, clock)).toBe('$0.38')
    await measure(5.5)
    expect(await lastTurn(writes, clock)).toBe('$0.30')
  })
}

test('header: a turn under a cent does not split the next turn on a mid-turn measure', { timeoutMs: 30_000 }, async ($, on) => {
  const writes = new Map<string, string>()
  const clock = world(on, { writes })
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
  expect(await lastTurn(writes, clock)).toBe('$0.30')
})

test("header: a measure that arrives after the turn ended counts in the last turn's cost", { timeoutMs: 30_000 }, async ($, on) => {
  const writes = new Map<string, string>()
  const clock = world(on, { writes })
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
  expect(await lastTurn(writes, clock)).toBe('$0.38')
})

test("header: a measure without the cost does not settle the ended turn's cost", { timeoutMs: 30_000 }, async ($, on) => {
  const writes = new Map<string, string>()
  const clock = world(on, { writes })
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
  expect(await lastTurn(writes, clock)).toBe('$0.10')
})

for (const order of ['measure, end', 'end only'] as const) {
  test(`header: a new session (/clear) does not show the previous session's turn cost (${order})`, async ($, on) => {
    let id = 's-1'
    const writes = new Map<string, string>()
    const clock = world(on, { writes, sessionId: () => id })
    on('turn.start', (_, e) => ({ turnId: e.turnId }))
    on('session.measure', (_, e) => ({ changed: e.changed }))
    on('turn.complete', () => ({ text: '' }))
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    await $.turn.start({ text: 'go', turnId: 't1' })
    if (order === 'measure, end') await $.session.measure({ context: { window: 1_000_000, tokens: 260_000, percent: 26 }, rateLimits: [], cost: { usd: 5.2 }, changed: ['context', 'cost'] })
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
    id = 's-2'
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    expect(await lastTurn(writes, clock, 's-2')).toBeUndefined()
  })
}

test('header: the folder icon of a folder that is not a repository is U+F024B', { timeoutMs: 30_000 }, async ($, on) => {
  world(on, { notRepo: true })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const row = headerOf((await paneRows($)).rows).find(r => /example-repo/.test(r))
  expect(row).toContain('\u{F024B} example-repo')
})

test('header: the folder icon of a repository is U+F024B too', { timeoutMs: 30_000 }, async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const row = headerOf((await paneRows($)).rows).find(r => /example-repo/.test(r))
  expect(row).toContain('\u{F024B} example-repo')
})

test('header: the folder icon of a linked worktree is U+F024B too', { timeoutMs: 30_000 }, async ($, on) => {
  world(on, { isLinkedWorktree: true })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const row = headerOf((await paneRows($)).rows).find(r => /example-repo/.test(r))
  expect(row).toContain('\u{F024B} example-repo')
})

test('header: the folder is a Link to the worktree root as a file:// address, keeping its name', { timeoutMs: 30_000 }, async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mountPane($)
  const link = (await ui.findAll({ type: 'Link' })).find(l => String(l.props.href).startsWith('file://'))
  expect(link?.props.href).toBe('file:///work/example-repo')
  expect(link?.text).toContain('example-repo')
  await ui.unmount()
  expect(colorOf((await paneRows($)).root, /example-repo/)).toBe('#b89ad9')
})

test('header: the cache hit is green from 80 %, amber from 50 to 79, red below 50', { timeoutMs: 30_000 }, async ($, on) => {
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
  // the icon is in full colour, the same as the share it heads, not dim
  expect(colorOf((await paneRows($)).root, /^\u{F09D1} $/u)).toBe(GREEN)
  await complete(60, 40)
  expect(colorOf((await paneRows($)).root, /^ 60%$/)).toBe('#e8a35a')
  await complete(20, 80)
  expect(colorOf((await paneRows($)).root, /^ 20%$/)).toBe(RED)
  expect(colorOf((await paneRows($)).root, /^\u{F09D1} $/u)).toBe(RED)
})

test('a state file of an earlier version with a saved tab still loads, and is written back without it', { timeoutMs: 30_000 }, async ($, on) => {
  const writes = new Map<string, string>()
  world(on, { writes, stateFile: JSON.stringify({ open: false, tab: 'work' }) })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 58)
  expect(rowTexts(await ui.drawn()).some(r => /^ATTENTION/.test(r))).toBe(true)
  expect(flagOf(writes)).not.toHaveProperty('tab')
  await ui.unmount()
})

// ── Phase 3 follow-ups ──

test("header: a long turn (134 s) does not change the last turn's cost", { timeoutMs: 30_000 }, async ($, on) => {
  const writes = new Map<string, string>()
  const clock = world(on, { writes })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.session.measure({ context: { window: 1_000_000, tokens: 260_000, percent: 26 }, rateLimits: [], cost: { usd: 5.2 }, changed: ['context', 'cost'] })
  await $.turn.complete({ answer: '', durationMs: 134_000, isAborted: false, turnId: 't1', reason: 'answer' })
  expect(await lastTurn(writes, clock)).toBe('$0.38')
})

test('header: after a rule, the CTX row with the cache share, then the 5h and 7d windows on one row, and no burn line', { timeoutMs: 30_000 }, async ($, on) => {
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

test('header: the CTX bar glows while Claude works, the glow flowing a cell each 90 ms, and rests still once idle', { timeoutMs: 60_000 }, async ($, on) => {
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

test('credits: a window whose colour changes pulses its bar 3 times, then rests', { timeoutMs: 30_000 }, async ($, on) => {
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

test('credits: the first live reading after a stale one (the status line cache, with its own colour) does not pulse its bar', { timeoutMs: 30_000 }, async ($, on) => {
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

test('header: a surface without a surface module (mobile) draws the CTX row with the same text and width as the terminal', { timeoutMs: 30_000 }, async ($, on) => {
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

test('header: the CTX readout joins the cache hit with a dot, the cells before it kept', { timeoutMs: 30_000 }, async ($, on) => {
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

test('header: every surface but terminal and desktop draws the bars as plain text (no Client), vscode included', { timeoutMs: 30_000 }, async ($, on) => {
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

test('credits: a window whose reset has passed does not pulse when its colour changes with a new reading', { timeoutMs: 30_000 }, async ($, on) => {
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
