# Asset sync, drift and retired/local-only reports (dot-sourced by ..\install.ps1, which owns the parameters and script state).

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
        Move-ToRunBackup $rel 'retired'
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
