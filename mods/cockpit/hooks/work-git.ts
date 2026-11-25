import type { CockpitGit } from '../types'
import { COLORS } from './shared'
import type { Span } from './shared'

/** ` 󰁝2 󰁅1`: the commits ahead of and behind the upstream; empty when level or without an upstream. */
export function aheadBehindSpans(g: CockpitGit): Span[] {
  const parts: Span[] = []
  if (g.ahead) parts.push({ t: `󰁝${g.ahead}`, c: COLORS.green })
  if (g.behind) parts.push({ t: `󰁅${g.behind}`, c: COLORS.yellow })
  return parts.flatMap((p): Span[] => [{ t: ' ' }, p])
}

/** `git status --porcelain -b` -> branch, dirty counts and the upstream with the commits ahead and behind it (none for a branch without one, or whose upstream is gone); undefined outside a repository. */
export function parseGitStatus(
  out: string,
): { branch: string; isDetached: boolean; staged: number; modified: number; untracked: number; upstream?: string; ahead?: number; behind?: number } | undefined {
  const lines = out.split('\n').filter(l => l.length > 0)
  const header = lines[0]?.startsWith('## ') ? (lines.shift() ?? '').slice(3) : ''
  const isDetached = / \(no branch\)$/.test(header)
  const branch = (header.replace(/^(?:No commits yet|Initial commit) on /, '').split('...')[0] ?? '')
    .replace(/ \(no branch\)$/, '')
    .trim()
  if (!branch) return undefined
  let staged = 0
  let modified = 0
  let untracked = 0
  for (const line of lines) {
    if (line.length < 2) continue
    const x = line[0]
    const y = line[1]
    if (x !== ' ' && x !== '?') staged++
    if (y !== ' ' && y !== '?') modified++
    if (line.startsWith('??')) untracked++
  }
  const tracking = /\.\.\.(\S+)(?: \[([^\]]*)\])?\s*$/.exec(header)
  const upstream = tracking?.[2] === 'gone' ? undefined : tracking?.[1]
  const range = tracking?.[2] ?? ''
  const ahead = Number(/ahead (\d+)/.exec(range)?.[1] ?? 0)
  const behind = Number(/behind (\d+)/.exec(range)?.[1] ?? 0)
  return { branch, isDetached, staged, modified, untracked, ...(upstream !== undefined && { upstream, ahead, behind }) }
}

/** `rev-parse --git-dir --git-common-dir --show-toplevel` -> the worktree root inside a linked worktree. */
export function parseWorktree(out: string): string | undefined {
  const [gitDir, commonDir, root] = out.split('\n').map(l => l.trim())
  if (!gitDir || !commonDir || !root) return undefined
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  return norm(gitDir) === norm(commonDir) ? undefined : root
}

const DEFAULT_BRANCHES: readonly string[] = ['main', 'master', 'develop']

/** The branch is a default one: `main`, `master`, `develop` or the repo's own (`defaultBranch`, from `origin/HEAD`). */
export const isDefaultBranch = (branch: string, defaultBranch?: string): boolean =>
  DEFAULT_BRANCHES.includes(branch) || branch === defaultBranch

/** `git symbolic-ref --short refs/remotes/origin/HEAD` -> the repo's default branch (`origin/main` -> `main`); undefined for anything else. */
export const parseDefaultBranch = (out: string): string | undefined => /^origin\/(.+)$/.exec(out.trim())?.[1]

/** An `origin` URL (ssh or https) that points at github.com. */
export const isGithubRemote = (url: string): boolean => /(?:^|[@/])github\.com[:/]/i.test(url.trim())

/** An `origin` URL (ssh or https, the old `visualstudio.com` host too) that points at Azure DevOps. */
export const isAzureRemote = (url: string): boolean => /(?:^|[@/])(?:ssh\.)?dev\.azure\.com[:/]|\.visualstudio\.com[:/]/i.test(url.trim())

/** The project (absent when the remote names none: the project's default repository) and repository of an Azure DevOps remote; undefined for any other URL. */
export function azureRepo(url: string): { project?: string; repo: string } | undefined {
  const u = url.trim()
  if (!isAzureRemote(u)) return undefined
  const decode = (s: string | undefined): string | undefined => {
    if (s === undefined || s === '') return undefined
    try {
      return decodeURIComponent(s)
    } catch {
      return s
    }
  }
  // scheme and user dropped, then host and path segments: `dev.azure.com/<org>/<project>/_git/<repo>`, `ssh.dev.azure.com:v3/<org>/<project>/<repo>`
  const [host = '', ...segs] = u
    .replace(/^[a-z+]+:\/\//i, '')
    .replace(/^[^@/]*@/, '')
    .replace(/[?#].*$/, '')
    .split(/[/:]/)
    .filter(s => s !== '')
  if (segs[0] === 'v3') {
    const repo = decode(segs[3])
    return repo === undefined ? undefined : { project: decode(segs[2]), repo }
  }
  const g = segs.indexOf('_git')
  const repo = g < 0 ? undefined : decode(segs[g + 1])
  if (repo === undefined) return undefined
  // on dev.azure.com the organization comes first, on visualstudio.com it is the host
  const project = decode(segs[g - 1])
  const isOrgOnly = host.endsWith('dev.azure.com') ? g < 2 : g < 1
  return isOrgOnly ? { repo } : { project, repo }
}
