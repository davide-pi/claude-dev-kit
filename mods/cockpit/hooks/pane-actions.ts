import { atom, read } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import { compactInstructions } from './context'
import { toggled } from './events'
import { INITIAL } from './state'
import { scrollToAnchor } from './round-anchor'
import { patch } from './store'
import type { PaneActions } from './view'
import { activeRun } from './workflow'

// The scan that checks `$.state` references reads the atom from the file that uses it.
const snapshot = atom({ plugin: 'cockpit', key: 'snapshot' } as const, INITIAL)

/** What the pane's buttons do. Each runs apart from the press and fails alone: a refused call leaves the pane as it was. */
export function paneActions($: EngineInterface): PaneActions {
  return {
    // The instructions are built from the snapshot as it is at the press.
    compact: () =>
      void read($, snapshot)
        .then(s => $.session.compact({ instructions: compactInstructions({ ...s, workflow: activeRun(s.workflowRun)?.name }) }))
        .catch(() => undefined),
    // A button that sends something waits for its confirmation; the answer runs it or drops it.
    ask: kind => void patch($, s => ({ ...s, confirm: kind })).catch(() => undefined),
    answer: () => void patch($, x => ({ ...x, confirm: undefined })).catch(() => undefined),
    // The retrospective's choice is its confirmation: the period's `days 10`, or the skill's default, this session.
    retro: scope =>
      void patch($, s => ({ ...s, confirm: undefined }))
        .then(() => $.command.run(scope === 'days' ? { command: 'retro', args: 'days 10' } : { command: 'retro' }))
        .catch(() => undefined),
    // `$.command.run` is the engine's documented way to run a slash command: "as if the person typed `/command args`" (the
    // `command.run` entry of the engine types). The worklog's choice is its confirmation: the skill's `sessione <id>` scope, the
    // hours of this chat, or the whole day.
    worklog: scope =>
      void patch($, s => ({ ...s, confirm: undefined }))
        .then(async () => $.command.run({ command: 'worklog', args: scope === 'session' ? `oggi sessione ${await $.session.id()}` : 'oggi' }))
        .catch(() => undefined),
    toggleAgent: id => void patch($, s => ({ ...s, agentsOpen: toggled(s.agentsOpen, id) })).catch(() => undefined),
    toggleSignal: key => void patch($, s => ({ ...s, signalOpen: s.signalOpen === key ? undefined : key })).catch(() => undefined),
    toggleOpen: key => void patch($, s => ({ ...s, openKeys: toggled(s.openKeys, key) })).catch(() => undefined),
    scrollTo: anchor => void scrollToAnchor($, anchor).catch(() => undefined),
    setGroupOpen: (key, isOpen) => void patch($, s => ({ ...s, groupsOpen: { ...s.groupsOpen, [key]: isOpen } })).catch(() => undefined),
    setGroupsOpen: (keys, isOpen) => void patch($, s => ({ ...s, groupsOpen: { ...s.groupsOpen, ...Object.fromEntries(keys.map(key => [key, isOpen])) } })).catch(() => undefined),
  }
}
