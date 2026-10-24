#requires -Version 7.0
<#
.SYNOPSIS
  Read-only calibration report for /estimate: compares the estimates saved in HistoryDir with the hours
  actually logged once the estimated item is closed.

.DESCRIPTION
  Records are JSON files written by the model:
    { savedAt, sourceItemId, org, project, level, person, hoursPerDay,
      total: { p50, prudent, pct }, components: [ { name, p50, prudent } ] }
  The older shape (level under selection.level or result.level, total under result.total) is still read.
  For every record in HistoryDir that carries a sourceItemId:
  - the work item is read (az boards work-item show); when its state is in the Completed category of its
    type, the actual hours are the sum of CompletedWork over its descendant Tasks:
    backlog item -> Tasks; Feature -> backlog children -> Tasks. Flat WIQL by [System.Parent], always with
    [System.TeamProject], --org and -p. Tasks tagged 'estimation-excluded' (and children carrying the tag,
    with their Tasks) are skipped. A closed item with no logged hours is skipped with a warning.
  - row = { file, itemId, level, p50, prudent, actual, ratio = actual / p50, covered = actual <= prudent }.
  - Org and Project default to the ones stored in each record; the parameters override them.

  Output: JSON on stdout
    { records, closed, rows: [...], summary: { n, medianRatio, coverage,
      byLevel: { sufficient: { n, coverage, medianRatio }, scarce: { ... } } }, note }
  records = history files read; closed = rows. note says the report is informative only and is
  'campione insufficiente' when closed < 5. Nothing is applied and nothing is written to Azure DevOps or
  to HistoryDir: the factors are never changed from here.

.EXAMPLE
  .\calibrate.ps1 -HistoryDir "$HOME\.estimate-history"

.EXAMPLE
  .\calibrate.ps1 -HistoryDir .\history -Org 'https://dev.azure.com/<org>' -Project '<project>' -TaskType 'Task'
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$HistoryDir,
  [string]$Org      = '',                      # '' = the org stored in each record
  [string]$Project  = '',                      # '' = the project stored in each record
  [string]$TaskType = 'Task'
)

$ErrorActionPreference = 'Stop'

$ExcludeTag = 'estimation-excluded'
$ChunkSize  = 200
$MinSample  = 5

# ---- helpers ----
# stdout carries the JSON report: warnings go to stderr.
function Warn([string]$Message) { [Console]::Error.WriteLine("WARNING: $Message") }
function Esc([string]$s) { $s -replace "'", "''" }
function Num($v) { if ($null -eq $v -or "$v" -eq '') { 0.0 } else { [double]$v } }
function RoundTo($v, [int]$n) { if ($null -eq $v) { $null } else { [math]::Round([double]$v, $n) } }

function IsExcluded($tags) {
  if (-not $tags) { return $false }
  [bool](@(([string]$tags -split ';') | ForEach-Object { $_.Trim() }) | Where-Object { $_ -ieq $ExcludeTag })
}

function Median($Values) {
  $s = @($Values | Where-Object { $null -ne $_ } | Sort-Object)
  if ($s.Count -eq 0) { return $null }
  $m = [int][math]::Floor($s.Count / 2)
  if ($s.Count % 2 -eq 1) { [double]$s[$m] } else { ([double]$s[$m - 1] + [double]$s[$m]) / 2.0 }
}

function Invoke-Az([string[]]$AzArgs) {
  # az writes in the Windows ANSI code page, not UTF-8: decode it as such (restored after each call),
  # otherwise accented titles come back as mojibake.
  $prevEnc = [Console]::OutputEncoding
  $delays  = @(2, 5)
  try {
    try { [Console]::OutputEncoding = [System.Text.Encoding]::GetEncoding([cultureinfo]::CurrentCulture.TextInfo.ANSICodePage) } catch { }
    for ($attempt = 1; $attempt -le 3; $attempt++) {
      $raw  = & az @AzArgs 2>&1
      $code = $LASTEXITCODE
      if ($code -eq 0) { break }
      $err = (@($raw | Where-Object { $_ -is [System.Management.Automation.ErrorRecord] }) | ForEach-Object { $_.ToString() }) -join "`n"
      # throttling (429) and service errors (5xx) are retried; anything else fails at once
      if ($err -notmatch '\b(429|5\d\d)\b' -or $attempt -eq 3) {
        throw "az $($AzArgs[0..2] -join ' ') failed (exit $code): $err"
      }
      Start-Sleep -Seconds $delays[$attempt - 1]
    }
  } finally { try { [Console]::OutputEncoding = $prevEnc } catch { } }
  $text = (@($raw | Where-Object { $_ -isnot [System.Management.Automation.ErrorRecord] }) | ForEach-Object { [string]$_ }) -join "`n"
  if ($text -notmatch '\S') { return $null }
  $text | ConvertFrom-Json -Depth 20
}

function Invoke-Wiql([string]$OrgUrl, [string]$Proj, [string]$Wiql) {
  $r = Invoke-Az @('boards', 'query', '--org', $OrgUrl, '-p', $Proj, '--wiql', $Wiql, '-o', 'json')
  if ($null -eq $r) { return , @() }
  , @($r)
}

$completedCache = @{}   # "org|project|type" -> completed state names
function Get-CompletedStates([string]$OrgUrl, [string]$Proj, [string]$Type) {
  $key = "$OrgUrl|$Proj|$Type"
  if (-not $completedCache.ContainsKey($key)) {
    $r = Invoke-Az @('devops', 'invoke', '--org', $OrgUrl, '--area', 'wit', '--resource', 'workItemTypeStates',
                     '--route-parameters', "project=$Proj", "type=$Type", '-o', 'json')
    $completedCache[$key] = @(@($r.value) | Where-Object { $_.category -eq 'Completed' } | ForEach-Object { [string]$_.name })
  }
  $completedCache[$key]
}

function Split-Chunks([int[]]$Ids) {
  for ($i = 0; $i -lt $Ids.Count; $i += $ChunkSize) {
    , @($Ids[$i..([math]::Min($i + $ChunkSize, $Ids.Count) - 1)])
  }
}

# Sum of CompletedWork of the Tasks that are children of the given parents (excluded ones skipped).
function Get-TaskHours([string]$OrgUrl, [string]$Proj, [int[]]$ParentIds) {
  $sum = 0.0
  foreach ($chunk in (Split-Chunks $ParentIds)) {
    $w = "SELECT [System.Id],[System.Tags],[Microsoft.VSTS.Scheduling.CompletedWork] FROM WorkItems " +
         "WHERE [System.TeamProject] = '$(Esc $Proj)' AND [System.WorkItemType] = '$(Esc $TaskType)' " +
         "AND [System.Parent] IN ($($chunk -join ',')) AND [System.State] <> 'Removed'"
    foreach ($wi in (Invoke-Wiql $OrgUrl $Proj $w)) {
      if (IsExcluded ([string]$wi.fields.'System.Tags')) { continue }
      $sum += Num $wi.fields.'Microsoft.VSTS.Scheduling.CompletedWork'
    }
  }
  $sum
}

# Actual hours of an item: its Tasks, plus the Tasks of its backlog children (Feature case).
function Get-ActualHours([string]$OrgUrl, [string]$Proj, [int]$Id) {
  $w = "SELECT [System.Id],[System.WorkItemType],[System.Tags] FROM WorkItems " +
       "WHERE [System.TeamProject] = '$(Esc $Proj)' AND [System.Parent] = $Id AND [System.State] <> 'Removed'"
  $kids = Invoke-Wiql $OrgUrl $Proj $w
  if ($kids.Count -eq 0) { return 0.0 }
  # backlog children (Feature case) lend their Tasks too; an excluded child drops its Tasks with it
  $subIds = @($kids | Where-Object { [string]$_.fields.'System.WorkItemType' -ne $TaskType -and -not (IsExcluded ([string]$_.fields.'System.Tags')) } |
              ForEach-Object { [int]$_.id })
  Get-TaskHours $OrgUrl $Proj (@($Id) + $subIds)
}

# ---- records ----
if (-not (Test-Path -LiteralPath $HistoryDir)) { throw "HistoryDir not found: $HistoryDir" }
$files = @(Get-ChildItem -LiteralPath $HistoryDir -Filter '*.json' -File | Sort-Object Name)
$rows = [System.Collections.Generic.List[object]]::new()

foreach ($file in $files) {
  try { $rec = Get-Content -LiteralPath $file.FullName -Raw -Encoding utf8 | ConvertFrom-Json -Depth 30 }
  catch { Warn "$($file.Name): not valid JSON, skipped."; continue }
  if (-not $rec.PSObject.Properties['sourceItemId'] -or "$($rec.sourceItemId)" -notmatch '^\d+$') { continue }
  $id = [int]$rec.sourceItemId
  $orgUrl = $(if ($Org) { $Org } else { [string]$rec.org }).TrimEnd('/')
  $proj   = if ($Project) { $Project } else { [string]$rec.project }
  if (-not $orgUrl -or -not $proj) { Warn "$($file.Name): no org/project (record or parameters), skipped."; continue }

  try {
    $wi = Invoke-Az @('boards', 'work-item', 'show', '--id', "$id", '--org', $orgUrl, '-o', 'json')
    $f = $wi.fields
    if ([string]$f.'System.TeamProject' -ne $proj) {
      Warn "$($file.Name): item $id belongs to project '$($f.'System.TeamProject')', not '$proj': skipped."; continue
    }
    $type = [string]$f.'System.WorkItemType'
    if (@(Get-CompletedStates $orgUrl $proj $type) -notcontains [string]$f.'System.State') { continue }
    $actual = Get-ActualHours $orgUrl $proj $id
  }
  catch { Warn "$($file.Name): item $id not read ($($_.Exception.Message)); skipped."; continue }
  if ($actual -le 0) { Warn "$($file.Name): item $id is closed but has no logged hours: skipped."; continue }

  # record shape: { level, total: { p50, prudent } } written by the model; the old one nested them under
  # result (and selection.level) and is still read.
  $total = if ($rec.total) { $rec.total } elseif ($rec.result.total) { $rec.result.total } else { $null }
  $level = if ($rec.level) { $rec.level } elseif ($rec.result.level) { $rec.result.level } else { $rec.selection.level }
  $p50 = if ($total) { $total.p50 } else { $null }
  $prudent = if ($total) { $total.prudent } else { $null }
  $hasEst = $null -ne $p50 -and [double]$p50 -gt 0
  $rows.Add([ordered]@{
    file = $file.Name; itemId = $id; level = [string]$level
    p50 = $p50; prudent = $prudent; actual = RoundTo $actual 2
    ratio = if ($hasEst) { RoundTo ($actual / [double]$p50) 3 } else { $null }
    covered = if ($null -ne $prudent -and $hasEst) { $actual -le [double]$prudent } else { $null }
  })
}

# ---- summary ----
function Get-Stat($Rows) {
  $r = @($Rows)
  $cov = @($r | Where-Object { $null -ne $_.covered })
  [ordered]@{
    n = $r.Count
    coverage = if ($cov.Count -gt 0) { RoundTo (@($cov | Where-Object { $_.covered }).Count / $cov.Count) 3 } else { $null }
    medianRatio = RoundTo (Median ($r | ForEach-Object { $_.ratio })) 3
  }
}
$summary = Get-Stat $rows
$byLevel = [ordered]@{}
foreach ($lv in 'sufficient', 'scarce') { $byLevel[$lv] = Get-Stat @($rows | Where-Object { $_.level -eq $lv }) }
$summary.byLevel = $byLevel

$note = 'report only — not applied'
if ($rows.Count -lt $MinSample) { $note += '; campione insufficiente' }

[ordered]@{
  records = $files.Count; closed = $rows.Count; rows = @($rows); summary = $summary; note = $note
} | ConvertTo-Json -Depth 20
