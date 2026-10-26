#requires -Version 7.0
<#
.SYNOPSIS
  /worklog engine: what was done in a period, how much active time it took per (project, branch),
  and how each day compares with its target.

.DESCRIPTION
  Points — the timelines — are the main-session user and assistant events: they carry the text of the
  digest and the topic (project + git branch) of every interval. Each logical session (the sessionId of
  the line; the file name when empty) has its own timeline; the active minutes of all sessions are SUMMED
  (two overlapping 1h sessions = 2h, so a day can exceed the wall clock).
  Resume dedup: a resumed transcript copies earlier messages (same uuid, same timestamp) under a new
  sessionId. A uuid is counted once, in the file that starts earliest (then created first, ends earliest, path).
  If session B carries copies of A's messages and A's last event is before B's first own event (a
  resume), B joins A's timeline (no double count, the gap at the resume point is kept). If A keeps
  working after B's first own event (a fork), only the duplicates are dropped: two timelines.
  Limit: when the first timestamps tie, the creation time of the file breaks the tie; it is unreliable
  after copies, sync or restores (then the head of a fork may land on the wrong file).
  Spans — work in flight that keeps a gap active even with no point inside it; per session (a span
  covers only gaps of the session that owns it: the tool_use line's, the turn's, or the <sessionId>
  directory above subagents/):
    strong  subagent activity (subagent events no more than IdleMinutes apart) and a foreground
            tool_use -> its tool_result (build, test, agent; interactive tools excluded);
    weak    run_in_background launch -> its <task-notification> (dev servers live here too) and a
            turn (system turn_duration, which also runs while background agents or the user are awaited).
  A gap between two consecutive points of the same session is active when
    gap <= IdleMinutes                                             base
    gap <= HardPauseMinutes and any span covers it                 wait
    gap <= HardPauseMinutes and the same topic (project + branch)  continuity
    gap <= SwitchMinutes (topic switch)                            continuity
    gap <= MaxSpanMinutes and a strong span covers it              wait
  otherwise it is a pause. Spans longer than MaxSpanMinutes are ignored. Counted waits longer than
  HardPauseMinutes are listed: a permission prompt left pending looks like a long tool call.
  Each interval goes to the bucket and the day of the point that opens it.

  Targets: <OutDir>/targets.json  { "targetHours": 8, "days": { "yyyy-MM-dd": 6 | { "hours": 6, "note": "..." } } }
  — written by worklog-push.ps1; missing means targetHours Monday-Friday and 0 at weekends.
  Logged: <OutDir>/pushed.json (the audit); a multi-day entry is split evenly over its weekdays.

  -SessionId <id> (case-insensitive; the raw id or the id its timeline resolves to) does not change the
  total, the active time or the topic minutes; a "Sessione" section lists the (day, topic) pairs with at
  least one main-session event of that session, each with the session's OWN minutes in that topic and
  day; a topic that also has events of another session is flagged "[anche altre sessioni]", and the
  digest lines of the session carry " [S]".
  Without it nothing changes. With -SessionId and no -From the period starts at the first day of the
  session (first timestamp of <ProjectsRoot>/*/<id>.jsonl) and ends today (or at -To); the script
  prints "Sessione <id>: dal <yyyy-MM-dd>". The session's own [S] lines and its branches' headers
  are never cut by -MaxLinesPerProj (they do not count toward it).

  Writes the raw digest to <OutDir>/_raw/<period>.md and prunes digests older than RetentionDays.
  Never prunes the audit, never touches Azure DevOps.
#>
[CmdletBinding()]
param(
  [string]$From = '',    # '' = today | yyyy-MM-dd | 'yesterday'/'ieri' (with -SessionId: the session's first day)
  [string]$To   = '',    # '' = same as From
  [string]$SessionId      = '',  # '' = off | a session id: list its topics with the session's own minutes
  # $HOME also exists off Windows: with USERPROFILE the script found nothing and printed
  # "Nessuna attivita'", indistinguishable from a day without work.
  [string]$ProjectsRoot   = (Join-Path $HOME '.claude/projects'),
  [string]$OutDir         = (Join-Path $HOME '.claude/worklog'),
  [int]$IdleMinutes       = 15,
  [int]$SwitchMinutes     = 20,
  [int]$HardPauseMinutes  = 45,
  [int]$MaxSpanMinutes    = 120,
  [int]$RetentionDays     = 7,
  [int]$MaxPromptChars    = 400,
  [int]$MaxAsstChars      = 300,
  [int]$MaxLinesPerProj   = 200
)

$ErrorActionPreference = 'Stop'

# ---- range (local days) ----
function Resolve-Day([string]$s) {
  if     ($s -match '^\s*$')                  { return (Get-Date).Date }
  elseif ($s -match '^(?i)(yesterday|ieri)$') { return (Get-Date).Date.AddDays(-1) }
  elseif ($s -match '^(?i)(today|oggi)$')     { return (Get-Date).Date }
  elseif ($s -match '^\d{4}-\d{2}-\d{2}$')    { return [datetime]::ParseExact($s, 'yyyy-MM-dd', $null) }
  else   { throw "Data non valida: '$s'. Usa yyyy-MM-dd, 'yesterday'/'ieri' o vuoto (=oggi)." }
}
$fromD = Resolve-Day $From
$sid = $SessionId.Trim()
$sessionFirstDay = $null
if ($sid -and $From -match '^\s*$') {
  # the session's first day: the first timestamp of its transcript(s), id compared case-insensitively
  $tsFirst = [regex]::new('"timestamp":"(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z)"')
  $firsts = foreach ($dir in Get-ChildItem $ProjectsRoot -Directory -ErrorAction SilentlyContinue) {
    foreach ($f in Get-ChildItem $dir.FullName -Filter *.jsonl -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -ieq "$sid.jsonl" }) {
      # opened and closed explicitly: a foreach over ReadLines abandoned by break keeps the handle (and the
      # running chat's transcript unwritable) until the GC; ReadWrite share lets Claude Code keep appending
      $sr = [System.IO.StreamReader]::new([System.IO.FileStream]::new($f.FullName, 'Open', 'Read', 'ReadWrite'))
      try {
        while ($null -ne ($line = $sr.ReadLine())) {
          $m = $tsFirst.Match($line)
          if ($m.Success) { [datetime]::Parse($m.Groups[1].Value, [cultureinfo]::InvariantCulture, 'RoundtripKind').ToLocalTime().Date; break }
        }
      } finally { $sr.Dispose() }
    }
  }
  if ($firsts) { $sessionFirstDay = ($firsts | Sort-Object | Select-Object -First 1); $fromD = $sessionFirstDay }
}
$toD   = if ($To -match '^\s*$') { if ($sessionFirstDay) { (Get-Date).Date } else { $fromD } } else { Resolve-Day $To }
if ($toD -lt $fromD) { $tmp = $fromD; $fromD = $toD; $toD = $tmp }
$isRange = $fromD -ne $toD
$fromStr = $fromD.ToString('yyyy-MM-dd')
$toStr   = $toD.ToString('yyyy-MM-dd')
$sessionDal = if ($sessionFirstDay) { "Sessione ${sid}: dal $($sessionFirstDay.ToString('yyyy-MM-dd'))" } else { $null }
$slug    = if ($isRange) { "${fromStr}_${toStr}" } else { $fromStr }

# ---- folders and retention (lazy delete, at launch; no scheduler) ----
$rawDir = Join-Path $OutDir '_raw'
New-Item -ItemType Directory -Force -Path $rawDir | Out-Null
$cutoff = (Get-Date).Date.AddDays(-$RetentionDays)
Get-ChildItem $rawDir -Filter '*.md' -File -ErrorAction SilentlyContinue | ForEach-Object {
  if ($_.BaseName -match '^(\d{4}-\d{2}-\d{2})' -and [datetime]::ParseExact($matches[1], 'yyyy-MM-dd', $null) -lt $cutoff) {
    Remove-Item $_.FullName -Force
  }
}
# The audit is never pruned: it is the only memory of which hours reached the board, and the
# reminder hook (worklog-pending.js) reads it to tell which worked days were never logged.
$auditPath   = Join-Path $OutDir 'pushed.json'
$targetsPath = Join-Path $OutDir 'targets.json'

# ---- helpers ----
function Clean([string]$s) {
  if (-not $s) { return '' }
  $s = [regex]::Replace($s, '(?s)<system-reminder>.*?</system-reminder>', '')
  $s = [regex]::Replace($s, '(?s)<command-[^>]*>.*?</command-[^>]*>', '')
  $s = [regex]::Replace($s, '(?s)<local-command-[^>]*>.*?</local-command-[^>]*>', '')
  return ($s -replace '\s+', ' ').Trim()
}
function Trunc([string]$s, [int]$n) { if ($s.Length -le $n) { $s } else { $s.Substring(0, $n).TrimEnd() + '...' } }
function TextOf($content) {
  if ($null -eq $content) { return '' }
  if ($content -is [string]) { return $content }
  $parts = foreach ($b in $content) { if ($b.type -eq 'text' -and $b.text) { [string]$b.text } }
  return (@($parts) -join "`n")
}
function FmtMin([double]$m) {
  $m = [math]::Round($m); if ($m -lt 1 -and $m -gt 0) { $m = 1 }
  $h = [math]::Floor($m / 60); $r = $m % 60
  if ($h -gt 0) { "${h}h ${r}m" } else { "${r}m" }
}
function FmtStamp([datetime]$t) { if ($isRange) { $t.ToString('MM-dd HH:mm') } else { $t.ToString('HH:mm') } }
function FmtH([double]$h) { ('{0:0.##}h' -f $h) }
function ToLocal([string]$iso) { [datetime]::Parse($iso, [cultureinfo]::InvariantCulture, 'RoundtripKind').ToLocalTime() }
function ReadJson([string]$p) {
  if (-not (Test-Path $p)) { return $null }
  try { return (Get-Content $p -Raw | ConvertFrom-Json) } catch { return $null }
}

# ---- scan: one regex on the timestamp before any JSON parse (the transcripts weigh hundreds of MB) ----
$tsRx  = [regex]::new('"timestamp":"(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z)"', 'Compiled')
$tuRx  = [regex]::new('<tool-use-id>(toolu_\w+)</tool-use-id>', 'Compiled')
$loIso = $fromD.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss')
$hiIso = $toD.AddDays(1).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss')
$interactive = @('AskUserQuestion', 'ExitPlanMode', 'EnterPlanMode')   # waiting on the user is not work in flight

$events    = [System.Collections.Generic.List[object]]::new()
$spans     = [System.Collections.Generic.List[object]]::new()   # { Session, Start, End, Strong } local datetimes
$toolStart = @{}; $toolEnd = @{}; $bgEnd = @{}
# Pass 1 keeps every line's contribution; the resume dedup (below) decides which ones count before any event or span is built.
$recs = [System.Collections.Generic.List[object]]::new()
$fileFirst = @{}; $fileLast = @{}; $fileBorn = @{}

$files = Get-ChildItem $ProjectsRoot -Recurse -Filter *.jsonl -File -ErrorAction SilentlyContinue |
         Where-Object { $_.LastWriteTime -ge $fromD }

foreach ($file in $files) {
  $fileBorn[$file.FullName] = $file.CreationTimeUtc
  $isSub = $file.FullName -match '[\\/]subagents[\\/]'
  $fileKey = [System.IO.Path]::GetFileNameWithoutExtension($file.Name)
  $subSession = if ($isSub -and $file.FullName -match '[\\/]([^\\/]+)[\\/]subagents[\\/]') { $matches[1] } else { $fileKey }
  $subTimes = [System.Collections.Generic.List[datetime]]::new()
  foreach ($line in [System.IO.File]::ReadLines($file.FullName)) {
    $m = $tsRx.Match($line)
    if (-not $m.Success) { continue }
    $iso = $m.Groups[1].Value
    if ([string]::CompareOrdinal($iso, $loIso) -lt 0 -or [string]::CompareOrdinal($iso, $hiIso) -ge 0) { continue }
    if ($isSub) { $subTimes.Add((ToLocal $iso)); continue }
    if (-not ($line.Contains('"type":"user"') -or $line.Contains('"type":"assistant"') -or
              $line.Contains('"subtype":"turn_duration"') -or $line.Contains('"type":"queue-operation"'))) { continue }
    try { $o = $line | ConvertFrom-Json } catch { continue }
    if (-not $o.timestamp -or $o.isSidechain) { continue }
    $ts = $o.timestamp   # ConvertFrom-Json may already have turned it into a DateTime, of any Kind
    $local = if ($ts -isnot [datetime]) { ToLocal ([string]$ts) }
             elseif ($ts.Kind -eq 'Local') { $ts }
             else { [datetime]::SpecifyKind($ts, 'Utc').ToLocalTime() }
    if ($local.Date -lt $fromD -or $local.Date -gt $toD) { continue }

    # the session key is the line's sessionId (a file may hold several); no id -> the file's own name
    $sess = if ($o.sessionId) { [string]$o.sessionId } else { $fileKey }
    $rec = [pscustomobject]@{ File = $file.FullName; Uuid = [string]$o.uuid; Session = $sess; Time = $local
                              Ev = $null; TurnMs = 0.0; Starts = @(); Ends = @(); Bgs = @() }
    if (-not $fileFirst.ContainsKey($rec.File) -or $local -lt $fileFirst[$rec.File]) { $fileFirst[$rec.File] = $local }
    if (-not $fileLast.ContainsKey($rec.File)  -or $local -gt $fileLast[$rec.File])  { $fileLast[$rec.File]  = $local }

    if ($o.type -eq 'system') {
      if ($o.subtype -eq 'turn_duration' -and $o.durationMs -gt 0) { $rec.TurnMs = [double]$o.durationMs; $recs.Add($rec) }
      continue
    }
    if ($o.type -eq 'queue-operation') {
      if ($o.content -is [string] -and $o.content.Contains('<task-notification>')) {
        $rec.Bgs = @(foreach ($tm in $tuRx.Matches($o.content)) { $tm.Groups[1].Value }); $recs.Add($rec)
      }
      continue
    }
    if ($o.type -ne 'user' -and $o.type -ne 'assistant') { continue }

    $content = $o.message.content
    if ($content -isnot [string]) {
      foreach ($b in @($content)) {
        if ($b.type -eq 'tool_use' -and $b.id -and $b.name -notin $interactive) {
          $rec.Starts += [pscustomobject]@{ Id = $b.id; Bg = [bool]$b.input.run_in_background }
        } elseif ($b.type -eq 'tool_result' -and $b.tool_use_id) {
          $rec.Ends += $b.tool_use_id
        }
      }
    }
    $cwd    = if ($o.cwd) { [string]$o.cwd } else { 'sconosciuto' }
    $branch = if ($o.gitBranch) { [string]$o.gitBranch } else { '(nessun-branch)' }
    if ($o.type -eq 'user') {
      $raw = TextOf $content   # block prompts (pasted images) carry text too
      if ($raw.Contains('<task-notification>')) { $rec.Bgs = @(foreach ($tm in $tuRx.Matches($raw)) { $tm.Groups[1].Value }) }
      $text = if ($raw -match '^\s*<(task-notification|local-command|command-name|command-message)' -or
                  $raw -match '^\s*\[Request interrupted') { '' } else { Clean $raw }
    } else {
      $text = Clean (TextOf $content)
    }
    $rec.Ev = [pscustomobject]@{
      Time = $local; Project = $cwd; Branch = $branch; Type = $o.type; Text = $text; Session = $sess; Raw = $sess
    }
    $recs.Add($rec)
  }
  # subagent activity -> spans: runs of events no more than IdleMinutes apart, tagged with the session directory
  if ($subTimes.Count -gt 0) {
    $st = @($subTimes | Sort-Object)
    $segStart = $st[0]; $prev = $st[0]
    foreach ($t in $st) {
      if (($t - $prev).TotalMinutes -gt $IdleMinutes) { $spans.Add([pscustomobject]@{ Session = $subSession; Start = $segStart; End = $prev; Strong = $true }); $segStart = $t }
      $prev = $t
    }
    $spans.Add([pscustomobject]@{ Session = $subSession; Start = $segStart; End = $prev; Strong = $true })
  }
}

# ---- resume dedup: a resumed transcript copies earlier messages (same uuid and timestamp) under a new sessionId ----
# The copy belongs to the file that starts earliest (then was created first: a fork starts with the same timestamps as its original, then ends earliest, then path): its lines are dropped everywhere.
$fileRank = @{}; $rankN = 0
foreach ($k in ($fileFirst.Keys | Sort-Object { $fileFirst[$_] }, { $fileBorn[$_] }, { $fileLast[$_] }, { $_ })) { $fileRank[$k] = $rankN++ }
$owner = @{}
foreach ($r in $recs) {
  if (-not $r.Uuid) { continue }
  if (-not $owner.ContainsKey($r.Uuid) -or $fileRank[$r.File] -lt $fileRank[$owner[$r.Uuid].File]) { $owner[$r.Uuid] = $r }
}
$copies = @{}   # session of the copy -> session of the original -> messages copied
foreach ($r in $recs) {
  if ($r.Uuid -and $owner[$r.Uuid].File -ne $r.File) {
    if ($r.Ev -and $owner[$r.Uuid].Session -ne $r.Session) {
      if (-not $copies.ContainsKey($r.Session)) { $copies[$r.Session] = @{} }
      $copies[$r.Session][$owner[$r.Uuid].Session] = [int]$copies[$r.Session][$owner[$r.Uuid].Session] + 1
    }
    continue
  }
  foreach ($s in $r.Starts) { $toolStart[$s.Id] = [pscustomobject]@{ Time = $r.Time; Bg = $s.Bg; Session = $r.Session } }
  foreach ($id in $r.Ends) { $toolEnd[$id] = $r.Time }
  foreach ($id in $r.Bgs) { if (-not $bgEnd.ContainsKey($id)) { $bgEnd[$id] = $r.Time } }
  if ($r.TurnMs -gt 0) { $spans.Add([pscustomobject]@{ Session = $r.Session; Start = $r.Time.AddMilliseconds(-$r.TurnMs); End = $r.Time; Strong = $false }) }
  if ($r.Ev) { $events.Add($r.Ev) }
}

# tool and background spans, tagged with the session of the tool_use line
foreach ($id in $toolStart.Keys) {
  $s = $toolStart[$id]
  $end = if ($s.Bg -and $bgEnd.ContainsKey($id)) { $bgEnd[$id] } elseif ($toolEnd.ContainsKey($id)) { $toolEnd[$id] } else { $null }
  if ($end -and $end -gt $s.Time) { $spans.Add([pscustomobject]@{ Session = $s.Session; Start = $s.Time; End = $end; Strong = -not $s.Bg }) }
}

# alias: B copies A's messages and A ended before B's first own event (a resume) -> one timeline, under A's id.
# A still working after B's first own event is a fork: only the duplicates are dropped, two timelines.
$first = @{}; $last = @{}
foreach ($e in $events) {
  if (-not $first.ContainsKey($e.Raw) -or $e.Time -lt $first[$e.Raw]) { $first[$e.Raw] = $e.Time }
  if (-not $last.ContainsKey($e.Raw)  -or $e.Time -gt $last[$e.Raw])  { $last[$e.Raw]  = $e.Time }
}
$alias = @{}; $groupLast = @{}
foreach ($k in $last.Keys) { $groupLast[$k] = $last[$k] }
function Rep([string]$s) { while ($alias.ContainsKey($s)) { $s = $alias[$s] }; return $s }
foreach ($bs in @($copies.Keys | Where-Object { $first.ContainsKey($_) } | Sort-Object { $first[$_] })) {
  $best = $null; $bestN = 0
  foreach ($as in $copies[$bs].Keys) {
    $rep = Rep $as
    if ($rep -eq $bs -or -not $groupLast.ContainsKey($rep)) { continue }
    if ($groupLast[$rep] -le $first[$bs] -and $copies[$bs][$as] -gt $bestN) { $best = $rep; $bestN = $copies[$bs][$as] }
  }
  if ($best) {
    $alias[$bs] = $best
    if ($last[$bs] -gt $groupLast[$best]) { $groupLast[$best] = $last[$bs] }
  }
}
foreach ($e in $events) { $e.Session = Rep $e.Raw }
foreach ($sp in $spans) { $sp.Session = Rep $sp.Session }

$rangeLabel = if ($isRange) { "$fromStr -> $toStr" } else { $fromStr }
if ($events.Count -eq 0) {
  Write-Output "=== WORKLOG $rangeLabel ==="
  if ($sid) {
    if ($sessionDal) { Write-Output $sessionDal }
    Write-Output "Sessione ${sid}: nessun evento in questo periodo."
  }
  Write-Output "Nessuna attivita' registrata in questo periodo."
  Set-Content -Path (Join-Path $rawDir "$slug.md") -Value "# Digest grezzo $rangeLabel`n`n_Nessuna attivita'._`n" -Encoding utf8
  return
}

# ---- unions of spans (all, strong only): drop the implausible, merge what overlaps or nearly touches ----
function Union($list) {
  $merged = [System.Collections.Generic.List[object]]::new()
  foreach ($sp in ($list | Where-Object { ($_.End - $_.Start).TotalMinutes -le $MaxSpanMinutes } | Sort-Object Start)) {
    if ($merged.Count -gt 0 -and ($sp.Start - $merged[-1].End).TotalMinutes -le 1) {
      if ($sp.End -gt $merged[-1].End) { $merged[-1].End = $sp.End }
    } else {
      $merged.Add([pscustomobject]@{ Start = $sp.Start; End = $sp.End })
    }
  }
  return [pscustomobject]@{ Starts = [datetime[]]@($merged | ForEach-Object Start); Spans = $merged }
}
# per session: a span of one session never covers a gap of another
$anySpan = @{}; $strongSpan = @{}
foreach ($sg in ($spans | Group-Object Session)) {
  $anySpan[$sg.Name]    = Union $sg.Group
  $strongSpan[$sg.Name] = Union @($sg.Group | Where-Object Strong)
}
$noSpan = Union @()
function Covered($u, [datetime]$a, [datetime]$b) {
  # the last merged span starting at or before a (1 min tolerance): does it reach b?
  $lo = 0; $hi = $u.Starts.Count - 1; $idx = -1; $limit = $a.AddMinutes(1)
  while ($lo -le $hi) {
    $mid = [int][math]::Floor(($lo + $hi) / 2)
    if ($u.Starts[$mid] -le $limit) { $idx = $mid; $lo = $mid + 1 } else { $hi = $mid - 1 }
  }
  return ($idx -ge 0 -and $u.Spans[$idx].End -ge $b.AddMinutes(-1))
}

# ---- active time: one timeline per session, summed (two overlapping 1h sessions = 2h) ----
$activeByPB = @{}; $activeByPBDay = @{}; $activeByDay = @{}; $recoveredByDay = @{}
$activeBySPBDay = @{}   # session`nday`nproject`nbranch: the session's own minutes
$recovered = @{ wait = 0.0; cont = 0.0 }
$longWaits = [System.Collections.Generic.List[object]]::new()
foreach ($sg in ($events | Group-Object Session)) {
  $sorted = @($sg.Group | Sort-Object Time)
  $anyU    = if ($anySpan.ContainsKey($sg.Name)) { $anySpan[$sg.Name] } else { $noSpan }
  $strongU = if ($strongSpan.ContainsKey($sg.Name)) { $strongSpan[$sg.Name] } else { $noSpan }
  for ($i = 0; $i -lt $sorted.Count - 1; $i++) {
    $a = $sorted[$i]; $b = $sorted[$i + 1]
    $g = ($b.Time - $a.Time).TotalMinutes
    if ($g -lt 0) { continue }
    $sameTopic = $a.Project -eq $b.Project -and $a.Branch -eq $b.Branch
    $reason = if ($g -le $IdleMinutes) { 'base' }
              elseif ($sameTopic -and $g -le $HardPauseMinutes) { 'cont' }
              elseif ($g -le $HardPauseMinutes -and (Covered $anyU $a.Time $b.Time)) { 'wait' }
              elseif ($g -le $SwitchMinutes) { 'cont' }
              elseif ($g -gt $HardPauseMinutes -and $g -le $MaxSpanMinutes -and (Covered $strongU $a.Time $b.Time)) { 'wait' }
              else { $null }
    if (-not $reason) { continue }
    $key = "$($a.Project)`n$($a.Branch)"
    $day = $a.Time.ToString('yyyy-MM-dd')
    $activeByPB[$key] = [double]$activeByPB[$key] + $g
    $activeByPBDay["$day`n$key"] = [double]$activeByPBDay["$day`n$key"] + $g
    $activeBySPBDay["$($sg.Name)`n$day`n$key"] = [double]$activeBySPBDay["$($sg.Name)`n$day`n$key"] + $g
    $activeByDay[$day] = [double]$activeByDay[$day] + $g
    if ($reason -ne 'base') {
      $recovered[$reason] += $g
      $recoveredByDay[$day] = [double]$recoveredByDay[$day] + $g
      if ($reason -eq 'wait' -and $g -gt $HardPauseMinutes) {
        $longWaits.Add([pscustomobject]@{ From = $a.Time; To = $b.Time; Min = $g; Where = "$(Split-Path $a.Project -Leaf) / $($a.Branch)" })
      }
    }
  }
}

# ---- report per project -> branch ----
$projReport = foreach ($pg in ($events | Group-Object Project)) {
  $pe = @($pg.Group | Sort-Object Time)
  $branches = foreach ($bg in ($pe | Group-Object Branch)) {
    $be = @($bg.Group | Sort-Object Time)
    [pscustomobject]@{
      Branch    = $bg.Name
      ActiveMin = [double]$activeByPB["$($pg.Name)`n$($bg.Name)"]
      Prompts   = @($be | Where-Object { $_.Type -eq 'user' -and $_.Text -ne '' }).Count
      First     = $be[0].Time
      Last      = $be[-1].Time
      Events    = $be
    }
  }
  $branches = @($branches | Sort-Object ActiveMin -Descending)
  [pscustomobject]@{
    Project   = $pg.Name
    Leaf      = Split-Path $pg.Name -Leaf
    ActiveMin = ($branches | Measure-Object ActiveMin -Sum).Sum
    Prompts   = ($branches | Measure-Object Prompts -Sum).Sum
    First     = $pe[0].Time
    Last      = $pe[-1].Time
    Sessions  = @($pe | Select-Object -ExpandProperty Session -Unique).Count
    Branches  = $branches
  }
}
$projReport = @($projReport | Where-Object { $_.Prompts -gt 0 -or $_.ActiveMin -ge 1 } | Sort-Object ActiveMin -Descending)
$totalMin = ($projReport | Measure-Object ActiveMin -Sum).Sum

# ---- the session's topics: (day, project, branch) with a main-session event of -SessionId ----
$sessionTopics = @(); $sharedTopics = @{}; $sidReps = @{}
# -SessionId matches the raw id or its representative (a resumed session shares its original's timeline)
function IsMine($e) { return ($sid -and ($e.Raw -ieq $sid -or $e.Session -ieq $sid)) }
if ($sid) {
  foreach ($e in $events) { if (IsMine $e) { $sidReps[$e.Session] = $true } }
  # a (day, topic) that also has events of another timeline: not the chat's alone
  foreach ($e in $events) { if (-not $sidReps.ContainsKey($e.Session)) { $sharedTopics["$($e.Time.ToString('yyyy-MM-dd'))`n$($e.Project)`n$($e.Branch)"] = $true } }
  $sessionTopics = @($events | Where-Object { IsMine $_ } | ForEach-Object {
    [pscustomobject]@{ Day = $_.Time.ToString('yyyy-MM-dd'); Project = $_.Project; Branch = $_.Branch }
  } | Sort-Object Day, Project, Branch -Unique)
}
$sessionBranches = @{}
foreach ($t in $sessionTopics) { $sessionBranches["$($t.Project)`n$($t.Branch)"] = $true }

# ---- per-day target and hours already logged ----
$targets = ReadJson $targetsPath
$defaultTarget = if ($null -ne $targets.targetHours) { [double]$targets.targetHours } else { 8.0 }
function TargetOf([datetime]$d) {
  $o = if ($targets -and $targets.days) { $targets.days.($d.ToString('yyyy-MM-dd')) } else { $null }
  if ($null -ne $o) { if ($o.PSObject.Properties['hours']) { return [double]$o.hours } else { return [double]$o } }
  if ($d.DayOfWeek -in 'Saturday', 'Sunday') { return 0.0 }
  return $defaultTarget
}
$loggedByDay = @{}
foreach ($e in @(ReadJson $auditPath)) {
  if (-not $e) { continue }
  $pf = if ($e.periodFrom) { $e.periodFrom } else { $e.period }
  if (-not $pf) { continue }
  $pt = if ($e.periodTo) { $e.periodTo } else { $pf }
  $d0 = [datetime]::ParseExact([string]$pf, 'yyyy-MM-dd', $null); $d1 = [datetime]::ParseExact([string]$pt, 'yyyy-MM-dd', $null)
  $all = @(for ($d = $d0; $d -le $d1; $d = $d.AddDays(1)) { $d })
  $work = @($all | Where-Object { $_.DayOfWeek -notin 'Saturday', 'Sunday' })
  $over = if ($work.Count) { $work } else { $all }
  foreach ($d in $over) { $k = $d.ToString('yyyy-MM-dd'); $loggedByDay[$k] = [double]$loggedByDay[$k] + [double]$e.hoursLogged / $over.Count }
}

# ---- stdout: the authoritative numbers ----
Write-Output "=== WORKLOG $rangeLabel ==="
Write-Output ("Progetti: {0} | Tempo attivo totale: {1} | di cui recuperati: attese tool/agent {2}, continuita' {3}" -f `
  $projReport.Count, (FmtMin $totalMin), (FmtMin $recovered.wait), (FmtMin $recovered.cont))
Write-Output ("Pausa: gap > {0} min stesso topic, > {1} min cambio topic senza attese in corso; oltre {0} min attivo solo con agent/tool in primo piano al lavoro (max {2} min)" -f `
  $HardPauseMinutes, $SwitchMinutes, $MaxSpanMinutes)
Write-Output ""
Write-Output ("{0,-34} {1,10} {2,-17} {3,6}" -f 'PROGETTO / topic (branch)', 'ATTIVO', 'FASCIA', 'PROMPT')
foreach ($p in $projReport) {
  Write-Output ("{0,-34} {1,10} {2,-17} {3,6}" -f (Trunc $p.Leaf 34), (FmtMin $p.ActiveMin), ("{0}-{1}" -f (FmtStamp $p.First), (FmtStamp $p.Last)), $p.Prompts)
  foreach ($b in $p.Branches) {
    Write-Output ("  |- {0,-29} {1,10} {2,-17} {3,6}" -f (Trunc $b.Branch 29), (FmtMin $b.ActiveMin), ("{0}-{1}" -f (FmtStamp $b.First), (FmtStamp $b.Last)), $b.Prompts)
  }
}
if ($sid) {
  Write-Output ""
  if ($sessionDal) { Write-Output $sessionDal }
  if ($sessionTopics.Count -eq 0) {
    Write-Output "Sessione ${sid}: nessun evento in questo periodo."
  } else {
    Write-Output "Sessione ${sid}: topic con almeno un evento della sessione (minuti = tempo attivo della sola sessione nel topic e giorno)"
    foreach ($t in $sessionTopics) {
      $shared = if ($sharedTopics["$($t.Day)`n$($t.Project)`n$($t.Branch)"]) { '  [anche altre sessioni]' } else { '' }
      $own = 0.0
      foreach ($rep in $sidReps.Keys) { $own += [double]$activeBySPBDay["$rep`n$($t.Day)`n$($t.Project)`n$($t.Branch)"] }
      Write-Output ("  {0}  {1} / {2}  {3}{4}" -f $t.Day, (Split-Path $t.Project -Leaf), $t.Branch, (FmtMin $own), $shared)
    }
  }
}
Write-Output ""
Write-Output ("{0,-11} {1,9} {2,11} {3,7} {4,8} {5,8}" -f 'GIORNO', 'ATTIVO', 'RECUPERATI', 'TARGET', 'LOGGATO', 'MANCANO')
for ($d = $fromD; $d -le $toD; $d = $d.AddDays(1)) {
  $k = $d.ToString('yyyy-MM-dd'); $t = TargetOf $d; $l = [double]$loggedByDay[$k]; $am = [double]$activeByDay[$k]
  if ($t -eq 0 -and $am -eq 0 -and $l -eq 0) { continue }
  Write-Output ("{0,-11} {1,9} {2,11} {3,7} {4,8} {5,8}" -f $k, (FmtMin $am), (FmtMin $recoveredByDay[$k]), (FmtH $t), (FmtH $l), (FmtH ([math]::Max(0, $t - $l))))
}
if ($longWaits.Count) {
  Write-Output ""
  Write-Output "Attese lunghe contate come attive (verificale in Tabella 1):"
  foreach ($w in ($longWaits | Sort-Object From)) { Write-Output ("  {0}-{1}  {2,7}  {3}" -f $w.From.ToString('MM-dd HH:mm'), $w.To.ToString('HH:mm'), (FmtMin $w.Min), $w.Where) }
}

# ---- raw digest ----
$sb = [System.Text.StringBuilder]::new()
[void]$sb.AppendLine("# Digest grezzo - $rangeLabel")
[void]$sb.AppendLine("")
[void]$sb.AppendLine("Tempo attivo totale: **$(FmtMin $totalMin)** su $($projReport.Count) progetti (recuperati: attese $(FmtMin $recovered.wait), continuita' $(FmtMin $recovered.cont)).")
[void]$sb.AppendLine("Il branch git e' usato come topic. Il lavoro su 'master'/'HEAD' va spezzato in topic leggendo i contenuti.")
[void]$sb.AppendLine("")
foreach ($p in $projReport) {
  [void]$sb.AppendLine("## $($p.Leaf)")
  [void]$sb.AppendLine("``Path``: $($p.Project)")
  [void]$sb.AppendLine("Attivo ~$(FmtMin $p.ActiveMin) | $(FmtStamp $p.First)-$(FmtStamp $p.Last) | $($p.Prompts) prompt | $($p.Sessions) sessioni")
  [void]$sb.AppendLine("")
  $projLines = 0; $projTrunc = $false
  foreach ($b in $p.Branches) {
    $mineBranch = [bool]$sessionBranches["$($p.Project)`n$($b.Branch)"]
    # the session's own lines and branch headers are never cut and do not count toward the limit
    if (-not $mineBranch -and $projLines -ge $MaxLinesPerProj) { $projTrunc = $true; continue }
    [void]$sb.AppendLine("### topic (branch): $($b.Branch)  -  ~$(FmtMin $b.ActiveMin) | $($b.Prompts) prompt | $(FmtStamp $b.First)-$(FmtStamp $b.Last)$(if ($sessionBranches["$($p.Project)`n$($b.Branch)"]) { ' | sessione: si' })")
    foreach ($e in @($b.Events | Where-Object { $_.Text -ne '' })) {
      $isMine = IsMine $e
      if (-not $isMine -and $projLines -ge $MaxLinesPerProj) { $projTrunc = $true; continue }
      $mine = if ($isMine) { ' [S]' } else { '' }
      if ($e.Type -eq 'user') { [void]$sb.AppendLine("- [$(FmtStamp $e.Time)]$mine **TU:** $(Trunc $e.Text $MaxPromptChars)") }
      else                    { [void]$sb.AppendLine("- [$(FmtStamp $e.Time)]$mine CC: $(Trunc $e.Text $MaxAsstChars)") }
      if (-not $isMine) { $projLines++ }
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
Write-Output "Target: $targetsPath"
