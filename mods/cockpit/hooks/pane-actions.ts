import { atom, read } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import { compactInstructions } from './context'
import { saveNote, sendNote, toggled } from './events'
import { openContext, pressRefresh } from './refresh-context'
import { refreshRepo, showDiff } from './refresh-git'
import { NOTE_MAX, normalizeNewlines } from './session'
import { signalId, signalsOf } from './signals'
import { DIFF_PANE, INITIAL } from './state'
import { patch } from './store'
import type { PaneActions } from './view'
import type { DiffActions } from './view-work'
import { activeRun } from './workflow'

// The scan that checks `$.state` references reads the atom from the file that uses it.
const snapshot = atom({ plugin: 'cockpit', key: 'snapshot' } as const, INITIAL)

/** What the pane's buttons do. Each runs apart from the press and fails alone: a refused call leaves the pane as it was. */
export function paneActions($: EngineInterface): PaneActions {
  return {
    // The Lavoro tab's git read and the Costi tab's breakdown run while the tab is selected: the press starts them.
    selectTab: tab =>
      void patch($, s => ({ ...s, tab, confirm: undefined, signalOpen: undefined, seenSignals: s.tab === 'signals' || tab === 'signals' ? signalsOf(s).map(signalId) : s.seenSignals }))
        .then(async () => {
          if (tab === 'work') await refreshRepo($)
          else if (tab === 'context') await openContext($)
        })
        .catch(() => undefined),
    // The instructions are built from the snapshot as it is at the press.
    compact: () =>
      void read($, snapshot)
        .then(s => $.session.compact({ instructions: compactInstructions({ ...s, workflow: activeRun(s.workflowRun)?.name }) }))
        .catch(() => undefined),
    // A button that sends something waits for its confirmation; the answer runs it or drops it.
    ask: kind => void patch($, s => ({ ...s, confirm: kind })).catch(() => undefined),
    // `$.command.run` is the engine's documented way to run a slash command: "as if the person typed `/command args`" (the
    // `command.run` entry of the engine types). The worklog is the skill's `sessione <id>` scope: the hours of this chat.
    answer: isYes =>
      void read($, snapshot)
        .then(async s => {
          const asked = s.confirm
          await patch($, x => ({ ...x, confirm: undefined }))
          if (!isYes) return
          if (asked === 'worklog') await $.session.id().then(id => $.command.run({ command: 'worklog', args: `oggi sessione ${id}` }))
          if (typeof asked === 'string' && asked.startsWith('note:')) {
            const id = Number(asked.slice(5))
            await patch($, x => {
              const notes = (x.notes ?? []).filter(n => n.id !== id)
              return { ...x, notes: notes.length > 0 ? notes : undefined, noteEditing: x.noteEditing === id ? undefined : x.noteEditing }
            })
          }
        })
        .catch(() => undefined),
    // The retrospective's choice is its confirmation: the period's `days 10`, or the skill's default, this session.
    retro: scope =>
      void patch($, s => ({ ...s, confirm: undefined }))
        .then(() => $.command.run(scope === 'days' ? { command: 'retro', args: 'days 10' } : { command: 'retro' }))
        .catch(() => undefined),
    openDiff: change => void showDiff($, change),
    toggleHistory: () => void patch($, s => ({ ...s, isHistoryOpen: !s.isHistoryOpen })).catch(() => undefined),
    toggleCostAgents: () => void patch($, s => ({ ...s, isCostAgentsOpen: !s.isCostAgentsOpen })).catch(() => undefined),
    toggleAgent: id => void patch($, s => ({ ...s, agentsOpen: toggled(s.agentsOpen, id) })).catch(() => undefined),
    toggleSignal: key => void patch($, s => ({ ...s, signalOpen: s.signalOpen === key ? undefined : key })).catch(() => undefined),
    refresh: () => void pressRefresh($).catch(() => undefined),
    toggleNote: id => void patch($, s => ({ ...s, notesOpen: toggled(s.notesOpen, id) })).catch(() => undefined),
    setNoteDraft: text => void patch($, s => ({ ...s, noteDraft: text === '' ? undefined : normalizeNewlines(text).slice(0, NOTE_MAX), noteEditing: text === '' ? undefined : s.noteEditing })).catch(() => undefined),
    saveNote: text => void patch($, s => saveNote(s, text)).catch(() => undefined),
    editNote: id =>
      void patch($, s => {
        const note = s.notes?.find(n => n.id === id)
        return note ? { ...s, noteDraft: note.text, noteEditing: id } : s
      }).catch(() => undefined),
    sendNote: id => void sendNote($, id).catch(() => undefined),
    deleteNote: id => void patch($, s => ({ ...s, confirm: `note:${id}` })).catch(() => undefined),
  }
}

/**
 * What the diff pane's button does: forgets the diff, then closes the pane. A plugin's own `$.ui.close` does not reach its
 * own `ui.close` hook, which is what forgets the diff when the person closes the pane instead.
 */
export function diffActions($: EngineInterface): DiffActions {
  return {
    close: () =>
      void patch($, s => ({ ...s, diff: undefined }))
        .then(() => $.ui.close({ id: DIFF_PANE }))
        .catch(() => undefined),
  }
}
