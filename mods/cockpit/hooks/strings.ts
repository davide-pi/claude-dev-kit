/**
 * Every text the pane shows, in English and in Italian. `t()` answers the language in force; the views read their words through it at
 * draw time (never into a module-level constant, which would freeze the language of the load). The language is the `lang` of
 * `<config dir>/cockpit.json` (`{ "lang": "it" }`), read at every session start: a missing, unreadable or unknown one is English.
 */

export type Lang = 'en' | 'it'

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many)

const EN = {
  tabs: { agents: 'Subagents', context: 'Context', work: 'Work', system: 'System' },
  /** What a pane too narrow for the whole tab bar falls back to. */
  tabsShort: { agents: 'Sub', context: 'Ctx', work: 'Wrk', system: 'Sys' },
  buttons: { compact: 'compact', logHours: 'log hours', send: 'send', exactCount: 'exact count', close: 'close' },
  notePlaceholder: 'quick note',

  // Header
  contextTitle: 'CONTEXT',
  creditsTitle: 'CREDITS',
  cache: 'cache ',
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
  tokenShare: ' token  ',
  /** The four counters of an agent's row; the same abbreviations in both languages. */
  tokenLabels: { input: 'in ', output: '  out ', cacheRead: '  cr ', cacheWrite: '  cw ' },
  historyTitle: 'HISTORY',

  // Context
  exact: 'exact',
  someExact: '✓ = exact',
  estimate: 'estimate',
  worthCompacting: '⚠ worth compacting',
  noReading: 'no reading',
  consumersTitle: (n: number) => `CONSUMERS · top ${n}`,
  consumerKinds: { memory: 'file', mcp: 'mcp', agent: 'agent', skill: 'skill' },
  skillsTitle: (used: number) => `SKILLS · ${used} used`,
  skillsListed: (listed: number, total: number) => `${listed}/${total} listed`,
  trendTitle: (rounds: number) => `TREND · ${rounds} ${plural(rounds, 'round', 'rounds')}`,

  // Work
  mainTitle: 'MAIN',
  taskTitle: 'TASK',
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
  workflowTitle: 'WORKFLOW',
  workflowAgents: 'agents ',
  hookTitle: 'HOOK · done-claim',
  changesTitle: 'CHANGES',
  noChanges: 'no changes',
  prTitle: 'PR',
  prStates: { open: 'open', draft: 'draft', merged: 'merged', closed: 'closed' },
  review: 'review ',
  reviews: { approved: 'approved', changes: 'changes requested', pending: 'pending' },
  checks: 'checks ',
  toolTitle: 'TOOL',

  // System
  systemTitle: 'SYSTEM',
  processesTitle: 'PROCESSES',
  reading: 'reading…',
  unavailable: 'unavailable',
  noChildProcess: 'no child process',
  max: 'max',
  diskFree: 'free',
  mains: 'mains',
  charging: ' charging',

  // The diff pane
  diffTitle: (file: string) => `diff · ${file}`,
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
  tabs: { agents: 'Subagenti', context: 'Contesto', work: 'Lavoro', system: 'Sistema' },
  tabsShort: { agents: 'Sub', context: 'Ctx', work: 'Lav', system: 'Sis' },
  buttons: { compact: 'compatta', logHours: 'segna ore', send: 'invia', exactCount: 'conteggio esatto', close: 'chiudi' },
  notePlaceholder: 'nota rapida',

  contextTitle: 'CONTESTO',
  creditsTitle: 'CREDITI RESIDUI',
  cache: 'cache ',
  vsExpected: 'vs atteso 7d ',
  noRateData: 'nessun dato sui limiti',
  contextAt: (pct: number) => `⚠ contesto al ${pct}%`,
  requestsLeft: (n: number) => `~${n} ${plural(n, 'richiesta', 'richieste')}`,
  unmapped: 'non mappato',
  state: { idle: 'pronto', working: 'al lavoro', thinking: 'pensa', tool: '', waiting: 'attende' },

  subagentsTitle: (running: number) => `SUBAGENTI · ${running} in corso`,
  askedModel: (asked: string, got: string, isForced: boolean) => `chiesto ${asked} → ${got}${isForced ? ' (env)' : ''}`,
  lastTool: 'ultimo tool ',
  tokenShare: ' token  ',
  tokenLabels: { input: 'in ', output: '  out ', cacheRead: '  cr ', cacheWrite: '  cw ' },
  historyTitle: 'STORICO',

  exact: 'esatto',
  someExact: '✓ = esatto',
  estimate: 'stima',
  worthCompacting: '⚠ conviene compattare',
  noReading: 'nessuna lettura',
  consumersTitle: (n: number) => `CONSUMI · primi ${n}`,
  consumerKinds: { memory: 'file', mcp: 'mcp', agent: 'agent', skill: 'skill' },
  skillsTitle: (used: number) => `SKILL · ${used} ${plural(used, 'usata', 'usate')}`,
  skillsListed: (listed: number, total: number) => `${listed}/${total} elencate`,
  trendTitle: (rounds: number) => `ANDAMENTO · ${rounds} round`,

  mainTitle: 'PRINCIPALE',
  taskTitle: 'TASK',
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
  workflowTitle: 'WORKFLOW',
  workflowAgents: 'agent ',
  hookTitle: 'HOOK · done-claim',
  changesTitle: 'MODIFICHE',
  noChanges: 'nessuna modifica',
  prTitle: 'PR',
  prStates: { open: 'aperta', draft: 'bozza', merged: 'unita', closed: 'chiusa' },
  review: 'revisione ',
  reviews: { approved: 'approvata', changes: 'modifiche richieste', pending: 'in attesa' },
  checks: 'check ',
  toolTitle: 'TOOL',

  systemTitle: 'SISTEMA',
  processesTitle: 'PROCESSI',
  reading: 'lettura…',
  unavailable: 'non disponibile',
  noChildProcess: 'nessun processo figlio',
  max: 'max',
  diskFree: 'liberi',
  mains: 'rete',
  charging: ' in carica',

  diffTitle: (file: string) => `diff · ${file}`,
  nothingToShow: 'niente da mostrare',
  diffUnreadable: 'file troppo grande o illeggibile',
  noHunk: 'nessun blocco da mostrare',
  diffCut: '… diff tagliato',

  alertContext: (pct: number) => `contesto al ${pct}%`,
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
