import type { ClientModule } from 'claude-code'

import { BEAT_TICK_MS, beatStep, frame } from './anim'
import { COLORS } from './shared'

export type CompactButtonProps = { label: string }

/** The compact button while a compaction is due: its label beats like the CTX percent (slow, yellow), and a press tells the hooks module. */
const CompactButton: ClientModule<CompactButtonProps, number> = (props, surface) => {
  const { Button, Text } = surface.elements
  // One clock for the instance's life; the level comes from the wall clock and a tick redraws only when it changes.
  if (surface.state === undefined) {
    surface.every(BEAT_TICK_MS, () => {
      const step = beatStep('slow', Date.now())
      if (step !== surface.state) surface.setState(step)
    })
    surface.setState(beatStep('slow', Date.now()))
  }
  const cells = frame('beat', beatStep('slow', Date.now()), [{ t: props.label, c: COLORS.yellow }])
  return (
    <Button key="bar:compact" onPress={() => surface.post({ action: 'compact' })}>
      {cells.map((s, i) => (
        <Text key={i} color={s.c}>
          {s.t}
        </Text>
      ))}
    </Button>
  )
}

export default CompactButton
