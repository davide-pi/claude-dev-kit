import type { CockpitAlm, CockpitSnapshot } from '../types'

/** The work items the chat names, once each: `AB#<id>` in the branch name and in the titles of its pull requests. */
export function workItemIds(s: Pick<CockpitSnapshot, 'git' | 'prs'>): number[] {
  const texts = [s.git?.branch ?? '', ...(s.prs ?? []).map(pr => pr.title)]
  const ids = texts.flatMap(text => [...text.matchAll(/AB#(\d+)/g)].map(m => Number(m[1])))
  return [...new Set(ids)].filter(id => Number.isSafeInteger(id) && id > 0)
}

/** The web address of work item `id` in the ALM target's organisation and project; none without both. */
export function workItemUrl(alm: CockpitAlm | undefined, id: number): string | undefined {
  if (!alm?.org || !alm.project) return undefined
  const org = /^https?:\/\//i.test(alm.org) ? alm.org.replace(/\/+$/, '') : `https://dev.azure.com/${encodeURIComponent(alm.org)}`
  return `${org}/${encodeURIComponent(alm.project)}/_workitems/edit/${id}`
}
