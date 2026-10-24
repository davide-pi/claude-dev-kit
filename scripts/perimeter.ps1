<#
.SYNOPSIS
  Writes or closes the `deliver` perimeter of the current worktree.

.DESCRIPTION
  pwsh -NoProfile -File perimeter.ps1 -Files <entry>[,<entry>...]    write an active perimeter
  pwsh -NoProfile -File perimeter.ps1 -Close                         set the existing one to `status: closed`

  The perimeter is one file per worktree: `<git dir>/deliver/perimeter.md`, never committed. The git
  directory comes from `git rev-parse --absolute-git-dir`, so a linked worktree writes under
  `<main>/.git/worktrees/<name>/`. The file holds `branch:` (the branch checked out now: hooks/scope-guard.js
  ignores the file when it differs), `status: active`, then one `- <path | dir/ | glob>` line per entry.
  It is written as UTF-8 without a BOM, LF line endings, overwriting the previous one.

  Entries are repo-relative; -Files takes one comma-separated list (pwsh -File does not split an array).

  Exit codes: 0 ok, 2 usage error (no entries, not a git repository, detached HEAD, nothing to close).
#>

param(
  [string[]]$Files,
  [switch]$Close
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

if ($Close) {
  if ($Files) { Fail '-Close and -Files are exclusive' }
  if (-not (Test-Path -LiteralPath $path)) { Fail "no perimeter to close at $path" }
  $text = [System.IO.File]::ReadAllText($path)
  $closed = [regex]::Replace($text, '(?im)^status:[ \t]*\S+', 'status: closed')
  [System.IO.File]::WriteAllText($path, $closed, $utf8)
  Write-Output "closed: $path"
  exit 0
}

$entries = @($Files | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ } | Select-Object -Unique)
if (-not $entries.Count) { Fail 'pass -Files <entry>[,<entry>...] or -Close' }
$branch = (& git branch --show-current 2>$null)
if (-not $branch) { Fail 'no branch checked out (detached HEAD): the perimeter is bound to a branch' }

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $path) | Out-Null
$lines = @("branch: $branch", 'status: active') + @($entries | ForEach-Object { "- $_" })
[System.IO.File]::WriteAllText($path, (($lines -join "`n") + "`n"), $utf8)
Write-Output "written: $path ($($entries.Count) entries, branch $branch)"
