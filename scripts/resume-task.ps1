<#
.SYNOPSIS
  One-shot Windows task that reopens a closed chat after a usage window resets: claude-resume-<first 8 of the session id>.

.DESCRIPTION
  pwsh -NoProfile -File resume-task.ps1 -SessionId <sid>            create (or overwrite) the task from the chat's pace file
  pwsh -NoProfile -File resume-task.ps1 -SessionId <sid> -Check     exit 0 and "exists" when the task is there, else exit 1
  pwsh -NoProfile -File resume-task.ps1 -SessionId <sid> -Remove    delete it (work finished before the limit)
  pwsh -NoProfile -File resume-task.ps1 -Sweep                      delete claude-resume-* tasks past their EndBoundary,
                                                                    or whose pace file is gone or done
  -DryRun prints what would happen as one JSON line and changes nothing. -TasksJson <file> replaces the task list
  ([{ name, endBoundary }]) and implies -DryRun. With CLAUDE_PACE_NO_SCHEDULER set (the tests set it) any call that
  would read or change the scheduler stops with exit 1 instead.

  The task lives in the root folder (a non-elevated user cannot delete a task folder), runs once at resumeAt (on
  battery too), ends at resumeAt + 6 h and deletes itself when expired. Creating one first sweeps the expired and
  orphaned claude-resume-* tasks; at 5 left a new one is refused: another chat's live task is never removed to make
  room. The count and the registration hold a named mutex, so chats crossing 92% together cannot overshoot the cap.
  Pace files: <config dir>\.cache\pace\<sid>.json, see docs/usage-pace.md.
#>
param(
  [string]$SessionId,
  [switch]$Check,
  [switch]$Remove,
  [switch]$Sweep,
  [switch]$DryRun,
  [string]$TasksJson
)

$ErrorActionPreference = 'Stop'
if ($TasksJson) { $DryRun = [switch]$true } # a faked list never meets the real scheduler
$Prefix = 'claude-resume-'
$Cap = 5
$Config = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $HOME '.claude' }
$PaceDir = Join-Path $Config '.cache\pace'

function Stop-Script([string]$Message) { [Console]::Error.WriteLine("resume-task: $Message"); exit 1 }
function Write-Line($Object) { $Object | ConvertTo-Json -Compress -Depth 5 }
function ConvertTo-Iso([DateTimeOffset]$At) { $At.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'") }
function Assert-Scheduler { if ($env:CLAUDE_PACE_NO_SCHEDULER) { Stop-Script 'scheduler calls are disabled (CLAUDE_PACE_NO_SCHEDULER)' } }

# [{ name, endBoundary }] from the fake list or from the scheduler (root folder, our prefix only).
function Get-ResumeTasks {
  $rows = @()
  if ($TasksJson) {
    foreach ($t in @(Get-Content -Raw -LiteralPath $TasksJson | ConvertFrom-Json)) {
      $end = $null
      if ($t.endBoundary -is [datetime]) { $end = [DateTimeOffset]$t.endBoundary }
      elseif ($t.endBoundary) { $end = [DateTimeOffset]::Parse([string]$t.endBoundary) }
      $rows += [pscustomobject]@{ name = [string]$t.name; endBoundary = $end }
    }
  } else {
    Assert-Scheduler
    foreach ($t in @(Get-ScheduledTask -TaskPath '\' -ErrorAction SilentlyContinue | Where-Object { $_.TaskName -like "$Prefix*" })) {
      $raw = ($t.Triggers | Where-Object { $_.EndBoundary } | Select-Object -First 1).EndBoundary
      $rows += [pscustomobject]@{ name = $t.TaskName; endBoundary = $(if ($raw) { [DateTimeOffset]::Parse([string]$raw) } else { $null }) }
    }
  }
  $rows | Where-Object { $_.name -like "$Prefix*" }
}

function Get-PaceState([string]$Id8) {
  $f = Get-ChildItem -LiteralPath $PaceDir -Filter "$Id8*.json" -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -notlike '*.mod.json' } | Select-Object -First 1
  if (-not $f) { return $null }
  try { Get-Content -Raw -LiteralPath $f.FullName | ConvertFrom-Json } catch { $null }
}

function Remove-ResumeTask([string]$Name) {
  Assert-Scheduler
  Unregister-ScheduledTask -TaskName $Name -TaskPath '\' -Confirm:$false -ErrorAction SilentlyContinue
}

# Tasks past their EndBoundary, or whose pace file is gone or done: nothing left for them to resume.
function Get-Sweepable($Tasks) {
  $now = [DateTimeOffset]::UtcNow
  foreach ($t in $Tasks) {
    $state = Get-PaceState ($t.name.Substring($Prefix.Length))
    if (($t.endBoundary -and $t.endBoundary -lt $now) -or -not $state -or $state.done -eq $true) { $t.name }
  }
}

if ($Sweep) {
  $gone = @(Get-Sweepable @(Get-ResumeTasks))
  if (-not $DryRun) { foreach ($n in $gone) { Remove-ResumeTask $n } }
  Write-Line ([ordered]@{ remove = @($gone) })
  exit 0
}

if ($SessionId -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$') { Stop-Script '-SessionId needs a session id (8 characters or more)' }
$name = $Prefix + $SessionId.Substring(0, 8)
if ($Check) {
  if (@(Get-ResumeTasks | Where-Object { $_.name -eq $name }).Count) { 'exists'; exit 0 }
  'missing'; exit 1
}

if ($Remove) {
  if (-not $DryRun) { Remove-ResumeTask $name }
  Write-Line ([ordered]@{ remove = @($name) })
  exit 0
}

$state = Get-PaceState ($SessionId.Substring(0, 8))
if (-not $state -or $state.sessionId -ne $SessionId -or -not $state.resumeAt) { Stop-Script "session $SessionId has no armed pace file" }
$resumeAt = [DateTimeOffset]::FromUnixTimeMilliseconds([int64]$state.resumeAt)
$endAt = $resumeAt.AddHours(6)
if ($endAt -le [DateTimeOffset]::UtcNow) { Stop-Script "resumeAt of session $SessionId is more than 6 hours past: arm again first" }
$launch = Join-Path $PSScriptRoot 'resume-launch.ps1'
$arguments = "-NoProfile -File `"$launch`" -SessionId `"$SessionId`""

# Built before any decision: the dry run prints these very objects (the cmdlets have no side effect).
$trigger = New-ScheduledTaskTrigger -Once -At $resumeAt.LocalDateTime
$trigger.EndBoundary = $endAt.LocalDateTime.ToString('s')
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$settings.DeleteExpiredTaskAfter = 'PT0S'
$action = New-ScheduledTaskAction -Execute 'pwsh' -Argument $arguments

$mutex = [Threading.Mutex]::new($false, 'Local\claude-resume-task')
try {
  $held = $false
  try { $held = $mutex.WaitOne(30000) } catch [Threading.AbandonedMutexException] { $held = $true } # a crashed holder: ours now
  if (-not $held) { Stop-Script 'another chat is creating its resume task: try again' }
  $all = @(Get-ResumeTasks)
  $existing = @($all | Where-Object { $_.name -eq $name })
  $stale = @(Get-Sweepable @($all | Where-Object { $_.name -ne $name }))
  $others = @($all | Where-Object { $_.name -ne $name -and $stale -notcontains $_.name })
  $refused = (-not $existing.Count) -and $others.Count -ge $Cap
  $message = if ($refused) { "$Cap resume tasks already exist: no new one for this chat (remove one or wait for them to expire)" } else { '' }

  Write-Line ([ordered]@{
    name = $name; taskPath = '\'; dryRun = [bool]$DryRun
    trigger = [ordered]@{ type = 'once'; at = $trigger.StartBoundary }
    endBoundary = $trigger.EndBoundary; deleteExpiredTaskAfter = $settings.DeleteExpiredTaskAfter
    startWhenAvailable = $settings.StartWhenAvailable; disallowStartIfOnBatteries = $settings.DisallowStartIfOnBatteries
    stopIfGoingOnBatteries = $settings.StopIfGoingOnBatteries
    execute = $action.Execute; arguments = $action.Arguments; sweep = @($stale)
    overwrites = [bool]$existing.Count; refused = $refused; message = $message
  })
  if ($refused) { [Console]::Error.WriteLine("resume-task: $message"); exit 1 }
  if ($DryRun) { exit 0 }

  foreach ($n in $stale) { Remove-ResumeTask $n }
  Assert-Scheduler
  Register-ScheduledTask -TaskName $name -TaskPath '\' -Action $action -Trigger $trigger -Settings $settings `
    -Description "Reopens Claude Code chat $SessionId after the usage window resets" -Force | Out-Null
} finally {
  try { $mutex.ReleaseMutex() } catch { } # not held (the wait timed out): nothing to release
  $mutex.Dispose()
}
