import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { spanText, spanWidth, textCells } from '../hooks/shared'
import { setLang } from '../hooks/strings'
import { toolCallSpans } from '../hooks/view-insights'
import { IT_FILE, insightsRows, roundHooks, settleAll, workRows } from './cockpit-fixtures'
import { NOW, dataOf, world } from './cockpit-world'
import type { World } from './cockpit-world'

test('Insights: the tools by type with their failures, and the last 5 main-loop calls, newest first, each with its short argument, outcome and time; a subagent call is not one', async ($, on) => {
  world(on)
  on('tool.call', { tool: 'Bash' }, () => ({ result: {} }))
  on('tool.call', { tool: 'Read' }, () => ({ result: {} }))
  on('tool.call', { tool: 'Edit' }, () => ({ deny: 'no' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  for (let i = 1; i <= 9; i++) await $.tool.call({ tool: 'Bash', command: `echo ${i}` })
  await $.tool.call({ tool: 'Read', file_path: '/w/src/orders/Filter.ts' })
  await $.tool.call({ tool: 'Edit', file_path: '/w/x.ts', old_string: 'a', new_string: 'b' })
  await $.tool.call({ tool: 'Bash', command: 'from a subagent', agentId: 'a1' })
  const rows = await insightsRows($)
  const i = rows.findIndex(r => r === 'TOOLS · 11 calls')
  expect(i).toBeGreaterThan(0)
  expect(rows[i - 1]).toBe(' ')
  expect(rows[i - 2]).toMatch(/^─+$/)
  // by type, the most called first; a refused call is a failure
  expect(rows.slice(i + 2, i + 5)).toEqual([expect.stringMatching(/^Bash +9$/), expect.stringMatching(/^Edit +1 {2}✗ 1$/), expect.stringMatching(/^Read +1$/)])
  const last = rows.findIndex(r => r === 'last')
  const list = rows.slice(last + 1, last + 6)
  expect(list[0]).toMatch(/^✗ Edit +x\.ts +\d\d:\d\d$/)
  expect(list[1]).toMatch(/^✓ Read +Filter\.ts +\d\d:\d\d$/)
  expect(list[2]).toMatch(/^✓ Bash +echo 9 +\d\d:\d\d$/)
  expect(list[4]).toMatch(/^✓ Bash +echo 7 +\d\d:\d\d$/)
  expect(rows.some(r => /subagent/.test(r))).toBe(false)
  expect((await workRows($)).some(r => /^TOOL/.test(r))).toBe(false)
})

test('Insights: a tool row is cut to the width: a long argument ends with an ellipsis and the time stays', async ($, on) => {
  world(on)
  on('tool.call', { tool: 'Bash' }, () => ({ result: {} }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'dotnet test --filter "FullyQualifiedName~Orders.Filter.VeryLongTestName" --no-build' })
  const row = (await insightsRows($, 40)).find(r => /^[✓✗] Bash/.test(r)) ?? ''
  expect([...row].length).toBe(38)
  expect(row).toMatch(/…\s+\d\d:\d\d$/)
})

test('follow-up: a tool row without a time (the clock failed) draws no time, never 01:00', () => {
  const spans = toolCallSpans({ tool: 'Bash', arg: 'echo 1', isOk: true }, 40)
  expect(spanText(spans)).toMatch(/^✓ Bash +echo 1 *$/)
  expect(spanText(spans)).not.toMatch(/\d\d:\d\d/)
  expect(spanWidth(spans)).toBeLessThanOrEqual(40)
  expect(spanText(toolCallSpans({ tool: 'Bash', arg: 'echo 1', isOk: true, at: NOW }, 40))).toMatch(/\d\d:\d\d$/)
})

test('follow-up: a main-loop tool call whose start time could not be read is listed without a time', async ($, on) => {
  let isFailing = false
  const wrapped = (pattern: string, ...rest: unknown[]) => {
    const hook = rest.pop() as (...args: unknown[]) => unknown
    const guarded =
      pattern === 'clock.now'
        ? (...args: unknown[]) => {
            if (isFailing) throw new Error('clock refused')
            return hook(...args)
          }
        : hook
    return (on as unknown as (...a: unknown[]) => unknown)(pattern, ...rest, guarded)
  }
  world(wrapped as unknown as On)
  on('tool.call', { tool: 'Bash' }, () => ({ result: {} }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  isFailing = true
  await $.tool.call({ tool: 'Bash', command: 'echo no-clock' })
  isFailing = false
  const row = (await insightsRows($)).find(r => /echo no-clock/.test(r)) ?? ''
  expect(row).toMatch(/^✓ Bash +echo no-clock *$/)
})

// ── Phase 9: the Insights tab ──

/** A main round: the turn starts, the engine measures the cost, the turn ends with `read` tokens served from the cache of `read + write + 600`. */
const insightRound = async ($: Engine, usd: number, ms: number, cache: { read: number; write: number }) => {
  await $.turn.start({ text: 'go', turnId: 't' })
  await $.session.measure({ context: { window: 1_000_000, tokens: 100_000, percent: 10 }, rateLimits: [], cost: { usd }, changed: ['context'] })
  await $.turn.complete({
    answer: '',
    durationMs: ms,
    isAborted: false,
    turnId: 't',
    reason: 'answer',
    usage: { input_tokens: 600, output_tokens: 7, cache_read_input_tokens: cache.read, cache_creation_input_tokens: cache.write, model: 'm' },
  })
}

test('Insights: before any round or call the tab says there is nothing to show', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(await insightsRows($)).toContain('nothing to show')
})

test('Insights: the rhythm of the rounds (their number, the mean cost, the dearest with its length, the compactions) and the cache efficiency', async ($, on) => {
  world(on)
  roundHooks(on)
  on('classic.PostCompact', () => ({}))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await insightRound($, 5.02, 60_000, { read: 94_000, write: 5_400 }) // the session was at 4.82: 0.20
  await insightRound($, 6.22, 240_000, { read: 30_000, write: 69_400 }) // 1.20
  await $.classic.PostCompact({ trigger: 'auto', compact_summary: 'summary' })
  await $.classic.PostCompact({ trigger: 'manual', compact_summary: 'summary' })
  const rows = await insightsRows($)
  const i = rows.indexOf('RHYTHM')
  expect(i).toBeGreaterThan(0)
  expect(rows.slice(i - 2, i)).toEqual([expect.stringMatching(/^─+$/), ' '])
  expect(rows.slice(i + 2, i + 6)).toEqual(['rounds       2', 'cost / round $0.700', 'costliest    $1.20 · 4m00s', 'compactions  2'])
  // no tool and no wait: all the time is the model's
  expect(rows).toContain('EFFICIENCY')
  expect(rows.find(r => /^model /.test(r))).toBe('model        100% 5m00s')
  expect(rows.find(r => /^cache hit/.test(r))).toMatch(/^cache hit +62% {2}█▃$/)
  expect(rows.some(r => /^subagents/.test(r) || /of the tokens/.test(r))).toBe(false)
})

test('Insights: the time of the rounds splits into the model, the tools and the waits on permissions', async ($, on) => {
  const clock = world(on)
  roundHooks(on)
  let releaseTool = () => {}
  let releaseAsk = () => {}
  const toolGate = new Promise<void>(resolve => void (releaseTool = resolve))
  const askGate = new Promise<void>(resolve => void (releaseAsk = resolve))
  on('tool.call', { tool: 'Bash' }, async () => {
    await toolGate
    return { result: {} }
  })
  on('classic.PermissionRequest', async () => {
    await askGate
    return { decision: { behavior: 'allow' } }
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'go', turnId: 't' })
  const call = $.tool.call({ tool: 'Bash', command: 'sleep 30' })
  await settleAll()
  await clock.advance(30_000)
  releaseTool()
  await call
  const ask = $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: {} })
  await settleAll()
  await clock.advance(10_000)
  releaseAsk()
  await ask
  await $.turn.complete({ answer: '', durationMs: 100_000, isAborted: false, turnId: 't', reason: 'answer' })
  const rows = await insightsRows($)
  const i = rows.indexOf('TIME')
  expect(i).toBeGreaterThan(0)
  expect(rows.slice(i + 2, i + 5)).toEqual(['model         60% 1m00s', 'tools         30% 30s', 'permissions   10% 10s'])
})

test('Insights: a permission wait inside a tool call counts once, as a wait, not also as tool time', async ($, on) => {
  const clock = world(on)
  roundHooks(on)
  let releaseTool = () => {}
  let releaseAsk = () => {}
  const toolGate = new Promise<void>(resolve => void (releaseTool = resolve))
  const askGate = new Promise<void>(resolve => void (releaseAsk = resolve))
  on('tool.call', { tool: 'Bash' }, async () => {
    await toolGate
    return { result: {} }
  })
  on('classic.PermissionRequest', async () => {
    await askGate
    return { decision: { behavior: 'allow' } }
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'go', turnId: 't' })
  const call = $.tool.call({ tool: 'Bash', command: 'sleep 30' })
  await settleAll()
  await clock.advance(10_000)
  const ask = $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: {} })
  await settleAll()
  await clock.advance(10_000)
  releaseAsk()
  await ask
  await clock.advance(20_000)
  releaseTool()
  await call
  await $.turn.complete({ answer: '', durationMs: 100_000, isAborted: false, turnId: 't', reason: 'answer' })
  const rows = await insightsRows($)
  const i = rows.indexOf('TIME')
  expect(rows.slice(i + 2, i + 5)).toEqual(['model         60% 1m00s', 'tools         30% 30s', 'permissions   10% 10s'])
})

test('Insights: a permission wait takes off a tool call only the part of it inside the call, so a call that began during the wait loses just that part', async ($, on) => {
  const clock = world(on)
  roundHooks(on)
  let releaseTool = () => {}
  let releaseAsk = () => {}
  const toolGate = new Promise<void>(resolve => void (releaseTool = resolve))
  const askGate = new Promise<void>(resolve => void (releaseAsk = resolve))
  on('tool.call', { tool: 'Bash' }, async () => {
    await toolGate
    return { result: {} }
  })
  on('classic.PermissionRequest', async () => {
    await askGate
    return { decision: { behavior: 'allow' } }
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'go', turnId: 't' })
  const ask = $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: {} })
  await settleAll()
  await clock.advance(10_000)
  const call = $.tool.call({ tool: 'Bash', command: 'sleep 90' })
  await settleAll()
  await clock.advance(20_000)
  releaseAsk()
  await ask
  await clock.advance(70_000)
  releaseTool()
  await call
  await $.turn.complete({ answer: '', durationMs: 100_000, isAborted: false, turnId: 't', reason: 'answer' })
  const rows = await insightsRows($)
  const i = rows.indexOf('TIME')
  expect(rows.slice(i + 2, i + 5)).toEqual(['model          0% 0s', 'tools         70% 1m10s', 'permissions   30% 30s'])
})

test('Insights: each hint shows while its cause holds: a file read 6 times, a cold cache for 3 rounds, 7 failed commands, subagents over 60 % of the tokens, a round over 10 minutes', async ($, on) => {
  world(on, { stateFile: JSON.stringify({ open: false, tab: 'agents', mainTokens: 100, agentTokens: 900 }) })
  roundHooks(on)
  on('tool.call', { tool: 'Read' }, () => ({ result: {} }))
  on('tool.call', { tool: 'Bash' }, () => ({ deny: 'no' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const hints = async () => {
    const rows = await insightsRows($)
    const i = rows.indexOf('HINTS')
    return i < 0 ? [] : rows.slice(i + 2).filter(r => r.startsWith('⚠'))
  }
  expect(await hints()).toEqual(['⚠ subagents used 90% of the tokens'])
  expect((await insightsRows($)).filter(r => /of the tokens/.test(r))).toHaveLength(1) // the share is not also a fact under EFFICIENCY
  for (let n = 0; n < 5; n++) await $.tool.call({ tool: 'Read', file_path: '/w/src/a.ts' })
  expect((await hints()).some(h => /read/.test(h))).toBe(false)
  await $.tool.call({ tool: 'Read', file_path: '/w/src/a.ts' })
  expect(await hints()).toContain('⚠ a.ts read 6 times')
  for (let n = 0; n < 6; n++) await $.tool.call({ tool: 'Bash', command: 'false' })
  expect((await hints()).some(h => /failed/.test(h))).toBe(false)
  await $.tool.call({ tool: 'Bash', command: 'false' })
  expect(await hints()).toContain('⚠ 7 failed commands')
  for (let n = 0; n < 3; n++) await insightRound($, 5, 1000, { read: 10, write: 60_000 }) // 0 % served from the cache
  expect(await hints()).toContain('⚠ cache under 50% for 3 rounds')
  await insightRound($, 5, 601_000, { read: 90_000, write: 0 }) // a long round, the cache warm again
  const now = await hints()
  expect(now).toContain('⚠ the last round took 10m01s')
  expect(now.some(h => /cache/.test(h))).toBe(false)
  await insightRound($, 5, 1000, { read: 90_000, write: 0 })
  expect((await hints()).some(h => /last round/.test(h))).toBe(false)
})

test('Insights: in Italian every title and hint', async ($, on) => {
  world(on, { files: IT_FILE, stateFile: JSON.stringify({ open: false, tab: 'agents', mainTokens: 100, agentTokens: 900_000 }) })
  roundHooks(on)
  on('tool.call', { tool: 'Bash' }, () => ({ result: {} }))
  try {
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    await $.tool.call({ tool: 'Bash', command: 'ls' })
    await insightRound($, 5, 60_000, { read: 94_000, write: 5_400 })
    const rows = await insightsRows($)
    for (const re of [/^RITMO$/, /^TEMPO$/, /^TOOL · 1 chiamata$/, /^EFFICIENZA$/, /^SUGGERIMENTI$/, /^⚠ i subagent hanno usato il 99% dei token$/, /^giri +1$/, /^costo \/ giro/, /^permessi/]) {
      expect([re.source, rows.some(r => re.test(r))]).toEqual([re.source, true])
    }
  } finally {
    setLang('en')
  }
})

test('Insights: in Italian the percent of a hint takes its article, elided before 85', async ($, on) => {
  const options: World = { files: IT_FILE, stateFile: JSON.stringify({ open: false, tab: 'agents', mainTokens: 150, agentTokens: 850 }) }
  world(on, options)
  try {
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    expect((await insightsRows($)).filter(r => r.startsWith('⚠'))).toEqual(["⚠ i subagent hanno usato l'85% dei token"])
  } finally {
    setLang('en')
  }
})

// ── Phase 9: what the tabs hold belongs to the session that is current ──

test('scoping: the Insights counters, tool calls and last rounds of a session are not the next one\'s, and the last rounds stay in the first one\'s data file', async ($, on) => {
  let id = 's-1'
  const writes = new Map<string, string>()
  world(on, { sessionId: () => id, writes })
  roundHooks(on)
  on('tool.call', { tool: 'Bash' }, () => ({ result: {} }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'echo a' })
  await insightRound($, 5.02, 60_000, { read: 94_000, write: 5_400 })
  const first = await insightsRows($)
  expect(first).toContain('RHYTHM')
  expect(first).toContain('TOOLS · 1 call')
  await $.session.end({ reason: 'clear', sessionId: 's-1', resume: { id: 's-1' } })
  id = 's-2'
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(await insightsRows($)).toEqual(expect.arrayContaining(['nothing to show']))
  expect(dataOf(writes)).toMatchObject({ ctxRounds: [expect.any(Number)] })
})

// ── Cockpit v2 follow-ups: what grew the context, the last error, the context around compactions, this chat's edits ──

test('Insights: the five largest results of the main loop, with the tool, its short argument and the estimated tokens; a subagent call is not counted', async ($, on) => {
  world(on)
  on('tool.call', { tool: 'Read' }, (_, e) => ({ result: {}, text: 'x'.repeat(e.file_path.endsWith('big.ts') ? 152_000 : 400) }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  for (const name of ['a', 'b', 'c', 'd', 'e', 'f']) await $.tool.call({ tool: 'Read', file_path: `/w/${name}.ts` })
  await $.tool.call({ tool: 'Read', file_path: '/w/big.ts' })
  await $.tool.call({ tool: 'Read', file_path: '/w/sub.ts', agentId: 'a1' })
  const rows = await insightsRows($)
  const i = rows.indexOf('WHAT GREW THE CONTEXT')
  expect(i).toBeGreaterThan(0)
  const listed = rows.slice(i + 2, i + 7)
  expect(listed[0]).toMatch(/^Read +big\.ts +\+38k$/)
  expect(listed.slice(1)).toHaveLength(4)
  for (const row of listed.slice(1)) expect(row).toMatch(/^Read +[a-f]\.ts +\+100$/)
  expect(rows[i + 7]).not.toMatch(/^Read/)
})

test('Insights: the last failed call of the main loop, its error on one line with the tool; none while nothing failed', async ($, on) => {
  world(on)
  on('tool.call', { tool: 'Bash' }, (_, e) => (e.command === 'bad' ? { result: {}, isError: true, text: `exit 1\n${'boom '.repeat(30)}` } : { result: {}, text: 'ok' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'fine' })
  expect(await insightsRows($)).not.toContain('LAST ERROR')
  await $.tool.call({ tool: 'Bash', command: 'bad' })
  const rows = await insightsRows($)
  const i = rows.indexOf('LAST ERROR')
  expect(i).toBeGreaterThan(0)
  expect(rows[i + 2]).toMatch(/^✗ Bash +exit 1 boom boom .*…$/)
  expect(textCells(rows[i + 2] ?? '')).toBeLessThanOrEqual(48)
  await $.tool.call({ tool: 'Bash', command: 'fine' }) // a later success leaves the last failure on show
  expect(await insightsRows($)).toContain('LAST ERROR')
})

test('Insights: the context before and after each compaction, the last three, the after being the first reading that follows', async ($, on) => {
  world(on)
  roundHooks(on)
  on('classic.PostCompact', () => ({}))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const measure = (tokens: number) => $.session.measure({ context: { window: 1_000_000, tokens, percent: tokens / 10_000 }, rateLimits: [], cost: { usd: 1 }, changed: ['context'] })
  await insightRound($, 1, 1000, { read: 100, write: 100 })
  for (const [before, after] of [[300_000, 30_000], [412_000, 38_000], [500_000, 45_000], [600_000, 50_000]] as const) {
    await measure(before)
    await $.classic.PostCompact({ trigger: 'auto', compact_summary: 's' })
    await measure(after)
    await measure(after + 7000) // a later reading does not move it
  }
  await measure(700_000)
  await $.classic.PostCompact({ trigger: 'manual', compact_summary: 's' }) // no reading since
  const rows = await insightsRows($)
  const i = rows.findIndex(r => /^compactions +5$/.test(r))
  expect(i).toBeGreaterThan(0)
  expect(rows.slice(i + 1, i + 4).map(r => r.replace(/ +/g, ' '))).toEqual(['context 500k → 45k', ' 600k → 50k', ' 700k → …'])
})
