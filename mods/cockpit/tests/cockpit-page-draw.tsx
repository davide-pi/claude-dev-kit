import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { emptyInsights } from '../hooks/insights'
import { INITIAL } from '../hooks/state'
import { makeKit } from '../hooks/view-kit'
import type { Block, Kit, PaneActions } from '../hooks/view-kit'
import type { CockpitAgent, CockpitSnapshot } from '../types'
import { NOW, rowTexts } from './cockpit-world'

export const WIDTH = 60
export const PAGE = {
  plugin: 'test',
  component: 'Pane',
  requestId: 'page',
  props: { title: 'page', isFocused: false, bodyColumns: WIDTH, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
  surface: 'terminal',
} as const

export const snap = (over: Partial<CockpitSnapshot> = {}): CockpitSnapshot => ({ ...INITIAL, now: NOW, openKeys: ['log:all'], ...over })
export const agent = (id: string, type: string, over: Partial<CockpitAgent> = {}): CockpitAgent => ({ id, type, status: 'running', startedAt: NOW - 62_000, tokens: 0, model: 'claude-sonnet-5-5', ...over })
export const insights = (over: object = {}) => ({ ...emptyInsights(), ...over })

/** The keys of the drawn Buttons that match `re`. */
export const keysOf = async (ui: Awaited<ReturnType<Engine['ui']['mount']>>, re: RegExp) => (await ui.findAll({ type: 'Button' })).map(b => b.key ?? '').filter(k => re.test(k))

/** Whether the first leaf Text whose content matches `re` is bold. */
export const boldOf = (root: unknown, re: RegExp): boolean | undefined => {
  const o = root as { type?: string; props?: { weight?: string; props?: { cells?: { t: string; bold?: boolean }[] } }; children?: unknown[] } | null
  const [only] = o?.children ?? []
  if (typeof only === 'string' && re.test(only)) return o?.props?.weight === 'bold'
  // an animated cell (surface module) holds the spans it draws in its props
  if (o?.type === 'Client') {
    const cell = o.props?.props?.cells?.find(c => re.test(c.t))
    if (cell !== undefined) return cell.bold === true
  }
  for (const c of o?.children ?? []) {
    const found = boldOf(c, re)
    if (found !== undefined) return found
  }
  return undefined
}

export const flat = (b: readonly unknown[]): unknown[] => b.flatMap(x => (Array.isArray(x) ? flat(x) : [x]))

export type Slot = { s: CockpitSnapshot; build: (k: Kit) => Block[]; calls: string[] }
export type Draws = { slots: Map<string, Slot>; next: number }
export const DRAWS = new WeakMap<object, Draws>()

/** Draws what a section builder returns in a pane of its own; `calls` records every action the page presses, `name:args`. */
export async function draw($: Engine, on: On, s: CockpitSnapshot, build: (k: Kit) => Block[], calls: string[] = []) {
  // one hook per test, registered before the first call on `$`; each draw is a pane of its own id
  let d = DRAWS.get(on)
  if (d === undefined) {
    const own: Draws = { slots: new Map(), next: 0 }
    d = own
    DRAWS.set(on, own)
    on('ui.render', { component: 'Pane' }, ($$, e, next) => {
      const slot = own.slots.get(e.requestId ?? '')
      if (slot === undefined) return next(e)
      // the harness cannot load a surface module for this test plugin: the page is drawn as a surface without them draws it
      const ui = { ...$$.ui.resolve(e), Client: undefined }
      const { Box } = ui
      const actions = new Proxy({}, { get: (_, name) => (...args: unknown[]) => void slot.calls.push(`${String(name)}:${args.join(',')}`) }) as PaneActions
      return <Box flexDirection="column">{flat(slot.build(makeKit(ui, slot.s, WIDTH, actions))) as never}</Box>
    })
  }
  const requestId = `page${d.next++}`
  d.slots.set(requestId, { s, build, calls })
  const ui = await $.ui.mount({ ...PAGE, requestId })
  const rows = rowTexts(await ui.drawn()).map(r => r.trimEnd())
  return { ui, rows }
}

export const SINCE = NOW - 120_000
export const WAITING = { kind: 'waiting', since: SINCE } as const

/** A section's title row: the title, a space, a rule to the width. */
export const titled = (label: string) => `${label} ${'─'.repeat(WIDTH - [...label].length - 1)}`


export const LONG_SPEND = () => snap({ cost: { usd: 10 }, agentSpend: { 'code-reviewer': 2.5, implementer: 2.5, Plan: 1 }, insights: insights({ rounds: 3, usd: 6 }) })
