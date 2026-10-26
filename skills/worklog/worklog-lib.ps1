# Helpers of worklog.ps1, dot-sourced by it: they read the engine's script variables ($isRange, $chgT, $acc,
# $fromD, $toD, $DayStart, $DayEnd) at call time, so this file is not a standalone script.

# ---- text and formatting ----
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
# every value that follows $key up to the next quote, as @(value, value after $then up to its quote); string search, not a
# regex: a regex over a transcript line of hundreds of KB is slow. $then = '' returns the value alone.
function QuotedAfter([string]$line, [string]$key, [string]$then) {
  $p = 0
  while (($p = $line.IndexOf($key, $p, [StringComparison]::Ordinal)) -ge 0) {
    $s = $p + $key.Length; $e = $line.IndexOf('"', $s)
    if ($e -lt 0) { break }
    $p = $e
    if ($e -eq $s) { continue }
    $v = $line.Substring($s, $e - $s)
    if ($then -eq '') { , @($v); continue }
    if ([string]::CompareOrdinal($line, $e, $then, 0, $then.Length) -ne 0) { continue }
    $s2 = $e + $then.Length; $e2 = $line.IndexOf('"', $s2)
    if ($e2 -gt $s2) { , @($v, $line.Substring($s2, $e2 - $s2)) }
  }
}
# The fields a tool_result-only user line contributes, read by string search; each key must occur once in the line (a
# nested copy inside the tool result could be read instead of the top-level one); $null when anything is missing,
# repeated, escaped or odd: the caller then parses the line as JSON.
function ToolResultFields([string]$line, [int]$tsAt) {
  # a second "timestamp" in the line (a nested object) means the top-level one is not this one: parse it
  if ($line.LastIndexOf('"timestamp":"', [StringComparison]::Ordinal) -ne $tsAt -or $line.Contains('"isSidechain":true')) { return $null }
  $f = [System.Collections.Generic.List[string]]::new()   # not a foreach expression: a return inside it would leak the values found so far
  foreach ($k in '"uuid":"', '"sessionId":"', '"cwd":"', '"gitBranch":"') {
    $p = $line.LastIndexOf($k, [StringComparison]::Ordinal)
    if ($p -lt 0 -or $line.IndexOf($k, [StringComparison]::Ordinal) -ne $p) { return $null }
    $s = $p + $k.Length; $e = $line.IndexOf('"', $s)
    if ($e -le $s) { return $null }
    $v = $line.Substring($s, $e - $s)
    if ($v -like '*\*') { if ($v.Replace('\\', '') -like '*\*') { return $null }; $v = $v.Replace('\\', '\') }
    $f.Add($v)
  }
  return [pscustomobject]@{ Uuid = $f[0]; Session = $f[1]; Cwd = $f[2]; Branch = $f[3] }
}

# ---- scan of one transcript: the timestamp is read by string search before any JSON parse (the transcripts weigh hundreds of MB) ----
# One file per call: everything it needs comes in $c, everything it finds goes out in the result, in file order. Recs keep every line's contribution; the resume dedup in worklog.ps1 decides which ones count.
function ScanFile($file, $c) {
  $fromD = $c.FromD; $toD = $c.ToD; $IdleMinutes = $c.IdleMinutes; $MaxSpanMinutes = $c.MaxSpanMinutes
  $hiD = $toD.AddDays(1); $turnHiD = $toD.AddDays(2); $subLoD = $fromD.AddDays(-1)
  $res = [pscustomobject]@{ File = $file.FullName; Born = $file.CreationTimeUtc; First = $null; Last = $null
    Recs = [System.Collections.Generic.List[object]]::new(); Busy = [System.Collections.Generic.List[object]]::new()
    SubLong = [System.Collections.Generic.List[object]]::new(); Cont = [System.Collections.Generic.List[object]]::new() }
  $isSub = $file.FullName -match '[\\/]subagents[\\/]'
  $fileKey = [System.IO.Path]::GetFileNameWithoutExtension($file.Name)
  $subSession = if ($isSub -and $file.FullName -match '[\\/]([^\\/]+)[\\/]subagents[\\/]') { $matches[1] } else { $fileKey }
  $subTimes = [System.Collections.Generic.List[datetime]]::new()
  $subCalls = @{}   # tool_use id -> { T, Name }: a tool call that spans a gap keeps the subagent at work
  foreach ($line in [System.IO.File]::ReadLines($file.FullName)) {
    # IndexOf and Substring, not a regex: a Match per line over lines of hundreds of KB took most of the run time
    # the first ISO-Z value wins: a nested "timestamp" of another shape (a tool input) is skipped, as the regex did
    $iso = $null
    $ti = $line.IndexOf('"timestamp":"', [StringComparison]::Ordinal)
    while ($ti -ge 0) {
      $te = $line.IndexOf('"', $ti + 13)
      if ($te -lt 0) { break }
      $v = $line.Substring($ti + 13, $te - $ti - 13)
      if ($v.Length -ge 20 -and $v[10] -eq 'T' -and $v[$v.Length - 1] -eq 'Z') { $iso = $v; break }
      $ti = $line.IndexOf('"timestamp":"', $te, [StringComparison]::Ordinal)
    }
    if ($null -eq $iso) { continue }
    # operators and casts, not method calls or functions, per line: each call costs several microseconds, over 100k lines
    $lt = [datetime]$iso   # the Z is read and the result is local time: the same instant the period bounds are
    if ($line[9] -ceq 'c' -and $line.StartsWith('{"type":"continued-in"', [StringComparison]::Ordinal)) {   # the original names the resume that continues it
      $cm = $c.ContRx.Match($line)
      if ($cm.Success) { $res.Cont.Add(@($cm.Groups[2].Value, $cm.Groups[1].Value)) }
      continue
    }
    if ($isSub) {
      # one day of margin on both sides, and every tool_use at any time: a run or a tool call straddling the
      # period edge keeps its part inside (Book cuts the days); a call open for over a day past the edge is lost
      $isUse = $line.Contains('"type":"tool_use"')
      $near = $lt -ge $subLoD -and $lt -lt $turnHiD
      if (-not ($near -or $isUse)) { continue }
      if ($near) { $subTimes.Add($lt) }
      if ($isUse) {
        foreach ($u in @(QuotedAfter $line '"type":"tool_use","id":"' '","name":"')) { $subCalls[$u[0]] = [pscustomobject]@{ T = $lt; Name = $u[1] } }
      }
      if ($near -and $line.Contains('"type":"tool_result"')) {
        foreach ($u in @(QuotedAfter $line '"tool_use_id":"' '')) {
          $call = $subCalls[$u[0]]
          if ($call -and $call.Name -notin 'AskUserQuestion', 'ExitPlanMode' -and ($lt - $call.T).TotalMinutes -gt $IdleMinutes) {
            $spanMin = ($lt - $call.T).TotalMinutes
            $res.Busy.Add([pscustomobject]@{ Session = $subSession; S = $call.T; E = $(if ($spanMin -gt $MaxSpanMinutes) { $call.T.AddMinutes($MaxSpanMinutes) } else { $lt }); Turn = $false })
            if ($spanMin -gt $MaxSpanMinutes) { $res.SubLong.Add([pscustomobject]@{ Session = $subSession; S = $call.T; E = $lt; Min = $spanMin }) }
          }
        }
      }
      continue
    }
    # a turn_duration of the day after the period still counts: a turn across midnight keeps its part inside (Book cuts the days)
    $late = $lt -ge $hiD
    if ($lt -lt $fromD -or $lt -ge $turnHiD) { continue }
    if ($late -and -not $line.Contains('"subtype":"turn_duration"')) { continue }
    if (-not ($line.Contains('"type":"user"') -or $line.Contains('"type":"assistant"') -or
              $line.Contains('"subtype":"turn_duration"'))) { continue }
    $fr = $null
    if (-not $late -and $line.Contains('"message":{"role":"user","content":[{"tool_use_id"') -and -not $line.Contains('"type":"text"')) {
      # a tool_result-only user line is never a prompt and has no text: its JSON parse is the main cost of the scan
      $fr = ToolResultFields $line $ti
    }
    if ($fr) {
      $local = $lt
      if ($local.Date -lt $fromD -or $local.Date -gt $toD.AddDays(1)) { continue }
      $rec = [pscustomobject]@{ File = $res.File; Uuid = $fr.Uuid; Session = $fr.Session; Time = $local; Ev = $null; TurnMs = 0.0 }
      $rec.Ev = [pscustomobject]@{ Time = $local; Project = $fr.Cwd; Branch = $fr.Branch; Type = 'user'; Text = ''; Session = $fr.Session; Raw = $fr.Session; Prompt = $false }
      if ($null -eq $res.First -or $local -lt $res.First) { $res.First = $local }
      if ($null -eq $res.Last  -or $local -gt $res.Last)  { $res.Last  = $local }
      $res.Recs.Add($rec); continue
    }
    try { $o = $line | ConvertFrom-Json } catch { continue }
    if (-not $o.timestamp -or $o.isSidechain -or ($late -and $o.type -ne 'system')) { continue }
    $ts = $o.timestamp   # ConvertFrom-Json may already have turned it into a DateTime, of any Kind
    $local = if ($ts -isnot [datetime]) { ToLocal ([string]$ts) }
             elseif ($ts.Kind -eq 'Local') { $ts }
             else { [datetime]::SpecifyKind($ts, 'Utc').ToLocalTime() }
    if ($local.Date -lt $fromD -or $local.Date -gt $toD.AddDays(1)) { continue }

    # the session key is the line's sessionId (a file may hold several); no id -> the file's own name
    $sess = if ($o.sessionId) { [string]$o.sessionId } else { $fileKey }
    $rec = [pscustomobject]@{ File = $res.File; Uuid = [string]$o.uuid; Session = $sess; Time = $local
                              Ev = $null; TurnMs = 0.0 }
    if ($null -eq $res.First -or $local -lt $res.First) { $res.First = $local }
    if ($null -eq $res.Last  -or $local -gt $res.Last)  { $res.Last  = $local }

    if ($o.type -eq 'system') {
      if ($o.subtype -eq 'turn_duration' -and $o.durationMs -gt 0) { $rec.TurnMs = [double]$o.durationMs; $res.Recs.Add($rec) }
      continue
    }
    if ($o.type -ne 'user' -and $o.type -ne 'assistant') { continue }

    $content = $o.message.content
    $isResult = $false
    if ($content -isnot [string]) { foreach ($b in @($content)) { if ($b.type -eq 'tool_result') { $isResult = $true } } }
    $cwd    = if ($o.cwd) { [string]$o.cwd } else { 'sconosciuto' }
    $branch = if ($o.gitBranch) { [string]$o.gitBranch } else { '(nessun-branch)' }
    $isPrompt = $false
    if ($o.type -eq 'user') {
      $raw = TextOf $content   # block prompts (pasted images) carry text too
      $system = $raw -match '^\s*<(task-notification|local-command|command-name|command-message)' -or $raw -match '^\s*\[Request interrupted'
      $text = if ($system) { '' } else { Clean $raw }
      $isPrompt = -not ($system -or $isResult -or $o.isMeta)   # a turn starts here
    } else {
      $text = Clean (TextOf $content)
    }
    $rec.Ev = [pscustomobject]@{
      Time = $local; Project = $cwd; Branch = $branch; Type = $o.type; Text = $text; Session = $sess; Raw = $sess; Prompt = $isPrompt
    }
    $res.Recs.Add($rec)
  }
  # subagent activity -> busy intervals: runs of events no more than IdleMinutes apart, tagged with the session directory
  if ($subTimes.Count -gt 0) {
    $st = @($subTimes | Sort-Object)
    $segStart = $st[0]; $prev = $st[0]
    foreach ($t in $st) {
      if (($t - $prev).TotalMinutes -gt $IdleMinutes) { $res.Busy.Add([pscustomobject]@{ Session = $subSession; S = $segStart; E = $prev; Turn = $false }); $segStart = $t }
      $prev = $t
    }
    $res.Busy.Add([pscustomobject]@{ Session = $subSession; S = $segStart; E = $prev; Turn = $false })
  }
  return $res
}

# ---- topic and interval lookups (sorted inputs; binary search) ----
function TopicIdx([string]$s, [datetime]$t) {   # the last change at or before t, else the first
  $cs = $chgT[$s]; $lo = 0; $hi = $cs.Count - 1; $idx = 0
  while ($lo -le $hi) {
    $mid = [int][math]::Floor(($lo + $hi) / 2)
    if ($cs[$mid] -le $t) { $idx = $mid; $lo = $mid + 1 } else { $hi = $mid - 1 }
  }
  return $idx
}
function LowerBound($sorted, [datetime]$t) {   # index of the first element >= t (Count when none)
  $lo = 0; $hi = $sorted.Count - 1; $k = $sorted.Count
  while ($lo -le $hi) { $mid = [int][math]::Floor(($lo + $hi) / 2); if ($sorted[$mid] -ge $t) { $k = $mid; $hi = $mid - 1 } else { $lo = $mid + 1 } }
  return $k
}
function MergeIv($list) {   # sorted, overlapping or touching ones merged, empty ones dropped
  $out = [System.Collections.Generic.List[object]]::new()
  foreach ($x in ($list | Where-Object { $_.E -gt $_.S } | Sort-Object S)) {
    if ($out.Count -gt 0 -and $x.S -le $out[$out.Count - 1].E) { if ($x.E -gt $out[$out.Count - 1].E) { $out[$out.Count - 1].E = $x.E } }
    else { $out.Add([pscustomobject]@{ S = $x.S; E = $x.E }) }
  }
  return ,$out
}

# ---- minutes: per topic, day, session; split at midnight and at the working hours ----
function AddAcc([string]$k, [double]$m) { $script:acc[$k] = [double]$script:acc[$k] + $m }
function Book([datetime]$s, [datetime]$e, [string]$sess, [string]$key, [string]$kind) {
  $t = $s
  while ($t -lt $e) {
    $d = $t.Date; $w0 = $d.AddHours($DayStart); $w1 = $d.AddHours($DayEnd)
    $next = $e
    foreach ($b in @($w0, $w1, $d.AddDays(1))) { if ($b -gt $t -and $b -lt $next) { $next = $b } }
    if ($d -ge $fromD -and $d -le $toD) {
      $m = ($next - $t).TotalMinutes
      $kk = if ($t -ge $w0 -and $t -lt $w1) { $kind } else { 'out' }
      $day = $d.ToString('yyyy-MM-dd')
      AddAcc "P`n$key`n$kk" $m; AddAcc "D`n$day`n$kk" $m; AddAcc "S`n$sess`n$day`n$key`n$kk" $m
    }
    $t = $next
  }
}
function Acc([string]$k) { [double]$script:acc[$k] }
