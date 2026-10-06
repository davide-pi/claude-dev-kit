#Requires -Version 5.1
<#
  Hook PreToolUse per i tool mcp__plugin_browser-use_browser-use__*.

  browser-use (browser-harness) non avvia un browser: si aggancia alla porta CDP
  scritta dal profilo Edge PRINCIPALE in "User Data\DevToolsActivePort". Il toggle di
  edge://inspect ("Allow remote debugging") e' persistito in Local State, quindi basta
  che Edge sia aperto perche' la porta (9222) torni su. Al primo aggancio di ogni
  sessione del browser Edge chiede "Allow remote debugging?": va cliccato a mano.
    1. porta CDP raggiungibile          -> esce subito;
    2. Edge non in esecuzione            -> lo avvia e attende la porta;
    3. Edge aperto ma porta chiusa       -> avvisa di riattivare il toggle.

  Non blocca mai la chiamata al tool: esce sempre con codice 0.
  Generato da Claude Code su richiesta dell'utente.
#>

$ErrorActionPreference = 'Stop'

$UserData     = Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\User Data'
$DefaultPort  = 9222
$GraceSeconds = 20

function Write-HookMessage([string]$Text) {
    @{ systemMessage = $Text } | ConvertTo-Json -Compress
}

function Get-CdpPort {
    $file = Join-Path $UserData 'DevToolsActivePort'
    try {
        $first = (Get-Content $file -TotalCount 1 -ErrorAction Stop).Trim()
        return [int]$first
    } catch {
        return $DefaultPort
    }
}

function Test-Port([int]$Port) {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $task = $client.ConnectAsync('127.0.0.1', $Port)
        return ($task.Wait(500) -and $client.Connected)
    } catch {
        return $false
    } finally {
        $client.Dispose()
    }
}

function Resolve-EdgeExe {
    foreach ($root in 'HKLM:', 'HKCU:') {
        $key = "$root\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe"
        if (Test-Path $key) {
            $path = (Get-ItemProperty $key -ErrorAction SilentlyContinue).'(default)'
            if ($path -and (Test-Path $path)) { return $path }
        }
    }
    foreach ($p in "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
                   "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") {
        if (Test-Path $p) { return $p }
    }
    return $null
}

try {
    # --- 1. fast path: porta CDP gia' su ------------------------------------
    if ((Test-Port (Get-CdpPort)) -or (Test-Port $DefaultPort)) { exit 0 }

    # --- 3. Edge aperto ma porta chiusa: il toggle e' spento ----------------
    if (Get-Process -Name msedge -ErrorAction SilentlyContinue) {
        Write-HookMessage "Edge is running but the CDP port is closed: open edge://inspect/#remote-debugging and tick 'Allow remote debugging for this browser instance'."
        exit 0
    }

    # --- 2. Edge chiuso: avvialo e attendi la porta -------------------------
    $exe = Resolve-EdgeExe
    if (-not $exe) {
        Write-HookMessage "msedge.exe not found: browser-use cannot attach to a browser."
        exit 0
    }
    Start-Process -FilePath $exe | Out-Null

    $deadline = (Get-Date).AddSeconds($GraceSeconds)
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 500
        # Edge riscrive DevToolsActivePort all'avvio: rileggi la porta ogni giro
        if ((Test-Port (Get-CdpPort)) -or (Test-Port $DefaultPort)) {
            Write-HookMessage "Edge was not running: started it for browser-use (CDP port up)."
            exit 0
        }
    }
    Write-HookMessage "Started Edge, but the CDP port did not open within ${GraceSeconds}s: check edge://inspect/#remote-debugging."
    exit 0
}
catch {
    Write-HookMessage ("ensure-edge-cdp hook failed: {0}" -f $_.Exception.Message)
    exit 0
}
