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
  buttons: { compact: 'compact' },

  // Header
  noRateData: 'no rate-limit data',
  compactRefused: "Can't compact now: retry when the reply ends",
  /** The Claude state's word; a running tool shows its own name instead. */
  state: { idle: 'ready', working: 'working', thinking: 'thinking', tool: '', waiting: 'waiting' },

  // Agents
  lastTool: 'last tool ',
  costDetail: { tokens: (n: string) => `tokens ${n}` },
  /** The label a background task's completion message gets in the log, in place of its raw tags. */
  notification: (kind: 'workflow' | 'agent', status: string | undefined) => `${kind}${status === undefined ? '' : ` ${status}`}`,
  askedModel: (asked: string, got: string, isForced: boolean) => `asked ${asked} → ${got}${isForced ? ' (env)' : ''}`,

  // Notifications
  signalText: {
    heavyAgent: (a: string, n: number) => ({ what: `subagent ${a} ${n >= LEGACY_TOKENS ? `weighs ${Math.round(n / 1000)}k tokens` : `costs $${n.toFixed(2)}`} or too much of the spend` }),
    opusReadOnly: (a: string) => ({ what: `Opus on a read-only agent (${a})` }),
    bigResult: (tool: string, chars: number) => ({ what: `${tool} result of ${Math.round(chars / 1000)}k characters` }),
    reread: (file: string, n: number) => ({ what: `${file} read ${n} times` }),
    failedCommand: (cmd: string, n: number) => ({ what: `command failed ${n} times: ${cmd}` }),
    coldAfterIdle: (share: number) => ({ what: `cache at ${share}% after a long pause` }),
    ctxGrowth: (n: number) => ({ what: `context +${Math.round(n / 1000)}k in a few rounds` }),
    doneClaims: (n: number) => ({ what: `${n} done-claim blocks` }),
    workflow: (kind: string, n?: number) => ({ what: kind === 'stall' ? 'workflow stalled (STALL)' : `workflow at round ${n}` }),
    permissionWait: (seconds: number) => ({ what: `permission waiting for ${seconds}s` }),
  },

  /** The toggle of a list cut to its first rows: `n` rows hidden, or shown (press to fold). */
  moreRows: (n: number) => `󰍟 +${n}`,
  lessRows: (n: number) => `󰍝 −${n}`,

  /** The desktop page (tabs In progress / Log); its buttons reuse `buttons.*` where a label exists. */
  desk: {
    tabs: { now: 'In progress', log: 'Log' },
    head: { context: 'Context', contextShort: 'CTX', cache: 'cache', left: 'left', renews: 'renews', pace: 'pace', urgent: 'URGENT', urgentHint: 'only what waits for you', nothingWaiting: 'nothing waiting for you' },
    log: { important: 'Important', all: 'All', session: 'session', flow: 'flow', newestTop: 'newest on top', showAll: 'show all', onlyImportant: 'important only', unattributed: 'Outside a round', empty: 'nothing logged yet', noPrompt: 'no text' },
    now: { request: 'REQUEST', flow: 'FLOW', outside: 'AGENTS OUTSIDE THE FLOW', cycle: 'cycle', step: 'step', noRequest: 'no open request', noFlow: 'no flow running', noAgents: 'no agent outside the flow' },
    buttons: { compact: 'Compact' },
  },

  // The single page: its four sections
  page: {
    inProgress: 'IN PROGRESS',
    done: 'LOG',
    /** A step tag of a workflow agent (`implement`, `retry`, `verify`, `suite`, `review`, `fix`, `list`, `review A`, `review B`, `merge`) in the task tree and the flow. */
    planStep: (step: string) => step,
    /** The one row that stands for the finished tasks of the tree under a flow. */
    planDone: (n: number) => `+${n} done`,
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
      error: (site: string, n: number) => `${site} swallowed ${n} ${plural(n, 'error', 'errors')}`,
      trimmed: (n: number) => `${n} older entries trimmed`,
      linkRestart: "Links from before a restart don't scroll",
      linkDenied: 'The chat refused the scroll: links are off',
      pr: (n: string, title: string) => `PR #${n}${title === '' ? '' : ` ${title}`}`,
    },
  },

  // Toasts and the command
  alertContext: (pct: number) => `context at ${pct}%`,
  alertCredits: (left: number) => `credits 5h: ${left}% left`,
  alertSubagent: (type: string) => `subagent ${type} failed`,
  commandDescription: 'Opens the cockpit pane',
  commandOpen: (place: 'side' | 'inline') => `Cockpit opened ${place === 'side' ? 'in the side pane' : 'above the prompt'}.`,
  commandClosed: 'cockpit closed',
  commandOpenHint: (place: 'side' | 'inline') => `Cockpit opened ${place === 'side' ? 'in the side pane' : 'above the prompt'} (/cockpit close closes it).`,
  commandWaiting: (reason: string, isTerminal: boolean) => `cockpit waiting for room: ${reason}${isTerminal ? ' (the terminal needs a wider window)' : ''}`,
}

export type Strings = typeof EN

const IT: Strings = {
  ...SHARED,
  buttons: { compact: 'compatta' },

  noRateData: 'nessun dato sui limiti',
  compactRefused: 'Non posso compattare ora: riprova a fine risposta',
  state: { idle: 'pronto', working: 'al lavoro', thinking: 'pensa', tool: '', waiting: 'attende' },

  lastTool: 'ultimo tool ',
  costDetail: { tokens: (n: string) => `token ${n}` },
  notification: (kind: 'workflow' | 'agent', status: string | undefined) => {
    const done: Record<string, string> = { completed: 'completato', failed: 'fallito', killed: 'interrotto' }
    return `${kind === 'agent' ? 'agente' : kind}${status === undefined ? '' : ` ${done[status] ?? status}`}`
  },
  askedModel: (asked: string, got: string, isForced: boolean) => `chiesto ${asked} → ${got}${isForced ? ' (env)' : ''}`,

  signalText: {
    heavyAgent: (a: string, n: number) => ({ what: `il subagent ${a} ${n >= LEGACY_TOKENS ? `pesa ${Math.round(n / 1000)}k token` : `costa $${n.toFixed(2)}`} o troppa parte della spesa` }),
    opusReadOnly: (a: string) => ({ what: `Opus su un agente di sola lettura (${a})` }),
    bigResult: (tool: string, chars: number) => ({ what: `risultato di ${tool} da ${Math.round(chars / 1000)}k caratteri` }),
    reread: (file: string, n: number) => ({ what: `${file} letto ${n} volte` }),
    failedCommand: (cmd: string, n: number) => ({ what: `comando fallito ${n} volte: ${cmd}` }),
    coldAfterIdle: (share: number) => ({ what: `cache al ${share}% dopo una pausa lunga` }),
    ctxGrowth: (n: number) => ({ what: `contesto +${Math.round(n / 1000)}k in pochi giri` }),
    doneClaims: (n: number) => ({ what: `${n} blocchi done-claim` }),
    workflow: (kind: string, n?: number) => ({ what: kind === 'stall' ? 'workflow fermo (STALL)' : `workflow al giro ${n}` }),
    permissionWait: (seconds: number) => ({ what: `permesso in attesa da ${seconds}s` }),
  },

  moreRows: (n: number) => `󰍟 +${n}`,
  lessRows: (n: number) => `󰍝 −${n}`,

  desk: {
    tabs: { now: 'In corso', log: 'Log' },
    head: { context: 'Contesto', contextShort: 'CTX', cache: 'cache', left: 'mancano', renews: 'si rinnova', pace: 'ritmo', urgent: 'URGENTE', urgentHint: 'solo ciò che aspetta te', nothingWaiting: 'niente aspetta te' },
    log: { important: 'Importanti', all: 'Tutto', session: 'sessione', flow: 'flow', newestTop: 'il più recente in alto', showAll: 'mostra tutto', onlyImportant: 'solo importanti', unattributed: 'Fuori da un giro', empty: 'ancora niente nel log', noPrompt: 'senza testo' },
    now: { request: 'RICHIESTA', flow: 'FLOW', outside: 'AGENTI FUORI DAL FLOW', cycle: 'ciclo', step: 'passo', noRequest: 'nessuna richiesta aperta', noFlow: 'nessun flow in corso', noAgents: 'nessun agente fuori dal flow' },
    buttons: { compact: 'Compatta' },
  },

  page: {
    inProgress: 'IN CORSO',
    done: 'LOG',
    planStep: (step: string) => ({ implement: 'implementa', retry: 'riprova', verify: 'verifica', red: 'test rossi', 'red verify': 'verifica rossa', suite: 'suite', review: 'revisiona', fix: 'correggi', list: 'elenca', 'review A': 'revisione A', 'review B': 'revisione B', merge: 'unisci' })[step] ?? step,
    planDone: (n: number) => `+${n} fatti`,
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
      error: (site: string, n: number) => `${site}: ${n} ${plural(n, 'errore ignorato', 'errori ignorati')}`,
      trimmed: (n: number) => `${n} voci più vecchie tagliate`,
      linkRestart: 'I link di prima del riavvio non scorrono',
      linkDenied: 'La chat ha rifiutato lo scorrimento: i link sono spenti',
      pr: (n: string, title: string) => `PR #${n}${title === '' ? '' : ` ${title}`}`,
    },
  },

  alertContext: (pct: number) => `contesto ${pctAfter('al', pct)}`,
  alertCredits: (left: number) => `crediti 5h: ${left}% residui`,
  alertSubagent: (type: string) => `subagent ${type} fallito`,
  commandDescription: 'Apre il pannello cockpit',
  commandOpen: (place: 'side' | 'inline') => `Cockpit aperto ${place === 'side' ? 'nel pannello laterale' : 'sopra il prompt'}.`,
  commandClosed: 'cockpit chiuso',
  commandOpenHint: (place: 'side' | 'inline') => `Cockpit aperto ${place === 'side' ? 'nel pannello laterale' : 'sopra il prompt'} (/cockpit chiudi lo chiude).`,
  commandWaiting: (reason: string, isTerminal: boolean) => `cockpit in attesa di spazio: ${reason}${isTerminal ? ' (il terminale richiede una finestra più larga)' : ''}`,
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
