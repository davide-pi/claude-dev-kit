# Console output helpers (dot-sourced by ..\install.ps1, which owns the parameters and script state).

function Write-Ok      ([string]$m) { Write-Host "  ok      $m" -ForegroundColor DarkGray }
function Write-Info    ([string]$m) { Write-Host "  ...     $m" -ForegroundColor Gray }
function Write-Change  ([string]$m) { Write-Host "  changed $m" -ForegroundColor Cyan }
function Write-Problem ([string]$m) { $script:Problems++; Write-Host "  ISSUE   $m" -ForegroundColor Yellow }
function Write-Section ([string]$m) { Write-Host "`n$m" -ForegroundColor White }
