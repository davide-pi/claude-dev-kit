# Discovery of the assets, the kit options and the install backups (dot-sourced by ..\install.ps1, which owns the parameters and script state).

# ── Discovery ─────────────────────────────────────────────────────────────────
function Test-Ignorable([string]$Name) {
    if ($Name.StartsWith('.')) { return $true }
    foreach ($pattern in $Ignored) { if ($Name -like $pattern) { return $true } }
    return $false
}

function Test-LocalOnly([string]$Relative) {
    foreach ($entry in $LocalOnly) { if ($Relative -eq $entry -or $Relative -like "$entry/*") { return $true } }
    return (Test-Excluded $Relative)
}

function Test-Excluded([string]$Relative) {
    foreach ($entry in $script:Excluded) { if ($Relative -eq $entry -or $Relative -like "$entry/*") { return $true } }
    return $false
}

function Get-KitOptions {
    # The component names kit-options.json opts out of; an unreadable file or an unknown name is reported and ignored.
    $file = Join-Path $ClaudeHome 'kit-options.json'
    if (-not (Test-Path -LiteralPath $file)) { return @() }
    try { $json = Get-Content -Raw -LiteralPath $file | ConvertFrom-Json }
    catch { Write-Problem "kit-options.json cannot be read — $($_.Exception.Message)"; return @() }
    $names = foreach ($name in @($json.without | Where-Object { $_ })) {
        if ("$name" -in $Components.Keys) { "$name" } else { Write-Problem "kit-options.json names an unknown component '$name' — known: $($Components.Keys -join ', ')" }
    }
    return @($names)
}

function Set-KitOptions {
    # Applies -Without / -With to kit-options.json (sorted, no duplicates), then fixes the run's exclusions.
    $current = @(Get-KitOptions)
    $wanted = @(@($current) + @($Without) | Where-Object { $_ -and ($_ -notin $With) } | Sort-Object -Unique)
    if (($Without -or $With) -and (($wanted -join ',') -ne ($current -join ',') -or -not (Test-Path -LiteralPath (Join-Path $ClaudeHome 'kit-options.json')))) {
        $json = [ordered]@{ without = $wanted } | ConvertTo-Json
        [System.IO.File]::WriteAllText((Join-Path $ClaudeHome 'kit-options.json'), "$json`n", [System.Text.UTF8Encoding]::new($false))
        Write-Change "kit-options.json: without = [$($wanted -join ', ')]"
    }
    $script:Excluded = @($wanted | ForEach-Object { $Components[$_] })
}

function Move-ToRunBackup([string]$Relative, [string]$Reason) {
    $source = Join-Path $ClaudeHome $Relative.Replace('/', '\')
    $backup = Join-Path $ClaudeHome "backups\kit-install-$script:RunStamp\$($Relative.Replace('/', '\'))"
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $backup) | Out-Null
    Move-Item -LiteralPath $source -Destination $backup -Force
    Write-Change "$Relative $Reason (moved to backups\kit-install-$script:RunStamp)"
}

function Move-ExcludedAssets {
    # An excluded asset already installed goes to this run's backup folder, like a retired one.
    foreach ($rel in $script:Excluded) {
        if (-not (Test-Path -LiteralPath (Join-Path $ClaudeHome $rel.Replace('/', '\')))) { continue }
        Move-ToRunBackup $rel 'is excluded by kit-options.json'
    }
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
