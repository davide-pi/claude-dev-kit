#Requires -Version 5.1
<#
  Hook PreToolUse per i tool mcp__claude-in-chrome__*.

  L'estensione Claude si collega da sola all'avvio del browser (handshake misurato:
  ~2s). Quindi l'unica cosa che manca quando il bridge non risponde e' un browser
  aperto: questo hook ne avvia uno che abbia l'estensione installata, preferendo il
  browser di default, e attende l'handshake.

  Non blocca mai la chiamata al tool: esce sempre con codice 0.
  Generato da Claude Code su richiesta dell'utente.
#>

$ErrorActionPreference = 'Stop'

$ExtensionId  = 'fcoeoabgfenejglbffodgkkbkcdhcgfn'
$GraceSeconds = 12   # margine ampio sui ~2s di handshake osservati

function Write-HookMessage([string]$Text) {
    # Il messaggio finisce nella UI di Claude Code (campo systemMessage).
    @{ systemMessage = $Text } | ConvertTo-Json -Compress
}

function Resolve-BrowserExe([string]$Exe) {
    foreach ($root in 'HKLM:', 'HKCU:') {
        $key = "$root\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\$Exe"
        if (Test-Path $key) {
            $path = (Get-ItemProperty $key -ErrorAction SilentlyContinue).'(default)'
            if ($path -and (Test-Path $path)) { return $path }
        }
    }
    return $null
}

function Test-ExtensionInstalled([string]$DataPath) {
    $root = Join-Path $env:LOCALAPPDATA $DataPath
    if (-not (Test-Path $root)) { return $false }
    $profiles = Get-ChildItem $root -Directory -ErrorAction SilentlyContinue |
                Where-Object { $_.Name -eq 'Default' -or $_.Name -like 'Profile *' }
    foreach ($p in $profiles) {
        if (Test-Path (Join-Path $p.FullName "Extensions\$ExtensionId")) { return $true }
    }
    return $false
}

function Get-DefaultBrowserKey {
    $key = 'HKCU:\SOFTWARE\Microsoft\Windows\Shell\Associations\UrlAssociations\http\UserChoice'
    $progId = (Get-ItemProperty $key -ErrorAction SilentlyContinue).ProgId
    switch -Wildcard ($progId) {
        'MSEdge*'   { return 'edge' }
        'Chrome*'   { return 'chrome' }
        'Brave*'    { return 'brave' }
        'Vivaldi*'  { return 'vivaldi' }
        'Chromium*' { return 'chromium' }
        default     { return $null }
    }
}

try {
    # --- 1. candidati, nello stesso ordine di detection usato da Claude Code ---
    $candidates = @(
        [pscustomobject]@{ Key = 'chrome';   Name = 'Google Chrome';  DataPath = 'Google\Chrome\User Data';               Exe = 'chrome.exe'  },
        [pscustomobject]@{ Key = 'brave';    Name = 'Brave';          DataPath = 'BraveSoftware\Brave-Browser\User Data'; Exe = 'brave.exe'   },
        [pscustomobject]@{ Key = 'edge';     Name = 'Microsoft Edge'; DataPath = 'Microsoft\Edge\User Data';              Exe = 'msedge.exe'  },
        [pscustomobject]@{ Key = 'vivaldi';  Name = 'Vivaldi';        DataPath = 'Vivaldi\User Data';                     Exe = 'vivaldi.exe' },
        [pscustomobject]@{ Key = 'chromium'; Name = 'Chromium';       DataPath = 'Chromium\User Data';                    Exe = 'chrome.exe'  }
    )

    # il browser di default passa in testa: non apriamo Chrome se il default va bene
    $defaultKey = Get-DefaultBrowserKey
    if ($defaultKey) {
        $candidates = @($candidates | Where-Object { $_.Key -eq $defaultKey }) +
                      @($candidates | Where-Object { $_.Key -ne $defaultKey })
    }

    $usable = @()
    foreach ($c in $candidates) {
        if (-not (Test-ExtensionInstalled $c.DataPath)) { continue }
        $exe = Resolve-BrowserExe $c.Exe
        if (-not $exe) { continue }
        $usable += [pscustomobject]@{
            Name = $c.Name
            Exe  = $exe
            Proc = [System.IO.Path]::GetFileNameWithoutExtension($c.Exe)
        }
    }

    if ($usable.Count -eq 0) {
        Write-HookMessage "Nessun browser con l'estensione Claude ($ExtensionId) installata. Installala nel browser che usi, poi riprova."
        exit 0
    }

    # --- 2. fast path: un browser con l'estensione e' gia' aperto --------------
    # L'estensione si ricollega da sola; se il bridge non risponde comunque, il
    # tool MCP produrra' un errore piu' preciso di quanto possa fare l'hook.
    foreach ($b in $usable) {
        if (Get-Process -Name $b.Proc -ErrorAction SilentlyContinue) { exit 0 }
    }

    # --- 3. nessun browser utile aperto: avvia e attendi l'handshake ----------
    $target = $usable[0]
    Start-Process -FilePath $target.Exe -WindowStyle Minimized | Out-Null

    $deadline = (Get-Date).AddSeconds($GraceSeconds)
    $up = $false
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 400
        if (Get-Process -Name $target.Proc -ErrorAction SilentlyContinue) { $up = $true; break }
    }

    if ($up) {
        # l'handshake dell'estensione parte subito dopo l'avvio del processo
        Start-Sleep -Seconds 3
        Write-HookMessage ("{0} non era aperto: avviato per l'estensione Claude." -f $target.Name)
    } else {
        Write-HookMessage ("Avvio di {0} non confermato entro {1}s: la chiamata potrebbe fallire." -f $target.Name, $GraceSeconds)
    }
    exit 0
}
catch {
    # un bug nell'hook non deve mai impedire la chiamata al tool
    Write-HookMessage ("Hook ensure-browser non riuscito: {0}" -f $_.Exception.Message)
    exit 0
}
