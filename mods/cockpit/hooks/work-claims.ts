import type { CockpitDoneClaim } from '../types'
import { isRecord } from './shared'

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
