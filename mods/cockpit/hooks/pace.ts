import type { EngineInterface } from 'claude-code'

import type { CockpitRateLimit } from '../types'
import { parseReset } from './session'
import { configDir } from './store'

// Usage pace, the mod's side (docs/usage-pace.md): the chat arms `pace/<sid>.json` near the account's limit and creates the resume cron;
// the mod compacts once per arming after the armed window's reset (before `resumeAt`, when the cron resumes the chat), and keeps
// `pace/<sid>.mod.json` alive so the chat reads at its stop band that the mod compacts. It never submits the resume prompt. The pure
// decisions are exported for the tests.

export type PaceWindow = 'five_hour' | 'seven_day'
/** The chat's file, as `pace-state.mjs` writes it (times in epoch ms). */
export type PaceFile = { sessionId: string; window: PaceWindow; resetsAt: number; resumeAt: number; checkpoint: string; ready: boolean; armedAt: number; compactedAt?: number }
/** The mod's file: when it last compacted, and its heartbeat. */
export type ModFile = { compactedAt?: number; aliveAt?: number }

/** Compactions tried (a veto or a turn running) per arming, before the chat's own fallback takes over. */
export const MAX_COMPACT_TRIES = 3
/** How often the mod beats and looks at the pace file: well under the 3 minutes that count it alive. */
export const PACE_TICK_MS = 30_000
/** How long a check waits on a compaction before it lets the heartbeat and the ticks go on; the compaction's outcome still counts when it lands. */
export const COMPACT_WAIT_MS = 120_000
/** The heartbeat runs from this usage of either window, before the chat arms: the chat decides at its 96% band whether the mod is alive. */
export const BEAT_FROM_PCT = 70

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const time = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

/** The chat's file for `sessionId`; another session's, or one without its times, window or checkpoint, is none. */
export function parsePaceFile(value: unknown, sessionId: string): PaceFile | undefined {
  if (!isRecord(value) || value.sessionId !== sessionId) return undefined
  const { window, checkpoint } = value
  const resetsAt = time(value.resetsAt)
  const resumeAt = time(value.resumeAt)
  const armedAt = time(value.armedAt)
  const compactedAt = time(value.compactedAt)
  if ((window !== 'five_hour' && window !== 'seven_day') || typeof checkpoint !== 'string' || resetsAt === undefined || resumeAt === undefined || armedAt === undefined) return undefined
  return { sessionId, window, resetsAt, resumeAt, checkpoint, ready: value.ready === true, armedAt, ...(compactedAt !== undefined && { compactedAt }) }
}

/** The mod's own file: its finite times only; anything else reads empty. */
export function parseModFile(value: unknown): ModFile {
  if (!isRecord(value)) return {}
  const out: ModFile = {}
  for (const key of ['compactedAt', 'aliveAt'] as const) {
    const v = time(value[key])
    if (v !== undefined) out[key] = v
  }
  return out
}

/** An armed chat whose window has reset, before `resumeAt`, not compacted since it armed (by its own `/compact` or by the mod), with tries left. */
export function isCompactDue(pace: PaceFile | undefined, mod: ModFile, tries: number, now: number): boolean {
  if (!pace || tries >= MAX_COMPACT_TRIES || now < pace.resetsAt || now >= pace.resumeAt) return false
  return Math.max(pace.compactedAt ?? -Infinity, mod.compactedAt ?? -Infinity) < pace.armedAt
}

/** A window's percent used at `now`: one past its reset reads 0 (the last reading is the old window's); absent, undefined. */
export function windowPct(rates: readonly CockpitRateLimit[], kind: PaceWindow, now: number): number | undefined {
  const r = rates.find(x => x.kind === kind)
  if (!r) return undefined
  const reset = parseReset(r.resetsAt)
  return reset !== undefined && reset <= now ? 0 : r.percentUsed
}

/** What the summary must keep: the checkpoint's path first and verbatim, so the resumed work finds it. */
export const compactInstructions = (checkpoint: string): string =>
  `Checkpoint: ${checkpoint}\nKeep this path verbatim at the top of the summary: the work resumes from that file after the usage window resets. Keep the task in hand, its files and the next step.`

/** The resume prompt's opening: `pace-state.mjs --arm` prints the cron's whole prompt, which starts with these words. */
export const resumePrompt = (checkpoint: string): string =>
  `The usage window has reset. Read the checkpoint at ${checkpoint} and check the real state (git status, the last test run) before you continue. When the work is finished, run pace-state.mjs --done for this session.`

/** Whether `text` is a resume prompt (the cron's): the person did not type it. */
export const isResumePrompt = (text: string): boolean => text.startsWith(resumePrompt('').split(' at ')[0] ?? '')

// ── The effects: files, compaction, prompt ──

// Per arming (its `armedAt`): the compactions vetoed and whether it compacted (so a mod file that failed to write never repeats it).
// A reload starts them over (and stops the tick until the next session start); the mod file then still holds what was done.
let tries = { armedAt: 0, n: 0, isCompacted: false }
let isBusy = false
let held: ModFile = {}
// the session the state above belongs to: another session starts it over, so one chat's times never reach another's mod file
let forSession: string | undefined
// a compaction still running past COMPACT_WAIT_MS: no second one starts until it lands
let isCompacting = false

/** Back to a fresh start: the tests run one engine after another in one module. */
export function resetPaceState(): void {
  tries = { armedAt: 0, n: 0, isCompacted: false }
  isBusy = false
  held = {}
  forSession = undefined
  isCompacting = false
}

async function paths($: EngineInterface, sid: string): Promise<{ pace: string; mod: string } | undefined> {
  const dir = await configDir($)
  return dir ? { pace: `${dir}/.cache/pace/${sid}.json`, mod: `${dir}/.cache/pace/${sid}.mod.json` } : undefined
}

async function readJson($: EngineInterface, path: string): Promise<unknown> {
  try {
    const text = await $.fs.read(path)
    return JSON.parse(typeof text === 'string' ? text : '')
  } catch {
    return undefined
  }
}

const later = (a?: number, b?: number): number | undefined => (a === undefined ? b : b === undefined ? a : Math.max(a, b))

/** The mod file merged with what this mod last wrote: the later of each time. */
async function readMod($: EngineInterface, path: string): Promise<ModFile> {
  const file = parseModFile(await readJson($, path))
  const out: ModFile = {}
  for (const key of ['compactedAt', 'aliveAt'] as const) {
    const v = later(file[key], held[key])
    if (v !== undefined) out[key] = v
  }
  return out
}

/** Writes the mod file with `change` over what it holds, so a heartbeat never drops a compaction; a failed write is not fatal. */
async function writeMod($: EngineInterface, path: string, change: ModFile): Promise<void> {
  held = { ...(await readMod($, path)), ...change }
  await $.fs.write(path, JSON.stringify({ v: 1, ...held })).catch(() => undefined)
}

/**
 * One look at the pace. The heartbeat, while armed or once either window passes 70%; when armed: the compaction when due (the window
 * reset, `resumeAt` not yet come), after a main turn or on an idle tick. A closed pane at low usage, unarmed, writes nothing.
 */
export async function paceCheck($: EngineInterface, sessionId: string | undefined, rates: readonly CockpitRateLimit[], isIdle: boolean, trigger: 'tick' | 'turn'): Promise<void> {
  if (!sessionId) return
  if (sessionId !== forSession) {
    resetPaceState()
    forSession = sessionId
  }
  if (isBusy) return
  isBusy = true
  try {
    const p = await paths($, sessionId)
    if (!p) return
    const pace = parsePaceFile(await readJson($, p.pace), sessionId)
    const now = await $.clock.now()
    const isNear = (['five_hour', 'seven_day'] as const).some(kind => (windowPct(rates, kind, now) ?? 0) >= BEAT_FROM_PCT)
    if (!pace && !isNear) return
    await writeMod($, p.mod, { aliveAt: now })
    if (!pace) return
    const mod = await readMod($, p.mod)
    if (tries.armedAt !== pace.armedAt) {
      tries = { armedAt: pace.armedAt, n: 0, isCompacted: false }
    }
    if ((trigger === 'turn' || isIdle) && !tries.isCompacted && !isCompacting && isCompactDue(pace, mod, tries.n, now)) {
      // a veto (`skip`) is a try; a turn still running (a reject) is none: the next turn's end or idle tick tries again
      const armedAt = pace.armedAt
      const mine = forSession
      const settle = async (outcome: 'veto' | 'done' | 'busy'): Promise<void> => {
        isCompacting = false
        if (forSession !== mine || tries.armedAt !== armedAt) return
        if (outcome === 'veto') tries = { ...tries, n: tries.n + 1 }
        if (outcome === 'done') {
          tries = { ...tries, isCompacted: true }
          await writeMod($, p.mod, { compactedAt: await $.clock.now() })
        }
      }
      isCompacting = true
      const compacting = $.session.compact({ instructions: compactInstructions(pace.checkpoint) }).then(r => (r?.skip ? 'veto' : 'done') as const, () => 'busy' as const)
      // a compaction that never lands must not hold the check: past the wait the heartbeat and the ticks go on, and its outcome counts when it lands
      const outcome = await Promise.race([compacting, new Promise<'slow'>(resolve => $.clock.after(COMPACT_WAIT_MS, () => resolve('slow')))])
      if (outcome === 'slow') void compacting.then(settle).catch(() => undefined)
      else await settle(outcome)
    }
  } finally {
    isBusy = false
  }
}
