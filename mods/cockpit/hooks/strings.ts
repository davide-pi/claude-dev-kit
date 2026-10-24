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
  cache: 'cache ',
  tokenShare: ' token  ',
  /** The four counters of an agent's row. */
  tokenLabels: { input: 'in ', output: '  out ', cacheRead: '  cr ', cacheWrite: '  cw ' },
  consumerKinds: { memory: 'file', mcp: 'mcp', agent: 'agent', skill: 'skill' },
  taskTitle: 'TASK',
  hookTitle: 'HOOK · done-claim',
  prTitle: 'PR',
  diffTitle: (file: string) => `diff · ${file}`,
}

const EN = {
  ...SHARED,
  /** The selected tab's label and every tab's tooltip; an unselected tab shows its icon only. */
  tabs: { agents: 'Subagents', context: 'Context', work: 'Work', insights: 'Insights', system: 'System', notes: 'Notes' },
  procHeader: { pid: 'PID', name: 'NAME', cpu: 'CPU', ram: 'RAM', ports: 'PORTS' },
  buttons: { compact: 'compact', logHours: 'log hours', send: 'send', refresh: 'refresh', close: 'close', save: 'save', edit: 'edit', delete: 'delete' },

  // Header
  contextTitle: 'CONTEXT',
  contextDetailsTitle: 'CONTEXT DETAILS',
  creditsTitle: 'CREDITS',
  vsExpected: 'vs expected 7d ',
  noRateData: 'no rate-limit data',
  contextAt: (pct: number) => `⚠ context at ${pct}%`,
  requestsLeft: (n: number) => `~${n} ${plural(n, 'request', 'requests')}`,
  unmapped: 'unmapped',
  /** The Claude state's word; a running tool shows its own name instead. */
  state: { idle: 'ready', working: 'working', thinking: 'thinking', tool: '', waiting: 'waiting' },

  // Subagents
  subagentsTitle: (running: number) => `SUBAGENTS · ${running} running`,
  askedModel: (asked: string, got: string, isForced: boolean) => `asked ${asked} → ${got}${isForced ? ' (env)' : ''}`,
  lastTool: 'last tool ',
  tokensToggle: 'tokens',
  historyTitle: 'HISTORY',

  // Context
  exact: 'exact',
  someExact: '✓ = exact',
  estimate: 'estimate',
  worthCompacting: '⚠ worth compacting',
  noReading: 'no reading',
  /** The engine's category names in this language; one not listed shows as the engine names it. */
  contextCategories: {} as Record<string, string>,
  consumersTitle: (n: number) => `CONSUMERS · top ${n}`,
  skillsTitle: (used: number) => `SKILLS · ${used} used`,
  skillsListed: (listed: number, total: number) => `${listed}/${total} listed`,
  trendTitle: (rounds: number) => `TREND · ${rounds} ${plural(rounds, 'round', 'rounds')}`,
  /** The one line of the trend: where the context went, how fast it grows per round and in how many rounds auto-compaction comes. */
  trendLine: (from: string, to: string, growth?: string, rounds?: number) =>
    `${from} → ${to}${growth ? ` (+${growth}/round)` : ''}${rounds === undefined ? '' : `, compact in ~${rounds} ${plural(rounds, 'round', 'rounds')}`}`,
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
  branchTitle: 'BRANCH',
  upstream: 'upstream ',
  noUpstream: 'no upstream',
  commitsFrom: (n: number, base: string) => `${n} ${plural(n, 'commit', 'commits')} from ${base}`,
  changesTitle: 'CHANGES',
  noChanges: 'no changes',
  prStates: { open: 'open', draft: 'draft', merged: 'merged', closed: 'closed' },
  review: 'review ',
  reviews: { approved: 'approved', changes: 'changes requested', pending: 'pending' },
  checks: 'checks ',

  // Insights
  rhythmTitle: 'RHYTHM',
  rhythm: { rounds: 'rounds', perRound: 'cost / round', costliest: 'costliest', compactions: 'compactions' },
  timeTitle: 'TIME',
  time: { model: 'model', tools: 'tools', wait: 'permissions' },
  toolsTitle: (calls: number) => `TOOLS · ${calls} ${plural(calls, 'call', 'calls')}`,
  lastTools: 'last',
  efficiencyTitle: 'EFFICIENCY',
  efficiency: { cacheHit: 'cache hit' },
  hintsTitle: 'HINTS',
  hints: {
    rereads: (file: string, n: number) => `⚠ ${file} read ${n} times`,
    coldCache: '⚠ cache under 50% for 3 rounds',
    failures: (n: number) => `⚠ ${n} failed commands`,
    subagents: (share: number) => `⚠ subagents used ${share}% of the tokens`,
    longRound: (length: string) => `⚠ the last round took ${length}`,
  },

  // System
  systemTitle: 'SYSTEM',
  processesTitle: 'PROCESSES',
  reading: 'reading…',
  unavailable: 'unavailable',
  noChildProcess: 'no child process',
  diskFree: 'free',
  mains: 'mains',
  charging: ' charging',

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
  alertChecks: (number: number) => `PR #${number}: checks failing`,
  commandDescription: 'Opens the cockpit pane',
  commandOpen: 'cockpit open',
  commandWaiting: (reason: string) => `cockpit waiting: ${reason}`,
}

export type Strings = typeof EN

const IT: Strings = {
  ...SHARED,
  tabs: { agents: 'Subagenti', context: 'Contesto', work: 'Lavoro', insights: 'Analisi', system: 'Sistema', notes: 'Note' },
  procHeader: { pid: 'PID', name: 'NOME', cpu: 'CPU', ram: 'RAM', ports: 'PORTE' },
  buttons: { compact: 'compatta', logHours: 'segna ore', send: 'invia', refresh: 'aggiorna', close: 'chiudi', save: 'salva', edit: 'modifica', delete: 'elimina' },

  contextTitle: 'CONTESTO',
  contextDetailsTitle: 'DETTAGLI CONTESTO',
  creditsTitle: 'CREDITI RESIDUI',
  vsExpected: "rispetto all'atteso 7d ",
  noRateData: 'nessun dato sui limiti',
  contextAt: (pct: number) => `⚠ contesto ${pctAfter('al', pct)}`,
  requestsLeft: (n: number) => `~${n} ${plural(n, 'richiesta', 'richieste')}`,
  unmapped: 'non mappato',
  state: { idle: 'pronto', working: 'al lavoro', thinking: 'pensa', tool: '', waiting: 'attende' },

  subagentsTitle: (running: number) => `SUBAGENTI · ${running} in corso`,
  askedModel: (asked: string, got: string, isForced: boolean) => `chiesto ${asked} → ${got}${isForced ? ' (env)' : ''}`,
  lastTool: 'ultimo tool ',
  tokensToggle: 'token',
  historyTitle: 'STORICO',

  exact: 'esatto',
  someExact: '✓ = esatto',
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
  skillsTitle: (used: number) => `SKILL · ${used} ${plural(used, 'usata', 'usate')}`,
  skillsListed: (listed: number, total: number) => `${listed}/${total} elencate`,
  trendTitle: (rounds: number) => `ANDAMENTO · ${rounds} ${plural(rounds, 'giro', 'giri')}`,
  trendLine: (from: string, to: string, growth?: string, rounds?: number) =>
    `${from} → ${to}${growth ? ` (+${growth}/giro)` : ''}${rounds === undefined ? '' : `, compattazione tra ~${rounds} ${plural(rounds, 'giro', 'giri')}`}`,
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
  branchTitle: 'RAMO',
  upstream: 'upstream ',
  noUpstream: 'nessun upstream',
  commitsFrom: (n: number, base: string) => `${n} commit da ${base}`,
  changesTitle: 'MODIFICHE',
  noChanges: 'nessuna modifica',
  prStates: { open: 'aperta', draft: 'bozza', merged: 'unita', closed: 'chiusa' },
  review: 'revisione ',
  reviews: { approved: 'approvata', changes: 'modifiche richieste', pending: 'in attesa' },
  checks: 'check ',

  rhythmTitle: 'RITMO',
  rhythm: { rounds: 'giri', perRound: 'costo / giro', costliest: 'il più caro', compactions: 'compattazioni' },
  timeTitle: 'TEMPO',
  time: { model: 'modello', tools: 'tool', wait: 'permessi' },
  toolsTitle: (calls: number) => `TOOL · ${calls} ${plural(calls, 'chiamata', 'chiamate')}`,
  lastTools: 'ultimi',
  efficiencyTitle: 'EFFICIENZA',
  efficiency: { cacheHit: 'cache hit' },
  hintsTitle: 'SUGGERIMENTI',
  hints: {
    rereads: (file: string, n: number) => `⚠ ${file} letto ${n} volte`,
    coldCache: '⚠ cache sotto il 50% da 3 giri',
    failures: (n: number) => `⚠ ${n} comandi falliti`,
    subagents: (share: number) => `⚠ i subagent hanno usato ${pctAfter('il', share)} dei token`,
    longRound: (length: string) => `⚠ l'ultimo giro è durato ${length}`,
  },

  systemTitle: 'SISTEMA',
  processesTitle: 'PROCESSI',
  reading: 'lettura…',
  unavailable: 'non disponibile',
  noChildProcess: 'nessun processo figlio',
  diskFree: 'liberi',
  mains: 'rete',
  charging: ' in carica',

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
  alertChecks: (number: number) => `PR #${number}: check falliti`,
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

export const setLang = (lang: Lang): void => {
  current = BUNDLES[lang]
}
