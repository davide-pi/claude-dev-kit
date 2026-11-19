/**
 * Stop hook (tier 1 of `done-claim`, on in the template's settings): a turn that changed files and ends
 * claiming success without showing the evidence is sent back once to show it.
 *
 * "Done means verified" is the standing rule most often broken in the letter: the reply says
 * "fatto" / "fixed" / "passing" and the command that would prove it is nowhere in the message. This
 * tier costs no tokens — it is a regex over the final message, run only when the turn changed something
 * (an edit, an editing delegate, a shell write: below): a question answered with "sì, è fatto" is not a
 * claim about a change made now.
 *
 * Fires when ALL hold:
 *   - `CLAUDE_DONE_CLAIM=1` (set in the kit's settings.json; anything else and the hook exits at once);
 *   - not `stop_hook_active` (it already sent the turn back once: never loop; the hand-off is still written);
 *   - the turn since the last human prompt used an editing tool, or delegated (`Workflow`, or an `Agent` / `Task`
 *     that is not a read-only type such as Explore or a reviewer: an editing delegate counts as an edit, its work
 *     is a change made now), or ran a shell write that ships or installs (`git commit` / `push` / `merge`,
 *     `gh pr create` / `merge`, `Copy-Item`): a commit, a merge or an install claimed done is a change made now too.
 *     A shell command run after the last edit excuses nothing: its output must still be quoted in the message. The turn ends at the last genuine human
 *     prompt only: a workflow result or an agent hand-back arrives as a user entry holding a
 *     `<task-notification>` (or a cross-session message after a delegate), not as a `tool_result` block, and
 *     belongs to the turn, whether or not a delegate ran before it;
 *   - the final message has a claim word (fatto, done, fixed, passing, verificato, …) outside
 *     inline code;
 *   - and no evidence in the message itself: no fenced block, no `> ` quoted output line (a
 *     `> **Detail**` / `> **Dettaglio**` block and a `> - ` bullet line are prose, not output), no inline `` `command` → result ``, no honest
 *     "non verificato" / "not verified".
 *
 * A `deliver` verdict (a `**Verifica**` / `**Verification**` title, then the table `| Livello | Comando | Riga che decide | Stato |` (English `Level`,
 * `Command`, `Deciding line`, `Status`; columns found by header name, the header alone anchors a table with no title, leading pipes optional) with one row per check; or the
 * stacked form, per check the lines `Livello:`, `Comando:`, `Riga che decide:`, `Stato:` with a `────` line between checks; each line with or without a
 * `> ` prefix; its title and lines are prose, never tool output; a table row that does not map to the header's columns or whose Stato is missing or no
 * known state, and a stacked check with no `Stato:`, is an unproven row, never dropped; see `parseVerdicts`; the block reasons ask for the table)
 * is judged check by check instead: a check whose status starts with `fatto`, `done`, `fallito` or `failed` (markup, symbols and a trailing note
 * dropped; never one that says `non verificato`) is proven only when its deciding line (normalised: whitespace
 * collapsed, backslashes and backticks stripped, lowercase) is a substring of what the turn's tools
 * printed (tool results, task notifications, cross-session messages: the model's own text never counts).
 * A `non verificato` row passes alone and excuses no other row; one unproven row blocks, even after a
 * shell command ran. The transcript is read backward to the turn's start (cap 8 MB); when the turn is still
 * cut the proof may be in the part not read, so it fails closed: the log notes `tail-cut` and the turn is sent
 * back once to rewrite the verdict with fresh output (or "non verificato"); a cut turn whose message holds
 * such a verdict is judged even when no edit is visible in the part read (the edit may be in the part not read).
 *
 * A verdict that passes those checks is still sent back once while the repo's `deliver` perimeter is
 * `status: active` on the current branch (`payload.cwd`): the loop's findings log is written by
 * `perimeter.ps1 -Close -FindingsLog` before the verdict (the log notes `perimeter-open`).
 *
 * Then `{"decision":"block","reason":…}` and one JSON line in `<config>/.cache/done-claim.log` naming
 * the `rule` that fired, so false positives can be counted before deciding on tier 2.
 *
 * The final message comes from `last_assistant_message` when the payload carries it, else from the
 * transcript. The transcript is read from its end in 512 KB chunks until the turn's start (the last human
 * prompt) is found, at most 8 MB.
 *
 * Tier 2 (only if tier 1 proves too noisy, per the spec): a `type: "prompt"` Stop hook judged by
 * the background model. Not wired in the template; add to settings.json and check the prompt-hook
 * response schema in the hooks docs first:
 *
 *   "Stop": [{ "hooks": [{ "type": "prompt", "timeout": 30, "prompt":
 *     "Hook input: $ARGUMENTS. If stop_hook_active is true, allow. Otherwise read the last
 *      assistant message: block only if it claims work is done, fixed or passing and quotes
 *      neither the command run nor its output, and does not say it is not verified." }] }]
 *
 * One task, one session: on a path that lets the turn end, when it closed a task (a verdict that passed, or a
 * `git commit` among its shell calls) and the context is at `LARGE_CONTEXT` or more (lib/context-size.js), the
 * hook writes `<config>/.cache/handoff.json` (branch, head, rows) for session-brief and prints a `systemMessage`
 * asking for /clear. Never alongside a block.
 *
 * Always exits 0; any error lets the turn end.
 *
 * Generated by Claude Code at the user's request.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { findGitDir, currentBranch, readRef, commonDir } = require('./lib/git-dir');
const { contextTokens, LARGE_CONTEXT } = require('./lib/context-size');
const { tailEntries, blocks, entryText, isNotification, isPeerMessage, isPrompt } = require('./lib/session-turn');
const { READ_ONLY_AGENTS } = require('./lib/read-only-agents');
const { expandSegments, stripWrappers, baseName, withoutBodies } = require('./lib/shell-parse');
const { parseGitCall } = require('./lib/default-branch');
const { armFire, isSub } = require('./lib/fire-log');

const fire = armFire('done-claim', 'Stop');

const CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const LOG = path.join(CONFIG_DIR, '.cache', 'done-claim.log');
const HANDOFF = path.join(CONFIG_DIR, '.cache', 'handoff.json');
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);
/** Shell commands that ship or install a change: they arm the turn as an edit does. */
const GIT_WRITES = new Set(['commit', 'push', 'merge']);
const COPY_ITEM = new Set(['copy-item', 'cpi']);

/** True when a command of the line (wrappers skipped, read token by token) is a commit, push, merge, PR create or merge, or a Copy-Item. */
function isShellWrite(command) {
  return expandSegments(withoutBodies(command)).some((tokens) => {
    const t = stripWrappers(tokens);
    const name = t.length ? baseName(t[0]) : '';
    if (name === 'git') return GIT_WRITES.has(parseGitCall(t)?.subcommand);
    if (name === 'gh') {
      const a = t.slice(1);
      while (a.length && /^-/.test(a[0])) a.splice(0, /^(?:-R|--repo)$/.test(a[0]) ? 2 : 1);   // global options: `-R o/r`, `--repo=o/r`
      return a[0] === 'pr' && (a[1] === 'create' || a[1] === 'merge');
    }
    return COPY_ITEM.has(name);
  });
}
/** Tools that hand work to a workflow or an agent: they arm the hook like an edit and their results come back as notifications. */
const DELEGATE_TOOLS = new Set(['Workflow', 'Agent', 'Task']);
/** A quoted span (straight, curly or guillemets, same line, short): a word mentioned, not claimed. */
const QUOTED = /"[^"\n]{1,40}"|“[^”\n]{1,40}”|«[^»\n]{1,40}»/g;
/** The Bash tool prints no exit code on success, so a row's `exit 0` is never in the output. */
const EXIT_ZERO = /^exit(?: code)? 0$/;

// No bare "passa": "passa per il controller" is the commonest sentence in a dev chat. "fatto" is a claim
// only opening a sentence, a line or a bold span ("Fatto: …", "**Fatto**") and not as a participle
// ("il merge fatto da te", "**fatto** da te"); the other words claim wherever they stand. English `works`
// is no claim before a qualifier ("it works for X", "works with Y"); `passes` claims only at a clause end or before "now" ("passes the token to X" is prose), `verified` not after "be".
const CLAIM = /(?<![\w-])(?:(?<=^|[.!?:;\n][ \t]*|\*\*|[-*•][ \t]+)(fatt[oaie])(?![\w-])(?!(?:\*\*)?\s+(?:da|che|per|con)\b)|(done|fixed|passano(?!\s+(?:nel\w*|nell'|nei|negli|all[aeo']?|ai|agli|alle|al\s+(?!\d|prim)|per\s+(?:il|la|lo|i|le|gli|l')|attraverso|dal\w*|dai|dagli)\b)|passing|passes(?=\s*(?:[.!:,;]|$)|\s+now\b)|works(?!\s+(?:for|with|on|in|when|if|as(?!\s+(?:expected|intended|designed)\b)|at|by|from)\b)|(?<!\bbe\s+)verified|(?<!\b(?:va|da|sarà)\s+)verificat[oaie])(?![\w-]))/i;
const HONEST = /non\s+(?:(?:ancora|ho|è|stato)\s+)*(?:verificat|testat|fatt|eseguit)|not\s+(?:yet\s+)?(?:verified|tested|done|run)|(?:not|n't)\s+(?:\w+\s+){0,2}(?:verified|tested|run)\b|to be (?:verified|tested)|no longer\s+(?:works|passes)|\bun(?:verified|tested)|non verificabile/i;
/** A before→after ```diff block (the style's change preview): neither a claim nor an exemption. */
const DIFF_FENCE = /^[ \t]*```diff[^\n]*\n[\s\S]*?^[ \t]*```[ \t]*$/gm;
const FENCE_OR_QUOTE = /^\s*(?:```|~~~)|^\s*>\s?\S/m;
/** A `> **Detail**` (chat `it`: `Dettaglio`) block: the quoted lines that follow it are depth for the reader, not output. */
const DETAIL_BLOCK = /^[ \t]*>[ \t]*\*\*(?:Detail|Dettaglio)\*\*.*(?:\n[ \t]*>.*)*/gim;
/** A section's detail: quoted bullet lines (`> - …`), prose like the block above, never tool output. */
const DETAIL_BULLET = /^[ \t]*>[ \t]*[-*][ \t].*$/gm;
/** A quoted `> |` table line or check label is no evidence; the verdict's own `> ` lines are stripped by `parseVerdicts`. */
const QUOTED_TABLE_LINE = /^[ \t]*(?:>[ \t]*)+(?:\||(?:[-*][ \t]+)?(?:\*\*)?(?:Livello|Level|Comando|Command|Riga\s+che\s+decide|Deciding\s+line)(?:\*\*)?[ \t]*:).*$/gim;
/** `` `dotnet test` → 42 passed ``: the command and its result on one line. */
const INLINE_RESULT = /`[^`\n]+`\s*(?:→|->|=>|:|=|—|–)\s*[^\s`]*(?:\d|\b(?:ok|verde|green|passed|failed|exit|succeeded)\b)/i;
/** The verdict block's title line, with or without the `> ` quote. */
const VERDICT_START = /^[ \t]*(?:>[ \t]*)?(?:#{1,6}[ \t]+(?:\*\*)?|\*\*)(?:Verifica|Verification):?(?:\*\*)?:?[ \t]*(?:\([^)\n]*\))?[ \t]*$/i;
/** A deciding-line label outside any parsed block (quoted or not, bulleted or bold): a check the block rule never judged. */
const ORPHAN_CHECK = /^[ \t]*(?:>[ \t]*)*(?:[-*][ \t]+)?(?:\*\*)?(?:Riga\s+che\s+decide|Deciding\s+line)(?:\*\*)?[ \t]*:(?:\*\*)?[ \t]*(.*)$/i;
/** A Stato / Status line outside any block: an orphan only when its value is a proof state (`Status: 200 OK` is output). Misspelled labels are an open set and stay a known limit. */
const ORPHAN_STATE = /^[ \t]*(?:>[ \t]*)*(?:[-*][ \t]+)?(?:\*\*)?(?:Stato|Status)(?:\*\*)?[ \t]*:(?:\*\*)?[ \t]*(.*)$/i;
/** One line of a check: its label (Italian or English) and the text after the first colon. */
const CHECK_LINE = /^(Livello|Level|Comando|Command|Riga che decide|Deciding line|Stato|Status)[ \t]*:[ \t]*(.*)$/i;
const CHECK_SEPARATOR = /^─+$/;
/** A row's state that claims a result: it starts with `fatto`, `fallito` or their English forms, a note may follow (`fatto (3 test)`). */
const PROOF_STATE = /^(?:fatto|done|fallito|failed)(?![\p{L}\p{N}_])/iu;
/** A state that says the check did not run: never a claim, whatever word it starts with. */
const UNVERIFIED_STATE = /non\s+verificat|not\s+verified/i;
/** True when the state claims a result and so needs proof (`non verificato: …` / `not verified: …` do not). */
const claimsProof = (state) => PROOF_STATE.test(state) && !UNVERIFIED_STATE.test(state);
/** A verdict table's header labels (Italian or English), by row key. */
const TABLE_LABELS = { livello: 'level', level: 'level', comando: 'command', command: 'command', 'riga che decide': 'line', 'deciding line': 'line', stato: 'state', status: 'state' };
/** A table's alignment row: `| --- | :---: |`. */
const TABLE_ALIGN = /^\|?(?:[ \t]*:?-+:?[ \t]*\|)*[ \t]*:?-+:?[ \t]*\|?$/;
/** The verdict form the block reasons ask for. */
const TABLE_FORM = 'a "**Verifica**" title line (English chat: "**Verification**"), then the table "| Livello | Comando | Riga che decide | Stato |" '
  + '(English: "| Level | Command | Deciding line | Status |") with its "| --- | --- | --- | --- |" line and one row per check, never in a code block';

/** ANSI escape codes dropped, lowercase, whitespace collapsed, backslashes and backticks stripped: a line compares the same raw and JSON-escaped. */
const normalise = (text) => text.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '').replace(/[\\`]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

/** A `$…$` span's text: `\command` tokens, the colour argument of `\color` / `\textcolor` / `\colorbox`, braces and `$` dropped. */
const latexText = (cell) => cell.replace(/\$([^$\n]+)\$/g, (_, tex) => tex.replace(/\\ /g, ' ').replace(/\\(?:color|textcolor|colorbox)[ \t]*\{[^{}]*\}/g, '').replace(/\\[A-Za-z]+/g, '').replace(/[{}]/g, ''));

/** A state cell without markup (LaTeX too) and its leading status symbols and emoji; a bare ✓ reads `fatto`, a bare ✗ `fallito`. */
function stateOf(cell) {
  const raw = latexText(cell).replace(/\\ /g, ' ').replace(/[*_`]/g, '').trim();
  const symbols = raw.match(/^[\s✓✔✅✗✘❌?️‍\p{Extended_Pictographic}]+/u)?.[0] ?? '';
  const word = raw.slice(symbols.length).trim();
  if (word) return word;
  if (/[✓✔✅]/u.test(symbols)) return 'fatto';
  return /[✗✘❌]/u.test(symbols) ? 'fallito' : '';
}

/**
 * The verdict block(s) in `message`: `rows` = the checks `{ level, command, line, state }` (values as written, state: `stateOf`; a check
 * with no Stato line has `noState: true`), `quotedLines` = the indexes of the block's `> ` lines (title included), never tool output.
 *
 * A block starts at its title and skips blank and empty-`>` lines. It ends at real prose: with a quoted title, the first non-blank line
 * with no `> `; with an unquoted title, the first line after a blank that is no label or separator. Inside it a line that is no label
 * (`> (nota)`, a wrapped deciding line, a mistyped label) continues the last label's value; a Stato value is never extended.
 * A check closes at a separator, at the next Livello (or a repeated label) or at the block's end.
 *
 * A table is read from its header row, with or without the title above (see `tableAt`); a fenced block is skipped unless it holds a verdict
 * header, then read as a verdict anyway, its fence lines never output: a header with the
 * four labels maps its columns by name; one with Stato and two more labels, or a table right under the title whose header has a label
 * besides Stato, keeps every row, unproven; a table under the title with no such label is no verdict. Pipe rows right under the title
 * whose first line has no alignment row under it have no header: every row is unproven. Its rows run to the first line that
 * is no `|` row; a row whose cell count differs from the header's, or whose Stato cell is empty or no known state, is unproven (`noState`).
 */
function parseVerdicts(message) {
  const lines = message.split(/\r?\n/);
  const rows = [];
  const quotedLines = new Set();
  const consumed = new Set();
  const fenced = new Set();
  const isFence = (line) => /^[ \t]*(?:>[ \t]*)*(?:```|~~~)/.test(line);
  let block = [];
  // A fenced block holding a verdict header is read as a verdict anyway (fail closed) and its fence lines are never output.
  const closeBlock = () => {
    if (block.slice(1).some((k) => tableAt(lines, k))) block.filter((k) => isFence(lines[k])).forEach((k) => { consumed.add(k); quotedLines.add(k); });
    else block.forEach((k) => fenced.add(k));
    block = [];
  };
  for (let i = 0, open = false; i < lines.length; i += 1) {
    const fence = isFence(lines[i]);
    if (open || fence) block.push(i);
    if (fence) { open = !open; if (!open) closeBlock(); }
  }
  closeBlock();
  for (let i = 0; i < lines.length; i += 1) {
    const table = consumed.has(i) || fenced.has(i) ? null : tableAt(lines, i);
    if (table) { i = readTable(lines, i, table.keys, rows, consumed, quotedLines, table.loose); continue; }
    if (!VERDICT_START.test(lines[i])) continue;
    const quoted = /^\s*>/.test(lines[i]);
    consumed.add(i);
    if (quoted) quotedLines.add(i);
    const fresh = () => ({ level: null, command: null, line: null, state: null });
    let cur = fresh();
    let last = '';
    let blank = false;
    let first = true;
    const flush = () => {
      const row = { level: cur.level ?? '', command: cur.command ?? '', line: cur.line ?? '' };
      if (cur.state !== null) rows.push({ ...row, state: stateOf(cur.state) });
      else if (row.level || row.command || row.line) rows.push({ ...row, state: '', noState: true });
      cur = fresh();
      last = '';
    };
    for (let j = i + 1; j < lines.length; j += 1) {
      const isQuote = /^\s*>/.test(lines[j]);
      const text = lines[j].trim().replace(/^>[ \t]*/, '').trim().replace(/^\*\*(.*?)\*\*/, '$1');
      if (!text) { blank = true; continue; }
      // A verdict header is read by the outer loop; a table under the title whose header has a label besides Stato is read here, every
      // row unproven; one with no such label is an ordinary table, no verdict. A first row with no alignment row under it is no header:
      // the rows are headerless verdict rows, every one unproven (read from line j - 1, a blank or the title, so line j is a row).
      const row = tableLine(lines[j]);
      if (row !== null ? first || tableAt(lines, j) : tableAt(lines, j)) {
        if (row !== null && !tableAt(lines, j)) {
          if (!TABLE_ALIGN.test(tableLine(lines[j + 1] ?? '') ?? '')) readTable(lines, j - 1, null, rows, consumed, quotedLines);
          else if (headerKind(row) === 'label') readTable(lines, j, null, rows, consumed, quotedLines);
        }
        break;
      }
      first = false;
      if (/^(?:```|~~~)/.test(text) || (quoted && !isQuote && !CHECK_SEPARATOR.test(text))) break;
      const m = CHECK_LINE.exec(text);
      if (m) {
        const key = /^(?:livello|level)$/i.test(m[1]) ? 'level' : /^(?:comando|command)$/i.test(m[1]) ? 'command' : /^(?:riga che decide|deciding line)$/i.test(m[1]) ? 'line' : 'state';
        if (key === 'level' ? Object.values(cur).some((v) => v !== null) : cur[key] !== null) flush();
        cur[key] = m[2].trim();
        last = key;
        blank = false;
      } else if (CHECK_SEPARATOR.test(text)) {
        flush();
        blank = false;
      } else if (!quoted && (blank || !last)) break;
      else if (last && last !== 'state') cur[last] = `${cur[last]} ${text}`.trim();
      consumed.add(j);
      if (isQuote) quotedLines.add(j);
    }
    flush();
  }
  lines.forEach((text, i) => {
    if (consumed.has(i)) return;
    // An orphan state is the claim word alone (symbols and punctuation aside): `Status: failed to connect` is quoted output.
    const m = ORPHAN_CHECK.exec(text) ?? (() => { const s = ORPHAN_STATE.exec(text); return s && /^\p{L}+[^\p{L}\p{N}]*$/u.test(stateOf(s[1])) && claimsProof(stateOf(s[1])) ? [s[0], ''] : null; })();
    if (m) rows.push({ level: '', command: '', line: m[1].trim(), state: '', noState: true, orphan: true });
  });
  return { rows, quotedLines };
}
const verdictRows = (message) => parseVerdicts(message).rows;

/** A line as a table row without its `> ` quotes, or null when it is no `|` row; `loose`: a row with no leading pipe (`a | b`) too, given one. */
function tableLine(line, loose = false) {
  const text = line.trim().replace(/^(?:>[ \t]*)+/, '').trim();
  if (text.startsWith('|')) return text;
  return loose && text.includes('|') ? `| ${text}` : null;
}

/** A table row's cells, split on `|` outside backtick spans and not escaped (`\|` reads `|`); the outer pipes open and close the row. */
function tableCells(row) {
  const cells = [];
  let cell = '';
  let span = 0;                                  // the length of the open backtick run, 0 outside a span
  for (let k = 0; k < row.length; k += 1) {
    if (row[k] === '\\' && row[k + 1] === '|') { cell += '|'; k += 1; continue; }
    if (row[k] === '`') {
      let n = 1;
      while (row[k + n] === '`') n += 1;
      if (span === n) span = 0;
      else if (!span && new RegExp(`(?<!\`)\`{${n}}(?!\`)`).test(row.slice(k + n))) span = n;
      cell += row.slice(k, k + n);
      k += n - 1;
    } else if (row[k] === '|' && !span) {
      cells.push(cell.trim());
      cell = '';
    } else cell += row[k];
  }
  cells.push(cell.trim());
  cells.shift();
  if (cells.length && cells[cells.length - 1] === '' && row.endsWith('|')) cells.pop();
  return cells;
}

/** The row keys of a table header's columns (null for a column that is no label). */
const headerKeys = (row) => tableCells(row).map((c) => TABLE_LABELS[c.replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()] ?? null);

/** A header row read as a verdict's: `full` (the four labels), `near` (Stato and two more: a misspelt label), `label` (a label besides Stato), else null. */
function headerKind(row) {
  const keys = headerKeys(row);
  const others = ['level', 'command', 'line'].filter((k) => keys.includes(k)).length;
  if (keys.includes('state') && others >= 2) return others === 3 ? 'full' : 'near';
  return others ? 'label' : null;
}

/**
 * The verdict table whose header is line `i`, or null: `keys` maps its columns (null when a label is misspelt: every row unproven),
 * `loose` when its rows have no leading pipe (read only with the four labels over an alignment row: prose may hold a `|`).
 */
function tableAt(lines, i) {
  const row = tableLine(lines[i]);
  if (row !== null) {
    const kind = headerKind(row);
    return kind === 'full' ? { keys: headerKeys(row) } : kind === 'near' ? { keys: null } : null;
  }
  const loose = tableLine(lines[i], true);
  if (loose === null || headerKind(loose) !== 'full' || !TABLE_ALIGN.test(tableLine(lines[i + 1] ?? '', true) ?? '')) return null;
  return { keys: headerKeys(loose), loose: true };
}

/** A Stato cell the table reads: a claim, a "non verificato", or a bare `-` placeholder; anything else is no state. */
const knownState = (state) => PROOF_STATE.test(state) || UNVERIFIED_STATE.test(state) || /^[-–—]$/.test(state);

/**
 * Reads the table whose header is line `at` into `rows` (`keys`: the header's row keys; null for a header that maps no verdict, so every row is
 * unproven; `loose`: rows with no leading pipe) and marks its lines consumed (quoted ones in `quotedLines`); returns the index of its last line.
 */
function readTable(lines, at, keys, rows, consumed, quotedLines, loose = false) {
  const mark = (k) => { consumed.add(k); if (/^\s*>/.test(lines[k])) quotedLines.add(k); };
  let k = at;
  mark(k);
  if (k + 1 < lines.length && TABLE_ALIGN.test(tableLine(lines[k + 1], loose) ?? '')) mark(++k);
  while (k + 1 < lines.length && tableLine(lines[k + 1], loose) !== null) {
    mark(++k);
    const text = tableLine(lines[k], loose);
    const cells = tableCells(text);
    if (!keys || cells.length !== keys.length) { rows.push({ level: '', command: '', line: text, state: '', noState: true }); continue; }
    const row = { level: '', command: '', line: '', state: '' };
    keys.forEach((key, c) => { if (key) row[key] = cells[c]; });
    const state = stateOf(row.state);
    rows.push(state && knownState(state) ? { ...row, state } : { ...row, state: '', noState: true });
  }
  return k;
}

/** `text` appears in `printed` as whole words only: a short line ("ok", "0") is not proven by "token" or "10". */
function printedAsWords(printed, text) {
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'u').test(printed);
}

/**
 * A cell that joins real output lines (`a / b`, `a, b`, `a; b`, `a and b`) or adds a note (`(e gli altri 3)`): proven when it has
 * at least one non-trivial piece (3+ chars, not a bare word like "deny") and every non-trivial piece is printed ("=" and ":" count as a space).
 */
function piecesPrinted(line, printed) {
  const loose = (s) => s.replace(/["']/g, '').replace(/[=:]/g, ' ').replace(/\s+/g, ' ').trim();
  const looseText = loose(printed);
  const elided = /…|\.{3}/.test(line);
  // A gloss is a parenthesis after a space; `$(VAR)` or `f(x)` is part of the output.
  const raw = line.replace(/(?<![\p{L}\p{N}$])\([^)]*\)/gu, ' ').split(/\s\/\s|,\s|;\s|\s(?:and|e)\s|\s·\s|\s*(?:…|\.{3})\s*/).map((p) => loose(p)).filter(Boolean);
  // A lone word left once the gloss is gone (`IDENTICO` (17,8 s)) is the whole line: proven as a whole word.
  if (raw.length === 1 && /^\p{L}{3,}$/u.test(raw[0])) return printedAsWords(looseText, raw[0]);
  const all = raw.filter((p) => p.length >= 3 && !/^\p{L}+$/u.test(p));
  // The exit code is not printed on success: dropped when something else is left to prove.
  const pieces = all.some((p) => !EXIT_ZERO.test(p)) ? all.filter((p) => !EXIT_ZERO.test(p)) : all;
  // An elided fragment may start or end inside a word (a path with its backslashes stripped): substring, not whole words.
  return pieces.length > 0 && pieces.every((p) => (elided ? looseText.includes(p) : printedAsWords(looseText, p)));
}

/** Unmatched closers (`}` `]` `)`) and joiner characters at a piece's edges are not part of the output line. */
function trimPiece(piece) {
  const edges = /^[\s/,;·+]+|[\s/,;·+]+$/g;
  const count = (text, ch) => text.split(ch).length - 1;
  let p = piece.replace(edges, '');
  for (let again = true; again;) {
    again = false;
    if (/^[}\])]/.test(p)) { p = p.slice(1); again = true; }
    else if ([['}', '{'], [']', '['], [')', '(']].some(([close, open]) => p.endsWith(close) && count(p, close) > count(p, open))) { p = p.slice(0, -1); again = true; }
    p = p.replace(edges, '');
  }
  return p;
}

/**
 * A cell holding backticked fragments is judged on those fragments alone (the prose, labels, arrows and multipliers around them
 * are ignored): each of 3+ chars must be printed, as the start of a word (so `390 pass` is read in "390 passed"; a fragment ending
 * in a digit also ends there), and an elided fragment piece by piece. Null when no fragment is long enough: the whole cell is judged.
 */
function fragmentsPrinted(rawLine, printed, exitRan) {
  const loose = (s) => s.replace(/["']/g, '').replace(/[=:]/g, ' ').replace(/\s+/g, ' ').trim();
  const looseText = loose(printed);
  const escape = (p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // A span with no piece of 3+ chars left (`ok…`, `...`, `}}}`) proves nothing and is not judged.
  const spans = [...rawLine.matchAll(/`([^`]+)`/g)].map((m) => loose(normalise(m[1]))).map((span) => ({
    span,
    elided: /…|\.{3}/.test(span),
    pieces: span.split(/\s*(?:…|\.{3})\s*/).map((p) => loose(trimPiece(p))).filter((p) => p.length >= 3),
  })).filter((s) => s.span.length >= 3 && s.pieces.length > 0);
  if (!spans.length) return null;
  const real = spans.filter((s) => !EXIT_ZERO.test(s.span));
  if (!real.length && exitRan) return true;
  return (real.length ? real : spans).every(({ elided, pieces }) => pieces.every((p) => {
    // An elided piece may start or end inside a word: substring, not word start.
    if (elided) return looseText.includes(p);
    // A lone word is a whole word ("deny" is not "denylist"); a phrase may end inside its last word ("390 pass" in "390 passed").
    if (/^\p{L}+$/u.test(p)) return printedAsWords(looseText, p);
    return new RegExp(`(?<![\\p{L}\\p{N}])${escape(p)}${/\d$/.test(p) ? '(?!\\p{N}|\\.\\p{N}|%)' : ''}`, 'u').test(looseText);
  }));
}

/** A bare `exit 0` prints nothing: proven when a shell call after the last edit ran the row's command (a backticked span, else the whole cell). */
function exitZeroRan(row, shellCommands) {
  const spans = [...row.command.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  const keys = (spans.length ? spans : [row.command]).map((k) => normalise(k)).filter((k) => k.length >= 3);
  return keys.length > 0 && shellCommands.some((c) => keys.some((k) => normalise(c).includes(k)));
}

/** The rows that claim `fatto` / `fallito` / `failed` whose deciding line is not in `resultsText` (a placeholder line is never proven). */
function unprovenRows(rows, resultsText, shellCommands = []) {
  const printed = normalise(resultsText);
  return rows.filter((r) => {
    if (r.noState) return true;
    if (!claimsProof(r.state)) return false;
    const line = normalise(r.line);
    // An empty JSON array or object is proof only as a line of its own.
    if (/^(?:\[\]|\{\})$/.test(line)) return !new RegExp(`(?:^|\\s)${line.replace(/[[\]{}]/g, '\\$&')}(?:\\s|$)`).test(printed);
    if (!/[\p{L}\p{N}]/u.test(line)) return true;
    if (EXIT_ZERO.test(line.replace(/=/g, ' ')) && exitZeroRan(r, shellCommands)) return false;
    const byFragments = fragmentsPrinted(r.line, printed, exitZeroRan(r, shellCommands));
    if (byFragments !== null) return !byFragments;
    return !printedAsWords(printed, line) && !piecesPrinted(line, printed);
  });
}

const allow = () => process.exit(0);

/** A `git commit` among the turn's shell calls; the first `-m` message of each is its subject. */
const GIT_COMMIT = /\bgit\s+(?:-[Cc]\s+\S+\s+)*commit\b/;
const COMMIT_SUBJECT = /\s-m\s+(?:"([^"\n]+)"|'([^'\n]+)')/;

/** The short HEAD sha read off the disk (loose ref or detached), or null: packed refs are not worth a process. */
function shortHead(gitDir, branch) {
  const sha = branch ? readRef(commonDir(gitDir), `refs/heads/${branch}`) : readRef(gitDir, 'HEAD');
  return sha && /^[0-9a-f]{40}$/.test(sha) ? sha.slice(0, 7) : null;
}

/** What closed the task: the passing verdict rows as `Livello | Stato`, else the commit subjects; empty when nothing did. */
function closedTask(turn, rows) {
  const verdict = rows.filter((r) => claimsProof(r.state)).slice(0, 5).map((r) => `${r.level} | ${r.state}`);
  if (verdict.length) return verdict;
  return turn.shellCommands.filter((c) => GIT_COMMIT.test(c)).slice(0, 5).map((c) => {
    const m = COMMIT_SUBJECT.exec(c);
    return m ? (m[1] ?? m[2]) : 'git commit';
  });
}

/**
 * The turn may end: when it closed a task (verdict rows that passed, or a `git commit`) in a large context, leave the
 * hand-off for session-brief and tell the user to /clear. Only the allow paths come here, never a block.
 */
function allowWith(payload, turn, rows) {
  try {
    const closed = turn.complete ? closedTask(turn, rows) : [];
    const tokens = contextTokens(payload.session_id);
    if (closed.length && tokens !== null && tokens >= LARGE_CONTEXT) {
      const repo = typeof payload.cwd === 'string' && payload.cwd ? findGitDir(payload.cwd) : null;
      const branch = repo ? currentBranch(repo.gitDir) : null;
      const head = repo ? shortHead(repo.gitDir, branch) : null;
      fs.mkdirSync(path.dirname(HANDOFF), { recursive: true });
      fs.writeFileSync(HANDOFF, JSON.stringify({ at: Date.now(), cwd: payload.cwd, branch, ...(head && { head }), rows: closed, tokens }));
      fire.decision = 'context';
      process.stdout.write(JSON.stringify({ systemMessage: `Contesto a ${Math.round(tokens / 1000)}k e task chiuso: /clear prima del prossimo (il punto di ripresa lo riporta session-brief).` }));
    }
  } catch {
    /* the hand-off is a convenience, never a reason to fail */
  }
  process.exit(0);
}

/** True when the repo at `cwd` has a `deliver` perimeter still `status: active` for the branch checked out now (read off the disk, no git process). */
function perimeterOpen(cwd) {
  try {
    if (typeof cwd !== 'string' || !cwd) return false;
    const repo = findGitDir(cwd);
    if (!repo) return false;
    const text = fs.readFileSync(path.join(repo.gitDir, 'deliver', 'perimeter.md'), 'utf8');
    const branch = /^branch:\s*(.+)$/im.exec(text);
    return /^status:\s*active\s*$/im.test(text) && !!branch && branch[1].trim() === currentBranch(repo.gitDir);
  } catch {
    return false;
  }
}

/** A verdict table with the perimeter still active: the findings log was not written; send the turn back once. */
/** A row left open because the work is still running: the loop itself, or a check deferred to the end of the cycle. */
const IN_PROGRESS = /(?:non verificat\w*|not verified)\b.*\b(?:in corso|ancora|a fine ciclo|running|in progress|still|end of the cycle)\b/i;

function blockOpenPerimeter(payload, rows, message) {
  if (!rows.length || !perimeterOpen(payload.cwd)) return;
  // A progress report mid-run, not the closing verdict: the perimeter is rightly still active.
  if (rows.some((r) => IN_PROGRESS.test(r.state) || (/dev-loop/.test(r.command) && /non verificat|not verified/i.test(r.state)))) return;
  log(payload, 'perimeter-open', 'verdict', message);
  fire.decision = 'block';
  process.stdout.write(JSON.stringify({ decision: 'block', reason: 'Close the perimeter with -FindingsLog before the verdict (perimeter.ps1 -Close -FindingsLog <json>, or -NoFindings if the loop did not run), then rewrite the verdict.' }));
  process.exit(0);
}

/** What a user entry carries for the proof: its `tool_result` text, or a notification's or peer message's text. */
function printedBy(entry) {
  const out = [];
  for (const b of blocks(entry)) {
    if (b?.type !== 'tool_result') continue;
    if (typeof b.content === 'string') out.push(b.content);
    else if (Array.isArray(b.content)) for (const part of b.content) if (typeof part?.text === 'string') out.push(part.text);
  }
  if (isNotification(entry) || isPeerMessage(entry)) out.push(entryText(entry));
  return out;
}

/**
 * The current turn: whether it edited or delegated (`armed`), ran a shell command after the last of those, its
 * final assistant text, everything its tools printed (`results`), and whether the whole turn is in `entries`
 * (`complete`: its human prompt was found, or the transcript was read from the start).
 *
 * The turn starts at the last genuine human prompt and nowhere else: a notification or a cross-session
 * message (a delegate's hand-back, or a peer's reply) belongs to the turn it arrives in.
 */
function readTurn(entries, truncated = false) {
  let start = entries.length - 1;
  while (start >= 0 && !isPrompt(entries[start])) start -= 1;
  const complete = start >= 0 || !truncated;

  let armed = false;
  let shellAfterEdit = false;
  const shellCommands = [];                      // the shell calls after the last edit that did not fail
  const failed = new Set();                      // tool_use ids whose result is an error or reports a non-zero exit code
  let pastFinalMessage = false;                  // walked back over a tool result
  const finalText = [];
  const results = [];
  for (let i = entries.length - 1; i > start; i -= 1) {
    const entry = entries[i];
    if (entry?.type === 'user') {
      pastFinalMessage = true;
      results.push(...printedBy(entry));
      for (const b of blocks(entry)) {
        if (b?.type !== 'tool_result') continue;
        const text = typeof b.content === 'string' ? b.content : Array.isArray(b.content) ? b.content.map((p) => p?.text ?? '').join('\n') : '';
        if (b.is_error === true || /^\s*Exit code [1-9]/i.test(text)) failed.add(b.tool_use_id);
      }
    }
    if (entry?.type !== 'assistant') continue;
    // Walking backwards, so the first edit met is the last one made: a shell call seen before it is later.
    for (const b of [...blocks(entry)].reverse()) {
      if (b?.type !== 'tool_use' || armed) continue;
      if (EDIT_TOOLS.has(b.name) || (DELEGATE_TOOLS.has(b.name) && !(b.name !== 'Workflow' && READ_ONLY_AGENTS.has(b.input?.subagent_type)))) armed = true;
      else if (SHELL_TOOLS.has(b.name) && typeof b.input?.command === 'string' && !failed.has(b.id) && isShellWrite(b.input.command)) {
        armed = true;
        shellCommands.push(b.input.command);
      } else if (SHELL_TOOLS.has(b.name)) {
        shellAfterEdit = true;
        if (typeof b.input?.command === 'string' && !failed.has(b.id)) shellCommands.push(b.input.command);
      }
    }
    if (!pastFinalMessage) {
      const text = entryText(entry);
      if (text) finalText.unshift(text);
    }
  }
  return { armed, shellAfterEdit, shellCommands, text: finalText.join('\n'), results: results.join('\n'), complete };
}

/** The claim word when the message claims success without evidence, else null. */
function unprovenClaim(message) {
  if (!message || HONEST.test(message) || INLINE_RESULT.test(message)) return null;
  const { quotedLines } = parseVerdicts(message);
  const body = message.split(/\r?\n/).filter((_, i) => !quotedLines.has(i)).join('\n').replace(DIFF_FENCE, ' ');
  if (FENCE_OR_QUOTE.test(body.replace(DETAIL_BLOCK, '').replace(DETAIL_BULLET, '').replace(QUOTED_TABLE_LINE, ''))) return null;
  const prose = body.replace(/`[^`\n]*`/g, ' ').replace(QUOTED, ' ');
  const found = prose.match(CLAIM);
  return found ? found[1] ?? found[2] : null;
}

function log(payload, rule, word, message, excerpt) {
  try {
    fs.mkdirSync(path.dirname(LOG), { recursive: true });
    const at = message.search(CLAIM);
    fs.appendFileSync(LOG, `${JSON.stringify({
      at: new Date().toISOString(),
      session: payload.session_id,
      cwd: payload.cwd,
      rule,
      word,
      excerpt: excerpt ?? message.slice(Math.max(0, at - 60), at + 60).replace(/\s+/g, ' '),
    })}\n`);
  } catch {
    /* the log is for counting, never a reason to fail */
  }
}

try {
  const raw = fs.readFileSync(0, 'utf8');
  try { fire.sub = isSub(JSON.parse(raw)); } catch { /* a bad payload: sub stays false */ }
  if (process.env.CLAUDE_DONE_CLAIM !== '1') allow();
  const payload = JSON.parse(raw || '{}');
  if (typeof payload.transcript_path !== 'string') allow();

  const { entries, truncated } = tailEntries(payload.transcript_path);
  const turn = readTurn(entries, truncated);
  const message = typeof payload.last_assistant_message === 'string' ? payload.last_assistant_message : turn.text;
  const rows = verdictRows(message);
  // Sent back once already: never again, but a turn that closed a task still leaves the hand-off.
  if (payload.stop_hook_active === true) allowWith(payload, turn, rows);
  const claimsRows = rows.some((r) => r.noState || claimsProof(r.state));
  // A turn cut before its start may have edited in the part not read: a verdict table claiming results is judged anyway.
  // An unarmed turn can still close a task (a `/commit` with no edit): it may leave the hand-off.
  if (!turn.armed && !(claimsRows && !turn.complete)) allowWith(payload, turn, rows);

  if (claimsRows) {
    // A verdict table is judged row by row against what the turn printed; the rest of the message does not excuse a row.
    const unproven = unprovenRows(rows, turn.results, turn.shellCommands);
    if (!unproven.length) { blockOpenPerimeter(payload, rows, message); allowWith(payload, turn, rows); }
    if (!turn.complete) {
      // The turn is longer than what was read: the proof may sit in the part not read, and an unchecked claim is not let through.
      log(payload, 'tail-cut', unproven[0].state || 'no-stato', message);
      fire.decision = 'block';
      process.stdout.write(JSON.stringify({
        decision: 'block',
        reason: 'The turn is too long to check the verdict checks against the command output. '
          + `Rewrite the verdict as ${TABLE_FORM}, with the output of commands run now, or write "non verificato: <motivo>" / "not verified: <reason>" in the Stato cell of each row.`,
      }));
      process.exit(0);
    }
    // The excerpt is the failing row itself, so the log shows what the rule judged.
    const said = unproven[0].noState ? 'no Stato' : unproven[0].state;
    log(payload, 'unproven-row', said, message, `${unproven[0].command} | ${unproven[0].line}`.slice(0, 200));
    fire.decision = 'block';
    const shown = unproven.slice(0, 3).map((r) => `"${r.line.slice(0, 80)}"`).join(', ');
    process.stdout.write(JSON.stringify({
      decision: 'block',
      reason: `${unproven.length} verdict checks say "${said}" but the deciding line appears in no output of the turn: ${shown}. `
        + 'The deciding line holds copied output only, on one line: move any comment or count ("su tutti e 6", "6 files") to the command line. '
        + 'Quote the real command output (rerun it if you did not see it), or write "non verificato: <motivo>" / "not verified: <reason>" in the Stato cell of that row. '
        + (unproven.some((r) => r.orphan) ? 'A check outside the block was found: every check goes inside the one "**Verifica**" block, one table row per check, with no prose or fence between rows. ' : '')
        + 'Every row needs its Stato cell and exactly four cells (a | inside a cell goes in backticks or as \\|). '
        + `Write the verdict as ${TABLE_FORM}.`,
    }));
    process.exit(0);
  }

  const word = unprovenClaim(message);
  if (!word) { blockOpenPerimeter(payload, rows, message); allowWith(payload, turn, rows); }

  // A shell run after the edit is no proof by itself: the rule wants its output in the message (the log tells the two apart).
  log(payload, turn.shellAfterEdit ? 'shell-ran' : 'claim-without-evidence', word, message);
  fire.decision = 'block';
  process.stdout.write(JSON.stringify({
    decision: 'block',
    reason: `You claim an outcome ("${word}") without proof. Put the command you ran and the output line that `
      + `confirms it in the verdict: ${TABLE_FORM}, every row with its Stato cell, `
      + 'or write "non verificato: <motivo>" / "not verified: <reason>" in the Stato cell of a check you could not run. Do not rerun anything if the output is already above: quote it in the table.',
  }));
  process.exit(0);
} catch {
  allow();
}
