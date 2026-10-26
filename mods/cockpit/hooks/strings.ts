/**
 * Every text the pane shows, in English and in Italian. `t()` answers the language in force; the views read their words through it at
 * draw time (never into a module-level constant, which would freeze the language of the load). The language is the `lang` of
 * `<config dir>/cockpit.json` (`{ "lang": "it" }`), read at every session start: a missing, unreadable or unknown one is English.
 */

export type Lang = 'en' | 'it'

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many)

/** An Italian percent after its article: `il 90%`, `al 90%`, but `l'85%`, `all'85%` before a number read with a vowel (1, 8, 11, 80 to 89). */
const pctAfter = (article: 'il' | 'al', n: number): string => {
  const isVowel = n === 1 || n === 8 || n === 11 || (n >= 80 && n <= 89)
  return `${isVowel ? (article === 'il' ? "l'" : "all'") : `${article} `}${n}%`
}

/** What reads the same in both languages: written once, spread into both bundles. */
const SHARED = {
  costCacheHit: 'cache',
  cache: 'cache ',
  consumerKinds: { memory: 'file', mcp: 'mcp', agent: 'agent', skill: 'skill' },
  taskTitle: 'TASK',
  diffTitle: (file: string) => `diff · ${file}`,
  /** The four counters of an agent's row. */
  tokenLabels: { input: 'in ', output: '  out ', cacheRead: '  cr ', cacheWrite: '  cw ' },
}

const EN = {
  ...SHARED,
  /** Every tab's label, in the bar: text, never an icon alone. */
  tabs: { agents: 'Agents', context: 'Context', signals: 'Notifications', work: 'Work', notes: 'Notes' },
  tabsShort: { agents: 'Agt', context: 'Ctx', signals: 'Notif', work: 'Work', notes: 'Notes' },
  buttons: { compact: 'compact', retro: 'retrospective', retroDays: 'last 10 days', retroSession: 'this session', yes: 'yes', no: 'no', logHours: 'log hours', send: 'send', refresh: 'refresh', close: 'close', save: 'save', edit: 'edit', delete: 'delete' },
  confirmLog: 'log the hours of this chat?',
  confirmSuite: 'which retrospective? sends /retro',
  confirmNoteDelete: 'delete this note?',

  // Header
  contextTitle: 'CONTEXT',
  contextDetailsTitle: 'CONTEXT DETAILS',
  creditsTitle: 'CREDITS',
  vsExpected: 'vs expected 7d ',
  noRateData: 'no rate-limit data',
  contextAt: (pct: number) => `⚠ context at ${pct}%`,
  requestsLeft: (n: number) => `~${n} ${plural(n, 'request', 'requests')}`,
  /** The Claude state's word; a running tool shows its own name instead. */
  state: { idle: 'ready', working: 'working', thinking: 'thinking', tool: '', waiting: 'waiting' },

  // Agents
  subagentsTitle: (running: number) => `SUBAGENTS · ${running} running`,
  lastTool: 'last tool ',
  /** The rows of an expanded TOP AGENTS entry (Context tab). */
  costDetail: { tokens: (n: string) => `tokens ${n}`, time: (d: string) => `time ${d}`, share: (pct: string) => `${pct} of the session cost`, outcome: { running: 'running', done: 'done', failed: 'failed' } },
  historyTitle: 'HISTORY',
  askedModel: (asked: string, got: string, isForced: boolean) => `asked ${asked} → ${got}${isForced ? ' (env)' : ''}`,
  /** The workflow run in one row: its name, phase, round, finished agents out of all of them and what they cost. */
  workflowRow: (name: string | undefined, phase: string, round: number | undefined, done: number, total: number, usd: string) =>
    `workflow${name ? ` ${name}` : ''} · ${phase}${round === undefined ? '' : ` · round ${round}`} · ${done}/${total} · ${usd}`,

  // Notifications
  signalsTitle: (n: number) => `NOTIFICATIONS · ${n}`,
  noSignals: 'no notifications',
  signalFields: { why: 'why: ', todo: 'what to do: ' },
  signalText: {
    heavyAgent: (a: string, n: number) => ({ what: `subagent ${a} weighs ${Math.round(n / 1000)}k tokens or too much of the spend`, why: 'it burns budget and context out of sight', todo: 'check what it does; narrow the task or change the model' }),
    opusReadOnly: (a: string) => ({ what: `Opus on a read-only agent (${a})`, why: 'Opus costs far more and a read does not need it', todo: 'set model sonnet or haiku for this agent type' }),
    bigResult: (tool: string, chars: number) => ({ what: `${tool} result of ${Math.round(chars / 1000)}k characters`, why: 'it stays in the context every round and swells it', todo: 'limit the output (filter, use head/offset) or compact' }),
    reread: (file: string, n: number) => ({ what: `${file} read ${n} times`, why: 'every read pays again for tokens already spent', todo: 'remember what you need from the file or read only the useful part' }),
    failedCommand: (cmd: string, n: number) => ({ what: `command failed ${n} times: ${cmd}`, why: 'the same error repeats without a change of approach', todo: 'read the error and fix the cause instead of rerunning' }),
    coldAfterIdle: (share: number) => ({ what: `cache at ${share}% after a long pause`, why: 'the cache expired: the round paid for the whole context again', todo: 'with long pauses, compact before resuming' }),
    ctxGrowth: (n: number) => ({ what: `context +${Math.round(n / 1000)}k in a few rounds`, why: 'it nears compaction and every round costs more', todo: 'find what swelled it (Context) and compact' }),
    doneClaims: (n: number) => ({ what: `${n} done-claim blocks`, why: 'the model says it is done without proof, more than once', todo: 'ask for the proof (command and output) before accepting' }),
    workflow: (kind: string, n?: number) => (kind === 'stall' ? { what: 'workflow stalled (STALL)', why: 'no agent has done anything for minutes: an event may have been lost', todo: 'check the agents in the Agents tab; stop or rerun' } : { what: `workflow at round ${n}`, why: 'past the third round the work is not converging', todo: 'stop and review the perimeter or the criterion' }),
    permissionWait: (seconds: number) => ({ what: `permission waiting for ${seconds}s`, why: 'the work is stopped until you answer', todo: 'answer the request in the terminal' }),
  },

  // Costs
  costAgentsTitle: 'TOP AGENTS',
  exact: 'exact',
  someExact: '~ = estimate',
  /** The toggle of a list cut to its first rows: `n` rows hidden, or shown (press to fold). */
  moreRows: (n: number) => `▸ +${n}`,
  lessRows: (n: number) => `▾ −${n}`,
  estimate: 'estimate',
  worthCompacting: '⚠ worth compacting',
  noReading: 'no reading',
  /** The engine's category names in this language; one not listed shows as the engine names it. */
  contextCategories: {} as Record<string, string>,
  consumersTitle: (n: number) => `CONSUMERS · top ${n}`,
  refreshIn: (seconds: number) => `refresh ${seconds}s`,

  // Work
  mainTitle: 'MAIN',
  tasksDone: (n: number) => ` ${n} done`,
  perimeter: (entries: number) => `deliver perimeter · ${entries} ${plural(entries, 'entry', 'entries')}`,
  filesTouched: (n: number) => ` · ${n} ${plural(n, 'file', 'files')} touched`,
  noFileOutside: 'no file outside the perimeter',
  filesOutside: (n: number) => `⚠ ${n} ${plural(n, 'file', 'files')} outside the perimeter`,
  worklog: {
    pending: 'to log',
    underTarget: 'under target',
    label: (days: number, what: string, dates: string) => `worklog: ${days}d ${what} (${dates})`,
  },
  changesTitle: 'CHANGES',
  editedHere: '● this chat',
  noChanges: 'no changes',
  linksTitle: (n: number) => `LINKS · ${n}`,
  workItemsTitle: 'work item',

  // Context growth
  grewTitle: 'WHAT GREW THE CONTEXT',

  // Notes
  notesTitle: (n: number) => `NOTES · ${n}`,
  notePlaceholder: 'quick note',
  noNotes: 'no saved notes',
  moreLines: (n: number) => `▸ +${n} ${plural(n, 'line', 'lines')}`,
  lessLines: (n: number) => `▾ −${n} ${plural(n, 'line', 'lines')}`,

  // The diff pane
  nothingToShow: 'nothing to show',
  diffUnreadable: 'file too big or unreadable',
  noHunk: 'no hunk to show',
  diffCut: '… diff cut',

  // Toasts and the command
  alertContext: (pct: number) => `context at ${pct}%`,
  alertCredits: (left: number) => `credits 5h: ${left}% left`,
  alertSubagent: (type: string) => `subagent ${type} failed`,
  commandDescription: 'Opens the cockpit pane',
  commandOpen: 'cockpit open',
  commandWaiting: (reason: string) => `cockpit waiting: ${reason}`,
}

export type Strings = typeof EN

const IT: Strings = {
  ...SHARED,
  tabs: { agents: 'Agenti', context: 'Contesto', signals: 'Notifiche', work: 'Lavoro', notes: 'Note' },
  tabsShort: { agents: 'Agt', context: 'Ctx', signals: 'Notif', work: 'Lav', notes: 'Note' },
  buttons: { compact: 'compatta', retro: 'retrospettiva', retroDays: 'ultimi 10 giorni', retroSession: 'questa sessione', yes: 'sì', no: 'no', logHours: 'segna ore', send: 'invia', refresh: 'aggiorna', close: 'chiudi', save: 'salva', edit: 'modifica', delete: 'elimina' },
  confirmLog: 'registrare le ore di questa chat?',
  confirmSuite: 'quale retrospettiva? invia /retro',
  confirmNoteDelete: 'eliminare questa nota?',

  contextTitle: 'CONTESTO',
  contextDetailsTitle: 'DETTAGLI CONTESTO',
  creditsTitle: 'CREDITI RESIDUI',
  vsExpected: "rispetto all'atteso 7d ",
  noRateData: 'nessun dato sui limiti',
  contextAt: (pct: number) => `⚠ contesto ${pctAfter('al', pct)}`,
  requestsLeft: (n: number) => `~${n} ${plural(n, 'richiesta', 'richieste')}`,
  state: { idle: 'pronto', working: 'al lavoro', thinking: 'pensa', tool: '', waiting: 'attende' },

  subagentsTitle: (running: number) => `SUBAGENTI · ${running} in corso`,
  lastTool: 'ultimo tool ',
  costDetail: { tokens: (n: string) => `token ${n}`, time: (d: string) => `tempo ${d}`, share: (pct: string) => `${pct} del costo della sessione`, outcome: { running: 'in corso', done: 'finito', failed: 'fallito' } },
  historyTitle: 'STORICO',
  askedModel: (asked: string, got: string, isForced: boolean) => `chiesto ${asked} → ${got}${isForced ? ' (env)' : ''}`,
  workflowRow: (name: string | undefined, phase: string, round: number | undefined, done: number, total: number, usd: string) =>
    `workflow${name ? ` ${name}` : ''} · ${phase}${round === undefined ? '' : ` · giro ${round}`} · ${done}/${total} · ${usd}`,

  signalsTitle: (n: number) => `NOTIFICHE · ${n}`,
  noSignals: 'nessuna notifica',
  signalFields: { why: 'perché: ', todo: 'cosa fare: ' },
  signalText: {
    heavyAgent: (a: string, n: number) => ({ what: `il subagent ${a} pesa ${Math.round(n / 1000)}k token o troppa parte della spesa`, why: 'consuma budget e contesto senza che lo si veda', todo: 'verifica cosa fa; restringi il compito o cambia modello' }),
    opusReadOnly: (a: string) => ({ what: `Opus su un agente di sola lettura (${a})`, why: 'Opus costa molto di più e una lettura non ne ha bisogno', todo: 'imposta model sonnet o haiku per questo tipo di agente' }),
    bigResult: (tool: string, chars: number) => ({ what: `risultato di ${tool} da ${Math.round(chars / 1000)}k caratteri`, why: 'resta nel contesto a ogni giro e lo gonfia', todo: "limita l'output (filtra, usa head/offset) o compatta" }),
    reread: (file: string, n: number) => ({ what: `${file} letto ${n} volte`, why: 'ogni lettura ripaga token già spesi', todo: 'ricorda cosa serve del file o leggine solo la parte utile' }),
    failedCommand: (cmd: string, n: number) => ({ what: `comando fallito ${n} volte: ${cmd}`, why: 'si ripete lo stesso errore senza cambiare approccio', todo: "leggi l'errore, correggi la causa invece di rilanciare" }),
    coldAfterIdle: (share: number) => ({ what: `cache al ${share}% dopo una pausa lunga`, why: 'la cache è scaduta: il giro ha ripagato tutto il contesto', todo: 'con pause lunghe compatta prima di riprendere' }),
    ctxGrowth: (n: number) => ({ what: `contesto +${Math.round(n / 1000)}k in pochi giri`, why: 'si avvicina alla compattazione e ogni giro costa di più', todo: 'trova cosa lo ha gonfiato (Contesto) e compatta' }),
    doneClaims: (n: number) => ({ what: `${n} blocchi done-claim`, why: 'il modello dichiara finito senza prove, più volte', todo: 'chiedi la prova (comando e output) prima di accettare' }),
    workflow: (kind: string, n?: number) => (kind === 'stall' ? { what: 'workflow fermo (STALL)', why: 'nessun agente ha fatto nulla da minuti: forse perso un evento', todo: 'controlla gli agenti in Agenti; interrompi o rilancia' } : { what: `workflow al giro ${n}`, why: 'oltre il terzo giro il lavoro non converge', todo: 'fermati e rivedi il perimetro o il criterio' }),
    permissionWait: (seconds: number) => ({ what: `permesso in attesa da ${seconds}s`, why: 'il lavoro è fermo finché non rispondi', todo: 'rispondi alla richiesta nel terminale' }),
  },

  costAgentsTitle: 'AGENTI PIÙ CARI',
  exact: 'esatto',
  someExact: '~ = stima',
  moreRows: (n: number) => `▸ +${n}`,
  lessRows: (n: number) => `▾ −${n}`,
  estimate: 'stima',
  worthCompacting: '⚠ conviene compattare',
  noReading: 'nessuna lettura',
  contextCategories: {
    'System prompt': 'Prompt di sistema',
    'System tools': 'Tool di sistema',
    'MCP tools': 'Tool MCP',
    'Custom agents': 'Agenti personalizzati',
    'Memory files': 'File di memoria',
    Skills: 'Skill',
    Messages: 'Messaggi',
    'Free space': 'Spazio libero',
    'Autocompact buffer': 'Riserva di compattazione',
  },
  consumersTitle: (n: number) => `CONSUMI · primi ${n}`,
  refreshIn: (seconds: number) => `aggiorna ${seconds}s`,

  mainTitle: 'PRINCIPALE',
  tasksDone: (n: number) => ` ${n} ${plural(n, 'fatto', 'fatti')}`,
  perimeter: (entries: number) => `perimetro deliver · ${entries} ${plural(entries, 'voce', 'voci')}`,
  filesTouched: (n: number) => ` · ${n} ${plural(n, 'file toccato', 'file toccati')}`,
  noFileOutside: 'nessun file fuori dal perimetro',
  filesOutside: (n: number) => `⚠ ${n} file fuori dal perimetro`,
  worklog: {
    pending: 'da registrare',
    underTarget: 'sotto target',
    label: (days: number, what: string, dates: string) => `worklog: ${days}g ${what} (${dates})`,
  },
  changesTitle: 'MODIFICHE',
  editedHere: '● questa chat',
  noChanges: 'nessuna modifica',
  linksTitle: (n: number) => `LINK · ${n}`,
  workItemsTitle: 'work item',

  grewTitle: 'COSA HA GONFIATO IL CONTESTO',


  notesTitle: (n: number) => `NOTE · ${n}`,
  notePlaceholder: 'nota rapida',
  noNotes: 'nessuna nota salvata',
  moreLines: (n: number) => `▸ +${n} ${plural(n, 'riga', 'righe')}`,
  lessLines: (n: number) => `▾ −${n} ${plural(n, 'riga', 'righe')}`,

  nothingToShow: 'niente da mostrare',
  diffUnreadable: 'file troppo grande o illeggibile',
  noHunk: 'nessun blocco da mostrare',
  diffCut: '… diff tagliato',

  alertContext: (pct: number) => `contesto ${pctAfter('al', pct)}`,
  alertCredits: (left: number) => `crediti 5h: ${left}% residui`,
  alertSubagent: (type: string) => `subagent ${type} fallito`,
  commandDescription: 'Apre il pannello cockpit',
  commandOpen: 'cockpit aperto',
  commandWaiting: (reason: string) => `cockpit in attesa: ${reason}`,
}

const BUNDLES: Record<Lang, Strings> = { en: EN, it: IT }

let current: Strings = EN

/** The pane's texts in the language in force. */
export const t = (): Strings => current

/** The language `cockpit.json` names: `it` or `en`; text that is not that file, or a language not offered, is English. */
export function langOf(text: string): Lang {
  try {
    const lang: unknown = (JSON.parse(text) as { lang?: unknown } | null)?.lang
    return lang === 'it' ? 'it' : 'en'
  } catch {
    return 'en'
  }
}

/** Whether `cockpit.json` lets the pane open at session start: true unless it says `"autoOpen": false`. */
export function autoOpenOf(text: string): boolean {
  try {
    return (JSON.parse(text) as { autoOpen?: unknown } | null)?.autoOpen !== false
  } catch {
    return true
  }
}

export const setLang = (lang: Lang): void => {
  current = BUNDLES[lang]
}
