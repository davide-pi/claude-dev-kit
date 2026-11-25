import type { CockpitPr } from '../types'
import { isRecord } from './shared'
import { azureUrl, prState, safeUrl } from './work-pr-read'

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
