#Requires -Version 7.0
<#
.SYNOPSIS
  Installs this kit into the Claude Code config directory, reports drift and environment
  problems, or imports local changes back into the repo.

.DESCRIPTION
  Three modes, all idempotent and never destructive without asking:

    .\install.ps1            Install / update ~/.claude from the repo (the "push" direction).
    .\install.ps1 -Check     Report drift and environment problems. Writes nothing. Exit 1 if any.
    .\install.ps1 -Pull      Bring the live config back into the repo — including assets the repo
                             does not have yet — then let git show the result.

  Every asset is user-level. The kit is opinionated on technique and anonymous only on identity
  (Azure DevOps org and project names, absolute machine paths, e-mail addresses), so nothing is
  project-scoped any more: agents/, hooks/ and skills/ are installed whole, plus the root-level
  CLAUDE.md, settings.json and statusline.js. rules/, workflows/, scripts/, mods/, output-styles/ and statusline/ are
  installed the same way.

  Assets are discovered, never listed: whatever the repo contains under those directories is
  an asset, recursively, so a new skill folder with its references and scripts needs no edit here.
  The exceptions are the local-only files (my-voice, workspaces.json, db-targets.json…): they live
  in the live config only, -Check reports them as expected and -Pull never imports them.

  Installing copies and never deletes on its own. What the kit retired (see $Retired: killed skills,
  a hook, a script, and any commands/<name>.md that a skill of the same name replaced) is detected:
  -Check reports it, a plain install asks before moving it to the backup folder.

.EXAMPLE
  .\install.ps1 -Check
#>

[CmdletBinding()]
param(
    [switch]$Check,
    [switch]$Pull,
    # Skip the confirmation prompt when overwriting CLAUDE.md / settings.json and when moving a
    # retired asset to the backup folder.
    [switch]$Force,
    # Optional components to leave out of (-Without) or bring back into (-With) this machine; the choice is
    # kept in <ClaudeHome>/kit-options.json and read by every run. Names: see $Components.
    [string[]]$Without,
    [string[]]$With,
    [string]$ClaudeHome = (Join-Path $HOME '.claude')
)

$ErrorActionPreference = 'Stop'
# PowerShell 7.4 turns a non-zero native exit code into a terminating error while
# $ErrorActionPreference is 'Stop'. Check mode deliberately runs tools that are allowed to fail
# (`gh auth status` on a logged-out machine), so opt out and read $LASTEXITCODE instead.
$PSNativeCommandUseErrorActionPreference = $false

function Resolve-RootPath([string]$Path) {
    # Both roots are used to turn absolute file paths into repo-relative ones, so they have to be
    # in the same form Get-ChildItem returns: Get-Item expands an 8.3 short path (the `NAME~1`
    # form Windows still hands out for a long profile name) to the long one the enumeration uses.
    if (Test-Path -LiteralPath $Path) { return (Get-Item -LiteralPath $Path).FullName.TrimEnd('\', '/') }
    return [System.IO.Path]::GetFullPath($Path).TrimEnd('\', '/')
}

$RepoRoot = Resolve-RootPath $PSScriptRoot
$ClaudeHome = Resolve-RootPath $ClaudeHome

if ($Check -and $Pull) { throw 'Use either -Check or -Pull, not both.' }

# Optional components: a name and the config-relative assets (file or folder) it is made of. A component the
# machine opted out of (kit-options.json) behaves like $LocalOnly: not installed, not drift, not pulled.
$Components = [ordered]@{ worklog = @('skills/worklog', 'hooks/worklog-pending.js') }
$script:Excluded = @()

$Without = @($Without | Where-Object { $_ } | ForEach-Object { $_.ToLowerInvariant() })
$With = @($With | Where-Object { $_ } | ForEach-Object { $_.ToLowerInvariant() })
foreach ($name in @($Without) + @($With)) {
    if ($name -notin $Components.Keys) { throw "Unknown component '$name'. Known components: $($Components.Keys -join ', ')." }
}
if (($Without -or $With) -and ($Check -or $Pull)) { throw '-Without and -With change kit-options.json: use them with a plain install.' }

# The directories Claude Code loads assets from. Discovery recurses into them, so a new skill
# folder, hook, agent or reference file is picked up without touching this file.
$AssetDirs = @('agents', 'hooks', 'mods', 'output-styles', 'rules', 'scripts', 'skills', 'statusline', 'workflows')

# Repo-only root files: they configure the repo itself, not Claude Code. Every other file at the
# root is a user-level asset, so a new repo-only file at the root belongs in this list.
# workspaces.example.json, db-targets.example.json and settings.overlay.example.json are the templates
# of the local-only workspaces.json, db-targets.json and settings.overlay.json, not assets themselves.
$RepoOnly = @('README.md', 'LICENSE', 'install.ps1', '.gitattributes', '.gitignore', 'package.json',
              'workspaces.example.json', 'db-targets.example.json', 'settings.overlay.example.json')

# Never an asset, on either side: install backups, editor and OS leftovers.
$Ignored = @('*.bak', '*.bkp', '*.bak.*', '*~', 'Thumbs.db', '.DS_Store')

# Live-config-only paths, relative to the config root, file or folder: personal identity (my-voice),
# what Claude Code itself manages (skills synced from the claude.ai account, the trash), and
# machine data (workspaces.json, db-targets.json), and the type declarations the plugin engine generates
# inside a mod (mods/<name>/.claude-plugin/types) and the mod's tsconfig.json, which only extends them. Neither side owns them as an asset: -Pull never
# imports them, install never writes them, and -Check reports them as expected.
$LocalOnly = @('skills/my-voice', 'skills/.trash', 'skills/synced', 'workspaces.json', 'db-targets.json',
               'settings.overlay.json', 'mods/cockpit/.claude-plugin/types', 'mods/cockpit/tsconfig.json')

# Assets the kit used to ship and no longer does, relative to the config root, file or folder. Install
# copies but never deletes, so on a machine that had an older kit they linger: a retired skill keeps
# firing next to its replacement, a retired hook stays wired. -Pull never imports them, -Check lists
# them, and a plain install moves them to the run's backup folder after asking. Commands are not
# listed: every live commands/<name>.md that a skill of the same name replaced is found by name.
$Retired = @('skills/dev-loop', 'skills/done-check', 'skills/redis-dotnet',
             'skills/fix-ci', 'skills/item', 'skills/workitem-create', 'skills/items-qa',
             'skills/project-wiki-standard', 'skills/pr-review',
             'hooks/edit-nudge.js', 'hooks/context-nudge.js', 'hooks/nudges.js',
             'agents/test-writer.md',  # retired-ok: named on purpose, the repo no longer has it
             'hooks/az-identity.js', 'scripts/sql-ro.ps1',
             'mods/cockpit/hooks/format.ts', 'mods/cockpit/tests/cockpit.test.tsx', 'mods/cockpit/tests/format.test.ts')

$script:Problems = 0
$script:RunStamp = Get-Date -Format 'yyyyMMdd-HHmmss'
# The function groups live in install/ (repo-only, never an asset: discovery reads files at the root, not folders).
foreach ($part in 'output', 'discovery', 'environment', 'sync') { . (Join-Path (Join-Path $PSScriptRoot 'install') "$part.ps1") }

# ── Run ───────────────────────────────────────────────────────────────────────
Write-Host "claude-dev-kit  ·  $(if ($Check) { 'check' } elseif ($Pull) { 'pull' } else { 'install' })  ·  home: $ClaudeHome"

if (-not (Test-Path -LiteralPath $ClaudeHome)) {
    if ($Check -or $Pull) { throw "$ClaudeHome does not exist — run .\install.ps1 first." }
    New-Item -ItemType Directory -Force -Path $ClaudeHome | Out-Null
    $ClaudeHome = Resolve-RootPath $ClaudeHome   # now that it exists, in its canonical form
}

Set-KitOptions
if (-not $Check -and -not $Pull) { Move-ExcludedAssets }

Sync-Assets
Test-InstalledOnlyAssets
Test-RetiredAssets
if ($Check) { Test-LocalOnlyAssets }
Test-Environment
Test-LanguageServers
Test-Toolchain
Test-Hooks
Test-Plugins
Test-McpServers

Write-Section 'Summary'
if ($Check) {
    if ($script:Problems -eq 0) { Write-Host '  no drift, no environment problems' -ForegroundColor Green; exit 0 }
    Write-Host "  $($script:Problems) item(s) need attention (see ISSUE above)" -ForegroundColor Yellow
    exit 1
}

if ($Pull) {
    Write-Host '  done — review with: git status && git diff' -ForegroundColor Green
    exit 0
}

Write-Host '  done — restart Claude Code so it picks up agents, skills, workflows and settings.' -ForegroundColor Green
if ($script:Problems -gt 0) { Write-Host "  $($script:Problems) environment item(s) still need attention (see ISSUE above)" -ForegroundColor Yellow }
exit 0
