import type { RenderElement } from 'claude-code'

import type { CockpitAgent, CockpitChange, CockpitNote, CockpitPr, CockpitSnapshot, CockpitTab } from '../types'
import { sessionTokens } from './agents'
import { REFRESH_COOLDOWN_MS, autocompactForecast, openTasks, shouldCompact } from './context'
import { workItemIds, workItemUrl } from './links'
import { worklogLabel } from './session'
import { COLORS, abbrevTokens, clockTime, fmtCost, spanWidth, splitCells, taskBarCells, textCells, truncMiddle, truncateSpans, wrapCells } from './shared'
import type { Span } from './shared'
import { agentCosts, signalId, signalsOf } from './signals'
import type { Signal } from './signals'
import { t } from './strings'
import { agentRow, agentWarning, fitPair, modelCounts, orderAgents, pairRow, subagentDetails, taskCounts, taskRest, taskRow, visibleAgents } from './view-agents'
import { BUTTON_GAP, dim, line, sp, spanNodes } from './view-base'
import type { Ui } from './view-base'
import { categoryRows, contextBar } from './view-context'
import { bigResultSpans } from './view-insights'
import { changeSpans, prSpans } from './view-work'
import { repoRelative } from './work'
import { activeRun } from './workflow'

// ── What a tab draws with: the pane's actions and the helpers every tab shares ──

/** What a press does; the register module holds the engine, the view only names the acts. */
export type PaneActions = {
  selectTab: (tab: CockpitTab) => void
  compact: () => void
  /** Asks to confirm a button that sends something (`retro`: which `/retro`) or logs hours (`worklog`: which `/worklog`). */
  ask: (kind: 'retro' | 'worklog') => void
  /** Answers the confirmation: yes runs what was asked, no drops it. */
  answer: (isYes: boolean) => void
  /** Answers the retrospective's choice: `/retro days 10` over the last ten days, `/retro` on this session. */
  retro: (scope: 'days' | 'session') => void
  /** Answers the worklog's choice: `/worklog oggi sessione <id>` for the hours of this chat, `/worklog oggi` for the whole day. */
  worklog: (scope: 'session' | 'day') => void
  /** Shows every history entry, or only the newest few. */
  toggleHistory: () => void
  /** Expands or collapses an agent row (live or in the history). */
  toggleAgent: (agentId: string) => void
  /** Opens or closes the why and what-to-do of a notification (`kind:key`). */
  toggleSignal: (id: string) => void
  /** Asks for the exact count of the context breakdown (`full`: it spends token-count requests): the Context tab's `refresh`, once a minute. */
  refresh: () => void
  /** Opens or closes a note beyond its first lines. */
  toggleNote: (id: number) => void
  /** Shows a cut list in full or folds it again (`changes`, `outside`), or expands a row (`grew:…`). */
  toggleOpen: (key: string) => void
  /** Draws the diff of a changed file in the second pane. */
  openDiff: (change: CockpitChange) => void
  /** Keeps what the Note tab's field holds as the person types it. */
  setNoteDraft: (text: string) => void
  /** Saves the field as a note (replacing the one it was loaded from, if any): the text of the field on Enter, the kept draft when none is given. */
  saveNote: (text?: string) => void
  /** Opens a saved note for editing on its own row; on the note already being edited, cancels the edit. */
  editNote: (id: number) => void
  /** Appends a saved note to the prompt box; the note stays in the list. */
  sendNote: (id: number) => void
  deleteNote: (id: number) => void
}

export type Node = RenderElement | false | undefined
export type Block = (Node | readonly Node[] | Block)[]

export type Kit = {
  ui: Ui
  s: CockpitSnapshot
  width: number
  actions: PaneActions
  /** An empty row. */
  gap: () => RenderElement
  /** A section's title, its right side under it when the two do not fit one row. */
  title: (label: string, right?: Span[]) => RenderElement
}

export function makeKit(ui: Ui, s: CockpitSnapshot, width: number, actions: PaneActions): Kit {
  const { Box, Text } = ui
  return {
    ui,
    s,
    width,
    actions,
    gap: () => <Text> </Text>,
    title: (label, right = []) => (
      <Box justifyContent="space-between" flexDirection={textCells(label) + 1 + spanWidth(right) <= width ? 'row' : 'column'}>
        {line(ui, [sp(label, COLORS.title)])}
        {line(ui, right)}
      </Box>
    ),
  }
}

const MAX_SIGNAL_ROWS = 8
const MAX_TASK_ROWS = 6
const MAX_OUTSIDE_ROWS = 5
const MAX_FILE_ROWS = 8
const HISTORY_ROWS_SHOWN = 5
/** Visual lines of a closed note. */
const NOTE_LINES_SHOWN = 3
/** The pull request states the Work tab groups by, in order, and whether each starts open. */
const PR_GROUPS = [
  { state: 'open', isOpenByDefault: true },
  { state: 'draft', isOpenByDefault: true },
  { state: 'merged', isOpenByDefault: false },
  { state: 'closed', isOpenByDefault: false },
] as const
/** Cells a note row keeps for its three icon buttons (`[ x ]` each and the gaps), so the text never runs under them. */
const NOTE_ICONS_W = 19
/** Cells the field loses to the gaps around the Enter label and the cursor cell at a line's end: a row too many beats a hidden last line. */
const NOTE_FIELD_MARGIN = 3
/** The note buttons' Nerd Font Material Design glyphs (one cell each in a Nerd Font Mono). */
const NOTE_ICONS = { edit: '\u{F03EB}', cancel: '\u{F0156}', send: '\u{F048A}', delete: '\u{F0A79}', save: '\u{F0193}' }

/** The note field's height: one row per line of `text` wrapped at `cells`, at least 2 (a 1-row Input is single-line and cuts the text instead of wrapping it), so the whole text stays visible. */
function noteRows(text: string, cells: number): number {
  return Math.max(2, text.split('\n').reduce((sum, l) => sum + Math.max(1, wrapCells(l, Math.max(1, cells)).length), 0))
}

// ── Agents: the workflow run in one row, every agent listed, the history behind a toggle ──

/** The workflow run in flight in one row: name, phase, round, finished agents out of all and what they cost so far (its agents' cost). */
function workflowBlock(k: Kit): Block {
  const { s, width, gap, ui } = k
  const run = activeRun(s.workflowRun)
  if (!run) return []
  const ids = new Set(run.agents.map(a => a.id))
  const usd = agentCosts(s.agents, s.events).filter(a => ids.has(a.id)).reduce((sum, a) => sum + (a.usd ?? 0), 0)
  const done = run.agents.filter(a => a.isDone).length
  return [gap(), line(ui, truncateSpans([sp(t().workflowRow(run.name, run.phase ?? '—', run.round, done, run.agents.length, fmtCost(usd)))], width))]
}

/** The first `shown` rows, then a button that opens the rest (`󰍟 +K`) and folds them again (`󰍝 −K`); no button when every row fits. */
function collapsible(k: Kit, key: string, rows: Block[], shown: number, isOpen: boolean, onToggle: () => void): Block {
  const { Button, Text } = k.ui
  const hidden = rows.length - shown
  if (hidden <= 0) return rows
  return [
    isOpen ? rows : rows.slice(0, shown),
    <Button key={`${key}:more`} plain onPress={onToggle}>
      <Text color={COLORS.title}>{isOpen ? t().lessRows(hidden) : t().moreRows(hidden)}</Text>
    </Button>,
  ]
}

export function agentsBlocks(k: Kit): Block[] {
  const { ui, s, width, gap, actions } = k
  const { Button, Text } = ui
  const S = t()
  const agents = visibleAgents(s)
  const running = agents.filter(a => a.status === 'running')

  // Every agent is one row (state, name, model when it fits, effort, share, time); pressing it expands what else there is to know. Live and history alike.
  const sessionTotal = sessionTokens(s)
  const usdById = new Map(agentCosts(s.agents, s.events).map(a => [a.id, a.usd]))
  // `usd`: what a history entry kept of its cost; it outlives the events, which the resumed session no longer holds
  const agentBlock = (key: string, agent: CockpitAgent, depth: number, usd?: number): Block => {
    const indent = '  '.repeat(depth + 1)
    const isOpen = s.agentsOpen?.includes(agent.id) === true
    const warn = agentWarning(agent, s.isSubagentModelForced)
    return [
      <Button key={key} plain onPress={() => actions.toggleAgent(agent.id)}>
        <Text wrap="truncate">{spanNodes(ui, agentRow(agent, depth, s.now, width, sessionTotal, usd ?? usdById.get(agent.id)))}</Text>
      </Button>,
      isOpen && [
        warn !== undefined && line(ui, [sp(`${indent}󰀦 ${warn}`, COLORS.yellow)]),
        ...subagentDetails(agent, indent, width).map(spans => line(ui, spans)),
        gap(),
      ],
    ]
  }
  const rows = orderAgents(agents)
  const agentRows = rows.map(({ agent, depth }) => agentBlock(`agent:${agent.id}`, agent, depth))
  // HISTORY: the agents that left the list, newest first; the newest few, the rest behind a toggle
  const history = s.history ?? []
  const historyBlock: Block[] =
    history.length === 0
      ? []
      : [
          [
            gap(),
            line(ui, [sp(`${S.historyTitle} · ${history.length}`, COLORS.title)]),
            gap(),
            collapsible(
              k,
              'history',
              history.map(h => agentBlock(`history:${h.id}`, { ...h, status: 'done' }, 0, h.usd)),
              HISTORY_ROWS_SHOWN,
              s.isHistoryOpen === true,
              actions.toggleHistory,
            ),
          ],
        ]
  return [
    workflowBlock(k),
    [gap(), line(ui, fitPair([sp(S.subagentsTitle(running.length), COLORS.title)], modelCounts(agents), width)), rows.length > 0 && gap(), agentRows],
    ...historyBlock,
  ].filter(b => b.length > 0)
}

// ── Notifications ──

/** The three lines of a signal: what, why it matters, what to do. */
export function signalText(sig: Signal): { what: string; why: string; todo: string } {
  const T = t().signalText
  switch (sig.kind) {
    case 'heavyAgent':
      return T.heavyAgent(sig.label ?? '?', sig.n ?? 0)
    case 'opusReadOnly':
      return T.opusReadOnly(sig.label ?? '?')
    case 'bigResult':
      return T.bigResult(sig.label ?? '?', sig.n ?? 0)
    case 'reread':
      return T.reread(sig.label ?? '?', sig.n ?? 0)
    case 'failedCommand':
      return T.failedCommand(sig.label ?? '?', sig.n ?? 0)
    case 'coldAfterIdle':
      return T.coldAfterIdle(sig.n ?? 0)
    case 'ctxGrowth':
      return T.ctxGrowth(sig.n ?? 0)
    case 'doneClaims':
      return T.doneClaims(sig.n ?? 0)
    case 'workflow':
      return T.workflow(sig.label ?? 'stall', sig.n)
    case 'permissionWait':
      return T.permissionWait(Math.round((sig.n ?? 0) / 1000))
  }
}

/** One row per active notification (what); the pressed one also tells why and what to do. */
export function signalsBlocks(k: Kit): Block[] {
  const { ui, s, width, gap, title, actions } = k
  const { Button, Text } = ui
  const S = t()
  const signals = signalsOf(s)
  // The worklog: up to date, or the days behind (a press lists which)
  const wl = s.worklog
  const lateDays = new Set([...wl.pending, ...wl.underTarget])
  const isDaysOpen = s.openKeys?.includes('worklog:days') === true
  const daysRows = [...(wl.pending.length ? [worklogLabel('pending', wl.pending)] : []), ...(wl.underTarget.length ? [worklogLabel('underTarget', wl.underTarget)] : [])]
  const worklogBlock: Block = [
    gap(),
    title(S.worklog.title),
    gap(),
    lateDays.size === 0 ? (
      line(ui, [sp('󰄬 ', COLORS.green), dim(S.worklog.upToDate)])
    ) : (
      [
        <Button key="worklog:days" plain onPress={() => actions.toggleOpen('worklog:days')}>
          <Text color={COLORS.yellow}>{`${isDaysOpen ? '▾' : '▸'} ${S.worklog.behind(lateDays.size)}`}</Text>
        </Button>,
        isDaysOpen && daysRows.flatMap(text => wrapCells(text, Math.max(4, width - 2)).map(l => line(ui, [sp(`  ${l}`, COLORS.yellow)]))),
      ]
    ),
  ]
  if (signals.length === 0) return [worklogBlock, [gap(), line(ui, [dim(S.noSignals)])]]
  const idOf = signalId
  // An open notification's text wraps under its row, indented, instead of being cut
  const wrapped = (text: string, style: (t: string) => Span) => wrapCells(text, Math.max(4, width - 2)).map(l => line(ui, [style(`  ${l}`)]))
  const yellow = (t: string) => sp(t, COLORS.yellow, true)
  return [
    worklogBlock,
    [
      gap(),
      title(S.signalsTitle(signals.length)),
      gap(),
      collapsible(k, 'signals', signals.map((sig): Block => {
        const text = signalText(sig)
        const id = idOf(sig)
        const isOpen = s.signalOpen === id
        // The time it arrived on the right; open, the row holds what fits of the title and the rest goes under it
        const at = s.signalsAt?.[id]
        const time = at === undefined ? [] : [dim(clockTime(at))]
        const [head, rest] = isOpen ? splitCells(`󰍝 ${text.what}`, width - spanWidth(time) - 1) : [`󰍟 ${text.what}`, '']
        return [
          <Button key={`signal:${id}`} plain onPress={() => actions.toggleSignal(id)}>
            <Text wrap="truncate">{spanNodes(ui, pairRow([yellow(head)], time, width))}</Text>
          </Button>,
          isOpen && wrapped(rest, yellow),
          isOpen && wrapped(`${S.signalFields.why}${text.why}`, dim),
          isOpen && wrapped(`${S.signalFields.todo}${text.todo}`, dim),
        ]
      }), MAX_SIGNAL_ROWS, s.openKeys?.includes('signals:more') === true, () => actions.toggleOpen('signals:more')),
    ],
  ]
}

// ── Context: the breakdown, then what the session costs ──

export function contextBlocks(k: Kit): Block[] {
  const { ui, s, width, gap, title, actions } = k
  const { Button, Text } = ui
  const S = t()

  const context = s.context
  const ctxRounds = s.ctxRounds ?? []
  const forecast = autocompactForecast(s.ctxSamples, s.autoCompactAt)
  const hint = shouldCompact({ percent: s.ctx.percent, rounds: ctxRounds, forecast })
  // `refresh` is an exact count and waits a minute from its press: a countdown stands in for the button meanwhile
  const wait = s.refreshedAt === undefined ? 0 : Math.min(REFRESH_COOLDOWN_MS, s.refreshedAt + REFRESH_COOLDOWN_MS - s.now)
  const refreshRow =
    wait > 0 ? (
      line(ui, [dim(S.refreshIn(Math.ceil(wait / 1000)))])
    ) : (
      <Button key="ctx:refresh" onPress={() => actions.refresh()}>
        {S.buttons.refresh}
      </Button>
    )
  const breakdownBlock: Block = [
    gap(),
    title(context ? `${S.contextDetailsTitle} · ${abbrevTokens(context.total, true)}/${abbrevTokens(context.max, true)}` : S.contextDetailsTitle, context ? [dim(context.isExact ? S.exact : context.rows.some(r => r.isExact) ? S.someExact : S.estimate)] : []),
    gap(),
    hint && line(ui, [sp(S.worthCompacting, COLORS.yellow)]),
    ...(context ? [line(ui, contextBar(context, width)), ...categoryRows(context, width).map(spans => line(ui, spans))] : [line(ui, [dim(S.noReading)])]),
    gap(),
    refreshRow,
  ]
  // Each output that grew the context is a button: pressed, its whole argument (a file by its full path) wraps under it instead of being cut
  const biggest = s.insights?.biggest ?? []
  const grewRows = biggest.map((r): Block => {
    const id = `grew:${r.tool}:${r.arg ?? ''}:${r.tokens}`
    const isOpen = s.openKeys?.includes(id) === true
    return [
      <Button key={id} plain onPress={() => actions.toggleOpen(id)}>
        <Text wrap="truncate">{spanNodes(ui, bigResultSpans(r, width))}</Text>
      </Button>,
      isOpen && (r.fullArg ?? r.arg) !== undefined && wrapCells(r.fullArg ?? r.arg ?? '', Math.max(4, width - 2)).map(l => line(ui, [dim(`  ${l}`)])),
    ]
  })
  const grewBlock: Block = biggest.length > 0 ? [gap(), title(S.grewTitle), gap(), grewRows] : []
  // The context first (categories, the compact hint), then the outputs that grew it
  return [breakdownBlock, grewBlock].filter(b => b.length > 0)
}

// ── Lavoro ──

/** The question and its yes / no row. */
function confirmRow(k: Kit, question: string): Block {
  const { ui, gap, actions, width } = k
  const { Box, Button } = ui
  return [
    line(ui, truncateSpans([sp(question, COLORS.yellow)], width)),
    <Box columnGap={BUTTON_GAP}>
      <Button key="confirm:yes" onPress={() => actions.answer(true)}>
        {t().buttons.yes}
      </Button>
      <Button key="confirm:no" onPress={() => actions.answer(false)}>
        {t().buttons.no}
      </Button>
    </Box>,
    gap(),
  ]
}

export function workBlocks(k: Kit): Block[] {
  const { ui, s, width, gap, title, actions } = k
  const { Button, Link, Text } = ui
  const S = t()

  const counts = taskCounts(s)
  const isTasksOpen = s.openKeys?.includes('tasks:more') === true
  const open = openTasks(s)
  const taskPart: Block =
    counts === null
      ? []
      : [
          gap(),
          title(`${S.taskTitle} · ${counts.done}/${counts.total}`, [sp(`󱎖 ${counts.inProgress}`, COLORS.blue), sp('  '), dim(`󰄰 ${counts.pending}`), sp('  '), sp(`󰄬 ${counts.done}`, COLORS.green)]),
          gap(),
          line(ui, taskBarCells(width, counts.done, counts.inProgress, counts.total)),
          collapsible(
            k,
            'tasks',
            // opened, a subject wraps in full instead of being cut
            open.map(task => [line(ui, taskRow(task, s.now, width, isTasksOpen)), isTasksOpen && taskRest(task, width).map(l => line(ui, l))]),
            MAX_TASK_ROWS,
            isTasksOpen,
            () => actions.toggleOpen('tasks:more'),
          ),
          counts.done > 0 && line(ui, [sp('󰄬', COLORS.green), dim(S.tasksDone(counts.done))]),
        ]

  // The deliver perimeter: its entries, the files touched since HEAD and the ones outside it (none claimed when git could not say)
  const check = s.perimeterCheck
  const outside = check?.outside ?? []
  const perimeterPart: Block =
    s.perimeter === undefined
      ? []
      : [
          gap(),
          line(ui, [dim(S.perimeter(s.perimeter.length)), ...(check ? [dim(S.filesTouched(check.files))] : [])]),
          check && (outside.length === 0 ? line(ui, [sp('󰄬 ', COLORS.green), dim(S.noFileOutside)]) : line(ui, [sp(S.filesOutside(outside.length), COLORS.red)])),
          collapsible(
            k,
            'outside',
            outside.map(file => [line(ui, [sp(`  ${truncMiddle(file, Math.max(4, width - 2))}`, COLORS.yellow)])]),
            MAX_OUTSIDE_ROWS,
            s.openKeys?.includes('outside') === true,
            () => actions.toggleOpen('outside'),
          ),
        ]
  const principalBlock: Block[] = perimeterPart.length + taskPart.length > 0 ? [[gap(), title(S.mainTitle), ...perimeterPart, ...taskPart]] : []

  // The files changed on the branch and not committed yet. A changed file is a Button: a press draws its diff in the second pane.
  const repo = s.repo
  const edited = new Set((s.edited ?? []).flatMap(p => repoRelative(s.git?.root, p) ?? []))
  const isChangesOpen = s.openKeys?.includes('changes') === true
  const changesPart: Block = repo
    ? [
        gap(),
        title(`${S.changesTitle} · ${repo.total}`, edited.size > 0 ? [dim(S.editedHere)] : []),
        gap(),
        repo.files.length === 0
          ? line(ui, [dim(S.noChanges)])
          : collapsible(
              k,
              'changes',
              repo.files.map(c => [
                <Button key={`file:${c.path}`} plain onPress={() => actions.openDiff(c)}>
                  {spanNodes(ui, changeSpans(c, width, edited.has(c.path)))}
                </Button>,
              ]),
              MAX_FILE_ROWS,
              isChangesOpen,
              () => actions.toggleOpen('changes'),
            ),
        // the read keeps the first files only: the ones past them are counted, never listed
        (isChangesOpen || repo.files.length <= MAX_FILE_ROWS) && repo.total > repo.files.length && line(ui, [dim(`… +${repo.total - repo.files.length}`)]),
      ]
    : []

  // The work items the branch and pull requests name (WI), then the pull requests of this chat (PR, newest first)
  const prs = [...(s.prs ?? [])].reverse()
  const items = workItemIds(s)
  const wiRows = items.map(id => {
    const url = workItemUrl(s.alm, id)
    return (
      <Text>
        {url !== undefined ? <Link href={url}>{`AB#${id}`}</Link> : <Text>{`AB#${id}`}</Text>}
        <Text dimColor>{` ${S.workItemsTitle}`}</Text>
      </Text>
    )
  })
  const prRow = (pr: CockpitPr) => (
    <Text>
      {pr.url !== undefined ? <Link href={pr.url}>{`#${pr.number}`}</Link> : <Text>{`#${pr.number}`}</Text>}
      {spanNodes(ui, prSpans(pr))}
    </Text>
  )
  // Each state is a sub-section: its title row (with the count) folds and unfolds it; the active states start open, the finished ones folded (a press flips the default)
  const prGroups = PR_GROUPS.flatMap(({ state, isOpenByDefault }): Block[] => {
    const list = prs.filter(pr => (pr.state ?? 'open') === state)
    if (list.length === 0) return []
    const key = `prs:${state}`
    const isOpen = isOpenByDefault !== (s.openKeys?.includes(key) === true)
    return [
      [
        <Button key={key} plain onPress={() => actions.toggleOpen(key)}>
          <Text color={COLORS.title}>{`${isOpen ? '▾' : '▸'} ${S.prStates[state]} · ${list.length}`}</Text>
        </Button>,
        isOpen && list.map(prRow),
      ],
    ]
  })
  // Both sections are always there: empty, a count of 0 and a dim "none"
  const wiPart: Block = [gap(), title(S.wiTitle(items.length)), gap(), items.length > 0 ? wiRows : line(ui, [dim(S.none)])]
  const prPart: Block = [gap(), title(S.prTitle(prs.length)), gap(), prs.length > 0 ? prGroups : line(ui, [dim(S.none)])]

  return [...principalBlock, changesPart, wiPart, prPart].filter(b => b.length > 0)
}

// ── Note ──

export function notesBlocks(k: Kit): Block[] {
  const { ui, s, width, gap, title, actions } = k
  const { Box, Button, Input, Text } = ui
  const S = t()
  const notes = s.notes ?? []
  const textW = Math.max(1, width - NOTE_ICONS_W)
  // the field grows with its text; the cells it wraps at leave room for the Enter label drawn beside it while focused
  const draftRows = noteRows(s.noteDraft ?? '', textW - textCells(S.buttons.save) - NOTE_FIELD_MARGIN)
  const deleteIcon = <Text color={COLORS.red}>{NOTE_ICONS.delete}</Text>
  // Every note is one row: its text (its first lines until pressed, then all of them) and the three icon buttons right-aligned (save in place of send while edited); odd rows get a band
  const noteRow = (n: CockpitNote, i: number) => {
    const lines = n.text.trimEnd().split(/\r?\n/)
    const isOpen = s.notesOpen?.includes(n.id) === true
    // the visual lines at the text column's width: a closed note shows the first few, `󰍟 +N` opens the rest
    const visual = lines.flatMap(text => (text === '' ? [' '] : wrapCells(text, textW)))
    const hidden = visual.length - NOTE_LINES_SHOWN
    const isEditing = Input !== undefined && s.noteEditing === n.id
    return (
      <Box flexDirection="column" backgroundColor={i % 2 === 1 ? COLORS.band : undefined}>
        <Box columnGap={1}>
          <Box width={textW} flexDirection="column">
            {isEditing ? (
              <Input key="note:edit-field" rows={draftRows} value={s.noteDraft ?? ''} submitLabel={S.buttons.save} autoFocus onInput={value => actions.setNoteDraft(value)} onSubmit={value => actions.saveNote(value)} />
            ) : (
              <Button key={`note:toggle:${n.id}`} plain onPress={() => actions.toggleNote(n.id)}>
                {isOpen ? (
                  // one Text so the Button cannot lay the lines side by side; lines wrap by display width, indentation and empty lines kept
                  <Text wrap="wrap">{lines.map(text => (text === '' ? ' ' : text)).join('\n')}</Text>
                ) : (
                  <Text wrap="wrap">{visual.slice(0, NOTE_LINES_SHOWN).join('\n')}</Text>
                )}
              </Button>
            )}
            {!isEditing && hidden > 0 && (
              <Button key={`note:more:${n.id}`} plain onPress={() => actions.toggleNote(n.id)}>
                <Text color={COLORS.title}>{isOpen ? S.lessRows(hidden) : S.moreRows(hidden)}</Text>
              </Button>
            )}
          </Box>
          <Box flexGrow={1} columnGap={1} justifyContent="flex-end" alignItems="flex-start">
            <Button key={`note:edit:${n.id}`} onPress={() => actions.editNote(n.id)}>
              {isEditing ? NOTE_ICONS.cancel : NOTE_ICONS.edit}
            </Button>
            {isEditing ? (
              <Button key={`note:save:${n.id}`} onPress={() => actions.saveNote()}>
                {NOTE_ICONS.save}
              </Button>
            ) : (
              <Button key={`note:send:${n.id}`} onPress={() => actions.sendNote(n.id)}>
                {NOTE_ICONS.send}
              </Button>
            )}
            <Button key={`note:delete:${n.id}`} onPress={() => actions.deleteNote(n.id)}>
              {deleteIcon}
            </Button>
          </Box>
        </Box>
        {s.confirm === `note:${n.id}` && confirmRow(k, S.confirmNoteDelete)}
      </Box>
    )
  }
  return [
    [
      gap(),
      title(S.notesTitle(notes.length)),
      gap(),
      // The bottom field is for new notes: while a note is edited on its row it is hidden (the draft is shared, a draft typed here is replaced).
      // The field in the text column, save and clear in the icon column, as on the note rows.
      Input && s.noteEditing === undefined && (
        <Box columnGap={1}>
          <Box width={textW}>
            <Input key="note" rows={draftRows} placeholder={S.notePlaceholder} value={s.noteDraft ?? ''} submitLabel={S.buttons.save} onInput={value => actions.setNoteDraft(value)} onSubmit={value => actions.saveNote(value)} />
          </Box>
          <Box flexGrow={1} columnGap={1} justifyContent="flex-end" alignItems="flex-start">
            <Button key="note:save" onPress={() => actions.saveNote()}>
              {NOTE_ICONS.save}
            </Button>
            <Button key="note:clear" onPress={() => actions.setNoteDraft('')}>
              {deleteIcon}
            </Button>
          </Box>
        </Box>
      ),
      ...(notes.length > 0 ? [gap(), notes.map(noteRow)] : [gap(), line(ui, [dim(S.noNotes)])]),
    ],
  ]
}

/** The blocks of the selected tab; the others are not built. */
export function tabBlocks(tab: CockpitTab, k: Kit): Block[] {
  switch (tab) {
    case 'agents':
      return agentsBlocks(k)
    case 'signals':
      return signalsBlocks(k)
    case 'context':
      return contextBlocks(k)
    case 'work':
      return workBlocks(k)
    case 'notes':
      return notesBlocks(k)
  }
}
