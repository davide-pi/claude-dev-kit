#requires -Version 7.0
<#
.SYNOPSIS
  Engine di /worklog. Estrae dai transcript di Claude Code cosa e' stato fatto e
  quanto tempo e' stato speso, per (progetto, branch), su un PERIODO di date.

.DESCRIPTION
  - Legge le sessioni "principali" (esclude subagent/sidechain) da ~/.claude/projects.
  - Filtra gli eventi nel range [From, To] (timestamp UTC -> ora locale).
  - Attribuisce il tempo attivo per (progetto, branch) con una timeline globale:
    ogni intervallo <= IdleMinutes va al bucket su cui si stava lavorando; gli
    intervalli piu' lunghi (incluse le notti tra un giorno e l'altro) sono pause
    e non vengono conteggiati. Il branch git e' il proxy del "topic".
  - Scrive un digest grezzo in <OutDir>\_raw\<from>[_<to>].md (materiale per la
    narrazione) e stampa a stdout le metriche (numeri autorevoli del tempo).
  - Retention: al lancio pota (delete lazy) i digest e le voci di audit
    (pushed.json) piu' vecchie di RetentionDays. Nessuno scheduler: la pulizia
    avviene solo quando questo script gira.

  NON scrive tabelle finali ne' tocca Azure DevOps: quello lo fa Claude via SKILL.md.
#>
[CmdletBinding()]
param(
  [string]$From = '',    # '' = oggi | yyyy-MM-dd | 'yesterday'
  [string]$To   = '',    # '' = uguale a From
  # $HOME e' definito anche fuori da Windows: con USERPROFILE lo script non trovava nulla e usciva
  # con "Nessuna attivita'", indistinguibile da una giornata senza lavoro.
  [string]$ProjectsRoot = (Join-Path $HOME '.claude/projects'),
  [string]$OutDir       = (Join-Path $HOME '.claude/worklog'),
  [int]$IdleMinutes     = 15,
  [int]$RetentionDays   = 7,
  [int]$MaxPromptChars  = 400,
  [int]$MaxAsstChars    = 300,
  [int]$MaxLinesPerProj = 200
)

$ErrorActionPreference = 'Stop'

# ---- parsing range (locale) ----
function Resolve-Day([string]$s) {
  if     ($s -match '^\s*$')                 { return (Get-Date).Date }
  elseif ($s -match '^(?i)(yesterday|ieri)$'){ return (Get-Date).Date.AddDays(-1) }
  elseif ($s -match '^(?i)(today|oggi)$')    { return (Get-Date).Date }
  elseif ($s -match '^\d{4}-\d{2}-\d{2}$')   { return [datetime]::ParseExact($s,'yyyy-MM-dd',$null) }
  else   { throw "Data non valida: '$s'. Usa yyyy-MM-dd, 'yesterday'/'ieri' o vuoto (=oggi)." }
}
$fromD = Resolve-Day $From
$toD   = if ($To -match '^\s*$') { $fromD } else { Resolve-Day $To }
if ($toD -lt $fromD) { $tmp = $fromD; $fromD = $toD; $toD = $tmp }   # normalizza
$isRange = $fromD -ne $toD
$fromStr = $fromD.ToString('yyyy-MM-dd')
$toStr   = $toD.ToString('yyyy-MM-dd')
$slug    = if ($isRange) { "${fromStr}_${toStr}" } else { $fromStr }

# ---- cartelle ----
$rawDir = Join-Path $OutDir '_raw'
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
New-Item -ItemType Directory -Force -Path $rawDir | Out-Null

# ---- retention (delete lazy, al lancio) ----
$cutoff = (Get-Date).Date.AddDays(-$RetentionDays)
# 1) digest grezzi: pota per la data iniziale nel nome (yyyy-MM-dd o yyyy-MM-dd_yyyy-MM-dd)
Get-ChildItem $rawDir -Filter '*.md' -File -ErrorAction SilentlyContinue | ForEach-Object {
  if ($_.BaseName -match '^(\d{4}-\d{2}-\d{2})') {
    $d = [datetime]::ParseExact($matches[1],'yyyy-MM-dd',$null)
    if ($d -lt $cutoff) { Remove-Item $_.FullName -Force }
  }
}
# 2) audit pushed.json: pota le voci con periodTo (o period) piu' vecchie del cutoff
$auditPath = Join-Path $OutDir 'pushed.json'
if (Test-Path $auditPath) {
  try {
    $audit = Get-Content $auditPath -Raw -Encoding utf8 | ConvertFrom-Json
    $entries = @($audit.entries | Where-Object {
      $ref = if ($_.periodTo) { $_.periodTo } elseif ($_.period) { $_.period } else { $null }
      if (-not $ref) { $true } else {
        try { ([datetime]::ParseExact($ref,'yyyy-MM-dd',$null)) -ge $cutoff } catch { $true }
      }
    })
    if ($entries.Count -ne @($audit.entries).Count) {
      $audit.entries = $entries
      ($audit | ConvertTo-Json -Depth 10) | Set-Content -Path $auditPath -Encoding utf8
    }
  } catch { }   # audit corrotto/illeggibile: non bloccare l'engine
}

# ---- helper ----
function Clean([string]$s) {
  if (-not $s) { return '' }
  $s = [regex]::Replace($s,'(?s)<system-reminder>.*?</system-reminder>','')
  $s = [regex]::Replace($s,'(?s)<command-[^>]*>.*?</command-[^>]*>','')
  $s = [regex]::Replace($s,'(?s)<local-command-[^>]*>.*?</local-command-[^>]*>','')
  $s = ($s -replace '\s+',' ').Trim()
  return $s
}
function Trunc([string]$s,[int]$n) { if ($s.Length -le $n) { $s } else { $s.Substring(0,$n).TrimEnd() + '...' } }
function TextOf($content) {
  if ($null -eq $content) { return '' }
  if ($content -is [string]) { return $content }
  $parts = @()
  foreach ($b in $content) { if ($b.type -eq 'text' -and $b.text) { $parts += [string]$b.text } }
  return ($parts -join "`n")
}
function FmtMin([double]$m) {
  $m = [math]::Round($m); if ($m -lt 1 -and $m -gt 0) { $m = 1 }
  $h = [math]::Floor($m / 60); $r = $m % 60
  if ($h -gt 0) { "${h}h ${r}m" } else { "${r}m" }
}
function FmtStamp([datetime]$t) { if ($isRange) { $t.ToString('MM-dd HH:mm') } else { $t.ToString('HH:mm') } }

# ---- raccolta eventi ----
$events = [System.Collections.Generic.List[object]]::new()
$files = Get-ChildItem $ProjectsRoot -Recurse -Filter *.jsonl -File -ErrorAction SilentlyContinue |
         Where-Object { $_.FullName -notmatch '\\subagents\\' -and $_.LastWriteTime -ge $fromD }

foreach ($file in $files) {
  foreach ($line in [System.IO.File]::ReadLines($file.FullName)) {
    if (-not $line -or $line -notmatch '"timestamp"') { continue }
    try { $o = $line | ConvertFrom-Json } catch { continue }
    if (-not $o.timestamp) { continue }
    $ts = $o.timestamp
    if ($ts -is [datetime]) {
      switch ($ts.Kind) {
        'Utc'   { $local = $ts.ToLocalTime() }
        'Local' { $local = $ts }
        default { $local = [datetime]::SpecifyKind($ts,'Utc').ToLocalTime() }
      }
    } else { try { $local = ([datetime]$ts).ToLocalTime() } catch { continue } }
    if ($local.Date -lt $fromD -or $local.Date -gt $toD -or $o.isSidechain) { continue }
    if ($o.type -ne 'user' -and $o.type -ne 'assistant') { continue }
    $cwd = if ($o.cwd) { [string]$o.cwd } else { 'sconosciuto' }
    $branch = if ($o.gitBranch) { [string]$o.gitBranch } else { '(nessun-branch)' }
    if ($o.type -eq 'user') {
      $raw = TextOf $o.message.content   # anche i prompt a blocchi (immagini incollate) portano testo
      if ($raw -match '^\s*<(task-notification|local-command|command-name|command-message)' -or
          $raw -match '^\s*\[Request interrupted') { $text = '' } else { $text = Clean $raw }
    } else {
      $text = Clean (TextOf $o.message.content)
    }
    $events.Add([pscustomobject]@{
      Time = $local; Project = $cwd; Branch = $branch; Type = $o.type
      Text = $text; Session = [string]$o.sessionId
    })
  }
}

$rangeLabel = if ($isRange) { "$fromStr -> $toStr" } else { $fromStr }
if ($events.Count -eq 0) {
  Write-Output "=== WORKLOG $rangeLabel ==="
  Write-Output "Nessuna attivita' registrata in questo periodo."
  Set-Content -Path (Join-Path $rawDir "$slug.md") -Value "# Digest grezzo $rangeLabel`n`n_Nessuna attivita'._`n" -Encoding utf8
  return
}

# ---- tempo attivo per (progetto, branch): timeline globale ----
$sorted = $events | Sort-Object Time
$idle = [timespan]::FromMinutes($IdleMinutes)
$activeByPB = @{}
for ($i = 0; $i -lt $sorted.Count - 1; $i++) {
  $delta = $sorted[$i+1].Time - $sorted[$i].Time
  if ($delta -ge [timespan]::Zero -and $delta -le $idle) {
    $key = "$($sorted[$i].Project)`n$($sorted[$i].Branch)"
    if (-not $activeByPB.ContainsKey($key)) { $activeByPB[$key] = [double]0 }
    $activeByPB[$key] += $delta.TotalMinutes
  }
}

# ---- report per progetto -> branch ----
$projReport = foreach ($pg in ($events | Group-Object Project)) {
  $pe = @($pg.Group | Sort-Object Time)
  $branches = foreach ($bg in ($pe | Group-Object Branch)) {
    $be = @($bg.Group | Sort-Object Time)
    $key = "$($pg.Name)`n$($bg.Name)"
    $am = if ($activeByPB.ContainsKey($key)) { [double]$activeByPB[$key] } else { [double]0 }
    [pscustomobject]@{
      Branch    = $bg.Name
      ActiveMin = $am
      Prompts   = @($be | Where-Object { $_.Type -eq 'user' -and $_.Text -ne '' }).Count
      First     = $be[0].Time
      Last      = $be[-1].Time
      Sessions  = @($be | Select-Object -ExpandProperty Session -Unique).Count
      Events    = $be
    }
  }
  $branches = @($branches | Sort-Object ActiveMin -Descending)
  [pscustomobject]@{
    Project   = $pg.Name
    Leaf      = Split-Path $pg.Name -Leaf
    ActiveMin = ($branches | Measure-Object ActiveMin -Sum).Sum
    Prompts   = ($branches | Measure-Object Prompts -Sum).Sum
    First     = ($pe[0].Time)
    Last      = ($pe[-1].Time)
    Sessions  = @($pe | Select-Object -ExpandProperty Session -Unique).Count
    Branches  = $branches
  }
}
$projReport = @($projReport | Where-Object { $_.Prompts -gt 0 -or $_.ActiveMin -ge 1 })
$projReport = @($projReport | Sort-Object ActiveMin -Descending)
$totalMin = ($projReport | Measure-Object ActiveMin -Sum).Sum

# ---- stdout: metriche (numeri autorevoli) ----
Write-Output "=== WORKLOG $rangeLabel ==="
Write-Output ("Progetti: {0} | Tempo attivo totale: {1} | (pausa se gap > {2} min)" -f $projReport.Count, (FmtMin $totalMin), $IdleMinutes)
Write-Output ""
Write-Output ("{0,-34} {1,10} {2,-17} {3,6}" -f 'PROGETTO / topic (branch)','ATTIVO','FASCIA','PROMPT')
foreach ($p in $projReport) {
  Write-Output ("{0,-34} {1,10} {2,-17} {3,6}" -f (Trunc $p.Leaf 34), (FmtMin $p.ActiveMin), ("{0}-{1}" -f (FmtStamp $p.First),(FmtStamp $p.Last)), $p.Prompts)
  foreach ($b in $p.Branches) {
    Write-Output ("  |- {0,-29} {1,10} {2,-17} {3,6}" -f (Trunc $b.Branch 29), (FmtMin $b.ActiveMin), ("{0}-{1}" -f (FmtStamp $b.First),(FmtStamp $b.Last)), $b.Prompts)
  }
}

# ---- digest grezzo ----
$sb = [System.Text.StringBuilder]::new()
[void]$sb.AppendLine("# Digest grezzo - $rangeLabel")
[void]$sb.AppendLine("")
[void]$sb.AppendLine("Tempo attivo totale: **$(FmtMin $totalMin)** su $($projReport.Count) progetti. Soglia pausa: $IdleMinutes min.")
[void]$sb.AppendLine("Il branch git e' usato come topic. Il lavoro su 'master'/'HEAD' va spezzato in topic leggendo i contenuti.")
[void]$sb.AppendLine("")
foreach ($p in $projReport) {
  [void]$sb.AppendLine("## $($p.Leaf)")
  [void]$sb.AppendLine("``Path``: $($p.Project)")
  [void]$sb.AppendLine("Attivo ~$(FmtMin $p.ActiveMin) | $(FmtStamp $p.First)-$(FmtStamp $p.Last) | $($p.Prompts) prompt | $($p.Sessions) sessioni")
  [void]$sb.AppendLine("")
  $projLines = 0; $projTrunc = $false
  foreach ($b in $p.Branches) {
    if ($projLines -ge $MaxLinesPerProj) { $projTrunc = $true; break }
    [void]$sb.AppendLine("### topic (branch): $($b.Branch)  -  ~$(FmtMin $b.ActiveMin) | $($b.Prompts) prompt | $(FmtStamp $b.First)-$(FmtStamp $b.Last)")
    foreach ($e in @($b.Events | Where-Object { $_.Text -ne '' })) {
      if ($projLines -ge $MaxLinesPerProj) { $projTrunc = $true; break }
      if ($e.Type -eq 'user') {
        [void]$sb.AppendLine("- [$(FmtStamp $e.Time)] **TU:** $(Trunc $e.Text $MaxPromptChars)")
      } else {
        [void]$sb.AppendLine("- [$(FmtStamp $e.Time)] CC: $(Trunc $e.Text $MaxAsstChars)")
      }
      $projLines++
    }
    [void]$sb.AppendLine("")
  }
  if ($projTrunc) { [void]$sb.AppendLine("_(...righe successive troncate)_"); [void]$sb.AppendLine("") }
}
$rawPath = Join-Path $rawDir "$slug.md"
Set-Content -Path $rawPath -Value $sb.ToString() -Encoding utf8

Write-Output ""
Write-Output "Digest: $rawPath"
Write-Output "Audit push: $auditPath"
