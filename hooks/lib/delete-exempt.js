/**
 * The delete exemptions of the destructive check (hooks/lib/destructive.js): the shape of a delete segment,
 * and the two cases that pass without asking: a recursive delete strictly inside this session's own Claude temp
 * folder, and `rm -f` of literal regular files in the git worktree of the working folder. Any doubt is "not exempt".
 */

'use strict';

const fs = require('fs');
const os = require('os');
const nodePath = require('path');
const { RESERVED_VARS, parseAssignment } = require('./shell-parse');

/** The executable of a segment, lowercased and stripped of any directory and extension. */
function leadingCommand(segment) {
  const match = segment.trim().match(/^[^\s]+/);
  if (!match) return '';
  return match[0]
    .replace(/^["']|["']$/g, '')
    .replace(/^.*[\\/]/, '')
    .replace(/\.(?:exe|cmd|bat|ps1)$/i, '')
    .toLowerCase();
}

/** Shell keywords that open a condition or a body: the command is the word after them. */
const SHELL_KEYWORDS = new Set(['if', 'elif', 'then', 'else', 'while', 'until', 'do', '{', '!']);
/** The command a segment runs, after `sudo`, `xargs`, `env VAR=x` and their options. */
function effectiveCommand(segment) {
  const tokens = segment.trim().split(/\s+/);
  const wrappers = ['sudo', 'xargs', 'env', 'command', 'nohup', 'time', 'exec'];
  let i = 0;
  while (i < tokens.length) {
    if (SHELL_KEYWORDS.has(tokens[i])) { i += 1; continue; }
    if (!(/^[A-Za-z_]\w*=/.test(tokens[i]) || wrappers.includes(tokens[i].toLowerCase()))) break;
    i += 1;
    while (i < tokens.length && tokens[i].startsWith('-')) i += 1;
  }
  return leadingCommand(tokens.slice(i).join(' '));
}

/** A pipeline stage that runs a script block per item: `ls | % { rm $_ }`. */
const PIPE_LOOPS = new Set(['%', 'foreach', 'foreach-object']);
const DELETER_WORD = /(?<![-\w])(?:remove-item|rm|ri|del|erase|rd|rmdir)(?![-\w])/i;
const DELETERS = new Set(['rm', 'ri', 'del', 'rd', 'rmdir', 'erase', 'remove-item']);
const RM_FLAG = /^(?:-[rRfv]+|--recursive|--force|--verbose)$/;
const CMD_SWITCH = /^\/[sqf]$/i;
const PATH_FLAG = /^-(?:path|literalpath|lp)$/i;
/** True when `flag` is `-name` or an abbreviation of it at least `min` letters long (PowerShell binds unique prefixes). */
const abbreviates = (flag, name, min) => {
  const f = flag.slice(1).toLowerCase();
  return f.length >= min && name.startsWith(f);
};
/** Anything a shell would expand, substitute or reinterpret: a path holding one is not a plain path. */
const NOT_PLAIN = /[$`%*?[\]{}()<>|;&'"!#^=]/;

/**
 * The path operands of a delete segment, or null when any token is not clearly a known flag of that
 * deleter or a plain path (null = the caller asks). Reads the raw segment, never the prepared one:
 * the preparation blanks quoted text, which could hide a substitution.
 */
function deleteOperands(text, command) {
  if (/[\r\n]/.test(text)) return null;
  const tokens = text.trim().split(/\s+/);
  if (leadingCommand(tokens[0]) !== command) return null; // a wrapper (`sudo`, `xargs`, `env`) or anything before the deleter
  const powershell = command === 'remove-item' || command === 'ri';
  const operands = [];
  let flagsEnded = false;
  const addOperand = (raw) => {
    const quoted = /^(["'])([^"'\s]*)\1$/.exec(raw);
    const operand = quoted ? quoted[2] : raw;
    if (!operand || operand.startsWith('~') || NOT_PLAIN.test(operand) || (command === 'rm' && operand.includes('\\'))) return false; // bash reads `\` as an escape, not a separator // a leading ~ expands to the home folder
    operands.push(operand);
    return true;
  };
  for (let i = 1; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!flagsEnded && command === 'rm' && token === '--') { flagsEnded = true; continue; }
    const flagLike = !flagsEnded && (token.startsWith('-') || (!powershell && command !== 'rm' && /^\/\w$/.test(token)));
    if (!flagLike) {
      for (const piece of token.split(',')) if (!addOperand(piece)) return null; // cmd and PowerShell split on `,`; bash fails closed here
    } else if (command === 'rm') {
      if (!RM_FLAG.test(token)) return null;
    } else if (powershell) {
      if (PATH_FLAG.test(token)) {
        const value = tokens[i += 1];
        if (value === undefined) return null;
        for (const piece of value.split(',')) if (!addOperand(piece)) return null;
      } else if (!(abbreviates(token, 'recurse', 1) || abbreviates(token, 'force', 2))) return null;
    } else if (!CMD_SWITCH.test(token)) return null;
  }
  return operands.length ? operands : null;
}

const normalizePath = (p) => (process.platform === 'win32' ? p.replace(/\\/g, '/').toLowerCase() : p.replace(/\\/g, '/'));
/** Anything on the line that could make or move a link or junction before the delete runs. */
const LINK_CREATOR = /(?<![-\w])(?:ln|mklink|new-item|ni|symlink|symboliclink|junction|mv|move|move-item|mi)(?![-\w])/i;
const SHORT_TEMP_CLAUDE = /^[a-z]:\/users\/[^/]+~\d+\/appdata\/local\/temp\/claude\//;

/** `<tmp>/claude/` as os.tmpdir() spells it; on Windows also its long form and the one under the home folder. */
function tempClaudeRoots() {
  const temps = [os.tmpdir()];
  if (process.platform === 'win32') {
    try { temps.push(fs.realpathSync.native(os.tmpdir())); } catch { /* the 8.3 form still counts */ }
    temps.push(`${os.homedir()}/AppData/Local/Temp`);
  }
  return [...new Set(temps.map((t) => `${normalizePath(t).replace(/\/+$/, '')}/claude/`))];
}

/**
 * True when the operand is a strict descendant of `<tmp>/claude/<proj>/<session>` (at least one segment
 * below the session folder): absolute, no `.`/`..`, no symbolic link or junction on the way. Any doubt is false.
 */
function isThrowawayPath(operand, sessionId, shell) {
  try {
    let p = normalizePath(operand).replace(/\/$/, '');
    if (!(/^[a-z]:\//i.test(p) || (p.startsWith('/') && !p.startsWith('//')))) return false;
    if (process.platform === 'win32' && shell === 'bash') p = p.replace(/^\/([a-z])(?=\/)/, '$1:'); // Git-Bash `/c/…` is `C:/…`; PowerShell reads it as a path on the current drive
    const root = tempClaudeRoots().find((r) => p.startsWith(r));
    const rootLength = root ? root.length : process.platform === 'win32' ? SHORT_TEMP_CLAUDE.exec(p)?.[0].length : undefined;
    if (!rootLength) return false;
    const segments = p.slice(rootLength).split('/');
    if (segments.length < 3 || segments.some((s) => !s || /^\.+$/.test(s) || s.includes(':'))) return false;
    // With a session id in the payload, only this session's own folder; without one, any session's (a known limit).
    if (sessionId && segments[1] !== normalizePath(String(sessionId))) return false;
    for (let i = 0; i <= segments.length; i += 1) { // i = 0: the claude folder itself
      try {
        // No trailing slash: lstat on `link/` would follow the link.
        if (fs.lstatSync([p.slice(0, rootLength - 1), ...segments.slice(0, i)].join('/')).isSymbolicLink()) return false;
      } catch (error) {
        if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') break; // nothing deeper can exist
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

const CD_COMMANDS = new Set(['cd', 'chdir', 'pushd', 'set-location', 'sl']);
const BASH_CD = new Set(['cd', 'pushd']);
const PLAIN_CD = new Set(['cd']);
const stripQuotes = (s) => /^(["'])(.*)\1$/.exec(s)?.[2] ?? s;
/**
 * `text` with the variables it can resolve replaced: the literals this line assigned earlier, and on Windows
 * the temp folder as the shell spells it (Bash `$TEMP`, `${TEMP}`; PowerShell `$env:TEMP`; where the shell is
 * unknown, none). Others stay, and a path holding one is not a plain path.
 */
function expandVars(text, vars, shell) {
  const tmp = process.platform === 'win32' ? os.tmpdir().replace(/\\/g, '/').replace(/\/+$/, '') : null;
  return text.replace(/\$(?:\{(\w+)\}|(env:)?(\w+))/gi, (match, braced, env, bare) => {
    const name = braced ?? bare;
    if (shell === 'powershell') {
      if (env) return tmp && /^(?:temp|tmp)$/i.test(name) ? tmp : match;
      return vars.get(name.toLowerCase()) ?? match;
    }
    if (shell === 'bash' && !env) return vars.get(name) ?? (tmp && /^(?:TEMP|TMP)$/.test(name) ? tmp : match);
    return match;
  });
}

/** A plain literal path from one token, variables resolved and quotes removed, else null. */
function literalPath(raw, vars, shell) {
  if (/^'/.test(raw) && raw.includes('$')) return null; // single quotes: no expansion
  const value = stripQuotes(expandVars(raw, vars, shell));
  return value && !NOT_PLAIN.test(value) ? value : null;
}

/**
 * Where `cd` / `Set-Location` / `pushd` leaves the shell: an existing folder at or below a Claude temp
 * session folder, else null. A `cd` that fails changes nothing, and `;` runs the delete anyway, hence the stat.
 */
function changeDir(text, command, cwd, vars, shell, sessionId) {
  const tokens = text.trim().split(/\s+/);
  const pathFlag = shell === 'powershell' && tokens.length === 3 && PATH_FLAG.test(tokens[1]);
  if (tokens.length !== 2 && !pathFlag) return null;
  const raw = tokens[tokens.length - 1];
  const value = literalPath(raw, vars, shell);
  // Bash eats the backslashes of an unquoted path: only PowerShell and quotes keep them.
  if (value === null || (value.includes('\\') && !/^["']/.test(raw) && command !== 'set-location' && command !== 'sl')) return null;
  const path = value.replace(/\\/g, '/').replace(/\/+$/, '');
  const target = /^[a-z]:\//i.test(path) || path.startsWith('/') ? path : cwd && `${cwd}/${path.replace(/^(?:\.\/)+/, '')}`;
  if (!target || !isThrowawayPath(`${target}/x`, sessionId, shell)) return null;
  try { return fs.statSync(target).isDirectory() ? target : null; } catch { return null; }
}

/**
 * The working folder and variables in force after the segments that precede a delete, or null when any of
 * them is not a delete, a `cd`, or an assignment of a plain value: it could make a link or run anything.
 */
function priorState(steps, finalSep, shell, sessionId) {
  const vars = new Map();
  let cwd = null;
  // `&`, `|` and `||` around a `cd` or an assignment: it runs in the background, in a pipe, or maybe not at all.
  const chained = (sep) => !/[&|]/.test(sep.replace(/&&/g, ''));
  const cdCommands = shell === 'powershell' ? CD_COMMANDS : shell === 'bash' ? BASH_CD : PLAIN_CD;
  const seps = [...steps.slice(1).map((s) => s.sep), finalSep];
  let deleted = false;
  for (let i = 0; i < steps.length; i += 1) {
    const text = steps[i].text.trim();
    const assignment = parseAssignment(text, shell);
    const command = assignment ? '' : effectiveCommand(text);
    if (assignment || CD_COMMANDS.has(command)) {
      if (!chained(steps[i].sep) || !chained(seps[i])) return null;
    }
    if (assignment) {
      if (RESERVED_VARS.test(assignment[0])) return null;
      const value = literalPath(assignment[1], vars, shell);
      if (value === null) return null;
      vars.set(assignment[0], value);
    } else if (CD_COMMANDS.has(command)) {
      // A spelling this shell does not know fails, and `;` runs the delete in the real folder.
      cwd = cdCommands.has(command) ? changeDir(text, command, cwd, vars, shell, sessionId) : null;
      // An earlier delete may remove the target (or fail and skip the `cd`): only an unbroken `&&` chain
      // from the `cd` to the final delete keeps that delete from running elsewhere.
      if (deleted && seps.slice(i).some((sep) => sep.trim() !== '&&')) cwd = null;
    } else if (DELETERS.has(command)) deleted = true;
    else return null;
  }
  return { vars, cwd };
}

/** The operand as an absolute path: relative ones resolve against the folder a `cd` set, else null. */
function absolutize(operand, cwd) {
  const path = operand.replace(/\\/g, '/');
  return /^[a-z]:\//i.test(path) || path.startsWith('/') ? path : cwd && `${cwd}/${path.replace(/^(?:\.\/)+/, '')}`;
}

/** True when a symbolic link or junction (or too much to look through) sits anywhere under `root`. */
function holdsLink(root, budget = { left: 20000 }) {
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch (error) { return error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR'; }
  for (const entry of entries) {
    budget.left -= 1;
    if (entry.isSymbolicLink() || budget.left < 0) return true;
    if (entry.isDirectory() && holdsLink(`${root}/${entry.name}`, budget)) return true;
  }
  return false;
}

/** The nearest ancestor of `dir` (itself included) holding a `.git` file or folder, else null. Fs only, no git process. */
function worktreeRoot(dir) {
  for (let at = dir; ; at = nodePath.dirname(at)) {
    if (fs.existsSync(nodePath.join(at, '.git'))) return at;
    if (nodePath.dirname(at) === at) return null;
  }
}

/** A step that cannot move, make or link a file: a delete, a plain literal assignment or a read-only listing. */
function harmlessStep(text, shell) {
  const trimmed = text.trim();
  const assigned = parseAssignment(trimmed, shell);
  if (assigned) return !RESERVED_VARS.test(assigned[0]);
  const command = effectiveCommand(trimmed);
  return DELETERS.has(command) || command === 'ls' || command === 'dir';
}

/**
 * `rm -f <file>…` (no `-r`, no `-d`) where every target is a literal path to an existing regular file inside
 * the git worktree of the folder the hook runs in. Before it only deletes, plain assignments and listings
 * (a `cd`, a move, a checkout or a link maker could change what the name points at), else not exempt.
 */
function removesWorktreeFiles(segment, line) {
  if (!line?.cwd) return false;
  const tokens = segment.trim().split(/\s+/);
  let forced = false;
  let flagsEnded = false;
  for (const token of tokens.slice(1)) {
    if (flagsEnded || !token.startsWith('-')) continue;
    if (token === '--') flagsEnded = true;
    else if (/^-[fv]+$|^--(?:force|verbose)$/.test(token)) forced = forced || /f|force/.test(token);
    else return false;
  }
  if (!forced) return false;
  if (!line.steps.every((s) => harmlessStep(s.text, line.shell)) || LINK_CREATOR.test([...line.steps.map((s) => s.text), segment].join(' '))) return false;
  const operands = deleteOperands(segment, 'rm');
  if (!operands) return false;
  try {
    const root = worktreeRoot(line.cwd);
    if (!root) return false;
    const realRoot = fs.realpathSync(root);
    const claudeHome = nodePath.join(os.homedir(), '.claude');
    let claudeReal = claudeHome;
    try { claudeReal = fs.realpathSync(claudeHome); } catch { /* none yet: the plain path stands */ }
    const under = (dir, file) => { const rel = nodePath.relative(dir, file); return !rel.startsWith('..') && !nodePath.isAbsolute(rel); };
    return operands.every((operand) => {
      const target = nodePath.resolve(line.cwd, operand);
      const parent = fs.realpathSync(nodePath.dirname(target));
      // The owner's Claude folder keeps asking, even when it (or the home) is a git worktree.
      if (under(claudeReal, nodePath.join(parent, nodePath.basename(target)))) return false;
      const relative = nodePath.relative(realRoot, nodePath.join(parent, nodePath.basename(target)));
      if (relative.startsWith('..') || nodePath.isAbsolute(relative) || relative.split(/[\\/]/).some((part) => part.toLowerCase() === '.git')) return false;
      const found = worktreeRoot(parent);
      return found && fs.realpathSync(found) === realRoot && fs.lstatSync(target).isFile();
    });
  } catch {
    return false;
  }
}

module.exports = {
  leadingCommand, effectiveCommand, DELETERS, DELETER_WORD, PIPE_LOOPS, deleteOperands, LINK_CREATOR, priorState, expandVars, absolutize, isThrowawayPath, holdsLink, removesWorktreeFiles,
};
