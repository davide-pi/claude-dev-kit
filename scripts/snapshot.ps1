<#
.SYNOPSIS
  Snapshots the working tree as a git tree object and prints what changed since a point, as one JSON line.

.DESCRIPTION
  pwsh -NoProfile -File snapshot.ps1 -Since <tree|sha> [-Start <sha>] [-Dirty 'a,b']

  Prints one line: {"tree":"<sha>","files":["a.cs",...],"churn":<n>}
    tree   the working tree now, untracked files included (ignored ones are not), as a tree object
    files  repo-relative paths that differ between -Start and that tree (new untracked files are in it),
           minus the -Dirty entries
    churn  insertions + deletions of `git diff --numstat <Since> <tree>` (binary files count 0)

  -Since  the tree (or commit) the change is measured from: the previous snapshot, or the start head the first time.
  -Start  the commit the whole change started from, the base of `files`; default HEAD. The deliver loop passes it
          as the head it recorded at the start, since -Since moves on from one snapshot to the next.
  -Dirty  one comma-separated list of the files the user had modified before the start; an entry ending with "/" is
          a whole directory. They are never part of `files`.

  The tree is built with a throwaway index: `<git dir>/index` is copied to `<git dir>/deliver/snap.index`,
  GIT_INDEX_FILE points at the copy for `git add -A` and `git write-tree`, and the copy is removed. The real
  index, the working tree, the refs and the stash are never touched.

  Exit codes: 0 ok, 2 usage error (no -Since, not a git repository, an unknown -Since or -Start).
#>

param(
  [string]$Since,
  [string]$Start = 'HEAD',
  [string]$Dirty
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Fail([string]$Message) {
  [Console]::Error.WriteLine("snapshot.ps1: $Message")
  exit 2
}

# git writes paths as UTF-8
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false

$gitDir = (& git rev-parse --absolute-git-dir 2>$null)
if ($LASTEXITCODE -ne 0 -or -not $gitDir) { Fail 'not inside a git repository' }
if (-not $Since) { Fail 'pass -Since <tree|sha>' }
foreach ($rev in @($Since, $Start)) {
  & git rev-parse --verify --quiet "$rev^{tree}" *> $null
  if ($LASTEXITCODE -ne 0) { Fail "unknown revision: $rev" }
}

$dir = Join-Path $gitDir 'deliver'
$temp = Join-Path $dir 'snap.index'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$real = Join-Path $gitDir 'index'
# git's own variable, set through the .NET API (validate.mjs asks the README to document any `$env:` the kit reads)
$previous = [Environment]::GetEnvironmentVariable('GIT_INDEX_FILE')
try {
  if (Test-Path -LiteralPath $real) { Copy-Item -LiteralPath $real -Destination $temp -Force }
  elseif (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp -Force }
  [Environment]::SetEnvironmentVariable('GIT_INDEX_FILE', $temp)
  & git add -A *> $null
  if ($LASTEXITCODE -ne 0) { throw 'git add -A failed on the throwaway index' }
  $tree = (& git write-tree)
  if ($LASTEXITCODE -ne 0 -or -not $tree) { throw 'git write-tree failed' }
}
finally {
  [Environment]::SetEnvironmentVariable('GIT_INDEX_FILE', $previous)
  Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue
}

# a dirty entry is a file, or a directory when it ends with "/"
$entries = @(($Dirty -split ',') | ForEach-Object { ($_.Trim() -replace '\\', '/') } | Where-Object { $_ })
function IsDirty([string]$Path) {
  foreach ($e in $entries) {
    if ($e.EndsWith('/')) { if ($Path.StartsWith($e, [StringComparison]::OrdinalIgnoreCase)) { return $true } }
    elseif ($Path -ieq $e) { return $true }
  }
  return $false
}

$files = @(& git -c core.quotepath=off diff --name-only $Start $tree | Where-Object { $_ } | Where-Object { -not (IsDirty $_) })
# numstat, not --shortstat: the shortstat text is localized ("inserzioni", "cancellazione") and would count 0; a binary file is "-"
$churn = 0
foreach ($line in (& git diff --numstat $Since $tree)) {
  $cols = $line -split "`t"
  foreach ($n in $cols[0..1]) { if ($n -match '^\d+$') { $churn += [int]$n } }
}

Write-Output ([ordered]@{ tree = $tree; files = $files; churn = $churn } | ConvertTo-Json -Compress)
