#requires -Version 7.0
<#
.SYNOPSIS
  Arrotonda ciascun topic alla mezz'ora piu' vicina (indipendente, SENZA cap),
  con accorpamento dei micro-topic per RUOLO. Il totale = somma reale dei
  risultati (non forzato).

.DESCRIPTION
  Formato voce: "minuti|etichetta|ruolo" (il ruolo e' opzionale, default 'main').
  Ruoli:
   - main     : topic "vero". Riceve la redistribuzione dei donor e arrotonda
                normale: ore = round(minuti/30, AwayFromZero)/2.
   - donor    : micro-topic SENZA item dedicato. I suoi minuti finiscono in un
                pool spalmato EQUAMENTE su tutti i main; il topic non compare.
   - keep     : micro-topic CON un item dedicato. Resta a se' e va a MIN 0.5h.
   - internal : tempo interno/non fatturabile. Resta a se', arrotonda normale
                (puo' fare 0h), NON riceve il pool e NON viene spalmato.

  Regola arrotondamento: 45 min -> 1.0h (equidistante -> away-from-zero, non
  sempre floor). < ~15 min -> 0.0h. Le righe a 0.0h si mostrano ma non si loggano.

.EXAMPLE
  .\round.ps1 "35|company-config|main" "4|seed-fix|donor" "7|proc-fix|keep" "8|worklog|internal"
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0, ValueFromRemainingArguments = $true)]
  [string[]]$Items
)

$ErrorActionPreference = 'Stop'
if (-not $Items) { $Items = @($input) }
$Items = @($Items | Where-Object { $_ -match '\S' })
if ($Items.Count -eq 0) { throw "Nessun item. Passa voci 'minuti|etichetta|ruolo'." }

function RoundUnits([double]$min) { [int][math]::Round($min / 30, [System.MidpointRounding]::AwayFromZero) }
function FmtMin([double]$m) { $mm=[int][math]::Round($m); if ($mm -ge 60) { "{0}h{1:00}m" -f [math]::Floor($mm/60), ($mm%60) } else { "${mm}m" } }

$parsed = foreach ($it in $Items) {
  $p = $it -split '\|', 3
  $role = if ($p.Count -ge 3 -and $p[2].Trim()) { $p[2].Trim().ToLower() } else { 'main' }
  if ($role -notin @('main','donor','keep','internal')) { throw "Ruolo non valido: '$role' (usa main|donor|keep|internal)." }
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

# redistribuzione equa del pool sui main
$share = 0.0
if ($donors.Count -gt 0) {
  if ($mains.Count -eq 0) {
    Write-Warning "Ci sono donor ma nessun main: i donor restano come 'keep' (min 0.5h)."
    foreach ($d in $donors) { $d.Role = 'keep' }
    $donors = @(); $pool = 0
  } else {
    $share = $pool / $mains.Count
  }
}

# righe da mostrare (donor esclusi), ordinate per minuti effettivi desc
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
