/**
 * SessionStart hook (startup|resume|clear|compact): tell the session which ALM target its
 * working directory belongs to, and pin the Azure CLI identity for that target.
 *
 * Data is local-only `<config>/workspaces.json` (the kit ships `workspaces.example.json`; no org,
 * project or account lives in this file). Each root: `path`, `platform`, `org`, then `project`
 * (a name or "ask") or `projects` (first subfolder -> project), optional `identity` (suffix of the
 * private Azure CLI config dir `~/.azure-<identity>`), `account`, `note`. Longest `path` wins.
 *
 * Output, one context line: `ALM: Azure DevOps · org <x> · project <y> · az identity <z>`, or
 * `ALM: unmapped — ask` when a map exists but no root matches. `az account set` is
 * machine-global, so the identity travels through CLAUDE_ENV_FILE as plain `export` lines:
 * AZURE_CONFIG_DIR reaches Bash, AZ_IDENTITY (no backslash) also reaches PowerShell. How to prefix an az
 * the guard does not pin is the `azdo-cli` skill's (`references/auth-and-config.md`), not every session's.
 * No map, malformed map, any error: silent, exit 0. No network, no `az` call.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const { readRoots, resolveDir, matchRoot } = require('./lib/workspaces');

const PLATFORMS = { 'azure-devops': 'Azure DevOps', github: 'GitHub' };

function projectOf(entry, dir) {
  if (entry.projects && typeof entry.projects === 'object') {
    const sub = path.relative(entry.root, dir).split(path.sep)[0];
    if (!sub) return 'project: ask';
    const key = Object.keys(entry.projects).find((k) => k.toLowerCase() === sub);
    if (key) return `project ${entry.projects[key]}`;
    return `project to resolve: subfolder "${sub}" -> az devops project list, case-insensitive match; none -> ask`;
  }
  return !entry.project || entry.project === 'ask' ? 'project: ask' : `project ${entry.project}`;
}

function describe(entry, dir, envFile) {
  const parts = [`ALM: ${PLATFORMS[entry.platform] || entry.platform || '?'}`];
  if (entry.org) parts.push(`org ${entry.org}`);
  if (entry.platform !== 'github') parts.push(projectOf(entry, dir));
  if (entry.account) parts.push(`user ${entry.account}`);
  if (/^[\w.-]+$/.test(entry.identity ?? '')) {
    const azDir = path.join(os.homedir(), `.azure-${entry.identity}`);
    if (fs.existsSync(azDir)) {
      // Forward slashes: bash strips unquoted backslashes, and az accepts either separator. Single-quoted:
      // the file is sourced by bash, and a home directory may hold a space or a `$`.
      if (envFile) {
        const value = azDir.replace(/\\/g, '/').replace(/'/g, `'\\''`);
        fs.appendFileSync(envFile, `export AZURE_CONFIG_DIR='${value}'\nexport AZ_IDENTITY=${entry.identity}\n`);
      }
      parts.push(`az identity ${entry.identity}`);
    } else {
      parts.push(`az identity ${entry.identity} assente (~/.azure-${entry.identity}): config az di default`);
    }
  }
  if (entry.note) parts.push(entry.note);
  return parts.join(' · ');
}

try {
  const input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  const dir = resolveDir(input.cwd);
  const hit = matchRoot(readRoots(), dir);
  const line = hit ? describe(hit, dir, process.env.CLAUDE_ENV_FILE) : 'ALM: unmapped — ask';
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: line },
  }));
} catch {
  // never block a session start
}
process.exit(0);
