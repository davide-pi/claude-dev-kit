import type { CockpitTrailEntry } from '../types'
import { baseName } from './shared'

/** A subagent's trail keeps this many calls. */
const TRAIL_KEEP = 8
const LABEL_MAX = 40

const text = (input: { readonly [key: string]: unknown }, key: string): string | undefined => {
  const v = input[key]
  return typeof v === 'string' && v.trim() !== '' ? v : undefined
}

/** The short target of a call, from its own arguments: never the raw command or a whole path (a shell tool shows its `description` only). */
export function trailLabel(tool: string, input: { readonly [key: string]: unknown }): string | undefined {
  const file = text(input, 'file_path') ?? text(input, 'notebook_path') ?? text(input, 'path')
  const pattern = text(input, 'pattern')
  const raw =
    tool === 'Bash' || tool === 'PowerShell'
      ? text(input, 'description')
      : (tool === 'Agent' ? (text(input, 'subagent_type') ?? text(input, 'subagentType')) : undefined) ?? text(input, 'skill') ?? (tool === 'Glob' && pattern !== undefined ? baseName(pattern) : pattern) ?? (file === undefined ? undefined : baseName(file))
  const one = raw?.replace(/\s+/g, ' ').trim()
  return one === undefined || one === '' ? undefined : [...one].slice(0, LABEL_MAX).join('')
}

/** `trail` with a call in flight added: the last 8 are kept, oldest dropped. */
export const startTrail = (trail: readonly CockpitTrailEntry[] | undefined, tool: string, label: string | undefined, at: number): CockpitTrailEntry[] =>
  [...(trail ?? []), { tool, ...(label !== undefined && { label }), at }].slice(-TRAIL_KEEP)

/** `trail` with the call that began at `at` marked done, or failed. */
export const endTrail = (trail: readonly CockpitTrailEntry[] | undefined, tool: string, at: number, isFailed: boolean): CockpitTrailEntry[] | undefined => {
  const i = trail?.findLastIndex(c => c.tool === tool && c.at === at && c.isDone !== true) ?? -1
  return trail?.map((c, j) => (j === i ? { ...c, isDone: true, ...(isFailed && { isFailed: true }) } : c))
}
