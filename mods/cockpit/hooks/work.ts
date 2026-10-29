import type { CockpitChange, CockpitDoneClaim, CockpitGit, CockpitPerimeterCheck, CockpitPr } from '../types'
import { COLORS, isRecord } from './shared'
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

/** A pull request's state from a CLI's words: `gh` (`OPEN`, `MERGED`, `CLOSED`) and `az` (`active`, `completed`, `abandoned`), a draft being an open one flagged so; none for words it does not know. */
function prState(status: unknown, isDraft: unknown): CockpitPr['state'] {
  const word = typeof status === 'string' ? status.toLowerCase() : ''
  if (word === 'open' || word === 'active') return isDraft === true ? 'draft' : 'open'
  if (word === 'merged' || word === 'completed') return 'merged'
  if (word === 'closed' || word === 'abandoned') return 'closed'
  return undefined
}

/** `gh pr view --json number,title,url,state,isDraft` -> the pull request as a link (number, title, address, state); undefined for any other text. */
export function parseGithubPr(out: string): CockpitPr | undefined {
  try {
    const parsed: unknown = JSON.parse(out)
    if (!isRecord(parsed)) return undefined
    const { number, title, url } = parsed
    if (typeof number !== 'number' || !Number.isInteger(number) || number <= 0) return undefined
    const link = safeUrl(url)
    const state = prState(parsed.state, parsed.isDraft)
    return { number, title: typeof title === 'string' ? title : '', ...(link !== undefined && { url: link }), ...(state !== undefined && { state }) }
  } catch {
    return undefined
  }
}

/** `value` when it is an http(s) address without control characters (what a pull request's link may point to); none otherwise. */
export function safeUrl(value: unknown): string | undefined {
  return typeof value === 'string' && /^https?:\/\/\S/i.test(value) && !/[\u0000-\u001f\u007f-\u009f]/.test(value) ? value : undefined
}

/** The `url` of an `az` pull request record: its repository's web address and the pull request's path; nothing when the record names no safe address. */
function azureUrl(pr: Record<string, unknown>, number: number): { url?: string } {
  const webUrl = isRecord(pr.repository) ? safeUrl(pr.repository.webUrl)?.replace(/\/+$/, '') : undefined
  return webUrl === undefined ? {} : { url: `${webUrl}/pullrequest/${number}` }
}

/**
 * `az repos pr list --output json` (the first pull request of the list) or `az repos pr show` (the one record) -> the pull request as a link.
 * The address is the repository's web address with the pull request's path, when the record names one.
 */
export function parseAzurePr(out: string): CockpitPr | undefined {
  try {
    const parsed: unknown = JSON.parse(out)
    const pr = Array.isArray(parsed) ? parsed[0] : parsed
    if (!isRecord(pr)) return undefined
    const { pullRequestId: number, title } = pr
    if (typeof number !== 'number' || !Number.isInteger(number) || number <= 0) return undefined
    const state = prState(pr.status, pr.isDraft)
    return { number, title: typeof title === 'string' ? title : '', ...azureUrl(pr, number), ...(state !== undefined && { state }) }
  } catch {
    return undefined
  }
}

/** When the pull request of `gh pr view --json …,createdAt` or of `az repos pr list` / `show` (`creationDate`) was opened, in ms; undefined when the text names no date. */
export function parsePrCreatedAt(out: string): number | undefined {
  try {
    const parsed: unknown = JSON.parse(out)
    const pr = Array.isArray(parsed) ? parsed[0] : parsed
    if (!isRecord(pr)) return undefined
    const at = typeof pr.createdAt === 'string' ? pr.createdAt : pr.creationDate
    const ms = typeof at === 'string' ? Date.parse(at) : Number.NaN
    return Number.isFinite(ms) ? ms : undefined
  } catch {
    return undefined
  }
}

// ── The Work tab: the changed files, the diff of one ──

/** `git diff --numstat --no-renames -z HEAD --` then the untracked paths -> the changed files; a binary file has `-` counts. */
export function parseNumstat(out: string, untracked: readonly string[]): CockpitChange[] {
  const tracked = out.split('\0').flatMap((entry): CockpitChange[] => {
    const m = /^(\d+|-)\t(\d+|-)\t([\s\S]+)$/.exec(entry)
    const [, added, deleted, path] = m ?? []
    if (added === undefined || deleted === undefined || path === undefined) return []
    return [added === '-' || deleted === '-' ? { path, isBinary: true } : { path, added: Number(added), deleted: Number(deleted) }]
  })
  return [...tracked, ...untracked.map((path): CockpitChange => ({ path, isUntracked: true }))]
}

/** What one drawing of `Code` takes (100000 characters in all), with room to spare. */
export const DIFF_MAX = 90_000

/** The control characters `Code` refuses (tab and newline are its only ones): carriage returns and the like go. */
const CONTROL = /[\0-\x08\x0b-\x1f\x7f]/g

/** A `git diff` without the lines before its `---` (the engine's parser starts at the file pair); empty when there is no hunk to draw (a binary file). */
export function diffHunks(raw: string): string {
  const text = raw.replace(CONTROL, '')
  if (text.startsWith('--- ')) return text
  const at = text.indexOf('\n--- ')
  return at < 0 ? '' : text.slice(at + 1)
}

/** `kept`, cut at a line inside its last hunk, with that hunk's `@@ -a,b +c,d @@` counts rewritten to the lines kept (a hunk that claims more lines than it has does not parse). */
function recountLastHunk(kept: string): string {
  const lines = kept.split('\n')
  let at = lines.length - 1
  while (at >= 0 && !lines[at]?.startsWith('@@ ')) at--
  const head = at < 0 ? undefined : /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(lines[at] ?? '')
  if (!head) return kept
  let before = 0
  let after = 0
  for (const l of lines.slice(at + 1)) {
    if (l.startsWith('-')) before++
    else if (l.startsWith('+')) after++
    else if (l.startsWith(' ')) {
      before++
      after++
    }
  }
  lines[at] = `@@ -${head[1]},${before} +${head[2]},${after} @@${head[3]}`
  return lines.join('\n')
}

/** What `cmd` reads as text: letters, digits, spaces and the punctuation of a URL, a ref or a name (`&`, `|`, `%`, `^`, quotes and the like are left out). */
const CMD_SAFE = /^[\p{L}\p{N} _./@+=,:#-]*$/u

/**
 * The argument vector that runs the Azure CLI with `args`. `$.process.run` starts a command with no shell, and on Windows
 * the CLI is `az.cmd`, which cannot be started by name: it goes through `cmd /d /s /c`. Then an argument `cmd` would read
 * as more than text (a branch named `a&b`) is never handed to it: undefined, and the call is not made.
 */
export function azArgv(args: readonly string[], isWindows: boolean): string[] | undefined {
  if (!isWindows) return ['az', ...args]
  return args.every(a => CMD_SAFE.test(a)) ? ['cmd', '/d', '/s', '/c', 'az', ...args] : undefined
}

/** `text` cut to `max` characters before a hunk when it has one before the limit, else at a line of its first hunk, whose header is recounted: a diff cut mid-hunk does not parse. */
export function capDiff(text: string, max: number = DIFF_MAX): { text: string; isCut: boolean } {
  if (text.length <= max) return { text, isCut: false }
  const hunk = text.lastIndexOf('\n@@', max)
  if (hunk > text.indexOf('@@')) return { text: text.slice(0, hunk + 1), isCut: true }
  const line = text.lastIndexOf('\n', max - 1)
  return { text: recountLastHunk(line < 0 ? text.slice(0, max) : text.slice(0, line + 1)), isCut: true }
}

/** An untracked file as a diff of added lines (empty for an empty file: git shows no hunk for it either). */
export function additionsDiff(file: string, raw: string): string {
  const lines = raw.replace(CONTROL, '').split('\n')
  if (lines.at(-1) === '') lines.pop()
  if (lines.length === 0) return ''
  return `--- /dev/null\n+++ b/${file}\n@@ -0,0 +1,${lines.length} @@\n${lines.map(l => `+${l}`).join('\n')}\n`
}

/** `deliver`'s perimeter file -> its entries, when it is active and for `branch` (as `hooks/scope-guard.js` reads it); else undefined. */
export function parsePerimeter(text: string, branch: string): string[] | undefined {
  const entries: string[] = []
  let fileBranch = ''
  let isActive = false
  for (const raw of text.split(/\r?\n/)) {
    const l = raw.trim()
    const b = /^branch:\s*(.+)$/i.exec(l)
    if (b) fileBranch = (b[1] ?? '').trim()
    else if (/^status:\s*active\s*$/i.test(l)) isActive = true
    else if (l.startsWith('- ') && l.slice(2).trim()) entries.push(l.slice(2).trim())
  }
  return isActive && entries.length > 0 && fileBranch !== '' && fileBranch === branch ? entries : undefined
}

const slashes = (p: string): string => p.trim().replace(/\\/g, '/').replace(/^\.\//, '')

/** A perimeter entry as a regex over a repo-relative path: a file, a directory (trailing `/`) or a glob; anchored, case-insensitive (as `hooks/scope-guard.js`). */
function entryRegex(entry: string): RegExp {
  let e = slashes(entry)
  if (e.endsWith('/')) e += '**'
  const src = e
    .replace(/[.+^${}()|[\]]/g, '\\$&')
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\u0000/g, '.*')
    .replace(/\?/g, '[^/]')
  return new RegExp(`^${src}$`, 'i')
}

/**
 * How many of the `changed` files (repo-relative, tracked and untracked) there are, and which of them the perimeter `entries`
 * do not cover: what `hooks/scope-guard.js --check` lists (a plan under `docs/plans/` and `.git/` are never outside).
 */
export function checkPerimeter(changed: readonly string[], entries: readonly string[]): CockpitPerimeterCheck {
  const regexes = entries.map(entryRegex)
  const seen = new Set<string>()
  const outside: string[] = []
  for (const raw of changed) {
    const p = slashes(raw)
    if (!p || seen.has(p)) continue
    seen.add(p)
    const lower = p.toLowerCase()
    if (lower.startsWith('docs/plans/') || lower.startsWith('.git/') || regexes.some(r => r.test(p))) continue
    outside.push(p)
  }
  return { files: seen.size, outside }
}

// ── The done-claim hook's log ────────────────────────────────────────────────

/** Entries kept from the log (the session's own) and shown. */
const CLAIMS_KEEP = 30
export const CLAIMS_SHOWN = 3
const CLAIM_EXCERPT_MAX = 160
/** The rules whose entry is a turn the hook sent back; the others (`shell-ran`, the old `tail-truncated`) were only counted. */
const BLOCK_RULES: readonly string[] = ['unproven-row', 'tail-cut', 'claim-without-evidence']

/** The last `CLAIMS_KEEP` entries of `done-claim.log` (one JSON object each) of session `sessionId` that were blocks, newest first; a line without `at` and `rule` is skipped. */
export function parseDoneClaims(text: string, sessionId: string | undefined): CockpitDoneClaim[] {
  if (sessionId === undefined) return []
  const out: CockpitDoneClaim[] = []
  for (const l of text.split(/\r?\n/).reverse()) {
    if (out.length === CLAIMS_KEEP) break
    try {
      const v: unknown = JSON.parse(l)
      if (!isRecord(v) || v.session !== sessionId || typeof v.at !== 'string' || typeof v.rule !== 'string' || !BLOCK_RULES.includes(v.rule)) continue
      out.push({ at: v.at, session: sessionId, rule: v.rule, excerpt: typeof v.excerpt === 'string' ? v.excerpt.trim().slice(0, CLAIM_EXCERPT_MAX) : '' })
    } catch {
      // a torn or foreign line
    }
  }
  return out
}

/** The last `CLAIMS_SHOWN` blocks of session `sessionId`, newest first. */
export const claimsOf = (claims: readonly CockpitDoneClaim[] | undefined, sessionId: string | undefined): CockpitDoneClaim[] =>
  sessionId === undefined ? [] : (claims ?? []).filter(c => c.session === sessionId).slice(0, CLAIMS_SHOWN)

const GH_PR_CREATE = /\bgh\s+pr\s+create\b/
const AZ_PR_CREATE = /\baz\s+repos\s+pr\s+create\b/

/** The part of `command` from `from` to the next `;`, `|`, `&` or line break outside quotes: the command that starts there, without the rest of a compound one. */
function commandSegment(command: string, from: number): string {
  let quote = ''
  for (let i = from; i < command.length; i++) {
    const ch = command.charAt(i)
    if (quote !== '') {
      if (ch === quote) quote = ''
    } else if (ch === '"' || ch === "'") {
      quote = ch
    } else if (ch === ';' || ch === '|' || ch === '&' || ch === '\n') {
      return command.slice(from, i)
    }
  }
  return command.slice(from)
}

/** The words of `segment` as a shell splits them (quotes removed), each with whether it began inside quotes: such a word is an argument's text, never a flag. */
function shellWords(segment: string): { text: string; isQuoted: boolean }[] {
  const words: { text: string; isQuoted: boolean }[] = []
  let text = ''
  let isQuoted = false
  let isStarted = false
  let quote = ''
  for (const ch of segment) {
    if (quote !== '') {
      if (ch === quote) quote = ''
      else text += ch
    } else if (ch === '"' || ch === "'") {
      if (!isStarted) isQuoted = true
      isStarted = true
      quote = ch
    } else if (/\s/.test(ch)) {
      if (isStarted) words.push({ text, isQuoted })
      text = ''
      isQuoted = false
      isStarted = false
    } else {
      isStarted = true
      text += ch
    }
  }
  if (isStarted) words.push({ text, isQuoted })
  return words
}

/** The value of the first of `flags` in a command segment (`--flag value` or `--flag=value`): only unquoted words are flags, and a flag's own value is not read as one. */
function flagValue(segment: string, flags: readonly string[]): string | undefined {
  const words = shellWords(segment)
  let found: string | undefined
  for (let i = 0; i < words.length; i++) {
    const word = words[i]
    if (!word || word.isQuoted) continue
    const eq = word.text.indexOf('=')
    if (eq > 0 && flags.includes(word.text.slice(0, eq))) found ??= word.text.slice(eq + 1)
    else if (flags.includes(word.text)) {
      const value = words[i + 1]
      if (value) {
        found ??= value.text
        i++
      }
    }
  }
  return found
}

/** The title of a `gh pr create` command segment. */
const createTitle = (segment: string): string => flagValue(segment, ['--title', '-t']) ?? ''

/**
 * The `url` of the pull request an `az repos pr create` segment made, from its organization, project and repository flags: what
 * the output names when its `--query` dropped the repository. Nothing when a flag is missing or is a shell variable or expression.
 */
function azureCreateUrl(segment: string, number: number): { url?: string } {
  const [org, project, repo] = [['--organization', '--org'], ['--project', '-p'], ['--repository', '-r']].map(flags => flagValue(segment, flags))
  if (!org || !project || !repo || [org, project, repo].some(v => /[$`()%]/.test(v))) return {}
  const base = /^https?:\/\//i.test(org) ? org.replace(/\/+$/, '') : `https://dev.azure.com/${encodeURIComponent(org)}`
  const url = safeUrl(`${base}/${encodeURIComponent(project)}/_git/${encodeURIComponent(repo)}/pullrequest/${number}`)
  return url === undefined ? {} : { url }
}

/**
 * The pull request that `command` created, from what it printed: `gh pr create` prints the pull request's URL (the title is
 * the one the command gave, none for `--fill`); `az repos pr create` prints the pull request as JSON. Undefined for any
 * other command, or output that names no pull request.
 */
export function parseCreatedPr(command: string, out: string): CockpitPr | undefined {
  const gh = GH_PR_CREATE.exec(command)
  if (gh) {
    const found = /https?:\/\/\S+\/pull\/(\d+)/.exec(out)
    const number = Number(found?.[1])
    if (!found || !Number.isInteger(number) || number <= 0) return undefined
    // The flag is the create command's own: a `-t` of another command of the line is not.
    const title = createTitle(commandSegment(command, gh.index))
    const url = safeUrl(found[0])
    return { number, title, ...(url !== undefined && { url }) }
  }
  const az = AZ_PR_CREATE.exec(command)
  if (az) {
    try {
      const pr: unknown = JSON.parse(out.slice(Math.max(0, out.indexOf('{'))))
      if (!isRecord(pr)) return undefined
      const { pullRequestId: number, title } = pr
      if (typeof number !== 'number' || !Number.isInteger(number) || number <= 0) return undefined
      const link = azureUrl(pr, number)
      return { number, title: typeof title === 'string' ? title : '', ...(link.url === undefined ? azureCreateUrl(commandSegment(command, az.index), number) : link) }
    } catch {
      return undefined
    }
  }
  return undefined
}

/** The pull requests of a chat that the list keeps (the state file persists them). */
export const PRS_KEEP = 10

/** `pr` joins `list`, or replaces the entry it is a newer reading of (the same url, or the same number when one side has no url); the list keeps the last ten. */
export function upsertPr(list: readonly CockpitPr[] | undefined, pr: CockpitPr): CockpitPr[] {
  const prs = list ?? []
  const isSame = (a: CockpitPr) => (a.url !== undefined && pr.url !== undefined ? a.url === pr.url : a.number === pr.number)
  const i = prs.findIndex(isSame)
  const next = i < 0 ? [...prs, pr] : prs.map((a, j) => (j === i ? { ...a, ...pr, url: pr.url ?? a.url } : a))
  return next.slice(-PRS_KEEP)
}

/** The pull requests out of a parsed state file: the entries with a number and a title (any other field a guess is made for), in order; none for anything else. */
export function parseSavedPrs(value: unknown): CockpitPr[] {
  if (!Array.isArray(value)) return []
  const out: CockpitPr[] = []
  for (const v of value.slice(-PRS_KEEP)) {
    if (!isRecord(v)) continue
    const { number, title, url } = v
    if (typeof number !== 'number' || !Number.isInteger(number) || number <= 0 || typeof title !== 'string') continue
    const link = safeUrl(url)
    const state = v.state === 'draft' ? 'draft' : prState(v.state, false)
    out.push({ number, title, ...(link !== undefined && { url: link }), ...(state !== undefined && { state }) })
  }
  return out
}

const EDIT_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit']
export const EDITED_KEEP = 200

/** The file an edit call writes, from its input (forward slashes); none for any other call. */
export function editedPathOf(input: { readonly [key: string]: unknown }): string | undefined {
  const path = typeof input.file_path === 'string' ? input.file_path : input.notebook_path
  return typeof input.tool === 'string' && EDIT_TOOLS.includes(input.tool) && typeof path === 'string' && path !== '' ? path.replace(/\\/g, '/') : undefined
}

/** `list` with `path` added once; the oldest go past `EDITED_KEEP`. */
export const recordEdited = (list: readonly string[] | undefined, path: string): string[] =>
  list?.includes(path) ? [...list] : [...(list ?? []), path].slice(-EDITED_KEEP)

/** `path` made relative to `root` (the checkout's top level), the way git lists a file; none when it lies outside. The match ignores case: Windows paths do. */
export function repoRelative(root: string | undefined, path: string): string | undefined {
  if (!root) return undefined
  const base = root.replace(/\\/g, '/').replace(/\/+$/, '')
  return path.toLowerCase().startsWith(`${base.toLowerCase()}/`) ? path.slice(base.length + 1) : undefined
}

/** The saved edited paths out of a parsed data file: the strings of the list, the newest `EDITED_KEEP`; none for anything else. */
export function parseEdited(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const paths = value.filter((v): v is string => typeof v === 'string' && v !== '').slice(-EDITED_KEEP)
  return paths.length > 0 ? paths : undefined
}
