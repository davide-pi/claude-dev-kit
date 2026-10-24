import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { ICONS, TABS, spanText, spanWidth, textCells } from '../hooks/format'
import { subagentDetails, toolCallSpans } from '../hooks/view'
import type { AgentStatus, On, SessionContextBreakdown } from 'claude-code'

const NOW = Date.parse('2026-10-22T10:00:00Z')
/** An ssh `origin` URL of GitHub (joined, so the text is not read as an e-mail address). */
const GH_SSH = ['git', 'github.com:example/orders.git'].join('@')
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString()

const PANE = {
  plugin: 'cockpit',
  component: 'Pane',
  requestId: 'cockpit',
  props: { title: 'cockpit', isFocused: false, bodyColumns: 50, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

/** The text of the pane's top-level rows, in order (an empty row reads ' '). */
const rowTexts = (root: unknown): string[] => {
  const text = (el: unknown): string => {
    if (typeof el === 'string') return el
    const o = el as { text?: string; children?: unknown[] } | null
    return o?.text ?? (o?.children ?? []).map(text).join('')
  }
  return ((root as { children?: unknown[] }).children ?? []).map(text)
}

/** The left margin of the drawn root: the column its content starts at. */
const marginOf = (root: unknown): number => (root as { props?: { marginLeft?: number } }).props?.marginLeft ?? 0

/** Lets what a hook left running (the unawaited flag write of a first render) settle. */
declare const setTimeout: (fn: () => void, ms: number) => unknown // the test runtime has it; the module's types do not
const settle = () => new Promise<void>(resolve => setTimeout(resolve, 0))

type World = {
  isPlaced?: boolean
  env?: Record<string, string>
  store?: Record<string, unknown>
  /** A session before its first response: no context measured, no cost. */
  isFresh?: boolean
  /** Receives the id of every pane the mod opens. */
  opened?: string[]
  /** Receives the `columns` of every pane the mod opens. */
  openedColumns?: (number | undefined)[]
  /** Receives the origin kind of every close the mod's hooks let through. */
  closed?: string[]
  /** A worklog snapshot with one pending day, as the worklog hook writes it. */
  hasWorklog?: boolean
  /** Receives every `$.fs.write`: the text by path, the last write winning. */
  writes?: Map<string, string>
  /** What `$.session.id()` answers (`s-1` when not given). */
  sessionId?: () => string
  /** True: every `$.fs.write` fails, as one the exit's short budget cuts off. Read at every call. */
  failWrites?: () => boolean
  /** Receives the path of every `$.fs.write`, one entry per write. */
  log?: string[]
  /** The rate-limit windows `$.session.usage()` answers (a 5h and a 7d one when not given). */
  rateLimits?: { kind: string; percentUsed: number; resetsAt?: string }[]
  /** The text of `<config>/workspaces.json`; absent, the file answers an empty map. */
  workspaces?: unknown
  /** The raw text of `<config>/workspaces.json`, answered as is (a malformed file): wins over `workspaces`. */
  workspacesRaw?: string
  /** True: reading `<config>/workspaces.json` fails (no such file), whatever `workspaces` says. Read at every call. */
  workspacesFail?: boolean
  /** The text of this session's state file, as an earlier run left it. */
  stateFile?: string
  /** True: every git command fails, as in a folder that is not a repository. */
  notRepo?: boolean
  /** True: git is on a detached HEAD (`## HEAD (no branch)`). */
  detached?: boolean
  /** The agents `$.agent.list()` answers, read at every call (none when not given). */
  listed?: { id: string; status: AgentStatus }[]
  /** Receives the `agentId` of every `$.ui.view`. */
  viewed?: (string | undefined)[]
  /** The context fill `$.session.usage()` answers (25 when not given). */
  ctxPercent?: number
  /** Receives `session.compact`, in order. */
  calls?: string[]
  /** Receives the `instructions` of every `session.compact`. */
  instructions?: (string | undefined)[]
  /** Receives the line of every `command.run` (`/<command> <args>`). */
  commands?: string[]
  /** The text of this branch's deliver perimeter file (`<git-dir>/deliver/perimeter.md`). */
  perimeter?: string
  /** The branch `git status` reports (`feature/x` when not given). */
  branch?: string
  /** The URL of remote `origin`; absent, the repository has no remote. */
  remote?: string
  /** The repo's default branch, as `origin/HEAD` names it; absent, `origin/HEAD` is not set. */
  defaultBranch?: string
  /** The number `gh pr view` answers; absent, gh answers that the branch has no PR. */
  pr?: number
  /** The state `gh pr view` answers (`OPEN` when not given). */
  prState?: string
  /** True: `gh` is not installed (the process cannot start). */
  noGh?: boolean
  /** Receives every `gh` call's argv, joined by spaces. */
  ghCalls?: string[]
  /** What `git diff --name-only HEAD` lists: the tracked files changed since HEAD. */
  changed?: string[]
  /** What `git ls-files --others` lists: the untracked, not ignored files. */
  untracked?: string[]
  /** True: `git diff` fails (no HEAD yet, say). */
  failDiff?: boolean
  /** Receives the argv (joined by spaces) of every `git diff` and `git ls-files` call. */
  gitCalls?: string[]
  /** The text of `<config>/.cache/done-claim.log`; absent, the default answer holds no log line. */
  doneClaims?: string
  /** The `mtimeMs` `fs.stat` answers for `done-claim.log` (its size is the text's length); read at every call. */
  claimsMtime?: () => number
  /** Receives the path of every read of `done-claim.log`. */
  claimReads?: string[]
  /** The tail of the `status -b` header after the branch name (`...origin/x [ahead 2, behind 1]`); absent, no upstream. */
  upstream?: string
  /** What `git diff --numstat` lists: `[added, deleted, path]` per tracked file (`-` for a binary one). */
  numstat?: [string, string, string][]
  /** The raw text of `git worktree list --porcelain`. */
  worktrees?: string
  /** What `git diff HEAD -- <file>` prints, by path. */
  fileDiffs?: Record<string, string>
  /** The text of the working-tree files `fs.read` answers, by path tail (the untracked files the diff pane reads). */
  files?: Record<string, string>
  /** Extra fields of the `gh pr view` answer (title, reviewDecision, statusCheckRollup, isDraft ...). */
  prExtra?: Record<string, unknown>
  /** The list `az repos pr list` answers; absent, az answers an empty list. */
  azPr?: readonly unknown[]
  /** True: `az` is not installed (the process cannot start). */
  noAz?: boolean
  /** Receives every `az` call's argv, joined by spaces. */
  azCalls?: string[]
  /** Receives the title of every pane the mod opens. */
  openedTitles?: (string | undefined)[]
  /** Receives the `env` each `az` call was started with (undefined when it set none). */
  azEnvs?: (Record<string, string> | undefined)[]
  /** The `.azure-<identity>` folders (by path tail) that exist; any other `.azure-*` stat fails. */
  azDirs?: string[]
  /** The size `fs.stat` answers for a working-tree file, by path tail. */
  fileSizes?: Record<string, number>
  /** The working-tree files (by path tail) whose `fs.read` fails. */
  unreadable?: string[]
  /** A promise the first `git rev-parse` waits on: the git read of a refresh that a later one overtakes. */
  holdRevParse?: Promise<void>
  /** True: `git rev-parse` answers a linked worktree (its git dir differs from the common one). */
  isLinkedWorktree?: boolean
  /** Receives the argv (joined by spaces) of every `git status` call: the header's git reads. */
  statusCalls?: string[]
  /** Receives one entry per `$.agent.list()` call. */
  listCalls?: string[]
  /** A promise every `$.agent.list()` waits on, read at every call: a clock tick stuck listing the agents. */
  holdList?: () => Promise<void> | undefined
  /** The token count at which auto-compaction runs, answered to `usage({ breakdown })`; absent, the breakdown says it is off. */
  autoCompactAt?: number
  /** Receives the `breakdown` argument of every `$.session.usage()` call. */
  usageCalls?: (string | undefined)[]
  /** Fields of the breakdown `usage({ breakdown })` answers, over the empty fixture (categories, memory files, MCP tools, agents, skills ...). */
  breakdown?: Partial<SessionContextBreakdown>
  /** Fields laid over `breakdown` for a `full` read: what the token-count API would count more exactly. */
  exactBreakdown?: Partial<SessionContextBreakdown>
  /** A promise a `usage({ breakdown })` read waits on, by detail (`summary` or `full`), read at every call: a breakdown read that is slow. */
  holdUsage?: (detail: string) => Promise<void> | undefined
  /** The text of this session's data file (`cockpit-data-s-1.json`), as an earlier run left it; absent, the file answers an empty object. */
  dataFile?: string
  /** Receives the text of every `$.ui.toast`. */
  toasts?: string[]
  /** Receives every `$.prompt.fill`: its text and mode. */
  fills?: { text: string; mode?: string }[]
  /** True: the prompt box refuses every `$.prompt.fill` (a dialog holds the keys). */
  fillRefused?: boolean
}

/** The harness reports a path in the host's own spelling (backslashes on Windows): compared by its tail. */
const FLAG = /cockpit-s-1\.json$/
const DATA = /cockpit-data-s-1\.json$/
/** The context the world measures at start, as the data file keeps it. */
const LIVE_CTX = { tokens: 248_000, window: 1_000_000, percent: 25 }

/** The world beneath the plugin: what the engine would answer to the calls the mod makes. */
function world(on: On, options: World = {}) {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on, options.store)
  mock.env(on, options.env ?? { CLAUDE_CONFIG_DIR: '/cfg' })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: options.sessionId?.() ?? 's-1' }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.cwd', () => ({ value: '/work/example-repo' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('settings.read', () => ({ value: { effortLevel: 'high' } }))
  on('session.usage', async (_, e) => {
    options.usageCalls?.push(e.breakdown)
    if (e.breakdown !== undefined) await options.holdUsage?.(e.breakdown)
    const breakdown: SessionContextBreakdown = {
      categories: [],
      totalTokens: 248_000,
      maxTokens: 1_000_000,
      rawMaxTokens: 1_000_000,
      autocompactSource: 'auto',
      percentage: 25,
      gridRows: [],
      model: 'claude-opus-5-5',
      memoryFiles: [],
      mcpTools: [],
      agents: [],
      ...(options.autoCompactAt !== undefined && { autoCompactThreshold: options.autoCompactAt }),
      isAutoCompactEnabled: options.autoCompactAt !== undefined,
      apiUsage: null,
      ...options.breakdown,
      ...(e.breakdown === 'full' && options.exactBreakdown),
    }
    return {
      value: {
        startedAt: NOW,
        context: {
          ...(options.isFresh ? { window: 1_000_000 } : { window: 1_000_000, tokens: 248_000, percent: options.ctxPercent ?? 25 }),
          ...(e.breakdown !== undefined && { breakdown }),
        },
        rateLimits: options.rateLimits ?? [
          { kind: 'five_hour', percentUsed: 38, resetsAt: iso((2 * 60 + 14) * 60000) },
          { kind: 'seven_day', percentUsed: 59, resetsAt: iso(0.46 * 604800 * 1000) },
        ],
        cost: { usd: options.isFresh ? 0 : 4.82 },
      },
    }
  })
  on('process.run', async (_, e) => {
    const answer = (stdout: string, exitCode = 0) => ({
      value: { exitCode, stderr: '', isStdoutTruncated: false, isStderrTruncated: false, stdout },
    })
    if (e.argv[0] === 'gh') {
      options.ghCalls?.push(e.argv.join(' '))
      if (options.noGh) throw new Error('spawn gh ENOENT')
      return options.pr === undefined
        ? answer('', 1)
        : answer(JSON.stringify({ number: options.pr, state: options.prState ?? 'OPEN', title: 'Fix the orders filter', ...options.prExtra }))
    }
    // On Windows the mod starts az through cmd, the way a shell would resolve az.cmd.
    if (e.argv[0] === 'az' || (e.argv.slice(0, 4).join(' ') === 'cmd /d /s /c' && e.argv[4] === 'az')) {
      options.azCalls?.push(e.argv.join(' '))
      options.azEnvs?.push(e.init?.env)
      if (options.noAz) throw new Error('spawn az ENOENT')
      return answer(JSON.stringify(options.azPr ?? []))
    }
    if (options.notRepo) return answer('', 128)
    if (e.argv.includes('--numstat')) return answer((options.numstat ?? []).map(([a, d, p]) => `${a}\t${d}\t${p}\0`).join(''))
    if (e.argv.includes('worktree')) return answer(options.worktrees ?? '')
    if (e.argv.includes('diff') && !e.argv.includes('--name-only')) return answer(options.fileDiffs?.[e.argv.at(-1) ?? ''] ?? '')
    if (e.argv.includes('diff') || e.argv.includes('ls-files')) {
      options.gitCalls?.push(e.argv.join(' '))
      if (options.failDiff) return answer('', 128)
      return answer((e.argv.includes('diff') ? (options.changed ?? []) : (options.untracked ?? [])).map(f => `${f}\0`).join(''))
    }
    if (e.argv.includes('rev-parse')) {
      const hold = options.holdRevParse
      options.holdRevParse = undefined
      await hold
      return answer(`${options.isLinkedWorktree ? '/work/example-repo/.git/worktrees/wt' : '.git'}\n.git\n/work/example-repo\n`)
    }
    if (e.argv.includes('symbolic-ref')) return options.defaultBranch === undefined ? answer('', 128) : answer(`origin/${options.defaultBranch}\n`)
    if (e.argv.includes('get-url')) return options.remote === undefined ? answer('', 2) : answer(`${options.remote}\n`)
    options.statusCalls?.push(e.argv.join(' '))
    const header = options.detached ? 'HEAD (no branch)' : `${options.branch ?? 'feature/x'}${options.upstream === undefined ? '' : `...${options.upstream}`}`
    return answer(`## ${header}\nM  a.ts\n M b.ts\n?? c.ts\n`)
  })
  on('fs.read', (_, e) => {
    if (e.path.endsWith('workspaces.json')) {
      if (options.workspacesFail) throw new Error('ENOENT: no such file')
      return { value: options.workspacesRaw ?? JSON.stringify(options.workspaces ?? {}) }
    }
    if (FLAG.test(e.path) && options.stateFile !== undefined) return { value: options.stateFile }
    if (DATA.test(e.path) && options.dataFile !== undefined) return { value: options.dataFile }
    if (options.perimeter !== undefined && /deliver[\\/]perimeter\.md$/.test(e.path)) return { value: options.perimeter }
    if (/done-claim\.log$/.test(e.path)) options.claimReads?.push(e.path)
    if (options.doneClaims !== undefined && /done-claim\.log$/.test(e.path)) return { value: options.doneClaims }
    if (options.unreadable?.some(k => e.path.endsWith(k))) throw new Error('EACCES: permission denied')
    const file = Object.keys(options.files ?? {}).find(k => e.path.endsWith(k))
    if (file !== undefined) return { value: options.files?.[file] ?? '' }
    return {
      value: options.hasWorklog ? JSON.stringify({ day: '2026-10-22', auditMtime: 5, pending: [{ date: '2026-10-20' }], underTarget: [] }) : '{}',
    }
  })
  on('fs.stat', (_, e) => {
    if (/done-claim\.log$/.test(e.path)) return { value: { kind: 'file', size: options.doneClaims?.length ?? 0, mtimeMs: options.claimsMtime?.() ?? 0, isLink: false } }
    if (/[\\/]\.azure-[\w.-]+$/.test(e.path)) {
      if (options.azDirs?.some(d => e.path.endsWith(d))) return { value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false } }
      throw new Error('ENOENT: no such file or directory')
    }
    const sized = Object.keys(options.fileSizes ?? {}).find(k => e.path.endsWith(k))
    if (sized !== undefined) return { value: { kind: 'file', size: options.fileSizes?.[sized] ?? 0, mtimeMs: 0, isLink: false } }
    return { value: { kind: 'file', size: 0, mtimeMs: options.hasWorklog ? 5 : 0, isLink: false } }
  })
  on('agent.list', async () => {
    await options.holdList?.()
    options.listCalls?.push('list')
    return { value: (options.listed ?? []).map(l => ({ ...l, description: 'go', type: 'code-reviewer' })) }
  })
  on('ui.view', (_, e) => {
    options.viewed?.push(e.agentId)
    return { value: {} }
  })
  on('ui.open', (_, e) => {
    options.opened?.push(e.id)
    options.openedColumns?.push(e.columns)
    options.openedTitles?.push(e.title)
    return { value: options.isPlaced === false ? { isPlaced: false, reason: 'too narrow (80 < 144)' } : { isPlaced: true } }
  })
  on('ui.close', (_, e) => {
    options.closed?.push(e.origin.kind)
    return { value: undefined }
  })
  on('session.compact', (_, e) => {
    options.calls?.push('compact')
    options.instructions?.push(e.instructions)
    return { skip: 'test' }
  })
  on('command.run', { command: 'worklog' }, (_, e) => {
    options.commands?.push(`/${e.command} ${e.args}`)
    return { text: 'ok' }
  })
  on('ui.toast', (_, e) => {
    options.toasts?.push(e.text)
    return { value: undefined }
  })
  on('prompt.fill', (_, e) => {
    options.fills?.push({ text: e.text, mode: e.mode })
    return { isFilled: options.fillRefused !== true }
  })
  on('fs.write', (_, e) => {
    if (options.failWrites?.()) throw new Error('timed out')
    options.writes?.set(e.path, e.text)
    options.log?.push(e.text)
    return { value: undefined }
  })
  return clock
}

/** The statusline's state file as last written, parsed. */
const flagOf = (writes: Map<string, string>): unknown => {
  const path = [...writes.keys()].find(k => FLAG.test(k))
  return JSON.parse((path && writes.get(path)) || 'null')
}

/** The session data file as last written, parsed; null when none was written. */
const dataOf = (writes: Map<string, string>): Record<string, unknown> | null => {
  const path = [...writes.keys()].find(k => DATA.test(k))
  return JSON.parse((path && writes.get(path)) || 'null')
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
    expect(await text(/25% 248K\/1M/)).toBe(' 25% 248K/1M')
    expect(await text(/^ 62% 5h/)).toBe(' 62% 5h \u21bb  2h14m')
    expect(await text(/^ 41% 7d/)).toMatch(/^ 41% 7d \u21bb  3d\d\dh$/)
    expect(await text(/vs expected/)).toBe('vs expected 7d  \u22125%')
    // Subagents is the tab the pane opens on: the row is one pressable Button: its text is the whole row
    const row = (await ui.find({ key: 'agent:a1' }))?.text
    expect(row).toContain('\u2713 code-reviewer')
    expect(await text(/son 5\.5/)).toContain('son 5.5')
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
  expect(keys).toEqual(['tab:agents', 'tab:context', 'tab:work', 'tab:system', 'bar:compact', 'bar:worklog'])
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
  const [first = -1, second = -1] = rows.flatMap((r, i) => (/^\u2500+$/.test(r) ? [i] : []))
  const title = rows.findIndex(r => /^SUBAGENTS/.test(r))
  // header, rule, tab bar, the note's field, rule, then the tab's own content: an empty row first
  expect(first).toBe(headerOf(rows).length)
  expect(second).toBe(first + 3)
  expect(title).toBe(second + 2)
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

test('the pane is not opened at session start', async ($, on) => {
  const opened: string[] = []
  world(on, { opened })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await settle()
  expect(opened).toEqual([])
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
    tab: 'agents',
  })
  expect(Object.keys(flagOf(writes) as object)).toEqual(['open', 'at', 'lastTurnUsd', 'agents', 'effort', 'tasks', 'tab'])
  // what must survive a resume is in the session data file
  expect(dataOf(writes)).toEqual({ history: [], prs: [], ctx: LIVE_CTX })
})

const CLOSED = { open: false, at: NOW, lastTurnUsd: null, agents: { running: 0, modelWarnings: 0 }, effort: null, tasks: null, tab: 'agents' }

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
    tab: 'agents',
  })
  const afterFlush = log.length

  // nothing changed: a later moment writes nothing
  await clock.advance(2000)
  expect(log.length).toBe(afterFlush)
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

// ── Tasks ──

type Todo = { content: string; status: 'pending' | 'in_progress' | 'completed'; activeForm: string }
const todo = (content: string, status: Todo['status']): Todo => ({ content, status, activeForm: content })

/** The tools beneath the mod: TaskCreate answers with the next id, the others with their plain result. */
function taskTools(on: On) {
  let n = 0
  on('tool.call', { tool: 'TaskCreate' }, (_, e) => ({ result: { task: { id: String(++n), subject: e.subject } } }))
  on('tool.call', { tool: 'TaskUpdate' }, (_, e) => ({ result: { success: true, taskId: e.taskId, updatedFields: ['status'] } }))
  on('tool.call', { tool: 'TodoWrite' }, (_, e) => ({ result: { oldTodos: [], newTodos: e.todos } }))
}

const createTask = ($: Engine, subject: string, agentId?: string) =>
  $.tool.call({ tool: 'TaskCreate', subject, description: subject, ...(agentId ? { agentId } : {}) })
const updateTask = ($: Engine, taskId: string, status: 'pending' | 'in_progress' | 'completed' | 'deleted') =>
  $.tool.call({ tool: 'TaskUpdate', taskId, status })

async function taskRows($: Engine, bodyColumns = 50) {
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns }, surface: 'terminal' })
  await ui.press({ key: 'tab:work' })
  const rows = rowTexts(await ui.drawn())
  await ui.unmount()
  const i = rows.findIndex(r => /^TASK/.test(r))
  return { rows, i }
}

test('the task list comes from TodoWrite: title, counts, bar, rows by state and the completed row', async ($, on) => {
  const clock = world(on)
  taskTools(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({
    tool: 'TodoWrite',
    todos: [todo('Done one', 'completed'), todo('Pending one', 'pending'), todo('Working on it', 'in_progress'), todo('Done two', 'completed')],
  })
  await clock.advance(15_000 * 8) // 2m00s: the tick moves `now`

  const { rows, i } = await taskRows($)
  expect(rows[i]).toMatch(/^TASK · 2\/4◐ 1 {2}○ 1 {2}✓ 2$/)
  expect(rows[i - 1]).toBe(' ')
  // the tasks belong to the main agent's block
  expect(rows[i - 2]).toBe('MAIN')
  expect(rows[i - 3]).toBe(' ')
  expect(rows[i - 4]).toMatch(/^─+$/)
  expect(rows[i + 1]).toBe(' ')
  expect(rows[i + 2]).toMatch(/^[▰▱]{48}$/)
  // in progress first, with its elapsed time; then pending; then the completed row
  expect(rows[i + 3]).toMatch(/^◐ Working on it +2m00s$/)
  expect(rows[i + 4]).toMatch(/^○ Pending one +$/)
  expect(rows[i + 5]).toBe('✓ 2 done')
})

test('the bar splits its width by done, in progress and the rest', async ($, on) => {
  world(on)
  taskTools(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({
    tool: 'TodoWrite',
    todos: [todo('a', 'completed'), todo('b', 'completed'), todo('c', 'in_progress'), todo('d', 'pending')],
  })
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 40 }, surface: 'terminal' })
  await ui.press({ key: 'tab:work' })
  const cells: Record<string, number> = {}
  const walk = (el: unknown) => {
    const o = el as { props?: { color?: string }; children?: unknown[] } | null
    const [only] = o?.children ?? []
    if (typeof only === 'string' && /^[▰▱]+$/.test(only)) cells[o?.props?.color ?? ''] = (cells[o?.props?.color ?? ''] ?? 0) + [...only].length
    for (const c of o?.children ?? []) walk(c)
  }
  walk(await ui.drawn())
  await ui.unmount()
  // 40 cells: 2/4 done green, 1/4 in progress blue (the context and credit bars add their own green and blue)
  expect(cells['#7ec699']).toBeGreaterThanOrEqual(20)
  expect(cells['#7fb4ff']).toBeGreaterThanOrEqual(10)
})

test('the task list comes from the task tools: create, start, complete, delete', async ($, on) => {
  const writes = new Map<string, string>()
  const clock = world(on, { writes })
  taskTools(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await createTask($, 'First')
  await createTask($, 'Second')
  await createTask($, 'Third')
  await updateTask($, '1', 'in_progress')
  await updateTask($, '2', 'in_progress')
  await updateTask($, '2', 'completed')
  await updateTask($, '3', 'deleted')
  await clock.advance(3000)

  const { rows, i } = await taskRows($)
  expect(rows[i]).toMatch(/^TASK · 1\/2◐ 1 {2}○ 0 {2}✓ 1$/)
  expect(rows[i + 3]).toMatch(/^◐ First +/)
  expect(rows[i + 4]).toBe('✓ 1 done')
  expect(flagOf(writes)).toMatchObject({ tasks: { done: 1, total: 2 } })
})

test('TodoWrite replaces its own items and leaves the task-tool items', async ($, on) => {
  world(on)
  taskTools(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await createTask($, 'From a tool')
  await $.tool.call({ tool: 'TodoWrite', todos: [todo('Old todo', 'pending')] })
  await $.tool.call({ tool: 'TodoWrite', todos: [todo('New todo', 'pending'), todo('Other todo', 'pending')] })
  const { rows, i } = await taskRows($)
  expect(rows[i]).toMatch(/^TASK · 0\/3◐/)
  expect(rows.filter(r => /^○ /.test(r)).map(r => r.trim())).toEqual(['○ From a tool', '○ New todo', '○ Other todo'])
})

test('the task list is shared: a subagent TaskCreate/TaskUpdate counts, its TodoWrite does not', async ($, on) => {
  world(on)
  taskTools(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'TodoWrite', todos: [todo('private to the subagent', 'pending')], agentId: 'a1' })
  expect((await taskRows($)).i).toBe(-1)
  await createTask($, 'by a subagent', 'a1')
  await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'in_progress', agentId: 'a1' })
  const { rows, i } = await taskRows($)
  expect(rows[i]).toMatch(/^TASK · 0\/1◐ 1 {2}○ 0 {2}✓ 0$/)
  expect(rows[i + 3]).toMatch(/^◐ by a subagent/)
})

test('an update of a task the mod never saw adds it; a delete of one it never saw adds nothing', async ($, on) => {
  world(on)
  taskTools(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'TaskUpdate', taskId: '9', status: 'deleted' })
  expect((await taskRows($)).i).toBe(-1)
  await $.tool.call({ tool: 'TaskUpdate', taskId: '7', status: 'in_progress', subject: 'Resumed work' })
  await $.tool.call({ tool: 'TaskUpdate', taskId: '8', status: 'completed' })
  await $.tool.call({ tool: 'TaskUpdate', taskId: '9', subject: 'no status: not a task state' })
  const { rows, i } = await taskRows($)
  expect(rows[i]).toMatch(/^TASK · 1\/2◐ 1 {2}○ 0 {2}✓ 1$/)
  expect(rows[i + 3]).toMatch(/^◐ Resumed work/)
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

test('the section is omitted with no tasks, and the state file says tasks:null', async ($, on) => {
  const writes = new Map<string, string>()
  world(on, { writes })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const { rows, i } = await taskRows($)
  expect(i).toBe(-1)
  expect(rows.some(r => /done/.test(r))).toBe(false)
  expect((flagOf(writes) as { tasks: unknown }).tasks).toBeNull()
})

test('long subjects are cut with … and more than 6 open tasks end in … +N', async ($, on) => {
  world(on)
  taskTools(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const todos = [todo('A very long subject that cannot possibly fit in the narrow pane width', 'in_progress')]
  for (let n = 1; n <= 7; n++) todos.push(todo(`Pending ${n}`, 'pending'))
  await $.tool.call({ tool: 'TodoWrite', todos })
  const { rows, i } = await taskRows($, 40)
  expect(rows[i + 3]).toMatch(/^◐ A very long subject.*… +0s$/)
  expect([...(rows[i + 3] ?? '')].length).toBe(38)
  expect(rows.slice(i + 3, i + 9).filter(r => /^[◐○]/.test(r)).length).toBe(6)
  expect(rows[i + 9]).toBe('… +2')
})

test('the list is empty again at session start (a /clear included)', async ($, on) => {
  const writes = new Map<string, string>()
  let id = 's-1'
  world(on, { writes, sessionId: () => id })
  taskTools(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'TodoWrite', todos: [todo('x', 'pending')] })
  expect((await taskRows($)).i).toBeGreaterThan(0)
  id = 's-2'
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect((await taskRows($)).i).toBe(-1)
  const second = [...writes.entries()].find(([k]) => /cockpit-s-2\.json$/.test(k))
  expect((JSON.parse(second?.[1] ?? 'null') as { tasks: unknown }).tasks).toBeNull()
})

// ── Credits, cache share, ALM ──

/** The color of the first leaf Text whose content matches `re`. */
const colorOf = (root: unknown, re: RegExp): string | undefined => {
  const o = root as { props?: { color?: string }; children?: unknown[] } | null
  const [only] = o?.children ?? []
  if (typeof only === 'string' && re.test(only)) return o?.props?.color
  for (const c of o?.children ?? []) {
    const found = colorOf(c, re)
    if (found !== undefined) return found
  }
  return undefined
}

const GREEN = '#7ec699'
const RED = '#f07a6f'
const MIN = 60_000

/** The pane's rows with the tab pressed first (the one the mod state already holds when none is given). */
async function paneRows($: Engine, bodyColumns = 50, tab?: string) {
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns }, surface: 'terminal' })
  if (tab) await ui.press({ key: `tab:${tab}` })
  const root = await ui.drawn()
  await ui.unmount()
  return { root, rows: rowTexts(root) }
}

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

/** The row under the folder row: where the ALM line sits. */
const belowFolder = (rows: string[]): string | undefined => rows[rows.findIndex(r => /example-repo/.test(r)) + 1]

test('ALM line under the folder row: org / project and identity, resolved for the cwd', async ($, on) => {
  world(on, { workspaces: { roots: [{ path: '/work', platform: 'azure-devops', org: 'org-a', project: 'Alpha', identity: 'id-a' }] } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const { rows } = await paneRows($)
  expect(belowFolder(rows)).toBe('ALM org-a / Alpha · id-a')
})

test('ALM line: a mapped root with no org, project or identity draws no line', async ($, on) => {
  world(on, { workspaces: { roots: [{ path: '/work', platform: 'github' }] } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const { rows } = await paneRows($)
  expect(rows.some(r => /^ALM/.test(r))).toBe(false)
})

test('ALM line is cut in the middle to the pane width', async ($, on) => {
  const project = 'A-very-long-project-name-that-cannot-fit-in-a-narrow-pane'
  world(on, { workspaces: { roots: [{ path: '/work', platform: 'azure-devops', org: 'org-a', project, identity: 'id-a' }] } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const row = (await paneRows($, 40)).rows.find(r => /^ALM/.test(r))
  expect([...(row ?? '')].length).toBe(38)
  expect(row).toMatch(/^ALM org-a.*….*id-a$/)
})

test('a workspaces.json that goes missing clears the ALM line; a malformed one too', async ($, on) => {
  const options: World = { workspaces: { roots: [{ path: '/work', platform: 'azure-devops', org: 'org-a', project: 'Alpha', identity: 'id-a' }] } }
  const clock = world(on, options)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(belowFolder((await paneRows($)).rows)).toBe('ALM org-a / Alpha · id-a')
  options.workspacesFail = true
  await clock.advance(30_000)
  expect((await paneRows($)).rows.some(r => /^ALM/.test(r))).toBe(false)
  options.workspacesFail = false
  await clock.advance(30_000)
  expect(belowFolder((await paneRows($)).rows)).toBe('ALM org-a / Alpha · id-a')
  options.workspaces = 'not a map' // valid JSON, no roots
  await clock.advance(30_000)
  expect((await paneRows($)).rows.some(r => /^ALM/.test(r))).toBe(false)
  // text that is not JSON at all: cut in the middle, as a half-written file is
  options.workspaces = { roots: [{ path: '/work', platform: 'azure-devops', org: 'org-a', project: 'Alpha', identity: 'id-a' }] }
  await clock.advance(30_000)
  expect(belowFolder((await paneRows($)).rows)).toBe('ALM org-a / Alpha · id-a')
  options.workspacesRaw = '{ "roots": [ { "path": "/work", "org": '
  await clock.advance(30_000)
  expect((await paneRows($)).rows.some(r => /^ALM/.test(r))).toBe(false)
})

test('ALM line reads ALM unmapped in red when no root contains the cwd, and is absent without a map', async ($, on) => {
  world(on, { workspaces: { roots: [{ path: '/elsewhere', platform: 'github', org: 'o' }] } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const { root, rows } = await paneRows($)
  expect(belowFolder(rows)).toBe('ALM unmapped')
  expect(colorOf(root, /^ALM unmapped$/)).toBe(RED)
})

test('no workspaces map: no ALM line at all', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect((await paneRows($)).rows.some(r => /^ALM/.test(r))).toBe(false)
})

// ── Tabs ──

const spawnAgent = ($: Engine, subagentType: string) =>
  $.agent.spawn({
    tool_use_id: `t-${subagentType}`,
    prompt: 'go',
    description: 'go',
    subagentType,
    provider: { plugin: 'engine', tier: 'core' },
    model: 'sonnet',
    parentModel: 'claude-opus-5-5',
    background: true,
    fork: false,
  })

/** `agent.spawn` that answers a new agent id each time: `a1`, `a2`, ... */
function spawns(on: On) {
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: `a${++n}` }))
}

test('tab bar: four buttons, Subagents selected by default; a press on Work draws the Work view', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const tabs = async () => (await ui.findAll({ type: 'Button' })).filter(b => /^tab:/.test(b.key ?? ''))
  // the four bare names need 45 cells: the 48 of this 50-column pane's content hold them
  expect((await tabs()).map(b => b.text)).toEqual(['Subagents', 'Context', 'Work', 'System'])
  const selected = async () => (await tabs()).filter(b => b.props.variant === 'primary').map(b => b.key)
  expect(await selected()).toEqual(['tab:agents'])
  expect(await ui.find({ type: 'Text', text: /Opus 5\.5/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^SUBAGENTS/ })).toBeDefined()

  await ui.press({ key: 'tab:work' })
  expect(await selected()).toEqual(['tab:work'])
  expect(await ui.find({ type: 'Text', text: /^SUBAGENTS/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Opus 5\.5/ })).toBeDefined() // the header stays on every tab
  expect(await ui.find({ type: 'Text', text: /^CREDITI/ })).toBeUndefined()

  await ui.press({ key: 'tab:agents' })
  expect(await ui.find({ type: 'Text', text: /^SUBAGENTS/ })).toBeDefined()
  await ui.unmount()
})

test('tab labels: Subagents counts the running agents, Work carries a dot when the worklog needs attention', async ($, on) => {
  world(on, { hasWorklog: true })
  spawns(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await spawnAgent($, 'code-reviewer')
  await spawnAgent($, 'implementer')
  const ui = await mountPane($, 52)
  expect((await ui.find({ key: 'tab:agents' }))?.text).toBe('Subagents 2')
  expect((await ui.find({ key: 'tab:work' }))?.text).toBe('Work ●')
  expect((await ui.find({ key: 'tab:system' }))?.text).toBe('System')
  await ui.unmount()
})

test('tab labels without agents or warnings are the bare names', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.findAll({ type: 'Button' })).filter(b => /^tab:/.test(b.key ?? '')).map(b => b.text)).toEqual(['Subagents', 'Context', 'Work', 'System'])
  await ui.unmount()
})

test('the other tabs draw the current sections: Subagents the agents, Work tasks and worklog warnings, System its own title', async ($, on) => {
  world(on, { hasWorklog: true })
  taskTools(on)
  spawns(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await spawnAgent($, 'code-reviewer')
  await $.tool.call({ tool: 'TodoWrite', todos: [todo('Working on it', 'in_progress')] })

  const agents = (await paneRows($, 50, 'agents')).rows
  expect(agents.some(r => /^◐ code-reviewer/.test(r))).toBe(true)
  expect(agents.some(r => /^TASK/.test(r) || /worklog/.test(r))).toBe(false)

  const work = (await paneRows($, 50, 'work')).rows
  expect(work.some(r => /^TASK · 0\/1/.test(r))).toBe(true)
  expect(work.some(r => /worklog: 1d to log/.test(r))).toBe(true)
  expect(work.some(r => /^SUBAGENTS/.test(r))).toBe(false)

  const system = (await paneRows($, 50, 'system')).rows
  expect(system).toContain('SYSTEM')
  expect(system).not.toContain('in arrivo')
  expect(system.some(r => /^SUBAGENTS/.test(r) || /^TASK/.test(r))).toBe(false)
})

test('the selected tab is written in the state file', async ($, on) => {
  const writes = new Map<string, string>()
  const clock = world(on, { writes })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await paneRows($, 50, 'work')
  await clock.advance(3000)
  expect(flagOf(writes)).toMatchObject({ tab: 'work' })
})

test('a state file left by an earlier run brings its tab back', async ($, on) => {
  world(on, { stateFile: JSON.stringify({ open: false, tab: 'context' }) })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const { rows } = await paneRows($)
  expect(rows.some(r => /^SUBAGENTS/.test(r))).toBe(false)
  expect(rows.some(r => /^CONTEXT/.test(r))).toBe(true)
})

test('an unknown tab in the state file is ignored', async ($, on) => {
  world(on, { stateFile: JSON.stringify({ open: false, tab: 'nope' }) })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect((await paneRows($)).rows.some(r => /^SUBAGENTS/.test(r))).toBe(true)
})

test('a state file that is not JSON is ignored', async ($, on) => {
  world(on, { stateFile: 'not json' })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect((await paneRows($)).rows.some(r => /^SUBAGENTS/.test(r))).toBe(true)
})

test('session.end keeps the tab in the closed file, so a resume finds it', async ($, on) => {
  const writes = new Map<string, string>()
  world(on, { writes })
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await paneRows($, 50, 'work')
  await $.session.end({ reason: 'clear', sessionId: 's-1', resume: { id: 's-1' } })
  expect(flagOf(writes)).toEqual({ ...CLOSED, tab: 'work' })
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

// ── Buttons row: compact and log hours, the last row of every tab ──

test('buttons row: compact compacts with the instructions, log hours submits the /worklog of this chat', async ($, on) => {
  const calls: string[] = []
  const instructions: (string | undefined)[] = []
  const commands: string[] = []
  world(on, { calls, instructions, commands, branch: 'feature/1234-orders' })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ key: 'bar:compact' }))?.text).toBe('compact')
  expect((await ui.find({ key: 'bar:worklog' }))?.text).toBe('log hours')
  // the quick row's buttons are gone
  for (const key of ['quick:compact', 'quick:worklog', 'quick:branch']) expect(await ui.find({ key })).toBeUndefined()

  await ui.press({ key: 'bar:compact' })
  expect(calls).toEqual(['compact'])
  expect(instructions).toEqual([KEEP_DROP])
  expect(commands).toEqual([])
  await ui.press({ key: 'bar:worklog' })
  expect(commands).toEqual(['/worklog oggi sessione s-1'])
  expect(calls).toEqual(['compact'])
  await ui.unmount()
})

const KEEP_DROP =
  "Tieni: task in corso, decisioni prese con l'utente e il loro perché, domande aperte, file toccati e stato, comandi con la riga di output che decide, prossimi passi. Butta: output di tool già riassunti, tentativi superati."

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

test('buttons row: the instructions name the workflow the last Stop reported in flight, until a Stop reports none', async ($, on) => {
  const instructions: (string | undefined)[] = []
  world(on, { instructions })
  on('classic.Stop', () => ({}))
  on('classic.SubagentStop', () => ({}))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const shell = { id: 'b1', type: 'shell', status: 'running', description: 'npm test' }
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [shell, { id: 'b2', type: 'workflow', status: 'running', description: 'x', name: 'release-notes' }] })
  const ui = await mountPane($)
  await ui.press({ key: 'bar:compact' })
  expect(instructions[0]).toContain('Workflow in corso: release-notes.')
  expect([...(instructions[0] ?? '')].length).toBeLessThanOrEqual(400)
  await $.classic.SubagentStop({ stop_hook_active: false, agent_id: 'a1', agent_transcript_path: '/t', agent_type: 'x', background_tasks: [shell] })
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

// log hours logs the hours of THIS chat, whatever the branch: the button is there whenever the session has an id
for (const [name, options] of [
  ['a feature branch', { branch: 'feature/orders-filter' }],
  ['a branch with a work item id', { branch: 'feature/AB#512-reports' }],
  ['the default branch', { branch: 'main' }],
  ['a detached HEAD', { detached: true }],
  ['no git', { notRepo: true }],
] as const) {
  test(`buttons row: log hours on ${name} runs /worklog oggi sessione with the id of this chat`, async ($, on) => {
    const commands: string[] = []
    world(on, { commands, sessionId: () => 'chat-7', ...options })
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    await settleAll()
    const ui = await mountPane($)
    expect((await ui.find({ key: 'bar:worklog' }))?.text).toBe('log hours')
    expect((await ui.find({ key: 'bar:compact' }))?.text).toBe('compact')
    await ui.press({ key: 'bar:worklog' })
    await ui.unmount()
    expect(commands).toEqual(['/worklog oggi sessione chat-7'])
  })
}

test('buttons row: between two sessions (no id) log hours is not offered; compact stays', async ($, on) => {
  world(on)
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.end({ reason: 'clear', sessionId: 's-1', resume: { id: 's-1' } })
  const ui = await mountPane($)
  expect(await ui.find({ key: 'bar:worklog' })).toBeUndefined()
  expect(await ui.find({ key: 'bar:compact' })).toBeDefined()
  await ui.unmount()
})

// ── Work: the PRs, read in the background ──

/** Lets the background reads a session start leaves running (the repo's default branch, the PR) finish. */
const settleAll = async () => {
  for (let i = 0; i < 8; i++) await settle()
}

const GH_PR_ARGS = 'gh pr view --json number,title,state,isDraft,reviewDecision,statusCheckRollup,url'
const AZ_REMOTE = 'https://dev.azure.com/<org>/proj/_git/orders'
const AZ_WORKSPACES = { roots: [{ path: '/work', platform: 'azure-devops', org: 'org-a', project: 'Alpha', identity: 'id-a' }] }
const CHECKS = [
  { __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SUCCESS' },
  { __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'FAILURE' },
  { __typename: 'StatusContext', state: 'SUCCESS' },
  { __typename: 'CheckRun', status: 'IN_PROGRESS', conclusion: '' },
]

test('PR: a GitHub pull request of the branch with its state, title, reviews and checks (gh pr view, once)', async ($, on) => {
  const ghCalls: string[] = []
  world(on, {
    ghCalls,
    branch: 'feature/orders-filter',
    remote: GH_SSH,
    pr: 42,
    prExtra: { isDraft: false, reviewDecision: 'APPROVED', statusCheckRollup: CHECKS },
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await settleAll()
  const rows = await lavoroRows($)
  const i = rows.findIndex(r => r === 'PR · 1')
  expect(i).toBeGreaterThan(0)
  expect(rows[i - 1]).toBe(' ')
  expect(rows[i - 2]).toMatch(/^─+$/)
  expect(rows.slice(i + 1, i + 4)).toEqual([' ', '#42 · open · Fix the orders filter', '  review approved · checks 2/4 · ✗ 1 · ◐ 1'])
  expect(ghCalls).toEqual([GH_PR_ARGS])
})

test('PR: a draft says bozza, changes requested and a review still due are told apart, no checks draws no checks row', async ($, on) => {
  const options: World = { branch: 'feature/orders-filter', remote: GH_SSH, pr: 42, prExtra: { isDraft: true, reviewDecision: 'CHANGES_REQUESTED' } }
  const clock = world(on, options)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await settleAll()
  let rows = await lavoroRows($)
  expect(rows).toContain('#42 · draft · Fix the orders filter')
  expect(rows).toContain('  review changes requested')
  expect(rows.some(r => /checks/.test(r))).toBe(false)

  options.prExtra = { reviewDecision: 'REVIEW_REQUIRED' }
  await clock.advance(5 * MIN)
  await settleAll()
  rows = await lavoroRows($)
  expect(rows).toContain('#42 · open · Fix the orders filter')
  expect(rows).toContain('  review pending')

  options.prExtra = { reviewDecision: '' }
  await clock.advance(5 * MIN)
  await settleAll()
  expect((await lavoroRows($)).some(r => /^ +review/.test(r))).toBe(false)
})

test('PR: a work item id in the branch name no longer keeps gh from being asked', async ($, on) => {
  const ghCalls: string[] = []
  world(on, { ghCalls, branch: 'feature/AB#77-orders', remote: 'https://github.com/example/orders', pr: 42 })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await settleAll()
  expect(await lavoroRows($)).toContain('#42 · open · Fix the orders filter')
  expect(ghCalls).toEqual([GH_PR_ARGS])
})

// `isGhAsked`: whether `gh pr view` is run at all (only for a GitHub remote)
for (const { name, options, isGhAsked } of [
  { name: 'an unknown remote', options: { remote: 'https://git.example.org/orders.git', pr: 42 }, isGhAsked: false },
  { name: 'no remote', options: { pr: 42 }, isGhAsked: false },
  { name: 'gh not installed', options: { remote: GH_SSH, pr: 42, noGh: true }, isGhAsked: true },
  { name: 'no PR for the branch', options: { remote: GH_SSH }, isGhAsked: true },
] as const) {
  test(`PR: with ${name} Work draws no PR`, async ($, on) => {
    const ghCalls: string[] = []
    world(on, { ghCalls, branch: 'feature/orders-filter', ...options })
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    await settleAll()
    expect((await lavoroRows($)).some(r => /^PR ·/.test(r))).toBe(false)
    expect(ghCalls).toEqual(isGhAsked ? [GH_PR_ARGS] : [])
  })
}

test('PR: a merged or closed PR of the branch is listed with its own state, not as an open one', async ($, on) => {
  const options: World = { branch: 'feature/orders-filter', remote: GH_SSH, pr: 42, prState: 'MERGED' }
  const clock = world(on, options)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await settleAll()
  expect(await lavoroRows($)).toContain('#42 · merged · Fix the orders filter')
  options.prState = 'CLOSED'
  await clock.advance(5 * MIN)
  await settleAll()
  const rows = await lavoroRows($)
  expect(rows).toContain('#42 · closed · Fix the orders filter')
  expect(rows.filter(r => /^#42 /.test(r))).toHaveLength(1)
})

test('PR: an Azure DevOps remote asks az repos pr list with the org of the ALM line and the project of the remote, and shows the review without inventing checks', async ($, on) => {
  const azCalls: string[] = []
  const ghCalls: string[] = []
  world(on, {
    azCalls,
    ghCalls,
    branch: 'feature/orders-filter',
    remote: AZ_REMOTE,
    workspaces: AZ_WORKSPACES,
    azPr: [{ pullRequestId: 7, title: 'Faster orders', status: 'active', isDraft: false, reviewers: [{ vote: 10 }, { vote: 0 }] }],
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await settleAll()
  const rows = await lavoroRows($)
  const i = rows.findIndex(r => r === 'PR · 1')
  expect(i).toBeGreaterThan(0)
  expect(rows.slice(i + 1, i + 4)).toEqual([' ', '#7 · open · Faster orders', '  review approved'])
  expect(rows.some(r => /checks/.test(r))).toBe(false)
  expect(azCalls).toEqual([
    // the org is the ALM line's, as a URL (joined, so the text is not read as a real organization's)
    `az repos pr list --organization ${['https://dev.azure.com', 'org-a'].join('/')} --project proj --repository orders --source-branch refs/heads/feature/orders-filter --status all --top 1 --output json`,
  ])
  expect(ghCalls).toEqual([])
})

test('PR: on Azure DevOps the repository is asked in the project of the remote URL, not the ALM one', async ($, on) => {
  const azCalls: string[] = []
  world(on, {
    azCalls,
    branch: 'feature/orders-filter',
    remote: 'https://dev.azure.com/<org>/Beta/_git/orders',
    workspaces: AZ_WORKSPACES,
    azPr: [{ pullRequestId: 7, title: 'Faster orders', status: 'active' }],
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await settleAll()
  expect((await lavoroRows($)).some(r => r === '#7 · open · Faster orders')).toBe(true)
  expect(azCalls).toHaveLength(1)
  expect(azCalls[0]).toContain('--project Beta --repository orders')
})

for (const { name, options, workspaces } of [
  { name: 'az not installed', options: { noAz: true }, workspaces: AZ_WORKSPACES },
  { name: 'no PR on the branch', options: { azPr: [] }, workspaces: AZ_WORKSPACES },
  { name: 'a list without a usable PR', options: { azPr: [{ title: 'x' }] }, workspaces: AZ_WORKSPACES },
  { name: 'no ALM org to ask', options: { azPr: [{ pullRequestId: 7, title: 'x', status: 'active' }] }, workspaces: { roots: [] } },
] as const) {
  test(`PR: on Azure DevOps with ${name} Work draws no PR`, async ($, on) => {
    const azCalls: string[] = []
    world(on, { azCalls, branch: 'feature/orders-filter', remote: AZ_REMOTE, workspaces, ...options })
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    await settleAll()
    expect((await lavoroRows($)).some(r => /^PR ·/.test(r))).toBe(false)
    // without an org the CLI is not asked at all: never the configured default
    expect(azCalls.length).toBe(name === 'no ALM org to ask' ? 0 : 1)
  })
}

test('PR: read at most every 5 minutes, and again for another branch; the default branch is never asked', async ($, on) => {
  const ghCalls: string[] = []
  const options: World = { ghCalls, branch: 'feature/orders-filter', remote: GH_SSH, pr: 42 }
  const clock = world(on, options)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await settleAll()
  expect(ghCalls).toHaveLength(1)
  for (let i = 0; i < 4; i++) await clock.advance(30_000) // four ticks, a minute: no new read
  await settleAll()
  expect(ghCalls).toHaveLength(1)
  await clock.advance(5 * MIN)
  await settleAll()
  expect(ghCalls).toHaveLength(2)

  options.branch = 'feature/other' // another branch is another question, asked at the next tick
  options.pr = 43
  await clock.advance(30_000)
  await settleAll()
  expect(ghCalls).toHaveLength(3)
  // the PR of the branch left behind stays listed: it is the chat's
  expect(await lavoroRows($)).toEqual(expect.arrayContaining(['#42 · open · Fix the orders filter', '#43 · open · Fix the orders filter']))

  options.branch = 'main'
  await clock.advance(30_000)
  await settleAll()
  expect(ghCalls).toHaveLength(3)
})

test('PR: the PR of a branch left behind stays listed on the next one, which adds none of its own', async ($, on) => {
  const options: World = { branch: 'feature/orders-filter', remote: GH_SSH, pr: 42 }
  const clock = world(on, options)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await settleAll()
  expect(await lavoroRows($)).toContain('#42 · open · Fix the orders filter')
  options.branch = 'feature/other'
  options.pr = undefined
  await clock.advance(30_000)
  await settleAll()
  const rows = await lavoroRows($)
  expect(rows).toContain('PR · 1')
  expect(rows).toContain('#42 · open · Fix the orders filter')
})

/** The keys of the Buttons in the last row of the drawn pane. */
const lastRowKeys = (root: unknown): string[] => {
  const keys = (el: unknown): string[] => {
    const o = el as { props?: { key?: string }; type?: string; children?: unknown[] } | null
    const own = o?.type === 'Button' && o.props?.key ? [o.props.key] : []
    return [...own, ...(o?.children ?? []).flatMap(keys)]
  }
  return keys(((root as { children?: unknown[] }).children ?? []).at(-1))
}

test('buttons row: the very last row of every tab', async ($, on) => {
  world(on, { hasWorklog: true })
  taskTools(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'TodoWrite', todos: [todo('Uno', 'pending')] })
  for (const tab of TABS) {
    const { root, rows } = await paneRows($, 50, tab)
    expect(lastRowKeys(root)).toEqual(['bar:compact', 'bar:worklog'])
    // a rule sets it apart from the tab's content
    expect(rows.at(-2)).toMatch(/^─+$/)
  }
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

// ── Subagents: history and open an agent ──

/** The end of agent `agentId`'s turn, as the engine raises it. */
const finishAgent = ($: Engine, agentId: string, reason: 'answer' | 'aborted' | 'error' = 'answer') =>
  $.turn.complete({ answer: '', durationMs: 1, isAborted: reason === 'aborted', turnId: `${agentId}-t`, agentId, reason })

const mountPane = ($: Engine, bodyColumns = 50) => $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns }, surface: 'terminal' })

/** A history entry as the state file holds it. */
const entry = (id: string, type: string, endedAt: number, isFailed = false) => ({
  id,
  type,
  model: 'claude-sonnet-5-5',
  startedAt: endedAt - 60_000,
  endedAt,
  tokens: 5400,
  isFailed,
})

test('Subagents: a finished agent leaves the list after 2 minutes for HISTORY, collapsed by default, newest first, with its outcome', async ($, on) => {
  const writes = new Map<string, string>()
  const clock = world(on, { writes, listed: [{ id: 'a3', status: 'running' }] })
  spawns(on)
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  for (const type of ['one', 'two', 'three']) await spawnAgent($, type)
  await finishAgent($, 'a1')
  await clock.advance(5_000)
  await finishAgent($, 'a2', 'error')

  const ui = await mountPane($)
  await ui.press({ key: 'tab:agents' })
  // inside the two minutes the finished agents are listed as before, and there is no history yet
  expect(await ui.find({ key: 'agent:a1' })).toBeDefined()
  expect(await ui.find({ key: 'agent:a2' })).toBeDefined()
  expect(await ui.find({ key: 'history' })).toBeUndefined()

  await clock.advance(130_000)
  expect(await ui.find({ key: 'agent:a1' })).toBeUndefined()
  expect(await ui.find({ key: 'agent:a2' })).toBeUndefined()
  expect(await ui.find({ key: 'agent:a3' })).toBeDefined()
  expect((await ui.find({ key: 'history' }))?.text).toBe('HISTORY · 2 ▸')
  expect(await ui.find({ key: 'history:a1' })).toBeUndefined()

  await ui.press({ key: 'history' })
  expect((await ui.find({ key: 'history' }))?.text).toBe('HISTORY · 2 ▾')
  const keys = async () => (await ui.findAll({ type: 'Button' })).map(b => b.key ?? '').filter(k => k.startsWith('history:'))
  expect(await keys()).toEqual(['history:a2', 'history:a1'])
  expect((await ui.find({ key: 'history:a2' }))?.text).toMatch(/^✗ two +son 5\.5 +5s +0$/)
  expect((await ui.find({ key: 'history:a1' }))?.text).toMatch(/^✓ one +son 5\.5 +0s +0$/)
  await ui.press({ key: 'history' })
  expect(await keys()).toEqual([])
  await ui.unmount()

  // the state file carries it, so a resume or a reload finds it
  await clock.advance(3000)
  expect(dataOf(writes)?.history).toEqual([
    { id: 'a2', type: 'two', model: 'claude-sonnet-5-5', startedAt: NOW, endedAt: NOW + 5000, tokens: 0, isFailed: true },
    { id: 'a1', type: 'one', model: 'claude-sonnet-5-5', startedAt: NOW, endedAt: NOW, tokens: 0, isFailed: false },
  ])
})

test('Subagents: an agent the engine lists as killed or failed ends with ✗, one it no longer lists with ✓', async ($, on) => {
  const clock = world(on, {
    listed: [
      { id: 'a1', status: 'killed' },
      { id: 'a2', status: 'failed' },
    ],
  })
  spawns(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  for (const type of ['one', 'two', 'three']) await spawnAgent($, type)
  await clock.advance(30_000)
  const ui = await mountPane($)
  await ui.press({ key: 'tab:agents' })
  expect((await ui.find({ key: 'agent:a1' }))?.text).toMatch(/^✗ one/)
  expect((await ui.find({ key: 'agent:a2' }))?.text).toMatch(/^✗ two/)
  expect((await ui.find({ key: 'agent:a3' }))?.text).toMatch(/^✓ three/)
  await ui.unmount()
})

test('HISTORY lists at most ten rows, then … +n', async ($, on) => {
  const clock = world(on)
  spawns(on)
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  for (let n = 1; n <= 12; n++) await spawnAgent($, `agent-${n}`)
  for (let n = 1; n <= 12; n++) await finishAgent($, `a${n}`)
  await clock.advance(135_000)
  const ui = await mountPane($)
  await ui.press({ key: 'tab:agents' })
  await ui.press({ key: 'history' })
  expect((await ui.find({ key: 'history' }))?.text).toBe('HISTORY · 12 ▾')
  expect((await ui.findAll({ type: 'Button' })).filter(b => (b.key ?? '').startsWith('history:')).length).toBe(10)
  const rows = rowTexts(await ui.drawn())
  // the buttons row closes the pane, under a rule and the spacer
  expect(rows.at(-4)).toBe('… +2')
  await ui.unmount()
})

test('HISTORY survives a reload: the session id reads its history from its state file; another id starts empty', async ($, on) => {
  let id = 's-1'
  world(on, { sessionId: () => id, stateFile: JSON.stringify({ open: false, tab: 'agents', history: [entry('a9', 'implementer', NOW - 30_000), entry('a8', 'reviewer', NOW - 90_000, true)] }) })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  let ui = await mountPane($)
  expect((await ui.find({ key: 'history' }))?.text).toBe('HISTORY · 2 ▸')
  await ui.press({ key: 'history' })
  expect((await ui.find({ key: 'history:a9' }))?.text).toMatch(/^✓ implementer +son 5\.5 +1m00s +5\.4k$/)
  expect((await ui.find({ key: 'history:a8' }))?.text).toMatch(/^✗ reviewer/)
  await ui.unmount()

  id = 's-2'
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  ui = await mountPane($)
  expect(await ui.find({ key: 'history' })).toBeUndefined()
  await ui.unmount()
})

/** The data file of session `id` as last written, parsed; `undefined` when none was written. */
const fileOfSession = (writes: Map<string, string>, id: string): { history: unknown[] } | undefined => {
  const path = [...writes.keys()].find(k => k.endsWith(`cockpit-data-${id}.json`))
  return path === undefined ? undefined : JSON.parse(writes.get(path) ?? 'null')
}

test('HISTORY: a /clear moves the finished agent still under 2 minutes into the ending session\'s history; the new session starts empty', async ($, on) => {
  let id = 's-1'
  const writes = new Map<string, string>()
  const clock = world(on, { sessionId: () => id, writes })
  spawns(on)
  on('turn.complete', () => ({ text: '' }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await spawnAgent($, 'old')
  await finishAgent($, 'a1')
  id = 's-2'
  await $.session.end({ reason: 'clear', sessionId: 's-1', resume: { id: 's-1' } })
  expect(fileOfSession(writes, 's-1')?.history).toEqual([{ id: 'a1', type: 'old', model: 'claude-sonnet-5-5', startedAt: NOW, endedAt: NOW, tokens: 0, isFailed: false }])
  await clock.advance(135_000)
  const ui = await mountPane($)
  await ui.press({ key: 'tab:agents' })
  expect(await ui.find({ key: 'history' })).toBeUndefined()
  expect(await ui.find({ key: 'agent:a1' })).toBeUndefined()
  await ui.unmount()
  expect(fileOfSession(writes, 's-2')?.history).toEqual([])
})

test('Subagents: a reload of the same session id keeps the live agents, the finished one too until its 2 minutes pass', async ($, on) => {
  const clock = world(on, { listed: [{ id: 'a1', status: 'running' }] })
  spawns(on)
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await spawnAgent($, 'one')
  await spawnAgent($, 'two')
  await finishAgent($, 'a2')
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mountPane($)
  await ui.press({ key: 'tab:agents' })
  expect(await ui.find({ key: 'agent:a1' })).toBeDefined()
  expect(await ui.find({ key: 'agent:a2' })).toBeDefined()
  await clock.advance(135_000)
  expect(await ui.find({ key: 'agent:a1' })).toBeDefined()
  expect(await ui.find({ key: 'agent:a2' })).toBeUndefined()
  expect((await ui.find({ key: 'history' }))?.text).toBe('HISTORY · 1 ▸')
  await ui.unmount()
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
    { id: 'a1', type: 'running-one', model: 'claude-sonnet-5-5', startedAt: NOW, endedAt: NOW, tokens: 0, isFailed: false, isInterrupted: true },
    { id: 'a2', type: 'finished-one', model: 'claude-sonnet-5-5', startedAt: NOW, endedAt: NOW, tokens: 0, isFailed: false },
  ])
  // a tick lands before the engine switches to the next id: it must not take s-1 back
  await clock.advance(30_000)
  expect(fileOfSession(writes, 's-1')).toEqual(ended)
  id = 's-2' // no session.start follows a /clear
  await clock.advance(135_000)
  const ui = await mountPane($)
  await ui.press({ key: 'tab:agents' })
  expect(await ui.find({ key: 'agent:a1' })).toBeUndefined()
  expect(await ui.find({ key: 'agent:a2' })).toBeUndefined()
  expect(await ui.find({ key: 'history' })).toBeUndefined()
  await ui.unmount()
  expect(fileOfSession(writes, 's-2')?.history).toEqual([])
  expect(fileOfSession(writes, 's-1')).toEqual(ended)
})

test('HISTORY draws an interrupted agent as a dim ■, and a resume of the ended id brings its history back', async ($, on) => {
  const history = [{ ...entry('a1', 'running-one', NOW - 1000), isInterrupted: true }]
  world(on, { stateFile: JSON.stringify({ tab: 'agents', history }) })
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.end({ reason: 'resume', sessionId: 's-1', resume: { id: 's-1' } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mountPane($)
  await ui.press({ key: 'history' })
  expect((await ui.find({ key: 'history:a1' }))?.text).toMatch(/^■ running-one/)
  await ui.unmount()
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
  await ui.press({ key: 'tab:agents' })
  expect(await ui.find({ key: 'agent:a1' })).toBeUndefined()
  await ui.unmount()
})

test('a resume reloads the history of the session it resumes', async ($, on) => {
  let id = 's-2'
  const history = [entry('a9', 'implementer', NOW - 30_000), entry('a8', 'reviewer', NOW - 90_000, true)]
  const clock = world(on, { sessionId: () => id, stateFile: JSON.stringify({ open: false, tab: 'agents', history }) })
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  id = 's-1'
  await $.session.end({ reason: 'resume', sessionId: 's-2', resume: { id: 's-2' } })
  await clock.advance(30_000)
  const ui = await mountPane($)
  expect((await ui.find({ key: 'history' }))?.text).toBe('HISTORY · 2 ▸')
  await ui.unmount()
})

test('HISTORY: entries a state file holds wrongly are left out, a file with no history means none', async ($, on) => {
  world(on, { stateFile: JSON.stringify({ tab: 'agents', history: [{ id: 'x' }, 'text', entry('a1', 'ok', NOW - 1000)] }) })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mountPane($)
  expect((await ui.find({ key: 'history' }))?.text).toBe('HISTORY · 1 ▸')
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
  expect(dataOf(writes)).toEqual({ history, prs: [], ctx: LIVE_CTX })
})

test('pressing an agent row, live or in HISTORY, puts that agent in the main view', async ($, on) => {
  const viewed: (string | undefined)[] = []
  const clock = world(on, { viewed, listed: [{ id: 'a3', status: 'running' }] })
  spawns(on)
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  for (const type of ['one', 'two', 'three']) await spawnAgent($, type)
  await finishAgent($, 'a1')
  await clock.advance(130_000)
  await finishAgent($, 'a2')

  const ui = await mountPane($)
  // Subagents is the tab the pane opens on
  await ui.press({ key: 'agent:a3' })
  expect(viewed).toEqual(['a3'])
  await ui.press({ key: 'tab:agents' })
  await ui.press({ key: 'agent:a3' }) // live
  await ui.press({ key: 'agent:a2' }) // finished, still listed
  await ui.press({ key: 'history' })
  await ui.press({ key: 'history:a1' }) // in the history
  expect(viewed).toEqual(['a3', 'a3', 'a2', 'a1'])
  await ui.unmount()
})

// ── Phase 2 follow-ups ──

test('a workspaces.json that is not JSON draws no ALM line', async ($, on) => {
  world(on, { workspacesRaw: '{ "roots": [ { "path": "/work", "org": ' })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect((await paneRows($)).rows.some(r => /^ALM/.test(r))).toBe(false)
})

/** The `flexWrap` of the Box that holds the Button keyed `key`. */
const wrapAround = (root: unknown, key: string): string | undefined => {
  const o = root as { type?: string; props?: { flexWrap?: string }; children?: { props?: { key?: string } }[] } | null
  if (o?.type === 'Box' && (o.children ?? []).some(c => c?.props?.key === key)) return o.props?.flexWrap
  for (const c of o?.children ?? []) {
    const found = wrapAround(c, key)
    if (found !== undefined) return found
  }
  return undefined
}

/** The tab labels of a pane `columns` wide, the cells they take (a terminal Button draws `[ label ]`: 4 cells of chrome, one between two) and the drawn tree. */
const tabsAt = async ($: Engine, columns: number) => {
  const ui = await mountPane($, columns)
  const labels = (await ui.findAll({ type: 'Button' })).filter(b => (b.key ?? '').startsWith('tab:')).map(b => b.text ?? '')
  const root = await ui.drawn()
  await ui.unmount()
  return { labels, cells: labels.reduce((n, l) => n + [...l].length + 4, 0) + labels.length - 1, root }
}

const LONG_TABS = ['Subagents', 'Context', 'Work', 'System']
const SHORT_TABS = ['Sub', 'Ctx', 'Wrk', 'Sys']

test('tab bar: the whole names appear once the bar fits the content (45 cells bare, 47 with the running count), at any pane from 47 columns up', async ($, on) => {
  world(on)
  spawns(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  // 47 columns leave 45 cells of content: exactly the bare bar
  for (const columns of [47, 58, 60, 80]) {
    const bare = await tabsAt($, columns)
    expect(bare.labels).toEqual(LONG_TABS)
    expect(bare.cells).toBe(45)
  }
  expect((await tabsAt($, 46)).labels).toEqual(SHORT_TABS)
  // a running agent adds ` 1`: 47 cells, which a pane of 49 columns or more holds
  await spawnAgent($, 'code-reviewer')
  expect((await tabsAt($, 80)).labels).toEqual(['Subagents 1', 'Context', 'Work', 'System'])
  expect((await tabsAt($, 49)).labels).toEqual(['Subagents 1', 'Context', 'Work', 'System'])
  expect((await tabsAt($, 48)).labels).toEqual(['Sub 1', 'Ctx', 'Wrk', 'Sys'])
})

test('tab bar: the labels are short while the whole bar does not fit the content (count and dot together need 49 cells), and the bar wraps rather than overflow', async ($, on) => {
  world(on, { hasWorklog: true })
  spawns(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await spawnAgent($, 'code-reviewer')
  const narrow = await tabsAt($, 30)
  expect(narrow.labels).toEqual(['Sub 1', 'Ctx', 'Wrk ●', 'Sys'])
  // the short bar is 35 cells: wider than a 30-column pane's content, so the row wraps
  expect(narrow.cells).toBeGreaterThan(30 - 2)
  expect(wrapAround(narrow.root, 'tab:agents')).toBe('wrap')
  for (const columns of [40, 50]) expect((await tabsAt($, columns)).labels).toEqual(['Sub 1', 'Ctx', 'Wrk ●', 'Sys'])
  for (const columns of [52, 58, 80]) expect((await tabsAt($, columns)).labels).toEqual(['Subagents 1', 'Context', 'Work ●', 'System'])
})

/** The `flexDirection` of the Box that holds the Button keyed `key`. */
const directionAround = (root: unknown, key: string): string | undefined => {
  const o = root as { type?: string; props?: { flexDirection?: string }; children?: { props?: { key?: string } }[] } | null
  if (o?.type === 'Box' && (o.children ?? []).some(c => c?.props?.key === key)) return o.props?.flexDirection
  for (const c of o?.children ?? []) {
    const found = directionAround(c, key)
    if (found !== undefined) return found
  }
  return undefined
}

test('buttons row: side by side, and the row fits 40 columns', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  // compact + log hours: 12 + 13 cells and one gap
  for (const columns of [60, 50, 40]) expect(directionAround((await paneRows($, columns)).root, 'bar:compact')).toBe('row')
  const ui = await mountPane($, 40)
  const labels = (await ui.findAll({ type: 'Button' })).filter(b => (b.key ?? '').startsWith('bar:')).map(b => b.text ?? '')
  await ui.unmount()
  expect(labels.reduce((n, l) => n + [...l].length + 4, 0) + labels.length - 1).toBeLessThanOrEqual(40)
})

test('Work with no tasks, no worklog warnings and no git says nothing to show', async ($, on) => {
  world(on, { notRepo: true })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const { rows } = await paneRows($, 50, 'work')
  // the buttons row closes the pane, under a rule and the spacer
  expect(rows.at(-4)).toBe('nothing to show')
  expect(rows.some(r => /^TASK/.test(r) || /worklog/.test(r))).toBe(false)
})

// ── Phase 4: Work, per agent ──

const PERIMETER = 'branch: feat/x\nstatus: active\n- src/a.ts\n- src/b/\n'
const workRows = async ($: Engine, bodyColumns = 50) => (await paneRows($, bodyColumns, 'work')).rows

test('MAIN: the deliver perimeter with its entries and touched files, and the changed files outside it', async ($, on) => {
  const gitCalls: string[] = []
  world(on, {
    gitCalls,
    branch: 'feat/x',
    perimeter: PERIMETER,
    changed: ['src/a.ts', 'src/b/x.ts', 'src/other.ts'],
    untracked: ['src/new.ts', 'notes.md'],
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const rows = await workRows($)
  const i = rows.findIndex(r => r === 'MAIN')
  expect(i).toBeGreaterThan(0)
  expect(rows[i - 1]).toBe(' ')
  expect(rows[i - 2]).toMatch(/^─+$/)
  expect(rows[i + 1]).toBe(' ')
  expect(rows[i + 2]).toBe('deliver perimeter · 2 entries · 5 files touched')
  expect(rows[i + 3]).toBe('⚠ 3 files outside the perimeter')
  expect(rows.slice(i + 4, i + 7)).toEqual(['  src/other.ts', '  src/new.ts', '  notes.md'])
  // computed like `scope-guard.js --check HEAD`: tracked changes against HEAD plus the untracked, not ignored files
  expect(gitCalls).toContain('git -C /work/example-repo --no-optional-locks diff --name-only --no-renames -z HEAD --')
  expect(gitCalls).toContain('git -C /work/example-repo --no-optional-locks ls-files --others --exclude-standard -z')
})

test('MAIN: nothing outside the perimeter says so; one entry and one file are singular', async ($, on) => {
  world(on, { branch: 'feat/x', perimeter: 'branch: feat/x\nstatus: active\n- src/a.ts\n', changed: ['src/a.ts'] })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const rows = await workRows($)
  expect(rows).toContain('deliver perimeter · 1 entry · 1 file touched')
  expect(rows).toContain('✓ no file outside the perimeter')
  expect(rows.some(r => /outside the perimeter$/.test(r) && r.startsWith('⚠'))).toBe(false)
})

test('MAIN: at most 5 outside files are named, then … +n', async ($, on) => {
  const changed = Array.from({ length: 7 }, (_, n) => `lib/f${n}.ts`)
  world(on, { branch: 'feat/x', perimeter: PERIMETER, changed })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const rows = await workRows($)
  const i = rows.findIndex(r => r.startsWith('⚠'))
  expect(rows[i]).toBe('⚠ 7 files outside the perimeter')
  expect(rows.slice(i + 1, i + 6)).toEqual(changed.slice(0, 5).map(f => `  ${f}`))
  expect(rows[i + 6]).toBe('  … +2')
})

test("MAIN: no perimeter for this branch (another branch's, closed): no perimeter rows and no git diff", async ($, on) => {
  const gitCalls: string[] = []
  world(on, { gitCalls, branch: 'feat/x', perimeter: PERIMETER.replace('feat/x', 'feat/other'), changed: ['lib/z.ts'] })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const rows = await workRows($)
  expect(rows.some(r => /perimetro/.test(r))).toBe(false)
  expect(rows).not.toContain('MAIN')
  // the changed files of the tab are listed from git, but no diff against the perimeter is made
  expect(gitCalls.filter(c => c.includes(' diff '))).toEqual([])
})

test('MAIN: a failed git diff leaves the entry count alone: no file counts, no claim about the outside', async ($, on) => {
  world(on, { branch: 'feat/x', perimeter: PERIMETER, failDiff: true })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const rows = await workRows($)
  expect(rows).toContain('deliver perimeter · 2 entries')
  expect(rows.some(r => /outside the perimeter/.test(r))).toBe(false)
})

test('MAIN: the perimeter, the session tasks and the worklog warnings are one block, in that order', async ($, on) => {
  world(on, { hasWorklog: true, branch: 'feat/x', perimeter: PERIMETER, changed: ['lib/z.ts'] })
  taskTools(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'TodoWrite', todos: [todo('Working on it', 'in_progress')] })
  const rows = await workRows($)
  const at = (re: RegExp) => rows.findIndex(r => re.test(r))
  const [main, perimeter, tasks, worklog] = [at(/^MAIN$/), at(/^deliver perimeter/), at(/^TASK ·/), at(/worklog: 1d to log/)]
  expect(main).toBeLessThan(perimeter)
  expect(perimeter).toBeLessThan(tasks)
  expect(tasks).toBeLessThan(worklog)
  // no rule inside the block
  expect(rows.slice(main, worklog).some(r => /^─+$/.test(r))).toBe(false)
  // and the tasks are not in the Subagents view
  expect((await paneRows($, 50, 'agents')).rows.some(r => /^TASK/.test(r))).toBe(false)
})

/** A workflow agent's spawn: `runId` and its place in the run. */
const spawnWorkflowAgent = ($: Engine, runId: string, agentIndex: number) =>
  $.agent.spawn({
    tool_use_id: 'wf-call',
    prompt: 'go',
    description: `step ${agentIndex}`,
    subagentType: 'implementer',
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'claude-opus-5-5',
    background: true,
    fork: false,
    workflow: { runId, agentIndex },
  })

const WORKFLOW_TASK = { id: 'b2', type: 'workflow', status: 'running', description: 'x', name: 'impl-review-loop' }

test('workflow: its name and the agents finished out of the agents started, nothing the engine does not expose', async ($, on) => {
  world(on)
  spawns(on)
  on('turn.complete', () => ({ text: '' }))
  on('classic.Stop', () => ({}))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(await workRows($)).not.toContain('WORKFLOW')
  for (const n of [1, 2, 3]) await spawnWorkflowAgent($, 'wf_1', n)
  await finishAgent($, 'a1')
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [WORKFLOW_TASK] })
  const rows = await workRows($)
  const i = rows.findIndex(r => r.startsWith('WORKFLOW'))
  expect(rows[i]).toBe('WORKFLOW · impl-review-loop')
  expect(rows[i - 1]).toBe(' ')
  expect(rows[i - 2]).toMatch(/^─+$/)
  expect(rows[i + 1]).toBe(' ')
  expect(rows[i + 2]).toBe('agents 1/3')
  // phase, round and P1/P2 counts are not exposed: not drawn
  expect(rows.some(r => /fase|round|P1|P2/i.test(r))).toBe(false)
  // the run's agents are the workflow's, not subagent blocks of their own
  expect(rows.some(r => /^implementer/.test(r))).toBe(false)
})

test('workflow: a Stop that reports none ends the block; agents seen without a name still make one', async ($, on) => {
  world(on)
  spawns(on)
  on('classic.Stop', () => ({}))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await spawnWorkflowAgent($, 'wf_1', 1)
  expect(await workRows($)).toContain('WORKFLOW')
  expect(await workRows($)).toContain('agents 0/1')
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [WORKFLOW_TASK] })
  expect(await workRows($)).toContain('WORKFLOW · impl-review-loop')
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [] })
  expect((await workRows($)).some(r => r.startsWith('WORKFLOW'))).toBe(false)
})

test('workflow: a new run starts its own count', async ($, on) => {
  world(on)
  spawns(on)
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await spawnWorkflowAgent($, 'wf_1', 1)
  await finishAgent($, 'a1')
  await spawnWorkflowAgent($, 'wf_2', 1)
  expect(await workRows($)).toContain('agents 0/1')
})

test('subagent blocks: type, the spawn description, the last tool it used and the elapsed time; none for the main loop', async ($, on) => {
  const clock = world(on, {
    listed: [
      { id: 'a1', status: 'running' },
      { id: 'a2', status: 'running' },
    ],
  })
  spawns(on)
  on('tool.call', { tool: 'Bash' }, () => ({ result: {} }))
  on('tool.call', { tool: 'Grep' }, () => ({ result: {} }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.agent.spawn({ ...SPAWN, subagentType: 'code-reviewer', description: 'Review the orders filter' })
  await $.agent.spawn({ ...SPAWN, subagentType: 'Explore', description: 'Find the DTOs' })
  await $.tool.call({ tool: 'Grep', pattern: 'Order', agentId: 'a1' })
  await $.tool.call({ tool: 'Bash', command: 'dotnet test', agentId: 'a1' })
  // the main loop's tool calls belong to no subagent
  await $.tool.call({ tool: 'Grep', pattern: 'x' })
  await clock.advance(2 * MIN)

  const rows = await workRows($)
  const i = rows.findIndex(r => /^code-reviewer/.test(r))
  expect(rows[i]).toBe('code-reviewer2m00s')
  expect(rows[i - 1]).toBe(' ')
  expect(rows[i - 2]).toMatch(/^─+$/)
  expect(rows[i + 1]).toBe('Review the orders filter')
  expect(rows[i + 2]).toBe('last tool Bash')
  // the second one has used no tool yet: no line, nothing invented
  const j = rows.findIndex(r => /^Explore/.test(r))
  expect(rows[j]).toBe('Explore2m00s')
  expect(rows[j + 1]).toBe('Find the DTOs')
  expect(rows[j + 3]).toMatch(/^─+$/) // the spacer comes first
})

test('subagent blocks: a finished agent has none, and at most 5 are drawn, then … +n', async ($, on) => {
  world(on, { listed: Array.from({ length: 7 }, (_, n) => ({ id: `a${n + 1}`, status: 'running' as const })) })
  spawns(on)
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  for (let n = 1; n <= 7; n++) await $.agent.spawn({ ...SPAWN, subagentType: `agent-${n}`, description: `task ${n}` })
  await finishAgent($, 'a1')
  const rows = await workRows($)
  expect(rows.some(r => /^agent-1/.test(r))).toBe(false)
  expect(rows.filter(r => /^agent-\d/.test(r)).map(r => r.slice(0, 7))).toEqual(['agent-2', 'agent-3', 'agent-4', 'agent-5', 'agent-6'])
  expect(rows).toContain('… +1')
})

/** An `agent.spawn` input but for the agent type and its description. */
const SPAWN = {
  tool_use_id: 't',
  prompt: 'go',
  provider: { plugin: 'engine', tier: 'core' },
  model: 'sonnet',
  parentModel: 'claude-opus-5-5',
  background: true,
  fork: false,
} as const

const claim = (n: number, rule: string, excerpt: string) =>
  JSON.stringify({ at: new Date(2026, 9, 22, 8 + n, 5).toISOString(), session: 's-1', cwd: '/w', rule, word: 'fatto', excerpt })

test('hook triggers: the last three done-claim.log entries, newest first, with time, rule and text', async ($, on) => {
  const doneClaims = [claim(1, 'unproven-row', 'primo'), claim(2, 'unproven-row', 'secondo'), claim(3, 'tail-truncated', 'terzo'), claim(4, 'unproven-row', 'tutto fatto, test verdi'), ''].join('\n')
  world(on, { doneClaims })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const rows = await workRows($)
  const i = rows.findIndex(r => r.startsWith('HOOK'))
  expect(rows[i]).toBe('HOOK · done-claim')
  expect(rows[i - 1]).toBe(' ')
  expect(rows[i - 2]).toMatch(/^─+$/)
  expect(rows[i + 1]).toBe(' ')
  expect(rows.slice(i + 2, i + 5)).toEqual([
    '22/10 12:05 unproven-row tutto fatto, test verdi',
    '22/10 11:05 tail-truncated terzo',
    '22/10 10:05 unproven-row secondo',
  ])
  expect(rows.some(r => /primo/.test(r))).toBe(false)
})

test('hook triggers: no log (or an empty one) draws no block', async ($, on) => {
  world(on, { doneClaims: '' })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect((await workRows($)).some(r => r.startsWith('HOOK'))).toBe(false)
})

// ── PR read follow-ups ──

test('PR: a detached HEAD or a folder without git forgets the PR read, so the branch is asked again on return', async ($, on) => {
  const ghCalls: string[] = []
  const options: World = { ghCalls, branch: 'feature/orders-filter', remote: GH_SSH, pr: 42 }
  const clock = world(on, options)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await settleAll()
  expect(ghCalls).toHaveLength(1)

  options.detached = true
  await clock.advance(30_000)
  options.detached = false
  await clock.advance(30_000)
  await settleAll()
  expect(ghCalls).toHaveLength(2)

  options.notRepo = true
  await clock.advance(30_000)
  options.notRepo = false
  await clock.advance(30_000)
  await settleAll()
  expect(ghCalls).toHaveLength(3)
})

test('PR: a branch left and come back to is asked again, not served from the read of five minutes ago', async ($, on) => {
  const ghCalls: string[] = []
  const options: World = { ghCalls, branch: 'feature/orders-filter', remote: GH_SSH, pr: 42 }
  const clock = world(on, options)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await settleAll()
  options.branch = 'feature/other'
  await clock.advance(30_000)
  await settleAll()
  options.branch = 'feature/orders-filter'
  await clock.advance(30_000)
  await settleAll()
  expect(ghCalls).toHaveLength(3)
})

test('PR: a failed gh pr view adds nothing and leaves the PRs already listed', async ($, on) => {
  const options: World = { branch: 'feature/orders-filter', remote: GH_SSH, pr: 42 }
  const clock = world(on, options)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await settleAll()
  expect(await lavoroRows($)).toContain('#42 · open · Fix the orders filter')

  options.noGh = true // gh is gone: the next read fails
  await clock.advance(5 * MIN)
  await settleAll()
  expect(await lavoroRows($)).toContain('#42 · open · Fix the orders filter')
})

// ── Agent lifecycle ──

test('workflow agents: a tick does not end an agent just because the engine does not list it; its own turn does', async ($, on) => {
  const clock = world(on) // $.agent.list() answers nothing: it never lists a workflow's agents
  spawns(on)
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await spawnWorkflowAgent($, 'wf_1', 1)
  await spawnWorkflowAgent($, 'wf_1', 2)
  await clock.advance(30_000) // two ticks
  const ui = await mountPane($)
  await ui.press({ key: 'tab:agents' })
  expect((await ui.find({ key: 'agent:a1' }))?.text).toMatch(/^◐ implementer/)
  expect((await ui.find({ key: 'agent:a2' }))?.text).toMatch(/^◐ implementer/)
  await finishAgent($, 'a1')
  await clock.advance(30_000)
  expect((await ui.find({ key: 'agent:a1' }))?.text).toMatch(/^✓ implementer/)
  expect((await ui.find({ key: 'agent:a2' }))?.text).toMatch(/^◐ implementer/)
  await ui.unmount()
})

test('workflow agents: an explicit failed or killed listing ends them', async ($, on) => {
  const clock = world(on, { listed: [{ id: 'a1', status: 'killed' }] })
  spawns(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await spawnWorkflowAgent($, 'wf_1', 1)
  await spawnWorkflowAgent($, 'wf_1', 2)
  await clock.advance(30_000)
  const ui = await mountPane($)
  await ui.press({ key: 'tab:agents' })
  expect((await ui.find({ key: 'agent:a1' }))?.text).toMatch(/^✗ implementer/)
  expect((await ui.find({ key: 'agent:a2' }))?.text).toMatch(/^◐ implementer/)
  await ui.unmount()
})

test('workflow agents: the end of their run (a main-loop Stop that reports none) ends the ones still running', async ($, on) => {
  const clock = world(on)
  spawns(on)
  on('classic.Stop', () => ({}))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await spawnWorkflowAgent($, 'wf_1', 1)
  await clock.advance(30_000)
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [WORKFLOW_TASK] })
  const ui = await mountPane($)
  await ui.press({ key: 'tab:agents' })
  expect((await ui.find({ key: 'agent:a1' }))?.text).toMatch(/^◐ implementer/)
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [] })
  expect((await ui.find({ key: 'agent:a1' }))?.text).toMatch(/^✓ implementer/)
  await ui.unmount()
})

test('subagent blocks: a tool call seen before its agent spawned does not make a stub that the spawn later fills', async ($, on) => {
  world(on, { listed: [{ id: 'a1', status: 'running' }] })
  spawns(on)
  on('tool.call', { tool: 'Grep' }, () => ({ result: {} }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Grep', pattern: 'Order', agentId: 'a1' })
  await $.agent.spawn({ ...SPAWN, subagentType: 'code-reviewer', description: 'Review the orders filter' })
  const rows = await workRows($)
  const i = rows.findIndex(r => /^code-reviewer/.test(r))
  expect(rows[i + 1]).toBe('Review the orders filter')
  expect(rows.some(r => /last tool/.test(r))).toBe(false)
  // a call after the spawn is seen as before
  await $.tool.call({ tool: 'Grep', pattern: 'Order', agentId: 'a1' })
  expect((await workRows($)).some(r => r === 'last tool Grep')).toBe(true)
})

// ── done-claim.log is read again only when it changed ──

test('hook triggers: the log is read again only when its size or modification time changed', async ($, on) => {
  const claimReads: string[] = []
  let mtime = 1
  const options: World = { claimReads, doneClaims: claim(1, 'unproven-row', 'primo'), claimsMtime: () => mtime }
  const clock = world(on, options)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(claimReads).toHaveLength(1)
  for (let i = 0; i < 4; i++) await clock.advance(30_000)
  expect(claimReads).toHaveLength(1)
  expect((await workRows($)).some(r => /primo/.test(r))).toBe(true)

  mtime = 2 // same size, new time
  await clock.advance(30_000)
  expect(claimReads).toHaveLength(2)

  options.doneClaims = `${claim(1, 'unproven-row', 'primo')}\n${claim(2, 'unproven-row', 'secondo')}\n` // another size
  await clock.advance(30_000)
  expect(claimReads).toHaveLength(3)
  expect((await workRows($)).some(r => /secondo/.test(r))).toBe(true)
  await clock.advance(30_000)
  expect(claimReads).toHaveLength(3)
})


// ── Work: the changed files ──

test('Work: the changed files with +/- (a binary file bin, an untracked one ?), at most 8 rows, then … +n', async ($, on) => {
  const numstat: [string, string, string][] = [
    ['12', '3', 'src/a.ts'],
    ['0', '5', 'src/b.ts'],
    ['-', '-', 'img.png'],
    ['1', '1', 'lib/f0.ts'],
    ['1', '1', 'lib/f1.ts'],
    ['1', '1', 'lib/f2.ts'],
  ]
  world(on, { numstat, untracked: ['notes.md', 'new.ts', 'x.ts', 'y.ts'] })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await settleAll()
  const ui = await mountPane($)
  await ui.press({ key: 'tab:work' })
  await settleAll()
  const files = (await ui.findAll({ type: 'Button' })).filter(b => /^file:/.test(b.key ?? ''))
  expect(files.map(b => b.key)).toEqual(
    ['src/a.ts', 'src/b.ts', 'img.png', 'lib/f0.ts', 'lib/f1.ts', 'lib/f2.ts', 'notes.md', 'new.ts'].map(f => `file:${f}`),
  )
  expect(files[0]?.text).toMatch(/^ +\+12 +-3 src\/a\.ts$/)
  expect(files[1]?.text).toMatch(/^ +\+0 +-5 src\/b\.ts$/)
  expect(files[2]?.text).toMatch(/^ +bin +img\.png$/)
  expect(files[6]?.text).toMatch(/^ +\? +notes\.md$/)
  const rows = rowTexts(await ui.drawn())
  const i = rows.findIndex(r => r === 'CHANGES · 10')
  expect(i).toBeGreaterThan(0)
  expect(rows[i + 1]).toBe(' ')
  expect(rows[i + 10]).toBe('… +2')
  await ui.unmount()
})

test('Work: no changed files says so', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const rows = await lavoroRows($)
  expect(rows).toContain('CHANGES · 0')
  expect(rows).toContain('no changes')
})

test('Work: git is not read for it while another tab is selected', async ($, on) => {
  const gitCalls: string[] = []
  world(on, { gitCalls, numstat: [['1', '1', 'a.ts']], branch: 'feature/x' })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await settleAll()
  expect(gitCalls).toEqual([])
  const ui = await mountPane($)
  await ui.press({ key: 'tab:work' })
  await settleAll()
  expect(gitCalls).toContain('git -C /work/example-repo --no-optional-locks ls-files --others --exclude-standard -z')
  await ui.unmount()
})

// ── Work: the diff pane ──

const DIFF = ['diff --git a/src/a.ts b/src/a.ts', 'index 1111111..2222222 100644', '--- a/src/a.ts', '+++ b/src/a.ts', '@@ -1,2 +1,3 @@', ' keep', '-old', '+new', '+added', ''].join('\n')
const HUNKS = DIFF.split('\n').slice(2).join('\n')
const DIFF_PANE = { ...PANE, requestId: 'cockpit-diff', props: { ...PANE.props, title: 'diff', bodyColumns: 80 } } as const

/** Presses the file `key` of the Work tab and returns the diff pane drawn afterwards. */
async function pressFile($: Engine, file: string) {
  const ui = await mountPane($)
  await ui.press({ key: 'tab:work' })
  await settleAll()
  await ui.press({ key: `file:${file}` })
  await settleAll()
  await ui.unmount()
  return $.ui.mount({ ...DIFF_PANE, surface: 'terminal' })
}

test('diff pane: pressing a changed file opens `diff · <file>` and draws git diff HEAD -- <file> as diff hunks with Code', async ($, on) => {
  const opened: string[] = []
  const openedTitles: (string | undefined)[] = []
  const gitCalls: string[] = []
  world(on, { opened, openedTitles, gitCalls, numstat: [['2', '1', 'src/a.ts']], fileDiffs: { 'src/a.ts': DIFF } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const diff = await pressFile($, 'src/a.ts')
  expect(opened).toEqual(['cockpit-diff'])
  expect(openedTitles).toEqual(['diff · src/a.ts'])
  const code = await diff.find({ type: 'Code' })
  expect(code?.props).toMatchObject({ format: 'diff', source: HUNKS })
  expect(await diff.find({ type: 'Text', text: 'diff · src/a.ts' })).toBeDefined()
  await diff.unmount()
})

test('diff pane: an untracked file is drawn as all additions', async ($, on) => {
  world(on, { untracked: ['notes.md'], files: { 'notes.md': 'one\r\ntwo\n' } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const diff = await pressFile($, 'notes.md')
  expect((await diff.find({ type: 'Code' }))?.props).toMatchObject({
    format: 'diff',
    source: '--- /dev/null\n+++ b/notes.md\n@@ -0,0 +1,2 @@\n+one\n+two\n',
  })
  await diff.unmount()
})

test('diff pane: a diff with no hunks (a binary file) says so instead of drawing nothing', async ($, on) => {
  world(on, { numstat: [['-', '-', 'img.png']], fileDiffs: { 'img.png': 'diff --git a/img.png b/img.png\nBinary files a/img.png and b/img.png differ\n' } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const diff = await pressFile($, 'img.png')
  expect(await diff.find({ type: 'Code' })).toBeUndefined()
  expect(await diff.find({ type: 'Text', text: /no hunk/ })).toBeDefined()
  await diff.unmount()
})

test('diff pane: closable from its own button, which closes the pane and forgets the diff', async ($, on) => {
  const closed: string[] = []
  world(on, { closed, numstat: [['2', '1', 'src/a.ts']], fileDiffs: { 'src/a.ts': DIFF } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const diff = await pressFile($, 'src/a.ts')
  expect((await diff.find({ key: 'diff:close' }))?.text).toBe('close')
  await diff.press({ key: 'diff:close' })
  await settleAll()
  expect(closed).toEqual(['plugin'])
  await diff.unmount()
  const again = await $.ui.mount({ ...DIFF_PANE, surface: 'terminal' })
  expect(await again.find({ type: 'Code' })).toBeUndefined()
  await again.unmount()
})

// ── The Azure CLI is started the way the platform can start it, aimed at the identity's own config ──

const AZ_PR = [{ pullRequestId: 7, title: 'Faster orders', status: 'active' }]
const AZ_LIST = `repos pr list --organization ${['https://dev.azure.com', 'org-a'].join('/')} --project proj --repository orders --source-branch refs/heads/feature/orders-filter --status all --top 1 --output json`

for (const { name, env } of [
  { name: 'OS is Windows_NT', env: { OS: 'Windows_NT' } },
  { name: 'ComSpec is set', env: { ComSpec: 'cmd.exe' } },
]) {
  test(`az: on Windows (${name}) it runs through cmd, since az.cmd cannot be started by name without a shell`, async ($, on) => {
    const azCalls: string[] = []
    world(on, { azCalls, env: { CLAUDE_CONFIG_DIR: '/cfg', ...env }, branch: 'feature/orders-filter', remote: AZ_REMOTE, workspaces: AZ_WORKSPACES, azPr: AZ_PR })
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    await settleAll()
    expect(azCalls).toEqual([`cmd /d /s /c az ${AZ_LIST}`])
    expect((await lavoroRows($)).some(r => r === '#7 · open · Faster orders')).toBe(true)
  })
}

test('az: elsewhere it is started by name, with no shell in between', async ($, on) => {
  const azCalls: string[] = []
  world(on, { azCalls, env: { CLAUDE_CONFIG_DIR: '/cfg', OS: 'Linux' }, branch: 'feature/orders-filter', remote: AZ_REMOTE, workspaces: AZ_WORKSPACES, azPr: AZ_PR })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await settleAll()
  expect(azCalls).toEqual([`az ${AZ_LIST}`])
})

test('az: on Windows an argument cmd would read as more than text (a branch named a&b) is never handed to it', async ($, on) => {
  const windows: string[] = []
  world(on, { azCalls: windows, env: { CLAUDE_CONFIG_DIR: '/cfg', OS: 'Windows_NT' }, branch: 'feature/a&b', remote: AZ_REMOTE, workspaces: AZ_WORKSPACES, azPr: AZ_PR })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await settleAll()
  expect(windows).toEqual([])
  expect((await lavoroRows($)).some(r => /^PR ·/.test(r))).toBe(false)
})

for (const { name, env, prefix } of [
  { name: 'elsewhere', env: { HOME: '/home/me' }, prefix: 'az ' },
  { name: 'on Windows', env: { OS: 'Windows_NT', USERPROFILE: '/home/me' }, prefix: 'cmd /d /s /c az ' },
]) {
  test(`az: ${name} the ALM identity's own config folder is selected for the call, when that folder exists`, async ($, on) => {
    const azCalls: string[] = []
    const azEnvs: (Record<string, string> | undefined)[] = []
    world(on, {
      azCalls,
      azEnvs,
      azDirs: ['.azure-id-a'],
      env: { CLAUDE_CONFIG_DIR: '/cfg', ...env },
      branch: 'feature/orders-filter',
      remote: AZ_REMOTE,
      workspaces: AZ_WORKSPACES,
      azPr: AZ_PR,
    })
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    await settleAll()
    expect(azCalls).toHaveLength(1)
    expect(azCalls[0]?.startsWith(prefix)).toBe(true)
    expect(azEnvs).toEqual([{ AZURE_CONFIG_DIR: `${env.USERPROFILE ?? env.HOME}/.azure-id-a` }])
  })
}

test('az: an identity whose config folder does not exist leaves the call with no AZURE_CONFIG_DIR, as hooks/lib/az-pin.js does', async ($, on) => {
  const azEnvs: (Record<string, string> | undefined)[] = []
  world(on, { azEnvs, azDirs: [], env: { CLAUDE_CONFIG_DIR: '/cfg', HOME: '/home/me' }, branch: 'feature/orders-filter', remote: AZ_REMOTE, workspaces: AZ_WORKSPACES, azPr: AZ_PR })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await settleAll()
  expect(azEnvs).toEqual([undefined])
})

// ── Review follow-ups: the diff pane of a file that cannot be drawn, a branch that moves under a refresh ──

for (const { name, options } of [
  { name: 'over 4 MiB', options: { fileSizes: { 'big.log': 4 * 1024 * 1024 + 1 }, files: { 'big.log': 'x' } } },
  { name: 'unreadable', options: { unreadable: ['big.log'] } },
] satisfies { name: string; options: World }[]) {
  test(`diff pane: an untracked file ${name} opens the pane saying file too big or unreadable`, async ($, on) => {
    const opened: string[] = []
    world(on, { opened, untracked: ['big.log'], ...options })
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    const diff = await pressFile($, 'big.log')
    expect(opened).toEqual(['cockpit-diff'])
    expect(await diff.find({ type: 'Code' })).toBeUndefined()
    expect(await diff.find({ type: 'Text', text: 'file too big or unreadable' })).toBeDefined()
    expect(await diff.find({ type: 'Text', text: 'diff · big.log' })).toBeDefined()
    expect(await diff.find({ key: 'diff:close' })).toBeDefined()
    await diff.unmount()
  })
}

test('PR: a branch that changes between a refresh\'s git read and its patch is asked again, not served from the read of the branch it left', async ($, on) => {
  const ghCalls: string[] = []
  const options: World = { ghCalls, branch: 'feature/orders-filter', remote: GH_SSH, pr: 42 }
  const clock = world(on, options)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await settleAll()
  expect(ghCalls).toHaveLength(1)

  // A refresh reads the branch, then waits; meanwhile another one finds HEAD detached and patches that in.
  let release = () => {}
  options.holdRevParse = new Promise<void>(resolve => {
    release = resolve
  })
  await clock.advance(30_000)
  await settleAll()
  options.detached = true
  await clock.advance(30_000)
  await settleAll()
  options.detached = false
  release() // the first refresh patches the branch it read, over the one the snapshot now holds
  await settleAll()
  expect(ghCalls).toHaveLength(2)
  expect(await lavoroRows($)).toContain('#42 · open · Fix the orders filter')
})

// ── Cockpit v3, phase 1: layout, header, refresh tiers, buttons at the bottom ──

/** The rows above the tab bar: the always-visible header. */
const headerOf = (rows: string[]): string[] => rows.slice(0, rows.findIndex(r => /^─+$/.test(r)))

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

test('header: the Claude state follows turn.start, a thinking chunk, a tool in flight, a permission request, a notification and the turn end', async ($, on) => {
  world(on)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  const gates: Record<string, () => void> = {}
  const gate = (name: string) => new Promise<void>(resolve => void (gates[name] = resolve))
  const stepGate = gate('step')
  on('turn.step', async function* (_, e) {
    yield { kind: 'thinking', index: 0, text: 'hm' }
    await stepGate
    yield { kind: 'text', index: 1, text: 'ok' }
    return { turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  const toolGate = gate('tool')
  on('tool.call', { tool: 'Bash' }, async () => {
    await toolGate
    return { result: {} }
  })
  const askGate = gate('ask')
  on('classic.PermissionRequest', async () => {
    await askGate
    return { decision: { behavior: 'allow' } }
  })
  on('classic.Notification', () => ({}))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const state = async () => headerOf((await paneRows($)).rows)[0] ?? ''

  expect(await state()).toContain('ready')
  await $.turn.start({ text: 'go', turnId: 't1' })
  expect(await state()).toContain('working')

  const stream = $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 })
  await stream.next() // the thinking chunk
  expect(await state()).toContain('thinking')
  gates.step?.()
  for await (const chunk of stream) void chunk
  expect(await state()).toContain('working')

  const call = $.tool.call({ tool: 'Bash', command: 'ls' })
  await settleAll()
  expect(await state()).toContain('Bash')
  gates.tool?.()
  await call
  expect(await state()).toContain('working')

  const ask = $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: {} })
  await settleAll()
  expect(await state()).toContain('waiting')
  gates.ask?.()
  await ask
  expect(await state()).toContain('working')

  await $.classic.Notification({ message: 'Claude needs your attention', notification_type: 'permission_prompt' })
  expect(await state()).toContain('waiting')

  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  expect(await state()).toContain('ready')
})

test('header: a subagent\'s events do not move the Claude state', async ($, on) => {
  world(on)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: {} }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'go', turnId: 't1', agentId: 'a1' })
  await $.tool.call({ tool: 'Bash', command: 'ls', agentId: 'a1' })
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 'a1-t', agentId: 'a1', reason: 'answer' })
  expect(headerOf((await paneRows($)).rows)[0]).toContain('ready')
})

test('refresh tiers: fast 2 s while a tab with a clock is selected, medium 10 s for git whatever the tab while the pane is open, slow 30 s always, none while the pane is closed', async ($, on) => {
  const statusCalls: string[] = []
  const listCalls: string[] = []
  const clock = world(on, { statusCalls, listCalls })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(4000)
  expect(listCalls).toHaveLength(0) // the pane is closed: nothing to keep fresh at 2 s
  expect(statusCalls.length).toBe(1) // the one git read of the session start

  await $.command.run({ command: 'cockpit', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 80 } })
  const ui = await mountPane($, 50)
  const reset = () => {
    statusCalls.length = 0
    listCalls.length = 0
  }
  reset()
  await clock.advance(2000) // t = 6 s: the fast timer ticked once (Subagents has elapsed times)
  expect(listCalls.length).toBeGreaterThanOrEqual(1)
  expect(statusCalls).toHaveLength(0)

  await ui.press({ key: 'tab:context' })
  await settleAll()
  reset()
  await clock.advance(3000) // t = 9 s: Context has no clock and git is not due yet
  expect(listCalls).toHaveLength(0)
  expect(statusCalls).toHaveLength(0)
  await clock.advance(1500) // t = 10.5 s: the medium timer ticked
  await settleAll()
  expect(statusCalls.length).toBeGreaterThanOrEqual(1)

  await ui.press({ key: 'tab:agents' })
  await settleAll()
  reset()
  await clock.advance(10_000) // t = 20.5 s: the medium timer ticked at 20 s: the header shows git on every tab
  await settleAll()
  expect(listCalls.length).toBeGreaterThanOrEqual(1)
  expect(statusCalls.length).toBeGreaterThanOrEqual(1)

  reset()
  await clock.advance(10_000) // t = 30.5 s: the slow timer ticked, whatever tab is selected
  await settleAll()
  expect(statusCalls.length).toBeGreaterThanOrEqual(1)
  await ui.unmount()
})

test('refresh tiers: the state file heartbeat stays fresh while the pane is open, at the slow tier', async ($, on) => {
  const writes = new Map<string, string>()
  const clock = world(on, { writes })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'cockpit', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 80 } })
  await clock.advance(30_000)
  await settleAll()
  const at = (flagOf(writes) as { at: number }).at
  expect(NOW + 30_000 - at).toBeLessThan(30_000)
  expect(at).toBeGreaterThan(NOW)
})

test('buttons: compact and log hours close the pane height, whatever the tab: a column box of bodyRows with a growing spacer', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  type Node = { type?: string; props?: { flexGrow?: number; minHeight?: number; flexDirection?: string }; children?: Node[] }
  const mountAt = async (bodyRows: number, tab: string) => {
    const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, scroll: { offset: 0, bodyRows } }, surface: 'terminal' })
    await ui.press({ key: `tab:${tab}` })
    const root = (await ui.drawn()) as Node
    await ui.unmount()
    return root
  }
  // a short tab in a tall pane, and a tall tab (the header alone is taller than 5 rows) in a short one
  // every tab in a tall pane, and the tallest one in a short one
  for (const [bodyRows, tab] of [...TABS.map(t => [30, t] as const), [5, 'work'] as const]) {
    const root = await mountAt(bodyRows, tab)
    expect(root.props?.flexDirection).toBe('column')
    expect(root.props?.minHeight).toBe(bodyRows)
    const kids = root.children ?? []
    expect(kids.at(-3)?.type).toBe('Box')
    expect(kids.at(-3)?.props?.flexGrow).toBe(1) // the spacer
    expect(lastRowKeys(root)).toEqual(['bar:compact', 'bar:worklog'])
  }
})

// ── Phase 2 follow-ups ──

test('header: parallel main tool calls keep the state on a tool until none is left, and a permission wait restores the tool held before', async ($, on) => {
  world(on)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  const gates: Record<string, () => void> = {}
  const gate = (name: string) => new Promise<void>(resolve => void (gates[name] = resolve))
  const bashGate = gate('bash')
  const readGate = gate('read')
  const askGate = gate('ask')
  on('tool.call', { tool: 'Bash' }, async () => {
    await bashGate
    return { result: {} }
  })
  on('tool.call', { tool: 'Read' }, async () => {
    await readGate
    return { result: {} }
  })
  on('classic.PermissionRequest', async () => {
    await askGate
    return { decision: { behavior: 'allow' } }
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const state = async () => headerOf((await paneRows($)).rows)[0] ?? ''
  await $.turn.start({ text: 'go', turnId: 't1' })

  const bash = $.tool.call({ tool: 'Bash', command: 'ls' })
  await settleAll()
  const read = $.tool.call({ tool: 'Read', file_path: '/a' })
  await settleAll()
  expect(await state()).toContain('Read')

  gates.read?.()
  await read
  // Bash is still in flight: not back to working, and the tool shown is the one left
  expect(await state()).toContain('Bash')

  const ask = $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: {} })
  await settleAll()
  expect(await state()).toContain('waiting')
  gates.ask?.()
  await ask
  expect(await state()).toContain('Bash')

  gates.bash?.()
  await bash
  expect(await state()).toContain('working')
})

test('header: a notification while idle does not switch to waiting; while working it does', async ($, on) => {
  world(on)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('classic.Notification', () => ({}))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const state = async () => headerOf((await paneRows($)).rows)[0] ?? ''
  const notify = () => $.classic.Notification({ message: 'Claude is waiting for your input', notification_type: 'idle_prompt' })

  await notify() // before any event the state reads as idle
  expect(await state()).toContain('ready')
  await $.turn.start({ text: 'go', turnId: 't1' })
  await notify()
  expect(await state()).toContain('waiting')
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  await notify()
  expect(await state()).toContain('ready')
})

test('refresh tiers: the slow tick writes the heartbeat before the clock tick runs', async ($, on) => {
  const writes = new Map<string, string>()
  let hold: Promise<void> | undefined
  const clock = world(on, { writes, holdList: () => hold })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'cockpit', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 80 } })
  hold = new Promise<void>(() => {}) // the clock tick never gets its list of agents
  await clock.advance(30_000)
  await settleAll()
  expect((flagOf(writes) as { at: number }).at).toBe(NOW + 30_000)
})

test('turn.step: the main loop\'s chunks read the snapshot once per change of state, not once per chunk', async ($, on) => {
  let reads = 0
  world(on)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('state.get', (_, e, next) => {
    reads++
    return next(e)
  })
  on('turn.step', async function* (_, e) {
    for (let i = 0; i < (e.index === 2 ? 6 : 1); i++) yield { kind: 'text', index: i, text: 'x' }
    return { turnId: e.turnId, index: e.index, answer: 'x', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'go', turnId: 't1' })
  const run = async (index: number) => {
    const before = reads
    for await (const chunk of $.turn.step({ turnId: 't1', index, model: 'claude-opus-5-5', messageCount: 1 })) void chunk
    return reads - before
  }
  await run(0) // the first step also writes the model and the effort
  const one = await run(1)
  expect(await run(2)).toBe(one) // five more chunks of the same kind cost no read
})

// ── Subagenti ──

const STEP_USAGE = { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 8000, cache_creation_input_tokens: 500, model: 'claude-sonnet-5-5' }

test('Subagenti: an agent block shows state, type, description, model, effort, share of the session tokens, time, the four counters per step and the tool running now, then the last one', async ($, on) => {
  const clock = world(on, { listed: [{ id: 'a1', status: 'running' }] })
  spawns(on)
  on('turn.step', async function* (_, e) {
    yield { kind: 'text', index: 0, text: 'x' }
    return { turnId: e.turnId, index: e.index, answer: 'x', toolUses: [], stopReason: 'end_turn', usage: STEP_USAGE }
  })
  on('turn.complete', () => ({ text: '' }))
  let release = () => {}
  const toolGate = new Promise<void>(resolve => void (release = resolve))
  on('tool.call', { tool: 'Read' }, async () => {
    await toolGate
    return { result: {} }
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'cockpit', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 80 } })
  await spawnAgent($, 'code-reviewer')
  const step = async (agentId?: string) => {
    for await (const chunk of $.turn.step({ turnId: 't', index: 0, model: 'claude-sonnet-5-5', effort: 'high', messageCount: 1, ...(agentId && { agentId }) })) void chunk
  }
  const ui = await mountPane($)
  await ui.press({ key: 'tab:agents' })
  const rows = async () => rowTexts(await ui.drawn())
  const facts = async (u: typeof ui) => (await u.findAll({ type: 'Text', text: /^\d+% token {2}\d+s$/ }))[0]?.text
  const counters = /^ +in 1k {2}out 200 {2}cr 8k {2}cw 500$/

  // before any step the counters are not drawn: nothing is faked
  expect((await rows()).some(r => /^ +in /.test(r))).toBe(false)

  await step('a1')
  let now = await rows()
  expect(now.find(r => /code-reviewer/.test(r))).toBe('◐ code-reviewer  go')
  expect(now.some(r => counters.test(r))).toBe(true)
  expect(now.find(r => /son 5\.5/.test(r))).toMatch(/^ +son 5\.5 .* HIGH/)
  expect(await facts(ui)).toBe('100% token  0s')

  // the main loop's step counts in the session: the agent is half of it
  await step()
  expect(await facts(ui)).toBe('50% token  0s')

  // the elapsed time moves with the fast tier
  await clock.advance(2000)
  await settleAll()
  expect(await facts(ui)).toBe('50% token  2s')

  // the tool in flight, then the last one
  const call = $.tool.call({ tool: 'Read', file_path: '/a', agentId: 'a1' })
  await settleAll()
  expect((await rows()).some(r => /^ +▸ Read$/.test(r))).toBe(true)
  release()
  await call
  now = await rows()
  expect(now.some(r => /^ +▸ Read$/.test(r))).toBe(false)
  expect(now.some(r => /^ +last tool Read$/.test(r))).toBe(true)

  // the turn's end settles the counters on the turn's own total: the steps are not counted twice
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 'a1-t', agentId: 'a1', reason: 'answer', usage: STEP_USAGE })
  expect((await rows()).some(r => counters.test(r))).toBe(true)
  await ui.unmount()
})

test('Subagenti: the turn\'s own total replaces what its steps added, a turn that saw no step adds its own, and the share follows', async ($, on) => {
  world(on)
  spawns(on)
  on('turn.step', async function* (_, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: STEP_USAGE }
  })
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await spawnAgent($, 'one')
  await spawnAgent($, 'two')
  for await (const chunk of $.turn.step({ turnId: 't', index: 0, model: 'claude-sonnet-5-5', messageCount: 1, agentId: 'a1' })) void chunk
  // the engine's total for the turn is a little more than its steps summed: it wins
  const more = { ...STEP_USAGE, output_tokens: 300 }
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 'a1-t', agentId: 'a1', reason: 'answer', usage: more })
  // a2 saw no step: the turn's end alone gives its counters
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 'a2-t', agentId: 'a2', reason: 'answer', usage: STEP_USAGE })
  const rows = (await paneRows($, 50, 'agents')).rows
  expect(rows.filter(r => /^ +in 1k {2}out 300 {2}cr 8k {2}cw 500$/.test(r))).toHaveLength(1)
  expect(rows.filter(r => /^ +in 1k {2}out 200 {2}cr 8k {2}cw 500$/.test(r))).toHaveLength(1)
  // 1800 and 1700 new tokens of 3500
  const ui = await mountPane($)
  await ui.press({ key: 'tab:agents' })
  expect((await ui.findAll({ type: 'Text', text: /^\d+% token {2}\d+s$/ })).map(n => n.text?.replace(/ {2}\d+s$/, ''))).toEqual(['51% token', '49% token'])
  await ui.unmount()
})

test('Subagenti: after a reload the share keeps the main loop\'s tokens and the agents\' cumulative count, which the state file persists next to the history', async ($, on) => {
  const writes = new Map<string, string>()
  world(on, { writes, stateFile: JSON.stringify({ open: false, tab: 'agents', mainTokens: 10_000, agentTokens: 5400, history: [entry('a9', 'implementer', NOW - 30_000)] }) })
  spawns(on)
  on('turn.step', async function* (_, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: STEP_USAGE }
  })
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await spawnAgent($, 'one')
  for await (const chunk of $.turn.step({ turnId: 't', index: 0, model: 'claude-sonnet-5-5', messageCount: 1, agentId: 'a1' })) void chunk
  // 1700 of 10000 + 5400 + 1700 new tokens
  const ui = await mountPane($)
  await ui.press({ key: 'tab:agents' })
  expect((await ui.findAll({ type: 'Text', text: /^\d+% token {2}\d+s$/ })).map(n => n.text?.replace(/ {2}\d+s$/, ''))).toEqual(['10% token'])
  await ui.unmount()
  // a main step is written, for the next reload
  for await (const chunk of $.turn.step({ turnId: 't2', index: 0, model: 'claude-sonnet-5-5', messageCount: 1 })) void chunk
  await settleAll()
  await $.session.end({ reason: 'clear', sessionId: 's-1', resume: { id: 's-1' } })
  const file = [...writes.entries()].find(([k]) => /cockpit-s-1\.json$/.test(k))
  expect(JSON.parse(file?.[1] ?? 'null')).toMatchObject({ mainTokens: 11_700 })
  // the agents' count is written too: the running agent (1700) joins the 5400 that left, as the ended session's file keeps it
  expect(JSON.parse(file?.[1] ?? 'null')).toMatchObject({ agentTokens: 7100 })
})

test('Subagenti: the elapsed time is refreshed by the fast tier only while this tab is selected', async ($, on) => {
  const clock = world(on, { listed: [{ id: 'a1', status: 'running' }] })
  spawns(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'cockpit', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 80 } })
  await spawnAgent($, 'code-reviewer')
  const ui = await mountPane($)
  const elapsed = async () => (await ui.findAll({ type: 'Text', text: /^\d+s$/ }))[0]?.text
  await ui.press({ key: 'tab:agents' })
  await clock.advance(4000)
  await settleAll()
  expect(await elapsed()).toBe('4s')
  await ui.press({ key: 'tab:context' })
  await clock.advance(4000) // Context has no clock: the agent's time stands where it was
  await settleAll()
  await ui.press({ key: 'tab:agents' })
  expect(await elapsed()).toBe('4s')
  await clock.advance(2000)
  await settleAll()
  expect(await elapsed()).toBe('10s')
  await ui.unmount()
})

// ── Cockpit v3, phase 3: the Context tab ──

const breakdownRow = (name: string, tokens: number, kind: 'used' | 'free' | 'buffer' | 'deferred' = 'used') => ({ name, tokens, color: 'promptBorder', isDeferred: kind === 'deferred', kind })
const CONTEXT_ROWS = [breakdownRow('System prompt', 8000), breakdownRow('Messages', 90_000), breakdownRow('Free space', 700_000, 'free')]
const openCockpit = ($: Engine) => $.command.run({ command: 'cockpit', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 80 } })
const mainTurnEnd = ($: Engine, agentId?: string) =>
  $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer', ...(agentId ? { agentId } : {}) })

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
  expect(rows.find(r => /System prompt/.test(r))).toMatch(/^■ System prompt +8k +1%$/)
  expect(rows.find(r => /Messages/.test(r))).toMatch(/^■ Messages +90k +9%$/)
  expect(rows.find(r => /Free space/.test(r))).toMatch(/Free space +700k +70%$/)
  expect((await ui.find({ type: 'Text', text: /^(estimate|exact|✓ = exact)$/ }))?.text).toBe('exact')
  expect(usageCalls.filter(c => c === 'full')).toHaveLength(1) // the first opening, idle, counts once by itself

  await ui.press({ key: 'ctx:exact' })
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

test('Context: the tab has no clock of its own: the fast tier does not run while it is selected', async ($, on) => {
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
  on('skill.prompt', (_, e) => ({ text: e.text }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(await $.skill.prompt({ skill: 'commit', text: 'go' })).toEqual({ text: 'go' }) // the hook passes the prompt through
  await $.skill.prompt({ skill: 'react', text: 'go' })
  await $.skill.prompt({ skill: 'commit', text: 'go' }) // a skill is listed once

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
  expect((await ui.find({ type: 'Text', text: /^41\/60 listed$/ }))?.text).toBe('41/60 listed')
  expect(rows.some(r => /^SKILLS · 2 used/.test(r))).toBe(true)
  const at = rows.findIndex(r => /^SKILLS ·/.test(r))
  expect(rows.slice(at + 1).filter(r => r === 'commit' || r === 'react')).toEqual(['commit', 'react'])
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
  expect(rows.find(r => /^[▁-█]{20} /.test(r))).toMatch(/^█{20} {2}100k → 100k$/)
  expect(rows.some(r => /worth compacting/.test(r))).toBe(false)

  // 72 % and three rounds up by more than 5 % each: 100k, 106k, 113k, 120k
  for (const [tokens, percent] of [[106_000, 70], [113_000, 71], [120_000, 72]] as const) await contextRound($, tokens, percent)
  rows = await view()
  // the sparkline stays at twenty blocks: the oldest went
  expect(rows.find(r => /^[▁-█]{20} /.test(r))).toMatch(/^[▁-█]{20} {2}100k → 120k$/)
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

// ── Phase 2 follow-ups, third round ──

test('Subagenti: an agent that leaves the list joins a cumulative counter that the state file persists, so the share does not lean on the history (cut at 50)', async ($, on) => {
  const writes = new Map<string, string>()
  // 100k new tokens of agents that left earlier, none of them in the (empty) history
  const clock = world(on, { writes, listed: [{ id: 'a2', status: 'running' }], stateFile: JSON.stringify({ open: false, tab: 'agents', agentTokens: 100_000 }) })
  spawns(on)
  on('turn.step', async function* (_, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: STEP_USAGE }
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await openCockpit($)
  await spawnAgent($, 'one') // a1: not listed by the engine, it ends at the next tick
  await spawnAgent($, 'two') // a2 stays running
  for (const agentId of ['a1', 'a2']) for await (const chunk of $.turn.step({ turnId: 't', index: 0, model: 'claude-sonnet-5-5', messageCount: 1, agentId })) void chunk
  const flag = () => (flagOf(writes) as { agentTokens?: number }).agentTokens
  await clock.advance(30_000)
  await settleAll()
  expect(flag()).toBe(100_000) // a1 ended but is listed for two more minutes: not counted yet
  await clock.advance(120_000)
  await settleAll()
  await clock.advance(30_000) // the heartbeat after a1 left the list
  await settleAll()
  expect(flag()).toBe(101_700)
  const ui = await mountPane($)
  await ui.press({ key: 'tab:agents' })
  // 1700 of 100000 + 1700 + 1700 (the agent has run for minutes by now)
  expect((await ui.findAll({ type: 'Text', text: /^\d+% token {2}\S+$/ })).map(n => n.text?.replace(/ {2}\S+$/, ''))).toEqual(['2% token'])
  await ui.unmount()
})

test('Subagenti: the tool line (the one running, or the last) is cut to the width with an ellipsis, like the counters', () => {
  const tool = 'mcp__plugin_browser-use_browser-use__a_very_long_tool_name_indeed'
  const agent = { id: 'a1', type: 't', status: 'running' as const, startedAt: 0, tokens: 0 }
  for (const a of [{ ...agent, activeTools: [tool] }, { ...agent, status: 'done' as const, lastTool: tool }]) {
    const rows = subagentDetails(a, '  ', 30)
    expect(rows).toHaveLength(1)
    expect(spanWidth(rows[0] ?? [])).toBe(30)
    expect(spanText(rows[0] ?? [])).toMatch(/…$/)
  }
  // a short one is left whole
  expect(spanText(subagentDetails({ ...agent, lastTool: 'Read' }, '  ', 30)[0] ?? [])).toBe('  last tool Read')
})

// ── Cockpit v3, phase 4: the final tabs and the Work tab ──

/** The Work tab's rows once the reads its selection started have settled. */
async function lavoroRows($: Engine, bodyColumns = 50) {
  const ui = await mountPane($, bodyColumns)
  await ui.press({ key: 'tab:work' })
  await settleAll()
  const rows = rowTexts(await ui.drawn())
  await ui.unmount()
  return rows
}

test('tabs: exactly Subagents, Context, Work, System, Subagents selected by default; System draws its own section', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 58)
  const tabs = (await ui.findAll({ type: 'Button' })).filter(b => /^tab:/.test(b.key ?? ''))
  expect(tabs.map(b => b.key)).toEqual(['tab:agents', 'tab:context', 'tab:work', 'tab:system'])
  expect(tabs.map(b => b.text)).toEqual(['Subagents', 'Context', 'Work', 'System'])
  expect(tabs.filter(b => b.props.variant === 'primary').map(b => b.key)).toEqual(['tab:agents'])
  expect(await ui.find({ type: 'Text', text: /^SUBAGENTS/ })).toBeDefined()
  await ui.press({ key: 'tab:system' })
  expect(await ui.find({ type: 'Text', text: /^SYSTEM$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^in arrivo$/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^SUBAGENTS/ })).toBeUndefined()
  await ui.unmount()
})

test('tabs: with four tabs the full labels fit 58 columns again, the running count and the worklog dot included', async ($, on) => {
  world(on, { hasWorklog: true })
  spawns(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await spawnAgent($, 'code-reviewer')
  for (const columns of [58, 80]) {
    const { labels, root } = await tabsAt($, columns)
    expect(labels).toEqual(['Subagents 1', 'Context', 'Work ●', 'System'])
    expect(wrapAround(root, 'tab:agents')).toBe('wrap')
  }
})

// A tab a state file of an earlier version holds goes where its content went.
for (const [saved, shown] of [
  ['session', 'tab:agents'],
  ['repo', 'tab:work'],
  ['system', 'tab:system'],
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

test('Work: the changed files with +/-, read only while Work is selected; no branch or worktree block (the header holds the branch)', async ($, on) => {
  world(on, { numstat: [['3', '1', 'src/a.ts']], untracked: ['notes.md'], worktrees: 'worktree /work/example-repo\nHEAD 1\nbranch refs/heads/feature/x\n' })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mountPane($)
  expect(rowTexts(await ui.drawn()).some(r => /^CHANGES/.test(r))).toBe(false)
  await ui.press({ key: 'tab:work' })
  await settleAll()
  const rows = rowTexts(await ui.drawn())
  expect(rows).toContain('CHANGES · 2')
  expect(rows.some(r => /^ +\+3 +-1 src\/a\.ts$/.test(r))).toBe(true)
  expect(rows.some(r => /^ +\? +notes\.md$/.test(r))).toBe(true)
  expect(rows.some(r => /^BRANCH|^WORKTREE/.test(r))).toBe(false)
  await ui.unmount()
})

test('Work: the last 8 main-loop tools, newest first, each with its short argument, outcome and time; a subagent call is not one', async ($, on) => {
  world(on)
  on('tool.call', { tool: 'Bash' }, () => ({ result: {} }))
  on('tool.call', { tool: 'Read' }, () => ({ result: {} }))
  on('tool.call', { tool: 'Edit' }, () => ({ deny: 'no' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  for (let i = 1; i <= 9; i++) await $.tool.call({ tool: 'Bash', command: `echo ${i}` })
  await $.tool.call({ tool: 'Read', file_path: '/w/src/orders/Filter.ts' })
  await $.tool.call({ tool: 'Edit', file_path: '/w/x.ts', old_string: 'a', new_string: 'b' })
  await $.tool.call({ tool: 'Bash', command: 'from a subagent', agentId: 'a1' })
  const rows = await lavoroRows($)
  const i = rows.findIndex(r => r === 'TOOL · 8')
  expect(i).toBeGreaterThan(0)
  expect(rows[i - 1]).toBe(' ')
  expect(rows[i - 2]).toMatch(/^─+$/)
  const list = rows.slice(i + 2, i + 10)
  expect(list[0]).toMatch(/^✗ Edit +x\.ts +\d\d:\d\d$/)
  expect(list[1]).toMatch(/^✓ Read +Filter\.ts +\d\d:\d\d$/)
  expect(list[2]).toMatch(/^✓ Bash +echo 9 +\d\d:\d\d$/)
  expect(list[7]).toMatch(/^✓ Bash +echo 4 +\d\d:\d\d$/)
  expect(rows.some(r => /subagent/.test(r))).toBe(false)
})

test('Work: a tool row is cut to the width: a long argument ends with an ellipsis and the time stays', async ($, on) => {
  world(on)
  on('tool.call', { tool: 'Bash' }, () => ({ result: {} }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'dotnet test --filter "FullyQualifiedName~Orders.Filter.VeryLongTestName" --no-build' })
  const row = (await lavoroRows($, 40)).find(r => /^[✓✗] Bash/.test(r)) ?? ''
  expect([...row].length).toBe(38)
  expect(row).toMatch(/…\s+\d\d:\d\d$/)
})

const GH_CREATED = 'https://github.com/example/orders/pull/42'
const bashResult = (stdout: string) => ({ result: { stdout, stderr: '', interrupted: false } })

test('Work: a PR created in the session (gh pr create) is a Link with its state, and is kept in the state file', async ($, on) => {
  const writes = new Map<string, string>()
  const clock = world(on, { writes })
  on('tool.call', { tool: 'Bash' }, () => bashResult(`Creating pull request\n${GH_CREATED}\n`))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'gh pr create --title "Add filter" --body "x"' })
  await $.tool.call({ tool: 'Bash', command: 'git status' }) // not a create: nothing
  const ui = await mountPane($)
  await ui.press({ key: 'tab:work' })
  await settleAll()
  const rows = rowTexts(await ui.drawn())
  expect(rows).toContain('PR · 1')
  expect(rows.some(r => /^#42 · open · Add filter$/.test(r))).toBe(true)
  expect((await ui.find({ type: 'Link' }))?.props.href).toBe(GH_CREATED)
  await ui.unmount()
  await clock.advance(3000)
  expect(dataOf(writes)?.prs).toEqual([{ number: 42, title: 'Add filter', state: 'open', isDraft: false, url: GH_CREATED }])
})

test('Work: a PR created with az repos pr create takes its link from the repository web url', async ($, on) => {
  world(on)
  on('tool.call', { tool: 'Bash' }, () =>
    bashResult(JSON.stringify({ pullRequestId: 9, title: 'Faster orders', status: 'active', isDraft: true, repository: { webUrl: 'https://dev.azure.com/o/p/_git/r' } })),
  )
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'az repos pr create --title "Faster orders" --draft true' })
  const ui = await mountPane($)
  await ui.press({ key: 'tab:work' })
  await settleAll()
  expect(rowTexts(await ui.drawn()).some(r => /^#9 · draft · Faster orders$/.test(r))).toBe(true)
  expect((await ui.find({ type: 'Link' }))?.props.href).toBe('https://dev.azure.com/o/p/_git/r/pullrequest/9')
  await ui.unmount()
})

test('Work: a create that failed, was refused or printed no url adds no PR', async ($, on) => {
  world(on)
  let answer: { deny: string } | { result: object; isError?: true } = { deny: 'no' }
  on('tool.call', { tool: 'Bash' }, () => answer)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'gh pr create --title x' })
  answer = bashResult('error: could not create')
  await $.tool.call({ tool: 'Bash', command: 'gh pr create --title x' })
  answer = { ...bashResult(GH_CREATED), isError: true }
  await $.tool.call({ tool: 'Bash', command: 'gh pr create --title x' })
  expect((await lavoroRows($)).some(r => /^PR ·/.test(r))).toBe(false)
})

test('Work: the PRs of a session come back with it (the state file), whatever their state', async ($, on) => {
  const prs = [
    { number: 7, title: 'Old work', state: 'merged', isDraft: false, url: 'https://github.com/example/orders/pull/7' },
    { number: 8, title: 'Checks', state: 'open', isDraft: false, checks: { passed: 1, failed: 1, pending: 0 }, review: 'changes' },
  ]
  world(on, { stateFile: JSON.stringify({ open: false, tab: 'work', prs }) })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mountPane($)
  const rows = rowTexts(await ui.drawn())
  expect(rows).toContain('PR · 2')
  expect(rows.some(r => /^#7 · merged · Old work$/.test(r))).toBe(true)
  expect(rows.some(r => /^#8 · open · Checks$/.test(r))).toBe(true)
  expect(rows.some(r => /^ +review changes requested · checks 1\/2 · ✗ 1$/.test(r))).toBe(true)
  // a PR without a url is plain text, never a link to nowhere
  expect((await ui.findAll({ type: 'Link' })).map(l => l.props.href)).toEqual(['https://github.com/example/orders/pull/7'])
  await ui.unmount()
})

test('Work: the read of the branch updates a PR already listed (created, then merged) instead of adding another', async ($, on) => {
  const options: World = { branch: 'feature/orders-filter', remote: GH_SSH }
  const clock = world(on, options)
  on('tool.call', { tool: 'Bash' }, () => bashResult(GH_CREATED))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await settleAll()
  await $.tool.call({ tool: 'Bash', command: 'gh pr create --title "Add filter"' })
  options.pr = 42
  options.prState = 'MERGED'
  options.prExtra = { url: GH_CREATED }
  await clock.advance(5 * MIN + 30_000)
  await settleAll()
  const rows = await lavoroRows($)
  expect(rows).toContain('PR · 1')
  expect(rows.filter(r => /^#42 /.test(r))).toEqual(['#42 · merged · Fix the orders filter'])
})

test('Work: an Azure PR seen active, then completed or abandoned, is read again and its entry follows the state', async ($, on) => {
  const options: World = { branch: 'feature/orders-filter', remote: AZ_REMOTE, workspaces: AZ_WORKSPACES }
  const pr = (status: string) => [{ pullRequestId: 7, title: 'Faster orders', status, isDraft: false }]
  options.azPr = pr('active')
  const clock = world(on, options)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await settleAll()
  expect(await lavoroRows($)).toContain('#7 · open · Faster orders')
  options.azPr = pr('completed')
  await clock.advance(5 * MIN + 30_000)
  await settleAll()
  let rows = await lavoroRows($)
  expect(rows).toContain('PR · 1')
  expect(rows.filter(r => /^#7 /.test(r))).toEqual(['#7 · merged · Faster orders'])
  options.azPr = pr('abandoned')
  await clock.advance(5 * MIN + 30_000)
  await settleAll()
  rows = await lavoroRows($)
  expect(rows.filter(r => /^#7 /.test(r))).toEqual(['#7 · closed · Faster orders'])
})

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

/** A held read by detail: `hold('full')` makes the next full read wait until the returned release is called. */
function holds() {
  const gates: Record<string, Promise<void> | undefined> = {}
  return {
    holdUsage: (detail: string) => gates[detail],
    hold: (detail: string) => {
      let release = () => {}
      gates[detail] = new Promise<void>(resolve => (release = resolve))
      return () => {
        gates[detail] = undefined
        release()
      }
    },
  }
}

test('follow-up: an older context read never replaces a newer one: the exact count asked after a slow summary wins, whichever answers last', async ($, on) => {
  const h = holds()
  world(on, { holdUsage: h.holdUsage, breakdown: { categories: CONTEXT_ROWS, totalTokens: 98_000, rawMaxTokens: 1_000_000 } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 50)
  const kind = async () => (await ui.find({ type: 'Text', text: /^(estimate|exact|✓ = exact)$/ }))?.text
  const releaseSummary = h.hold('summary')
  await ui.press({ key: 'tab:context' }) // summary read #1, held
  const releaseFull = h.hold('full')
  await ui.press({ key: 'ctx:exact' }) // full read #2, held
  releaseFull()
  await settleAll()
  expect(await kind()).toBe('exact')
  releaseSummary() // the older read answers last
  await settleAll()
  expect(await kind()).toBe('exact')
  await ui.unmount()
})

test('follow-up: a summary read asked by a tab change while the exact count runs is skipped: the exact result is never discarded', async ($, on) => {
  const h = holds()
  const usageCalls: (string | undefined)[] = []
  world(on, { usageCalls, holdUsage: h.holdUsage, breakdown: { categories: CONTEXT_ROWS, totalTokens: 98_000, rawMaxTokens: 1_000_000 } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 50)
  const kind = async () => (await ui.find({ type: 'Text', text: /^(estimate|exact|✓ = exact)$/ }))?.text
  const summaries = () => usageCalls.filter(c => c === 'summary').length
  await ui.press({ key: 'tab:context' })
  await settleAll()
  const releaseFull = h.hold('full')
  await ui.press({ key: 'ctx:exact' }) // full read #2, held
  const before = summaries()
  await ui.press({ key: 'tab:agents' })
  await ui.press({ key: 'tab:context' }) // would be summary read #3: skipped while counting
  await settleAll()
  expect(summaries()).toBe(before)
  releaseFull() // the count answers
  await settleAll()
  expect(await kind()).toBe('exact')
  await ui.press({ key: 'tab:agents' })
  await ui.press({ key: 'tab:context' }) // the count is over: a tab change reads a summary again
  await settleAll()
  expect(summaries()).toBe(before + 1)
  expect(await kind()).toBe('✓ = exact')
  await ui.unmount()
})

test('follow-up: a saved state without agentTokens starts the count from the history it lists', async ($, on) => {
  const writes = new Map<string, string>()
  const h = (id: string, tokens: number) => ({ id, type: 't', startedAt: 0, endedAt: 1, tokens, isFailed: false })
  world(on, { writes, stateFile: JSON.stringify({ open: false, tab: 'agents', history: [h('x1', 3000), h('x2', 2000)] }) })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect((flagOf(writes) as { agentTokens?: number }).agentTokens).toBe(5000)
})

test('follow-up: a saved agentTokens wins over the history sum', async ($, on) => {
  const writes = new Map<string, string>()
  const h = (id: string, tokens: number) => ({ id, type: 't', startedAt: 0, endedAt: 1, tokens, isFailed: false })
  world(on, { writes, stateFile: JSON.stringify({ open: false, tab: 'agents', agentTokens: 9000, history: [h('x1', 3000)] }) })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect((flagOf(writes) as { agentTokens?: number }).agentTokens).toBe(9000)
})

/** `on` with the first `clock.after` of the context debounce refused (the hook throws, so the engine skips it and runs nothing): the timer never fires. */
function refusingFirstAfter(on: On): On {
  let isRefused = false
  // `on` is overloaded on its pattern and matcher; this wrapper only forwards, so the loose signature cannot reach a caller
  const wrapped = (pattern: string, ...rest: unknown[]) => {
    const hook = rest.pop() as (...args: unknown[]) => unknown
    const guarded =
      pattern === 'clock.after'
        ? (...args: unknown[]) => {
            // only the context read's debounce (2 s) is refused, once
            if (isRefused || (args[1] as { ms?: number } | undefined)?.ms !== 2000) return hook(...args)
            isRefused = true
            throw new Error('refused')
          }
        : hook
    return (on as unknown as (...a: unknown[]) => unknown)(pattern, ...rest, guarded)
  }
  return wrapped as unknown as On
}

test('follow-up: a context read timer the engine refused does not stop the next turn from scheduling its read', async ($, on) => {
  const usageCalls: (string | undefined)[] = []
  const clock = world(refusingFirstAfter(on), { usageCalls, breakdown: { categories: CONTEXT_ROWS, totalTokens: 98_000, rawMaxTokens: 1_000_000 } })
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await openCockpit($)
  const ui = await mountPane($, 50)
  const summaries = () => usageCalls.filter(c => c === 'summary').length
  await ui.press({ key: 'tab:context' })
  await settleAll()
  const opened = summaries()
  await mainTurnEnd($) // its timer is refused: the read never runs
  await clock.advance(5000)
  await settleAll()
  expect(summaries()).toBe(opened)
  await mainTurnEnd($) // the refused timer must not hold the next one back
  await clock.advance(5000)
  await settleAll()
  expect(summaries()).toBe(opened + 1)
  await ui.unmount()
})

test('follow-up: the last tool line of a subagent block in Work is cut to the width', async ($, on) => {
  world(on, { listed: [{ id: 'a1', status: 'running' }] })
  spawns(on)
  on('tool.call', { tool: 'ListMcpResourcesTool' }, () => ({ result: {} }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.agent.spawn({ ...SPAWN, subagentType: 'code-reviewer', description: 'Review' })
  await $.tool.call({ tool: 'ListMcpResourcesTool', agentId: 'a1' })
  // 30 columns leave 28 cells: 'last tool ListMcpResourcesTool' needs 32
  const row = (await lavoroRows($, 30)).find(r => /^last tool/.test(r)) ?? ''
  expect([...row].length).toBe(28)
  expect(row).toMatch(/…$/)
})

// ── Cockpit v3, phase 5: the System tab ──

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))
/** Waits (up to a second) for something a loop the mod left running does on its own. */
const until = async (isDone: () => boolean) => {
  for (let i = 0; i < 100 && !isDone(); i++) await sleep(10)
}
const GIB = 1024 ** 3
const sysLine = (fields: object) => `${JSON.stringify(fields)}\n`

/**
 * A fake monitor behind `$.process.spawn`: prints what the test pushes (and a stderr dot while idle, as the real one prints every
 * 2 s: a loop that was stopped notices at the next piece), notes how it was started and when its stream was closed (a generator ends
 * in `finally` when the loop that reads it stops). It is finite: it ends by itself after two seconds. A stand-in for a call on `$`
 * answers `{ value }`, here the way the child ended.
 */
function fakeMonitor(on: On, options: { isBroken?: boolean } = {}) {
  const monitor = {
    spawns: [] as { argv: readonly string[]; env?: Record<string, string> }[],
    stops: 0,
    isEnded: false,
    queue: [] as string[],
    push: (text: string) => void monitor.queue.push(text),
    /** The monitor exits by itself, as a crash would end it. */
    end: () => void (monitor.isEnded = true),
  }
  on('process.spawn', async function* (_, e) {
    monitor.spawns.push({ argv: e.argv, env: e.env })
    if (options.isBroken) throw new Error('spawn node ENOENT')
    try {
      for (let i = 0; i < 400; i++) {
        while (monitor.queue.length > 0) yield { stream: 'stdout' as const, text: monitor.queue.shift() ?? '' }
        if (monitor.isEnded) return { value: { code: 1, signal: null } }
        yield { stream: 'stderr' as const, text: '.' }
        await sleep(5)
      }
      return { value: { code: 0, signal: null } }
    } finally {
      monitor.stops++
    }
  })
  return monitor
}

const FULL_LINE = sysLine({
  cpu: 37,
  ram: { used: Math.round(12.4 * GIB), total: 32 * GIB },
  net: { rx: Math.round(1.2 * 1024 ** 2), tx: 40 * 1024 },
  procs: [
    { pid: 7000, name: 'bash', ports: [] },
    { pid: 7240, name: 'node', ports: [3000, 5173] },
  ],
  disk: { free: 120 * GIB, total: 266 * GIB, label: 'D:' },
  power: { kind: 'battery', percent: 87, isCharging: true },
})

/** The System tab's rows after `lines` came from the monitor. */
async function sistemaRows($: Engine, m: ReturnType<typeof fakeMonitor>, lines: string[], bodyColumns = 50) {
  await openCockpit($)
  const ui = await mountPane($, bodyColumns)
  await settleAll()
  await ui.press({ key: 'tab:system' })
  await until(() => m.spawns.length > 0)
  for (const l of lines) m.push(l)
  await until(() => m.queue.length === 0)
  await settleAll()
  const rows = rowTexts(await ui.drawn())
  await ui.unmount()
  return rows
}

test('System: the monitor starts when the System tab is selected, with the session and config folder, and stops when another tab is', async ($, on) => {
  const m = fakeMonitor(on)
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await openCockpit($)
  const ui = await mountPane($, 50)
  await settleAll()
  expect(m.spawns).toHaveLength(0) // another tab is selected: nothing runs
  await ui.press({ key: 'tab:system' })
  await until(() => m.spawns.length === 1)
  expect(m.spawns).toHaveLength(1)
  expect(m.spawns[0]?.argv[0]).toBe('node')
  expect(m.spawns[0]?.argv[1]).toMatch(/sysmon[\\/]sysmon\.mjs$/)
  expect(m.spawns[0]?.env).toEqual({ COCKPIT_SESSION_ID: 's-1', COCKPIT_CONFIG_DIR: '/cfg' })
  expect(m.stops).toBe(0)
  await ui.press({ key: 'tab:context' })
  await until(() => m.stops === 1)
  expect(m.stops).toBe(1)
  await ui.press({ key: 'tab:system' }) // back on the tab: a fresh monitor
  await until(() => m.spawns.length === 2)
  expect(m.spawns).toHaveLength(2)
  await ui.press({ key: 'tab:work' })
  await until(() => m.stops === 2)
  expect(m.stops).toBe(2)
  await ui.unmount()
})

test('System: pressing the System tab twice runs one monitor', async ($, on) => {
  const m = fakeMonitor(on)
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await openCockpit($)
  const ui = await mountPane($, 50)
  await settleAll()
  await ui.press({ key: 'tab:system' })
  await ui.press({ key: 'tab:system' })
  await until(() => m.spawns.length > 0)
  await settleAll()
  expect(m.spawns).toHaveLength(1)
  expect(m.stops).toBe(0)
  await ui.unmount()
})

test('System: a pane that opens on the System tab (the saved one) starts the monitor', async ($, on) => {
  const m = fakeMonitor(on)
  world(on, { stateFile: JSON.stringify({ open: false, tab: 'system' }) })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(m.spawns).toHaveLength(0) // the pane starts closed
  await openCockpit($)
  await until(() => m.spawns.length === 1)
  expect(m.spawns).toHaveLength(1)
})

test('System: the end of the session stops the monitor', async ($, on) => {
  const m = fakeMonitor(on)
  world(on)
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await openCockpit($)
  const ui = await mountPane($, 50)
  await settleAll()
  await ui.press({ key: 'tab:system' })
  await until(() => m.spawns.length === 1)
  await $.session.end({ reason: 'clear', sessionId: 's-1', resume: { id: 's-1' } })
  await until(() => m.stops === 1)
  expect(m.stops).toBe(1)
  await ui.unmount()
})

test('System: four rows, CPU, RAM and network with a sparkline each, then disk and power with their icons, and the process table with its ports', async ($, on) => {
  const m = fakeMonitor(on)
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const rows = await sistemaRows($, m, [FULL_LINE, sysLine({ cpu: 80, ram: { used: 14 * GIB, total: 32 * GIB }, net: { rx: 0, tx: 0 } })])
  const i = rows.indexOf('SYSTEM')
  expect(i).toBeGreaterThan(0)
  expect(rows.slice(i + 2, i + 6)).toEqual([
    expect.stringMatching(/^CPU +[▁-█]{2} max 80% +80%$/),
    expect.stringMatching(/^RAM +[▁-█]{2} max 44% +14G\/32G 44%$/),
    expect.stringMatching(/^NET +[▁-█]{2} max 1\.2M\/s +↓0B\/s ↑0B\/s$/),
    `${ICONS.disk} D: 120G free  ${ICONS.charging} 87% charging`,
  ])
  expect(rows).toContain('PROCESSES · 2')
  expect(rows.some(r => /^ +7000 bash *$/.test(r))).toBe(true)
  expect(rows.some(r => /^ +7240 node +:3000 :5173$/.test(r))).toBe(true)
  expect(rows.some(r => /in arrivo/.test(r))).toBe(false)
})

test('System: the bars grow with the samples, scaled on the window, and a line split across two chunks is read whole', async ($, on) => {
  const m = fakeMonitor(on)
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const lines = [5, 5, 100].map(cpu => sysLine({ cpu }))
  const half = lines[2]?.length ? Math.floor(lines[2].length / 2) : 0
  const rows = await sistemaRows($, m, [lines[0] ?? '', lines[1] ?? '', lines[2]?.slice(0, half) ?? '', lines[2]?.slice(half) ?? ''])
  expect(rows.find(r => /^CPU/.test(r))).toMatch(/^CPU +▁▁█ max 100% +100%$/)
})

test('System: power drawn as wired, and a disk with little room left in red', async ($, on) => {
  const m = fakeMonitor(on)
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await openCockpit($)
  const ui = await mountPane($, 50)
  await settleAll()
  await ui.press({ key: 'tab:system' })
  await until(() => m.spawns.length === 1)
  m.push(sysLine({ disk: { free: 5 * GIB, total: 100 * GIB, label: 'D:' }, power: { kind: 'wired' } }))
  await until(() => m.queue.length === 0)
  await settleAll()
  const rows = rowTexts(await ui.drawn())
  expect(rows).toContain(`${ICONS.disk} D: 5.0G free  ${ICONS.plug} mains`)
  expect(colorOf(await ui.drawn(), /D: 5\.0G free/)).toBe(RED)
  await ui.unmount()
})

test('System: before the first line the tab says it is reading', async ($, on) => {
  const m = fakeMonitor(on)
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const rows = await sistemaRows($, m, [])
  expect(rows).toContain('SYSTEM')
  expect(rows).toContain('reading…')
})

test('System: a monitor that cannot start: CPU, RAM, network, disk, power and the processes all read unavailable', async ($, on) => {
  const m = fakeMonitor(on, { isBroken: true })
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await openCockpit($)
  const ui = await mountPane($, 50)
  await settleAll()
  await ui.press({ key: 'tab:system' })
  await until(() => m.spawns.length === 1)
  await settleAll()
  const rows = rowTexts(await ui.drawn())
  expect(rows).toContain('CPU  unavailable')
  expect(rows).toContain('RAM  unavailable')
  expect(rows).toContain('NET  unavailable')
  expect(rows).toContain(`${ICONS.disk} unavailable  ${ICONS.battery} unavailable`)
  expect(rows).toContain('unavailable')
  expect(rows).toContain('PROCESSES')
  await ui.unmount()
})

test('System: a part the monitor reports off (network on another platform) reads unavailable while the others draw', async ($, on) => {
  const m = fakeMonitor(on)
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const rows = await sistemaRows($, m, [sysLine({ cpu: 20, ram: { used: GIB, total: 8 * GIB }, off: ['net', 'procs', 'power'] })])
  expect(rows.find(r => /^CPU/.test(r))).toMatch(/^CPU +[▁-█]+ max 20% +20%$/)
  expect(rows).toContain('NET  unavailable')
  expect(rows).toContain('PROCESSES')
  expect(rows).toContain('unavailable')
})

test('System: the monitor ending on its own (a crash) turns every row to unavailable', async ($, on) => {
  const m = fakeMonitor(on)
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await openCockpit($)
  const ui = await mountPane($, 50)
  await settleAll()
  await ui.press({ key: 'tab:system' })
  await until(() => m.spawns.length === 1)
  m.push(FULL_LINE)
  await until(() => m.queue.length === 0)
  await settleAll()
  expect(rowTexts(await ui.drawn()).find(r => /^CPU/.test(r))).toMatch(/37%$/)
  m.end()
  await until(() => m.stops === 1)
  await settleAll()
  const after = rowTexts(await ui.drawn())
  expect(after).toContain('CPU  unavailable')
  expect(after).toContain('NET  unavailable')
  await ui.unmount()
})

test('System: the process table lists every process, with no row count and no cap', async ($, on) => {
  const m = fakeMonitor(on)
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const procs = Array.from({ length: 9 }, (_, n) => ({ pid: 100 + n, name: `proc${n}`, ports: [] }))
  const rows = await sistemaRows($, m, [sysLine({ procs })])
  expect(rows).toContain('PROCESSES · 9')
  expect(rows.filter(r => /proc\d *$/.test(r))).toHaveLength(9)
  expect(rows.some(r => /^… \+\d/.test(r))).toBe(false)
  const none = await sistemaRows($, m, [sysLine({ procs: [] })])
  expect(none).toContain('no child process')
})

test('System: every row fits the pane at 30, 40, 58 and 80 columns, a long process name and many ports cut with an ellipsis', async ($, on) => {
  const m = fakeMonitor(on)
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const long = sysLine({
    cpu: 100,
    ram: { used: 31 * GIB, total: 32 * GIB },
    net: { rx: 900 * 1024 ** 2, tx: 900 * 1024 ** 2 },
    procs: [{ pid: 123456, name: 'a-very-long-process-name-indeed', ports: [3000, 3001, 3002, 3003, 3004, 3005] }],
    disk: { free: 900 * GIB, total: 1000 * GIB, label: 'D:' },
    power: { kind: 'battery', percent: 100, isCharging: false },
  })
  for (const columns of [30, 40, 58, 80]) {
    const rows = await sistemaRows($, m, [long, long, long], columns)
    const width = Math.min(columns, 60) - 2
    const i = rows.indexOf('SYSTEM')
    expect(i).toBeGreaterThan(0)
    for (const row of rows.slice(i)) {
      if (/^─+$/.test(row)) continue
      expect(textCells(row)).toBeLessThanOrEqual(width)
    }
    expect(rows.slice(i).some(r => /^CPU/.test(r))).toBe(true)
  }
})

// ── Cockpit v3, phase 4 follow-ups, round 2 ──

test('follow-up: an exact context count in flight is not overwritten by the scheduled summary of a turn that ends meanwhile', async ($, on) => {
  const h = holds()
  const usageCalls: (string | undefined)[] = []
  const clock = world(on, { usageCalls, holdUsage: h.holdUsage, breakdown: { categories: CONTEXT_ROWS, totalTokens: 98_000, rawMaxTokens: 1_000_000 } })
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await openCockpit($)
  const ui = await mountPane($, 50)
  const kind = async () => (await ui.find({ type: 'Text', text: /^(estimate|exact|✓ = exact)$/ }))?.text
  const summaries = () => usageCalls.filter(c => c === 'summary').length
  await ui.press({ key: 'tab:context' })
  await settleAll()
  const release = h.hold('full')
  await ui.press({ key: 'ctx:exact' }) // counting, held
  const before = summaries()
  await mainTurnEnd($) // schedules a summary read in 2 s
  await clock.advance(5000)
  await settleAll()
  expect(summaries()).toBe(before) // skipped while the count runs
  release()
  await settleAll()
  expect(await kind()).toBe('exact')
  await mainTurnEnd($) // the count is over: the next turn's read runs again
  await clock.advance(5000)
  await settleAll()
  expect(summaries()).toBe(before + 1)
  await ui.unmount()
})

test('follow-up: a turn that ended just before the exact count started does not read a summary into it either', async ($, on) => {
  const h = holds()
  const usageCalls: (string | undefined)[] = []
  const clock = world(on, { usageCalls, holdUsage: h.holdUsage, breakdown: { categories: CONTEXT_ROWS, totalTokens: 98_000, rawMaxTokens: 1_000_000 } })
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await openCockpit($)
  const ui = await mountPane($, 50)
  await ui.press({ key: 'tab:context' })
  await settleAll()
  const summaries = () => usageCalls.filter(c => c === 'summary').length
  await mainTurnEnd($) // the summary is scheduled, not yet read
  const before = summaries()
  const release = h.hold('full')
  await ui.press({ key: 'ctx:exact' })
  await clock.advance(5000) // its timer fires while the count is in flight
  await settleAll()
  expect(summaries()).toBe(before)
  release()
  await settleAll()
  expect((await ui.find({ type: 'Text', text: /^(estimate|exact|✓ = exact)$/ }))?.text).toBe('exact')
  await ui.unmount()
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
  const row = (await lavoroRows($)).find(r => /echo no-clock/.test(r)) ?? ''
  expect(row).toMatch(/^✓ Bash +echo no-clock *$/)
})

test('follow-up: each PR row draws its review and checks line once', async ($, on) => {
  const prs = [{ number: 8, title: 'Checks', state: 'open', isDraft: false, checks: { passed: 1, failed: 1, pending: 0 }, review: 'changes' }]
  world(on, { stateFile: JSON.stringify({ open: false, tab: 'work', prs }) })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mountPane($)
  const rows = rowTexts(await ui.drawn())
  expect(rows.filter(r => /review changes requested/.test(r))).toHaveLength(1)
  await ui.unmount()
})

test('follow-up: a PR link that is not an http(s) address (a saved state, a CLI answer) is drawn as plain text', async ($, on) => {
  const prs = [
    { number: 7, title: 'Bad', state: 'open', isDraft: false, url: 'javascript:alert(1)' },
    { number: 8, title: 'Good', state: 'open', isDraft: false, url: 'https://github.com/example/orders/pull/8' },
  ]
  world(on, { stateFile: JSON.stringify({ open: false, tab: 'work', prs }) })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mountPane($)
  expect((await ui.findAll({ type: 'Link' })).map(l => l.props.href)).toEqual(['https://github.com/example/orders/pull/8'])
  await ui.unmount()
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

test('follow-up: a state-file timer the engine refused does not stop a later change from being written', async ($, on) => {
  const writes = new Map<string, string>()
  const clock = world(refusingFirstWriteTimer(on), { writes })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 50)
  await settleAll()
  // Context draws no elapsed time: no fast tick writes the file behind the timer's back.
  await ui.press({ key: 'tab:context' }) // inside the throttle window: its timer is refused, nothing is written
  await settleAll()
  await clock.advance(6500)
  await ui.press({ key: 'tab:agents' }) // the window is over: written at once
  await settleAll()
  expect((flagOf(writes) as { tab?: string }).tab).toBe('agents')
  await clock.advance(500)
  await ui.press({ key: 'tab:context' }) // inside the window again: the refused timer must not hold this one back
  await settleAll()
  await clock.advance(2500)
  await settleAll()
  expect((flagOf(writes) as { tab?: string }).tab).toBe('context')
  await ui.unmount()
})

// ── Phase 6: session data file ──

const SAVED_PR = { number: 7, title: 'Old work', state: 'merged', isDraft: false }

test('session data: history, PRs, the note and the context rounds go to cockpit-data-<id>.json, throttled like the state file; the state file keeps the handshake', async ($, on) => {
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
  const ui = await mountPane($)
  await ui.input({ key: 'note', text: 'ask Anna', kind: 'change' })
  await ui.unmount()
  expect(dataOf(writes)?.note).toBeUndefined() // inside the 3 s window of the start write
  await clock.advance(135_000) // the finished agent leaves the list for the history
  const data = dataOf(writes)
  expect(data).toMatchObject({ note: 'ask Anna', ctxRounds: [248_000], prs: [{ number: 42, title: 'Add filter' }] })
  expect(data?.history).toHaveLength(1)
  const flag = flagOf(writes) as Record<string, unknown>
  expect(flag.history).toBeUndefined()
  expect(flag.prs).toBeUndefined()
  expect(flag.note).toBeUndefined()
})

test('session data: a resume brings back the history, the PRs, the note and the context samples', async ($, on) => {
  const writes = new Map<string, string>()
  const dataFile = JSON.stringify({
    history: [entry('a9', 'implementer', NOW - 30_000)],
    prs: [SAVED_PR],
    note: 'ask Anna',
    ctxRounds: [100_000, 200_000],
    ctxSamples: [100_000, 200_000],
  })
  world(on, { writes, dataFile })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mountPane($)
  expect((await ui.find({ key: 'history' }))?.text).toBe('HISTORY · 1 ▸')
  expect((await ui.find({ type: 'Input', key: 'note' }))?.props.value).toBe('ask Anna')
  await ui.press({ key: 'tab:work' })
  expect(rowTexts(await ui.drawn())).toContain('PR · 1')
  await ui.unmount()
  // written back as it was read
  expect(dataOf(writes)).toMatchObject({ note: 'ask Anna', ctxRounds: [100_000, 200_000], ctxSamples: [100_000, 200_000], prs: [SAVED_PR] })
})

test('session data: a state file from before the data file hands its history and PRs over, once', async ($, on) => {
  const writes = new Map<string, string>()
  const history = [entry('a9', 'implementer', NOW - 30_000)]
  world(on, { writes, stateFile: JSON.stringify({ open: false, tab: 'work', history, prs: [SAVED_PR] }) })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(dataOf(writes)).toEqual({ history, prs: [SAVED_PR], ctx: LIVE_CTX })
  const flag = flagOf(writes) as Record<string, unknown>
  expect(flag.history).toBeUndefined()
  expect(flag.prs).toBeUndefined()
  expect(flag.tab).toBe('work')
})

test('session data: once the data file exists the old place is never read again, even with its fields empty', async ($, on) => {
  world(on, {
    dataFile: JSON.stringify({ history: [], prs: [] }),
    stateFile: JSON.stringify({ open: false, tab: 'work', history: [entry('a9', 'implementer', NOW - 30_000)], prs: [SAVED_PR] }),
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mountPane($)
  expect(await ui.find({ key: 'history' })).toBeUndefined()
  expect(rowTexts(await ui.drawn()).some(r => /^PR ·/.test(r))).toBe(false)
  await ui.unmount()
})

test('session data: a field of the wrong shape is left out, never thrown', async ($, on) => {
  const writes = new Map<string, string>()
  world(on, { writes, dataFile: JSON.stringify({ history: 'x', prs: {}, note: 42, ctxRounds: ['a', -1], ctxSamples: null }) })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(dataOf(writes)).toEqual({ history: [], prs: [], ctx: LIVE_CTX })
})

test('session data: the end of the session writes the note into the data file; a snapshot of another session writes none', async ($, on) => {
  let id = 's-1'
  const writes = new Map<string, string>()
  world(on, { sessionId: () => id, writes })
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mountPane($)
  await ui.input({ key: 'note', text: 'keep me', kind: 'change' })
  await ui.unmount()
  id = 's-2'
  await $.session.end({ reason: 'clear', sessionId: 's-1', resume: { id: 's-1' } })
  expect(dataOf(writes)).toMatchObject({ note: 'keep me' })
  const text = () => writes.get([...writes.keys()].find(k => DATA.test(k)) ?? '')
  const before = text()
  await $.session.end({ reason: 'clear', sessionId: 's-1', resume: { id: 's-1' } }) // nothing owns the snapshot now
  expect(text()).toBe(before)
})

// ── Phase 6: alerts ──

test('alerts: context at 80 % toasts once per episode, and again once it cleared', async ($, on) => {
  const toasts: string[] = []
  world(on, { toasts })
  on('session.measure', (_, e) => ({ changed: e.changed }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(toasts).toEqual([])
  const measure = (percent: number) => $.session.measure({ context: { window: 1_000_000, tokens: percent * 10_000, percent }, rateLimits: [], cost: { usd: 5 }, changed: ['context'] })
  await measure(85)
  expect(toasts).toEqual(['context at 85%'])
  await measure(90)
  await measure(81)
  expect(toasts).toHaveLength(1) // the same episode
  await measure(40) // cleared
  await measure(82)
  expect(toasts).toEqual(['context at 85%', 'context at 82%'])
})

test('alerts: a context under 80 % at the start of a session toasts nothing', async ($, on) => {
  const toasts: string[] = []
  world(on, { toasts, ctxPercent: 79 })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(toasts).toEqual([])
})

test('alerts: 5h credits at 10 % left or less toast once; the 7d window does not count', async ($, on) => {
  const toasts: string[] = []
  world(on, { toasts, rateLimits: [{ kind: 'five_hour', percentUsed: 50 }, { kind: 'seven_day', percentUsed: 99 }] })
  on('session.measure', (_, e) => ({ changed: e.changed }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(toasts).toEqual([]) // the 7d window at 99 % is no cause
  const measure = (used: number) => $.session.measure({ context: { window: 1_000_000, tokens: 1, percent: 1 }, rateLimits: [{ kind: 'five_hour', percentUsed: used }], cost: { usd: 5 }, changed: ['rateLimits'] })
  await measure(92)
  expect(toasts).toEqual(['credits 5h: 8% left'])
  await measure(95)
  expect(toasts).toHaveLength(1)
  await measure(50)
  await measure(91)
  expect(toasts).toEqual(['credits 5h: 8% left', 'credits 5h: 9% left'])
})

test('alerts: a subagent that failed toasts once; one that answered does not', async ($, on) => {
  const toasts: string[] = []
  world(on, { toasts })
  spawns(on)
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await spawnAgent($, 'reviewer')
  await spawnAgent($, 'writer')
  await finishAgent($, 'a2', 'answer')
  expect(toasts).toEqual([])
  await finishAgent($, 'a1', 'error')
  expect(toasts).toEqual(['subagent reviewer failed'])
})

test('alerts: PR checks that turned red toast once; green and red again is a new episode', async ($, on) => {
  const toasts: string[] = []
  const options: World = { toasts, branch: 'feature/orders-filter', remote: GH_SSH, pr: 42, prExtra: { statusCheckRollup: CHECKS } }
  const clock = world(on, options)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await settleAll()
  expect(toasts).toEqual(['PR #42: checks failing'])
  await clock.advance(5 * MIN + 30_000) // read again, still red: the same episode
  await settleAll()
  expect(toasts).toHaveLength(1)
  options.prExtra = { statusCheckRollup: [{ __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SUCCESS' }] }
  await clock.advance(5 * MIN + 30_000)
  await settleAll()
  options.prExtra = { statusCheckRollup: CHECKS }
  await clock.advance(5 * MIN + 30_000)
  await settleAll()
  expect(toasts).toEqual(['PR #42: checks failing', 'PR #42: checks failing'])
})

test('alerts: what a session was resumed with is not news: a saved red PR toasts nothing', async ($, on) => {
  const toasts: string[] = []
  const prs = [{ number: 8, title: 'Checks', state: 'open', isDraft: false, checks: { passed: 1, failed: 1, pending: 0 } }]
  world(on, { toasts, dataFile: JSON.stringify({ history: [], prs }) })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await settleAll()
  expect(toasts).toEqual([])
})

// ── Phase 6: quick note ──

/** The keys of the drawn tree in drawing order. */
const keysInOrder = (el: unknown): string[] => {
  if (typeof el === 'string') return []
  const o = el as { props?: { key?: string }; children?: unknown[] } | null
  return [...(o?.props?.key ? [o.props.key] : []), ...(o?.children ?? []).flatMap(keysInOrder)]
}

test('note: an Input of two rows sits under the tab bar, on every tab, and holds the note', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mountPane($)
  const input = await ui.find({ type: 'Input', key: 'note' })
  expect(input?.props.rows).toBe(2)
  expect(input?.props.value).toBe('')
  const keys = keysInOrder(await ui.drawn())
  expect(keys.indexOf('note')).toBeGreaterThan(keys.indexOf('tab:system'))
  expect(keys.indexOf('note')).toBeLessThan(keys.indexOf('bar:compact'))
  await ui.press({ key: 'tab:work' })
  expect(await ui.find({ type: 'Input', key: 'note' })).toBeDefined()
  await ui.input({ key: 'note', text: 'ask Anna\nabout the filter', kind: 'change' })
  expect((await ui.find({ type: 'Input', key: 'note' }))?.props.value).toBe('ask Anna\nabout the filter')
  await ui.unmount()
})

test('note: send appends the note to the prompt box and clears it; with no note there is no button', async ($, on) => {
  const fills: { text: string; mode?: string }[] = []
  const writes = new Map<string, string>()
  const clock = world(on, { fills, writes })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mountPane($)
  expect(await ui.find({ key: 'bar:note' })).toBeUndefined()
  await ui.input({ key: 'note', text: 'ask Anna', kind: 'change' })
  expect((await ui.find({ key: 'bar:note' }))?.text).toBe('send')
  await ui.press({ key: 'bar:note' })
  await settleAll()
  expect(fills).toEqual([{ text: 'ask Anna', mode: 'append' }])
  expect((await ui.find({ type: 'Input', key: 'note' }))?.props.value).toBe('')
  expect(await ui.find({ key: 'bar:note' })).toBeUndefined()
  await clock.advance(3000)
  expect(dataOf(writes)?.note).toBeUndefined()
  await ui.unmount()
})

test('note: Enter in the field sends it the same way', async ($, on) => {
  const fills: { text: string; mode?: string }[] = []
  world(on, { fills })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mountPane($)
  await ui.input({ key: 'note', text: 'call back', kind: 'submit' })
  await settleAll()
  expect(fills).toEqual([{ text: 'call back', mode: 'append' }])
  expect((await ui.find({ type: 'Input', key: 'note' }))?.props.value).toBe('')
  await ui.unmount()
})

test('note: a prompt box that refuses the text (a dialog holds the keys) keeps the note', async ($, on) => {
  const fills: { text: string; mode?: string }[] = []
  world(on, { fills, fillRefused: true })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mountPane($)
  await ui.input({ key: 'note', text: 'ask Anna', kind: 'change' })
  await ui.press({ key: 'bar:note' })
  await settleAll()
  expect(fills).toHaveLength(1)
  expect((await ui.find({ type: 'Input', key: 'note' }))?.props.value).toBe('ask Anna')
  await ui.unmount()
})

test('note: the buttons stay in the pane width at 30, 40 and 58 columns with a note to send', async ($, on) => {
  world(on, { dataFile: JSON.stringify({ history: [], prs: [], note: 'ask Anna' }) })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  for (const columns of [30, 40, 58]) {
    const ui = await mountPane($, columns)
    expect(await ui.find({ key: 'bar:note' })).toBeDefined()
    for (const key of ['bar:compact', 'bar:worklog', 'bar:note']) expect(await ui.find({ key })).toBeDefined()
    await ui.unmount()
  }
})

// ── Phase 6: phase 5 follow-ups ──

test('follow-up: a monitor stopped before it reached its spawn leaves no child running', async ($, on) => {
  const m = fakeMonitor(on)
  world(on)
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await openCockpit($)
  const ui = await mountPane($, 50)
  await settleAll()
  await ui.press({ key: 'tab:system' })
  await $.session.end({ reason: 'clear', sessionId: 's-1', resume: { id: 's-1' } }) // stops the monitor the press was still starting
  await sleep(100)
  await settleAll()
  expect(m.stops).toBe(m.spawns.length) // none started, or every one started was stopped
  await ui.unmount()
})

test('follow-up: after a monitor crash the readings are forgotten when the tab is left; the next visit starts from none', async ($, on) => {
  const m = fakeMonitor(on)
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await openCockpit($)
  const ui = await mountPane($, 50)
  await settleAll()
  await ui.press({ key: 'tab:system' })
  await until(() => m.spawns.length === 1)
  m.push(FULL_LINE)
  await until(() => m.queue.length === 0)
  m.end()
  await until(() => m.stops === 1)
  await settleAll()
  expect(rowTexts(await ui.drawn())).toContain('CPU  unavailable')
  m.isEnded = false
  await ui.press({ key: 'tab:context' })
  await settleAll()
  await ui.press({ key: 'tab:system' })
  await until(() => m.spawns.length === 2)
  await settleAll()
  const rows = rowTexts(await ui.drawn())
  expect(rows).toContain('reading…')
  expect(rows).not.toContain('CPU  unavailable')
  await ui.unmount()
})

test('follow-up: opening the pane on the Context tab while the exact count runs reads no summary', async ($, on) => {
  const h = holds()
  const usageCalls: (string | undefined)[] = []
  world(on, { usageCalls, holdUsage: h.holdUsage, stateFile: JSON.stringify({ open: false, tab: 'context' }), breakdown: { categories: CONTEXT_ROWS, totalTokens: 98_000, rawMaxTokens: 1_000_000 } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 50)
  const summaries = () => usageCalls.filter(c => c === 'summary').length
  const releaseFull = h.hold('full')
  await ui.press({ key: 'ctx:exact' })
  const before = summaries()
  await openCockpit($)
  await settleAll()
  expect(summaries()).toBe(before)
  releaseFull()
  await settleAll()
  await ui.unmount()
})

test('follow-up: an exact count that never answers is released after a timeout, so the Context tab reads again', async ($, on) => {
  const h = holds()
  const usageCalls: (string | undefined)[] = []
  const clock = world(on, { usageCalls, holdUsage: h.holdUsage, breakdown: { categories: CONTEXT_ROWS, totalTokens: 98_000, rawMaxTokens: 1_000_000 } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 50)
  const summaries = () => usageCalls.filter(c => c === 'summary').length
  await ui.press({ key: 'tab:context' })
  await settleAll()
  const releaseFull = h.hold('full') // never answers, until the end of the test
  await ui.press({ key: 'ctx:exact' })
  const before = summaries()
  await ui.press({ key: 'tab:agents' })
  await ui.press({ key: 'tab:context' })
  await settleAll()
  expect(summaries()).toBe(before) // still counting
  await clock.advance(61_000)
  await ui.press({ key: 'tab:agents' })
  await ui.press({ key: 'tab:context' })
  await settleAll()
  expect(summaries()).toBe(before + 1) // released
  releaseFull()
  await settleAll()
  await ui.unmount()
})

// ── Cockpit v3.1, phase 7: English, last-known values, round duration, adaptive bars, processes, context, alert seed ──

const RL_FILE = '.statusline-rate-limits.json'
const rlCache = (five: number, seven: number) =>
  JSON.stringify({ five_hour: { used_percentage: five, resets_at: NOW / 1000 + 3600 }, seven_day: { used_percentage: seven, resets_at: NOW / 1000 + 3 * 86400 } })
const measureWith = ($: Engine, percent: number, rateLimits: { kind: string; percentUsed: number; resetsAt?: string }[] = []) =>
  $.session.measure({ context: { window: 1_000_000, tokens: percent * 10_000, percent }, rateLimits, cost: { usd: 5 }, changed: ['context', 'rateLimits'] })

test('English: the tabs, the buttons, the empty state and the titles of every tab are English', async ($, on) => {
  world(on, { notRepo: true })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 58)
  const label = async (key: string) => (await ui.find({ key }))?.text
  expect([await label('tab:agents'), await label('tab:context'), await label('tab:work'), await label('tab:system'), await label('bar:compact'), await label('bar:worklog')]).toEqual(['Subagents', 'Context', 'Work', 'System', 'compact', 'log hours'])
  expect(rowTexts(await ui.drawn()).some(r => r.startsWith('SUBAGENTS · 0 running'))).toBe(true)
  await ui.press({ key: 'tab:work' })
  expect(rowTexts(await ui.drawn())).toContain('nothing to show')
  await ui.unmount()
  const narrow = await mountPane($, 40)
  expect([(await narrow.find({ key: 'tab:agents' }))?.text, (await narrow.find({ key: 'tab:context' }))?.text, (await narrow.find({ key: 'tab:work' }))?.text, (await narrow.find({ key: 'tab:system' }))?.text]).toEqual(['Sub', 'Ctx', 'Wrk', 'Sys'])
  await narrow.unmount()
})

test('last known: before the first live reading the credits come from the status line cache with a dim ~, and a live reading replaces them', async ($, on) => {
  world(on, { rateLimits: [], files: { [RL_FILE]: rlCache(40, 20) } })
  on('session.measure', (_, e) => ({ changed: e.changed }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 50)
  const text = async (re: RegExp) => (await ui.find({ type: 'Text', text: re }))?.text
  expect(await text(/^~60% 5h/)).toMatch(/^~60% 5h ↻ +1h00m$/)
  expect(await text(/^~80% 7d/)).toMatch(/^~80% 7d/)
  await measureWith($, 25, [{ kind: 'five_hour', percentUsed: 30, resetsAt: iso(3600_000) }])
  await settleAll()
  expect(await text(/^ 70% 5h/)).toBeDefined()
  expect(await text(/^~60% 5h/)).toBeUndefined()
  expect(await text(/^~80% 7d/)).toBeUndefined() // the live reading carries no 7d window: none drawn
  await ui.unmount()
})

test('last known: a cache window that is over reads 100 % left with no countdown; a missing cache draws nothing', async ($, on) => {
  world(on, { rateLimits: [], files: { [RL_FILE]: JSON.stringify({ five_hour: { used_percentage: 90, resets_at: NOW / 1000 - 60 } }) } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 50)
  expect((await ui.find({ type: 'Text', text: /^~100% 5h/ }))?.text).toBe('~100% 5h')
  await ui.unmount()
})

test('last known: a resumed session shows the context of its last state with a dim ~ until the engine measures it, and keeps it in its data file', async ($, on) => {
  const writes = new Map<string, string>()
  const clock = world(on, { isFresh: true, writes, dataFile: JSON.stringify({ history: [], ctx: { tokens: 600_000, window: 1_000_000, percent: 60 } }) })
  on('session.measure', (_, e) => ({ changed: e.changed }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 50)
  const text = async (re: RegExp) => (await ui.find({ type: 'Text', text: re }))?.text
  expect(await text(/^~60% 600K\/1M/)).toBe('~60% 600K/1M')
  expect(rowTexts(await ui.drawn()).some(r => /^⚠/.test(r))).toBe(false)
  await measureWith($, 61)
  await settleAll()
  expect(await text(/^ 61% 610K\/1M/)).toBe(' 61% 610K/1M')
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

test('alerts: a session resumed above a threshold raises nothing for it; the first live readings are the seed, a rise later toasts', async ($, on) => {
  const toasts: string[] = []
  world(on, { toasts, ctxPercent: 85, rateLimits: [{ kind: 'five_hour', percentUsed: 95 }], dataFile: JSON.stringify({ history: [] }) })
  on('session.measure', (_, e) => ({ changed: e.changed }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await settleAll()
  expect(toasts).toEqual([])
  await measureWith($, 90, [{ kind: 'five_hour', percentUsed: 96 }])
  expect(toasts).toEqual([])
  await measureWith($, 40, [{ kind: 'five_hour', percentUsed: 50 }])
  await measureWith($, 82, [{ kind: 'five_hour', percentUsed: 93 }])
  expect(toasts).toEqual(['context at 82%', 'credits 5h: 7% left'])
})

test('alerts: a resumed session whose context and credits are measured only after its first response raises nothing for them', async ($, on) => {
  const toasts: string[] = []
  world(on, { toasts, isFresh: true, rateLimits: [], files: { [RL_FILE]: rlCache(95, 10) }, dataFile: JSON.stringify({ history: [], ctx: { tokens: 850_000, window: 1_000_000, percent: 85 } }) })
  on('session.measure', (_, e) => ({ changed: e.changed }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await settleAll()
  expect(toasts).toEqual([]) // the last-known values are shown, never alerted
  await measureWith($, 85, [{ kind: 'five_hour', percentUsed: 95 }])
  expect(toasts).toEqual([])
  await measureWith($, 40, [{ kind: 'five_hour', percentUsed: 50 }])
  await measureWith($, 82, [{ kind: 'five_hour', percentUsed: 50 }])
  expect(toasts).toEqual(['context at 82%'])
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

test('System: the bars scale on the window lowest to highest value, a flat window draws low bars, and the highest value is printed after them', async ($, on) => {
  const m = fakeMonitor(on)
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const rows = await sistemaRows($, m, [20, 40, 60].map(cpu => sysLine({ cpu, ram: { used: (cpu / 20) * 4, total: 16 }, net: { rx: (cpu / 20) * 1024 ** 2, tx: 0 } })))
  expect(rows.find(r => /^CPU/.test(r))).toMatch(/^CPU +▁▅█ max 60% +60%$/)
  expect(rows.find(r => /^NET/.test(r))).toMatch(/^NET +▁▅█ max 3\.0M\/s +↓3\.0M\/s ↑0B\/s$/)
  expect(rows.find(r => /^RAM/.test(r))).toMatch(/^RAM +▁▅█ max 75% +/)
})

test('System: every process is listed with pid, name, CPU, RAM and its ports as links to localhost, in the order the monitor sent them, with no row count cap', async ($, on) => {
  const m = fakeMonitor(on)
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const many = Array.from({ length: 9 }, (_, n) => ({ pid: 100 + n, name: `proc${n}`, ports: [], cpu: 1, ram: 1024 ** 2 }))
  const procs = [{ pid: 7240, name: 'node', ports: [3000, 5173], cpu: 12, ram: 180 * 1024 ** 2 }, { pid: 7000, name: 'bash', ports: [], cpu: 0.4, ram: 12 * 1024 ** 2 }, ...many]
  await openCockpit($)
  const ui = await mountPane($, 50)
  await settleAll()
  await ui.press({ key: 'tab:system' })
  await until(() => m.spawns.length > 0)
  m.push(sysLine({ procs }))
  await until(() => m.queue.length === 0)
  await settleAll()
  const rows = rowTexts(await ui.drawn())
  expect(rows).toContain('PROCESSES · 11')
  expect(rows.some(r => /^ +7240 node +12% +180M :3000 :5173$/.test(r))).toBe(true)
  expect(rows.some(r => /^ +7000 bash +0\.4% +12M$/.test(r))).toBe(true)
  expect(rows.filter(r => /proc\d +1\.0% +1\.0M$/.test(r))).toHaveLength(9)
  expect((await ui.findAll({ type: 'Link' })).map(l => l.props.href)).toEqual(['http://localhost:3000', 'http://localhost:5173'])
  expect(rows.some(r => /^… \+\d/.test(r))).toBe(false)
  await ui.unmount()
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
  expect(rows.find(r => /^■ System prompt/.test(r))).toMatch(/^■ System prompt +9\.5k +1% ✓$/)
  expect(rows.find(r => /^■ Messages/.test(r))).toMatch(/^■ Messages +95k +10% +\+5k$/) // from the summary read of the reopened tab, 90k
  expect(rows.some(r => /^CONTEXT · 104\.5K\/1M/.test(r))).toBe(true)
  expect((await ui.find({ key: 'ctx:exact' }))?.text).toBe('exact count') // the button stays
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

test('System: a flat window draws the lowest bars, never noise', async ($, on) => {
  const m = fakeMonitor(on)
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const rows = await sistemaRows($, m, [30, 30, 30].map(cpu => sysLine({ cpu })))
  expect(rows.find(r => /^CPU/.test(r))).toMatch(/^CPU +▁▁▁ max 30% +30%$/)
})

// ── Phase 8: the v2 header and the pane's two languages ──

const IT_FILE = { 'cockpit.json': '{"lang":"it"}' }

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
  expect(rows[context + 1]).toBe(' ')
  expect(rows[context + 2]).toMatch(/^[▰▱]+ 25% 248K\/1M$/)
  expect(rows[credits]).toBe('CREDITSvs expected 7d  \u22125%')
  expect(rows[credits - 1]).toBe(' ')
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
    tabs: ['Subagents', 'Context', 'Work ●', 'System'],
    buttons: { compact: 'compact', worklog: 'log hours' },
    header: [/^CONTEXT/, /^CREDITS/, /vs expected 7d/],
    byTab: { agents: [/^SUBAGENTS · 0 running/], context: [/^CONTEXT · 248K\/1M/], work: [/^MAIN$/, /^CHANGES · 0$/, /^no changes$/, /^● worklog: 1d to log/], system: [/^SYSTEM$/, /^reading…$/] },
  },
  {
    name: 'Italian',
    files: IT_FILE,
    tabs: ['Subagenti', 'Contesto', 'Lavoro ●', 'Sistema'],
    buttons: { compact: 'compatta', worklog: 'segna ore' },
    header: [/^CONTESTO/, /^CREDITI RESIDUI/, /vs atteso 7d/],
    byTab: { agents: [/^SUBAGENTI · 0 in corso/], context: [/^CONTESTO · 248K\/1M/], work: [/^PRINCIPALE$/, /^MODIFICHE · 0$/, /^nessuna modifica$/, /^● worklog: 1g da registrare/], system: [/^SISTEMA$/, /^lettura…$/] },
  },
]

for (const language of LANGUAGES) {
  test(`${language.name}: the tabs, buttons, header and every tab's titles at 58 columns`, async ($, on) => {
    world(on, { files: language.files, hasWorklog: true })
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

    // the whole tab bar fits one row: the long labels, not the short ones
    const { labels, cells } = await tabsAt($, 58)
    expect(labels).toEqual(language.tabs)
    expect(cells).toBeLessThanOrEqual(56)
    const ui = await mountPane($, 58)
    expect((await ui.find({ key: 'bar:compact' }))?.text).toBe(language.buttons.compact)
    expect((await ui.find({ key: 'bar:worklog' }))?.text).toBe(language.buttons.worklog)
    await ui.unmount()

    for (const [tab, patterns] of Object.entries(language.byTab)) {
      const { rows } = await paneRows($, 58, tab)
      for (const re of [...language.header, ...patterns]) expect(rows.some(r => re.test(r))).toBe(true)
    }
  })
}

test('language: cockpit.json names it; a missing, unreadable, malformed or unknown one is English, and every session start reads it again', async ($, on) => {
  const options: World = { files: IT_FILE }
  world(on, options)
  const tabs = async () => (await tabsAt($, 58)).labels
  const start = () => $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  await start()
  expect(await tabs()).toEqual(['Subagenti', 'Contesto', 'Lavoro', 'Sistema'])

  options.files = { 'cockpit.json': '{"lang":"fr"}' }
  await start()
  expect(await tabs()).toEqual(['Subagents', 'Context', 'Work', 'System'])

  options.files = IT_FILE
  await start()
  expect(await tabs()).toEqual(['Subagenti', 'Contesto', 'Lavoro', 'Sistema'])
  options.files = {}
  options.unreadable = ['cockpit.json']
  await start()
  expect(await tabs()).toEqual(['Subagents', 'Context', 'Work', 'System'])

  options.files = IT_FILE
  options.unreadable = undefined
  await start()
  expect(await tabs()).toEqual(['Subagenti', 'Contesto', 'Lavoro', 'Sistema'])
  options.files = { 'cockpit.json': '{ "lang": ' }
  await start()
  expect(await tabs()).toEqual(['Subagents', 'Context', 'Work', 'System'])
})

test('language: the toasts are in the language of the pane', async ($, on) => {
  const toasts: string[] = []
  world(on, { toasts, files: IT_FILE })
  on('session.measure', (_, e) => ({ changed: e.changed }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.measure({ context: { window: 1_000_000, tokens: 850_000, percent: 85 }, rateLimits: [], cost: { usd: 5 }, changed: ['context'] })
  expect(toasts).toEqual(['contesto al 85%'])
})
