#requires -Version 7.0
<#
.SYNOPSIS
  /worklog engine: what was done in a period, how much time it took per (project, branch) —
  Claude at work plus the user's own time — and how each day compares with its target.

.DESCRIPTION
  Two kinds of minutes, both from the transcripts, summed over the period:
    CLAUDE  Claude at work. Per session (the sessionId of the line; the file name when empty) the busy
            intervals are the union of its turns (system turn_duration: [ts - durationMs, ts]) and of its
            subagents' activity (events under <sessionId>/subagents/, no more than IdleMinutes apart, or a gap
            spanned by one tool call of that subagent: tool_use to its tool_result, up to MaxSpanMinutes,
            interactive tools excluded; a background agent keeps working after the turn). A turn with no turn_duration (interrupted)
            runs from its user prompt to the last assistant event before the next prompt. The busy
            minutes of all sessions are SUMMED (two parallel 1h chats = 2h, so a day can exceed the clock).
            Background bash jobs (dev servers) never count. A turn longer than MaxSpanMinutes still
            counts, but is listed under "Attese lunghe": a permission prompt left pending looks the same
            (so does a subagent tool call over MaxSpanMinutes, counted up to the limit and listed in full).
    TU      the user writing prompts and reading results: after each busy interval of a session, up to
            MarginMinutes or until that session's next busy start or prompt. Counted ONCE: the union of
            these intervals over all sessions, minus the union of all sessions' busy intervals (while
            Claude works anywhere the user's time is already covered). Each TU minute goes to the topic of
            the session whose busy interval ended most recently.
  Topic = project (cwd) + git branch: the one of the session's last event at the start of the interval,
  changing where the session's events change it. Day = the local day of the minute.
  Working hours: minutes inside DayStart-DayEnd are CLAUDE and TU (TOTALE = CLAUDE + TU); minutes
  outside go to FUORI, never dropped. A turn or subagent call across the edge of the period (midnight
  in a per-day run) counts for the part inside it.
  Resume dedup: a resumed transcript copies earlier messages (same uuid, same timestamp) under a new
  sessionId. A uuid is counted once, in the file that starts earliest (then created first, ends earliest, path).
  If session B carries copies of A's messages and A's last event is before B's first own event (a
  resume), B joins A's session (no double count). If A keeps working after B's first own event (a
  fork), only the duplicates are dropped: two sessions.
  When the first timestamps tie: first the creation time of the chain's first file (a chain follows the
  {"type":"continued-in","continuedInSessionId":<resume>} line the original ends with; a file in no chain is
  its own chain), then the place in the chain (the original before its resume), then the file's creation time.
  Limit: only some resumes leave that line (none seen for a plain --resume or a fork); the creation time is
  unreliable after copies, sync or restores (the head of a fork may land on the wrong file).
  A session with no main-session event in the period has no topic: its busy time is not counted.

  Targets: <OutDir>/targets.json  { "targetHours": 8, "days": { "yyyy-MM-dd": 6 | { "hours": 6, "note": "..." } } }
  — written by worklog-push.ps1; missing means targetHours Monday-Friday and 0 at weekends.
  Logged: <OutDir>/pushed.json (the audit); a multi-day entry is split evenly over its weekdays.

  -SessionId <id> (case-insensitive; the raw id or the id its session resolves to) does not change the
  totals or the topic minutes; a "Sessione" section lists the (day, topic) pairs with at least one
  main-session event of that session, each with the session's OWN CLAUDE + TU minutes in that topic and
  day (FUORI apart); a topic that also has events of another session is flagged "[anche altre sessioni]",
  and the digest lines of the session carry " [S]".
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
  [int]$IdleMinutes       = 15,   # subagent events this close are one run of work; a subagent tool call longer than this fills the gap it spans
  [int]$MarginMinutes     = 15,   # the user's time after a busy interval
  [int]$MaxSpanMinutes    = 120,  # a longer turn is listed under "Attese lunghe"; a subagent tool call counts up to this and is listed
  [int]$DayStart          = 8,    # working hours; the rest of the day is FUORI
  [int]$DayEnd            = 20,
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
  else   { throw "Invalid date: '$s'. Use yyyy-MM-dd, 'yesterday'/'ieri' or empty (=today)." }
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

# ---- helpers: text, formatting, string search, topic and interval lookups, booking (worklog-lib.ps1) ----
. (Join-Path $PSScriptRoot 'worklog-lib.ps1')

# ---- scan: the timestamp is read by string search before any JSON parse (the transcripts weigh hundreds of MB) ----
$contRx = [regex]::new('"sessionId":"([^"]+)".*"continuedInSessionId":"([^"]+)"')

$events  = [System.Collections.Generic.List[object]]::new()
$busyRaw = [System.Collections.Generic.List[object]]::new()   # { Session, S, E, Turn } local datetimes
$subLong = [System.Collections.Generic.List[object]]::new()    # subagent tool calls longer than MaxSpanMinutes: { Session, S, E, Min }
# Pass 1 keeps every line's contribution; the resume dedup (below) decides which ones count before any event or turn is built.
$recs = [System.Collections.Generic.List[object]]::new()
$fileFirst = @{}; $fileLast = @{}; $fileBorn = @{}
$continuedBy = @{}   # session id of a resume -> session id of the original that has a "continued-in" line pointing at it

$files = Get-ChildItem $ProjectsRoot -Recurse -Filter *.jsonl -File -ErrorAction SilentlyContinue |
         Where-Object { $_.LastWriteTime -ge $fromD }

$cfg = @{ FromD = $fromD; ToD = $toD
          IdleMinutes = $IdleMinutes; MaxSpanMinutes = $MaxSpanMinutes; ContRx = $contRx }
foreach ($file in $files) {
  $r = ScanFile $file $cfg
  $fileBorn[$r.File] = $r.Born
  foreach ($cp in $r.Cont) { $continuedBy[$cp[0]] = $cp[1] }
  $busyRaw.AddRange($r.Busy); $subLong.AddRange($r.SubLong); $recs.AddRange($r.Recs)
  if ($null -ne $r.First) { $fileFirst[$r.File] = $r.First; $fileLast[$r.File] = $r.Last }
}

# ---- resume dedup: a resumed transcript copies earlier messages (same uuid and timestamp) under a new sessionId ----
# The copy belongs to the file that starts earliest; on a tie (a fork starts with the same timestamps as its original): the chain
# created first, then the earlier place in the "continued-in" chain, then created first, ends earliest, path. Its lines are dropped everywhere.
$fileRank = @{}; $rankN = 0
$fileDepth = @{}   # how many "continued-in" hops lead from the chain's root to this file's session: the original is 0, its resume 1
$fileRootBorn = @{}   # creation time of the chain's root file (the file itself when it is in no chain): the depth only orders files of one chain
$bornById = @{}
foreach ($k in $fileBorn.Keys) { $bornById[[System.IO.Path]::GetFileNameWithoutExtension($k)] = $fileBorn[$k] }
foreach ($k in $fileFirst.Keys) {
  $id = [System.IO.Path]::GetFileNameWithoutExtension($k); $n = 0
  while ($continuedBy.ContainsKey($id) -and $n -lt $continuedBy.Count) { $id = $continuedBy[$id]; $n++ }
  $fileDepth[$k] = $n
  $fileRootBorn[$k] = if ($bornById.ContainsKey($id)) { $bornById[$id] } else { $fileBorn[$k] }
}
foreach ($k in ($fileFirst.Keys | Sort-Object { $fileFirst[$_] }, { $fileRootBorn[$_] }, { $fileDepth[$_] }, { $fileBorn[$_] }, { $fileLast[$_] }, { $_ })) { $fileRank[$k] = $rankN++ }
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
  if ($r.TurnMs -gt 0) { $busyRaw.Add([pscustomobject]@{ Session = $r.Session; S = $r.Time.AddMilliseconds(-$r.TurnMs); E = $r.Time; Turn = $true }) }
  if ($r.Ev) { $events.Add($r.Ev) }
}

# alias: B copies A's messages and A ended before B's first own event (a resume) -> one session, under A's id.
# A still working after B's first own event is a fork: only the duplicates are dropped, two sessions.
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
foreach ($b in $busyRaw) { $b.Session = Rep $b.Session }
foreach ($b in $subLong) { $b.Session = Rep $b.Session }

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

# ---- per session: topic changes, and the turns that left no turn_duration ----
$bySession = @{}
foreach ($sg in ($events | Group-Object Session)) { $bySession[$sg.Name] = @($sg.Group | Sort-Object Time) }
$chgT = @{}; $chgK = @{}   # session -> the times at which its topic (project + branch) changes, and the topic keys
foreach ($s in $bySession.Keys) {
  $ts = [System.Collections.Generic.List[datetime]]::new(); $ks = [System.Collections.Generic.List[string]]::new()
  foreach ($e in $bySession[$s]) {
    $k = "$($e.Project)`n$($e.Branch)"
    if ($ks.Count -eq 0 -or $ks[$ks.Count - 1] -ne $k) { $ts.Add($e.Time); $ks.Add($k) }
  }
  $chgT[$s] = $ts; $chgK[$s] = $ks
}
$turnTimes = @{}   # session -> the end times of its turn_duration turns, sorted
foreach ($b in $busyRaw) { if ($b.Turn) { if (-not $turnTimes.ContainsKey($b.Session)) { $turnTimes[$b.Session] = [System.Collections.Generic.List[datetime]]::new() }; $turnTimes[$b.Session].Add($b.E) } }
foreach ($s in @($turnTimes.Keys)) { $turnTimes[$s] = [datetime[]]@($turnTimes[$s] | Sort-Object) }
$promptTimes = @{}   # session -> its prompts (a turn starts there; the user's time ends there)
foreach ($s in $bySession.Keys) {
  $ev = $bySession[$s]   # sorted by time: one pass finds the last reply before each next prompt
  $pt = [datetime[]]@($ev | Where-Object Prompt | ForEach-Object Time)
  $promptTimes[$s] = $pt
  $lastReply = [datetime[]]::new($pt.Count); $k = -1
  foreach ($e in $ev) {
    if ($e.Type -ne 'assistant') { continue }
    while ($k + 1 -lt $pt.Count -and $pt[$k + 1] -le $e.Time) { $k++ }
    if ($k -ge 0) { $lastReply[$k] = $e.Time }
  }
  $tt = if ($turnTimes.ContainsKey($s)) { $turnTimes[$s] } else { [datetime[]]@() }
  for ($i = 0; $i -lt $pt.Count; $i++) {
    $a = $pt[$i]; $z = if ($i + 1 -lt $pt.Count) { $pt[$i + 1] } else { [datetime]::MaxValue }
    $ti = LowerBound $tt $a
    if ($ti -lt $tt.Count -and $tt[$ti] -lt $z) { continue }
    if ($lastReply[$i] -gt $a) { $busyRaw.Add([pscustomobject]@{ Session = $s; S = $a; E = $lastReply[$i]; Turn = $true }) }
  }
}

$acc = @{}   # minutes per topic, day, session (Book, in the lib)

# ---- CLAUDE: the busy intervals of each session, summed ----
$busyBy = @{}
$allBusy = [System.Collections.Generic.List[object]]::new()
foreach ($g in ($busyRaw | Where-Object { $bySession.ContainsKey($_.Session) } | Group-Object Session)) {
  $busyBy[$g.Name] = MergeIv $g.Group
  foreach ($iv in $busyBy[$g.Name]) { $allBusy.Add($iv) }
}
foreach ($s in $busyBy.Keys) {
  foreach ($iv in $busyBy[$s]) {
    $idx = TopicIdx $s $iv.S; $cs = $chgT[$s]; $t = $iv.S
    while ($true) {
      $end = if ($idx + 1 -lt $cs.Count -and $cs[$idx + 1] -lt $iv.E) { $cs[$idx + 1] } else { $iv.E }
      Book $t $end $s $chgK[$s][$idx] 'claude'
      if ($end -ge $iv.E) { break }
      $t = $end; $idx++
    }
  }
}
# turns longer than MaxSpanMinutes count, and are listed: a permission prompt left pending looks the same;
# a subagent tool call that long counts up to MaxSpanMinutes and is listed in full
$longWaits = [System.Collections.Generic.List[object]]::new()
foreach ($b in @($busyRaw | Where-Object Turn) + @($subLong)) {
  if (-not $bySession.ContainsKey($b.Session)) { continue }
  $mins = ($b.E - $b.S).TotalMinutes
  if ($mins -le $MaxSpanMinutes -or $b.E -le $fromD -or $b.S -ge $toD.AddDays(1)) { continue }
  $k = $chgK[$b.Session][(TopicIdx $b.Session $b.S)].Split("`n")
  $longWaits.Add([pscustomobject]@{ From = $b.S; To = $b.E; Min = $mins; Where = "$(Split-Path $k[0] -Leaf) / $($k[1])" })
}

# ---- TU: after each busy interval, up to the margin, once, never while any session is busy ----
$gb = MergeIv $allBusy
$gbEnds = [datetime[]]@($gb | ForEach-Object E)
$pieces = [System.Collections.Generic.List[object]]::new()
foreach ($s in $busyBy.Keys) {
  $stops = [datetime[]]@(@($busyBy[$s] | ForEach-Object S) + @($promptTimes[$s]) | Sort-Object)
  foreach ($iv in $busyBy[$s]) {
    $cap = $iv.E.AddMinutes($MarginMinutes)
    $ni = LowerBound $stops $iv.E
    if ($ni -lt $stops.Count -and $stops[$ni] -lt $cap) { $cap = $stops[$ni] }
    if ($cap -le $iv.E) { continue }
    $key = $chgK[$s][(TopicIdx $s $iv.E)]
    # the part of [E, cap] outside every session's busy time
    $lo = 0; $hi = $gbEnds.Count - 1; $k = $gbEnds.Count
    while ($lo -le $hi) { $mid = [int][math]::Floor(($lo + $hi) / 2); if ($gbEnds[$mid] -gt $iv.E) { $k = $mid; $hi = $mid - 1 } else { $lo = $mid + 1 } }
    $t = $iv.E
    while ($t -lt $cap) {
      if ($k -lt $gb.Count -and $gb[$k].S -lt $cap) {
        if ($gb[$k].S -gt $t) { $pieces.Add([pscustomobject]@{ S = $t; E = $gb[$k].S; Owner = $iv.E; Session = $s; Key = $key }) }
        if ($gb[$k].E -gt $t) { $t = $gb[$k].E }
        $k++
      } else { $pieces.Add([pscustomobject]@{ S = $t; E = $cap; Owner = $iv.E; Session = $s; Key = $key }); $t = $cap }
    }
  }
}
# overlapping pieces count once, for the session whose busy interval ended most recently
$pieces = @($pieces | Sort-Object S)
$bounds = [datetime[]]@(@($pieces | ForEach-Object S) + @($pieces | ForEach-Object E) | Sort-Object -Unique)
$active = [System.Collections.Generic.List[object]]::new(); $pi = 0
for ($bi = 0; $bi -lt $bounds.Count - 1; $bi++) {
  $t0 = $bounds[$bi]; $t1 = $bounds[$bi + 1]
  while ($pi -lt $pieces.Count -and $pieces[$pi].S -le $t0) { $active.Add($pieces[$pi]); $pi++ }
  for ($j = $active.Count - 1; $j -ge 0; $j--) { if ($active[$j].E -le $t0) { $active.RemoveAt($j) } }
  if ($active.Count -eq 0) { continue }
  $best = $active[0]
  foreach ($p in $active) { if ($p.Owner -gt $best.Owner) { $best = $p } }
  Book $t0 $t1 $best.Session $best.Key 'tu'
}

# ---- report per project -> branch ----
$projReport = foreach ($pg in ($events | Group-Object Project)) {
  $pe = @($pg.Group | Sort-Object Time)
  $branches = foreach ($bg in ($pe | Group-Object Branch)) {
    $be = @($bg.Group | Sort-Object Time)
    $pk = "P`n$($pg.Name)`n$($bg.Name)"
    $cl = Acc "$pk`nclaude"; $tu = Acc "$pk`ntu"
    [pscustomobject]@{
      Branch  = $bg.Name
      Claude  = $cl
      Tu      = $tu
      Total   = $cl + $tu
      Out     = Acc "$pk`nout"
      Prompts = @($be | Where-Object { $_.Type -eq 'user' -and $_.Text -ne '' }).Count
      First   = $be[0].Time
      Last    = $be[-1].Time
      Events  = $be
    }
  }
  $branches = @($branches | Sort-Object Total -Descending)
  [pscustomobject]@{
    Project  = $pg.Name
    Leaf     = Split-Path $pg.Name -Leaf
    Claude   = ($branches | Measure-Object Claude -Sum).Sum
    Tu       = ($branches | Measure-Object Tu -Sum).Sum
    Total    = ($branches | Measure-Object Total -Sum).Sum
    Out      = ($branches | Measure-Object Out -Sum).Sum
    Prompts  = ($branches | Measure-Object Prompts -Sum).Sum
    First    = $pe[0].Time
    Last     = $pe[-1].Time
    Sessions = @($pe | Select-Object -ExpandProperty Session -Unique).Count
    Branches = $branches
  }
}
$projReport = @($projReport | Where-Object { $_.Prompts -gt 0 -or ($_.Total + $_.Out) -ge 1 } | Sort-Object Total -Descending)
$sumClaude = ($projReport | Measure-Object Claude -Sum).Sum
$sumTu     = ($projReport | Measure-Object Tu -Sum).Sum
$sumOut    = ($projReport | Measure-Object Out -Sum).Sum
$totalMin  = $sumClaude + $sumTu

# ---- the session's topics: (day, project, branch) with a main-session event of -SessionId ----
$sessionTopics = @(); $sharedTopics = @{}; $sidReps = @{}
# -SessionId matches the raw id or its representative (a resumed session shares its original's session)
function IsMine($e) { return ($sid -and ($e.Raw -ieq $sid -or $e.Session -ieq $sid)) }
if ($sid) {
  foreach ($e in $events) { if (IsMine $e) { $sidReps[$e.Session] = $true } }
  # a (day, topic) that also has events of another session: not the chat's alone
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
Write-Output ("Progetti: {0} | CLAUDE: {1} | TU: {2} | TOTALE: {3} | FUORI: {4}" -f `
  $projReport.Count, (FmtMin $sumClaude), (FmtMin $sumTu), (FmtMin $totalMin), (FmtMin $sumOut))
Write-Output ("Modello: CLAUDE = turni e subagent di ogni chat, sommati; TU = fino a {0} min dopo ogni risposta, una volta sola e mai mentre una chat lavora; orario {1}-{2}, il resto in FUORI; turni oltre {3} min elencati" -f `
  $MarginMinutes, $DayStart, $DayEnd, $MaxSpanMinutes)
Write-Output ""
Write-Output ("{0,-34} {1,9} {2,9} {3,9} {4,9} {5,-17} {6,6}" -f 'PROGETTO / topic (branch)', 'CLAUDE', 'TU', 'TOTALE', 'FUORI', 'FASCIA', 'PROMPT')
foreach ($p in $projReport) {
  Write-Output ("{0,-34} {1,9} {2,9} {3,9} {4,9} {5,-17} {6,6}" -f (Trunc $p.Leaf 34), (FmtMin $p.Claude), (FmtMin $p.Tu), (FmtMin $p.Total), (FmtMin $p.Out), ("{0}-{1}" -f (FmtStamp $p.First), (FmtStamp $p.Last)), $p.Prompts)
  foreach ($b in $p.Branches) {
    Write-Output ("  |- {0,-29} {1,9} {2,9} {3,9} {4,9} {5,-17} {6,6}" -f (Trunc $b.Branch 29), (FmtMin $b.Claude), (FmtMin $b.Tu), (FmtMin $b.Total), (FmtMin $b.Out), ("{0}-{1}" -f (FmtStamp $b.First), (FmtStamp $b.Last)), $b.Prompts)
  }
}
if ($sid) {
  Write-Output ""
  if ($sessionDal) { Write-Output $sessionDal }
  if ($sessionTopics.Count -eq 0) {
    Write-Output "Sessione ${sid}: nessun evento in questo periodo."
  } else {
    Write-Output "Sessione ${sid}: topic con almeno un evento della sessione (minuti = CLAUDE + TU della sola sessione nel topic e giorno; fuori orario a parte)"
    foreach ($t in $sessionTopics) {
      $shared = if ($sharedTopics["$($t.Day)`n$($t.Project)`n$($t.Branch)"]) { '  [anche altre sessioni]' } else { '' }
      $own = 0.0; $ownOut = 0.0
      foreach ($rep in $sidReps.Keys) {
        $sk = "S`n$rep`n$($t.Day)`n$($t.Project)`n$($t.Branch)"
        $own += (Acc "$sk`nclaude") + (Acc "$sk`ntu"); $ownOut += Acc "$sk`nout"
      }
      $fuori = if ($ownOut -ge 1) { "  (+ fuori orario $(FmtMin $ownOut))" } else { '' }
      Write-Output ("  {0}  {1} / {2}  {3}{4}{5}" -f $t.Day, (Split-Path $t.Project -Leaf), $t.Branch, (FmtMin $own), $fuori, $shared)
    }
  }
}
Write-Output ""
Write-Output ("{0,-11} {1,9} {2,9} {3,9} {4,9} {5,7} {6,8} {7,8}" -f 'GIORNO', 'CLAUDE', 'TU', 'TOTALE', 'FUORI', 'TARGET', 'LOGGATO', 'MANCANO')
for ($d = $fromD; $d -le $toD; $d = $d.AddDays(1)) {
  $k = $d.ToString('yyyy-MM-dd'); $t = TargetOf $d; $l = [double]$loggedByDay[$k]
  $dc = Acc "D`n$k`nclaude"; $du = Acc "D`n$k`ntu"; $dOut = Acc "D`n$k`nout"
  if ($t -eq 0 -and ($dc + $du + $dOut) -eq 0 -and $l -eq 0) { continue }
  Write-Output ("{0,-11} {1,9} {2,9} {3,9} {4,9} {5,7} {6,8} {7,8}" -f $k, (FmtMin $dc), (FmtMin $du), (FmtMin ($dc + $du)), (FmtMin $dOut), (FmtH $t), (FmtH $l), (FmtH ([math]::Max(0, $t - $l))))
}
if ($longWaits.Count) {
  Write-Output ""
  Write-Output "Attese lunghe contate come CLAUDE (verificale in Tabella 1):"
  foreach ($w in ($longWaits | Sort-Object From)) { Write-Output ("  {0}-{1}  {2,7}  {3}" -f $w.From.ToString('MM-dd HH:mm'), $w.To.ToString('HH:mm'), (FmtMin $w.Min), $w.Where) }
}

# ---- raw digest ----
$sb = [System.Text.StringBuilder]::new()
[void]$sb.AppendLine("# Digest grezzo - $rangeLabel")
[void]$sb.AppendLine("")
[void]$sb.AppendLine("CLAUDE **$(FmtMin $sumClaude)** + TU **$(FmtMin $sumTu)** = TOTALE **$(FmtMin $totalMin)** su $($projReport.Count) progetti (fuori orario $(FmtMin $sumOut)).")
[void]$sb.AppendLine("Il branch git e' usato come topic. Il lavoro su 'master'/'HEAD' va spezzato in topic leggendo i contenuti.")
[void]$sb.AppendLine("")
foreach ($p in $projReport) {
  [void]$sb.AppendLine("## $($p.Leaf)")
  [void]$sb.AppendLine("``Path``: $($p.Project)")
  [void]$sb.AppendLine("CLAUDE ~$(FmtMin $p.Claude) + TU ~$(FmtMin $p.Tu) | fuori ~$(FmtMin $p.Out) | $(FmtStamp $p.First)-$(FmtStamp $p.Last) | $($p.Prompts) prompt | $($p.Sessions) sessioni")
  [void]$sb.AppendLine("")
  $projLines = 0; $projTrunc = $false
  foreach ($b in $p.Branches) {
    $mineBranch = [bool]$sessionBranches["$($p.Project)`n$($b.Branch)"]
    # the session's own lines and branch headers are never cut and do not count toward the limit
    if (-not $mineBranch -and $projLines -ge $MaxLinesPerProj) { $projTrunc = $true; continue }
    [void]$sb.AppendLine("### topic (branch): $($b.Branch)  -  CLAUDE ~$(FmtMin $b.Claude) + TU ~$(FmtMin $b.Tu) | $($b.Prompts) prompt | $(FmtStamp $b.First)-$(FmtStamp $b.Last)$(if ($sessionBranches["$($p.Project)`n$($b.Branch)"]) { ' | sessione: si' })")
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
