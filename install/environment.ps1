# Environment, toolchain, hooks, plugins and MCP checks (dot-sourced by ..\install.ps1, which owns the parameters and script state).

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
    elseif ($Check) { Write-Problem "CLAUDE_HOOKS is not set (User scope) and the hooks are not in ~/.claude/hooks — they would not be found: guard-shell and secret-scan block (onFailure: block), the other hooks fail silently since they exit 0 by design" }
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
    if (Test-Path -LiteralPath (Join-Path $HOME '.azure/cliextensions/azure-devops')) { return $true }
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

function Test-HookSyntax([string]$Path) {
    # Parse only, never run: a hook executed here would act on the live session. `node --check` and the
    # PowerShell parser read the file and stop.
    $ErrorActionPreference = 'Continue'
    $name = Split-Path -Leaf $Path
    if ($Path -like '*.ps1') {
        $tokens = $null; $errors = $null
        [void][System.Management.Automation.Language.Parser]::ParseFile($Path, [ref]$tokens, [ref]$errors)
        if ($errors) { Write-Problem "$name does not parse — $($errors[0].Message) (line $($errors[0].Extent.StartLineNumber))"; return $false }
        return $true
    }
    $out = @(& node --check $Path 2>&1 | ForEach-Object { "$_" })
    if ($LASTEXITCODE -ne 0) {
        Write-Problem "$name fails node --check — $((@($out | Where-Object { $_ -match 'Error' }) + $out)[0])"
        return $false
    }
    return $true
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

    $parsed = 0
    $failed = 0
    $canParse = $Check -and [bool](Get-Command node -ErrorAction SilentlyContinue)
    if ($Check -and -not $canParse) { Write-Info 'node is not in PATH — the hook scripts are not syntax-checked' }

    foreach ($name in ($wired.Keys | Sort-Object)) {
        $events = $wired[$name] -join ', '
        if (Test-Excluded "hooks/$name") { Write-Info "$name ($events) belongs to a component excluded by kit-options.json — not checked"; continue }
        if ($name -notin $shipped) {
            Write-Problem "settings.json wires $events -> $name, which the repo does not ship"
            continue
        }
        # Wired and shipped is still not enough: the hook is resolved from the hooks directory.
        if (Test-Path -LiteralPath (Join-Path $ClaudeHome "hooks\$name")) {
            Write-Ok "$name ($events)"
            if ($canParse) { if (Test-HookSyntax (Join-Path $ClaudeHome "hooks\$name")) { $parsed++ } else { $failed++ } }
        }
        else { Write-Problem "$name is wired on $events but not installed in $ClaudeHome\hooks — run .\install.ps1" }
    }

    # The libraries the .js hooks require are part of the same smoke test: a broken one fails every caller.
    # Only when the repo ships hooks\lib. A lib the repo ships but the install lacks is a failure of its own,
    # whether or not node can parse.
    $installedLib = Join-Path $ClaudeHome 'hooks\lib'
    $repoLib = Join-Path $RepoRoot 'hooks\lib'
    if (Test-Path -LiteralPath $repoLib -PathType Container) {
        if (-not (Test-Path -LiteralPath $installedLib -PathType Container)) {
            Write-Problem "$installedLib is missing — the hooks cannot load their libraries; run .\install.ps1"
            $failed++
        }
        else {
            foreach ($shippedLib in @(Get-ChildItem -LiteralPath $repoLib -Filter '*.js' -File -ErrorAction SilentlyContinue)) {
                if (-not (Test-Path -LiteralPath (Join-Path $installedLib $shippedLib.Name))) {
                    Write-Problem "hooks\lib\$($shippedLib.Name) is shipped by the repo but not installed in $installedLib — run .\install.ps1"
                    $failed++
                }
            }
            if ($canParse) {
                foreach ($lib in @(Get-ChildItem -LiteralPath $installedLib -Filter '*.js' -File -ErrorAction SilentlyContinue)) {
                    if (Test-HookSyntax $lib.FullName) { $parsed++ } else { $failed++ }
                }
            }
        }
    }
    if ($canParse) {
        if ($failed -gt 0) { Write-Problem "$failed of the wired hook scripts and the top-level hooks\lib\*.js failed the smoke test, $parsed parsed" }
        elseif ($parsed -eq 0) { Write-Info 'smoke test: nothing was checked (no wired hook script installed, no hooks\lib\*.js)' }
        else { Write-Ok "$parsed script(s) parse: the wired hooks plus the top-level hooks\lib\*.js (node --check / PowerShell parser, nothing executed)" }
    }

    foreach ($evt in $unchecked.Keys) {
        Write-Info "${evt}: $($unchecked[$evt]) hook(s) run no kit script (prompt hook or external command) — not checked"
    }

    foreach ($name in ($shipped | Where-Object { $_ -notin $wired.Keys })) {
        Write-Info "$name is shipped by the repo but no settings.json entry runs it — wire it there yourself"
    }

    # The reminder hook reads its roots from settings.json → env; the template ships them empty, and
    # empty is silence — the one state in which forgotten hours stay forgotten without a sign.
    if ($wired.ContainsKey('worklog-pending.js') -and -not (Test-Excluded 'hooks/worklog-pending.js') -and -not "$($settings.env.CLAUDE_WORKSPACE_ROOTS)".Trim()) {
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
