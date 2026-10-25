#requires -Version 7.0
<#
.SYNOPSIS
  The only writer of hours: applies the rows confirmed in /worklog Table 2 to CompletedWork on
  Azure DevOps and to the /worklog audit, idempotently.

.DESCRIPTION
  -Rows is a JSON file holding an array of rows, of three kinds:

    hours   { "date" | "periodFrom"+"periodTo", "org", "project", "itemId", "hours", "topic",
              optional "delta", "state", "parentId", "created", "prs", "commits", "note", "overtime", "identity" }
            hours = the period's total on that item: what the audit records.
            delta = what is added to CompletedWork. Default: hours minus what the audit already holds for
            (periodFrom, periodTo, itemId). Pass it only for a reconciled row (0 when hours the user
            logged by hand already cover the work).
    close   { "date" | period, "itemId": null, "hours", "topic", optional "project", "sheet", "note" }
            closes a day in the audit without touching the board (nothing loggable, hours on a sheet).
    target  { "date", "targetHours", optional "note" }
            the day's expected hours (event, leave, course) into targets.json, read by the engine and
            by the reminder hook.

  An hours row: read CompletedWork, write current + delta (never an overwrite), optionally the state,
  read it back, then upsert the audit entry. The audit is saved after every row, so a crash never leaves
  a write the audit does not know. A failed row leaves its audit entry untouched; the exit code is then 1.
  -DryRun prints the plan from the audit alone: no az call, no file written.

  The az identity follows the row: "identity", else the workspaces.json root with the same org, else
  AZ_IDENTITY — as ~/.azure-<identity>, the per-org Azure CLI config dir. Never `az account set`.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$Rows,
  [switch]$DryRun,
  [string]$OutDir     = (Join-Path $HOME '.claude/worklog'),
  [string]$ConfigPath = (Join-Path $HOME '.claude/workspaces.json')
)

$ErrorActionPreference = 'Stop'
$auditPath   = Join-Path $OutDir 'pushed.json'
$targetsPath = Join-Path $OutDir 'targets.json'
$inv = [cultureinfo]::InvariantCulture
$cwField = 'Microsoft.VSTS.Scheduling.CompletedWork'

function Num([double]$h) { $h.ToString('0.##', $inv) }
function Signed([double]$h) { if ($h -ge 0) { '+' + (Num $h) } else { Num $h } }
function ReadJson([string]$p) { if (Test-Path $p) { Get-Content $p -Raw | ConvertFrom-Json } else { $null } }
function SaveJson([string]$p, $value) {
  New-Item -ItemType Directory -Force -Path (Split-Path $p) | Out-Null
  $tmp = "$p.tmp"
  Set-Content -Path $tmp -Value (ConvertTo-Json -InputObject $value -Depth 8) -Encoding utf8
  Move-Item -Path $tmp -Destination $p -Force
}
function Has($o, [string]$name) { $null -ne $o.PSObject.Properties[$name] -and $null -ne $o.$name }

$rowList = @(Get-Content $Rows -Raw | ConvertFrom-Json)
$audit = [System.Collections.Generic.List[object]]::new()
foreach ($e in @(ReadJson $auditPath)) { if ($e) { $audit.Add($e) } }
$roots = @((ReadJson $ConfigPath).roots)

function OrgUrl([string]$org) { if ($org -match '^https?://') { $org.TrimEnd('/') } else { "https://dev.azure.com/$org" } }
function IdentityDir($row) {
  $id = if (Has $row 'identity') { [string]$row.identity }
        else { @($roots | Where-Object { $_.identity -and "$($_.org)" -ieq "$($row.org)" } | ForEach-Object identity)[0] }
  if (-not $id) { $id = $env:AZ_IDENTITY }
  if (-not $id) { return $null }
  $dir = Join-Path $HOME ".azure-$id"
  if (Test-Path $dir) { $dir } else { $null }
}
function Invoke-Az([string[]]$AzArgs) {
  $all = & az @AzArgs --output json 2>&1
  $err = (@($all | Where-Object { $_ -is [System.Management.Automation.ErrorRecord] }) | ForEach-Object { "$_" }) -join ' '
  $out = (@($all | Where-Object { $_ -isnot [System.Management.Automation.ErrorRecord] })) -join "`n"
  if ($LASTEXITCODE -ne 0) { throw "az $($AzArgs[0..2] -join ' ') -> $err" }
  return ($out | ConvertFrom-Json)
}
function CompletedWorkOf($wi) { $v = $wi.fields.$cwField; if ($null -eq $v) { 0.0 } else { [double]$v } }

function Period($row) {
  if (Has $row 'date') { return @([string]$row.date, [string]$row.date) }
  $pf = [string]$row.periodFrom
  return @($pf, $(if (Has $row 'periodTo') { [string]$row.periodTo } else { $pf }))
}
function AuditIndex([string]$pf, [string]$pt, $itemId, [string]$topic) {
  for ($i = 0; $i -lt $audit.Count; $i++) {
    $e = $audit[$i]
    if ($e.periodFrom -ne $pf -or $e.periodTo -ne $pt) { continue }
    if ($null -ne $itemId) { if ("$($e.itemId)" -eq "$itemId") { return $i } }
    elseif ($null -eq $e.itemId -and $e.topic -eq $topic) { return $i }
  }
  return -1
}
function Upsert([int]$idx, [System.Collections.Specialized.OrderedDictionary]$entry) {
  if ($idx -ge 0) {
    $merged = [ordered]@{}
    foreach ($p in $audit[$idx].PSObject.Properties) { $merged[$p.Name] = $p.Value }
    foreach ($k in $entry.Keys) { $merged[$k] = $entry[$k] }
    $audit[$idx] = [pscustomobject]$merged
  } else {
    $defaults = @{ project = $null; created = $false; prs = @(); commits = @() }
    foreach ($k in $defaults.Keys) { if (-not $entry.Contains($k)) { $entry[$k] = $defaults[$k] } }
    $audit.Add([pscustomobject]$entry)
  }
  if (-not $DryRun) { SaveJson $auditPath $audit.ToArray() }
}
function EntryOf($row, [string]$pf, [string]$pt, $itemId) {
  $e = [ordered]@{ periodFrom = $pf; periodTo = $pt; topic = [string]$row.topic; mcp = 'cli' }
  # Optional keys only when the row carries them: a minimal re-run row must not wipe the
  # parent, the created flag or the links an earlier run recorded (Upsert merges over the entry).
  foreach ($k in 'project', 'parentId', 'created') { if (Has $row $k) { $e[$k] = $row.$k } }
  $e.itemId = $itemId
  $e.hoursLogged = [double]$row.hours
  foreach ($k in 'prs', 'commits') { if (Has $row $k) { $e[$k] = @($row.$k) } }
  $e.ts = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
  foreach ($k in 'note', 'sheet', 'overtime') { if (Has $row $k) { $e[$k] = $row.$k } }
  return $e
}

$report = [System.Collections.Generic.List[object]]::new()
$failed = 0; $n = 0
foreach ($row in $rowList) {
  $n++
  $r = [ordered]@{ N = $n; Tipo = ''; Item = '-'; Periodo = ''; Prima = ''; Delta = ''; Dopo = ''; Audit = ''; Esito = 'ok' }
  try {
    if (Has $row 'targetHours') {
      # ---- target: the day's expected hours ----
      $r.Tipo = 'target'; $r.Periodo = [string]$row.date
      if ($row.date -notmatch '^\d{4}-\d{2}-\d{2}$') { throw "target senza 'date' yyyy-MM-dd" }
      $t = ReadJson $targetsPath
      $days = [ordered]@{}
      if ($t -and $t.days) { foreach ($p in $t.days.PSObject.Properties) { $days[$p.Name] = $p.Value } }
      $days[[string]$row.date] = [ordered]@{ hours = [double]$row.targetHours; note = [string]$row.note }
      $r.Dopo = "$(Num $row.targetHours)h"; $r.Audit = 'targets.json'
      if (-not $DryRun) {
        SaveJson $targetsPath ([ordered]@{ targetHours = $(if ($t -and $null -ne $t.targetHours) { [double]$t.targetHours } else { 8 }); days = $days })
      }
      continue
    }

    $pf, $pt = Period $row
    $r.Periodo = if ($pf -eq $pt) { $pf } else { "$pf..$pt" }
    if ($pf -notmatch '^\d{4}-\d{2}-\d{2}$' -or $pt -notmatch '^\d{4}-\d{2}-\d{2}$') { throw "periodo mancante o non yyyy-MM-dd" }
    if (-not (Has $row 'hours')) { throw "'hours' mancante" }
    # Hours are always whole half-hours (round.ps1): anything else is a hand-made number.
    foreach ($k in 'hours', 'delta') {
      if ((Has $row $k) -and ([double]$row.$k * 2) % 1 -ne 0) { throw "'$k' = $($row.$k): non e' un multiplo di 0.5" }
    }

    if (-not (Has $row 'itemId')) {
      # ---- close: audit only ----
      $r.Tipo = 'chiusura'; $r.Dopo = "$(Num $row.hours)h"
      if (-not $row.topic) { throw "chiusura senza 'topic'" }
      $idx = AuditIndex $pf $pt $null ([string]$row.topic)
      Upsert $idx (EntryOf $row $pf $pt $null)
      $r.Audit = if ($idx -ge 0) { 'aggiornato' } else { 'nuovo' }
      continue
    }

    # ---- hours on an item ----
    $r.Tipo = 'ore'; $r.Item = "#$($row.itemId)"
    if (-not $row.org) { throw "'org' mancante" }
    $idx = AuditIndex $pf $pt $row.itemId $null
    $already = if ($idx -ge 0) { [double]$audit[$idx].hoursLogged } else { 0.0 }
    $delta = if (Has $row 'delta') { [double]$row.delta } else { [double]$row.hours - $already }
    $r.Delta = "$(Signed $delta)h"

    if ($DryRun) {
      $r.Prima = '?'; $r.Dopo = "? $(Signed $delta)h"
      $r.Audit = if ($idx -ge 0) { "gia' scritto $(Num $already)h" } else { 'nuovo' }
      continue
    }

    $saved = $env:AZURE_CONFIG_DIR
    $dir = IdentityDir $row
    if ($dir) { $env:AZURE_CONFIG_DIR = $dir }
    try {
      $org = OrgUrl $row.org
      $show = @('boards', 'work-item', 'show', '--id', "$($row.itemId)", '--org', $org)
      $before = CompletedWorkOf (Invoke-Az $show)
      $after = [math]::Round($before + $delta, 2)
      if ($after -lt 0) { throw "CompletedWork diventerebbe negativo ($(Num $before) $(Signed $delta))" }
      $fields = @()
      if ($delta -ne 0) { $fields += "$cwField=$(Num $after)" }
      if (Has $row 'state') { $fields += "System.State=$($row.state)" }
      if ($fields.Count) {
        Invoke-Az (@('boards', 'work-item', 'update', '--id', "$($row.itemId)", '--org', $org, '--fields') + $fields) | Out-Null
        $read = CompletedWorkOf (Invoke-Az $show)
        if ([math]::Abs($read - $after) -gt 0.001) { throw "riletto $(Num $read)h, atteso $(Num $after)h" }
      }
    } finally {
      $env:AZURE_CONFIG_DIR = $saved
    }
    $r.Prima = "$(Num $before)h"; $r.Dopo = "$(Num $after)h"
    Upsert $idx (EntryOf $row $pf $pt $row.itemId)
    $r.Audit = if ($idx -ge 0) { 'aggiornato' } else { 'nuovo' }
  } catch {
    $failed++
    $r.Esito = "ERRORE: $($_.Exception.Message)"
  } finally {
    $report.Add([pscustomobject]$r)
  }
}

if ($DryRun) { Write-Output "=== WORKLOG PUSH (dry run: nessuna scrittura) ===" } else { Write-Output "=== WORKLOG PUSH ===" }
$report | Format-Table -AutoSize | Out-String -Width 200 | Write-Output
Write-Output ("Righe: {0} | riuscite: {1} | fallite: {2}" -f $report.Count, ($report.Count - $failed), $failed)
Write-Output "Audit: $auditPath"
if ($failed) { exit 1 }
