import type { ClientModule } from 'claude-code'

import { withGlow } from './shared'
import type { Span } from './shared'

// The CTX bar as a surface module: its glow moves on the surface's own frame clock, so it redraws this region alone, not the pane.
export type CtxBarProps = { cells: Span[]; isWorking: boolean }

/** The glow moves a cell per step. */
const STEP_MS = 200

type BarState = { step: number; isWorking: boolean }

const CtxBar: ClientModule<CtxBarProps, BarState> = (props, surface) => {
  const { Text } = surface.elements
  const state = surface.state
  // One clock for the instance's life, started on the first call and stopped by the engine on unmount: a tick redraws only while Claude works.
  if (!state) {
    surface.every(STEP_MS, () => {
      const now = surface.state
      if (now?.isWorking) surface.setState({ ...now, step: now.step + 1 })
    })
    surface.setState({ step: 0, isWorking: props.isWorking })
  } else if (state.isWorking !== props.isWorking) {
    surface.setState({ step: 0, isWorking: props.isWorking })
  }
  const cells = withGlow(props.cells, props.isWorking ? (state?.isWorking ? state.step : 0) : -1)
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

export default CtxBar
