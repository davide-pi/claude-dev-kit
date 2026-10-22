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
  CLAUDE.md, settings.json and statusline.js. rules/, workflows/, scripts/ and output-styles/ are
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
$AssetDirs = @('agents', 'hooks', 'output-styles', 'rules', 'scripts', 'skills', 'workflows')

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
# machine data (workspaces.json, db-targets.json). Neither side owns them as an asset: -Pull never
# imports them, install never writes them, and -Check reports them as expected.
$LocalOnly = @('skills/my-voice', 'skills/.trash', 'skills/synced', 'workspaces.json', 'db-targets.json',
               'settings.overlay.json')

# Assets the kit used to ship and no longer does, relative to the config root, file or folder. Install
# copies but never deletes, so on a machine that had an older kit they linger: a retired skill keeps
# firing next to its replacement, a retired hook stays wired. -Pull never imports them, -Check lists
# them, and a plain install moves them to the run's backup folder after asking. Commands are not
# listed: every live commands/<name>.md that a skill of the same name replaced is found by name.
$Retired = @('skills/dev-loop', 'skills/done-check', 'skills/redis-dotnet',
             'agents/test-writer.md',  # retired-ok: named on purpose, the repo no longer has it
             'hooks/az-identity.js', 'scripts/sql-ro.ps1')

$script:Problems = 0
$script:RunStamp = Get-Date -Format 'yyyyMMdd-HHmmss'
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

function Test-LocalOnly([string]$Relative) {
    foreach ($entry in $LocalOnly) { if ($Relative -eq $entry -or $Relative -like "$entry/*") { return $true } }
    return $false
}

function Test-Retired([string]$Relative) {
    foreach ($entry in $Retired) { if ($Relative -eq $entry -or $Relative -like "$entry/*") { return $true } }
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
    $files | ForEach-Object { [System.IO.Path]::GetRelativePath($Root, $_.FullName).Replace('\', '/') } |
        Where-Object { -not (Test-LocalOnly $_) }
}

function Get-KitAssets {
    # Every user-level asset the repo ships, as repo-relative forward-slash paths.
    $root = Get-ChildItem -LiteralPath $RepoRoot -File |
        Where-Object { -not (Test-Ignorable $_.Name) -and $_.Name -notin $RepoOnly -and -not (Test-LocalOnly $_.Name) } |
        ForEach-Object { $_.Name }
    @($root) + @(Get-DirAssets $RepoRoot) | Sort-Object -Unique
}

function Get-InstalledAssets {
    # The live config, from the asset directories only: its root holds runtime state (session
    # history, credentials, local settings) that the repo must never adopt. Retired assets are left
    # out too: they have a section of their own, and pulling one back would revive it.
    @(Get-DirAssets $ClaudeHome | Where-Object { -not (Test-Retired $_) }) | Sort-Object -Unique
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
    # Anything already in the live config is someone's work — `skills/commit/SKILL.md` is a likely
    # collision — so keep a copy before overwriting. Copies go to one folder per run under
    # backups\, never next to the asset: a .bak beside a skill is loaded, listed and diffed as if it
    # were one, and seventy of them is how the live config became unreadable. Pulling into the repo
    # needs no backup: git is the backup there.
    if ((Test-Path -LiteralPath $target) -and ($To -ne $RepoRoot)) {
        $backup = Join-Path $To "backups\kit-install-$script:RunStamp\$($Relative.Replace('/', '\'))"
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $backup) | Out-Null
        Copy-Item -Force -LiteralPath $target -Destination $backup
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

    # settings.json starts the browser-use hook as `pwsh`, by name.
    if (Get-Command pwsh -ErrorAction SilentlyContinue) { Write-Ok 'pwsh on PATH' }
    else { Write-Problem 'pwsh (PowerShell 7) not found in PATH — the browser-use hook and the worklog and database scripts will not run' }

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
    elseif ($Check -and ($expected.TrimEnd('\') -ieq (Join-Path $HOME '.claude\hooks').TrimEnd('\'))) {
        Write-Ok 'CLAUDE_HOOKS not set — the hooks fall back to ~/.claude/hooks, which is where they are'
    }
    elseif ($Check) { Write-Problem "CLAUDE_HOOKS is not set (User scope) and the hooks are not in ~/.claude/hooks — they would not be found, and fail silently since they exit 0 by design" }
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
    Test-DbClients
}

function Get-DbClientImages {
    # The docker route's default images are scripts/db-ro.ps1's $DefaultImages: read them from there so
    # the two cannot drift. A script that no longer carries the line falls back to the known pair.
    $images = @{ 'psql' = 'postgres:17'; 'redis-cli' = 'redis:7' }
    $dbRo = Join-Path $RepoRoot 'scripts\db-ro.ps1'
    if (Test-Path -LiteralPath $dbRo) {
        $line = Select-String -LiteralPath $dbRo -Pattern '^\$DefaultImages\s*=\s*@\{(.+)\}' | Select-Object -First 1
        if ($line) {
            foreach ($m in [regex]::Matches($line.Matches[0].Groups[1].Value, "'([\w-]+)'\s*=\s*'([^']+)'")) {
                $images[$m.Groups[1].Value] = $m.Groups[2].Value
            }
        }
    }
    return $images
}

function Test-InWsl([string]$Name) {
    # `wsl` exists on a machine with no distribution installed, and then `which` fails: that is "no".
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { & wsl -e which $Name *> $null; return ($LASTEXITCODE -eq 0) } catch { return $false }
    finally { $ErrorActionPreference = $previous }
}

function Get-LocalImage([string]$Repository) {
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        return (& docker image ls $Repository --format '{{.Repository}}:{{.Tag}}' 2>$null |
            Where-Object { $_ -and $_ -notmatch '<none>' } | Select-Object -First 1)
    } catch { return $null }
    finally { $ErrorActionPreference = $previous }
}

function Test-DbClients {
    # scripts/db-ro.ps1 drives three clients. psql and redis-cli run native, else in WSL, else through
    # docker (an image already pulled, else its default); go-sqlcmd is native only. None of the three is
    # a problem here: this says which route the database skill will take.
    $docker = [bool](Get-Command docker -ErrorAction SilentlyContinue)
    $wsl = [bool](Get-Command wsl -CommandType Application -ErrorAction SilentlyContinue)
    $images = Get-DbClientImages

    if (Get-Command sqlcmd -ErrorAction SilentlyContinue) { Write-Ok 'sqlcmd (native)' }
    else { Write-Info 'sqlcmd not installed — SQL Server targets of db-ro.ps1 need it, native only: winget install Microsoft.Sqlcmd' }

    foreach ($client in @(
            @{ Name = 'psql';      Install = 'scoop install postgresql' }
            @{ Name = 'redis-cli'; Install = 'WSL: apt install redis-tools' }
        )) {
        $name = $client.Name
        if (Get-Command $name -ErrorAction SilentlyContinue) { Write-Ok "$name (native)"; continue }
        if ($wsl -and (Test-InWsl $name)) { Write-Ok "$name (WSL)"; continue }
        if ($docker) {
            $local = Get-LocalImage ($images[$name].Split(':')[0])
            if ($local) { Write-Info "$name not installed — via docker, image $local (already pulled)" }
            else { Write-Info "$name not installed — via docker, image $($images[$name]) (pulled on first use)" }
            continue
        }
        Write-Info "$name missing, and no WSL or docker to fall back on — install: $($client.Install)"
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
    # Every event under "hooks" is walked, whatever its name — a new event needs no edit here. A
    # script wired on several events lists them all. A hook that runs no kit script (a prompt hook,
    # an external executable) cannot be checked against the repo, so it is only counted.
    $wired = @{}
    $unchecked = [ordered]@{}
    try {
        $settings = Get-Content -Raw -LiteralPath $settingsPath | ConvertFrom-Json
        foreach ($evt in $settings.hooks.PSObject.Properties) {
            foreach ($group in @($evt.Value)) {
                foreach ($hook in @($group.hooks)) {
                    $line = (@($hook.command) + @($hook.args)) -join ' '
                    $files = @([regex]::Matches($line, '[\w.-]+\.(?:ps1|js|mjs|cjs)') | ForEach-Object { $_.Value })
                    foreach ($file in $files) {
                        if (-not $wired.ContainsKey($file)) { $wired[$file] = @() }
                        if ($evt.Name -notin $wired[$file]) { $wired[$file] += $evt.Name }
                    }
                    if (-not $files) { $unchecked[$evt.Name] = 1 + [int]$unchecked[$evt.Name] }
                }
            }
        }
    } catch { Write-Problem "cannot read the hook wiring from $settingsPath — $($_.Exception.Message)" }

    foreach ($name in ($wired.Keys | Sort-Object)) {
        $events = $wired[$name] -join ', '
        if ($name -notin $shipped) {
            Write-Problem "settings.json wires $events -> $name, which the repo does not ship"
            continue
        }
        # Wired and shipped is still not enough: the hook is resolved from the hooks directory.
        if (Test-Path -LiteralPath (Join-Path $ClaudeHome "hooks\$name")) { Write-Ok "$name ($events)" }
        else { Write-Problem "$name is wired on $events but not installed in $ClaudeHome\hooks — run .\install.ps1" }
    }

    foreach ($evt in $unchecked.Keys) {
        Write-Info "${evt}: $($unchecked[$evt]) hook(s) run no kit script (prompt hook or external command) — not checked"
    }

    foreach ($name in ($shipped | Where-Object { $_ -notin $wired.Keys })) {
        Write-Info "$name is shipped by the repo but no settings.json entry runs it — wire it there yourself"
    }

    # The reminder hook reads its roots from settings.json → env; the template ships them empty, and
    # empty is silence — the one state in which forgotten hours stay forgotten without a sign.
    if ($wired.ContainsKey('worklog-pending.js') -and -not "$($settings.env.CLAUDE_WORKSPACE_ROOTS)".Trim()) {
        Write-Problem 'CLAUDE_WORKSPACE_ROOTS is empty in settings.json → env — worklog-pending.js will never report a day'
    }

    # Likewise the ALM line: without the local map the hook prints nothing and the session never learns
    # its org, project or az identity.
    if ($wired.ContainsKey('workspace-context.js') -and -not (Test-Path -LiteralPath (Join-Path $ClaudeHome 'workspaces.json'))) {
        Write-Problem 'workspace-context.js is wired but workspaces.json is missing — no ALM line will appear; copy workspaces.example.json to workspaces.json and edit it'
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
function Get-AssetKey([string]$Relative) {
    # What a person calls "one asset": a skill is its whole folder, every other asset is its file.
    if ($Relative -match '^(skills/[^/]+)/') { return $Matches[1] }
    return $Relative
}

function Test-AssetDrift([string[]]$Paths) {
    # One finding per asset, not per file: a skill the live config lacks entirely is one line, not
    # thirty reference files burying every other issue. A partly drifted skill names its files.
    foreach ($group in ($Paths | Group-Object { Get-AssetKey $_ })) {
        $key = $group.Name
        $files = @($group.Group)
        $missing = @()
        $differs = @()
        foreach ($rel in $files) {
            $repoHash = Get-NormalizedHash (Join-Path $RepoRoot $rel.Replace('/', '\'))
            $homeHash = Get-NormalizedHash (Join-Path $ClaudeHome $rel.Replace('/', '\'))
            if ($repoHash -eq $homeHash) { continue }
            if ($null -eq $homeHash) { $missing += $rel } else { $differs += $rel }
        }

        if (-not $missing -and -not $differs) { Write-Ok $(if ($files.Count -gt 1) { "$key/ ($($files.Count) files)" } else { $key }); continue }
        if ($files.Count -eq 1) {
            if ($missing) { Write-Problem "$key is not installed" } else { Write-Problem "$key differs between repo and the live config" }
            continue
        }
        if ($missing.Count -eq $files.Count) { Write-Problem "$key/ is not installed ($($files.Count) file(s))"; continue }

        $parts = @()
        if ($differs) { $parts += "differs: $(($differs | ForEach-Object { $_.Substring($key.Length + 1) }) -join ', ')" }
        if ($missing) { $parts += "not installed: $(($missing | ForEach-Object { $_.Substring($key.Length + 1) }) -join ', ')" }
        Write-Problem "$key/ drifted — $($parts -join '; ')"
    }
}

function Test-SettingsMerge([string]$Overlay) {
    # tools/merge-settings.mjs: exit 0 the live settings.json is template + overlay, 1 it is not (the
    # differing keys on stdout), 2 a file could not be read.
    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) { Write-Problem 'settings.json cannot be compared with template + overlay: node is not on PATH'; return }
    $output = @(& $node.Source (Join-Path $RepoRoot 'tools\merge-settings.mjs') `
        --template (Join-Path $RepoRoot 'settings.json') --overlay $Overlay `
        --check (Join-Path $ClaudeHome 'settings.json') 2>&1)
    switch ($LASTEXITCODE) {
        0 { Write-Ok 'settings.json matches the template + overlay' }
        1 {
            Write-Problem 'settings.json differs from the template + overlay (~ differs, + missing from the live file, - only in it)'
            foreach ($line in $output) { Write-Info "$line" }
        }
        default { Write-Problem "settings.json could not be compared with template + overlay: $($output -join ' ')" }
    }
}

function Install-SettingsMerge([string]$Overlay) {
    # With an overlay the live settings.json is generated, never copied: the template alone would
    # drop your choices. A change the app wrote into the live file (/config, /plugin) shows in the
    # diff below and is lost on Yes unless it is copied into the overlay first.
    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) { Write-Problem 'settings.json not installed: node is not on PATH to merge template + overlay'; return }
    $merge = Join-Path $RepoRoot 'tools\merge-settings.mjs'
    $template = Join-Path $RepoRoot 'settings.json'
    $live = Join-Path $ClaudeHome 'settings.json'
    if (Test-Path -LiteralPath $live) {
        $output = @(& $node.Source $merge --template $template --overlay $Overlay --check $live 2>&1)
        if ($LASTEXITCODE -eq 0) { Write-Ok 'settings.json (template + overlay)'; return }
        if ($LASTEXITCODE -ne 1) { Write-Problem "settings.json not installed: $($output -join ' ')"; return }
        Write-Info 'settings.json differs from template + overlay (~ differs, + missing from the live file, - only in it):'
        foreach ($line in $output) { Write-Info "  $line" }
        if (-not $Force) {
            try {
                $answer = Read-Host '  Write template + overlay over settings.json? [y/N]'
            } catch {
                Write-Info 'settings.json differs, and this host cannot prompt — kept as is (pass -Force to write)'
                return
            }
            if ("$answer" -notmatch '^(y|yes)$') { Write-Info 'settings.json kept as is'; return }
        }
        $backup = Join-Path $ClaudeHome "backups\kit-install-$script:RunStamp\settings.json"
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $backup) | Out-Null
        Copy-Item -Force -LiteralPath $live -Destination $backup
    }
    $output = @(& $node.Source $merge --template $template --overlay $Overlay --out $live 2>&1)
    if ($LASTEXITCODE -eq 0) { Write-Change 'settings.json written from template + overlay' }
    else { Write-Problem "settings.json not written: $($output -join ' ')" }
}

function Sync-Assets {
    Write-Section $(if ($Check) { 'Assets (repo vs installed)' } elseif ($Pull) { 'Assets (installed -> repo)' } else { 'Assets (repo -> installed)' })

    $sensitive = @('CLAUDE.md', 'settings.json')
    # Pull works over the union of both sides: an asset that exists only in the live config — a
    # whole skill folder with its reference files included — is exactly what it has to bring back.
    $paths = if ($Pull) { @(@(Get-KitAssets) + @(Get-InstalledAssets) | Sort-Object -Unique) } else { @(Get-KitAssets) }

    $overlay = Join-Path $ClaudeHome 'settings.overlay.json'
    if ($Check) {
        # settings.json is the template you merged your own choices into, so it differs by design, unless
        # the choices live in an overlay: then the live file has to be exactly template + overlay.
        if (Test-Path -LiteralPath $overlay) { Test-SettingsMerge $overlay }
        else { Write-Info 'settings.json is not compared: your copy is a personalised merge of the template, by design' }
        Test-AssetDrift @($paths | Where-Object { $_ -ne 'settings.json' })
        return
    }

    foreach ($rel in $paths) {
        if ($rel -eq 'settings.json' -and (Test-Path -LiteralPath $overlay)) {
            # Generated, so neither copied nor pulled: a pull would put your choices into the public repo.
            if ($Pull) { Write-Info 'settings.json not pulled: it is generated from template + overlay' }
            else { Install-SettingsMerge $overlay }
            continue
        }
        $repoHash = Get-NormalizedHash (Join-Path $RepoRoot $rel.Replace('/', '\'))
        $homeHash = Get-NormalizedHash (Join-Path $ClaudeHome $rel.Replace('/', '\'))

        if ($repoHash -eq $homeHash) { Write-Ok $rel; continue }

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
            if ("$answer" -notmatch '^(y|yes)$') { Write-Info "$rel kept as is"; continue }
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

function Get-RetiredInstalled {
    # Retired assets still in the live config, as config-relative paths (a file or a whole folder).
    $found = foreach ($entry in $Retired) {
        if (Test-Path -LiteralPath (Join-Path $ClaudeHome $entry.Replace('/', '\'))) { $entry }
    }
    # Commands became skills. A live commands/<name>.md whose name the repo now ships as a skill is two
    # assets for one name; any other command there is the user's own and is none of the kit's business.
    $commands = Join-Path $ClaudeHome 'commands'
    $shadowing = if (Test-Path -LiteralPath $commands) {
        foreach ($file in Get-ChildItem -LiteralPath $commands -Filter '*.md' -File -ErrorAction SilentlyContinue) {
            $name = [System.IO.Path]::GetFileNameWithoutExtension($file.Name)
            if (Test-Path -LiteralPath (Join-Path $RepoRoot "skills\$name")) { "commands/$($file.Name)" }
        }
    }
    return @($found) + @($shadowing)
}

function Test-RetiredAssets {
    # Install copies and never deletes, so the retired ones have to be named. -Check reports each; a plain
    # install moves it to the run's backup folder after asking (-Force skips the question, a host that
    # cannot prompt keeps everything). A retired hook may still be wired in a settings.json you kept:
    # Test-Hooks reports that separately.
    Write-Section 'Retired assets (the kit no longer ships them)'
    $retired = @(Get-RetiredInstalled | Where-Object { $_ })
    if (-not $retired) { Write-Ok 'none in the live config'; return }

    foreach ($rel in $retired) {
        if ($Pull) { Write-Info "$rel is retired and still in the live config — not pulled"; continue }
        if ($Check) { Write-Problem "$rel is retired but still in the live config — run .\install.ps1 to remove it"; continue }
        if (-not $Force) {
            try {
                $answer = Read-Host "  $rel was retired by the kit. Move it to the backup folder? [y/N]"
            } catch {
                Write-Info "$rel is retired, and this host cannot prompt — kept (pass -Force to remove)"
                continue
            }
            if ("$answer" -notmatch '^(y|yes)$') { Write-Info "$rel kept"; continue }
        }
        $source = Join-Path $ClaudeHome $rel.Replace('/', '\')
        $backup = Join-Path $ClaudeHome "backups\kit-install-$script:RunStamp\$($rel.Replace('/', '\'))"
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $backup) | Out-Null
        Move-Item -LiteralPath $source -Destination $backup -Force
        Write-Change "$rel retired (moved to backups\kit-install-$script:RunStamp)"
    }
}

function Test-LocalOnlyAssets {
    # Local-only paths are expected in the live config and never a finding there. The reverse is:
    # one that has reached the repo carries identity or machine data into a shared kit.
    Write-Section 'Local-only (never in the kit)'
    foreach ($entry in $LocalOnly) {
        $relPath = $entry.Replace('/', '\')
        if (Test-Path -LiteralPath (Join-Path $RepoRoot $relPath)) {
            Write-Problem "$entry is local-only but exists in the repo — remove it from the repo"
        }
        if (Test-Path -LiteralPath (Join-Path $ClaudeHome $relPath)) { Write-Info "$entry — local-only (expected)" }
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
