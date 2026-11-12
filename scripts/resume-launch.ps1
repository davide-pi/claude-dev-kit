<#
.SYNOPSIS
  The action of the claude-resume-<id8> task: reopens a closed chat in a new Windows Terminal window.

.DESCRIPTION
  pwsh -NoProfile -File resume-launch.ps1 -SessionId <sid> [-DryRun]

  Deletes its own task first. When the chat was never compacted after it was armed (no compactedAt in the pace file
  or the mod file since armedAt), it compacts it headless first (`claude -p --resume <sid> /compact`, up to 15 min),
  so the reopened chat does not reread a full context with a cold cache. Then it opens `wt` with
  `claude --resume <sid>` and the resume prompt, and exits. On any doubt it opens nothing: the chat is still alive
  (a session file with that id, a live pid and a matching process start), the cockpit mod is alive
  (pace\<sid>.mod.json aliveAt under 3 min), the pace file is missing or done, or the transcript's folder is unknown.

  -DryRun prints one JSON line { decision, steps, deleteTask, compact, command } and changes nothing.
  decision: open | alive | mod-alive | done | no-pace | doubt; steps: delete-task [, compact, open].
  With CLAUDE_PACE_NO_SCHEDULER set (the tests set it) a run that is not a dry run stops with exit 1 before any
  scheduler call or process start.
#>
param([Parameter(Mandatory)][string]$SessionId, [switch]$DryRun)

$ErrorActionPreference = 'Stop'
$Config = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $HOME '.claude' }

if ($SessionId -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$') { exit 1 }
$taskName = 'claude-resume-' + $SessionId.Substring(0, 8)

# Returns @{ decision; command } without any side effect; any error is a doubt.
function Get-Decision {
  try {
    $paceFile = Join-Path $Config ".cache\pace\$SessionId.json"
    if (-not (Test-Path -LiteralPath $paceFile)) { return @{ decision = 'no-pace'; command = $null } }
    $state = Get-Content -Raw -LiteralPath $paceFile | ConvertFrom-Json
    if ($state.done -eq $true) { return @{ decision = 'done'; command = $null } }

    # The cockpit mod resumes the chat itself while it is alive.
    $mod = $null
    $modFile = Join-Path $Config ".cache\pace\$SessionId.mod.json"
    if (Test-Path -LiteralPath $modFile) {
      $mod = Get-Content -Raw -LiteralPath $modFile | ConvertFrom-Json
      if ($mod.aliveAt -and ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() - [int64]$mod.aliveAt) -lt 180000) {
        return @{ decision = 'mod-alive'; command = $null }
      }
    }

    # Alive chat: same session id, live pid, same process start. A session file that cannot be read is a doubt.
    $sessions = Join-Path $Config 'sessions'
    if (Test-Path -LiteralPath $sessions) {
      foreach ($f in Get-ChildItem -LiteralPath $sessions -Filter '*.json') {
        $s = Get-Content -Raw -LiteralPath $f.FullName | ConvertFrom-Json
        if ($s.sessionId -ne $SessionId) { continue }
        $p = Get-Process -Id $s.pid -ErrorAction SilentlyContinue
        if ($p -and $p.StartTime.ToFileTime().ToString() -eq [string]$s.procStart) { return @{ decision = 'alive'; command = $null } }
      }
    }

    # `claude --resume` finds the transcript by folder: take it from the transcript's own records.
    $transcript = Get-ChildItem -LiteralPath (Join-Path $Config 'projects') -Filter "$SessionId.jsonl" -Recurse -Depth 1 | Select-Object -First 1
    $cwd = $null
    foreach ($line in Get-Content -LiteralPath $transcript.FullName -TotalCount 60) {
      $rec = $line | ConvertFrom-Json
      if ($rec.cwd) { $cwd = [string]$rec.cwd; break }
    }
    if (-not $cwd -or -not (Test-Path -LiteralPath $cwd -PathType Container)) { return @{ decision = 'doubt'; command = $null } }
    # A trailing backslash before the closing quote escapes it for the command-line parser (C:\ -> C:\.).
    if ($cwd.EndsWith('\')) { $cwd += '.' }

    # Compacted since it was armed, by the chat (PreCompact hook) or by the mod: else compact before reopening.
    $since = if ($state.armedAt) { [int64]$state.armedAt } else { 0 }
    $compactedAt = @($state.compactedAt, $(if ($mod) { $mod.compactedAt })) | Where-Object { $_ } | ForEach-Object { [int64]$_ } |
      Sort-Object -Descending | Select-Object -First 1
    $compact = if ($compactedAt -and $compactedAt -ge $since) { $null } else { "claude -p --resume $SessionId /compact" }

    $prompt = "The usage window has reset. Read the checkpoint at $($state.checkpoint) and check the real state (git status, the perimeter, the last gate) before you continue. When the work is finished, remove the resume task."
    # wt reads ';' as a command separator: escaped.
    $wtArgs = ("-w new -d `"$cwd`" claude --resume $SessionId `"$prompt`"") -replace ';', '\;'
    return @{ decision = 'open'; command = "wt $wtArgs"; wtArgs = $wtArgs; compact = $compact; cwd = $cwd }
  } catch {
    return @{ decision = 'doubt'; command = $null }
  }
}

$d = Get-Decision
$steps = @('delete-task')
if ($d.decision -eq 'open') {
  if ($d.compact) { $steps += 'compact' }
  $steps += 'open'
}

if ($DryRun) {
  [pscustomobject]@{ decision = $d.decision; steps = $steps; deleteTask = $taskName; compact = $d.compact; command = $d.command } |
    ConvertTo-Json -Compress
  exit 0
}
if ($env:CLAUDE_PACE_NO_SCHEDULER) { [Console]::Error.WriteLine('resume-launch: scheduler calls are disabled (CLAUDE_PACE_NO_SCHEDULER)'); exit 1 }

# The task goes first, whatever the decision.
try { Unregister-ScheduledTask -TaskName $taskName -TaskPath '\' -Confirm:$false -ErrorAction SilentlyContinue } catch { }

if ($d.decision -eq 'open') {
  if ($d.compact) {
    # Best effort: a failed or slow compaction still reopens the chat.
    try {
      $p = Start-Process -FilePath 'claude' -ArgumentList @('-p', '--resume', $SessionId, '/compact') -WorkingDirectory $d.cwd `
        -WindowStyle Hidden -PassThru
      if (-not $p.WaitForExit(900000)) { $p.Kill($true) }
    } catch { }
  }
  try { Start-Process -FilePath 'wt' -ArgumentList $d.wtArgs } catch { exit 1 }
  exit 0
}
# Doubt opens nothing and says so by exit code; every other decision is a plain no.
if ($d.decision -eq 'doubt') { exit 1 }
exit 0
