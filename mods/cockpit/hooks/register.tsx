import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type {
  CockpitAgent,
  CockpitAlm,
  CockpitChange,
  CockpitClaudeState,
  CockpitHistoryEntry,
  CockpitNote,
  CockpitPerimeterCheck,
  CockpitPr,
  CockpitSnapshot,
  CockpitTab,
  CockpitTask,
  CockpitUsage,
  CockpitWorkflowRun,
} from '../types'
import {
  AGENT_KEEP_MS,
  CTX_SAMPLES_KEEP,
  NOTE_MAX,
  ROUNDS_KEEP,
  activeAlerts,
  addHistory,
  additionsDiff,
  addUsage,
  azArgv,
  azureRepo,
  capDiff,
  checkPerimeter,
  compactInstructions,
  contextOf,
  diffHunks,
  isAzureRemote,
  historyTokens,
  isDefaultBranch,
  isGithubRemote,
  newTokens,
  parseAzurePr,
  parseCreatedPr,
  parseDefaultBranch,
  parseDoneClaims,
  parseGitStatus,
  parseGithubPr,
  parseCounts,
  parseCtx,
  parseHistory,
  parseNotes,
  parseNumstat,
  parsePerimeter,
  parseRateCache,
  parseSavedPrs,
  parseSysLine,
  parseWorktree,
  recordCall,
  recordCtxSample,
  recordRound,
  recordSystem,
  resolveAlm,
  savedTab,
  settleUsage,
  staticOf,
  stateAfterWait,
  systemOff,
  tabNeeds,
  toHistory,
  toolArg,
  upsertPr,
  usageOf,
  withAgentTokens,
  withDeltas,
  withStatic,
  worklogDays,
} from './format'
import type { WorklogSnapshot } from './format'
import { DIFF_PANE, INITIAL, PANE } from './state'
import { langOf, setLang, t } from './strings'
import type { DiffActions, PaneActions } from './view'
import { PANE_MAX_COLUMNS, agentCounts, diffView, paneView, taskCounts } from './view'

// The clock tiers: fast for elapsed times, medium for git, slow for what moves rarely (and the state file's heartbeat).
const FAST_MS = 2000
const MEDIUM_MS = 10_000
const SLOW_MS = 30_000
/** The pull request (and the repo's default branch) of a branch is read again after this long. */
const PR_EVERY_MS = 5 * 60_000
/** The Work tab keeps this many changed files; it draws 8 of them. */
const REPO_FILES_KEEP = 50
/** A burst of main turns ends in one read of the context breakdown, this long after the first. */
const CONTEXT_DEBOUNCE_MS = 2000
/** An exact count that has not answered after this long is given up on; the Context tab reads summaries again, and a late answer older than the summary read since is discarded. */
const COUNT_TIMEOUT_MS = 60_000

// The scan that checks `$.state` references reads the atom from the file that uses it.
const snapshot = atom({ plugin: 'cockpit', key: 'snapshot' } as const, INITIAL)

/** Writes `next(current)`, unless it equals the current value: a no-op must not redraw the readers. */
async function patch($: EngineInterface, next: (s: CockpitSnapshot) => CockpitSnapshot): Promise<void> {
  // After a session's end (a /clear, a resume) no session start follows: the first change under another id adopts it.
  await adoptSession($).catch(() => undefined)
  const current = await read($, snapshot)
  if (JSON.stringify(next(current)) === JSON.stringify(current)) return
  await update($, snapshot, next)
  await writeState($)
  await raiseAlerts($)
}

// ── Alerts (D4) ──
// A toast per cause, once per episode: the keys of the causes in force are remembered, and a cause that is gone is forgotten
// (so it can raise again). What a session was adopted with is not news (D5): its first reading of everything only remembers, and so does
// the first live reading of the context and of the credits (a resumed session is measured only after its first response).
let alerted = new Set<string>()
let alertedSession: string | undefined
/** The causes that still wait for their first live reading to be seeded. */
let unseeded = new Set<string>()

async function raiseAlerts($: EngineInterface): Promise<void> {
  try {
    const s = await read($, snapshot)
    const active = activeAlerts(s)
    const isFirst = alertedSession !== s.sessionId
    const before = alerted
    alertedSession = s.sessionId
    if (isFirst) unseeded = new Set(['context', 'credits'])
    const isLive = (key: string) => (key === 'context' ? s.ctx.percent !== undefined : key === 'credits' && s.rateLimits.some(r => r.kind === 'five_hour'))
    const seeds = new Set(active.filter(a => isFirst || (unseeded.has(a.key) && isLive(a.key))).map(a => a.key))
    for (const key of [...unseeded]) if (isLive(key)) unseeded.delete(key)
    alerted = new Set(active.map(a => a.key))
    for (const a of active) if (!before.has(a.key) && !seeds.has(a.key)) $.ui.toast(a.text)
  } catch {
    // an alert that cannot be raised is lost; observing must never break the change
  }
}

/**
 * Keeps the name of the first workflow among `tasks` (a stop's `background_tasks`) in the snapshot; none clears it. The
 * end of the main loop's turn (`isMainStop`) reporting none also ends the run whose agents were counted: a subagent's stop
 * can report none while the run's other agents still work.
 */
async function setWorkflow($: EngineInterface, tasks: readonly { type: string; name?: string }[] | undefined, isMainStop = false): Promise<void> {
  const workflow = tasks?.find(t => t.type === 'workflow' && typeof t.name === 'string' && t.name !== '')?.name
  const isRunEnd = isMainStop && workflow === undefined
  try {
    const now = await $.clock.now()
    // The run's end is the other way a workflow's agents end, besides their own turn: the engine never lists them.
    await patch($, s => ({
      ...s,
      workflow,
      workflowRun: isRunEnd ? undefined : s.workflowRun,
      agents: isRunEnd ? endRunAgents(s.agents, s.workflowRun, now) : s.agents,
    }))
  } catch {
    // observing must never break the stop
  }
}

/** The agents of `run` still running, finished at `now`. */
function endRunAgents(agents: CockpitAgent[], run: CockpitWorkflowRun | undefined, now: number): CockpitAgent[] {
  const ids = new Set(run?.agents.map(a => a.id))
  return agents.map((a): CockpitAgent => (ids.has(a.id) && a.status === 'running' ? { ...a, status: 'done', endedAt: now } : a))
}

/** `id` joins the run `runId`; an agent of another run than the one kept starts a new count. */
function addWorkflowAgent(run: CockpitWorkflowRun | undefined, runId: string, id: string): CockpitWorkflowRun {
  const kept = run?.runId === runId ? run.agents : []
  return { runId, agents: kept.some(a => a.id === id) ? kept : [...kept, { id, isDone: false }] }
}

/** Marks agent `id` of the run finished; any other id leaves the run as it is. */
function finishWorkflowAgent(run: CockpitWorkflowRun | undefined, id: string): CockpitWorkflowRun | undefined {
  return run?.agents.some(a => a.id === id && !a.isDone) ? { ...run, agents: run.agents.map(a => (a.id === id ? { ...a, isDone: true } : a)) } : run
}

// ── Collection helpers (each one swallows its own failure: a missing datum stays absent) ──

/** The entries of the deliver perimeter in git directory `gitDir` (relative to `cwd` as rev-parse prints it), when it is active for `branch`. */
async function readPerimeter($: EngineInterface, cwd: string, gitDir: string, branch: string): Promise<string[] | undefined> {
  try {
    const dir = /^([A-Za-z]:)?[\\/]/.test(gitDir) ? gitDir : `${cwd}/${gitDir}`
    const text = await $.fs.read(`${dir}/deliver/perimeter.md`)
    return typeof text === 'string' ? parsePerimeter(text, branch) : undefined
  } catch {
    return undefined
  }
}

/**
 * The changed files of the worktree at `root` against HEAD (tracked, then untracked and not ignored) and those the
 * perimeter `entries` do not cover, the way `hooks/scope-guard.js --check HEAD` lists them; undefined when git cannot say.
 */
async function readPerimeterCheck($: EngineInterface, root: string, entries: readonly string[]): Promise<CockpitPerimeterCheck | undefined> {
  try {
    const base = ['git', '-C', root, '--no-optional-locks']
    const tracked = await $.process.run([...base, 'diff', '--name-only', '--no-renames', '-z', 'HEAD', '--'], { timeoutMs: 3000 })
    const untracked = await $.process.run([...base, 'ls-files', '--others', '--exclude-standard', '-z'], { timeoutMs: 3000 })
    if (tracked.exitCode !== 0 || untracked.exitCode !== 0 || tracked.isStdoutTruncated || untracked.isStdoutTruncated) return undefined
    const names = (out: string) => out.split('\0').filter(Boolean)
    return checkPerimeter([...names(tracked.stdout), ...names(untracked.stdout)], entries)
  } catch {
    return undefined
  }
}

// What the PR read last asked about, and when: the read is repeated for another branch (or ALM target) or after `PR_EVERY_MS`.
let lastPrRead: { key: string; at: number } | undefined
let isPrReading = false

/** A file the Work tab's diff pane draws whole (an untracked one) is at most this big: the engine's `$.fs.read` takes 4 MiB. */
const DIFF_FILE_MAX = 4 * 1024 * 1024

/** The private config folder of the ALM `identity` (`~/.azure-<identity>`, as hooks/lib/az-pin.js picks it), when it exists. */
async function azConfigDir($: EngineInterface, identity: string | undefined): Promise<string | undefined> {
  if (!identity) return undefined
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))
  if (!home) return undefined
  const dir = `${home.replace(/\\/g, '/')}/.azure-${identity}`
  const stat = await $.fs.stat(dir).catch(() => undefined)
  return stat?.kind === 'dir' ? dir : undefined
}

/**
 * Runs the Azure CLI with `args`, the way the platform can start it (`azArgv`), against the config folder of the ALM identity
 * when there is one, never the machine-global config. Undefined when the call cannot be made safely.
 */
async function runAz($: EngineInterface, args: readonly string[], cwd: string, alm: CockpitAlm | undefined) {
  // The engine reports no platform: Windows sets `OS` and `ComSpec`.
  const isWindows = (await $.env.get('OS')) === 'Windows_NT' || (await $.env.get('ComSpec')) !== undefined
  const argv = azArgv(args, isWindows)
  if (!argv) return undefined
  const dir = await azConfigDir($, alm?.identity)
  return $.process.run(argv, { cwd, timeoutMs: 20_000, ...(dir && { env: { AZURE_CONFIG_DIR: dir } }) })
}

/**
 * The latest pull request of `branch` on Azure DevOps, open, completed or abandoned: `az repos pr list`, aimed at the org of the ALM line and the project of the remote,
 * never at the CLI's configured default. Undefined without an org, a repository or a project to ask about.
 */
async function readAzurePr($: EngineInterface, cwd: string, branch: string, url: string, alm: CockpitAlm | undefined): Promise<CockpitPr | undefined> {
  const repo = azureRepo(url)
  // The repository lives in the project the remote URL names; the ALM project (where the work items are) is only the fallback.
  const project = repo?.project ?? alm?.project
  if (!alm?.org || !repo || !project) return undefined
  const organization = /^https?:\/\//i.test(alm.org) ? alm.org : `https://dev.azure.com/${alm.org}`
  const args = ['repos', 'pr', 'list', '--organization', organization, '--project', project, '--repository', repo.repo]
  const list = await runAz($, [...args, '--source-branch', `refs/heads/${branch}`, '--status', 'all', '--top', '1', '--output', 'json'], cwd, alm)
  return list?.exitCode === 0 ? parseAzurePr(list.stdout) : undefined
}

/**
 * Reads, in the background (never awaited by a refresh or a render), the repo's default branch from `origin/HEAD` and,
 * off it, the pull request of `branch`: `gh pr view` for a GitHub `origin`, `az repos pr list` for an Azure
 * DevOps one. One found joins the chat's pull requests, or updates its entry there; no CLI, no PR or a failure adds
 * nothing. The result is dropped when the branch has moved on.
 */
async function refreshPr($: EngineInterface, cwd: string, branch: string): Promise<void> {
  const now = await $.clock.now()
  const { alm } = await read($, snapshot)
  const key = `${cwd}\n${branch}\n${alm?.org ?? ''}\n${alm?.project ?? ''}`
  if (isPrReading || (lastPrRead?.key === key && now - lastPrRead.at < PR_EVERY_MS)) return
  isPrReading = true
  lastPrRead = { key, at: now }
  try {
    const base = ['git', '-C', cwd, '--no-optional-locks']
    const head = await $.process.run([...base, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], { timeoutMs: 2000 })
    const defaultBranch = head.exitCode === 0 ? parseDefaultBranch(head.stdout) : undefined
    let pr: CockpitPr | undefined
    // The default branch has no pull request of its own to look for.
    if (!isDefaultBranch(branch, defaultBranch)) {
      const remote = await $.process.run([...base, 'remote', 'get-url', 'origin'], { timeoutMs: 2000 })
      if (remote.exitCode === 0 && isGithubRemote(remote.stdout)) {
        const view = await $.process.run(['gh', 'pr', 'view', '--json', 'number,title,state,isDraft,reviewDecision,statusCheckRollup,url'], { cwd, timeoutMs: 10_000 })
        pr = view.exitCode === 0 ? parseGithubPr(view.stdout) : undefined
      } else if (remote.exitCode === 0 && isAzureRemote(remote.stdout)) {
        pr = await readAzurePr($, cwd, branch, remote.stdout, alm)
      }
    }
    await patch($, s => (s.cwd === cwd && s.git?.branch === branch ? { ...s, defaultBranch, prs: pr ? upsertPr(s.prs, pr) : s.prs } : s))
  } catch {
    // the CLI is missing or too slow: no PR is added, and the next read is in `PR_EVERY_MS`
  } finally {
    isPrReading = false
  }
}

/**
 * The Work tab's reads, only while that tab is selected: the changed files with their line counts (tracked against HEAD,
 * then untracked and not ignored). Every read failing keeps the last reading.
 */
async function refreshRepo($: EngineInterface): Promise<void> {
  try {
    const s = await read($, snapshot)
    const { cwd, git } = s
    if (s.tab !== 'work' || !git?.root) return
    const base = ['git', '-C', git.root, '--no-optional-locks']
    const run = (args: string[]) => $.process.run([...base, ...args], { timeoutMs: 3000 })
    const [tracked, untracked] = await Promise.all([
      run(['diff', '--numstat', '--no-renames', '-z', 'HEAD', '--']),
      run(['ls-files', '--others', '--exclude-standard', '-z']),
    ])
    const isRead = (r: { exitCode: number; isStdoutTruncated: boolean }) => r.exitCode === 0 && !r.isStdoutTruncated
    if (!isRead(tracked) && !isRead(untracked)) return
    const names = isRead(untracked) ? untracked.stdout.split('\0').filter(Boolean) : []
    const files = parseNumstat(isRead(tracked) ? tracked.stdout : '', names)
    const repo = { files: files.slice(0, REPO_FILES_KEEP), total: files.length }
    await patch($, x => (x.cwd === cwd && x.git?.branch === git.branch ? { ...x, repo } : x))
  } catch {
    // git missing or too slow: keep the last reading
  }
}

/**
 * The hunks of `change` to draw: `git diff HEAD -- <file>`, or the whole file as additions when it is untracked.
 * Undefined when they cannot be had: a file over `DIFF_FILE_MAX` or unreadable, a git that failed, was cut or too slow.
 */
async function readHunks($: EngineInterface, root: string, change: CockpitChange): Promise<string | undefined> {
  try {
    if (change.isUntracked) {
      const file = `${root}/${change.path}`
      if ((await $.fs.stat(file)).size > DIFF_FILE_MAX) return undefined
      const text = await $.fs.read(file)
      return typeof text === 'string' ? additionsDiff(change.path, text) : undefined
    }
    const out = await $.process.run(['git', '-C', root, '--no-optional-locks', 'diff', '--no-color', '--no-ext-diff', '--no-renames', 'HEAD', '--', change.path], { timeoutMs: 5000 })
    return out.exitCode === 0 && !out.isStdoutTruncated ? diffHunks(out.stdout) : undefined
  } catch {
    return undefined
  }
}

/** Draws the diff of `change` in the second pane; a file that cannot be had opens it saying so. */
async function showDiff($: EngineInterface, change: CockpitChange): Promise<void> {
  try {
    const { git } = await read($, snapshot)
    if (!git?.root) return
    const hunks = await readHunks($, git.root, change)
    const { text, isCut } = capDiff(hunks ?? '')
    await patch($, s => ({ ...s, diff: { file: change.path, text, ...(isCut && { isCut }), ...(hunks === undefined && { isUnreadable: true }) } }))
    await $.ui.open({ id: DIFF_PANE, title: t().diffTitle(change.path), closeOnEscape: true })
  } catch {
    // the snapshot or the pane failed: the pane stays as it was
  }
}

async function refreshGit($: EngineInterface): Promise<void> {
  try {
    const cwd = await $.session.cwd()
    const base = ['git', '-C', cwd, '--no-optional-locks']
    const status = await $.process.run([...base, 'status', '--porcelain', '-b'], { timeoutMs: 2000 })
    const parsed = status.exitCode === 0 ? parseGitStatus(status.stdout) : undefined
    if (!parsed) {
      return void (await patch($, s => {
        lastPrRead = undefined
        return { ...s, cwd, git: undefined, perimeter: undefined, perimeterCheck: undefined, defaultBranch: undefined, repo: undefined }
      }))
    }
    const tree = await $.process.run([...base, 'rev-parse', '--git-dir', '--git-common-dir', '--show-toplevel'], { timeoutMs: 2000 })
    const worktreeRoot = tree.exitCode === 0 ? parseWorktree(tree.stdout) : undefined
    const [gitDir, , topLevel] = tree.exitCode === 0 ? tree.stdout.split('\n').map(l => l.trim()) : []
    const perimeter = gitDir && !parsed.isDetached ? await readPerimeter($, cwd, gitDir, parsed.branch) : undefined
    const perimeterCheck = perimeter && topLevel ? await readPerimeterCheck($, topLevel, perimeter) : undefined
    await patch($, s => {
      const isSameRepo = s.cwd === cwd
      const isSameBranch = isSameRepo && s.git?.branch === parsed.branch
      // The PR read belongs to the repository and branch it was asked about: leaving them forgets the read too, decided here,
      // in the patch that clears the default branch, from the state it applies to.
      if (!isSameBranch) lastPrRead = undefined
      return {
        ...s,
        cwd,
        git: { ...parsed, worktreeRoot, root: topLevel || undefined },
        perimeter,
        perimeterCheck,
        defaultBranch: isSameRepo ? s.defaultBranch : undefined,
        repo: isSameRepo ? s.repo : undefined,
      }
    })
    if (!parsed.isDetached) void refreshPr($, cwd, parsed.branch).catch(() => undefined)
    await refreshRepo($)
  } catch {
    // git missing or too slow: keep the last reading
  }
}

async function configDir($: EngineInterface): Promise<string | undefined> {
  const explicit = await $.env.get('CLAUDE_CONFIG_DIR')
  if (explicit) return explicit
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))
  return home ? `${home}/.claude` : undefined
}

/** The language of the pane's texts: the `lang` of `<config dir>/cockpit.json`; a missing or unreadable file is English. */
async function refreshLang($: EngineInterface): Promise<void> {
  try {
    const dir = await configDir($)
    const text = dir ? await $.fs.read(`${dir}/cockpit.json`) : undefined
    setLang(langOf(typeof text === 'string' ? text : ''))
  } catch {
    setLang('en')
  }
}

// ── The statusline's state file ──
// `<configDir>/.cache/cockpit-<sessionId>.json`: what the user's statusline reads to hide itself while the pane is open
// and to show the last turn's cost and the agent counts. Same id rule as the statusline's context snapshot.

const STATE_MIN_MS = 3000
const SESSION_ID = /^[\w-]{1,128}$/

// Not an atom: the first render of a pane that waited undrawn must set it, and a render cannot write state.
// The pane starts closed, `/cockpit` opens it, the person's close shuts it. A reload starts these over.
let isOpen = false
let lastWritten = ''
let lastDataWritten = ''
let lastWriteAt = 0
// When the write timer was scheduled: a timer the engine refuses never runs its callback, so the mark lapses by itself after twice the throttle.
let writeScheduledAt: number | undefined
// The main loop's tools in flight (a `tool.call` seen before its `next` answered), in start order: the header's tool state lasts while any is left.
let mainTools: string[] = []

/**
 * What survives a resume: the session data file `<configDir>/.cache/cockpit-data-<sessionId>.json` holds the agent history, the
 * chat's pull requests, the saved notes, the context samples and the last measured context; the statusline's pruning keeps it while the session's transcript
 * exists. `history` is the one the file is written with (the session's end adds its running agents).
 */
const sessionData = (s: CockpitSnapshot, history: readonly CockpitHistoryEntry[] = s.history ?? []) => {
  const { tokens, window, percent } = s.ctx
  // the live window when the engine measured it, else the one the session was resumed with
  const ctx = tokens !== undefined && window !== undefined && percent !== undefined ? { tokens, window, percent } : s.lastCtx
  return {
    history,
    prs: s.prs ?? [],
    ...(s.notes !== undefined && { notes: s.notes }),
    ...(s.ctxSamples !== undefined && { ctxSamples: s.ctxSamples }),
    ...(s.ctxRounds !== undefined && { ctxRounds: s.ctxRounds }),
    ...(ctx && { ctx }),
  }
}

/**
 * Writes the state file (and the session data file) when its content changed, at most once per `STATE_MIN_MS`: a change inside the window is
 * written when it ends. `isForced` skips the window (open, close, session start). `isHeartbeat` rewrites unchanged
 * content with a fresh `at`: the statusline trusts `open:true` only while `at` is recent. A failure leaves the file as it was.
 */
async function writeState($: EngineInterface, isForced = false, isHeartbeat = false): Promise<void> {
  try {
    const dir = await configDir($)
    const id = await $.session.id()
    if (!dir || !SESSION_ID.test(id)) return
    const s = await read($, snapshot)
    // The snapshot belongs to another session (or none yet): its history is not this id's to write.
    if (s.sessionId !== id) return
    const { usd, startUsd } = s.cost
    const counts = taskCounts(s)
    const content = {
      open: isOpen,
      lastTurnUsd: usd !== undefined && startUsd !== undefined ? Math.round((usd - startUsd) * 100) / 100 : null,
      agents: agentCounts(s),
      effort: typeof s.effort === 'string' ? s.effort : null,
      tasks: counts ? { done: counts.done, total: counts.total } : null,
      tab: s.tab ?? 'agents',
      // the share is a part of the session's tokens: the main loop's and the agents' count survive a reload (the history is cut at 50)
      mainTokens: s.mainTokens,
      agentTokens: s.agentTokens,
    }
    const file = `${dir}/.cache/cockpit-${id}.json`
    const key = `${file} ${JSON.stringify(content)}`
    const dataFile = `${dir}/.cache/cockpit-data-${id}.json`
    const data = JSON.stringify(sessionData(s))
    const dataKey = `${dataFile} ${data}`
    const isStateStale = key !== lastWritten || isHeartbeat
    const isDataStale = dataKey !== lastDataWritten
    if (!isStateStale && !isDataStale) return
    const now = await $.clock.now()
    const wait = STATE_MIN_MS - (now - lastWriteAt)
    if (!isForced && wait > 0) {
      if (writeScheduledAt === undefined || now - writeScheduledAt >= 2 * STATE_MIN_MS) {
        writeScheduledAt = now
        $.clock.after(wait, () => {
          writeScheduledAt = undefined
          void writeState($).catch(() => undefined)
        })
      }
      return
    }
    if (isStateStale) {
      const { open, ...rest } = content
      await $.fs.write(file, JSON.stringify({ open, at: now, ...rest }))
      lastWritten = key
    }
    if (isDataStale) {
      await $.fs.write(dataFile, data)
      lastDataWritten = dataKey
    }
    lastWriteAt = now
  } catch {
    // best-effort: the statusline simply shows what it showed
  }
}

/** What a saved file holds, as an object; undefined for a missing or unreadable file, or any other JSON. */
async function readSaved($: EngineInterface, path: string): Promise<Record<string, unknown> | undefined> {
  try {
    const text = await $.fs.read(path)
    const parsed: unknown = JSON.parse(typeof text === 'string' ? text : '')
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? Object.fromEntries(Object.entries(parsed)) : undefined
  } catch {
    return undefined
  }
}

type Saved = {
  tab?: CockpitTab
  history: CockpitHistoryEntry[]
  prs?: CockpitPr[]
  mainTokens?: number
  agentTokens?: number
  notes?: CockpitNote[]
  ctxSamples?: number[]
  ctxRounds?: number[]
  ctx?: { tokens: number; window: number; percent: number }
}

/**
 * What an earlier run of session `id` left: in its state file the tab (none for a missing file or an unknown one; the v2 Sessione
 * and Repo tabs map to Subagents and Work) and the tokens of the main loop and of the agents that left the list (a file from before
 * that count: the history's sum); in its session data file the agent history, the chat's pull requests, the notes and the context
 * samples. A state file from before the data file still holds the history and the pull requests: a field the data file does not
 * have is read from there, once (the next write moves it).
 */
async function savedState($: EngineInterface, id: string): Promise<Saved> {
  try {
    const dir = await configDir($)
    if (!dir || !SESSION_ID.test(id)) return { history: [] }
    const state = await readSaved($, `${dir}/.cache/cockpit-${id}.json`)
    const data = await readSaved($, `${dir}/.cache/cockpit-data-${id}.json`)
    const count = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined)
    const field = (key: 'history' | 'prs') => (data && key in data ? data[key] : state?.[key])
    const history = parseHistory(field('history'))
    const prs = parseSavedPrs(field('prs'))
    return {
      tab: savedTab(state?.tab),
      history,
      prs: prs.length > 0 ? prs : undefined,
      mainTokens: count(state?.mainTokens),
      agentTokens: count(state?.agentTokens) ?? historyTokens(history),
      notes: parseNotes(data?.notes, data?.note),
      ctxSamples: parseCounts(data?.ctxSamples, CTX_SAMPLES_KEEP),
      ctxRounds: parseCounts(data?.ctxRounds, ROUNDS_KEEP),
      ctx: parseCtx(data?.ctx),
    }
  } catch {
    return { history: [] }
  }
}

/** The snapshot between two sessions: its agents went to the ending session's history, the per-session readings start over, no session owns it. */
const withoutSession = (s: CockpitSnapshot): CockpitSnapshot => ({
  ...s,
  sessionId: undefined,
  agents: [],
  history: [],
  prs: undefined,
  notes: undefined,
  noteDraft: undefined,
  noteEditing: undefined,
  calls: undefined,
  tasks: [],
  cacheShare: undefined,
  mainTokens: undefined,
  mainStepTokens: undefined,
  agentTokens: undefined,
  claudeState: undefined,
  ctxSamples: undefined,
  ctxRounds: undefined,
  // the window is the next session's own: nothing of this one's reading is left to pass for it
  ctx: {},
  lastCtx: undefined,
  lastRoundMs: undefined,
  context: undefined,
  contextSeq: undefined,
  contextStatic: undefined,
  skillsUsed: undefined,
  workflow: undefined,
  workflowRun: undefined,
  system: undefined,
})

/**
 * Makes the snapshot the session the engine answers now: the same id (a reload, an enable, a respawn) changes nothing;
 * another loads that session's saved tab and history. The id of the session that just ended is skipped (the engine
 * answers it until it switches), unless `isStart`: a session start of that same id is a resume.
 */
async function adoptSession($: EngineInterface, isStart = false): Promise<void> {
  const id = await $.session.id()
  const current = await read($, snapshot)
  if (current.sessionId === id || (!isStart && current.endedSessionId === id)) return
  const saved = await savedState($, id)
  await update($, snapshot, s =>
    s.sessionId === id
      ? s
      : { ...withoutSession(s), sessionId: id, endedSessionId: undefined, tab: saved.tab ?? s.tab, history: saved.history, prs: saved.prs, notes: saved.notes, ctxSamples: saved.ctxSamples, ctxRounds: saved.ctxRounds, lastCtx: saved.ctx, mainTokens: saved.mainTokens, agentTokens: saved.agentTokens },
  )
  // The monitor looked for the pid of the session it was started for: another one's gets its own, if the tab is still wanted.
  stopMonitor()
  await syncMonitor($)
}

// ── The System tab's monitor: a child process that lives only while the pane is open on that tab ──

/** The running monitor: its stream (ending the loop that reads it kills the child) and whether it was stopped on purpose. */
type Monitor = { stream?: ReturnType<EngineInterface['process']['spawn']>; isStopped: boolean }
let monitor: Monitor | undefined

/**
 * Runs `sysmon/sysmon.mjs` and keeps what it prints (one JSON line per reading) in the snapshot until it is stopped or ends. A
 * child that cannot start, or ends by itself, leaves every part unavailable: the tab draws `unavailable`, nothing throws.
 */
async function runMonitor($: EngineInterface, m: Monitor): Promise<void> {
  let pending = ''
  try {
    const id = await $.session.id()
    const dir = await configDir($)
    // The tab may have been left while the session id and config folder were read: no child is started for a stopped monitor.
    if (m.isStopped) return
    m.stream = $.process.spawn({
      argv: ['node', `${$.plugin.root}/sysmon/sysmon.mjs`],
      env: { COCKPIT_SESSION_ID: id, ...(dir && { COCKPIT_CONFIG_DIR: dir }) },
    })
    for await (const chunk of m.stream) {
      if (m.isStopped) break
      if (chunk.stream !== 'stdout') continue
      // a line may span two chunks, and a chunk may hold several lines
      const lines = (pending + chunk.text).split('\n')
      pending = lines.pop() ?? ''
      for (const text of lines) {
        const line = parseSysLine(text)
        if (line && !m.isStopped) await patch($, s => ({ ...s, system: recordSystem(s.system, line) })).catch(() => undefined)
      }
    }
  } catch {
    // the child could not start or broke: the parts read as unavailable below
  }
  if (monitor === m) monitor = undefined
  if (!m.isStopped) await patch($, s => ({ ...s, system: systemOff() })).catch(() => undefined)
}

/** Ends the running monitor: the loop that reads it stops, and closing its stream kills the child. */
function stopMonitor(): void {
  const m = monitor
  if (!m) return
  monitor = undefined
  m.isStopped = true
  void m.stream?.return({ code: null, signal: null }).catch(() => undefined)
}

/** The monitor runs exactly while the pane is open on the System tab: started when it is wanted and not running, stopped (and its readings forgotten) when it runs and is not wanted. */
async function syncMonitor($: EngineInterface): Promise<void> {
  try {
    const current = await read($, snapshot)
    const isWanted = isOpen && current.tab === 'system'
    if (isWanted && !monitor) {
      const m: Monitor = { isStopped: false }
      monitor = m
      void runMonitor($, m)
    } else if (!isWanted) {
      // Also with no monitor left: one that crashed left the tab reading "unavailable", which the next visit must not start from.
      stopMonitor()
      if (current.system !== undefined) await patch($, s => ({ ...s, system: undefined }))
    }
  } catch {
    // the snapshot could not be read: the monitor stays as it is
  }
}

async function setOpen($: EngineInterface, value: boolean): Promise<void> {
  isOpen = value
  await adoptSession($).catch(() => undefined)
  await writeState($, true)
  await syncMonitor($)
  // The Context tab is read when it opens: a pane that opens on it (the tab is kept with the session) is the same moment. The
  // read is not waited for: a slow one must not hold the open (or the close) back.
  if (value && (await read($, snapshot)).tab === 'context') void openContext($).catch(() => undefined)
}

async function refreshWorklog($: EngineInterface, now: number): Promise<void> {
  try {
    const dir = await configDir($)
    if (!dir) return
    const text = await $.fs.read(`${dir}/.worklog-pending.json`)
    const parsed: unknown = JSON.parse(typeof text === 'string' ? text : '')
    if (typeof parsed !== 'object' || parsed === null) return
    // Narrowed once here: the file is written by the worklog hook, read as that shape.
    const snap: WorklogSnapshot = parsed
    const audit = await $.fs.stat(`${dir}/worklog/pushed.json`).catch(() => undefined)
    const d = new Date(now)
    const p = (n: number) => String(n).padStart(2, '0')
    const today = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
    const worklog = worklogDays(snap, audit?.mtimeMs, today)
    await patch($, s => ({ ...s, worklog }))
  } catch {
    // no snapshot yet: no badge
  }
}

/** The ALM target of the cwd from `<config>/workspaces.json`; no file or a malformed one clears the line. */
async function refreshAlm($: EngineInterface): Promise<void> {
  try {
    const dir = await configDir($)
    if (!dir) return
    const text = await $.fs.read(`${dir}/workspaces.json`)
    const alm = resolveAlm(JSON.parse(typeof text === 'string' ? text : ''), await $.session.cwd())
    await patch($, s => ({ ...s, alm }))
  } catch {
    // no readable map: no line, and not the last map's
    await patch($, s => ({ ...s, alm: undefined })).catch(() => undefined)
  }
}

// The size and modification time of `done-claim.log` as last read: the log is read again only when either changed.
let lastClaimsStat: { size: number; mtimeMs: number } | undefined

/** The last entries of the done-claim hook's log, read when its size or mtime changed; no readable log clears them. */
async function refreshDoneClaims($: EngineInterface): Promise<void> {
  try {
    const dir = await configDir($)
    if (!dir) return
    const file = `${dir}/.cache/done-claim.log`
    const { size, mtimeMs } = await $.fs.stat(file)
    if (lastClaimsStat?.size === size && lastClaimsStat.mtimeMs === mtimeMs) return
    const text = await $.fs.read(file)
    const claims = parseDoneClaims(typeof text === 'string' ? text : '')
    await patch($, s => ({ ...s, doneClaims: claims.length > 0 ? claims : undefined }))
    lastClaimsStat = { size, mtimeMs }
  } catch {
    lastClaimsStat = undefined
    await patch($, s => ({ ...s, doneClaims: undefined })).catch(() => undefined)
  }
}

/** The rate limits of the status line's cache, kept as the last known ones: drawn with a `~` until the engine reports its own. No readable cache leaves none. */
async function refreshLastRates($: EngineInterface): Promise<void> {
  try {
    const dir = await configDir($)
    if (!dir) return
    const text = await $.fs.read(`${dir}/.statusline-rate-limits.json`)
    const lastRates = parseRateCache(JSON.parse(typeof text === 'string' ? text : ''), await $.clock.now())
    await patch($, s => ({ ...s, lastRates: lastRates.length > 0 ? lastRates : undefined }))
  } catch {
    // no cache yet: nothing to draw until the engine measures
  }
}

async function refreshUsage($: EngineInterface): Promise<void> {
  try {
    const u = await $.session.usage()
    const now = await $.clock.now()
    await patch($, s => ({
      ...s,
      ctx: { ...s.ctx, tokens: u.context.tokens, window: u.context.window, percent: u.context.percent },
      lastCtx: u.context.percent !== undefined ? undefined : s.lastCtx,
      cost: { ...s.cost, usd: u.cost?.usd },
      rateLimits: u.rateLimits,
    }))
  } catch {
    // not measured yet
  }
}

/**
 * Reads the auto-compaction threshold once per session start: a `summary` breakdown estimates locally, it asks the model for
 * nothing. Off, or a failed read, leaves it absent (the header then draws no forecast).
 */
async function refreshAutoCompact($: EngineInterface): Promise<void> {
  try {
    const u = await $.session.usage({ breakdown: 'summary' })
    const autoCompactAt = u.context.breakdown?.autoCompactThreshold
    await patch($, s => ({ ...s, autoCompactAt }))
  } catch {
    // not measured: no forecast
  }
}

// When the breakdown read the Context tab waits for was scheduled, and the exact count in flight (a second press while it runs counts nothing more).
// A timer the engine refuses never runs its callback, so a mark the callback clears could stay for ever: it lapses by itself after twice the debounce.
let contextScheduledAt: number | undefined
// When the exact count in flight started (none: no count runs) and which count it is: one that outlives `COUNT_TIMEOUT_MS` no longer counts as running.
let countingSince: number | undefined
let countRun = 0
// Every context read takes the next number when it starts; the snapshot keeps the number of the reading it holds.
let contextSeq = 0

/**
 * Reads the context breakdown for the Context tab. `summary` estimates locally and is free; `full` counts with the token-count
 * API and so runs only from the button. A failed read leaves the last reading. Reads overlap (an exact count takes seconds): the
 * one asked last wins, so an older answer that arrives after a newer one is dropped; a summary is therefore not read at all while
 * the exact count runs (whoever asks: the tab, the pane opening, a turn), or the count, answering last, would be dropped. An exact count
 * fixes the static rows for the session and every later summary reuses them; `isRound` (the read a main turn's end asks for) stamps the
 * rows with their change from the reading before.
 */
async function refreshContext($: EngineInterface, detail: 'summary' | 'full', isRound = false): Promise<void> {
  if (detail === 'summary' && (await isCountRunning($))) return
  const seq = ++contextSeq
  try {
    const u = await $.session.usage({ breakdown: detail })
    const breakdown = u.context.breakdown
    if (!breakdown) return
    const fresh = contextOf(breakdown, detail === 'full')
    await patch($, s => {
      if ((s.contextSeq ?? 0) > seq) return s
      const contextStatic = detail === 'full' ? staticOf(fresh) : s.contextStatic
      const reading = detail === 'summary' && contextStatic ? withStatic(fresh, contextStatic) : fresh
      return { ...s, context: withDeltas(reading, s.context, isRound && detail === 'summary'), contextSeq: seq, contextStatic }
    })
  } catch {
    // not measured: the tab keeps what it drew
  }
}

// The session whose first exact count was started (or tried): one per session, a failed one is not asked again on every open.
let exactTriedFor: string | undefined

/**
 * The Context tab opens: a summary now (free) and, the first time in a session while Claude is idle, one exact count whose static rows
 * every later summary reuses. A tab opened while Claude works reads the summary only: the count waits for an idle opening.
 */
async function openContext($: EngineInterface): Promise<void> {
  await refreshContext($, 'summary')
  const s = await read($, snapshot)
  const isIdle = s.claudeState === undefined || s.claudeState.kind === 'idle'
  if (s.sessionId === undefined || exactTriedFor === s.sessionId || s.contextStatic !== undefined || !isIdle || (await isCountRunning($))) return
  exactTriedFor = s.sessionId
  await countExact($)
}

/** Whether an exact count is in flight and still within `COUNT_TIMEOUT_MS`: a count that never answers does not lock the tab for good. */
async function isCountRunning($: EngineInterface): Promise<boolean> {
  return countingSince !== undefined && (await $.clock.now()) - countingSince < COUNT_TIMEOUT_MS
}

/** The exact count of the button: one at a time. */
async function countExact($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  if (countingSince !== undefined && now - countingSince < COUNT_TIMEOUT_MS) return
  const run = ++countRun
  countingSince = now
  try {
    await refreshContext($, 'full')
  } finally {
    // a count given up on does not release the one that replaced it
    if (countRun === run) countingSince = undefined
  }
}

/**
 * The end of a main turn re-reads the breakdown while the pane is open on the Context tab; a burst of turns is one read. No read
 * is scheduled or made while an exact count runs: the summary would be the newer reading, and the count, answering last, dropped.
 */
async function scheduleContextRead($: EngineInterface): Promise<void> {
  if (!isOpen || (await isCountRunning($)) || (await read($, snapshot)).tab !== 'context') return
  const now = await $.clock.now()
  if (contextScheduledAt !== undefined && now - contextScheduledAt < 2 * CONTEXT_DEBOUNCE_MS) return
  contextScheduledAt = now
  $.clock.after(CONTEXT_DEBOUNCE_MS, () => {
    contextScheduledAt = undefined
    // a summary is not read while an exact count runs: refreshContext itself skips it
    void refreshContext($, 'summary', true).catch(() => undefined)
  })
}

/**
 * Keeps the main loop's state for the header's icon. It is told apart before patching: a thinking chunk repeats many times
 * a second, and a patch costs a session check and a state file check. `only` makes the change conditional on the state now held.
 */
async function setClaudeState($: EngineInterface, state: CockpitClaudeState, only?: (now: CockpitClaudeState | undefined) => boolean): Promise<void> {
  try {
    const { claudeState } = await read($, snapshot)
    if (only && !only(claudeState)) return
    if (claudeState?.kind === state.kind && claudeState.tool === state.tool) return
    await patch($, s => ({ ...s, claudeState: state }))
  } catch {
    // observing must never break the event
  }
}

/**
 * Adds one response's counters to its loop's: an agent's four counters (kept apart as the turn's step part, which the turn's end
 * swaps for the turn's own total) or, for the main loop, the session's token count. Never breaks the step.
 */
async function addStepUsage($: EngineInterface, agentId: string | undefined, usage: CockpitUsage): Promise<void> {
  const now = await $.clock.now()
  const added = newTokens(usage)
  await patch($, s =>
    agentId === undefined
      ? { ...s, mainTokens: (s.mainTokens ?? 0) + added, mainStepTokens: (s.mainStepTokens ?? 0) + added }
      : {
          ...s,
          agents: upsertAgent(s.agents, agentId, now, a => ({
            ...a,
            usage: addUsage(a.usage, usage),
            stepUsage: addUsage(a.stepUsage, usage),
            tokens: a.tokens + added,
          })),
        },
  )
}

/**
 * The clock the countdowns and durations count from, and the agents that ended moved to the history: every tier runs it, so
 * `now` is never older than the tier's own period.
 */
async function tickClock($: EngineInterface): Promise<number> {
  const now = await $.clock.now()
  const listed = await $.agent.list().catch(() => undefined)
  await patch($, s => {
    const inRun = new Set(s.workflowRun?.agents.map(a => a.id))
    const agents = s.agents.map((a): CockpitAgent => {
      // An agent the engine no longer lists as active has ended without a turn.complete we saw. A workflow's agents are never
      // listed: theirs end by their own turn, an explicit failed or killed listing, or the end of their run.
      const info = listed?.find(l => l.id === a.id)
      const endedBy = inRun.has(a.id) ? ['failed', 'killed'] : ['completed', 'failed', 'killed']
      const isEnded = listed !== undefined && a.status === 'running' && (info ? endedBy.includes(info.status) : !inRun.has(a.id))
      return isEnded ? { ...a, status: 'done', endedAt: now, isFailed: info?.status === 'failed' || info?.status === 'killed' } : a
    })
    const isListed = (a: CockpitAgent) => a.status === 'running' || (a.endedAt !== undefined && now - a.endedAt < AGENT_KEEP_MS)
    const gone = agents.filter(a => !isListed(a))
    const left = gone
      .map(toHistory)
      .filter((h): h is CockpitHistoryEntry => h !== undefined)
      .sort((a, b) => b.endedAt - a.endedAt)
    return {
      ...s,
      now,
      agents: agents.filter(isListed),
      history: left.length > 0 ? addHistory(s.history, left) : s.history,
      // An agent leaving the list (type `?` ones too: they used tokens) joins the count that the share keeps.
      agentTokens: withAgentTokens(s.agentTokens, gone),
    }
  })
  return now
}

/** Whether the pane is open and its selected tab asks for the fast tier. */
async function isFastWanted($: EngineInterface): Promise<boolean> {
  if (!isOpen) return false
  const { tab } = await read($, snapshot)
  return tabNeeds(tab).fast
}

/** Fast tier (2 s): the elapsed times of a tab that draws them. */
async function fastTick($: EngineInterface): Promise<void> {
  if (await isFastWanted($)) await tickClock($)
}

/** Medium tier (10 s): git (and, with the Work tab, its reads), whatever the tab while the pane is open: the header shows it on every tab. */
async function mediumTick($: EngineInterface): Promise<void> {
  if (!isOpen) return
  await tickClock($)
  await refreshGit($)
}

/** Slow tier (30 s), whatever the tab: the state file's heartbeat, the ALM line, git (and the pull request through it), the worklog, the done-claim log. */
async function slowTick($: EngineInterface): Promise<void> {
  // While the pane is open the file is the proof of it: a stale `at` lets the statusline ignore a leftover `open:true`. First, so a slow or failing read cannot delay or skip it.
  if (isOpen) await writeState($, true, true)
  // A failed clock tick must not skip the reads below.
  const now = await tickClock($).catch(() => $.clock.now())
  // The ALM line first: an Azure DevOps pull request is asked about with its org.
  await refreshAlm($)
  await refreshGit($)
  await refreshWorklog($, now)
  await refreshDoneClaims($)
}

/** `list` without its last entry equal to `tool` (a call that ended); undefined stays undefined. */
const removeOne = (list: readonly string[] | undefined, tool: string): string[] | undefined => {
  const i = list?.lastIndexOf(tool) ?? -1
  return list && i >= 0 ? [...list.slice(0, i), ...list.slice(i + 1)] : list?.slice()
}

/** Applies `change` to the agent `id`; an agent whose events outran its spawn gets a stub the spawn later fills. */
function upsertAgent(agents: CockpitAgent[], id: string, now: number, change: (a: CockpitAgent) => CockpitAgent): CockpitAgent[] {
  const stub: CockpitAgent = { id, type: '?', status: 'running', startedAt: now, tokens: 0 }
  return agents.some(a => a.id === id)
    ? agents.map(a => (a.id === id ? change(a) : a))
    : [...agents, change(stub)]
}

// ── Tasks: the main thread's task tools and TodoWrite, one merged list ──

const TODO_PREFIX = 'todo:'

/** TodoWrite sends the whole list: it replaces the TodoWrite items, the task-tool items stay. */
function applyTodos(
  tasks: readonly CockpitTask[],
  todos: readonly { content: string; status: CockpitTask['status'] }[],
  now: number,
): CockpitTask[] {
  const before = new Map(tasks.map(t => [t.id, t]))
  const written = todos.map((todo): CockpitTask => {
    const id = TODO_PREFIX + todo.content
    const wasActive = before.get(id)?.status === 'in_progress'
    const startedAt = todo.status === 'in_progress' ? (wasActive ? before.get(id)?.startedAt : undefined) ?? now : undefined
    return { id, subject: todo.content, status: todo.status, startedAt }
  })
  return [...tasks.filter(t => !t.id.startsWith(TODO_PREFIX)), ...written]
}

/** A call that answered without error and was not refused. */
const isOk = (ran: { deny?: string; isError?: boolean }) => ran.deny === undefined && ran.isError !== true

/** What a Bash call printed: the `stdout` of its result, narrowed from `unknown`; else the text the model read. */
function bashOutput(ran: { result?: unknown; text?: string }): string {
  const { result } = ran
  return typeof result === 'object' && result !== null && 'stdout' in result && typeof result.stdout === 'string' ? result.stdout : (ran.text ?? '')
}

/** A TaskUpdate result that says it did not apply (`success: false`), narrowed from `unknown`. */
function isRefused(result: unknown): boolean {
  return typeof result === 'object' && result !== null && 'success' in result && result.success === false
}

/** The `task` a TaskCreate result carries, narrowed once here: the result reaches a hook as `unknown`. */
function createdTask(result: unknown): { id: string; subject: string } | undefined {
  if (typeof result !== 'object' || result === null || !('task' in result)) return undefined
  const { task } = result
  if (typeof task !== 'object' || task === null || !('id' in task) || !('subject' in task)) return undefined
  return typeof task.id === 'string' && typeof task.subject === 'string' ? { id: task.id, subject: task.subject } : undefined
}

/** What the pane's buttons do. Each runs apart from the press and fails alone: a refused call leaves the pane as it was. */
const paneActions = ($: EngineInterface): PaneActions => ({
  // The Work tab's git reads, the Context tab's breakdown and the System tab's monitor run while the tab is selected: the press starts them.
  selectTab: tab =>
    void patch($, s => ({ ...s, tab }))
      .then(() => syncMonitor($))
      .then(() => (tab === 'work' ? refreshRepo($) : tab === 'context' ? openContext($) : undefined))
      .catch(() => undefined),
  // The instructions are built from the snapshot as it is at the press.
  compact: () =>
    void read($, snapshot)
      .then(s => $.session.compact({ instructions: compactInstructions(s) }))
      .catch(() => undefined),
  // `$.command.run` is the engine's documented way to run a slash command: "as if the person typed `/command args`" (the
  // `command.run` entry of the engine types).
  // The hours of this chat: the worklog skill's `sessione <id>` scope.
  runWorklog: () =>
    void $.session
      .id()
      .then(id => $.command.run({ command: 'worklog', args: `oggi sessione ${id}` }))
      .catch(() => undefined),
  openDiff: change => void showDiff($, change),
  openAgent: agentId => void $.ui.view({ agentId }).catch(() => undefined),
  toggleHistory: () => void patch($, s => ({ ...s, isHistoryOpen: !s.isHistoryOpen })).catch(() => undefined),
  countExact: () => void countExact($).catch(() => undefined),
  setNoteDraft: text => void patch($, s => ({ ...s, noteDraft: text === '' ? undefined : text.slice(0, NOTE_MAX), noteEditing: text === '' ? undefined : s.noteEditing })).catch(() => undefined),
  saveNote: text => void patch($, s => saveNote(s, text)).catch(() => undefined),
  editNote: id =>
    void patch($, s => {
      const note = s.notes?.find(n => n.id === id)
      return note ? { ...s, noteDraft: note.text, noteEditing: id } : s
    }).catch(() => undefined),
  sendNote: id => void sendNote($, id).catch(() => undefined),
  deleteNote: id =>
    void patch($, s => {
      const notes = (s.notes ?? []).filter(n => n.id !== id)
      return { ...s, notes: notes.length > 0 ? notes : undefined, noteEditing: s.noteEditing === id ? undefined : s.noteEditing }
    }).catch(() => undefined),
})

/**
 * Saves the field's text (`typed`, the text of the field on Enter; else the draft the snapshot holds): a new note at the end of the list,
 * or, when the field was loaded from a note (`noteEditing`) that is still there, that note's text replaced. The field is emptied; a blank text changes nothing.
 */
function saveNote(s: CockpitSnapshot, typed?: string): CockpitSnapshot {
  const text = (typed ?? s.noteDraft ?? '').slice(0, NOTE_MAX)
  if (text.trim() === '') return s
  const notes = s.notes ?? []
  const isEdit = notes.some(n => n.id === s.noteEditing)
  const next = isEdit
    ? notes.map(n => (n.id === s.noteEditing ? { ...n, text } : n))
    : [...notes, { id: Math.max(0, ...notes.map(n => n.id)) + 1, text }]
  return { ...s, notes: next, noteDraft: undefined, noteEditing: undefined }
}

/**
 * Appends a saved note to the prompt box, after a newline (D6: it may follow text already typed). The box is only filled, never
 * submitted (D3): the person decides. The note stays in the list, whether the box took the text or not.
 */
async function sendNote($: EngineInterface, id: number): Promise<void> {
  const note = (await read($, snapshot)).notes?.find(n => n.id === id)
  if (note) await $.prompt.fill({ text: `\n${note.text}`, mode: 'append' })
}

/**
 * What the diff pane's button does: forgets the diff, then closes the pane. A plugin's own `$.ui.close` does not reach its
 * own `ui.close` hook, which is what forgets the diff when the person closes the pane instead.
 */
const diffActions = ($: EngineInterface): DiffActions => ({
  close: () =>
    void patch($, s => ({ ...s, diff: undefined }))
      .then(() => $.ui.close({ id: DIFF_PANE }))
      .catch(() => undefined),
})

const openPane = ($: EngineInterface) => $.ui.open({ id: PANE, title: 'cockpit', columns: PANE_MAX_COLUMNS })

/** Opens the pane; one that waits undrawn is not open yet: its first render says so. */
async function open($: EngineInterface) {
  const opened = await openPane($)
  await setOpen($, opened.isPlaced)
  return opened
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // First: the command registered below is described in the language read here.
    await refreshLang($)
    const now = await $.clock.now()
    const forced = await $.env.get('CLAUDE_CODE_SUBAGENT_MODEL')
    const model = await $.session.model().catch(() => undefined)
    const effort = await $.settings.read({ key: 'effortLevel' }).catch(() => undefined)
    // The same session id (an enable, a respawn, a reload) keeps what the snapshot holds; another one starts its own.
    await adoptSession($, true)
    await patch($, s => ({
      ...s,
      now,
      model,
      effort: s.effort ?? (typeof effort === 'string' ? effort : undefined),
      isSubagentModelForced: Boolean(forced),
      isLangRead: true,
    }))
    await refreshLastRates($)
    await refreshUsage($)
    await refreshAutoCompact($)
    await refreshAlm($)
    await refreshGit($)
    await refreshWorklog($, now)
    await refreshDoneClaims($)
    await writeState($, true)

    await $.command.register({ name: 'cockpit', description: t().commandDescription })
    $.clock.every(FAST_MS, () => void fastTick($).catch(() => undefined))
    $.clock.every(MEDIUM_MS, () => void mediumTick($).catch(() => undefined))
    $.clock.every(SLOW_MS, () => void slowTick($).catch(() => undefined))
    // The pane starts closed: `/cockpit` opens it.
    return next(e)
  })

  // The ending session's file is left closed and empty, so the statusline drops its segments at once, with every
  // finished agent in its history; the statusline's hourly prune removes the file itself after 3 days (`$.fs` cannot
  // delete). Best-effort: the write is skipped when the exit's short budget is nearly spent, and any failure is swallowed.
  // The snapshot lets go of the session first (any reason), from the reading taken here, so a write cut short cannot
  // leave it in the atom: its agents go to its own history (the ones still running as `interrotto`), and the ended id
  // is remembered, since the engine answers it until it switches to the next one. The next change adopts that one.
  on('session.end', async ($, e, next) => {
    stopMonitor()
    let s: CockpitSnapshot | undefined
    try {
      s = await read($, snapshot)
      if (s.sessionId === e.sessionId || s.sessionId === undefined) {
        await update($, snapshot, x => ({ ...withoutSession(x), endedSessionId: e.sessionId }))
      }
    } catch {
      // the snapshot keeps the old id: writeState writes nothing for another one
    }
    try {
      const dir = await configDir($)
      if (s && dir && SESSION_ID.test(e.sessionId) && next.budget.remainingMs > 500) {
        const own = s.sessionId === e.sessionId ? s : undefined
        const at = await $.clock.now()
        const left = (own?.agents ?? [])
          .map(a => toHistory(a.status === 'running' ? { ...a, endedAt: at, isInterrupted: true } : a))
          .filter((h): h is CockpitHistoryEntry => h !== undefined)
          .sort((a, b) => b.endedAt - a.endedAt)
        const history = addHistory(own?.history, left)
        // The agents still listed leave with the session: a resume starts with none, so their tokens join the count.
        const agentTokens = own && withAgentTokens(own.agentTokens, own.agents)
        const content = { open: false, at, lastTurnUsd: null, agents: { running: 0, modelWarnings: 0 }, effort: null, tasks: null, tab: own?.tab ?? 'agents', mainTokens: own?.mainTokens, agentTokens }
        await $.fs.write(`${dir}/.cache/cockpit-${e.sessionId}.json`, JSON.stringify(content))
        // The history takes the running agents as interrotto; a snapshot that is not this session's has nothing of it to write.
        if (own) await $.fs.write(`${dir}/.cache/cockpit-data-${e.sessionId}.json`, JSON.stringify(sessionData(own, history)))
      }
    } catch {
      // the files age out on their own (the data file goes with the transcript)
    }
    return next(e)
  })

  // `/cockpit` opens the pane; a command-initiated open is placed at any width.
  on('command.run', { command: 'cockpit' }, async $ => {
    const opened = await open($)
    return { text: opened.isPlaced ? t().commandOpen : t().commandWaiting(opened.reason) }
  })

  // The diff pane: drawn from the snapshot's diff, forgotten when it closes, whoever closed it.
  on('ui.render', { component: 'Pane', requestId: DIFF_PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const s = await read($, snapshot)
    return diffView(ui, s.diff, e.props.bodyColumns, diffActions($))
  })

  on('ui.close', { id: DIFF_PANE }, async ($, e, next) => {
    const closed = await next(e)
    await patch($, s => ({ ...s, diff: undefined })).catch(() => undefined)
    return closed
  })

  // Any close, whoever asked for it: the pane stays closed until `/cockpit`.
  on('ui.close', { id: PANE }, async ($, e, next) => {
    const closed = await next(e)
    await setOpen($, false)
    return closed
  })

  on('session.measure', async ($, e, next) => {
    const now = await $.clock.now()
    await patch($, s => ({
      ...s,
      ctx: { ...s.ctx, tokens: e.context.tokens, window: e.context.window, percent: e.context.percent },
      // the resumed value stands in only until the first live reading: a later compaction reads empty, not old
      lastCtx: e.context.percent !== undefined ? undefined : s.lastCtx,
      cost: { ...s.cost, usd: e.cost?.usd },
      rateLimits: e.rateLimits,
    }))
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    // The deltas count from where the main loop's turn began.
    if (e.agentId === undefined) {
      // A new turn has no tool in flight: one a crashed call left behind would hold the state on a tool for good.
      mainTools = []
      await patch($, s => ({
        ...s,
        ctx: { ...s.ctx, startTokens: s.ctx.tokens ?? 0 },
        cost: { ...s.cost, startUsd: s.cost.usd ?? 0 },
        claudeState: { kind: 'working' },
      }))
    }
    return next(e)
  })

  // A streaming event: the hook is a generator and forwards what the engine streams.
  on('turn.step', async function* ($, e, next) {
    try {
      const { agentId, model, effort } = e
      const now = await $.clock.now()
      await patch($, s =>
        agentId === undefined
          ? { ...s, model, effort }
          : { ...s, agents: upsertAgent(s.agents, agentId, now, a => ({ ...a, model, effort })) },
      )
    } catch {
      // observing must never break the step
    }
    // The main loop's chunks tell what Claude is doing: a thinking chunk is thinking, text or a tool's start is working. A chunk
    // repeats many times a second: the state is written when the kind it derives changes, with no snapshot read in between.
    const stream = next(e)
    let lastKind: 'thinking' | 'working' | undefined
    for await (const chunk of stream) {
      if (e.agentId === undefined) {
        const kind = chunk.kind === 'thinking' ? 'thinking' : chunk.kind === 'text' || chunk.kind === 'tool' ? 'working' : undefined
        if (kind !== undefined && kind !== lastKind) {
          lastKind = kind
          await setClaudeState($, { kind })
        }
      }
      yield chunk
    }
    // The response's own usage: the four counters of an agent, live per step, and the session's share.
    try {
      const { usage } = await stream.result
      if (usage) await addStepUsage($, e.agentId, usageOf(usage))
    } catch {
      // observing must never break the step
    }
  })

  // Tasks: TodoWrite is a per-agent list, so only the main thread (no `agentId`) feeds it; a call that failed changes nothing.
  on('tool.call', { tool: 'TodoWrite' }, async ($, e, next) => {
    const ran = await next(e)
    if (e.agentId === undefined && isOk(ran)) {
      try {
        const now = await $.clock.now()
        await patch($, s => ({ ...s, tasks: applyTodos(s.tasks ?? [], e.todos, now) }))
      } catch {
        // observing must never break the call
      }
    }
    return ran
  })

  on('tool.call', { tool: 'TaskCreate' }, async ($, e, next) => {
    const ran = await next(e)
    const created = ran.deny === undefined ? createdTask(ran.result) : undefined
    if (isOk(ran) && created) {
      try {
        const { id, subject } = created
        await patch($, s => ({
          ...s,
          tasks: [...(s.tasks ?? []).filter(t => t.id !== id), { id, subject, status: 'pending' }],
        }))
      } catch {
        // observing must never break the call
      }
    }
    return ran
  })

  on('tool.call', { tool: 'TaskUpdate' }, async ($, e, next) => {
    const ran = await next(e)
    // The task list is shared: a subagent's TaskCreate/TaskUpdate count too (TodoWrite is per agent, main thread only).
    if (isOk(ran) && !isRefused(ran.result)) {
      try {
        const now = await $.clock.now()
        const { taskId, status, subject } = e
        await patch($, s => {
          const tasks = s.tasks ?? []
          if (status === 'deleted') return { ...s, tasks: tasks.filter(t => t.id !== taskId) }
          // A task the mod never saw (created before a reload or a resume) is added by its first update.
          if (status !== undefined && !tasks.some(t => t.id === taskId)) {
            const added: CockpitTask = { id: taskId, subject: subject ?? `#${taskId}`, status, startedAt: status === 'in_progress' ? now : undefined }
            return { ...s, tasks: [...tasks, added] }
          }
          return {
            ...s,
            tasks: tasks.map((t): CockpitTask => {
              if (t.id !== taskId) return t
              const updated: CockpitTask = { ...t, subject: subject ?? t.subject }
              if (status === undefined) return updated
              if (status === 'in_progress') return { ...updated, status, startedAt: t.status === 'in_progress' ? t.startedAt : now }
              return { ...updated, status, startedAt: undefined }
            }),
          }
        })
      } catch {
        // observing must never break the call
      }
    }
    return ran
  })

  // The tools of each subagent, from the tool events carrying its id: the one running now (from the call to its end) and the last
  // one. The main loop's calls are no agent's: while any runs the header shows a tool by name, and the end of the last one puts
  // the state back to working.
  on('tool.call', async ($, e, next) => {
    const { agentId, tool } = e
    if (agentId !== undefined) {
      const forAgent = (change: (a: CockpitAgent) => CockpitAgent) => patch($, s => ({ ...s, agents: s.agents.map(a => (a.id === agentId ? change(a) : a)) }))
      try {
        // Only an agent the mod already knows: a call that outran the spawn makes no stub the spawn would later fill.
        await forAgent(a => ({ ...a, lastTool: tool, activeTools: [...(a.activeTools ?? []), tool] }))
      } catch {
        // observing must never break the call
      }
      try {
        return await next(e)
      } finally {
        await forAgent(a => ({ ...a, activeTools: removeOne(a.activeTools, tool) })).catch(() => undefined)
      }
    }
    mainTools = [...mainTools, tool]
    await setClaudeState($, { kind: 'tool', tool })
    // A clock that fails leaves the call without a time: the row draws none.
    const at = await $.clock.now().catch(() => undefined)
    let isSuccess = false
    try {
      const ran = await next(e)
      isSuccess = isOk(ran)
      return ran
    } finally {
      mainTools = removeOne(mainTools, tool) ?? []
      // The call is listed once it ended, with how it ended (an error, a refusal or a throw is a failure).
      await patch($, s => ({ ...s, calls: recordCall(s.calls, { tool, arg: toolArg(e), isOk: isSuccess, at }) })).catch(() => undefined)
      const last = mainTools.at(-1)
      await setClaudeState($, last === undefined ? { kind: 'working' } : { kind: 'tool', tool: last }, held => held?.kind === 'tool')
    }
  })

  // A pull request this chat created (`gh pr create`, `az repos pr create`; a subagent's call too: the PR is the chat's) is
  // told by what the command printed.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (isOk(ran) && /\bpr\s+create\b/.test(e.command)) {
      const pr = parseCreatedPr(e.command, bashOutput(ran))
      if (pr) await patch($, s => ({ ...s, prs: upsertPr(s.prs, pr) })).catch(() => undefined)
    }
    return ran
  })

  // A permission request waits for the person: the state is waiting until it is answered. A notification only says that
  // something wants attention: waiting until the next event moves the state on.
  on('classic.PermissionRequest', async ($, e, next) => {
    if (e.agent_id !== undefined) return next(e)
    const held = (await read($, snapshot).catch(() => undefined))?.claudeState
    await setClaudeState($, { kind: 'waiting' })
    try {
      return await next(e)
    } finally {
      await setClaudeState($, stateAfterWait(held, mainTools), now => now?.kind === 'waiting')
    }
  })
  on('classic.Notification', async ($, e, next) => {
    // A notification while Claude is idle (or before anything happened) wants nothing from the person yet: it stays idle.
    if (e.agent_id === undefined) await setClaudeState($, { kind: 'waiting' }, now => now !== undefined && now.kind !== 'idle')
    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const spawned = await next(e)
    if (spawned.agentId !== undefined) {
      const id = spawned.agentId
      const startedAt = await $.clock.now()
      await patch($, s => ({
        ...s,
        // A workflow agent's spawn carries its run: the count of agents started and finished is the one progress the engine exposes.
        workflowRun: e.workflow ? addWorkflowAgent(s.workflowRun, e.workflow.runId, id) : s.workflowRun,
        agents: upsertAgent(s.agents, id, startedAt, a => ({
          ...a,
          parentId: e.parentAgentId,
          type: e.subagentType,
          description: e.description,
          requested: e.model,
          model: spawned.model,
          // events that outran the spawn keep their status, tokens, effort and start
          startedAt: Math.min(a.startedAt, startedAt),
        })),
      }))
    }
    return spawned
  })

  on('turn.complete', async ($, e, next) => {
    const agentId = e.agentId
    const usage = e.usage
    const now = await $.clock.now()
    if (agentId === undefined) {
      // The main loop's turn: how much of its input the prompt cache served. An empty turn leaves the last share.
      const total = usage ? usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens : 0
      if (usage && total > 0) {
        const cacheShare = Math.round((100 * usage.cache_read_input_tokens) / total)
        // The turn's usage sums every request of the turn: the context size is the engine's last reading, whose growth the autocompact forecast averages.
        await patch($, s => ({
          ...s,
          cacheShare,
          ctxSamples: s.ctx.tokens ? recordCtxSample(s.ctxSamples, s.ctx.tokens) : s.ctxSamples,
        }))
      }
      // The steps already counted their part of the session's tokens: the turn's own total replaces it.
      await patch($, s => ({
        ...s,
        mainTokens: usage ? Math.max(0, (s.mainTokens ?? 0) - (s.mainStepTokens ?? 0)) + newTokens(usageOf(usage)) : s.mainTokens,
        mainStepTokens: undefined,
        lastRoundMs: e.durationMs,
        // Every main turn is a round of the Context sparkline: the context the engine last measured.
        ctxRounds: s.ctx.tokens ? recordRound(s.ctxRounds, s.ctx.tokens) : s.ctxRounds,
      }))
      await setClaudeState($, { kind: 'idle' })
      await scheduleContextRead($).catch(() => undefined)
    } else {
      await patch($, s => ({
        ...s,
        workflowRun: finishWorkflowAgent(s.workflowRun, agentId),
        agents: upsertAgent(s.agents, agentId, now, a => {
          // The steps already counted their part: the turn's own total replaces it.
          const settled = settleUsage(a.usage, a.stepUsage, usage ? usageOf(usage) : undefined)
          return {
            ...a,
            status: 'done',
            endedAt: now,
            isFailed: e.reason !== 'answer',
            usage: settled,
            stepUsage: undefined,
            tokens: usage ? a.tokens - newTokens(a.stepUsage) + newTokens(usageOf(usage)) : a.tokens,
          }
        }),
      }))
    }
    await refreshGit($)
    return next(e)
  })

  // The skills the session invoked (typed, the Skill tool, a subagent's preload), once each in the order they first ran: the Context tab lists them.
  on('skill.prompt', async ($, e, next) => {
    try {
      await patch($, s => ({ ...s, skillsUsed: s.skillsUsed?.includes(e.skill) ? s.skillsUsed : [...(s.skillsUsed ?? []), e.skill] }))
    } catch {
      // observing must never break the prompt
    }
    return next(e)
  })

  // The engine's classic Stop and SubagentStop carry the background work in flight: the name of a workflow among it is what
  // `compact` names. It is the reading of the last stop, so it is dropped when a stop reports none.
  on('classic.Stop', async ($, e, next) => {
    await setWorkflow($, e.background_tasks, true)
    return next(e)
  })
  on('classic.SubagentStop', async ($, e, next) => {
    await setWorkflow($, e.background_tasks)
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    // A pane that waited undrawn is open from its first render; the write runs outside this drawing dispatch.
    if (!isOpen) $.clock.after(0, () => void setOpen($, true).catch(() => undefined))
    const ui = $.ui.resolve(e)
    const s = await read($, snapshot)
    // A pane that draws before any session start (a mod enabled mid-session) reads the language once; the mark is written outside this drawing.
    if (!s.isLangRead) {
      await refreshLang($)
      $.clock.after(0, () => void patch($, x => ({ ...x, isLangRead: true })).catch(() => undefined))
    }
    return paneView(ui, s, e.props.bodyColumns, e.props.scroll.bodyRows, paneActions($))
  })
}
