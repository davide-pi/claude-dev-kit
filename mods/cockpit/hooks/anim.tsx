import type { ClientModule } from 'claude-code'

import { COLORS } from './shared'
import type { Span } from './shared'
import type { SignalSeverity } from './signals'

// A few cells drawn with a pattern on a surface clock of their own: terminal animations as discrete colour or glyph steps.
// The pure parts (which frame at which step, which cells qualify) are exported for the tests; the module below only runs the clock.
export type AnimKind = 'breathe' | 'blink' | 'flash3' | 'once' | 'spin' | 'fade' | 'pulse' | 'beat'
export type BeatSpeed = 'slow' | 'fast'
/** `cells` is the still look (what a surface without the module draws); `token` names a value, so a change of it restarts a `once`; `speed` is a `beat`'s. */
export type AnimProps = { kind: AnimKind; cells: Span[]; token?: string; speed?: BeatSpeed }

/** One frame is this long. */
export const STEP_MS = 90
/** A breath: dim, full, dim again (~2 s). */
const BREATHE_STEPS = 22
/** Steps a blink stays red, and steps it stays dim (~540 ms). */
const BLINK_HALF = 6
/** Steps a flash is lit, and dark; three of them (~2.2 s), then the icon stays lit. */
const FLASH_HALF = 4
const FLASH_STEPS = 3 * 2 * FLASH_HALF
/** A changed value stays bold in the accent for this many steps (~1.5 s). */
const ONCE_STEPS = 17
/** The newest FATTO row fades from its highlight to its own colour in this many steps (~2 s). */
const FADE_STEPS = 22
const PULSE_HALF = 8
/** A beat's period (lit for the first half, dim for the second); the fast one is half the slow one, so every fast cycle lines up with a slow one. */
export const BEAT_SLOW_MS = 1600
export const BEAT_FAST_MS = BEAT_SLOW_MS / 2
/** How often a beat looks at the clock. */
const BEAT_TICK_MS = 50
/** How far a beat's dim half goes from the figure's colour towards the quiet grey. */
const BEAT_DIM = 0.55
const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
/** Intermediate colours of a breath or a fade, besides its two ends. */
const LEVELS = 3

const ACCENT = COLORS.blue
const FADE_FROM = COLORS.blue

/** A signal younger than this flashes its icon. */
export const FLASH_WINDOW_MS = 5000
/** The newest FATTO row is highlighted while younger than this. */
export const FADE_WINDOW_MS = FADE_STEPS * STEP_MS

// ── Which elements animate ──

/** A blocking signal blinks for as long as it stands; a new one (younger than `FLASH_WINDOW_MS`) flashes three times; any other stays still. */
export function signalAnim(severity: SignalSeverity, at: number | undefined, now: number): 'blink' | 'flash3' | undefined {
  if (severity === 'block') return 'blink'
  return at !== undefined && now >= at && now - at < FLASH_WINDOW_MS ? 'flash3' : undefined
}

/** A percent figure beats by its colour's band: green is quiet, the middle band (yellow, amber, orange) beats slowly, red fast. */
export function beatSpeed(color: string | undefined): BeatSpeed | undefined {
  if (color === COLORS.red) return 'fast'
  return color === COLORS.yellow || color === COLORS.amber || color === COLORS.orange ? 'slow' : undefined
}

/** A beat's step at clock time `now`: 0 lit, 1 dim. From the clock alone, so beats mounted at different moments flash together. */
export const beatStep = (speed: BeatSpeed | undefined, now: number): number => {
  const period = speed === 'fast' ? BEAT_FAST_MS : BEAT_SLOW_MS
  return (now % period) / period < 0.5 ? 0 : 1
}

/** The header's state glyph breathes while Claude works or waits. */
export const isBreathing = (state: string | undefined): boolean => state === 'working' || state === 'waiting'

/** The newest FATTO row is highlighted for its first seconds. */
export const isFading = (at: number, now: number): boolean => now >= at && now - at < FADE_WINDOW_MS

// ── Which frame at which step ──

/** Steps of a kind: a one-shot ends, the others go on while the module is drawn. */
export const isAnimating = (kind: AnimKind, step: number): boolean => (kind === 'flash3' ? step < FLASH_STEPS : kind === 'once' ? step < ONCE_STEPS : kind === 'fade' ? step < FADE_STEPS : true)

/** The step a kind starts at: a `once` starts finished, so the first reading of a value never animates. */
const initialStep = (kind: AnimKind): number => (kind === 'once' ? ONCE_STEPS : 0)

const HEX = /^#[0-9a-f]{6}$/i
const channel = (hex: string, i: number): number => parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16)

/** `from` moved `k` (0..1) of the way to `to`; a colour that is not `#rrggbb` (the theme's own) stays `to`. */
export function mixHex(from: string, to: string, k: number): string {
  if (!HEX.test(from) || !HEX.test(to)) return to
  return `#${[0, 1, 2].map(i => Math.round(channel(from, i) + (channel(to, i) - channel(from, i)) * k).toString(16).padStart(2, '0')).join('')}`
}

const isBlank = (s: Span): boolean => s.t.trim() === ''
const dimmed = (s: Span): Span => (s.dim || isBlank(s) ? s : { ...s, c: COLORS.dim })
const toned = (cells: readonly Span[], color: (s: Span) => string): Span[] => cells.map(s => (s.dim || isBlank(s) ? s : { ...s, c: color(s) }))

/** 0..1..0 over a breath, in `LEVELS + 1` steps. */
const breath = (step: number): number => {
  const phase = (step % BREATHE_STEPS) / BREATHE_STEPS
  return Math.round((phase < 0.5 ? phase * 2 : (1 - phase) * 2) * LEVELS) / LEVELS
}

/** The cells as they look at `step` of `kind`. */
export function frame(kind: AnimKind, step: number, cells: readonly Span[]): Span[] {
  const isLit = (half: number) => Math.floor(step / half) % 2 === 0
  switch (kind) {
    case 'breathe':
      return toned(cells, s => mixHex(COLORS.dim, s.c ?? COLORS.text, breath(step)))
    case 'blink':
      return isLit(BLINK_HALF) ? [...cells] : cells.map(dimmed)
    case 'flash3':
      return step >= FLASH_STEPS || isLit(FLASH_HALF) ? [...cells] : cells.map(dimmed)
    case 'pulse':
      return isLit(PULSE_HALF) ? toned(cells, () => COLORS.orange) : cells.map(dimmed)
    case 'beat':
      return step % 2 === 0 ? [...cells] : toned(cells, s => mixHex(s.c ?? COLORS.text, COLORS.empty, BEAT_DIM))
    case 'once':
      return step >= ONCE_STEPS ? [...cells] : cells.map(s => (isBlank(s) ? s : { ...s, c: ACCENT, bold: true, dim: false }))
    case 'fade':
      return step >= FADE_STEPS ? [...cells] : toned(cells, s => mixHex(FADE_FROM, s.c ?? COLORS.text, Math.floor((step * (LEVELS + 1)) / FADE_STEPS) / LEVELS))
    case 'spin':
      return cells.map((s, i) => (i === 0 ? { ...s, t: SPIN[step % SPIN.length] ?? s.t } : s))
  }
}

// ── The module's state ──

export type AnimState = { kind: AnimKind; step: number; token?: string; speed?: BeatSpeed }

/** The state after a reading: the first one starts the kind; a `once` whose value changed starts over; a different kind starts afresh. */
export function reconcile(state: AnimState | undefined, kind: AnimKind, token?: string, speed?: BeatSpeed): AnimState {
  if (!state || state.kind !== kind) return { kind, step: initialStep(kind), token, speed }
  if (kind === 'once' && state.token !== undefined && token !== undefined && state.token !== token) return { kind, step: 0, token, speed }
  return state.token === token && state.speed === speed ? state : { ...state, token, speed }
}

const Anim: ClientModule<AnimProps, AnimState> = (props, surface) => {
  const { Text } = surface.elements
  const state = surface.state
  const next = reconcile(state, props.kind, props.token, props.speed)
  // One clock for the instance's life: a tick redraws only while its kind still has steps to show (a finished one-shot goes idle).
  // A beat takes its step from the wall clock, not from a count of its own, and redraws only when the step changes.
  if (!state) {
    surface.every(props.kind === 'beat' ? BEAT_TICK_MS : STEP_MS, () => {
      const now = surface.state
      if (!now) return
      if (now.kind === 'beat') {
        const step = beatStep(now.speed, Date.now())
        if (step !== now.step) surface.setState({ ...now, step })
      } else if (isAnimating(now.kind, now.step)) surface.setState({ ...now, step: now.step + 1 })
    })
    surface.setState(next)
  } else if (next !== state) surface.setState(next)
  const step = next.kind === 'beat' ? beatStep(next.speed, Date.now()) : next.step
  return (
    <Text wrap="truncate">
      {frame(next.kind, step, props.cells).map((s, i) => (
        <Text key={i} color={s.c} dimColor={s.dim} weight={s.bold ? 'bold' : undefined}>
          {s.t}
        </Text>
      ))}
    </Text>
  )
}

export default Anim
