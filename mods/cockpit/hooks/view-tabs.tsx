import type { RenderElement } from 'claude-code'

import type { CockpitAgent, CockpitChange, CockpitNote, CockpitSnapshot, CockpitTab } from '../types'
import { sessionTokens } from './agents'
import { REFRESH_COOLDOWN_MS, autocompactForecast, openTasks, shouldCompact } from './context'
import { workItemIds, workItemUrl } from './links'
import { worklogLabel } from './session'
import { COLORS, abbrevTokens, clockTime, fmtCost, spanWidth, splitCells, taskBarCells, textCells, truncMiddle, truncateSpans, wrapCells } from './shared'
import type { Span } from './shared'
import { agentCosts, signalId, signalsOf } from './signals'
import type { AgentCost, Signal } from './signals'
import { t } from './strings'
import { agentCostDetails, agentCostRow, agentRow, agentWarning, fitPair, modelCounts, orderAgents, pairRow, subagentDetails, taskCounts, taskRow, visibleAgents } from './view-agents'
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
  /** Shows every TOP AGENTS entry, or only the dearest few. */
  toggleCostAgents: () => void
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
  /** Loads a saved note into the field. */
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
  /** `left` in `leftW` cells, `right` beside it. */
  split: (left: RenderElement, leftW: number, right: Span[]) => RenderElement
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
    split: (left, leftW, right) => (
      <Box>
        <Box width={leftW}>{left}</Box>
        <Box marginLeft={1}>{line(ui, right)}</Box>
      </Box>
    ),
  }
}

const MAX_SIGNAL_ROWS = 8
const MAX_TASK_ROWS = 6
const MAX_OUTSIDE_ROWS = 5
const MAX_FILE_ROWS = 8
const MAX_LINK_ROWS = 4
const HISTORY_ROWS_SHOWN = 5
const AGENT_COST_ROWS_SHOWN = 3
/** The height of the note field: three lines, a longer text scrolls inside it. */
const NOTE_INPUT_ROWS = 3
/** Cells a note row keeps for its three icon buttons (✎ ➤ 🗑 and the gaps), so the text never runs under them. */
const NOTE_ICONS_W = 8

// ── Agents: the workflow run in one row, every agent listed, the history behind a toggle ──

/** The workflow run in flight in one row: name, phase, round, finished agents out of all and what they cost so far (its agents' cost). */
function workflowBlock(k: Kit): Block {
  const { s, width, gap, ui } = k
  const run = activeRun(s.workflowRun)
  if (!run) return []
  const ids = new Set(run.agents.map(a => a.id))
  const usd = agentCosts(s.agents, s.events).filter(a => ids.has(a.id)).reduce((sum, a) => sum + a.usd, 0)
  const done = run.agents.filter(a => a.isDone).length
  return [gap(), line(ui, truncateSpans([sp(t().workflowRow(run.name, run.phase ?? '—', run.round, done, run.agents.length, fmtCost(usd)))], width))]
}

/** The first `shown` rows, then a button that opens the rest (`▸ +K`) and folds them again (`▾ −K`); no button when every row fits. */
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
  const agentBlock = (key: string, agent: CockpitAgent, depth: number): Block => {
    const indent = '  '.repeat(depth + 1)
    const isOpen = s.agentsOpen?.includes(agent.id) === true
    const warn = agentWarning(agent, s.isSubagentModelForced)
    return [
      <Button key={key} plain onPress={() => actions.toggleAgent(agent.id)}>
        <Text wrap="truncate">{spanNodes(ui, agentRow(agent, depth, s.now, width, sessionTotal))}</Text>
      </Button>,
      isOpen && [
        warn !== undefined && line(ui, [sp(`${indent}⚠ ${warn}`, COLORS.yellow)]),
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
              history.map(h => agentBlock(`history:${h.id}`, { ...h, status: 'done' }, 0)),
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
  if (signals.length === 0) return [[gap(), line(ui, [dim(S.noSignals)])]]
  const idOf = signalId
  // An open notification's text wraps under its row, indented, instead of being cut
  const wrapped = (text: string, style: (t: string) => Span) => wrapCells(text, Math.max(4, width - 2)).map(l => line(ui, [style(`  ${l}`)]))
  const yellow = (t: string) => sp(t, COLORS.yellow, true)
  return [
    [
      gap(),
      title(S.signalsTitle(signals.length)),
      gap(),
      signals.slice(0, MAX_SIGNAL_ROWS).flatMap(sig => {
        const text = signalText(sig)
        const id = idOf(sig)
        const isOpen = s.signalOpen === id
        // The time it arrived on the right; open, the row holds what fits of the title and the rest goes under it
        const at = s.signalsAt?.[id]
        const time = at === undefined ? [] : [dim(clockTime(at))]
        const [head, rest] = isOpen ? splitCells(`▾ ${text.what}`, width - spanWidth(time) - 1) : [`▸ ${text.what}`, '']
        return [
          <Button key={`signal:${id}`} plain onPress={() => actions.toggleSignal(id)}>
            <Text wrap="truncate">{spanNodes(ui, pairRow([yellow(head)], time, width))}</Text>
          </Button>,
          isOpen && wrapped(rest, yellow),
          isOpen && wrapped(`${S.signalFields.why}${text.why}`, dim),
          isOpen && wrapped(`${S.signalFields.todo}${text.todo}`, dim),
        ]
      }),
      signals.length > MAX_SIGNAL_ROWS && line(ui, [dim(`… +${signals.length - MAX_SIGNAL_ROWS}`)]),
    ],
  ]
}

// ── Context: the breakdown, then what the session costs ──

export function contextBlocks(k: Kit): Block[] {
  const { ui, s, width, gap, title, actions } = k
  const { Button, Text } = ui
  const S = t()

  // Every priced agent, dearest first: the top few shown, the rest behind a toggle
  const agents = agentCosts(s.agents, s.events).sort((a, b) => b.usd - a.usd)
  // Each agent is one row, a button: a press expands what it was asked and how it went (its own `cost:` entry of the open list, apart from the Agents tab's)
  const agentRows = (a: AgentCost): Block => {
    const id = `cost:${a.id}`
    return [
      <Button key={id} plain onPress={() => actions.toggleAgent(id)}>
        <Text wrap="truncate">{spanNodes(ui, agentCostRow(a, width))}</Text>
      </Button>,
      s.agentsOpen?.includes(id) === true && agentCostDetails(a, s.now, s.cost.usd, '  ', width).map(spans => line(ui, spans)),
    ]
  }
  const agentsBlock: Block =
    agents.length > 0
      ? [gap(), title(S.costAgentsTitle), gap(), collapsible(k, 'costAgents', agents.map(agentRows), AGENT_COST_ROWS_SHOWN, s.isCostAgentsOpen === true, actions.toggleCostAgents)]
      : []

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
  // The context first (categories, the compact hint), then what the agents cost, then the outputs that grew the context
  return [breakdownBlock, agentsBlock, grewBlock].filter(b => b.length > 0)
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
  const wl = s.worklog

  const counts = taskCounts(s)
  const open = openTasks(s)
  const taskPart: Block =
    counts === null
      ? []
      : [
          gap(),
          title(`${S.taskTitle} · ${counts.done}/${counts.total}`, [sp(`◐ ${counts.inProgress}`, COLORS.blue), sp('  '), dim(`○ ${counts.pending}`), sp('  '), sp(`✓ ${counts.done}`, COLORS.green)]),
          gap(),
          line(ui, taskBarCells(width, counts.done, counts.inProgress, counts.total)),
          open.slice(0, MAX_TASK_ROWS).map(task => line(ui, taskRow(task, s.now, width))),
          open.length > MAX_TASK_ROWS && line(ui, [dim(`… +${open.length - MAX_TASK_ROWS}`)]),
          counts.done > 0 && line(ui, [sp('✓', COLORS.green), dim(S.tasksDone(counts.done))]),
        ]
  const wlRows = [...(wl.pending.length ? [worklogLabel('pending', wl.pending)] : []), ...(wl.underTarget.length ? [worklogLabel('underTarget', wl.underTarget)] : [])]
  const worklogPart: Block = wlRows.length > 0 ? [gap(), wlRows.map(text => line(ui, [sp('● ', COLORS.yellow), sp(text, COLORS.yellow)]))] : []

  // The deliver perimeter: its entries, the files touched since HEAD and the ones outside it (none claimed when git could not say)
  const check = s.perimeterCheck
  const outside = check?.outside ?? []
  const perimeterPart: Block =
    s.perimeter === undefined
      ? []
      : [
          gap(),
          line(ui, [dim(S.perimeter(s.perimeter.length)), ...(check ? [dim(S.filesTouched(check.files))] : [])]),
          check && (outside.length === 0 ? line(ui, [sp('✓ ', COLORS.green), dim(S.noFileOutside)]) : line(ui, [sp(S.filesOutside(outside.length), COLORS.red)])),
          collapsible(
            k,
            'outside',
            outside.map(file => [line(ui, [sp(`  ${truncMiddle(file, Math.max(4, width - 2))}`, COLORS.yellow)])]),
            MAX_OUTSIDE_ROWS,
            s.openKeys?.includes('outside') === true,
            () => actions.toggleOpen('outside'),
          ),
        ]
  const principalBlock: Block[] = perimeterPart.length + taskPart.length + worklogPart.length > 0 ? [[gap(), title(S.mainTitle), ...perimeterPart, ...taskPart, ...worklogPart]] : []

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

  // Links only: the pull requests of this chat (newest first) and the work items its branch and pull requests name
  const prs = [...(s.prs ?? [])].reverse()
  const items = workItemIds(s)
  const linkRows: Node[] = [
    ...prs.slice(0, MAX_LINK_ROWS).map(pr => (
      <Text wrap="truncate">
        {pr.url !== undefined ? <Link href={pr.url}>{`#${pr.number}`}</Link> : <Text>{`#${pr.number}`}</Text>}
        {spanNodes(ui, prSpans(pr, width))}
      </Text>
    )),
    prs.length > MAX_LINK_ROWS && line(ui, [dim(`… +${prs.length - MAX_LINK_ROWS}`)]),
    ...items.slice(0, MAX_LINK_ROWS).map(id => {
      const url = workItemUrl(s.alm, id)
      return (
        <Text wrap="truncate">
          {url !== undefined ? <Link href={url}>{`AB#${id}`}</Link> : <Text>{`AB#${id}`}</Text>}
          <Text dimColor>{` ${S.workItemsTitle}`}</Text>
        </Text>
      )
    }),
  ]
  const linksPart: Block = prs.length + items.length > 0 ? [gap(), title(S.linksTitle(prs.length + items.length)), gap(), linkRows] : []

  return [...principalBlock, changesPart, linksPart].filter(b => b.length > 0)
}

// ── Note ──

export function notesBlocks(k: Kit): Block[] {
  const { ui, s, width, gap, title, actions } = k
  const { Box, Button, Input, Text } = ui
  const S = t()
  const notes = s.notes ?? []
  // Every note is one row: its text (one line cut with … until pressed, then all its lines) and the three icon buttons on the right; odd rows get a band
  const noteRow = (n: CockpitNote, i: number) => {
    const lines = n.text.trimEnd().split(/\r?\n/)
    const isOpen = s.notesOpen?.includes(n.id) === true
    const first = lines[0] === '' ? ' ' : lines[0]
    return (
      <Box flexDirection="column" backgroundColor={i % 2 === 1 ? COLORS.band : undefined}>
        <Box columnGap={1}>
          <Box width={Math.max(1, width - NOTE_ICONS_W)}>
            <Button key={`note:toggle:${n.id}`} plain onPress={() => actions.toggleNote(n.id)}>
              {isOpen ? (
                // one Text so the Button cannot lay the lines side by side; lines wrap by display width, indentation and empty lines kept
                <Text wrap="wrap">{lines.map(text => (text === '' ? ' ' : text)).join('\n')}</Text>
              ) : (
                <Text wrap="truncate-end">{lines.length > 1 ? `${first}…` : first}</Text>
              )}
            </Button>
          </Box>
          <Box columnGap={1} alignItems="flex-start">
            <Button key={`note:edit:${n.id}`} plain onPress={() => actions.editNote(n.id)}>
              ✎
            </Button>
            <Button key={`note:send:${n.id}`} plain onPress={() => actions.sendNote(n.id)}>
              ➤
            </Button>
            <Button key={`note:delete:${n.id}`} plain onPress={() => actions.deleteNote(n.id)}>
              🗑
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
      Input && (
        <Input key="note" rows={NOTE_INPUT_ROWS} placeholder={S.notePlaceholder} value={s.noteDraft ?? ''} submitLabel={S.buttons.save} onInput={value => actions.setNoteDraft(value)} onSubmit={value => actions.saveNote(value)} />
      ),
      Input && (
        <Button key="note:save" onPress={() => actions.saveNote()}>
          {S.buttons.save}
        </Button>
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
