<#
.SYNOPSIS
  Read-only SQL Server access to non-dev environments, through go-sqlcmd.

.DESCRIPTION
  pwsh -NoProfile -File sql-ro.ps1 -Env <env> [-Db <name>] (-Query "<sql>" | -File <path.sql>)
                                   [-MaxLines 200] [-Wide] [-Project <workspace root>]

  Targets come from $HOME\.claude\db-targets.json:

    { "devHosts": ["localhost", ...],
      "targets": { "<workspace root>": { "<env>": {
          "server": "host,1433", "auth": "<connection-string fragment>"   (or "user" + "password"),
          "databases": ["Db1", "Db2"], "encrypt": true, "trustServerCertificate": false,
          "applicationIntent": "ReadOnly" } } } }

  The workspace is the longest registry key that prefixes -Project (default: the current directory).
  Any string value may be a literal, `env:NAME` (process, then user environment) or
  `envfile:<path>#KEY` (a dotenv file). `auth` is a connection-string fragment: only its user and
  secret keys (User Id / UID, and the secret under either of its two usual names) are read.

  Guarantees:
    - the secret never reaches argv or the output: it travels in SQLCMDPASSWORD, set for this
      process only, and every message is scrubbed of it;
    - the login is checked first (separate sqlcmd call): any permission beyond read/view, or any
      owner / writer / ddl role, aborts before the user SQL runs (fail closed);
    - the user SQL cannot carry sqlcmd commands (:r, :!!, :setvar, ED, RESET, ...): they are rejected.

  Exit codes: 0 ok, 2 usage or registry error, 3 permission gate refused, otherwise sqlcmd's.

  Why no -X1 on sqlcmd: go-sqlcmd then ignores SQLCMDPASSWORD and prompts for it, so the input
  filter is the barrier against sqlcmd commands, not the -X switch.
#>

# No [CmdletBinding()]: its common -Debug parameter owns the alias "db", which -Db must keep.
param(
  [string]$Env,
  [string]$Db,
  [string]$Query,
  [string]$File,
  [int]$MaxLines = 200,
  [switch]$Wide,
  [string]$Project
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Permissions a read-only login may hold (anything starting with "VIEW " is allowed too).
$AllowedPermissions = @(
  'CONNECT', 'CONNECT SQL', 'CONNECT ANY DATABASE', 'SELECT', 'SELECT ALL USER SECURABLES',
  'SHOWPLAN', 'REFERENCES', 'AUTHENTICATE'
)
$RoleFlags = @('sysadmin', 'db_owner', 'db_datawriter', 'db_ddladmin')
$ClearedSqlcmdVars = @('SQLCMDINI', 'SQLCMDUSER', 'SQLCMDSERVER', 'SQLCMDDBNAME')

$script:Secret = $null
$script:TempFiles = [System.Collections.Generic.List[string]]::new()

class WrapperError : System.Exception {
  [int]$Code
  WrapperError([string]$message, [int]$code) : base($message) { $this.Code = $code }
}

function Stop-Wrapper([string]$Message, [int]$Code = 2) {
  throw [WrapperError]::new($Message, $Code)
}

# Replace the secret in any text that may reach the screen.
function Hide-Secret([string]$Text) {
  if ($script:Secret -and $Text) { return $Text.Replace($script:Secret, '***') }
  return $Text
}

# ---- value references -------------------------------------------------------------------------

function Read-DotEnv([string]$Path) {
  $values = @{}
  foreach ($raw in [System.IO.File]::ReadAllLines($Path)) {
    $line = $raw.Trim()
    if (-not $line -or $line.StartsWith('#')) { continue }
    if ($line -match '^export\s+') { $line = $line -replace '^export\s+', '' }
    $eq = $line.IndexOf('=')
    if ($eq -lt 1) { continue }
    $key = $line.Substring(0, $eq).Trim()
    $value = $line.Substring($eq + 1).Trim()
    if ($value.Length -ge 2 -and $value[0] -eq "'" -and $value[-1] -eq "'") {
      $values[$key] = $value.Substring(1, $value.Length - 2)   # single quotes: literal
      continue
    }
    if ($value.Length -ge 2 -and $value[0] -eq '"' -and $value[-1] -eq '"') {
      $value = $value.Substring(1, $value.Length - 2)
    }
    # Docker Compose interpolates unquoted and double-quoted values: the file is a compose .env, and
    # the secret the server knows is the interpolated one. $$ -> $, ${VAR} / $VAR -> process env,
    # then keys defined earlier in the file, else empty.
    $values[$key] = [regex]::Replace($value, '\$\$|\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)', {
      param($m)
      if ($m.Value -eq '$$') { return '$' }
      $name = if ($m.Groups[1].Success) { $m.Groups[1].Value } else { $m.Groups[2].Value }
      $fromEnv = [System.Environment]::GetEnvironmentVariable($name)
      if ($null -ne $fromEnv) { return $fromEnv }
      if ($values.ContainsKey($name)) { return $values[$name] }
      return ''
    })
  }
  return $values
}

# literal | env:NAME | envfile:<path>#KEY  ->  the value. Messages carry names, never values.
function Resolve-Ref($Value, [string]$What) {
  if ($null -eq $Value) { return $null }
  $text = [string]$Value

  if ($text -match '^env:(.+)$') {
    $name = $Matches[1]
    $resolved = [System.Environment]::GetEnvironmentVariable($name)
    if (-not $resolved) { $resolved = [System.Environment]::GetEnvironmentVariable($name, 'User') }
    if (-not $resolved) { Stop-Wrapper "Registry: $What references env:$name, which is not set." }
    return $resolved
  }

  if ($text -match '^envfile:(.+)#([^#]+)$') {
    $path = $Matches[1].Trim()
    $key = $Matches[2].Trim()
    if ($path -eq '~' -or $path.StartsWith('~/') -or $path.StartsWith('~\')) {
      $path = Join-Path $HOME $path.Substring(1).TrimStart('/', '\')
    }
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
      Stop-Wrapper "Registry: $What references envfile '$path', which does not exist."
    }
    $entries = Read-DotEnv $path
    if (-not $entries.ContainsKey($key) -or -not $entries[$key]) {
      Stop-Wrapper "Registry: $What references key '$key', missing or empty in '$path'."
    }
    return $entries[$key]
  }

  return $text
}

# A connection-string fragment -> its user and secret (keys case-insensitive, others ignored).
function Read-AuthFragment([string]$Fragment) {
  $login = $null
  $secret = $null
  foreach ($pair in $Fragment.Split(';')) {
    $eq = $pair.IndexOf('=')
    if ($eq -lt 1) { continue }
    $key = $pair.Substring(0, $eq).Trim().ToLowerInvariant()
    $value = $pair.Substring($eq + 1).Trim()
    switch ($key) {
      { $_ -in 'user id', 'userid', 'uid', 'user' } { $login = $value }
      { $_ -in 'password', 'pwd' } { $secret = $value }
    }
  }
  return @{ User = $login; Secret = $secret }
}

# ---- registry ---------------------------------------------------------------------------------

function ConvertTo-PlainPath([string]$Path) {
  return $Path.Trim().Replace('/', '\').TrimEnd('\')
}

function Get-RegistryHelp($Targets) {
  $lines = foreach ($root in $Targets.PSObject.Properties) {
    $envs = ($root.Value.PSObject.Properties | ForEach-Object { $_.Name }) -join ', '
    "  $($root.Name): $envs"
  }
  return "Available workspace roots and environments:`n" + ($lines -join "`n")
}

function Get-HostOf([string]$Server) {
  $name = $Server.Trim() -replace '^(?i:tcp:)', ''
  return ($name -split '[,\\]')[0]
}

function Resolve-Target([string]$EnvName, [string]$ProjectPath) {
  $registryPath = Join-Path $HOME '.claude\db-targets.json'
  if (-not (Test-Path -LiteralPath $registryPath -PathType Leaf)) {
    Stop-Wrapper "Registry not found: $registryPath"
  }
  try {
    $registry = Get-Content -LiteralPath $registryPath -Raw | ConvertFrom-Json
  } catch {
    Stop-Wrapper "Registry is not valid JSON: $registryPath"
  }
  if (-not $registry.PSObject.Properties['targets']) { Stop-Wrapper "Registry has no 'targets'." }

  $where = ConvertTo-PlainPath $ProjectPath
  $best = $null
  foreach ($root in $registry.targets.PSObject.Properties) {
    $key = ConvertTo-PlainPath $root.Name
    $isPrefix = $where.Equals($key, 'OrdinalIgnoreCase') -or
      $where.StartsWith($key + '\', [System.StringComparison]::OrdinalIgnoreCase)
    if ($isPrefix -and ($null -eq $best -or $key.Length -gt $best.Key.Length)) {
      $best = @{ Key = $key; Envs = $root.Value }
    }
  }
  if (-not $best) {
    Stop-Wrapper "No registry entry covers '$where'.`n$(Get-RegistryHelp $registry.targets)"
  }

  $match = $best.Envs.PSObject.Properties | Where-Object { $_.Name -ieq $EnvName } | Select-Object -First 1
  if (-not $match) {
    Stop-Wrapper "Environment '$EnvName' is not registered for '$($best.Key)'.`n$(Get-RegistryHelp $registry.targets)"
  }

  $devHosts = @('localhost', '127.0.0.1', '(local)', '.', 'host.docker.internal')
  if ($registry.PSObject.Properties['devHosts']) { $devHosts = @($registry.devHosts) }
  return @{ Root = $best.Key; Target = $match.Value; DevHosts = $devHosts }
}

function Get-Setting($Target, [string]$Name) {
  $property = $Target.PSObject.Properties[$Name]
  if ($property) { return $property.Value }
  return $null
}

# ---- input filter -----------------------------------------------------------------------------

# sqlcmd commands live at the start of a line. Any line that could be one is refused; GO stays.
function Assert-PlainSql([string]$Sql) {
  $number = 0
  foreach ($raw in ($Sql -split "`r`n|`n|`r")) {
    $number++
    $line = $raw.Trim().TrimStart([char]0xFEFF).Trim()
    $reason = $null
    if ($line.StartsWith(':')) { $reason = 'a sqlcmd command (:r, :!!, :setvar, :connect, :out, ...)' }
    elseif ($line.StartsWith('!!')) { $reason = 'a shell escape (!!)' }
    elseif ($line -match '^(?i:ED|RESET|EXIT|QUIT)\s*$' -or $line -match '^(?i:EXIT|QUIT)\s*\(') {
      $reason = 'a sqlcmd command (ED, RESET, EXIT, QUIT)'
    } elseif ($line -match '^(?i:GO)(?=\s|$)' -and $line -notmatch '^(?i:GO)(\s+\d+)?\s*$') {
      $reason = 'a malformed GO line'
    }
    if ($reason) { Stop-Wrapper "Input rejected: line $number is $reason. Only plain T-SQL and GO are allowed." }
  }
}

# ---- sqlcmd -----------------------------------------------------------------------------------

function New-TempSql([string]$Content) {
  $path = Join-Path ([System.IO.Path]::GetTempPath()) ("sql-ro-$([guid]::NewGuid().ToString('N')).sql")
  [System.IO.File]::WriteAllText($path, $Content, [System.Text.UTF8Encoding]::new($false))
  $script:TempFiles.Add($path)
  return $path
}

# Runs sqlcmd, streaming each output line (scrubbed) to $OnLine. Returns sqlcmd's exit code.
function Invoke-SqlcmdExe([string[]]$SqlcmdArgs, [scriptblock]$OnLine) {
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    & sqlcmd @SqlcmdArgs 2>&1 | ForEach-Object { & $OnLine (Hide-Secret ([string]$_)) }
    return $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previous
  }
}

$GateSql = @'
SET NOCOUNT ON;
SELECT 'PERM' AS k, 'SERVER' AS a, permission_name AS b FROM fn_my_permissions(NULL, 'SERVER')
UNION ALL SELECT 'PERM', 'DATABASE', permission_name FROM fn_my_permissions(NULL, 'DATABASE')
UNION ALL SELECT 'FLAG', 'sysadmin', CONVERT(varchar(10), ISNULL(IS_SRVROLEMEMBER('sysadmin'), 0))
UNION ALL SELECT 'FLAG', 'db_owner', CONVERT(varchar(10), ISNULL(IS_MEMBER('db_owner'), 0))
UNION ALL SELECT 'FLAG', 'db_datawriter', CONVERT(varchar(10), ISNULL(IS_MEMBER('db_datawriter'), 0))
UNION ALL SELECT 'FLAG', 'db_ddladmin', CONVERT(varchar(10), ISNULL(IS_MEMBER('db_ddladmin'), 0))
UNION ALL SELECT 'RCSI', 'rcsi', CONVERT(varchar(10), is_read_committed_snapshot_on) FROM sys.databases WHERE database_id = DB_ID();
'@

# The fail-closed gate. Returns @{ Rcsi = <bool>; Warnings = <string[]> } or throws exit 3.
function Test-ReadOnlyLogin([string[]]$CommonArgs, [string]$DbName) {
  $gateFile = New-TempSql $GateSql
  $captured = [System.Collections.Generic.List[string]]::new()
  $exit = Invoke-SqlcmdExe ($CommonArgs + @('-h', '-1', '-W', '-s', '|', '-i', $gateFile)) { param($l) $captured.Add($l) }
  if ($exit -ne 0) {
    Stop-Wrapper ("Permission gate could not run on '$DbName' (sqlcmd exit $exit); refusing to continue.`n" +
      ($captured -join "`n")) 3
  }

  $permissions = [System.Collections.Generic.List[string]]::new()
  $offending = [System.Collections.Generic.List[string]]::new()
  $roleHits = [System.Collections.Generic.List[string]]::new()
  $rcsi = $null
  $flagsSeen = 0
  foreach ($line in $captured) {
    $parts = $line.Split('|')
    if ($parts.Count -lt 3) { continue }
    $kind = $parts[0].Trim()
    $label = $parts[1].Trim()
    $value = $parts[2].Trim()
    switch ($kind) {
      'PERM' {
        $permissions.Add($value.ToUpperInvariant())
        if ($value -inotin $AllowedPermissions -and -not $value.StartsWith('VIEW ', 'OrdinalIgnoreCase')) {
          $offending.Add("${label}: $value")
        }
      }
      'FLAG' {
        $flagsSeen++
        if ($value -eq '1') { $roleHits.Add($label) }
      }
      'RCSI' { $rcsi = ($value -eq '1') }
    }
  }

  if ($flagsSeen -ne $RoleFlags.Count -or $permissions.Count -eq 0 -or $null -eq $rcsi) {
    Stop-Wrapper "Permission gate returned an unexpected result on '$DbName'; refusing to continue." 3
  }
  if ($offending.Count -or $roleHits.Count) {
    $message = "Permission gate refused: this login is not read-only on database '$DbName'."
    if ($offending.Count) { $message += "`nPermissions beyond read: " + (($offending | Sort-Object -Unique) -join ', ') }
    if ($roleHits.Count) { $message += "`nRole membership: " + ($roleHits -join ', ') }
    Stop-Wrapper $message 3
  }

  $warnings = [System.Collections.Generic.List[string]]::new()
  if (-not ($permissions -contains 'SELECT' -or $permissions -contains 'SELECT ALL USER SECURABLES')) {
    $warnings.Add("login holds no SELECT on '$DbName': queries on user tables will fail")
  }
  if (-not ($permissions -contains 'VIEW DEFINITION' -or $permissions -contains 'VIEW ANY DEFINITION')) {
    $warnings.Add("login holds no VIEW DEFINITION on '$DbName': module bodies and some metadata will be hidden")
  }
  return @{ Rcsi = $rcsi; Warnings = $warnings }
}

# ---- main -------------------------------------------------------------------------------------

$exitCode = 0
try {
  if (-not $Env) { Stop-Wrapper '-Env is mandatory (e.g. -Env prod).' }
  if ([bool]$Query -eq [bool]$File) { Stop-Wrapper 'Pass exactly one of -Query or -File.' }
  if ($MaxLines -lt 1) { Stop-Wrapper '-MaxLines must be at least 1.' }
  if ($Env -ieq 'dev') {
    Stop-Wrapper 'Refused: dev is not read through this wrapper. Use plain sqlcmd against the dev instance.'
  }

  $sql = $Query
  if ($File) {
    if (-not (Test-Path -LiteralPath $File -PathType Leaf)) { Stop-Wrapper "SQL file not found: $File" }
    $sql = Get-Content -LiteralPath $File -Raw
  }
  if (-not $sql -or -not $sql.Trim()) { Stop-Wrapper 'The SQL is empty.' }
  Assert-PlainSql $sql

  $resolved = Resolve-Target $Env $(if ($Project) { $Project } else { $PWD.Path })
  $target = $resolved.Target

  $server = Resolve-Ref (Get-Setting $target 'server') 'server'
  if (-not $server) { Stop-Wrapper "Registry: '$Env' has no server." }
  if ($resolved.DevHosts -contains (Get-HostOf $server)) {
    Stop-Wrapper "Refused: '$server' is a dev host. Use plain sqlcmd for dev."
  }

  $databases = @(Get-Setting $target 'databases')
  if (-not $databases.Count) { Stop-Wrapper "Registry: '$Env' lists no databases." }
  if (-not $Db) { $Db = $databases[0] }
  $dbName = $databases | Where-Object { $_ -ieq $Db } | Select-Object -First 1
  if (-not $dbName) {
    Stop-Wrapper "Database '$Db' is not allowed for '$Env'. Allowed: $($databases -join ', ')"
  }

  $login = Resolve-Ref (Get-Setting $target 'user') 'user'
  $secret = Resolve-Ref (Get-Setting $target 'password') 'password'
  $auth = Resolve-Ref (Get-Setting $target 'auth') 'auth'
  if ($auth) {
    $fragment = Read-AuthFragment $auth
    if (-not $login) { $login = $fragment.User }
    if (-not $secret) { $secret = $fragment.Secret }
  }
  if (-not $login -or -not $secret) { Stop-Wrapper "Registry: '$Env' needs a user and a password (auth, or user + password)." }
  $script:Secret = $secret

  $encrypt = Get-Setting $target 'encrypt'
  $trust = Get-Setting $target 'trustServerCertificate'
  $intent = Get-Setting $target 'applicationIntent'
  $readOnlyIntent = ($intent -ieq 'ReadOnly')

  $commonArgs = @('-S', $server, '-d', $dbName, '-U', $login, '-x', '-b', '-l', '15', '-t', '60')
  if ($null -ne $encrypt) { $commonArgs += @('-N', ([string]$encrypt).ToLowerInvariant()) }
  if ($trust -eq $true) { $commonArgs += '-C' }
  if ($readOnlyIntent) { $commonArgs += @('-K', 'ReadOnly') }

  foreach ($name in $ClearedSqlcmdVars) { [System.Environment]::SetEnvironmentVariable($name, $null) }
  $env:SQLCMDPASSWORD = $secret

  $gate = Test-ReadOnlyLogin $commonArgs $dbName
  $isolation = if ($gate.Rcsi) { 'READ COMMITTED' } else { 'READ UNCOMMITTED' }

  [Console]::Out.WriteLine("# env=$Env server=$server db=$dbName login=$login isolation=$isolation " +
    "intent=$(if ($readOnlyIntent) { 'ReadOnly' } else { 'default' })")
  foreach ($warning in $gate.Warnings) { [Console]::Out.WriteLine("# warn: $warning") }

  $prelude = "SET NOCOUNT ON; SET LOCK_TIMEOUT 5000; SET TRANSACTION ISOLATION LEVEL $isolation;`r`nGO`r`n"
  $queryFile = New-TempSql ($prelude + $sql)
  $format = if ($Wide) { @('-y', '0') } else { @('-W', '-s', '|') }

  $state = @{ Total = 0 }
  $exitCode = Invoke-SqlcmdExe ($commonArgs + $format + @('-i', $queryFile)) {
    param($line)
    $state.Total++
    if ($state.Total -le $MaxLines) { [Console]::Out.WriteLine($line) }
  }
  if ($state.Total -gt $MaxLines) { [Console]::Out.WriteLine("# truncated: $MaxLines/$($state.Total) lines") }
} catch [WrapperError] {
  [Console]::Error.WriteLine((Hide-Secret $_.Exception.Message))
  $exitCode = $_.Exception.Code
} catch {
  [Console]::Error.WriteLine((Hide-Secret "sql-ro failed: $($_.Exception.Message)"))
  $exitCode = 2
} finally {
  Remove-Item Env:SQLCMDPASSWORD -ErrorAction SilentlyContinue
  foreach ($path in $script:TempFiles) { Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue }
}
exit $exitCode
