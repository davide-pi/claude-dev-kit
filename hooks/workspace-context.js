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
 * `ALM: non mappato — chiedi` when a map exists but no root matches. `az account set` is
 * machine-global, so the identity travels through CLAUDE_ENV_FILE as plain `export` lines:
 * AZURE_CONFIG_DIR reaches Bash, AZ_IDENTITY (no backslash) also reaches PowerShell.
 * No map, malformed map, any error: silent, exit 0. No network, no `az` call.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const { readRoots, resolveDir, matchRoot } = require('./lib/workspaces');

const PLATFORMS = { 'azure-devops': 'Azure DevOps', github: 'GitHub' };
const PS_PREFIX = 'PowerShell: anteponi $env:AZURE_CONFIG_DIR="$HOME\\.azure-$env:AZ_IDENTITY"; ad az, mai az account set';

function projectOf(entry, dir) {
  if (entry.projects && typeof entry.projects === 'object') {
    const sub = path.relative(entry.root, dir).split(path.sep)[0];
    if (!sub) return 'project: chiedi';
    const key = Object.keys(entry.projects).find((k) => k.toLowerCase() === sub);
    if (key) return `project ${entry.projects[key]}`;
    return `project da risolvere: sottocartella "${sub}" -> az devops project list, match case-insensitive; nessuno -> chiedi`;
  }
  return !entry.project || entry.project === 'ask' ? 'project: chiedi' : `project ${entry.project}`;
}

function describe(entry, dir, envFile) {
  const parts = [`ALM: ${PLATFORMS[entry.platform] || entry.platform || '?'}`];
  if (entry.org) parts.push(`org ${entry.org}`);
  if (entry.platform !== 'github') parts.push(projectOf(entry, dir));
  if (entry.account) parts.push(`utente ${entry.account}`);
  if (/^[\w.-]+$/.test(entry.identity ?? '')) {
    const azDir = path.join(os.homedir(), `.azure-${entry.identity}`);
    if (fs.existsSync(azDir)) {
      // Forward slashes: bash strips unquoted backslashes, and az accepts either separator. Single-quoted:
      // the file is sourced by bash, and a home directory may hold a space or a `$`.
      if (envFile) {
        const value = azDir.replace(/\\/g, '/').replace(/'/g, `'\\''`);
        fs.appendFileSync(envFile, `export AZURE_CONFIG_DIR='${value}'\nexport AZ_IDENTITY=${entry.identity}\n`);
      }
      parts.push(`az identity ${entry.identity} (${PS_PREFIX})`);
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
  const line = hit ? describe(hit, dir, process.env.CLAUDE_ENV_FILE) : 'ALM: non mappato — chiedi';
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: line },
  }));
} catch {
  // never block a session start
}
process.exit(0);
