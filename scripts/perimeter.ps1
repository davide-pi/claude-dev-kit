<#
.SYNOPSIS
  Writes or closes the `deliver` perimeter of the current worktree.

.DESCRIPTION
  pwsh -NoProfile -File perimeter.ps1 -Files <entry>[,<entry>...]    write an active perimeter
  pwsh -NoProfile -File perimeter.ps1 -LogRun '<json>' [-Run <id>] [-Tokens <n>]
                                                                     append the findings log line, keep it active
  pwsh -NoProfile -File perimeter.ps1 -Close -FindingsLog '<json>' [-Run <id>] [-Tokens <n>]
                                                                     append the findings log line, then close
  pwsh -NoProfile -File perimeter.ps1 -Close                         close when a run was logged since `opened:`
  pwsh -NoProfile -File perimeter.ps1 -Close -NoFindings             close a change that never ran the loop

  The perimeter is one file per worktree: `<git dir>/deliver/perimeter.md`, never committed. The git
  directory comes from `git rev-parse --absolute-git-dir`, so a linked worktree writes under
  `<main>/.git/worktrees/<name>/`. The file holds `branch:` (the branch checked out now: hooks/scope-guard.js
  ignores the file when it differs), `status: active`, `opened: <ISO-8601 UTC>`, then one `- <path | dir/ | glob>` line per entry.
  It is written as UTF-8 without a BOM, LF line endings, overwriting the previous one.

  -Close appends ONE line to `<git dir>/deliver/findings.jsonl` (never committed): the -FindingsLog object
  (the loop's `result.findingsLog`, a JSON string; PowerShell doubles the quotes inside single quotes) plus `at`
  (now, UTC), `run` (-Run, when given), `minutes` (since `opened:`, when the file has it) and `tokens` (-Tokens, when
  given). A line is skipped when the log's last line already carries the same -Run. With -LogRun the line is appended and the perimeter stays active; `minutes` then counts from the previous
  logged run's `at` (from `opened:` for the first). -Close without -FindingsLog needs a run logged since `opened:`
  or -NoFindings, else exit 2 and nothing is closed.

  Entries are repo-relative; -Files takes one comma-separated list (pwsh -File does not split an array).

  Exit codes: 0 ok, 2 usage error (no entries, not a git repository, detached HEAD, nothing to close,
  -Close with no run logged, -FindingsLog or -NoFindings, a findings JSON that is not an object).
#>

param(
  [string[]]$Files,
  [switch]$Close,
  [string]$FindingsLog,
  [string]$LogRun,
  [string]$Run,
  [int]$Tokens,
  [switch]$NoFindings
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Fail([string]$Message) {
  [Console]::Error.WriteLine("perimeter.ps1: $Message")
  exit 2
}

$gitDir = (& git rev-parse --absolute-git-dir 2>$null)
if ($LASTEXITCODE -ne 0 -or -not $gitDir) { Fail 'not inside a git repository' }
$path = Join-Path (Join-Path $gitDir 'deliver') 'perimeter.md'
$utf8 = New-Object System.Text.UTF8Encoding $false

$logPath = Join-Path (Split-Path -Parent $path) 'findings.jsonl'
$stamp = 'yyyy-MM-ddTHH:mm:ssZ'
$tokensGiven = $PSBoundParameters.ContainsKey('Tokens')
function ParseUtc([string]$Value) {
  $when = [DateTime]::MinValue
  if ([DateTime]::TryParse($Value, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AdjustToUniversal -bor [Globalization.DateTimeStyles]::AssumeUniversal, [ref]$when)) { return $when }
  return $null
}
# the last logged run's `at` that is not older than `opened:` (the stamps sort as text)
function LastLoggedAt([string]$Text) {
  $opened = [regex]::Match($Text, '(?im)^opened:[ \t]*(\S+)')
  if (-not (Test-Path -LiteralPath $logPath)) { return $null }
  $last = $null
  foreach ($line in [System.IO.File]::ReadAllLines($logPath)) {
    $m = [regex]::Match($line, '"at":"([^"]+)"')
    if ($m.Success -and (-not $opened.Success -or $m.Groups[1].Value -ge $opened.Groups[1].Value)) { $last = $m.Groups[1].Value }
  }
  return $last
}
function AppendLog([string]$Json, [string]$Text) {
  try { $log = $Json | ConvertFrom-Json -ErrorAction Stop } catch { Fail "the findings JSON is not valid: $($_.Exception.Message)" }
  if ($log -isnot [pscustomobject] -or $log.PSObject.TypeNames[0] -ne 'System.Management.Automation.PSCustomObject') { Fail 'the findings JSON must be an object' }
  if ($Run -and (Test-Path -LiteralPath $logPath)) {
    $tail = @([System.IO.File]::ReadAllLines($logPath) | Where-Object { $_.Trim() }) | Select-Object -Last 1
    $prev = $null
    if ($tail) { try { $prev = $tail | ConvertFrom-Json -ErrorAction Stop } catch { $prev = $null } }
    if ($prev -is [pscustomobject] -and $prev.PSObject.Properties['run'] -and $prev.run -eq $Run) { Write-Output "skipped: run $Run already logged"; return }
  }
  $now = [DateTime]::UtcNow
  $since = LastLoggedAt $Text
  $opened = [regex]::Match($Text, '(?im)^opened:[ \t]*(\S+)')
  $from = if ($since) { ParseUtc $since } elseif ($opened.Success) { ParseUtc $opened.Groups[1].Value } else { $null }
  $log | Add-Member -NotePropertyName at -NotePropertyValue $now.ToString($stamp) -Force
  if ($Run) { $log | Add-Member -NotePropertyName run -NotePropertyValue $Run -Force }
  if ($from) { $log | Add-Member -NotePropertyName minutes -NotePropertyValue ([math]::Max(0, [math]::Round(($now - $from).TotalMinutes, 1))) -Force }
  if ($tokensGiven) { $log | Add-Member -NotePropertyName tokens -NotePropertyValue $Tokens -Force }
  [System.IO.File]::AppendAllText($logPath, (($log | ConvertTo-Json -Compress -Depth 10) + "`n"), $utf8)
}

if ($LogRun) {
  if ($Files -or $Close -or $FindingsLog) { Fail '-LogRun is exclusive with -Files, -Close and -FindingsLog' }
  if (-not (Test-Path -LiteralPath $path)) { Fail "no perimeter to log a run on at $path" }
  AppendLog $LogRun ([System.IO.File]::ReadAllText($path))
  Write-Output "logged: $logPath"
  exit 0
}

if ($Close) {
  if ($Files) { Fail '-Close and -Files are exclusive' }
  if (-not (Test-Path -LiteralPath $path)) { Fail "no perimeter to close at $path" }
  $text = [System.IO.File]::ReadAllText($path)
  if ($FindingsLog) { AppendLog $FindingsLog $text }
  elseif (-not $NoFindings -and -not (LastLoggedAt $text)) { Fail '-Close needs a run logged since opened (-LogRun), -FindingsLog <json> (the loop result.findingsLog), or -NoFindings for a change that never ran the loop' }
  $closed = [regex]::Replace($text, '(?im)^status:[ \t]*\S+', 'status: closed')
  [System.IO.File]::WriteAllText($path, $closed, $utf8)
  Write-Output "closed: $path"
  exit 0
}

$entries = @($Files | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ } | Select-Object -Unique)
if (-not $entries.Count) { Fail 'pass -Files <entry>[,<entry>...] -Close or -LogRun' }
$branch = (& git branch --show-current 2>$null)
if (-not $branch) { Fail 'no branch checked out (detached HEAD): the perimeter is bound to a branch' }

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $path) | Out-Null
$lines = @("branch: $branch", 'status: active', "opened: $([DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ'))") + @($entries | ForEach-Object { "- $_" })
[System.IO.File]::WriteAllText($path, (($lines -join "`n") + "`n"), $utf8)
Write-Output "written: $path ($($entries.Count) entries, branch $branch)"
