#Requires -Version 7.0
<#
.SYNOPSIS
  Installs this kit into the Claude Code config directory, reports drift, or imports local changes
  back into the repo.

.DESCRIPTION
  Three modes, all idempotent and never destructive without asking:

    .\install.ps1            Install / update ~/.claude from the repo (the "push" direction).
    .\install.ps1 -Check     Report drift and environment problems. Writes nothing. Exit 1 if any.
    .\install.ps1 -Pull      Bring changes made in ~/.claude back into the repo, then let git show
                             them. Only touches files the repo already tracks.

  Assets listed in $ProjectScoped are deliberately NOT installed user-wide: they carry stack
  placeholders (<App>, <Context>DbContext, docs/technical/) and belong in a project's own
  .claude/ directory. Everything else under agents/, commands/, skills/, hooks/ plus CLAUDE.md,
  settings.json and statusline.js is user-level.

.EXAMPLE
  .\install.ps1 -Check
#>

[CmdletBinding()]
param(
    [switch]$Check,
    [switch]$Pull,
    # Skip the confirmation prompt when overwriting CLAUDE.md / settings.json.
    [switch]$Force,
    [string]$ClaudeHome = (Join-Path $env:USERPROFILE '.claude')
)

$ErrorActionPreference = 'Stop'
$RepoRoot = $PSScriptRoot

if ($Check -and $Pull) { throw 'Use either -Check or -Pull, not both.' }

# Installed per-project, never user-wide.
$ProjectScoped = @(
    'agents/flow-tracer.md'
    'agents/investigator.md'
    'agents/tech-doc-keeper.md'
    'agents/wiki-keeper.md'
    'commands/pr-description.md'
    'skills/ef-migration/SKILL.md'
    'skills/pipeline/SKILL.md'
)

# Repo-only files: they configure the repo itself, not Claude Code.
$RepoOnly = @('README.md', 'LICENSE', 'install.ps1', '.gitattributes', '.gitignore')

$script:Problems = 0
function Write-Ok      ([string]$m) { Write-Host "  ok      $m" -ForegroundColor DarkGray }
function Write-Info    ([string]$m) { Write-Host "  ...     $m" -ForegroundColor Gray }
function Write-Change  ([string]$m) { Write-Host "  changed $m" -ForegroundColor Cyan }
function Write-Problem ([string]$m) { $script:Problems++; Write-Host "  ISSUE   $m" -ForegroundColor Yellow }
function Write-Section ([string]$m) { Write-Host "`n$m" -ForegroundColor White }

function Get-KitAssets {
    # Every user-level asset the repo ships, as repo-relative forward-slash paths.
    $patterns = @('CLAUDE.md', 'settings.json', 'statusline.js',
                  'agents/*.md', 'commands/*.md', 'hooks/*')
    $found = foreach ($p in $patterns) {
        Get-ChildItem -Path (Join-Path $RepoRoot $p) -File -ErrorAction SilentlyContinue
    }
    # Skills are directories with their own layout: recurse, so a helper in a sub-directory
    # is an asset too instead of silently not existing.
    $found += Get-ChildItem -Path (Join-Path $RepoRoot 'skills') -File -Recurse -ErrorAction SilentlyContinue
    $found |
        ForEach-Object { $_.FullName.Substring($RepoRoot.Length + 1).Replace('\', '/') } |
        Where-Object { $_ -notin $ProjectScoped -and $_ -notin $RepoOnly } |
        Sort-Object -Unique
}

function Get-NormalizedHash([string]$Path) {
    # Line endings differ by design (.ps1 is CRLF, the rest LF), so compare on content only.
    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    $text = [System.IO.File]::ReadAllText($Path) -replace "`r`n", "`n"
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($text)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { return [System.BitConverter]::ToString($sha.ComputeHash($bytes)) } finally { $sha.Dispose() }
}

function Copy-Asset([string]$Relative, [string]$From, [string]$To) {
    $target = Join-Path $To $Relative.Replace('/', '\')
    $parent = Split-Path -Parent $target
    if (-not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
    Copy-Item -Force -LiteralPath (Join-Path $From $Relative.Replace('/', '\')) -Destination $target
}

# ── Environment ───────────────────────────────────────────────────────────────
function Test-Environment {
    Write-Section 'Environment'

    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) { Write-Problem 'node not found in PATH — statusline.js will not run' }
    else {
        $major = ((& node --version) -replace '^v', '').Split('.')[0] -as [int]
        if ($major -lt 18) { Write-Problem "node $major is too old — statusline.js needs 18+" }
        else { Write-Ok "node $major" }
    }

    if (Get-Command git -ErrorAction SilentlyContinue) { Write-Ok 'git' } else { Write-Problem 'git not found in PATH' }

    # settings.json hardcodes this path for the hooks.
    $pwshPath = 'C:\Program Files\PowerShell\7\pwsh.exe'
    if (Test-Path -LiteralPath $pwshPath) { Write-Ok 'pwsh 7 at the path settings.json expects' }
    else { Write-Problem "pwsh 7 not at '$pwshPath' — the hooks in settings.json will not fire; fix the path there" }

    if (Get-Command uvx -ErrorAction SilentlyContinue) { Write-Ok 'uvx (serena plugin)' }
    else { Write-Problem "uvx not found — the serena plugin's MCP server cannot start (winget install astral-sh.uv)" }

    if (Get-Command claude -ErrorAction SilentlyContinue) { Write-Ok 'claude CLI' }
    else { Write-Info 'claude CLI not in PATH — register MCP servers from inside Claude Code instead' }

    # CLAUDE_HOOKS is required by the hooks in settings.json.
    $expected = Join-Path $ClaudeHome 'hooks'
    $userVar = [Environment]::GetEnvironmentVariable('CLAUDE_HOOKS', 'User')
    if ($userVar -and ($userVar.TrimEnd('\') -ieq $expected.TrimEnd('\'))) { Write-Ok "CLAUDE_HOOKS -> $userVar" }
    elseif ($userVar) { Write-Problem "CLAUDE_HOOKS points at '$userVar' instead of '$expected'" }
    elseif ($Check) { Write-Problem "CLAUDE_HOOKS is not set (User scope) — the hooks fail silently, since they exit 0 by design" }
    else {
        [Environment]::SetEnvironmentVariable('CLAUDE_HOOKS', $expected, 'User')
        $env:CLAUDE_HOOKS = $expected
        Write-Change "CLAUDE_HOOKS set to $expected (new shells pick it up)"
    }
}

function Test-Plugins {
    Write-Section 'Plugins'
    $settings = Join-Path $ClaudeHome 'settings.json'
    if (-not (Test-Path -LiteralPath $settings)) { Write-Info 'no settings.json installed yet'; return }

    $enabled = @(((Get-Content -Raw $settings | ConvertFrom-Json).enabledPlugins.PSObject.Properties |
                  Where-Object { $_.Value -eq $true }).Name)
    if (-not $enabled) { Write-Info 'no plugins enabled'; return }

    $installedFile = Join-Path $ClaudeHome 'plugins\installed_plugins.json'
    $installed = @()
    if (Test-Path -LiteralPath $installedFile) {
        $installed = @((Get-Content -Raw $installedFile | ConvertFrom-Json).plugins.PSObject.Properties.Name)
    }

    foreach ($p in $enabled) {
        if ($installed -contains $p) { Write-Ok $p }
        else { Write-Problem "$p is enabled but not installed — run: /plugin install $($p.Split('@')[0])" }
    }

    $marketplaces = Join-Path $ClaudeHome 'plugins\known_marketplaces.json'
    if (-not (Test-Path -LiteralPath $marketplaces)) {
        Write-Problem 'no plugin marketplace registered — run: /plugin marketplace add anthropics/claude-plugins-official'
    }
}

function Test-McpServers {
    Write-Section 'MCP servers'
    $file = Join-Path (Split-Path -Parent $ClaudeHome) '.claude.json'
    if (-not (Test-Path -LiteralPath $file)) { Write-Info "no $file yet — nothing registered"; return }

    # -AsHashtable: .claude.json accumulates project keys that differ only by drive-letter case,
    # which makes the default (case-insensitive object) conversion fail outright.
    $json = Get-Content -Raw $file | ConvertFrom-Json -AsHashtable
    $servers = @($json['mcpServers'].Keys)
    if (-not $servers) { Write-Problem 'no MCP servers registered — see mcp/servers.example.json and the README'; return }

    foreach ($s in $servers) { Write-Ok $s }
    if (-not ($servers | Where-Object { $_ -match 'azdo|azure' })) {
        Write-Problem 'no Azure DevOps MCP server — pr-review / workitem-create / worklog need one'
    }
}

# ── Asset sync ────────────────────────────────────────────────────────────────
function Sync-Assets {
    Write-Section $(if ($Check) { 'Assets (repo vs installed)' } elseif ($Pull) { 'Assets (installed -> repo)' } else { 'Assets (repo -> installed)' })

    $sensitive = @('CLAUDE.md', 'settings.json')
    foreach ($rel in Get-KitAssets) {
        $repoHash = Get-NormalizedHash (Join-Path $RepoRoot $rel.Replace('/', '\'))
        $homeHash = Get-NormalizedHash (Join-Path $ClaudeHome $rel.Replace('/', '\'))

        if ($repoHash -eq $homeHash) { Write-Ok $rel; continue }

        if ($Check) {
            if ($null -eq $homeHash) { Write-Problem "$rel is not installed" }
            else { Write-Problem "$rel differs between repo and ~/.claude" }
            continue
        }

        if ($Pull) {
            if ($null -eq $homeHash) { Write-Info "$rel not installed — nothing to pull"; continue }
            Copy-Asset $rel $ClaudeHome $RepoRoot
            Write-Change "$rel pulled into the repo"
            continue
        }

        if (($rel -in $sensitive) -and $homeHash -and -not $Force) {
            $answer = Read-Host "  $rel already exists and differs. Overwrite? [y/N]"
            if ($answer -notmatch '^(y|yes)$') { Write-Info "$rel kept as is"; continue }
        }
        Copy-Asset $rel $RepoRoot $ClaudeHome
        Write-Change "$rel installed"
    }

    if (-not $Check -and -not $Pull) {
        Write-Info "$($ProjectScoped.Count) project-scoped assets skipped on purpose (copy them into a project's .claude/ instead)"
    }
}

function Test-InstalledOnlyAssets {
    # Files that exist in ~/.claude but not in the repo: candidates the repo should track.
    Write-Section 'Only in ~/.claude'
    $known = @(Get-KitAssets) + $ProjectScoped
    $found = $false
    foreach ($dir in 'agents', 'commands', 'hooks') {
        $path = Join-Path $ClaudeHome $dir
        if (-not (Test-Path -LiteralPath $path)) { continue }
        foreach ($f in Get-ChildItem $path -File) {
            $rel = "$dir/$($f.Name)"
            if ($rel -notin $known) { $found = $true; Write-Problem "$rel exists only in ~/.claude — add it to the repo or delete it" }
        }
    }
    $skills = Join-Path $ClaudeHome 'skills'
    if (Test-Path -LiteralPath $skills) {
        foreach ($d in Get-ChildItem $skills -Directory) {
            if (-not (Test-Path -LiteralPath (Join-Path $RepoRoot "skills\$($d.Name)"))) {
                $found = $true; Write-Problem "skills/$($d.Name) exists only in ~/.claude — add it to the repo or delete it"
                continue
            }
            # The directory is tracked, but a file added inside it would otherwise go unnoticed.
            foreach ($f in Get-ChildItem $d.FullName -File -Recurse) {
                $rel = "skills/$($d.Name)/" + $f.FullName.Substring($d.FullName.Length + 1).Replace('\', '/')
                if ($rel -notin $known) {
                    $found = $true; Write-Problem "$rel exists only in ~/.claude — add it to the repo or delete it"
                }
            }
        }
    }
    if (-not $found) { Write-Ok 'nothing unaccounted for' }
}

# ── Run ───────────────────────────────────────────────────────────────────────
Write-Host "claude-dev-kit  ·  $(if ($Check) { 'check' } elseif ($Pull) { 'pull' } else { 'install' })  ·  home: $ClaudeHome"

if (-not (Test-Path -LiteralPath $ClaudeHome)) {
    if ($Check -or $Pull) { throw "$ClaudeHome does not exist — run .\install.ps1 first." }
    New-Item -ItemType Directory -Force -Path $ClaudeHome | Out-Null
}

Sync-Assets
Test-InstalledOnlyAssets
Test-Environment
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

Write-Host '  done — restart Claude Code so it picks up agents, commands, skills and settings.' -ForegroundColor Green
if ($script:Problems -gt 0) { Write-Host "  $($script:Problems) environment item(s) still need attention (see ISSUE above)" -ForegroundColor Yellow }
exit 0
