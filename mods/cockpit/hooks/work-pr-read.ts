import type { CockpitPr } from '../types'
import { isRecord } from './shared'

/** A pull request's state from a CLI's words: `gh` (`OPEN`, `MERGED`, `CLOSED`) and `az` (`active`, `completed`, `abandoned`), a draft being an open one flagged so; none for words it does not know. */
export function prState(status: unknown, isDraft: unknown): CockpitPr['state'] {
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
export function azureUrl(pr: Record<string, unknown>, number: number): { url?: string } {
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
