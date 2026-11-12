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
  cache:'\u{F09D1} ',
  /** The four counters of an agent's row. */
  tokenLabels: { input: 'in ', output: '  out ', cacheRead: '  cr ', cacheWrite: '  cw ' },
}

/** A heavyAgent saved before it counted dollars holds tokens: no subagent costs this much, so a number this large reads as tokens. */
const LEGACY_TOKENS = 1000

const EN = {
  ...SHARED,
  buttons: { compact: 'compact', retro: 'retrospective', retroDays: 'last 10 days', retroSession: 'this session', no: 'no', logHours: 'log hours', logSession: 'this chat', logDay: 'today' },
  confirmLog: 'which hours? sends /worklog',
  confirmRetro: 'which retrospective? sends /retro',

  // Header
  noRateData: 'no rate-limit data',
  /** The Claude state's word; a running tool shows its own name instead. */
  state: { idle: 'ready', working: 'working', thinking: 'thinking', tool: '', waiting: 'waiting' },

  // Agents
  lastTool: 'last tool ',
  costDetail: { tokens: (n: string) => `tokens ${n}` },
  askedModel: (asked: string, got: string, isForced: boolean) => `asked ${asked} → ${got}${isForced ? ' (env)' : ''}`,

  // Notifications
  signalFields: { why: 'why: ', todo: 'what to do: ' },
  signalText: {
    heavyAgent: (a: string, n: number) => ({ what: `subagent ${a} ${n >= LEGACY_TOKENS ? `weighs ${Math.round(n / 1000)}k tokens` : `costs $${n.toFixed(2)}`} or too much of the spend`, why: 'it burns budget and context out of sight', todo: 'check what it does; narrow the task or change the model' }),
    opusReadOnly: (a: string) => ({ what: `Opus on a read-only agent (${a})`, why: 'Opus costs far more and a read does not need it', todo: 'set model sonnet or haiku for this agent type' }),
    bigResult: (tool: string, chars: number) => ({ what: `${tool} result of ${Math.round(chars / 1000)}k characters`, why: 'it stays in the context every round and swells it', todo: 'limit the output (filter, use head/offset) or compact' }),
    reread: (file: string, n: number) => ({ what: `${file} read ${n} times`, why: 'every read pays again for tokens already spent', todo: 'remember what you need from the file or read only the useful part' }),
    failedCommand: (cmd: string, n: number) => ({ what: `command failed ${n} times: ${cmd}`, why: 'the same error repeats without a change of approach', todo: 'read the error and fix the cause instead of rerunning' }),
    coldAfterIdle: (share: number) => ({ what: `cache at ${share}% after a long pause`, why: 'the cache expired: the round paid for the whole context again', todo: 'with long pauses, compact before resuming' }),
    ctxGrowth: (n: number) => ({ what: `context +${Math.round(n / 1000)}k in a few rounds`, why: 'it nears compaction and every round costs more', todo: 'find what swelled it and compact' }),
    doneClaims: (n: number) => ({ what: `${n} done-claim blocks`, why: 'the model says it is done without proof, more than once', todo: 'ask for the proof (command and output) before accepting' }),
    workflow: (kind: string, n?: number) => (kind === 'stall' ? { what: 'workflow stalled (STALL)', why: 'no agent has done anything for minutes: an event may have been lost', todo: 'check the agents under IN PROGRESS; stop or rerun' } : { what: `workflow at round ${n}`, why: 'past the third round the work is not converging', todo: 'stop and review the perimeter or the criterion' }),
    permissionWait: (seconds: number) => ({ what: `permission waiting for ${seconds}s`, why: 'the work is stopped until you answer', todo: 'answer the request in the terminal' }),
  },

  /** The toggle of a list cut to its first rows: `n` rows hidden, or shown (press to fold). */
  moreRows: (n: number) => `󰍟 +${n}`,
  lessRows: (n: number) => `󰍝 −${n}`,

  // Work
  perimeter: (entries: number) => `deliver perimeter · ${entries} ${plural(entries, 'entry', 'entries')}`,
  filesOutside: (n: number) => `󰀦 ${n} ${plural(n, 'file', 'files')} outside the perimeter`,
  worklog: {
    pending: 'to log',
    underTarget: 'under target',
    label: (days: number, what: string, dates: string) => `worklog: ${days}d ${what} (${dates})`,
    withoutHours: (n: number) => `${n} ${plural(n, 'day', 'days')} without logged hours`,
  },

  // The single page: its four sections
  page: {
    attention: 'ATTENTION',
    trend: 'TREND',
    inProgress: 'IN PROGRESS',
    done: 'LOG',
    nothingToDo: 'nothing to do',
    spend: 'spend',
    context: 'context',
    main: 'main',
    mainShort: 'main',
    other: 'other',
    tasks: (done: number, total: number) => `tasks ${done}/${total}`,
    events: {
      round: (n: number) => `round ${String(n).padStart(3, '0')}`,
      current: 'current round',
      chatOnly: (n: number) => `${n} chat-only rounds`,
      summary: {
        tools: (n: number, top: string) => `${n} ${plural(n, 'tool', 'tools')}: ${top}`,
        signal: (n: number) => `${n} ${plural(n, 'signal', 'signals')}`,
        agent: (n: number) => `${n} ${plural(n, 'agent', 'agents')}`,
        commit: (n: number) => `${n} ${plural(n, 'commit', 'commits')}`,
        test: (n: number) => `${n} ${plural(n, 'test', 'tests')}`,
        pr: (n: number) => `${n} PR`,
        compact: (n: number) => `${n} ${plural(n, 'compaction', 'compactions')}`,
        fails: (n: number) => `${n} failed ${plural(n, 'tool', 'tools')}`,
        waits: (n: number, total: string) => `${n} ${plural(n, 'wait', 'waits')} ${total}`,
      },
      files: 'file',
      wait: 'waited',
      commit: (hash: string, subject = '') => `commit${hash === '' ? '' : ` ${hash}`}${subject === '' || subject === hash ? '' : ` ${subject}`}`,
      test: (cmd: string, isFailed: boolean) => `tests ${isFailed ? 'failed' : 'passed'}: ${cmd}`,
      compact: (before: string, after: string) => ['compacted', before, after === '' ? '' : `→ ${after}`].filter(Boolean).join(' '),
      pr: (n: string, title: string) => `PR #${n}${title === '' ? '' : ` ${title}`}`,
    },
  },

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
  buttons: { compact: 'compatta', retro: 'retrospettiva', retroDays: 'ultimi 10 giorni', retroSession: 'questa sessione', no: 'no', logHours: 'segna ore', logSession: 'questa chat', logDay: 'oggi' },
  confirmLog: 'quali ore? invia /worklog',
  confirmRetro: 'quale retrospettiva? invia /retro',

  noRateData: 'nessun dato sui limiti',
  state: { idle: 'pronto', working: 'al lavoro', thinking: 'pensa', tool: '', waiting: 'attende' },

  lastTool: 'ultimo tool ',
  costDetail: { tokens: (n: string) => `token ${n}` },
  askedModel: (asked: string, got: string, isForced: boolean) => `chiesto ${asked} → ${got}${isForced ? ' (env)' : ''}`,

  signalFields: { why: 'perché: ', todo: 'cosa fare: ' },
  signalText: {
    heavyAgent: (a: string, n: number) => ({ what: `il subagent ${a} ${n >= LEGACY_TOKENS ? `pesa ${Math.round(n / 1000)}k token` : `costa $${n.toFixed(2)}`} o troppa parte della spesa`, why: 'consuma budget e contesto senza che lo si veda', todo: 'verifica cosa fa; restringi il compito o cambia modello' }),
    opusReadOnly: (a: string) => ({ what: `Opus su un agente di sola lettura (${a})`, why: 'Opus costa molto di più e una lettura non ne ha bisogno', todo: 'imposta model sonnet o haiku per questo tipo di agente' }),
    bigResult: (tool: string, chars: number) => ({ what: `risultato di ${tool} da ${Math.round(chars / 1000)}k caratteri`, why: 'resta nel contesto a ogni giro e lo gonfia', todo: "limita l'output (filtra, usa head/offset) o compatta" }),
    reread: (file: string, n: number) => ({ what: `${file} letto ${n} volte`, why: 'ogni lettura ripaga token già spesi', todo: 'ricorda cosa serve del file o leggine solo la parte utile' }),
    failedCommand: (cmd: string, n: number) => ({ what: `comando fallito ${n} volte: ${cmd}`, why: 'si ripete lo stesso errore senza cambiare approccio', todo: "leggi l'errore, correggi la causa invece di rilanciare" }),
    coldAfterIdle: (share: number) => ({ what: `cache al ${share}% dopo una pausa lunga`, why: 'la cache è scaduta: il giro ha ripagato tutto il contesto', todo: 'con pause lunghe compatta prima di riprendere' }),
    ctxGrowth: (n: number) => ({ what: `contesto +${Math.round(n / 1000)}k in pochi giri`, why: 'si avvicina alla compattazione e ogni giro costa di più', todo: 'trova cosa lo ha gonfiato e compatta' }),
    doneClaims: (n: number) => ({ what: `${n} blocchi done-claim`, why: 'il modello dichiara finito senza prove, più volte', todo: 'chiedi la prova (comando e output) prima di accettare' }),
    workflow: (kind: string, n?: number) => (kind === 'stall' ? { what: 'workflow fermo (STALL)', why: 'nessun agente ha fatto nulla da minuti: forse perso un evento', todo: 'controlla gli agenti in IN CORSO; interrompi o rilancia' } : { what: `workflow al giro ${n}`, why: 'oltre il terzo giro il lavoro non converge', todo: 'fermati e rivedi il perimetro o il criterio' }),
    permissionWait: (seconds: number) => ({ what: `permesso in attesa da ${seconds}s`, why: 'il lavoro è fermo finché non rispondi', todo: 'rispondi alla richiesta nel terminale' }),
  },

  moreRows: (n: number) => `󰍟 +${n}`,
  lessRows: (n: number) => `󰍝 −${n}`,

  perimeter: (entries: number) => `perimetro deliver · ${entries} ${plural(entries, 'voce', 'voci')}`,
  filesOutside: (n: number) => `󰀦 ${n} file fuori dal perimetro`,
  worklog: {
    pending: 'da registrare',
    underTarget: 'sotto target',
    label: (days: number, what: string, dates: string) => `worklog: ${days}g ${what} (${dates})`,
    withoutHours: (n: number) => `${n} ${plural(n, 'giorno', 'giorni')} senza ore segnate`,
  },

  page: {
    attention: 'ATTENZIONE',
    trend: 'ANDAMENTO',
    inProgress: 'IN CORSO',
    done: 'LOG',
    nothingToDo: 'niente da fare',
    spend: 'spesa',
    context: 'contesto',
    main: 'principale',
    mainShort: 'princ.',
    other: 'altro',
    tasks: (done: number, total: number) => `task ${done}/${total}`,
    events: {
      round: (n: number) => `giro ${String(n).padStart(3, '0')}`,
      current: 'giro in corso',
      chatOnly: (n: number) => `${n} giri di sola conversazione`,
      summary: {
        tools: (n: number, top: string) => `${n} ${plural(n, 'strumento', 'strumenti')}: ${top}`,
        signal: (n: number) => `${n} ${plural(n, 'segnale', 'segnali')}`,
        agent: (n: number) => `${n} ${plural(n, 'agente', 'agenti')}`,
        commit: (n: number) => `${n} commit`,
        test: (n: number) => `${n} test`,
        pr: (n: number) => `${n} PR`,
        compact: (n: number) => `${n} ${plural(n, 'compattazione', 'compattazioni')}`,
        fails: (n: number) => `${n} ${plural(n, 'strumento fallito', 'strumenti falliti')}`,
        waits: (n: number, total: string) => `${n} ${plural(n, 'attesa', 'attese')} ${total}`,
      },
      files: 'file',
      wait: 'atteso',
      commit: (hash: string, subject = '') => `commit${hash === '' ? '' : ` ${hash}`}${subject === '' || subject === hash ? '' : ` ${subject}`}`,
      test: (cmd: string, isFailed: boolean) => `test ${isFailed ? 'falliti' : 'passati'}: ${cmd}`,
      compact: (before: string, after: string) => ['compattato', before, after === '' ? '' : `→ ${after}`].filter(Boolean).join(' '),
      pr: (n: string, title: string) => `PR #${n}${title === '' ? '' : ` ${title}`}`,
    },
  },

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
