#Requires -Version 7.0
<#
.SYNOPSIS
  Runs the `claude plugin eval` suites of the skills that changed against a base ref.

.DESCRIPTION
  pwsh -NoProfile -File tools/run-evals.ps1 [-Base <ref>] [-Suite <name,...> | -All] [-MaxCostUsd 2]
                                           [-Case <glob>] [-Runs <n>] [-Threshold 0.5] [-Model <name>] [-List]

  A suite is a folder `evals/<skill>/` holding one case per subfolder (`prompt.md` + `graders/*.md`),
  tagged with the skill name. A suite runs when a file under `skills/<skill>/` or `evals/<skill>/`
  differs from -Base (committed, staged, unstaged or untracked); -Suite and -All override that.

  Every real run goes through `claude plugin eval` as you, on your credential:
    --ablation none     the triggering graders (`tool_used: Skill`) count in the score
    --no-publish        the HTML report stays local (under $env:TEMP\kit-evals\<stamp>\<suite>)
    --max-cost-usd      per suite, default 2: the run stops and reports partial results at the cap
  No case can write: the cases grant no shell or write tool, so nothing reaches Azure DevOps, a
  database or the network.

  -Base defaults to the remote default branch (origin/HEAD), else `main`.
  Exit codes: 0 all suites at or above -Threshold, 1 a case below it or a run error, 2 the cost cap
  was hit (partial results), 3 usage error. -List prints the suites that would run and exits 0.
#>

[CmdletBinding()]
param(
    [string]$Base,
    [string[]]$Suite,
    [string]$Case,
    [switch]$All,
    [double]$MaxCostUsd = 2,
    [int]$Runs,
    [double]$Threshold = 0.5,
    [string]$Model,
    [switch]$List
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false

$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$EvalsDir = Join-Path $Root 'evals'

function Get-Suites {
    if (-not (Test-Path -LiteralPath $EvalsDir)) { return @() }
    Get-ChildItem -LiteralPath $EvalsDir -Directory |
        Where-Object { $_.Name -ne 'results' -and (Get-ChildItem -LiteralPath $_.FullName -Recurse -Filter prompt.md -File -ErrorAction SilentlyContinue) } |
        ForEach-Object { $_.Name }
}

$available = @(Get-Suites)

if ($All) {
    $selected = $available
}
elseif ($Suite) {
    $unknown = @($Suite | Where-Object { $_ -notin $available })
    if ($unknown) { [Console]::Error.WriteLine("no suite: $($unknown -join ', ') (have: $($available -join ', '))"); exit 3 }
    $selected = @($Suite)
}
else {
    if (-not $Base) {
        $head = git -C $Root symbolic-ref --short refs/remotes/origin/HEAD 2>$null
        $Base = if ($LASTEXITCODE -eq 0 -and $head) { $head } else { 'main' }
    }
    git -C $Root rev-parse --verify --quiet "$Base^{commit}" *> $null
    if ($LASTEXITCODE -ne 0) { [Console]::Error.WriteLine("base ref '$Base' not found"); exit 3 }

    $changed = @(
        git -C $Root diff --name-only "$Base...HEAD"          # committed on this branch
        git -C $Root diff --name-only HEAD                    # staged + unstaged
        git -C $Root ls-files --others --exclude-standard     # untracked
    ) | Where-Object { $_ } | Sort-Object -Unique

    $selected = @($changed |
        ForEach-Object { if ($_ -match '^(?:skills|evals)/([^/]+)/') { $Matches[1] } } |
        Sort-Object -Unique |
        Where-Object { $_ -in $available })
    Write-Host "base $Base - $($changed.Count) changed file(s)"
}

if (-not $selected) { Write-Host 'no suite to run (no skill with an eval suite changed)'; exit 0 }
Write-Host "suites: $($selected -join ', ')"
if ($List) { exit 0 }

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$out = Join-Path ([System.IO.Path]::GetTempPath()) "kit-evals\$stamp"
$exit = 0
$total = 0.0

foreach ($name in $selected) {
    $dir = Join-Path $out $name
    $evalArgs = @(
        'plugin', 'eval', $Root,
        '--tag', $name,
        '--ablation', 'none',
        '--max-cost-usd', "$MaxCostUsd",
        '--threshold', "$Threshold",
        '--no-publish', '--trust-plugin',
        '--output-dir', $dir,
        '--json', (Join-Path $out "$name.json")
    )
    if ($Runs -gt 0) { $evalArgs += @('--runs', "$Runs") }
    if ($Case) { $evalArgs += @('--case', $Case) }
    if ($Model) { $evalArgs += @('--model', $Model) }

    Write-Host "`n== $name"
    New-Item -ItemType Directory -Force -Path $out | Out-Null
    & claude @evalArgs
    $code = $LASTEXITCODE
    if ($code -gt $exit) { $exit = $code }

    $json = Join-Path $out "$name.json"
    if (Test-Path -LiteralPath $json) {
        # --json <path> replaces the per-run lines on stdout, so the scores are printed from the file.
        $result = Get-Content -Raw -LiteralPath $json | ConvertFrom-Json
        $total += [double]$result.costUsd
        foreach ($row in $result.cases) {
            foreach ($arm in $row.arms.with) {
                $verdict = if ($arm.error) { "error: $($arm.error)" } else { '' }
                Write-Host ('  {0,-34} score {1:N2}  ${2:N2} {3}' -f $row.name, $arm.score, $arm.costUsd, $verdict)
                foreach ($g in @($arm.graders | Where-Object { -not $_.passed })) { Write-Host "      FAIL $($g.name): $($g.explanation)" }
            }
        }
    }
}

Write-Host ("`nreports and traces: {0}   total cost: `${1:N2}   exit: {2}" -f $out, $total, $exit)
exit $exit
