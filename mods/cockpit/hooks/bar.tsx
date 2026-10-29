import type { ClientModule } from 'claude-code'

import { withGlow, withPulse } from './shared'
import type { Span } from './shared'

// A budget bar (the CTX fill, a credit window) as a surface module: its flow and its pulse move on the surface's own frame clock, so they redraw this region alone, not the pane.
// `isFlowing` lights the flow glow; `tone` is the bar's colour, and when it changes (a credit window crossing a threshold) the whole fill pulses, then stops. No `tone`: no pulse.
export type BarProps = { cells: Span[]; isFlowing: boolean; tone?: string }

/** The flow moves a cell, and the pulse a phase, per step. */
const STEP_MS = 90
/** Steps one pulse stays lit, and steps it stays dark. */
const PULSE_HALF = 2
/** Pulses a colour change makes. */
const PULSES = 3
const PULSE_STEPS = PULSES * 2 * PULSE_HALF

type BarState = { step: number; isFlowing: boolean; tone?: string; pulse: number }

const Bar: ClientModule<BarProps, BarState> = (props, surface) => {
  const { Text } = surface.elements
  const state = surface.state
  // One clock for the instance's life, started on the first call and stopped by the engine on unmount: a tick redraws only while the bar flows or pulses.
  if (!state) {
    surface.every(STEP_MS, () => {
      const now = surface.state
      if (!now || (!now.isFlowing && now.pulse === 0)) return
      surface.setState({ ...now, step: now.isFlowing ? now.step + 1 : now.step, pulse: Math.max(0, now.pulse - 1) })
    })
    surface.setState({ step: 0, isFlowing: props.isFlowing, tone: props.tone, pulse: 0 })
  } else if (state.isFlowing !== props.isFlowing || state.tone !== props.tone) {
    // A pulse only on a change between two readings of the instance: never on the first one, nor on one that follows a missing tone
    const isChange = state.tone !== undefined && props.tone !== undefined && state.tone !== props.tone
    surface.setState({ step: state.isFlowing === props.isFlowing ? state.step : 0, isFlowing: props.isFlowing, tone: props.tone, pulse: isChange ? PULSE_STEPS : state.pulse })
  }
  const pulse = state?.pulse ?? 0
  const isPulseOn = pulse > 0 && Math.floor((PULSE_STEPS - pulse) / PULSE_HALF) % 2 === 0
  const cells = withGlow(withPulse(props.cells, isPulseOn), props.isFlowing ? (state?.isFlowing ? state.step : 0) : -1)
  return (
    <Text wrap="truncate">
      {cells.map((s, i) => (
        <Text key={i} color={s.c}>
          {s.t}
        </Text>
      ))}
    </Text>
  )
}

export default Bar
