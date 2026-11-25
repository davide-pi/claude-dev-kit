# Discovery of the assets and the install backups (dot-sourced by ..\install.ps1, which owns the parameters and script state).

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

function Move-ToRunBackup([string]$Relative, [string]$Reason) {
    $source = Join-Path $ClaudeHome $Relative.Replace('/', '\')
    $backup = Join-Path $ClaudeHome "backups\kit-install-$script:RunStamp\$($Relative.Replace('/', '\'))"
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $backup) | Out-Null
    Move-Item -LiteralPath $source -Destination $backup -Force
    Write-Change "$Relative $Reason (moved to backups\kit-install-$script:RunStamp)"
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
        $enumErrors = $null
        Get-ChildItem -LiteralPath $path -File -Recurse -ErrorAction SilentlyContinue -ErrorVariable enumErrors |
            Where-Object { -not (Test-Ignorable $_.Name) }
        # A folder that cannot be read would otherwise look like an asset that does not exist.
        foreach ($e in @($enumErrors)) { Write-Problem "cannot list $path — $($e.Exception.Message)" }
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
    return Get-BytesHash ([System.IO.File]::ReadAllBytes($Path))
}

function Get-BytesHash([byte[]]$Bytes) {
    # Text (valid UTF-8) is compared on content, BOM and line endings aside; anything else is a binary
    # asset and is hashed as the bytes it is, so two different blobs never collapse to one decoded string.
    try { return Get-TextHash ([System.Text.UTF8Encoding]::new($false, $true).GetString($Bytes).TrimStart([char]0xFEFF)) }
    catch [System.Text.DecoderFallbackException] { return Get-RawHash $Bytes }
}

function Get-RawHash([byte[]]$Bytes) {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { return [System.BitConverter]::ToString($sha.ComputeHash($Bytes)) } finally { $sha.Dispose() }
}

function Get-TextHash([string]$Content) {
    $text = $Content -replace "`r`n", "`n"
    return Get-RawHash ([System.Text.Encoding]::UTF8.GetBytes($text))
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
