#requires -Version 7.0
<#
.SYNOPSIS
  Rounds each topic to the nearest half hour (independent, NO cap), merging
  micro-topics by ROLE. The total = the real sum of the results (not forced).

.DESCRIPTION
  Item format: "minutes|label|role" (the role is optional, default 'main').
  Roles:
   - main     : a "real" topic. Receives the donors' redistribution and rounds
                normally: hours = round(minutes/30, AwayFromZero)/2.
   - donor    : micro-topic WITHOUT a dedicated item. Its minutes go into a
                pool spread EVENLY over all the mains; the topic does not appear.
   - keep     : micro-topic WITH a dedicated item. Stays on its own, MIN 0.5h.
   - internal : internal/non-billable time. Stays on its own, rounds normally
                (can be 0h), does NOT receive the pool and is NOT spread.

  Rounding rule: 45 min -> 1.0h (midpoint -> away-from-zero, not always
  floor). < ~15 min -> 0.0h. 0.0h rows are shown but not logged.

  Always prints the NON FATTURATO (internal + rounding loss and 0h rows).
  With -TargetHours (the day's target, from the engine's GIORNO table) it also prints the
  COPERTURA: loggable hours / target, what is missing, and whether the day is under target (< target - 1h).

.EXAMPLE
  .\round.ps1 -TargetHours 8 "35|company-config|main" "4|seed-fix|donor" "7|proc-fix|keep" "8|worklog|internal"
#>
[CmdletBinding()]
param(
  [double]$TargetHours = -1,
  [Parameter(Position = 0, ValueFromRemainingArguments = $true)]
  [string[]]$Items
)

$ErrorActionPreference = 'Stop'
if (-not $Items) { $Items = @($input) }
$Items = @($Items | Where-Object { $_ -match '\S' })
if ($Items.Count -eq 0) { throw "No items. Pass entries 'minutes|label|role'." }

function RoundUnits([double]$min) { [int][math]::Round($min / 30, [System.MidpointRounding]::AwayFromZero) }
function FmtMin([double]$m) { $mm=[int][math]::Round($m); if ($mm -ge 60) { "{0}h{1:00}m" -f [math]::Floor($mm/60), ($mm%60) } else { "${mm}m" } }

$parsed = foreach ($it in $Items) {
  $p = $it -split '\|', 3
  $role = if ($p.Count -ge 3 -and $p[2].Trim()) { $p[2].Trim().ToLower() } else { 'main' }
  if ($role -notin @('main','donor','keep','internal')) { throw "Invalid role: '$role' (use main|donor|keep|internal)." }
  [pscustomobject]@{
    Min   = [double]($p[0].Trim())
    Label = if ($p.Count -ge 2 -and $p[1].Trim()) { $p[1].Trim() } else { $p[0].Trim() }
    Role  = $role
  }
}

$mains  = @($parsed | Where-Object Role -eq 'main')
$donors = @($parsed | Where-Object Role -eq 'donor')
$pool   = ($donors | Measure-Object Min -Sum).Sum
if (-not $pool) { $pool = 0 }

# even redistribution of the pool over the mains
$share = 0.0
if ($donors.Count -gt 0) {
  if ($mains.Count -eq 0) {
    Write-Warning "There are donors but no main: the donors stay as 'keep' (min 0.5h)."
    foreach ($d in $donors) { $d.Role = 'keep' }
    $donors = @(); $pool = 0
  } else {
    $share = $pool / $mains.Count
  }
}

# rows to show (donors excluded), sorted by effective minutes desc
$rows = foreach ($p in ($parsed | Where-Object Role -ne 'donor')) {
  $eff = $p.Min + $(if ($p.Role -eq 'main') { $share } else { 0 })
  $units = RoundUnits $eff
  if ($p.Role -eq 'keep' -and $units -lt 1) { $units = 1 }   # min 0.5h
  [pscustomobject]@{ Label=$p.Label; Role=$p.Role; Min=$p.Min; Eff=$eff; Hours=$units/2 }
}

Write-Output ("{0,-40} {1,-9} {2,9} {3,9} {4,8}" -f 'TOPIC','RUOLO','MISURATO','+REDISTR','ARROT')
$tot = 0.0; $totLog = 0.0
foreach ($r in ($rows | Sort-Object Hours,Eff -Descending)) {
  $tot += $r.Hours
  if ($r.Hours -gt 0 -and $r.Role -ne 'internal') { $totLog += $r.Hours }
  $flag = if ($r.Hours -eq 0) { ' (non loggare)' } elseif ($r.Role -eq 'internal') { ' (interno)' } else { '' }
  $redis = if ($r.Role -eq 'main' -and $share -gt 0) { '+'+(FmtMin $share) } else { '' }
  Write-Output ("{0,-40} {1,-9} {2,9} {3,9} {4,7}h{5}" -f (($r.Label).Substring(0,[math]::Min(40,$r.Label.Length))), $r.Role, (FmtMin $r.Min), $redis, $r.Hours, $flag)
}
if ($donors.Count -gt 0) {
  Write-Output ""
  Write-Output ("Donor spalmati (pool {0} su {1} main = {2}/main):" -f (FmtMin $pool), $mains.Count, (FmtMin $share))
  foreach ($d in ($donors | Sort-Object Min -Descending)) { Write-Output ("  - {0} ({1})" -f $d.Label, (FmtMin $d.Min)) }
}
Write-Output ""
Write-Output ("{0,-40} {1,-9} {2,9} {3,9} {4,7}h" -f 'TOTALE (tutte le righe)','','','', $tot)
Write-Output ("{0,-40} {1,-9} {2,9} {3,9} {4,7}h" -f 'di cui LOGGABILE (no 0h/interni)','','','', $totLog)

# what the board will not see: internal rows, plus what rounding and the 0h rows dropped
$measured = ($parsed | Measure-Object Min -Sum).Sum
$internal = [double](@($parsed | Where-Object Role -eq 'internal') | Measure-Object Min -Sum).Sum
$roundDiff = ($measured - $internal) - $totLog * 60   # > 0 lost to rounding and 0h rows, < 0 rounded up
$excess = if ($roundDiff -lt 0) { "; arrotondato in eccesso +$(FmtMin (-$roundDiff))" } else { '' }
Write-Output ("NON FATTURATO: {0} (interni {1}, persi in arrotondamento e righe a 0h {2}{3})" -f `
  (FmtMin ($internal + [math]::Max(0, $roundDiff))), (FmtMin $internal), (FmtMin ([math]::Max(0, $roundDiff))), $excess)
if ($TargetHours -ge 0) {
  $under = if ($totLog -lt $TargetHours - 1) { ' - sotto target: domanda sul gap' } else { '' }
  Write-Output ("COPERTURA: {0}h / {1}h - mancano {2}h{3}" -f $totLog, $TargetHours, [math]::Max(0, $TargetHours - $totLog), $under)
}
