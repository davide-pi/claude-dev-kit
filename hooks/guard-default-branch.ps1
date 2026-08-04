#Requires -Version 5.1
<#
  Hook PreToolUse per Bash / PowerShell.

  La convenzione (skill `git-branching`) e': `main` e' protetto, ogni modifica passa da un
  branch `feature/*` o `fix/*` e da una PR. Questo hook rende visibile la regola nel momento
  in cui viene infranta: se il comando e' un `git commit` / `git push` e il branch corrente e'
  quello di default del repo, chiede conferma all'utente.

  Non blocca mai da solo: al massimo escala all'utente (permissionDecision = "ask"), e in caso
  di errore lascia passare. Esce sempre con codice 0.

  Generato da Claude Code su richiesta dell'utente.
#>

$ErrorActionPreference = 'Stop'

function Approve {
    # Nessun output => si applica il normale flusso dei permessi.
    exit 0
}

function Request-Confirmation([string]$Reason) {
    @{
        hookSpecificOutput = @{
            hookEventName            = 'PreToolUse'
            permissionDecision       = 'ask'
            permissionDecisionReason = $Reason
        }
    } | ConvertTo-Json -Depth 5 -Compress
    exit 0
}

try {
    $raw = [Console]::In.ReadToEnd()
    if ([string]::IsNullOrWhiteSpace($raw)) { Approve }

    $payload = $raw | ConvertFrom-Json
    $command = $payload.tool_input.command
    if ([string]::IsNullOrWhiteSpace($command)) { Approve }

    # --- 1. e' un comando che scrive sulla storia? ------------------------------
    $isCommit = $command -match '(^|[;&|`\s])git\b[^;&|]*\bcommit\b'
    $isPush   = $command -match '(^|[;&|`\s])git\b[^;&|]*\bpush\b'
    if (-not ($isCommit -or $isPush)) { Approve }

    # un dry-run non cambia niente
    if ($command -match '--dry-run') { Approve }

    # --- 2. in quale repo? -----------------------------------------------------
    # `git -C <path>` vince sul cwd della sessione.
    $repo = $payload.cwd
    if ($command -match 'git\s+(?:-c\s+\S+\s+)*-C\s+(?:"([^"]+)"|''([^'']+)''|(\S+))') {
        $repo = $Matches[1]; if (-not $repo) { $repo = $Matches[2] }; if (-not $repo) { $repo = $Matches[3] }
    }
    if ([string]::IsNullOrWhiteSpace($repo) -or -not (Test-Path -LiteralPath $repo)) { Approve }

    $current = (git -C $repo rev-parse --abbrev-ref HEAD 2>$null)
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($current)) { Approve }
    $current = $current.Trim()

    # --- 3. qual e' il branch di default? --------------------------------------
    $default = $null
    $originHead = (git -C $repo symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>$null)
    if ($LASTEXITCODE -eq 0 -and $originHead) { $default = ($originHead -replace '^origin/', '').Trim() }
    if (-not $default) {
        foreach ($candidate in 'main', 'master') {
            git -C $repo show-ref --verify --quiet "refs/heads/$candidate" 2>$null
            if ($LASTEXITCODE -eq 0) { $default = $candidate; break }
        }
    }
    if (-not $default) { Approve }

    if ($current -ne $default) {
        # Su un branch di lavoro: resta il caso `git push origin <default>` fatto da qui.
        if ($isPush -and $command -match "\b$([regex]::Escape($default))\b") {
            Request-Confirmation "Il comando spinge su '$default', il branch protetto di questo repo. La convenzione git-branching vuole che ci arrivi solo una PR (squash, CI verde + 1 review). Confermi?"
        }
        Approve
    }

    # --- 4. siamo sul branch protetto ------------------------------------------
    $action = if ($isCommit -and $isPush) { 'committare e spingere' } elseif ($isCommit) { 'committare' } else { 'spingere' }
    Request-Confirmation "Sei su '$current', il branch di default del repo. La convenzione git-branching vieta di $action direttamente qui: la strada e' un branch feature/* o fix/* e una PR verso '$default'. Confermi di voler procedere comunque?"
}
catch {
    # Un bug nell'hook non deve mai impedire il lavoro.
    Approve
}
