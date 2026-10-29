import { mock } from 'claude-code/testing'
import type { AgentStatus, On, SessionContextBreakdown } from 'claude-code'

export const NOW = Date.parse('2026-10-22T10:00:00Z')
/** An ssh `origin` URL of GitHub (joined, so the text is not read as an e-mail address). */
export const GH_SSH = ['git', 'github.com:example/orders.git'].join('@')
export const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString()

export const PANE = {
  plugin: 'cockpit',
  component: 'Pane',
  requestId: 'cockpit',
  props: { title: 'cockpit', isFocused: false, bodyColumns: 50, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

/** The text of the pane's top-level rows, in order (an empty row reads ' '). */
export const rowTexts = (root: unknown): string[] => {
  const text = (el: unknown): string => {
    if (typeof el === 'string') return el
    const o = el as { text?: string; props?: { display?: string }; children?: unknown[] } | null
    if (o?.props?.display === 'none') return ''
    // the CTX bar's surface module draws the cells it is handed (its glow changes their colour, not their text)
    const client = (el as { type?: string; props?: { props?: { cells?: { t: string }[] } } } | null)
    if (client?.type === 'Client') return (client.props?.props?.cells ?? []).map(c => c.t).join('')
    // the System tab's numbers are items of a wrapping Box with a gap of two cells
    const gap = (o as { props?: { flexWrap?: string; columnGap?: number } } | null)?.props
    return o?.text ?? (o?.children ?? []).map(text).join(gap?.flexWrap === 'wrap' && gap.columnGap === 2 ? '  ' : '')
  }
  return ((root as { children?: unknown[] }).children ?? []).map(text)
}

/** Lets what a hook left running (the unawaited flag write of a first render) settle. */
declare const setTimeout: (fn: () => void, ms: number) => unknown // the test runtime has it; the module's types do not
export const settle = () => new Promise<void>(resolve => setTimeout(resolve, 0))

export type World = {
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
  /** True: `skills/worklog/SKILL.md` does not exist in the config directory (the kit installed without the worklog). */
  noWorklogSkill?: boolean
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
  /** True: `session.compact` stands (the conversation compacted) instead of being skipped. */
  compacts?: boolean
  /** Receives the `instructions` of every `session.compact`. */
  instructions?: (string | undefined)[]
  /** Receives the line of every `command.run` (`/<command> <args>`). */
  commands?: string[]
  /** The text of this branch's deliver perimeter file (`<git-dir>/deliver/perimeter.md`). */
  perimeter?: string
  /** The session's cwd, also the top level `git rev-parse` answers (`/work/example-repo` when not given). */
  cwd?: string
  /** The branch `git status` reports (`feature/x` when not given). */
  branch?: string
  /** The URL of remote `origin`; absent, the repository has no remote. */
  remote?: string
  /** The repo's default branch, as `origin/HEAD` names it; absent, `origin/HEAD` is not set. */
  defaultBranch?: string
  /** The number `gh pr view` answers; absent, gh answers that the branch has no PR. */
  pr?: number
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
  /** True: with no `cockpit.json` among `files` the pane opens at session start; absent, the world's own file says `autoOpen: false`. */
  isAutoOpen?: boolean
  /** Extra fields of the `gh pr view` answer (title, url ...). */
  prExtra?: Record<string, unknown>
  /** The list `az repos pr list` answers; absent, az answers an empty list. */
  azPr?: readonly unknown[]
  /** What `gh pr view <number or url>` answers for a saved PR, by that argument; one not listed fails. */
  ghViews?: Record<string, unknown>
  /** What `az repos pr show --id <n>` answers, by id; one not listed fails. */
  azShow?: Record<string, unknown>
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
  /** What `$.prompt.read()` answers as the draft in the prompt box; absent, an empty box. */
  promptText?: string
  /** True: `$.prompt.read()` fails. */
  promptReadFails?: boolean
  /** The commit `git merge-base HEAD <default branch>` answers; absent, there is none (the branch has no default branch to count from). */
  mergeBase?: string
  /** Receives the arguments (joined by spaces, after the `-C <dir> --no-optional-locks` prefix) of every git call that reads the Work tab. */
  repoCalls?: string[]
}

/** The harness reports a path in the host's own spelling (backslashes on Windows): compared by its tail. */
const FLAG = /cockpit-s-1\.json$/
export const DATA = /cockpit-data-s-1\.json$/

/** The world beneath the plugin: what the engine would answer to the calls the mod makes. */
export function world(on: On, options: World = {}) {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on, options.store)
  mock.env(on, options.env ?? { CLAUDE_CONFIG_DIR: '/cfg' })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: options.sessionId?.() ?? 's-1' }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.cwd', () => ({ value: options.cwd ?? '/work/example-repo' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('settings.read', () => ({ value: { effortLevel: 'high' } }))
  on('session.usage', async (_, e) => {
    options.usageCalls?.push(e.breakdown)
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
    // the answer is fixed when the read starts: a held read answers with what the world held then
    if (e.breakdown !== undefined) await options.holdUsage?.(e.breakdown)
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
      // `gh pr view <number or url> ...`: a saved PR read again by what the test says it is now
      if (e.argv[3] !== undefined && e.argv[3] !== '--json' && options.ghViews) {
        const now = options.ghViews[e.argv[3]]
        return now === undefined ? answer('', 1) : answer(JSON.stringify(now))
      }
      return options.pr === undefined
        ? answer('', 1)
        : answer(JSON.stringify({ number: options.pr, title: 'Fix the orders filter', ...options.prExtra }))
    }
    // On Windows the mod starts az through cmd, the way a shell would resolve az.cmd.
    if (e.argv[0] === 'az' || (e.argv.slice(0, 4).join(' ') === 'cmd /d /s /c' && e.argv[4] === 'az')) {
      options.azCalls?.push(e.argv.join(' '))
      options.azEnvs?.push(e.init?.env)
      if (options.noAz) throw new Error('spawn az ENOENT')
      // `az repos pr show --id <n>`: one record, by the id
      if (e.argv.includes('show')) {
        const now = options.azShow?.[e.argv[e.argv.indexOf('--id') + 1] ?? '']
        return now === undefined ? answer('', 1) : answer(JSON.stringify(now))
      }
      return answer(JSON.stringify(options.azPr ?? []))
    }
    if (options.notRepo) return answer('', 128)
    if (e.argv.includes('merge-base')) return options.mergeBase === undefined ? answer('', 1) : answer(`${options.mergeBase}
`)
    if (e.argv.includes('diff') || e.argv.includes('ls-files')) options.repoCalls?.push(e.argv.slice(4).join(' '))
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
      return answer(`${options.isLinkedWorktree ? '/work/example-repo/.git/worktrees/wt' : '.git'}\n.git\n${options.cwd ?? '/work/example-repo'}\n`)
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
    // Most tests open the pane themselves: unless one asks for the default (`isAutoOpen`), the world's cockpit.json keeps it closed at start.
    if (e.path.endsWith('cockpit.json') && !options.isAutoOpen) return { value: '{"autoOpen":false}' }
    return {
      value: options.hasWorklog ? JSON.stringify({ day: '2026-10-22', auditMtime: 5, pending: [{ date: '2026-10-20' }], underTarget: [] }) : '{}',
    }
  })
  on('fs.stat', (_, e) => {
    if (options.noWorklogSkill && /skills[\\/]worklog[\\/]SKILL\.md$/.test(e.path)) throw new Error('ENOENT: no such file or directory')
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
    return options.compacts ? { messages: [{ role: 'user', text: 'summary', toolUses: [] }] } : { skip: 'test' }
  })
  on('command.run', { command: 'worklog' }, (_, e) => {
    options.commands?.push(`/${e.command} ${e.args}`)
    return { text: 'ok' }
  })
  on('command.run', { command: 'retro' }, (_, e) => {
    options.commands?.push(`/${e.command}${e.args ? ` ${e.args}` : ''}`)
    return { text: 'ok' }
  })
  on('ui.toast', (_, e) => {
    options.toasts?.push(e.text)
    return { value: undefined }
  })
  on('prompt.read', () => {
    if (options.promptReadFails) throw new Error('no prompt box')
    return { value: { text: options.promptText ?? '', cursor: (options.promptText ?? '').length } }
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
export const flagOf = (writes: Map<string, string>): unknown => {
  const path = [...writes.keys()].find(k => FLAG.test(k))
  return JSON.parse((path && writes.get(path)) || 'null')
}

/** The session data file as last written, parsed; null when none was written. */
export const dataOf = (writes: Map<string, string>): Record<string, unknown> | null => {
  const path = [...writes.keys()].find(k => DATA.test(k))
  return JSON.parse((path && writes.get(path)) || 'null')
}
