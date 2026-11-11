import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import {
  GH_CREATED,
  RL_FILE,
  bashResult,
  entry,
  fileOfSession,
  finishAgent,
  measureWith,
  mountPane,
  openCockpit,
  paneRows,
  rlCache,
  settleAll,
  spawnAgent,
  spawns,
} from './cockpit-fixtures'
import { DATA, NOW, PANE, dataOf, flagOf, iso, rowTexts, settle, world } from './cockpit-world'

/** The context the world measures at start, as the data file keeps it. */
const LIVE_CTX = { tokens: 248_000, window: 1_000_000, percent: 25 }

test('a data file from before the model usage was dropped still loads: its history comes back, the old modelUse is ignored', async ($, on) => {
  const writes = new Map<string, string>()
  world(on, { writes, dataFile: JSON.stringify({ history: [entry('a9', 'implementer', NOW - 30_000)], prs: [], modelUse: { 'claude-sonnet-5-5': { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 } } }) })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 58)
  expect(rowTexts(await ui.drawn()).some(r => /agent implementer/.test(r))).toBe(true)
  await ui.unmount()
  await settle()
  expect(dataOf(writes)).not.toHaveProperty('modelUse')
})

test('the state file is written at session start with open:false and the session data', async ($, on) => {
  const writes = new Map<string, string>()
  world(on, { writes })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(flagOf(writes)).toEqual({
    open: false,
    at: NOW,
    lastTurnUsd: null,
    agents: { running: 0, modelWarnings: 0 },
    effort: 'high',
    tasks: null,
  })
  expect(Object.keys(flagOf(writes) as object)).toEqual(['open', 'at', 'lastTurnUsd', 'agents', 'effort', 'tasks'])
  // what must survive a resume is in the session data file
  expect(dataOf(writes)).toEqual({ history: [], prs: [], ctx: LIVE_CTX, startedAt: NOW })
})

const CLOSED = { open: false, at: NOW, lastTurnUsd: null, agents: { running: 0, modelWarnings: 0 }, effort: null, tasks: null }

test('session.end leaves the ENDING session file closed and empty, not the current one', async ($, on) => {
  const writes = new Map<string, string>()
  // $.session.id() already answers the new id (a /clear): the file written is the one `e.sessionId` names.
  world(on, { writes, sessionId: () => 's-2' })
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.end({ reason: 'clear', sessionId: 's-1', resume: { id: 's-1' } })
  expect(flagOf(writes)).toEqual(CLOSED)
})

test('session.end with the pane open still writes open:false for the ending session', async ($, on) => {
  const writes = new Map<string, string>()
  world(on, { writes, sessionId: () => 's-2' })
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'cockpit', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 80 } })
  const current = [...writes.keys()].find(k => /cockpit-s-2\.json$/.test(k))
  expect(JSON.parse(writes.get(current ?? '') ?? 'null')).toMatchObject({ open: true })
  await $.session.end({ reason: 'prompt_input_exit', sessionId: 's-1', resume: { id: 's-1' } })
  expect(flagOf(writes)).toEqual(CLOSED)
})

test('a new session id (/clear) gets its own file, even with the same content', async ($, on) => {
  const writes = new Map<string, string>()
  let id = 's-1'
  world(on, { writes, sessionId: () => id })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  id = 's-2'
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect([...writes.keys()].map(k => k.replace(/^.*(cockpit-(?:data-)?s-\d\.json)$/, '$1')).sort()).toEqual(['cockpit-data-s-1.json', 'cockpit-data-s-2.json', 'cockpit-s-1.json', 'cockpit-s-2.json'])
})

test('a session id the statusline would not accept writes nothing', async ($, on) => {
  const writes = new Map<string, string>()
  world(on, { writes, sessionId: () => '../x' })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(writes.size).toBe(0)
})

test('/cockpit opens the pane and the state file says open:true', async ($, on) => {
  const opened: string[] = []
  const writes = new Map<string, string>()
  world(on, { opened, writes })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(flagOf(writes)).toMatchObject({ open: false })

  const ran = await $.command.run({ command: 'cockpit', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 80 } })
  expect(ran.text).toBe('cockpit open')
  expect(opened).toEqual(['cockpit'])
  expect(flagOf(writes)).toMatchObject({ open: true })
})

test('while the pane is open the tick rewrites the state file with a fresh at; closed, it writes nothing', async ($, on) => {
  const writes = new Map<string, string>()
  const log: string[] = []
  const clock = world(on, { writes, log })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const afterStart = log.length
  await clock.advance(30_000)
  expect(log.length).toBe(afterStart)

  await $.command.run({ command: 'cockpit', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 80 } })
  const openedAt = (flagOf(writes) as { at: number }).at
  await clock.advance(30_000)
  const heartbeat = flagOf(writes) as { open: boolean; at: number }
  expect(heartbeat.open).toBe(true)
  expect(heartbeat.at).toBeGreaterThanOrEqual(openedAt + 15_000)
})

test('a pane that cannot be placed is reported with open:false, and its first render says open:true', async ($, on) => {
  const writes = new Map<string, string>()
  const clock = world(on, { isPlaced: false, writes })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ran = await $.command.run({ command: 'cockpit', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  expect(ran.text).toBe('cockpit waiting: too narrow (80 < 144)')
  expect(flagOf(writes)).toMatchObject({ open: false })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await clock.settle()
  expect(flagOf(writes)).toMatchObject({ open: true })
  await ui.unmount()
})

test('the state file follows the last turn cost and the agent counts, at most once per few seconds, never unchanged', async ($, on) => {
  const writes = new Map<string, string>()
  const log: string[] = []
  const clock = world(on, { writes, log })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'a1' }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const atStart = log.length
  await $.turn.start({ text: 'go', turnId: 't1' })
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
  await $.session.measure({
    context: { window: 1_000_000, tokens: 260_000, percent: 26 },
    rateLimits: [],
    cost: { usd: 5.2 },
    changed: ['context', 'cost'],
  })
  // inside the window: held back
  expect(log.length).toBe(atStart)
  expect(flagOf(writes)).toMatchObject({ lastTurnUsd: null })

  await clock.advance(3000)
  expect(flagOf(writes)).toMatchObject({
    open: false,
    at: NOW + 3000,
    lastTurnUsd: 0.38,
    agents: { running: 1, modelWarnings: 1 },
    effort: 'high',
    tasks: null,
  })
  const afterFlush = log.length

  // nothing changed: a later moment writes nothing
  await clock.advance(2000)
  expect(log.length).toBe(afterFlush)
})

test("the state file's last turn cost is the ended turn's while the next one has not been measured", async ($, on) => {
  const writes = new Map<string, string>()
  const clock = world(on, { writes })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.session.measure({ context: { window: 1_000_000, tokens: 260_000, percent: 26 }, rateLimits: [], cost: { usd: 5.2 }, changed: ['context', 'cost'] })
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  await $.turn.start({ text: 'next', turnId: 't2' })
  await clock.advance(3000)
  expect(flagOf(writes)).toMatchObject({ lastTurnUsd: 0.38 })
})

test('a state file that is not JSON is ignored', async ($, on) => {
  world(on, { stateFile: 'not json' })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect((await paneRows($)).rows.some(r => /^ATTENTION/.test(r))).toBe(true)
})

test('a write delayed across a /clear writes nothing to the new session\'s file', async ($, on) => {
  let id = 's-1'
  const writes = new Map<string, string>()
  const clock = world(on, { sessionId: () => id, writes })
  spawns(on)
  on('turn.complete', () => ({ text: '' }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await spawnAgent($, 'one')
  await finishAgent($, 'a1')
  // the change is inside the 3 s window of the start's write: it waits for the timer
  id = 's-2'
  await $.session.end({ reason: 'clear', sessionId: 's-1', resume: { id: 's-1' } })
  await clock.advance(3500)
  expect(fileOfSession(writes, 's-2')).toBeUndefined()
})

test('session.end while id() still answers the ending session: a tick in between never re-adopts it, the running agent is interrotto in its file, nothing of it reaches the next', async ($, on) => {
  let id = 's-1'
  const writes = new Map<string, string>()
  const clock = world(on, { sessionId: () => id, writes, listed: [{ id: 'a1', status: 'running' }, { id: 'a2', status: 'running' }] })
  spawns(on)
  on('turn.complete', () => ({ text: '' }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await spawnAgent($, 'running-one')
  await spawnAgent($, 'finished-one')
  await finishAgent($, 'a2')
  // an open pane makes every tick rewrite the state file of whatever session the snapshot holds
  await $.command.run({ command: 'cockpit', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 80 } })
  // the documented order: the ending id is still the current one while session.end runs
  await $.session.end({ reason: 'clear', sessionId: 's-1', resume: { id: 's-1' } })
  const ended = fileOfSession(writes, 's-1')
  expect(ended?.history).toEqual([
    { id: 'a1', type: 'running-one', model: 'claude-sonnet-5-5', startedAt: NOW, endedAt: NOW, tokens: 0, isFailed: false, description: 'go', isInterrupted: true },
    { id: 'a2', type: 'finished-one', model: 'claude-sonnet-5-5', startedAt: NOW, endedAt: NOW, tokens: 0, isFailed: false, description: 'go' },
  ])
  // a tick lands before the engine switches to the next id: it must not take s-1 back
  await clock.advance(30_000)
  expect(fileOfSession(writes, 's-1')).toEqual(ended)
  id = 's-2' // no session.start follows a /clear
  await clock.advance(135_000)
  const ui = await mountPane($)
  expect(await ui.find({ key: 'agent:a1' })).toBeUndefined()
  expect(await ui.find({ key: 'agent:a2' })).toBeUndefined()
  expect(rowTexts(await ui.drawn()).some(r => /agent (running|finished)-one/.test(r))).toBe(false)
  await ui.unmount()
  expect(fileOfSession(writes, 's-2')?.history).toEqual([])
  expect(fileOfSession(writes, 's-1')).toEqual(ended)
})

test('a session.end whose file write is cut short still leaves nothing of the ending session in the snapshot', async ($, on) => {
  let id = 's-1'
  const writes = new Map<string, string>()
  let isCut = false
  world(on, { sessionId: () => id, writes, failWrites: () => isCut })
  spawns(on)
  on('turn.complete', () => ({ text: '' }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await spawnAgent($, 'running-one')
  isCut = true
  await $.session.end({ reason: 'clear', sessionId: 's-1', resume: { id: 's-1' } })
  id = 's-2'
  const ui = await mountPane($)
  expect(await ui.find({ key: 'agent:a1' })).toBeUndefined()
  await ui.unmount()
})

test('a resume reloads the history of the session it resumes', async ($, on) => {
  let id = 's-2'
  const history = [entry('a9', 'implementer', NOW - 30_000), entry('a8', 'reviewer', NOW - 90_000, true)]
  const clock = world(on, { sessionId: () => id, stateFile: JSON.stringify({ open: false, history }) })
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  id = 's-1'
  await $.session.end({ reason: 'resume', sessionId: 's-2', resume: { id: 's-2' } })
  await openCockpit($)
  await clock.advance(30_000)
  const ui = await mountPane($)
  expect(rowTexts(await ui.drawn()).filter(r => /agent (implementer|reviewer)/.test(r))).toHaveLength(2)
  await ui.unmount()
})

test('session.end keeps the history in the closed file, so a resume finds it', async ($, on) => {
  const writes = new Map<string, string>()
  const history = [entry('a9', 'implementer', NOW - 30_000)]
  world(on, { writes, stateFile: JSON.stringify({ history }) })
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.end({ reason: 'clear', sessionId: 's-1', resume: { id: 's-1' } })
  // a file without agentTokens starts the count from the history it lists; the history itself is in the data file
  expect(flagOf(writes)).toEqual({ ...CLOSED, agentTokens: 5400 })
  expect(dataOf(writes)).toEqual({ history, prs: [], ctx: LIVE_CTX, startedAt: NOW })
})

test('follow-up: a saved state without agentTokens starts the count from the history it lists', async ($, on) => {
  const writes = new Map<string, string>()
  const h = (id: string, tokens: number) => ({ id, type: 't', startedAt: 0, endedAt: 1, tokens, isFailed: false })
  world(on, { writes, stateFile: JSON.stringify({ open: false, history: [h('x1', 3000), h('x2', 2000)] }) })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect((flagOf(writes) as { agentTokens?: number }).agentTokens).toBe(5000)
})

test('follow-up: a saved agentTokens wins over the history sum', async ($, on) => {
  const writes = new Map<string, string>()
  const h = (id: string, tokens: number) => ({ id, type: 't', startedAt: 0, endedAt: 1, tokens, isFailed: false })
  world(on, { writes, stateFile: JSON.stringify({ open: false, agentTokens: 9000, history: [h('x1', 3000)] }) })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect((flagOf(writes) as { agentTokens?: number }).agentTokens).toBe(9000)
})

/** `on` with the first state-file timer (a `clock.after` of 3 s, the write throttle) refused: the hook throws, so the engine skips it and runs nothing. */
function refusingFirstWriteTimer(on: On): On {
  let isRefused = false
  const wrapped = (pattern: string, ...rest: unknown[]) => {
    const hook = rest.pop() as (...args: unknown[]) => unknown
    const guarded =
      pattern === 'clock.after'
        ? (...args: unknown[]) => {
            if (isRefused || (args[1] as { ms?: number } | undefined)?.ms !== 3000) return hook(...args)
            isRefused = true
            throw new Error('refused')
          }
        : hook
    return (on as unknown as (...a: unknown[]) => unknown)(pattern, ...rest, guarded)
  }
  return wrapped as unknown as On
}

// ── Phase 6: session data file ──

const SAVED_PR = { number: 7, title: 'Old work' }

test('session data: history, PRs and the context rounds go to cockpit-data-<id>.json, throttled like the state file; the state file keeps the handshake', async ($, on) => {
  const writes = new Map<string, string>()
  const clock = world(on, { writes })
  spawns(on)
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', { tool: 'Bash' }, () => bashResult(`${GH_CREATED}\n`))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await spawnAgent($, 'old')
  await finishAgent($, 'a1')
  await $.tool.call({ tool: 'Bash', command: 'gh pr create --title "Add filter"' })
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 'm1', reason: 'answer' })
  expect(dataOf(writes)?.prs).toEqual([]) // inside the 3 s window of the start write
  await openCockpit($) // the tiers tick only while the pane is open
  await clock.advance(135_000) // the finished agent leaves the list for the history
  const data = dataOf(writes)
  expect(data).toMatchObject({ ctxRounds: [248_000], prs: [{ number: 42, title: 'Add filter' }] })
  expect(data?.history).toHaveLength(1)
  const flag = flagOf(writes) as Record<string, unknown>
  expect(flag.history).toBeUndefined()
  expect(flag.prs).toBeUndefined()
})

test('session data: a resume brings back the history, the PRs and the context samples; the notes an old file holds are dropped', async ($, on) => {
  const writes = new Map<string, string>()
  const dataFile = JSON.stringify({
    history: [entry('a9', 'implementer', NOW - 30_000)],
    prs: [SAVED_PR],
    notes: [{ id: 3, text: 'ask Anna' }, { id: 5, text: 'call back' }],
    ctxRounds: [100_000, 200_000],
    ctxSamples: [100_000, 200_000],
  })
  world(on, { writes, dataFile })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mountPane($)
  expect(rowTexts(await ui.drawn()).some(r => /agent implementer/.test(r))).toBe(true)
  await ui.unmount()
  // written back as it was read
  expect(dataOf(writes)).toMatchObject({ ctxRounds: [100_000, 200_000], ctxSamples: [100_000, 200_000], prs: [SAVED_PR] })
})

test('session data: a state file from before the data file hands its history and PRs over, once', async ($, on) => {
  const writes = new Map<string, string>()
  const history = [entry('a9', 'implementer', NOW - 30_000)]
  world(on, { writes, stateFile: JSON.stringify({ open: false, history, prs: [SAVED_PR] }) })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(dataOf(writes)).toEqual({ history, prs: [SAVED_PR], ctx: LIVE_CTX, startedAt: NOW })
  const flag = flagOf(writes) as Record<string, unknown>
  expect(flag.history).toBeUndefined()
  expect(flag.prs).toBeUndefined()
  expect(flag.tab).toBeUndefined()
})

test('session data: once the data file exists the old place is never read again, even with its fields empty', async ($, on) => {
  world(on, {
    dataFile: JSON.stringify({ history: [], prs: [] }),
    stateFile: JSON.stringify({ open: false, history: [entry('a9', 'implementer', NOW - 30_000)], prs: [SAVED_PR] }),
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mountPane($)
  expect(rowTexts(await ui.drawn()).some(r => /agent implementer/.test(r))).toBe(false)
  await ui.unmount()
})

test('session data: a field of the wrong shape is left out, never thrown', async ($, on) => {
  const writes = new Map<string, string>()
  world(on, { writes, dataFile: JSON.stringify({ history: 'x', prs: {}, note: 42, notes: [null, { id: 1, text: 7 }, { id: 'x', text: 'a' }, { id: 2, text: ' ' }], ctxRounds: ['a', -1], ctxSamples: null }) })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(dataOf(writes)).toEqual({ history: [], prs: [], ctx: LIVE_CTX, startedAt: NOW })
})

test('last known: before the first live reading the credits come from the status line cache with a dim ~, and a live reading replaces them', async ($, on) => {
  world(on, { rateLimits: [], files: { [RL_FILE]: rlCache(40, 20) } })
  on('session.measure', (_, e) => ({ changed: e.changed }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 50)
  const text = async (re: RegExp) => rowTexts(await ui.drawn()).find(r => re.test(r))
  expect(await text(/5h [▰▱]+ ~60%/)).toMatch(/^5h [▰▱]+ ~60% ↻ 1h00m · /)
  expect(await text(/7d [▰▱]+ ~80%/)).toMatch(/ · 7d [▰▱]+ ~80% /)
  await measureWith($, 25, [{ kind: 'five_hour', percentUsed: 30, resetsAt: iso(3600_000) }])
  await settleAll()
  expect(await text(/5h [▰▱]+ 70%/)).toBeDefined()
  expect(await text(/5h [▰▱]+ ~60%/)).toBeUndefined()
  expect(await text(/7d [▰▱]+ ~80%/)).toMatch(/ · 7d [▰▱]+ ~80% /) // the live reading carries no 7d window: the cache's one stays, with its ~
  await ui.unmount()
})

test('last known: each window is drawn from the engine when it has that kind, else from the cache with a ~', async ($, on) => {
  world(on, { rateLimits: [], files: { [RL_FILE]: rlCache(40, 20) } })
  on('session.measure', (_, e) => ({ changed: e.changed }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 50)
  const text = async (re: RegExp) => rowTexts(await ui.drawn()).find(r => re.test(r))
  await measureWith($, 25, [{ kind: 'seven_day', percentUsed: 10, resetsAt: iso(86_400_000) }])
  await settleAll()
  expect(await text(/5h [▰▱]+ ~60%/)).toMatch(/^5h [▰▱]+ ~60% .* · 7d /) // only the 7d is live: the 5h row does not vanish
  expect(await text(/7d [▰▱]+ 90%/)).toBeDefined()
  expect(await text(/7d [▰▱]+ ~80%/)).toBeUndefined()
  await ui.unmount()
})

test('last known: a cache window that is over reads 100 % left with no countdown; a missing cache draws nothing', async ($, on) => {
  world(on, { rateLimits: [], files: { [RL_FILE]: JSON.stringify({ five_hour: { used_percentage: 90, resets_at: NOW / 1000 - 60 } }) } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 50)
  expect(rowTexts(await ui.drawn()).find(r => /^5h /.test(r))).toMatch(/^5h [▰▱]+ ~100%$/) // no countdown: nothing after the percent
  await ui.unmount()
})

test('last known: a resumed session shows the context of its last state with a dim ~ until the engine measures it, and keeps it in its data file', async ($, on) => {
  const writes = new Map<string, string>()
  const clock = world(on, { isFresh: true, writes, dataFile: JSON.stringify({ history: [], ctx: { tokens: 600_000, window: 1_000_000, percent: 60 } }) })
  on('session.measure', (_, e) => ({ changed: e.changed }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 50)
  const text = async (re: RegExp) => (await ui.find({ type: 'Text', text: re }))?.text
  const ctxRow = async () => rowTexts(await ui.drawn()).find(r => /^CTX /.test(r))
  expect(await ctxRow()).toMatch(/^CTX [▰▱]+ ~60% {3}600K\/1M {10}$/)
  expect(rowTexts(await ui.drawn()).some(r => /^󰀦/.test(r))).toBe(false)
  await measureWith($, 61)
  await settleAll()
  expect(await ctxRow()).toMatch(/^CTX [▰▱]+ {2}61% {3}610K\/1M {10}$/)
  await clock.advance(3000)
  await settleAll()
  expect(dataOf(writes)?.ctx).toEqual({ tokens: 610_000, window: 1_000_000, percent: 61 })
  await ui.unmount()
})

test('last known: once the engine has measured, a compaction that reports no percent does not bring the resumed value back', async ($, on) => {
  world(on, { isFresh: true, dataFile: JSON.stringify({ history: [], ctx: { tokens: 600_000, window: 1_000_000, percent: 60 } }) })
  on('session.measure', (_, e) => ({ changed: e.changed }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 50)
  const text = async (re: RegExp) => (await ui.find({ type: 'Text', text: re }))?.text
  await measureWith($, 61)
  await settleAll()
  await $.session.measure({ context: { window: 1_000_000 }, rateLimits: [], cost: { usd: 5 }, changed: ['context'] })
  await settleAll()
  expect(await text(/^~\d+% /)).toBeUndefined()
  await ui.unmount()
})
