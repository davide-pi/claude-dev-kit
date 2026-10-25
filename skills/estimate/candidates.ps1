#requires -Version 7.0
<#
.SYNOPSIS
  Read-only fetch + aggregation for /estimate: completed backlog items of the last N months,
  their Tasks, their Features, the hours (bias-corrected), the outlier marks and the estimate-vs-actual
  bias, as one JSON file plus a one-line-per-item index (with hours) for the model to read.

.DESCRIPTION
  Hierarchy: Feature -> backlog item -> Task. Hours live only on Tasks
  (Microsoft.VSTS.Scheduling.CompletedWork / OriginalEstimate). Type names are discovered by the
  caller (azdo-cli, work-item-roles) and passed in; nothing here guesses them.

  - BacklogType: several allowed; every element is split on ',' and trimmed ('pwsh -File' hands
    'A,B' over as one string).
  - Completed states per type come from workItemTypeStates (category 'Completed'). 'Removed' never counts.
  - Backlog items: type IN BacklogType, State in the completed states, closed in the window
    (ClosedDate >= since; when ClosedDate is empty, or the field is unavailable, ChangedDate is used and
    the field used is recorded per item as dateField), tag 'estimation-excluded' filtered in WIQL.
    Months defaults to 3.
  - Tasks: parents IN (backlog ids), chunked, State <> 'Removed'. Activity is optional in the process.
    A Task with CompletedWork = 0 whose state is not in the Task type's 'Completed' category is dropped
    (it is open work, not history) and counted as openTasksDropped; a Task with CompletedWork > 0 stays
    whatever its state.
  - Features: the distinct parents of the backlog items whose type equals FeatureType. FeatureType may be
    '' (features skipped); a type missing from the project gives a warning and skips features too.
  - Features in the Completed category get their FULL hours (fullHours: true): every backlog-type child
    (no date filter, State <> 'Removed', tag exclusion applied) and the Tasks of those children (same Task
    rules) are fetched; the Feature carries the flat task list (id, assignee, completedWork,
    originalEstimate) so the bias correction can be applied. Other Features keep the hours of their
    items in the window (fullHours: false). Feature hours are raw (completed if > 0, else original).
  - Exclusion is inherited Feature -> backlog item -> Task by the tag 'estimation-excluded'
    (case-insensitive, tags are '; '-separated), re-checked client-side. A Feature drops all its items,
    an item drops itself, a Task drops only itself from the sums.
  - Per item: completedWork and originalEstimate sums, hoursByAssignee (a task counts its completed
    hours if > 0, else its original estimate), owner = the assignee with > 50% of those hours, else null.
    An item with both sums 0 goes to 'discarded' (reason 'no-hours').
  - Bias: over kept tasks with completed > 0 and original > 0, per assignee and overall:
    { pairs, completed, original, factor = completed / original }. The raw sums are not corrected.
  - Per item also: hours = sum over its tasks of completed (if > 0), else original x the assignee's bias
    factor (assignee pairs >= 5, else the overall factor if its pairs >= 5, else 1.0; factor clamped to
    [0.5, 2.0]); hoursCompletedShare (0..1, the part of hours that is logged CompletedWork); ageDays
    (days since the closing date).
  - Outliers (marked, never removed), over the kept items with hours > 0 sorted by hours:
    generic population: the lowest and highest 10% by count (floor(n x 0.10) each side, at least 1 when
    n >= 10, none below) get outlier = 'low' | 'high'. With -Person, over the items whose owner is that
    person: 5% / 5% (floor(n x 0.05), at least 1 each side when n >= 20, none below) get
    personOutlier = 'low' | 'high'. The thresholds are recorded in summary.outliers
    { n, trimEach, lowMax, highMin, person: { name, n, trimEach, lowMax, highMin } }.
  - Features: for each Feature with kept items, { id, title, state, completed, fullHours, items, childItems,
    tasks (full hours only), hours }.
  - Description: HTML stripped, whitespace collapsed, cut to 300 characters.
  - Retry: az errors whose text matches \b(429|5\d\d)\b are retried, 3 attempts, 2 s then 5 s apart.

  Index (second file, '<OutFile without extension>.index.md'), for the model to read. Header lines: window,
  item count, median and P25/P75 (plain interpolated percentiles) of the hours over the non-outlier items,
  and the same median for the person when -Person is given. One line per kept item:
    <id> | <ageBand> | <owner or -> | <hours>h (<completed share %> cons.) | <outlier mark or -> |
    <area leaf> | <tags> | <title> | tasks <n>: <task titles>
  (ageBand = 0-1m|1-2m|2-3m|...; outlier mark = low|high for the generic population, person-low|person-high
  for the person, ',' joined when both; task titles ';'-joined, each cut to 40 characters), then a
  '## Features' section (completed Features only) with  ... | <hours>h | items <n>  (child count) instead
  of the tasks.

  Every query passes --org and -p and repeats [System.TeamProject] inside the WIQL (flat WIQL only).
  Nothing is written to Azure DevOps. Stdout is a short summary (including openTasksDropped, the share of
  task hours that come only from OriginalEstimate, the bias pairs and factor, the outlier counts, and a
  warning when the ChangedDate fallback was used); the data is in OutFile (UTF-8 JSON, also under
  'summary').

.EXAMPLE
  .\candidates.ps1 -Org 'https://dev.azure.com/<org>' -Project '<project>' `
    -BacklogType 'Product Backlog Item' -OutFile "$env:TEMP\estimate-candidates.json"

.EXAMPLE
  .\candidates.ps1 -Org 'https://dev.azure.com/<org>' -Project '<project>' `
    -BacklogType 'Product Backlog Item' -Person '<user@domain>' -OutFile .\candidates.json

.EXAMPLE
  .\candidates.ps1 -Org 'https://dev.azure.com/<org>' -Project '<project>' `
    -BacklogType 'Product Backlog Item','Bug' -FeatureType '' -OutFile .\candidates.json -Today 2026-01-31
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$Org,             # organization URL
  [Parameter(Mandatory)][string]$Project,
  [Parameter(Mandatory)][string[]]$BacklogType,   # e.g. 'Product Backlog Item'; several allowed ('A,B' is split)
  [string]$TaskType    = 'Task',
  [string]$FeatureType = 'Feature',               # '' = no features
  [int]$Months         = 3,
  [string]$Person      = '',                      # '' = none | UPN: adds the person's outlier marks and median
  [Parameter(Mandatory)][string]$OutFile,
  [string]$Today       = ''                       # '' = today | yyyy-MM-dd (for tests)
)

$ErrorActionPreference = 'Stop'

$ExcludeTag = 'estimation-excluded'
$ChunkSize  = 200
$NoAssignee = '(unassigned)'
$MonthDays  = 30.44
$MinBiasPairs = 5
$FactorMin  = 0.5
$FactorMax  = 2.0
$NotFound  = '(?i)not\s*found|does not exist|\b404\b|TF237124|VS402323'

if ($Months -lt 1) { throw "Months must be >= 1 (got $Months)." }
$Org = $Org.TrimEnd('/')
$BacklogType = @($BacklogType | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
if ($BacklogType.Count -eq 0) { throw 'BacklogType is empty.' }
$FeatureType = "$FeatureType".Trim()
$Person = "$Person".Trim()
$useFeatures = [bool]$FeatureType
if ($Today -match '^\s*$')              { $todayD = (Get-Date).Date }
elseif ($Today -match '^\d{4}-\d{2}-\d{2}$') { $todayD = [datetime]::ParseExact($Today, 'yyyy-MM-dd', [cultureinfo]::InvariantCulture) }
else { throw "Invalid Today: '$Today'. Use yyyy-MM-dd or leave empty." }
$sinceD   = $todayD.AddMonths(-$Months)
$sinceStr = $sinceD.ToString('yyyy-MM-dd', [cultureinfo]::InvariantCulture)

# ---- helpers ----
function Esc([string]$s) { $s -replace "'", "''" }
function Num($v) { if ($null -eq $v -or "$v" -eq '') { 0.0 } else { [double]$v } }
function R2([double]$v) { [math]::Round($v, 2) }

function ToIso($v) {
  if ($null -eq $v -or "$v" -eq '') { return $null }
  if ($v -is [datetime]) { return $v.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", [cultureinfo]::InvariantCulture) }
  return [string]$v
}

function ToUtc($v) {
  if ($v -is [datetime]) { return $v.ToUniversalTime() }
  [datetime]::Parse([string]$v, [cultureinfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::AssumeUniversal -bor [System.Globalization.DateTimeStyles]::AdjustToUniversal)
}

function Upn($v) {
  if ($null -eq $v) { return $null }
  $s = if ($v.PSObject.Properties['uniqueName']) { [string]$v.uniqueName } else { [string]$v }
  if ($s -match '<([^>]+)>') { $s = $matches[1] }
  $s = $s.Trim()
  if ($s) { $s } else { $null }
}

function TagList($tags) {
  if (-not $tags) { return @() }
  @(([string]$tags -split ';') | ForEach-Object { $_.Trim() } | Where-Object { $_ })
}
function IsExcluded($tags) { [bool](@(TagList $tags) | Where-Object { $_ -ieq $ExcludeTag }) }

function CleanText([string]$s, [int]$n) {
  if (-not $s) { return '' }
  $s = [regex]::Replace($s, '(?s)<(script|style)[^>]*>.*?</\1>', ' ')
  $s = [regex]::Replace($s, '<[^>]+>', ' ')
  $s = [System.Net.WebUtility]::HtmlDecode($s)
  $s = ($s -replace '\s+', ' ').Trim()
  if ($s.Length -gt $n) { $s = $s.Substring(0, $n).TrimEnd() }
  $s
}

# Index cells: one line, no '|' (the separator) and no ';' (the task-title separator).
function IndexText([string]$s, [int]$n = 0) {
  $s = (("$s" -replace '[\r\n\t]+', ' ' -replace '\s+', ' ').Trim() -replace '\|', '/' -replace ';', ',')
  if ($n -gt 0 -and $s.Length -gt $n) { $s = $s.Substring(0, $n).TrimEnd() }
  $s
}

# One-month bands over the window: 0-1m, 1-2m, ...; no closing date or older than the window = the last band.
function AgeBand($closed) {
  $k = $Months - 1
  if ($closed) {
    $months = [math]::Max(0.0, ($todayD - (ToUtc $closed).Date).TotalDays / $MonthDays)
    $k = [math]::Min($k, [int][math]::Floor($months))
  }
  "$k-$($k + 1)m"
}

# Linear-interpolated percentile (0..100) of an already sorted array; $null when empty.
function Get-Percentile([double[]]$Sorted, [double]$P) {
  if ($Sorted.Count -eq 0) { return $null }
  $pos = $P / 100.0 * ($Sorted.Count - 1)
  $lo = [int][math]::Floor($pos); $hi = [int][math]::Ceiling($pos)
  $Sorted[$lo] + ($Sorted[$hi] - $Sorted[$lo]) * ($pos - $lo)
}

# Marks the lowest and highest PctEach percent (by count) of the items, sorted by hours, with 'low' / 'high'
# under $Key: floor(n x PctEach / 100) per side, at least 1 when n >= MinN, none below. Returns the thresholds.
function Set-Outliers($Items, [string]$Key, [int]$PctEach, [int]$MinN) {
  $sorted = @($Items | Sort-Object @{ e = { $_.hours } }, @{ e = { $_.id } })
  $n = $sorted.Count
  $trim = if ($n -ge $MinN) { [math]::Max(1, [int][math]::Floor($n * $PctEach / 100)) } else { 0 }
  for ($i = 0; $i -lt $trim; $i++) { $sorted[$i][$Key] = 'low'; $sorted[$n - 1 - $i][$Key] = 'high' }
  [ordered]@{
    n = $n; trimEach = $trim
    lowMax  = if ($trim -gt 0) { $sorted[$trim - 1].hours } else { $null }
    highMin = if ($trim -gt 0) { $sorted[$n - $trim].hours } else { $null }
  }
}

function AreaLeaf([string]$Area) { if ($Area) { ($Area -split '\\')[-1] } else { '-' } }

# True when a WIQL failed because it names a field the process does not have (TF51005).
function IsMissingField([string]$Message) { $Message -match 'TF51005|does not exist' }

function Invoke-Az([string[]]$AzArgs) {
  # az writes in the Windows ANSI code page, not UTF-8: decode it as such (restored after each call),
  # otherwise accented titles come back as mojibake.
  $prevEnc = [Console]::OutputEncoding
  $delays  = @(2, 5)
  try {
    try { [Console]::OutputEncoding = [System.Text.Encoding]::GetEncoding([cultureinfo]::CurrentCulture.TextInfo.ANSICodePage) } catch { }
    for ($attempt = 1; $attempt -le 3; $attempt++) {
      $raw  = & az @AzArgs 2>&1
      $code = $LASTEXITCODE
      if ($code -eq 0) { break }
      $err = (@($raw | Where-Object { $_ -is [System.Management.Automation.ErrorRecord] }) | ForEach-Object { $_.ToString() }) -join "`n"
      # throttling (429) and service errors (5xx) are retried; anything else fails at once
      if ($err -notmatch '\b(429|5\d\d)\b' -or $attempt -eq 3) {
        throw "az $($AzArgs[0..2] -join ' ') failed (exit $code): $err"
      }
      Start-Sleep -Seconds $delays[$attempt - 1]
    }
  } finally { try { [Console]::OutputEncoding = $prevEnc } catch { } }
  $text = (@($raw | Where-Object { $_ -isnot [System.Management.Automation.ErrorRecord] }) | ForEach-Object { [string]$_ }) -join "`n"
  if ($text -notmatch '\S') { return $null }
  $text | ConvertFrom-Json -Depth 20
}

function Invoke-Wiql([string]$Wiql) {
  $r = Invoke-Az @('boards', 'query', '--org', $Org, '-p', $Project, '--wiql', $Wiql, '-o', 'json')
  if ($null -eq $r) { return , @() }
  , @($r)
}

# All states of a type; an unknown type gives an error or an empty list, depending on the service.
function Get-TypeStates([string]$Type) {
  $r = Invoke-Az @('devops', 'invoke', '--org', $Org, '--area', 'wit', '--resource', 'workItemTypeStates',
                   '--route-parameters', "project=$Project", "type=$Type", '-o', 'json')
  @($r.value) | Where-Object { $_ }
}

function Get-CompletedStates([string]$Type) {
  , @(@(Get-TypeStates $Type) | Where-Object { $_.category -eq 'Completed' } | ForEach-Object { [string]$_.name })
}

function Split-Chunks([int[]]$Ids) {
  for ($i = 0; $i -lt $Ids.Count; $i += $ChunkSize) {
    , @($Ids[$i..([math]::Min($i + $ChunkSize, $Ids.Count) - 1)])
  }
}

$proj = Esc $Project

# ---- 1. completed states per type ----
$completedStates = [ordered]@{}
foreach ($t in @($BacklogType) + @($TaskType)) {
  if ($completedStates.Contains($t)) { continue }
  $completedStates[$t] = Get-CompletedStates $t
}
foreach ($t in $BacklogType) {
  if ($completedStates[$t].Count -eq 0) { throw "Type '$t' has no state in the 'Completed' category (check the name with workItemTypes)." }
}
if ($useFeatures -and -not $completedStates.Contains($FeatureType)) {
  $featStates = @()
  try { $featStates = @(Get-TypeStates $FeatureType) }
  catch { if ($_.Exception.Message -notmatch $NotFound) { throw } }
  if (@($featStates).Count -eq 0) {
    Write-Warning "Feature type '$FeatureType' not found in project '$Project': features skipped."
    $useFeatures = $false
  }
  else { $completedStates[$FeatureType] = @(@($featStates) | Where-Object { $_.category -eq 'Completed' } | ForEach-Object { [string]$_.name }) }
}

# ---- 2. backlog items ----
$typeClauses = foreach ($t in $BacklogType) {
  $states = ($completedStates[$t] | ForEach-Object { "'$(Esc $_)'" }) -join ','
  "([System.WorkItemType] = '$(Esc $t)' AND [System.State] IN ($states))"
}
$typeFilter = '(' + ($typeClauses -join ' OR ') + ')'
$tagFilter  = "[System.Tags] NOT CONTAINS '$ExcludeTag'"
$baseCols   = '[System.Id],[System.Title],[System.WorkItemType],[System.AreaPath],[System.Tags],[System.Parent],[System.ChangedDate],[System.Description]'
$head       = "WHERE [System.TeamProject] = '$proj' AND $typeFilter"
$winClosed  = "([Microsoft.VSTS.Common.ClosedDate] >= '$sinceStr' OR ([Microsoft.VSTS.Common.ClosedDate] = '' AND [System.ChangedDate] >= '$sinceStr'))"
$winChanged = "[System.ChangedDate] >= '$sinceStr'"

$window = $winClosed
try { $backlogRaw = Invoke-Wiql "SELECT $baseCols,[Microsoft.VSTS.Common.ClosedDate] FROM WorkItems $head AND $tagFilter AND $window" }
catch {
  if (-not (IsMissingField $_.Exception.Message)) { throw }
  Write-Warning "ClosedDate query failed ($($_.Exception.Message)); falling back to ChangedDate."
  $window = $winChanged
  $backlogRaw = Invoke-Wiql "SELECT $baseCols FROM WorkItems $head AND $tagFilter AND $window"
}

# Items the tag filter dropped server-side: counted as excluded, never fetched in full.
$excluded = [System.Collections.Generic.List[object]]::new()
$tagged = Invoke-Wiql "SELECT [System.Id],[System.WorkItemType] FROM WorkItems $head AND [System.Tags] CONTAINS '$ExcludeTag' AND $window"
foreach ($wi in $tagged) {
  $excluded.Add([ordered]@{ id = [int]$wi.id; type = [string]$wi.fields.'System.WorkItemType'; reason = 'tag' })
}

$backlog = @{}   # id -> normalized item
foreach ($wi in $backlogRaw) {
  $f = $wi.fields
  $closed = ToIso $f.'Microsoft.VSTS.Common.ClosedDate'
  $dateField = 'ClosedDate'
  if (-not $closed) { $closed = ToIso $f.'System.ChangedDate'; $dateField = 'ChangedDate' }
  $backlog[[int]$wi.id] = [pscustomobject]@{
    Id = [int]$wi.id; Title = [string]$f.'System.Title'; Type = [string]$f.'System.WorkItemType'
    Area = [string]$f.'System.AreaPath'; Tags = [string]$f.'System.Tags'
    Parent = if ($f.'System.Parent') { [int]$f.'System.Parent' } else { $null }
    ClosedDate = $closed; DateField = $dateField
    Description = CleanText ([string]$f.'System.Description') 300
  }
}

# ---- 4. features (distinct parents whose type is FeatureType) ----
$features = @{}  # id -> { Id, Title, State, Tags, Area }
if ($useFeatures) {
  $parentIds = @($backlog.Values | Where-Object { $null -ne $_.Parent } | ForEach-Object { $_.Parent } | Sort-Object -Unique)
  foreach ($chunk in (Split-Chunks $parentIds)) {
    $w = "SELECT [System.Id],[System.Title],[System.WorkItemType],[System.Tags],[System.State],[System.AreaPath] FROM WorkItems " +
         "WHERE [System.TeamProject] = '$proj' AND [System.Id] IN ($($chunk -join ','))"
    foreach ($wi in (Invoke-Wiql $w)) {
      $f = $wi.fields
      if ([string]$f.'System.WorkItemType' -ne $FeatureType) { continue }
      $features[[int]$wi.id] = [pscustomobject]@{
        Id = [int]$wi.id; Title = [string]$f.'System.Title'; State = [string]$f.'System.State'; Tags = [string]$f.'System.Tags'
        Area = [string]$f.'System.AreaPath'
      }
    }
  }
}

# ---- 5. exclusion (Feature -> backlog item) ----
$keptItems = [System.Collections.Generic.List[object]]::new()
foreach ($it in ($backlog.Values | Sort-Object Id)) {
  if ($null -ne $it.Parent -and $features.ContainsKey($it.Parent) -and (IsExcluded $features[$it.Parent].Tags)) {
    $excluded.Add([ordered]@{ id = $it.Id; type = $it.Type; reason = "feature-tag:$($it.Parent)" }); continue
  }
  if (IsExcluded $it.Tags) { $excluded.Add([ordered]@{ id = $it.Id; type = $it.Type; reason = 'tag' }); continue }
  $keptItems.Add($it)
}

# ---- 3. tasks ----
$hasActivity = $true
$openTasksDropped = 0
$tasksByParent = @{}   # parent id -> list of task objects
$tasksFetched  = [System.Collections.Generic.HashSet[int]]::new()
$taskDone = @($completedStates[$TaskType])
$taskCols = '[System.Id],[System.Title],[System.Parent],[System.AssignedTo],[System.Tags],[System.State],' +
            '[Microsoft.VSTS.Scheduling.CompletedWork],[Microsoft.VSTS.Scheduling.OriginalEstimate]'

# Fetches the Tasks of the given parents (once per parent) into $tasksByParent, applying the task rules:
# tag exclusion; open work (no CompletedWork, state not Completed) dropped and counted.
function Get-Tasks([int[]]$ParentIds) {
  $todo = @($ParentIds | Where-Object { $tasksFetched.Add($_) })
  foreach ($chunk in (Split-Chunks $todo)) {
    $tail = "FROM WorkItems WHERE [System.TeamProject] = '$proj' AND [System.WorkItemType] = '$(Esc $TaskType)' " +
            "AND [System.Parent] IN ($($chunk -join ',')) AND [System.State] <> 'Removed'"
    $rows = $null
    if ($script:hasActivity) {
      try { $rows = Invoke-Wiql "SELECT $taskCols,[Microsoft.VSTS.Common.Activity] $tail" }
      catch {
        if (-not (IsMissingField $_.Exception.Message)) { throw }
        $script:hasActivity = $false; Write-Warning "Activity field unavailable; retrying without it ($($_.Exception.Message))."
      }
    }
    if ($null -eq $rows) { $rows = Invoke-Wiql "SELECT $taskCols $tail" }
    foreach ($wi in $rows) {
      $f = $wi.fields
      $pid_ = [int]$f.'System.Parent'
      $act = [string]$f.'Microsoft.VSTS.Common.Activity'
      $task = [pscustomobject]@{
        Id = [int]$wi.id; Title = [string]$f.'System.Title'; Activity = if ($act) { $act } else { $null }
        Assignee = Upn $f.'System.AssignedTo'; Tags = [string]$f.'System.Tags'; State = [string]$f.'System.State'
        Completed = Num $f.'Microsoft.VSTS.Scheduling.CompletedWork'; Original = Num $f.'Microsoft.VSTS.Scheduling.OriginalEstimate'
      }
      if (IsExcluded $task.Tags) { $excluded.Add([ordered]@{ id = $task.Id; type = $TaskType; reason = 'tag' }); continue }
      if ($task.Completed -le 0 -and $task.State -notin $taskDone) { $script:openTasksDropped++; continue }
      if (-not $tasksByParent.ContainsKey($pid_)) { $tasksByParent[$pid_] = [System.Collections.Generic.List[object]]::new() }
      $tasksByParent[$pid_].Add($task)
    }
  }
}
Get-Tasks @($keptItems | ForEach-Object { $_.Id })

# ---- 6. per-item aggregation ----
$itemsOut  = [System.Collections.Generic.List[object]]::new()
$discarded = [System.Collections.Generic.List[object]]::new()
$itemHours = @{}   # id -> hours (completed if > 0 else original, per task)
$allTasks  = [System.Collections.Generic.List[object]]::new()
foreach ($it in $keptItems) {
  $tasks = if ($tasksByParent.ContainsKey($it.Id)) { @($tasksByParent[$it.Id] | Sort-Object Id) } else { @() }
  $sumC = 0.0; $sumO = 0.0
  $byAss = @{}
  foreach ($t in $tasks) {
    $sumC += $t.Completed; $sumO += $t.Original
    $h = if ($t.Completed -gt 0) { $t.Completed } else { $t.Original }
    $key = if ($t.Assignee) { $t.Assignee } else { $NoAssignee }
    if (-not $byAss.ContainsKey($key)) { $byAss[$key] = 0.0 }
    $byAss[$key] += $h
  }
  if ($sumC -le 0 -and $sumO -le 0) { $discarded.Add([ordered]@{ id = $it.Id; reason = 'no-hours' }); continue }

  $total = ($byAss.Values | Measure-Object -Sum).Sum
  $owner = $null
  if ($total -gt 0) {
    $top = $byAss.GetEnumerator() | Sort-Object Value -Descending | Select-Object -First 1
    if ($top.Key -ne $NoAssignee -and ($top.Value / $total) -gt 0.5) { $owner = $top.Key }
  }
  $hba = [ordered]@{}
  foreach ($k in ($byAss.Keys | Sort-Object)) { $hba[$k] = R2 $byAss[$k] }
  $itemHours[$it.Id] = $total
  foreach ($t in $tasks) { $allTasks.Add($t) }

  $feat = if ($null -ne $it.Parent -and $features.ContainsKey($it.Parent)) { $features[$it.Parent] } else { $null }
  $itemsOut.Add([ordered]@{
    id = $it.Id; title = $it.Title; type = $it.Type; area = $it.Area
    tags = @(TagList $it.Tags); closedDate = $it.ClosedDate; dateField = $it.DateField
    description = $it.Description
    featureId = if ($feat) { $feat.Id } else { $null }
    featureTitle = if ($feat) { $feat.Title } else { $null }
    completedWork = R2 $sumC; originalEstimate = R2 $sumO
    owner = $owner; hoursByAssignee = $hba
    tasks = @($tasks | ForEach-Object {
      [ordered]@{ id = $_.Id; title = $_.Title; activity = $_.Activity; assignee = $_.Assignee
                  completedWork = R2 $_.Completed; originalEstimate = R2 $_.Original }
    })
  })
}

# ---- 7. bias ----
function New-BiasStat($Tasks) {
  $c = 0.0; $o = 0.0; $n = 0
  foreach ($t in $Tasks) { $c += $t.Completed; $o += $t.Original; $n++ }
  [ordered]@{ pairs = $n; completed = R2 $c; original = R2 $o; factor = if ($o -gt 0) { [math]::Round($c / $o, 4) } else { $null } }
}
$pairs = @($allTasks | Where-Object { $_.Completed -gt 0 -and $_.Original -gt 0 })
$byPerson = [ordered]@{}
foreach ($g in ($pairs | Where-Object { $_.Assignee } | Group-Object Assignee | Sort-Object Name)) {
  $byPerson[$g.Name] = New-BiasStat $g.Group
}
$bias = [ordered]@{ byPerson = $byPerson; all = New-BiasStat $pairs }

# ---- 7b. bias-corrected hours, age and outlier marks per item ----
# Factor for a task without CompletedWork: the assignee's, else the overall one, else 1.0; clamped.
function Get-BiasFactor($Assignee) {
  $f = 1.0
  $p = if ($Assignee -and $bias.byPerson.Contains($Assignee)) { $bias.byPerson[$Assignee] } else { $null }
  if ($p -and $p.pairs -ge $MinBiasPairs -and $null -ne $p.factor) { $f = $p.factor }
  elseif ($bias.all.pairs -ge $MinBiasPairs -and $null -ne $bias.all.factor) { $f = $bias.all.factor }
  [math]::Min($FactorMax, [math]::Max($FactorMin, [double]$f))
}
foreach ($o in $itemsOut) {
  $h = 0.0; $hc = 0.0
  foreach ($t in $tasksByParent[$o.id]) {
    if ($t.Completed -gt 0) { $h += $t.Completed; $hc += $t.Completed }
    else { $h += $t.Original * (Get-BiasFactor $t.Assignee) }
  }
  $o.hours = R2 $h
  $o.hoursCompletedShare = if ($h -gt 0) { [math]::Round($hc / $h, 3) } else { 0.0 }
  $o.ageDays = if ($o.closedDate) { [int][math]::Max(0, [math]::Floor(($todayD - (ToUtc $o.closedDate).Date).TotalDays)) } else { $null }
  $o.outlier = $null
  $o.personOutlier = $null
}
$popGeneric = @($itemsOut | Where-Object { $_.hours -gt 0 })
$outliers = Set-Outliers $popGeneric 'outlier' 10 10
$outliers.person = $null
if ($Person) {
  $popPerson = @($popGeneric | Where-Object { $_.owner -ieq $Person })
  $personStat = Set-Outliers $popPerson 'personOutlier' 5 20
  $outliers.person = [ordered]@{ name = $Person; n = $personStat.n; trimEach = $personStat.trimEach; lowMax = $personStat.lowMax; highMin = $personStat.highMin }
}

# ---- 8. features: full hours for the completed ones ----
$featIds = @($itemsOut | Where-Object { $null -ne $_.featureId } | ForEach-Object { $_.featureId } | Sort-Object -Unique)
$fullIds = @($featIds | Where-Object { @($completedStates[$FeatureType]) -contains $features[$_].State })
$children = @{}   # feature id -> list of child backlog item ids (all states but Removed, not excluded)
if ($fullIds.Count -gt 0) {
  $btypes = ($BacklogType | ForEach-Object { "'$(Esc $_)'" }) -join ','
  foreach ($chunk in (Split-Chunks $fullIds)) {
    $w = "SELECT [System.Id],[System.Parent],[System.Tags] FROM WorkItems WHERE [System.TeamProject] = '$proj' " +
         "AND [System.Parent] IN ($($chunk -join ',')) AND [System.WorkItemType] IN ($btypes) " +
         "AND [System.State] <> 'Removed' AND $tagFilter"
    foreach ($wi in (Invoke-Wiql $w)) {
      if (IsExcluded ([string]$wi.fields.'System.Tags')) { continue }
      $fid = [int]$wi.fields.'System.Parent'
      if (-not $children.ContainsKey($fid)) { $children[$fid] = [System.Collections.Generic.List[int]]::new() }
      $children[$fid].Add([int]$wi.id)
    }
  }
  Get-Tasks @($children.Values | ForEach-Object { $_ } | Sort-Object -Unique)
}

$featOut = @(foreach ($fid in $featIds) {
  $f = $features[$fid]
  $ids = @($itemsOut | Where-Object { $_.featureId -eq $fid } | ForEach-Object { $_.id })
  $isFull = $fullIds -contains $fid
  $o = [ordered]@{
    id = $f.Id; title = $f.Title; state = $f.State
    completed = [bool](@($completedStates[$FeatureType]) -contains $f.State)
    fullHours = $isFull; items = $ids
  }
  if ($isFull) {
    $kids = if ($children.ContainsKey($fid)) { @($children[$fid] | Sort-Object -Unique) } else { @() }
    $ft = @($kids | ForEach-Object { if ($tasksByParent.ContainsKey($_)) { $tasksByParent[$_] } } | Sort-Object Id)
    $hours = 0.0
    foreach ($t in $ft) { $hours += $(if ($t.Completed -gt 0) { $t.Completed } else { $t.Original }) }
    $o.childItems = $kids.Count
    $o.tasks = @($ft | ForEach-Object {
      [ordered]@{ id = $_.Id; assignee = $_.Assignee; completedWork = R2 $_.Completed; originalEstimate = R2 $_.Original }
    })
    $o.hours = R2 $hours
  } else {
    $hours = 0.0
    foreach ($i in $ids) { $hours += $itemHours[$i] }
    $o.childItems = $ids.Count
    $o.hours = R2 $hours
  }
  $o
})

# ---- 9. summary figures ----
$changedFallback = @($itemsOut | Where-Object { $_.dateField -eq 'ChangedDate' }).Count
$hAll = 0.0; $hEst = 0.0
foreach ($t in $allTasks) {
  if ($t.Completed -gt 0) { $hAll += $t.Completed } else { $hAll += $t.Original; $hEst += $t.Original }
}
$estOnlyPct = if ($hAll -gt 0) { [math]::Round(100.0 * $hEst / $hAll, 1) } else { 0.0 }
$summary = [ordered]@{ openTasksDropped = $openTasksDropped; changedDateFallback = $changedFallback; estimateOnlyHoursPct = $estOnlyPct; outliers = $outliers }

# ---- output ----
$result = [ordered]@{
  project = $Project; org = $Org
  generatedAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", [cultureinfo]::InvariantCulture)
  windowMonths = $Months; since = $sinceStr
  types = [ordered]@{ backlog = @($BacklogType); task = $TaskType; feature = $(if ($useFeatures) { $FeatureType } else { $null }) }
  completedStates = $completedStates
  summary = $summary
  items = @($itemsOut); features = @($featOut); bias = $bias
  excluded = @($excluded); discarded = @($discarded)
}
$dir = Split-Path -Parent $OutFile
if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
$result | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $OutFile -Encoding utf8

# ---- index (with hours) ----
function Fmt($v) { if ($null -eq $v) { 'n/a' } else { ([double]$v).ToString('0.##', [cultureinfo]::InvariantCulture) } }
function Get-HoursStat($Items) {
  $s = [double[]]@($Items | ForEach-Object { [double]$_.hours } | Sort-Object)
  "n=$($s.Count), median $(Fmt (Get-Percentile $s 50))h, P25 $(Fmt (Get-Percentile $s 25))h, P75 $(Fmt (Get-Percentile $s 75))h"
}
$indexPath = [System.IO.Path]::Combine($dir, [System.IO.Path]::GetFileNameWithoutExtension($OutFile) + '.index.md')
$idx = [System.Collections.Generic.List[string]]::new()
$idx.Add("# Estimate index: $Project")
$idx.Add('')
$idx.Add("Window: last $Months months (since $sinceStr) | items: $($itemsOut.Count)")
$idx.Add("Hours, generic, outliers excluded: $(Get-HoursStat @($popGeneric | Where-Object { -not $_.outlier }))")
if ($Person) {
  $idx.Add("Hours, $($Person), person's own items, person outliers excluded: $(Get-HoursStat @($popPerson | Where-Object { -not $_.personOutlier }))")
}
$idx.Add('')
$idx.Add('<id> | <age band> | <owner> | <hours>h (<completed share> cons.) | <outlier> | <area leaf> | <tags> | <title> | tasks <n>: <task titles>')
$idx.Add('outlier: low|high = generic population, person-low|person-high = the person''s own items, - = none')
$idx.Add('')
foreach ($i in $itemsOut) {
  $tags = if (@($i.tags).Count -gt 0) { (@($i.tags) | ForEach-Object { IndexText $_ }) -join ',' } else { '-' }
  $titles = (@($i.tasks) | ForEach-Object { IndexText $_.title 40 }) -join ';'
  $marks = @(if ($i.outlier) { $i.outlier }; if ($i.personOutlier) { "person-$($i.personOutlier)" }) -join ','
  $idx.Add("$($i.id) | $(AgeBand $i.closedDate) | $(if ($i.owner) { IndexText $i.owner } else { '-' }) | $(Fmt $i.hours)h ($([math]::Round(100.0 * $i.hoursCompletedShare))% cons.) | $(if ($marks) { $marks } else { '-' }) | $(IndexText (AreaLeaf $i.area)) | $tags | $(IndexText $i.title) | tasks $(@($i.tasks).Count): $titles")
}
$idx.Add('')
$idx.Add('## Features')
$idx.Add('')
foreach ($fo in ($featOut | Where-Object { $_.completed })) {
  $f = $features[$fo.id]
  $latest = @($itemsOut | Where-Object { $fo.items -contains $_.id } | ForEach-Object { ToUtc $_.closedDate } | Sort-Object -Descending | Select-Object -First 1)
  $ftags = @(TagList $f.Tags)
  $tags = if ($ftags.Count -gt 0) { ($ftags | ForEach-Object { IndexText $_ }) -join ',' } else { '-' }
  $idx.Add("$($f.Id) | $(AgeBand $(if ($latest.Count -gt 0) { $latest[0] } else { $null })) | $(IndexText (AreaLeaf $f.Area)) | $tags | $(IndexText $f.Title) | $(Fmt $fo.hours)h | items $($fo.childItems)")
}
Set-Content -LiteralPath $indexPath -Value $idx -Encoding utf8

$exTasks = @($excluded | Where-Object { $_.type -eq $TaskType }).Count
$exItems = $excluded.Count - $exTasks
Write-Output "=== ESTIMATE CANDIDATES $Project ==="
Write-Output "Window: $Months months (since $sinceStr, today $($todayD.ToString('yyyy-MM-dd')))"
Write-Output ("Kept: {0} items, {1} tasks, {2} features | Excluded: {3} items, {4} tasks | Discarded: {5} (no-hours)" -f `
  $itemsOut.Count, $allTasks.Count, @($featOut).Count, $exItems, $exTasks, $discarded.Count)
Write-Output ("Features with full hours: {0} | openTasksDropped: {1}" -f $fullIds.Count, $openTasksDropped)
Write-Output ("Task hours from OriginalEstimate only: {0}%" -f $estOnlyPct)
$bf = $bias.all.factor
Write-Output ("Bias overall: pairs={0} factor={1}" -f $bias.all.pairs, $(if ($null -ne $bf) { $bf } else { 'n/a' }))
Write-Output ("Outliers (generic): n={0} trim={1}+{1} lowMax={2} highMin={3} | marked low={4} high={5}" -f `
  $outliers.n, $outliers.trimEach, $(Fmt $outliers.lowMax), $(Fmt $outliers.highMin),
  @($itemsOut | Where-Object { $_.outlier -eq 'low' }).Count, @($itemsOut | Where-Object { $_.outlier -eq 'high' }).Count)
if ($Person) {
  $po = $outliers.person
  Write-Output ("Outliers (person {0}): n={1} trim={2}+{2} lowMax={3} highMin={4} | marked low={5} high={6}" -f `
    $Person, $po.n, $po.trimEach, $(Fmt $po.lowMax), $(Fmt $po.highMin),
    @($itemsOut | Where-Object { $_.personOutlier -eq 'low' }).Count, @($itemsOut | Where-Object { $_.personOutlier -eq 'high' }).Count)
}
if ($changedFallback -gt 0) { Write-Output "WARNING: $changedFallback item(s) use System.ChangedDate as closing date (ClosedDate empty or unavailable)." }
Write-Output "Out: $OutFile"
Write-Output "Index: $indexPath"
