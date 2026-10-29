import { atom, read } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { CockpitAlm, CockpitChange, CockpitPerimeterCheck, CockpitPr } from '../types'
import { DIFF_PANE, INITIAL } from './state'
import { patch } from './store'
import { t } from './strings'
import {
  additionsDiff,
  azArgv,
  azureRepo,
  capDiff,
  checkPerimeter,
  diffHunks,
  isAzureRemote,
  isDefaultBranch,
  isGithubRemote,
  parseAzurePr,
  parseDefaultBranch,
  parseGitStatus,
  parseGithubPr,
  parseNumstat,
  parsePerimeter,
  parseWorktree,
  repoRelative,
  upsertPr,
} from './work'

/** The pull request (and the repo's default branch) of a branch is read again after this long. */
const PR_EVERY_MS = 5 * 60_000
/** The Work tab keeps this many changed files; it draws 8 of them. */
const REPO_FILES_KEEP = 50

// The scan that checks `$.state` references reads the atom from the file that uses it.
const snapshot = atom({ plugin: 'cockpit', key: 'snapshot' } as const, INITIAL)

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
// `asked`: the saved pull requests it read again.
let lastPrRead: { key: string; at: number; asked: number[] } | undefined
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
  const args = ['repos', 'pr', 'list', '--organization', azOrganization(alm.org), '--project', project, '--repository', repo.repo]
  const list = await runAz($, [...args, '--source-branch', `refs/heads/${branch}`, '--status', 'all', '--top', '1', '--output', 'json'], cwd, alm)
  return list?.exitCode === 0 ? parseAzurePr(list.stdout) : undefined
}

/** The organization URL `az` is aimed at: the ALM line's `org` as is when it is one, else its name on dev.azure.com. */
const azOrganization = (org: string): string => (/^https?:\/\//i.test(org) ? org : `https://dev.azure.com/${org}`)

/** A pull request that ended (merged or closed) is not read again. */
const isPrEnded = (pr: CockpitPr): boolean => pr.state === 'merged' || pr.state === 'closed'

/**
 * A pull request of the chat read again by its number (its address on GitHub, which also names the repository): `gh pr view` for a GitHub `origin`,
 * `az repos pr show` for an Azure DevOps one, aimed at the org of the ALM line. Undefined when it cannot be had or answers another pull request.
 */
async function readSavedPr($: EngineInterface, cwd: string, remote: string, pr: CockpitPr, alm: CockpitAlm | undefined): Promise<CockpitPr | undefined> {
  let read: CockpitPr | undefined
  if (isGithubRemote(remote)) {
    const view = await $.process.run(['gh', 'pr', 'view', pr.url ?? String(pr.number), '--json', 'number,title,url,state,isDraft'], { cwd, timeoutMs: 10_000 })
    read = view.exitCode === 0 ? parseGithubPr(view.stdout) : undefined
  } else if (isAzureRemote(remote) && alm?.org) {
    const show = await runAz($, ['repos', 'pr', 'show', '--id', String(pr.number), '--organization', azOrganization(alm.org), '--output', 'json'], cwd, alm)
    read = show?.exitCode === 0 ? parseAzurePr(show.stdout) : undefined
  }
  // A known url must match too: a number alone can name another repo's pull request.
  return read?.number === pr.number && (pr.url === undefined || read.url === undefined || read.url === pr.url) ? read : undefined
}

/**
 * Whether the checkout at `root` is one of the chat's: the one this process started in (`homeRoot`), or one it edited a file in.
 * A repo only passed through (a `cd` to read) is not, so the PR of its branch never joins the chat.
 */
const isRepoOfChat = (root: string | undefined, homeRoot: string | undefined, edited: readonly string[] | undefined) =>
  Boolean(root) && (homeRoot?.toLowerCase() === root?.toLowerCase() || (edited ?? []).some(p => repoRelative(root, p) !== undefined))

/**
 * Reads, in the background (never awaited by a refresh or a render), the repo's default branch from `origin/HEAD` and,
 * off it, the pull request of `branch` when the repo is one of the chat's (`isRepoOfChat`): `gh pr view` for a GitHub `origin`, `az repos pr list` for an Azure
 * DevOps one. One found joins the chat's pull requests, or updates its entry there; no CLI, no PR or a failure adds
 * nothing. The chat's other pull requests that have not ended are read again by number (`readSavedPr`), so one made in the chat or merged
 * since shows its state. The result is dropped when the branch has moved on.
 */
async function refreshPr($: EngineInterface, cwd: string, branch: string): Promise<void> {
  const now = await $.clock.now()
  const { alm, git, homeRoot, edited, prs } = await read($, snapshot)
  const isChatRepo = isRepoOfChat(git?.root, homeRoot, edited)
  // The chat's pull requests still to end are read again by number.
  // Only from a repo of the chat: a number asked in another repo would name another pull request.
  const pending = isChatRepo ? (prs ?? []).filter(p => !isPrEnded(p)) : []
  // Whether the repo is the chat's is part of the question: a first edit there asks again at once.
  const key = `${cwd}\n${branch}\n${alm?.org ?? ''}\n${alm?.project ?? ''}\n${isChatRepo}`
  // One made in the chat (no state yet) is asked at once, once.
  const isNewPr = pending.some(p => p.state === undefined && !lastPrRead?.asked.includes(p.number))
  if (isPrReading || (!isNewPr && lastPrRead?.key === key && now - lastPrRead.at < PR_EVERY_MS)) return
  isPrReading = true
  lastPrRead = { key, at: now, asked: pending.map(p => p.number) }
  try {
    const base = ['git', '-C', cwd, '--no-optional-locks']
    const head = await $.process.run([...base, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], { timeoutMs: 2000 })
    const defaultBranch = head.exitCode === 0 ? parseDefaultBranch(head.stdout) : undefined
    let pr: CockpitPr | undefined
    let remote: string | undefined
    const isBranchAsked = !isDefaultBranch(branch, defaultBranch) && isChatRepo
    // The default branch has no pull request of its own to look for, nor has a repo the chat only passes through.
    if (isBranchAsked || pending.length > 0) {
      const origin = await $.process.run([...base, 'remote', 'get-url', 'origin'], { timeoutMs: 2000 })
      remote = origin.exitCode === 0 ? origin.stdout : undefined
    }
    if (remote !== undefined && isBranchAsked) {
      if (isGithubRemote(remote)) {
        const view = await $.process.run(['gh', 'pr', 'view', '--json', 'number,title,url,state,isDraft'], { cwd, timeoutMs: 10_000 })
        pr = view.exitCode === 0 ? parseGithubPr(view.stdout) : undefined
      } else if (isAzureRemote(remote)) {
        pr = await readAzurePr($, cwd, branch, remote, alm)
      }
    }
    // The others the chat holds (not the one just read), each by its number; one that cannot be read keeps its last state.
    // Three at a time, so a long list does not wait out each CLI call in turn.
    const reads: CockpitPr[] = []
    const others = remote === undefined ? [] : pending.filter(p => p.number !== pr?.number)
    for (let i = 0; i < others.length; i += 3) {
      const batch = await Promise.all(others.slice(i, i + 3).map(saved => readSavedPr($, cwd, remote!, saved, alm).catch(() => undefined)))
      for (const again of batch) if (again) reads.push(again)
    }
    await patch($, s => {
      if (s.cwd !== cwd || s.git?.branch !== branch) return s
      return { ...s, defaultBranch, prs: reads.reduce(upsertPr, pr ? upsertPr(s.prs, pr) : s.prs) }
    })
    // What this read just answered is not new to the next one, even when it carries no state.
    for (const p of pr ? [...reads, pr] : reads) lastPrRead?.asked.push(p.number)
  } catch {
    // the CLI is missing or too slow: no PR is added, and the next read is in `PR_EVERY_MS`
  } finally {
    isPrReading = false
  }
}

type GitRun = (args: string[]) => ReturnType<EngineInterface['process']['run']>

/** A git read that exited clean and was not cut. */
const isRead = (r: { exitCode: number; isStdoutTruncated: boolean }) => r.exitCode === 0 && !r.isStdoutTruncated

/**
 * Where the branch left the default branch: the ref of the default branch (the one `origin/HEAD` names, else `main` or `master`; its
 * remote-tracking ref before the local one) and the merge base with it. Undefined when no such ref exists.
 */
async function branchPoint(run: GitRun, known: string | undefined): Promise<{ ref: string; name: string; base: string } | undefined> {
  let name = known
  if (name === undefined) {
    const head = await run(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])
    name = head.exitCode === 0 ? parseDefaultBranch(head.stdout) : undefined
  }
  for (const candidate of name === undefined ? ['main', 'master'] : [name]) {
    for (const ref of [`origin/${candidate}`, candidate]) {
      const mergeBase = await run(['merge-base', 'HEAD', ref])
      const base = mergeBase.exitCode === 0 ? mergeBase.stdout.trim() : ''
      if (/^[0-9a-f]{7,64}$/.test(base)) return { ref, name: candidate, base }
    }
  }
  return undefined
}

/**
 * The Work tab's reads, only while that tab is selected: the files changed on the branch since it left the default branch plus the
 * uncommitted ones (tracked, with their line counts, then untracked and not ignored). Without a default
 * branch to count from, the changed files are the uncommitted ones against HEAD. Every read failing keeps the last reading.
 */
export async function refreshRepo($: EngineInterface): Promise<void> {
  try {
    const s = await read($, snapshot)
    const { cwd, git } = s
    if (s.tab !== 'work' || !git?.root) return
    const base = ['git', '-C', git.root, '--no-optional-locks']
    const run: GitRun = args => $.process.run([...base, ...args], { timeoutMs: 3000 })
    const from = await branchPoint(run, s.defaultBranch)
    const [tracked, untracked] = await Promise.all([
      run(['diff', '--numstat', '--no-renames', '-z', from?.base ?? 'HEAD', '--']),
      run(['ls-files', '--others', '--exclude-standard', '-z']),
    ])
    if (!isRead(tracked) && !isRead(untracked)) return
    const names = isRead(untracked) ? untracked.stdout.split('\0').filter(Boolean) : []
    const files = parseNumstat(isRead(tracked) ? tracked.stdout : '', names)
    const repo = { files: files.slice(0, REPO_FILES_KEEP), total: files.length, ...(from && { base: from.base, from: from.name }) }
    await patch($, x => (x.cwd === cwd && x.git?.branch === git.branch ? { ...x, repo } : x))
  } catch {
    // git missing or too slow: keep the last reading
  }
}

/**
 * The hunks of `change` to draw: `git diff <base> -- <file>` (`base` is the commit the Work tab compares with, HEAD without one), or the whole file as additions when it is untracked.
 * Undefined when they cannot be had: a file over `DIFF_FILE_MAX` or unreadable, a git that failed, was cut or too slow.
 */
async function readHunks($: EngineInterface, root: string, change: CockpitChange, base = 'HEAD'): Promise<string | undefined> {
  try {
    if (change.isUntracked) {
      const file = `${root}/${change.path}`
      if ((await $.fs.stat(file)).size > DIFF_FILE_MAX) return undefined
      const text = await $.fs.read(file)
      return typeof text === 'string' ? additionsDiff(change.path, text) : undefined
    }
    const out = await $.process.run(['git', '-C', root, '--no-optional-locks', 'diff', '--no-color', '--no-ext-diff', '--no-renames', base, '--', change.path], { timeoutMs: 5000 })
    return out.exitCode === 0 && !out.isStdoutTruncated ? diffHunks(out.stdout) : undefined
  } catch {
    return undefined
  }
}

/** Draws the diff of `change` in the second pane; a file that cannot be had opens it saying so. */
export async function showDiff($: EngineInterface, change: CockpitChange): Promise<void> {
  try {
    const { git, repo } = await read($, snapshot)
    if (!git?.root) return
    const hunks = await readHunks($, git.root, change, repo?.base)
    const { text, isCut } = capDiff(hunks ?? '')
    await patch($, s => ({ ...s, diff: { file: change.path, text, ...(isCut && { isCut }), ...(hunks === undefined && { isUnreadable: true }) } }))
    await $.ui.open({ id: DIFF_PANE, title: t().diffTitle(change.path), closeOnEscape: true })
  } catch {
    // the snapshot or the pane failed: the pane stays as it was
  }
}

export async function refreshGit($: EngineInterface): Promise<void> {
  try {
    const cwd = await $.session.cwd()
    const base = ['git', '-C', cwd, '--no-optional-locks']
    const status = await $.process.run([...base, 'status', '--porcelain', '-b'], { timeoutMs: 2000 })
    const parsed = status.exitCode === 0 ? parseGitStatus(status.stdout) : undefined
    if (!parsed) {
      return void (await patch($, s => {
        lastPrRead = undefined
        // A process that starts outside any repo has no home one ('').
        return { ...s, cwd, homeRoot: s.homeRoot ?? '', git: undefined, perimeter: undefined, perimeterCheck: undefined, defaultBranch: undefined, repo: undefined }
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
        homeRoot: s.homeRoot ?? (topLevel || undefined),
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
