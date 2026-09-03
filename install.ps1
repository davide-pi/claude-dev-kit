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
  project-scoped any more: agents/, commands/, hooks/ and skills/ are installed whole, plus the
  root-level CLAUDE.md, settings.json and statusline.js.

  Assets are discovered, never listed: whatever the repo contains under those four directories is
  an asset, recursively, so a new skill folder with its references and scripts needs no edit here.

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

# The directories Claude Code loads assets from. Discovery recurses into them, so a new skill
# folder, hook, agent or reference file is picked up without touching this file.
$AssetDirs = @('agents', 'commands', 'hooks', 'skills')

# Repo-only root files: they configure the repo itself, not Claude Code. Every other file at the
# root is a user-level asset, so a new repo-only file at the root belongs in this list.
$RepoOnly = @('README.md', 'LICENSE', 'install.ps1', '.gitattributes', '.gitignore', 'package.json')

# Never an asset, on either side: install backups, editor and OS leftovers.
$Ignored = @('*.bak', '*.bkp', '*.bak.*', '*~', 'Thumbs.db', '.DS_Store')

$script:Problems = 0
function Write-Ok      ([string]$m) { Write-Host "  ok      $m" -ForegroundColor DarkGray }
function Write-Info    ([string]$m) { Write-Host "  ...     $m" -ForegroundColor Gray }
function Write-Change  ([string]$m) { Write-Host "  changed $m" -ForegroundColor Cyan }
function Write-Problem ([string]$m) { $script:Problems++; Write-Host "  ISSUE   $m" -ForegroundColor Yellow }
function Write-Section ([string]$m) { Write-Host "`n$m" -ForegroundColor White }

# ── Discovery ─────────────────────────────────────────────────────────────────
function Test-Ignorable([string]$Name) {
    if ($Name.StartsWith('.')) { return $true }
    foreach ($pattern in $Ignored) { if ($Name -like $pattern) { return $true } }
    return $false
}

function Get-DirAssets([string]$Root) {
    # Everything under the asset directories, recursively and whatever it is: a SKILL.md, a
    # reference file, a PowerShell helper next to its skill, an agent, a hook.
    $files = foreach ($dir in $AssetDirs) {
        $path = Join-Path $Root $dir
        if (-not (Test-Path -LiteralPath $path)) { continue }
        Get-ChildItem -LiteralPath $path -File -Recurse -ErrorAction SilentlyContinue |
            Where-Object { -not (Test-Ignorable $_.Name) }
    }
    $files | ForEach-Object { [System.IO.Path]::GetRelativePath($Root, $_.FullName).Replace('\', '/') }
}

function Get-KitAssets {
    # Every user-level asset the repo ships, as repo-relative forward-slash paths.
    $root = Get-ChildItem -LiteralPath $RepoRoot -File |
        Where-Object { -not (Test-Ignorable $_.Name) -and $_.Name -notin $RepoOnly } |
        ForEach-Object { $_.Name }
    @($root) + @(Get-DirAssets $RepoRoot) | Sort-Object -Unique
}

function Get-InstalledAssets {
    # The live config, from the asset directories only: its root holds runtime state (session
    # history, credentials, local settings) that the repo must never adopt.
    @(Get-DirAssets $ClaudeHome) | Sort-Object -Unique
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
    # Anything already in the live config is someone's work — `commands/commit.md` is a likely
    # collision — so keep a copy before overwriting. Pulling into the repo needs no backup: git is
    # the backup there, and a .bak in the tree is only noise.
    if ((Test-Path -LiteralPath $target) -and ($To -ne $RepoRoot)) {
        Copy-Item -Force -LiteralPath $target -Destination "$target.bak"
    }
    Copy-Item -Force -LiteralPath (Join-Path $From $Relative.Replace('/', '\')) -Destination $target
}

# ── Environment ───────────────────────────────────────────────────────────────
function Test-Tool {
    # Returns whether the command resolves, so a caller can probe further (an extension, a login).
    param([string]$Name, [string]$Label, [string]$Fix, [switch]$Optional)
    if (-not $Label) { $Label = $Name }
    if (Get-Command $Name -ErrorAction SilentlyContinue) { Write-Ok $Label; return $true }
    if ($Optional) { Write-Info "$Label not found — $Fix" } else { Write-Problem "$Label not found — $Fix" }
    return $false
}

function Test-Environment {
    Write-Section 'Environment'

    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) { Write-Problem 'node not found in PATH — statusline.js and the Node hooks will not run' }
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

    if (Get-Command claude -ErrorAction SilentlyContinue) { Write-Ok 'claude CLI' }
    else { Write-Info 'claude CLI not in PATH — register MCP servers from inside Claude Code instead' }

    # CLAUDE_HOOKS is how settings.json resolves every hook script, so the variable and the
    # directory it points at have to exist before any hook can fire.
    $expected = Join-Path $ClaudeHome 'hooks'
    if (-not (Test-Path -LiteralPath $expected)) {
        if ($Check -or $Pull) { Write-Problem "$expected does not exist — no hook can be resolved; run .\install.ps1" }
        else { New-Item -ItemType Directory -Force -Path $expected | Out-Null; Write-Change "created $expected" }
    }
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

function Test-LanguageServers {
    Write-Section 'Language servers'
    # Both language-server plugins shell out to a binary on PATH and report nothing when it is
    # missing: the plugin loads, the server never answers. This is the only place that says so.
    $null = Test-Tool 'csharp-ls' 'csharp-ls (C#)' 'install with: dotnet tool install --global csharp-ls'
    $null = Test-Tool 'typescript-language-server' 'typescript-language-server (TS/JS)' `
        'install with: npm install -g typescript-language-server typescript'
}

function Test-AzDevOpsExtension {
    # Fast path: an installed extension is a directory under the az config dir. Only when it is
    # not there do we pay the seconds `az extension list` costs, so a healthy machine stays quick.
    if (Test-Path -LiteralPath (Join-Path $env:USERPROFILE '.azure\cliextensions\azure-devops')) { return $true }
    $names = & az extension list --query '[].name' -o tsv 2>$null
    return (@($names) -contains 'azure-devops')
}

function Test-Toolchain {
    Write-Section 'Toolchain'

    # The whole ALM pillar is `az boards` / `az repos` / `az pipelines`, and those verbs only
    # exist with the azure-devops extension installed — the CLI itself is not enough.
    if (Test-Tool 'az' 'az' 'install with: winget install Microsoft.AzureCLI') {
        if (Test-AzDevOpsExtension) { Write-Ok 'az azure-devops extension' }
        else {
            Write-Problem ('az has no azure-devops extension — az boards/repos/pipelines cannot run; ' +
                           'install with: az extension add --name azure-devops')
        }
    }

    if (Test-Tool 'gh' 'gh' 'install with: winget install GitHub.cli') {
        & gh auth status *> $null
        if ($LASTEXITCODE -eq 0) { Write-Ok 'gh authenticated' }
        else { Write-Problem 'gh is not authenticated — run: gh auth login' }
    }

    if (Test-Tool 'dotnet' 'dotnet SDK' 'install the .NET SDK: winget search Microsoft.DotNet.SDK') {
        $null = Test-Tool 'dotnet-ef' 'dotnet-ef tool' 'install with: dotnet tool install --global dotnet-ef'
    }

    $null = Test-Tool 'docker' 'docker' 'install with: winget install Docker.DockerDesktop'
    $null = Test-Tool 'sqlcmd' 'sqlcmd' 'install with: winget install Microsoft.Sqlcmd'

    # Postgres and Redis have a real client in one platform only, and the kit's answer is the
    # container, not a local install. Absent is the expected state here, never a problem.
    foreach ($client in @(
            @{ Name = 'psql';      Via = 'docker compose exec postgres psql' }
            @{ Name = 'redis-cli'; Via = 'docker compose exec redis redis-cli' }
        )) {
        if (Get-Command $client.Name -ErrorAction SilentlyContinue) {
            Write-Info "$($client.Name) installed locally — the kit still reaches for: $($client.Via)"
        } else {
            Write-Ok "$($client.Name) absent, by design — the kit uses containers: $($client.Via)"
        }
    }
}

function Test-Hooks {
    Write-Section 'Hooks'
    # Which hooks exist is discovered from the repo, and which ones are wired is discovered from
    # settings.json — that file is hand-maintained, so nothing here names a hook one by one.
    $hookDir = Join-Path $RepoRoot 'hooks'
    $shipped = @(Get-ChildItem -LiteralPath $hookDir -File -ErrorAction SilentlyContinue |
                 Where-Object { -not (Test-Ignorable $_.Name) } | ForEach-Object { $_.Name })
    if (-not $shipped) { Write-Info 'the repo ships no hooks'; return }

    # The live settings.json is what actually fires; fall back to the repo's copy when the kit is
    # not installed yet, so a first run still validates the wiring.
    $settingsPath = Join-Path $ClaudeHome 'settings.json'
    if (-not (Test-Path -LiteralPath $settingsPath)) { $settingsPath = Join-Path $RepoRoot 'settings.json' }
    $wired = @{}
    try {
        $settings = Get-Content -Raw -LiteralPath $settingsPath | ConvertFrom-Json
        foreach ($evt in $settings.hooks.PSObject.Properties) {
            foreach ($group in @($evt.Value)) {
                foreach ($hook in @($group.hooks)) {
                    $line = (@($hook.command) + @($hook.args)) -join ' '
                    foreach ($m in [regex]::Matches($line, '[\w.-]+\.(?:ps1|js|mjs|cjs)')) {
                        $wired[$m.Value] = $evt.Name
                    }
                }
            }
        }
    } catch { Write-Problem "cannot read the hook wiring from $settingsPath — $($_.Exception.Message)" }

    foreach ($name in ($wired.Keys | Sort-Object)) {
        if ($name -notin $shipped) {
            Write-Problem "settings.json wires $($wired[$name]) -> $name, which the repo does not ship"
            continue
        }
        # Wired and shipped is still not enough: the hook is resolved from the hooks directory.
        if (Test-Path -LiteralPath (Join-Path $ClaudeHome "hooks\$name")) { Write-Ok "$name ($($wired[$name]))" }
        else { Write-Problem "$name is wired on $($wired[$name]) but not installed in $ClaudeHome\hooks — run .\install.ps1" }
    }

    foreach ($name in ($shipped | Where-Object { $_ -notin $wired.Keys })) {
        Write-Info "$name is shipped by the repo but no settings.json entry runs it — wire it there yourself"
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
        Write-Problem 'no Azure DevOps MCP server — the CLI is the primary path, but the fallback would be gone'
    }
}

# ── Asset sync ────────────────────────────────────────────────────────────────
function Sync-Assets {
    Write-Section $(if ($Check) { 'Assets (repo vs installed)' } elseif ($Pull) { 'Assets (installed -> repo)' } else { 'Assets (repo -> installed)' })

    $sensitive = @('CLAUDE.md', 'settings.json')
    # Pull works over the union of both sides: an asset that exists only in the live config — a
    # whole skill folder with its reference files included — is exactly what it has to bring back.
    $paths = if ($Pull) { @(@(Get-KitAssets) + @(Get-InstalledAssets) | Sort-Object -Unique) } else { @(Get-KitAssets) }

    # Check mode only: a skill the live config does not have at all is one finding, not one per
    # reference file — thirty skills' worth of files would bury every other issue in the report.
    # A partially installed skill still reports file by file, which is the case worth seeing.
    $missingSkills = @{}
    if ($Check) {
        foreach ($d in (Get-ChildItem -LiteralPath (Join-Path $RepoRoot 'skills') -Directory -ErrorAction SilentlyContinue)) {
            if (-not (Test-Path -LiteralPath (Join-Path $ClaudeHome "skills\$($d.Name)"))) { $missingSkills[$d.Name] = $true }
        }
    }

    foreach ($rel in $paths) {
        if ($Check -and ($rel -match '^skills/([^/]+)/') -and $missingSkills.ContainsKey($Matches[1])) {
            $skill = $Matches[1]
            if ($missingSkills[$skill]) {
                $missingSkills[$skill] = $false   # report the folder once
                $count = @($paths | Where-Object { $_ -like "skills/$skill/*" }).Count
                Write-Problem "skills/$skill/ is not installed ($count file(s))"
            }
            continue
        }

        $repoHash = Get-NormalizedHash (Join-Path $RepoRoot $rel.Replace('/', '\'))
        $homeHash = Get-NormalizedHash (Join-Path $ClaudeHome $rel.Replace('/', '\'))

        if ($repoHash -eq $homeHash) { Write-Ok $rel; continue }

        if ($Check) {
            if ($null -eq $homeHash) { Write-Problem "$rel is not installed" }
            else { Write-Problem "$rel differs between repo and the live config" }
            continue
        }

        if ($Pull) {
            if ($null -eq $homeHash) { Write-Info "$rel not installed — nothing to pull"; continue }
            Copy-Asset $rel $ClaudeHome $RepoRoot
            if ($null -eq $repoHash) { Write-Change "$rel pulled into the repo (new file)" }
            else { Write-Change "$rel pulled into the repo" }
            continue
        }

        if (($rel -in $sensitive) -and $homeHash -and -not $Force) {
            # A non-interactive host — CI, an agent, a scheduled run — throws on Read-Host rather
            # than returning nothing, which used to abort the whole install half way through. The
            # safe answer for a hand-maintained file is No, so keep it, say so, and carry on.
            try {
                $answer = Read-Host "  $rel already exists and differs. Overwrite? [y/N]"
            } catch {
                Write-Info "$rel differs, and this host cannot prompt — kept as is (pass -Force to overwrite)"
                continue
            }
            if ($answer -notmatch '^(y|yes)$') { Write-Info "$rel kept as is"; continue }
        }
        Copy-Asset $rel $RepoRoot $ClaudeHome
        Write-Change "$rel installed"
    }
}

function Test-InstalledOnlyAssets {
    # Assets that exist in the live config but not in the repo: the check that caught a skill
    # living in one place only. -Pull is the fix; deleting it is the other.
    Write-Section 'Only in the live config'
    $known = @(Get-KitAssets)
    $extra = @(Get-InstalledAssets | Where-Object { $_ -notin $known })
    if (-not $extra) { Write-Ok 'nothing unaccounted for'; return }

    # A skill the repo does not have at all is reported once, as a folder: listing its SKILL.md
    # and every reference file separately buries the finding.
    $reportedSkills = @{}
    foreach ($rel in $extra) {
        $skill = if ($rel -match '^skills/([^/]+)/') { $Matches[1] } else { $null }
        if ($skill -and -not (Test-Path -LiteralPath (Join-Path $RepoRoot "skills\$skill"))) {
            if ($reportedSkills.ContainsKey($skill)) { continue }
            $reportedSkills[$skill] = $true
            $count = @($extra | Where-Object { $_ -like "skills/$skill/*" }).Count
            Write-Problem "skills/$skill/ exists only in the live config ($count file(s)) — run .\install.ps1 -Pull, or delete it"
            continue
        }
        Write-Problem "$rel exists only in the live config — run .\install.ps1 -Pull, or delete it"
    }
}

# ── Run ───────────────────────────────────────────────────────────────────────
Write-Host "claude-dev-kit  ·  $(if ($Check) { 'check' } elseif ($Pull) { 'pull' } else { 'install' })  ·  home: $ClaudeHome"

if (-not (Test-Path -LiteralPath $ClaudeHome)) {
    if ($Check -or $Pull) { throw "$ClaudeHome does not exist — run .\install.ps1 first." }
    New-Item -ItemType Directory -Force -Path $ClaudeHome | Out-Null
    $ClaudeHome = Resolve-RootPath $ClaudeHome   # now that it exists, in its canonical form
}

Sync-Assets
Test-InstalledOnlyAssets
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

Write-Host '  done — restart Claude Code so it picks up agents, commands, skills and settings.' -ForegroundColor Green
if ($script:Problems -gt 0) { Write-Host "  $($script:Problems) environment item(s) still need attention (see ISSUE above)" -ForegroundColor Yellow }
exit 0
