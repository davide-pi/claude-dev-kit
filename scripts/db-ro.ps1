<#
.SYNOPSIS
  Access to non-dev databases (read-only) and to dev databases (optionally read-write) - SQL Server
  (sqlcmd), Postgres (psql), Redis (redis-cli).

.DESCRIPTION
  pwsh -NoProfile -File db-ro.ps1 -Env <env> [-Engine <sql|postgres|redis>] [-Db <name>]
                                  (-Query '<sql | redis command>' | -File <path.sql> | -Probe)
                                  [-MaxLines 200] [-Wide] [-AcceptWriteGrant] [-Project <name | path>]

  Targets come from db-targets.json one folder above this script (installed: ~/.claude/scripts/db-ro.ps1 reads
  ~/.claude/db-targets.json); no parameter, variable or home folder moves it. The kit's
  db-targets.example.json shows every key:

    { "devHosts": ["localhost", ...],
      "projects": { "<project>": {
          "root": "<workspace root>" | ["<root>", ...],           optional: -Project / the cwd is matched against it
          "envFile": "~/<dir>/<name>.env",                         optional: a dotenv file the ${NAME} values come from
          "<env>": {                                               every other key is an environment (local, stg, prod, ...)
            "readOnly": false,                                     optional, default true; the engine block may set it too
            "sql" | "postgres" | "redis": {                        one block per engine ("sqlserver" = "sql")
              "server": "host,1433" (sql) | "host:5432" | "host:6380",  "port": optional,
              "auth": "<connection-string fragment>"   (or "user" + "password"),
              "databases": ["Db1"]   (redis: indexes, default ["0"]),
              sql:      "encrypt", "trustServerCertificate", "applicationIntent": "ReadOnly"
              postgres: "url": "postgres://user:pwd@host:5432/db?sslmode=require"  (explicit keys win over its parts),
                        "sslmode": "require"
              redis:    "tls": true, "readOnlyAttested": "<who verified the access policy, when>"
              postgres, redis: "clientImage": "postgres:17" (the docker route's image) } } } } }

  The project is -Project when it names one, else the one whose root is the longest prefix of -Project
  (a path) or of the current directory. -Engine is optional when the environment holds one engine.
  Any string value of an engine block may embed ${NAME}, also mid-string ("${HOST},1433"): the
  project's envFile first, then the process environment, then the user environment. `auth` is a
  connection-string fragment: only its user and secret keys (User Id / UID, and the secret under
  either of its two usual names) are read.

  Guarantees:
    - the secret never reaches argv or the output: it travels in SQLCMDPASSWORD / PGPASSWORD /
      REDISCLI_AUTH, set for this process only (docker gets `-e NAME` without a value, WSL gets
      WSLENV), and every message is scrubbed of it;
    - the credential is probed first. A write capability stops the run before the user input runs
      (exit 4) and prints every grant found; the caller shows them to the user, who decides once per
      target. With -AcceptWriteGrant the run goes on with the client-side filter as the only layer
      (SQL Server and Postgres: one SELECT / WITH statement per batch, no write keyword; Redis: the
      read-command list) and the output header says `readonly=NO`. A probe that cannot run or prove
      anything stays a refusal (exit 3), flag or not. SQL Server: fn_my_permissions + writer/owner roles. Postgres: role
      attributes, membership in writer roles, CREATE on the database or a schema, any write grant
      on a table or sequence. Redis: ACL WHOAMI + ACL GETUSER, only read categories and commands;
      a server that hides its ACL is refused unless the target carries `readOnlyAttested`;
    - client-side read-only on top: Postgres runs with default_transaction_read_only=on and refuses
      SQL that would turn it off, backslash commands other than \d* / \l; Redis runs only the
      read-command allow-list below, KEYS / MONITOR / CONFIG /
      DEBUG refused; SQL Server rejects sqlcmd commands (:r, :!!, :setvar, ED, RESET, ...).
  -Probe runs the probe alone and prints its verdict: whether the credential is read-only
  server-side.

  "readOnly": false is honoured only when the resolved host is a dev host (the registry's devHosts
  plus the loopback names); any other host stops with exit 2 before connecting. The run then has no
  probe, no read filter and no read-only session (header `readonly=NO(local)`); the escape filters
  stay: sqlcmd commands (SQL Server), backslash lines (Postgres), one Redis command whose first
  word is a command name. A dev host with readOnly true takes the normal probe path.

  Client route, first found: native, then WSL (`wsl -e <client>`), then docker (`docker run --rm -i
  <image> <client>`; image = clientImage, else a local image of that repository, else the default).
  sqlcmd is native only.

  Exit codes: 0 ok, 2 usage or registry error, 3 the probe could not prove read-only, 4 the credential
  holds write grants (re-run with -AcceptWriteGrant once the user accepts), otherwise the client's
  (psql's own 3, a script error, is reported as 1).

  Why no -X1 on sqlcmd: go-sqlcmd then ignores SQLCMDPASSWORD and prompts for it, so the input
  filter is the barrier against sqlcmd commands, not the -X switch.
#>

# No [CmdletBinding()]: its common -Debug parameter owns the alias "db", which -Db must keep.
param(
  [string]$Env,
  [string]$Engine,
  [string]$Db,
  [string]$Query,
  [string]$File,
  [switch]$Probe,
  [switch]$AcceptWriteGrant,
  [int]$MaxLines = 200,
  [switch]$Wide,
  [string]$Project
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Permissions a read-only SQL Server login may hold (anything starting with "VIEW " is allowed too).
$AllowedPermissions = @(
  'CONNECT', 'CONNECT SQL', 'CONNECT ANY DATABASE', 'SELECT', 'SELECT ALL USER SECURABLES',
  'SHOWPLAN', 'REFERENCES', 'AUTHENTICATE'
)
$RoleFlags = @('sysadmin', 'db_owner', 'db_datawriter', 'db_ddladmin')
$ClearedSqlcmdVars = @('SQLCMDINI', 'SQLCMDUSER', 'SQLCMDSERVER', 'SQLCMDDBNAME')
# Variables that would redirect psql away from the -h / -p / -U / -d given on its command line.
$ClearedPgVars = @('PGHOSTADDR', 'PGSERVICE', 'PGSERVICEFILE', 'PGPASSFILE', 'PGSYSCONFDIR', 'PSQLRC')
$PgTimeouts = '-c statement_timeout=60s -c lock_timeout=5s'
$PgOptions = "-c default_transaction_read_only=on $PgTimeouts"

# Redis commands that run; a two-word entry names a subcommand. Explicit on purpose: HGETDEL, HGETEX,
# GETDEL, GETEX, ZRANGESTORE and SORT look like reads and write.
$RedisReadCommands = @(
  'GET', 'MGET', 'GETRANGE', 'STRLEN', 'EXISTS', 'TYPE', 'TTL', 'PTTL', 'DBSIZE', 'PING', 'INFO',
  'SCAN', 'HGET', 'HMGET', 'HGETALL', 'HKEYS', 'HVALS', 'HLEN', 'HEXISTS', 'HSCAN',
  'LRANGE', 'LLEN', 'LINDEX', 'SMEMBERS', 'SCARD', 'SISMEMBER', 'SSCAN',
  'ZRANGE', 'ZRANGEBYSCORE', 'ZRANGEBYLEX', 'ZREVRANGE', 'ZREVRANGEBYSCORE', 'ZCARD', 'ZSCORE',
  'ZRANK', 'ZCOUNT', 'ZSCAN', 'XLEN', 'XRANGE', 'XREVRANGE', 'XPENDING',
  'XINFO STREAM', 'XINFO GROUPS', 'XINFO CONSUMERS', 'CLIENT LIST', 'MEMORY USAGE', 'OBJECT ENCODING',
  'SLOWLOG GET'
)
$RedisSubcommandHosts = @($RedisReadCommands | Where-Object { $_.Contains(' ') } | ForEach-Object { $_.Split(' ')[0] } | Sort-Object -Unique)
$RedisRefused = @('KEYS', 'MONITOR', 'DEBUG', 'CONFIG')
# ACL grants a read-only Redis user may hold beyond the read commands: connection housekeeping and
# the two introspection commands the probe needs.
$RedisSafeCategories = @('+@read', '+@connection')
$RedisSafeCommands = @(
  'ACL WHOAMI', 'ACL GETUSER', 'AUTH', 'HELLO', 'SELECT', 'ECHO', 'TIME', 'READONLY', 'COMMAND',
  'CLIENT INFO', 'CLIENT GETNAME', 'CLIENT SETNAME', 'CLUSTER INFO', 'CLUSTER NODES', 'CLUSTER SLOTS',
  'CLUSTER SHARDS'
)

$DefaultImages = @{ 'psql' = 'postgres:17'; 'redis-cli' = 'redis:7' }

$script:Secret = $null
$script:WriteGrantsAccepted = $false
$script:WriteMode = $false   # readOnly: false on a dev host: no probe, no read filter
$script:TempFiles = [System.Collections.Generic.List[string]]::new()
$script:SetVars = [System.Collections.Generic.List[string]]::new()
$script:PreviousWslEnv = $env:WSLENV

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

# Set a variable for this process and remember it for the cleanup.
function Set-ProcessVar([string]$Name, [string]$Value) {
  [System.Environment]::SetEnvironmentVariable($Name, $Value)
  $script:SetVars.Add($Name)
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

# Every ${NAME} in $Text -> its value: the envFile entries first, then the process environment, then the
# user environment. An unknown or empty name stops with exit 2 naming the variable, never a value.
function Expand-Value([string]$Text, [hashtable]$EnvFileValues, [string]$What) {
  if (-not $Text) { return $Text }
  $pattern = '\$\{([A-Za-z_][A-Za-z0-9_]*)\}'
  $values = @{}
  foreach ($match in [regex]::Matches($Text, $pattern)) {
    $name = $match.Groups[1].Value
    if ($values.ContainsKey($name)) { continue }
    $value = $null
    if ($EnvFileValues -and $EnvFileValues.ContainsKey($name)) { $value = $EnvFileValues[$name] }
    if (-not $value) { $value = [System.Environment]::GetEnvironmentVariable($name) }
    if (-not $value) { $value = [System.Environment]::GetEnvironmentVariable($name, 'User') }
    if (-not $value) {
      Stop-Wrapper ('Registry: ' + $What + ' references ${' + $name + '}, which is not set (looked in the envFile, ' +
        'the process environment, the user environment).')
    }
    $values[$name] = $value
  }
  return [regex]::Replace($Text, $pattern, { param($m) $values[$m.Groups[1].Value] })
}

# An engine block -> a copy whose every string value (arrays of strings included) has its ${NAME} expanded.
function Expand-Target($Block, [hashtable]$EnvFileValues, [string]$What) {
  $copy = [ordered]@{}
  foreach ($property in $Block.PSObject.Properties) {
    $label = "'$($property.Name)' of $What"
    $value = $property.Value
    if ($value -is [string]) {
      $value = Expand-Value $value $EnvFileValues $label
    } elseif ($value -is [System.Array]) {
      $value = @($value | ForEach-Object { if ($_ -is [string]) { Expand-Value $_ $EnvFileValues $label } else { $_ } })
    }
    $copy[$property.Name] = $value
  }
  return [pscustomobject]$copy
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
      { $_ -in 'user id', 'userid', 'uid', 'user', 'username' } { $login = $value }
      { $_ -in 'password', 'pwd' } { $secret = $value }
    }
  }
  return @{ User = $login; Secret = $secret }
}

# ---- registry ---------------------------------------------------------------------------------

function ConvertTo-PlainPath([string]$Path) {
  return $Path.Trim().Replace('/', '\').TrimEnd('\')
}

function Get-RegistryHelp($Projects) {
  $lines = foreach ($project in $Projects.PSObject.Properties) {
    $envs = ($project.Value.PSObject.Properties | Where-Object { $_.Name -notin 'root', 'envFile' } | ForEach-Object { $_.Name }) -join ', '
    "  $($project.Name): $envs"
  }
  return "Available projects and environments:`n" + ($lines -join "`n")
}

# sqlserver `tcp:host\inst,1433` -> host; postgres / redis `host:port`, `[::1]:6379` -> host + port.
function Split-Server([string]$Engine, [string]$Server, $Port) {
  $name = $Server.Trim()
  if ($Engine -eq 'sqlserver') {
    $sqlHost = (($name -replace '^(?i:tcp:)', '') -split '[,\\]')[0]
    if ($sqlHost -match '^\[(.+)\]$') { $sqlHost = $Matches[1] }   # an IPv6 literal: the bare address
    return @{ Host = $sqlHost; Port = $null }
  }
  $defaultPort = if ($Engine -eq 'postgres') { 5432 } else { 6379 }
  $hostName = $name
  $parsedPort = $null
  if ($name -match '^\[(.+)\](?::(\d+))?$') {
    $hostName = $Matches[1]
    if ($Matches[2]) { $parsedPort = $Matches[2] }
  } elseif ($name -match '^([^:]+):(\d+)$') {
    $hostName = $Matches[1]
    $parsedPort = $Matches[2]
  }
  $finalPort = if ($Port) { [string]$Port } elseif ($parsedPort) { $parsedPort } else { [string]$defaultPort }
  return @{ Host = $hostName; Port = $finalPort }
}

# registry file + environment (+ engine) + project (a name, or a path: the longest `root` prefix wins;
# empty = the current directory) -> the engine block, its read-only flag, the dev hosts and the envFile
# path. The block is returned as written: ${NAME} is expanded by the caller.
function Resolve-Target([string]$EnvName, [string]$EngineName, [string]$ProjectArg, [string]$CurrentPath, [string]$RegistryPath) {
  $engineKeys = @{ sql = 'sqlserver'; sqlserver = 'sqlserver'; postgres = 'postgres'; redis = 'redis' }
  $wanted = $null
  if ($EngineName) {
    $wanted = $EngineName.Trim().ToLowerInvariant()
    if ($wanted -eq 'rabbit') { Stop-Wrapper "Engine 'rabbit' is not supported yet." }
    if (-not $engineKeys.ContainsKey($wanted)) { Stop-Wrapper "Unknown engine '$EngineName'. Expected one of: sql, postgres, redis." }
    $wanted = $engineKeys[$wanted]
  }

  if (-not (Test-Path -LiteralPath $RegistryPath -PathType Leaf)) {
    Stop-Wrapper "Registry not found: $RegistryPath"
  }
  try {
    $registry = Get-Content -LiteralPath $RegistryPath -Raw | ConvertFrom-Json
  } catch {
    Stop-Wrapper "Registry is not valid JSON: $RegistryPath"
  }
  if (-not $registry.PSObject.Properties['projects'] -or $registry.projects -isnot [pscustomobject]) {
    $why = if ($registry.PSObject.Properties['targets']) { "uses the old 'targets' shape" } else { "has no 'projects'" }
    Stop-Wrapper "Registry $why. Rewrite it as project -> environment -> engine, as in db-targets.example.json."
  }
  $projects = $registry.projects

  $project = $null
  $root = $null
  if ($ProjectArg) {
    $project = $projects.PSObject.Properties | Where-Object { $_.Name -ieq $ProjectArg.Trim() } | Select-Object -First 1
    if ($project -and $project.Value.PSObject.Properties['root']) { $root = [string]@($project.Value.root)[0] }
  }
  if (-not $project) {
    $where = ConvertTo-PlainPath $(if ($ProjectArg) { $ProjectArg } else { $CurrentPath })
    $bestLength = -1
    foreach ($candidate in $projects.PSObject.Properties) {
      if (-not $candidate.Value.PSObject.Properties['root']) { continue }
      foreach ($candidateRoot in @($candidate.Value.root)) {
        $key = ConvertTo-PlainPath ([string]$candidateRoot)
        $isPrefix = $where.Equals($key, 'OrdinalIgnoreCase') -or
          $where.StartsWith($key + '\', [System.StringComparison]::OrdinalIgnoreCase)
        if ($isPrefix -and $key.Length -gt $bestLength) { $project = $candidate; $root = $key; $bestLength = $key.Length }
      }
    }
  }
  if (-not $project) {
    Stop-Wrapper "No project is named or rooted at '$(if ($ProjectArg) { $ProjectArg } else { $CurrentPath })'.`n$(Get-RegistryHelp $projects)"
  }
  if ($project.Value -isnot [pscustomobject]) { Stop-Wrapper "Registry: project '$($project.Name)' must be an object." }

  $envProperty = $project.Value.PSObject.Properties |
    Where-Object { $_.Name -notin 'root', 'envFile' -and $_.Name -ieq $EnvName } | Select-Object -First 1
  if (-not $envProperty) {
    Stop-Wrapper "Environment '$EnvName' is not registered for project '$($project.Name)'.`n$(Get-RegistryHelp $projects)"
  }
  if ($envProperty.Value -isnot [pscustomobject]) { Stop-Wrapper "Registry: environment '$EnvName' must be an object." }

  $readOnly = $true
  $hasRabbit = $false
  $engines = [ordered]@{}
  foreach ($property in $envProperty.Value.PSObject.Properties) {
    $key = $property.Name.ToLowerInvariant()
    if ($key -eq 'readonly') {
      if ($property.Value -isnot [bool]) { Stop-Wrapper "Registry: readOnly of '$EnvName' must be true or false." }
      $readOnly = $property.Value
    } elseif ($key -eq 'rabbit') {
      $hasRabbit = $true   # reserved: refused when asked for
      continue
    } elseif ($engineKeys.ContainsKey($key)) {
      if ($engines.Contains($engineKeys[$key])) { Stop-Wrapper "Registry: '$EnvName' holds the $($engineKeys[$key]) engine twice (sql, sqlserver)." }
      $engines[$engineKeys[$key]] = $property
    } else {
      Stop-Wrapper "Registry: '$EnvName' has an unknown key '$($property.Name)'. Expected: readOnly, sql, postgres, redis."
    }
  }
  if (-not $wanted) {
    if ($engines.Count -eq 0 -and $hasRabbit) { Stop-Wrapper "Registry: '$EnvName' holds only a rabbit engine, which is not supported yet." }
    if ($engines.Count -eq 0) { Stop-Wrapper "Registry: '$EnvName' holds no engine." }
    if ($engines.Count -gt 1) { Stop-Wrapper "Pass -Engine: '$EnvName' holds $(@($engines.Keys) -join ', ')." }
    $wanted = @($engines.Keys)[0]
  }
  if (-not $engines.Contains($wanted)) {
    Stop-Wrapper "Environment '$EnvName' of project '$($project.Name)' has no $wanted engine. It holds: $(@($engines.Keys) -join ', ')."
  }
  $block = $engines[$wanted].Value
  if ($block -isnot [pscustomobject]) { Stop-Wrapper "Registry: engine '$wanted' of '$EnvName' must be an object." }
  if ($block.PSObject.Properties['readOnly']) {
    if ($block.readOnly -isnot [bool]) { Stop-Wrapper "Registry: readOnly of '$EnvName' $wanted must be true or false." }
    $readOnly = $block.readOnly
  }

  $envFile = $null
  if ($project.Value.PSObject.Properties['envFile'] -and $project.Value.envFile) {
    $envFile = [string]$project.Value.envFile
    if ($envFile -eq '~' -or $envFile.StartsWith('~/') -or $envFile.StartsWith('~\')) {
      $envFile = Join-Path $HOME $envFile.Substring(1).TrimStart('/', '\')
    }
  }

  # The dev hosts are the registry's list plus the loopback names: a write-enabled target must sit on one.
  $devHosts = @('localhost', '127.0.0.1', '::1', '(local)', '(localdb)', '.', 'host.docker.internal')
  if ($registry.PSObject.Properties['devHosts']) { $devHosts += @($registry.devHosts | ForEach-Object { [string]$_ }) }
  return @{ Project = $project.Name; Root = $root; EnvFile = $envFile; Engine = $wanted; Target = $block; ReadOnly = $readOnly; DevHosts = [string[]]$devHosts }
}

# postgres[ql]://user[:pwd]@host[:port]/db[?sslmode=...] -> its parts, percent-decoded (a part not in the
# url is $null, the port defaults to 5432). A message never repeats the url: it carries the password.
function ConvertFrom-PgUrl([string]$Url) {
  if ($Url -notmatch '^(?i:postgres(?:ql)?)://(?<rest>.*)$') {
    Stop-Wrapper 'Registry: the postgres url must start with postgres:// or postgresql://.'
  }
  $rest = $Matches['rest']
  $hash = $rest.IndexOf('#')
  if ($hash -ge 0) { $rest = $rest.Substring(0, $hash) }
  $query = ''
  $mark = $rest.IndexOf('?')
  if ($mark -ge 0) { $query = $rest.Substring($mark + 1); $rest = $rest.Substring(0, $mark) }
  $slash = $rest.IndexOf('/')
  $authority = if ($slash -ge 0) { $rest.Substring(0, $slash) } else { $rest }
  $database = if ($slash -ge 0) { [System.Uri]::UnescapeDataString($rest.Substring($slash + 1)) } else { $null }

  $login = $null
  $secret = $null
  $at = $authority.LastIndexOf('@')
  if ($at -ge 0) {
    $userInfo = $authority.Substring(0, $at)
    $authority = $authority.Substring($at + 1)
    $colon = $userInfo.IndexOf(':')
    if ($colon -ge 0) {
      $login = [System.Uri]::UnescapeDataString($userInfo.Substring(0, $colon))
      $secret = [System.Uri]::UnescapeDataString($userInfo.Substring($colon + 1))
    } else {
      $login = [System.Uri]::UnescapeDataString($userInfo)
    }
  }

  $hostName = $null
  $port = '5432'
  if ($authority -match '^\[([^\]]+)\](?::(\d+))?$' -or $authority -match '^([^:\[\]]*)(?::(\d+))?$') {
    $hostName = [System.Uri]::UnescapeDataString($Matches[1])
    if ($Matches[2]) { $port = $Matches[2] }
  } else {
    Stop-Wrapper 'Registry: the postgres url has an invalid host or port.'
  }
  if (-not $hostName) { Stop-Wrapper 'Registry: the postgres url has no host.' }

  $sslMode = $null
  foreach ($pair in $query.Split('&')) {
    $eq = $pair.IndexOf('=')
    if ($eq -gt 0 -and $pair.Substring(0, $eq) -ieq 'sslmode') { $sslMode = [System.Uri]::UnescapeDataString($pair.Substring($eq + 1)) }
  }
  return @{
    Host = $hostName; Port = $port
    User = if ($login) { $login } else { $null }
    Secret = if ($secret) { $secret } else { $null }
    Database = if ($database) { $database } else { $null }
    SslMode = if ($sslMode) { $sslMode } else { $null }
  }
}

# A postgres block with a `url` -> a copy where the server, user, password, databases and sslmode the
# block does not set itself come from the url.
function Merge-PgUrl($Target) {
  if (-not $Target.PSObject.Properties['url'] -or -not $Target.url) { return $Target }
  $parts = ConvertFrom-PgUrl ([string]$Target.url)
  $copy = [ordered]@{}
  foreach ($property in $Target.PSObject.Properties) { $copy[$property.Name] = $property.Value }
  $endpoint = if ($parts.Host.Contains(':')) { "[$($parts.Host)]:$($parts.Port)" } else { "$($parts.Host):$($parts.Port)" }
  if (-not $copy['server']) { $copy['server'] = $endpoint }
  if (-not $copy['user'] -and $parts.User) { $copy['user'] = $parts.User }
  if (-not $copy['password'] -and $parts.Secret) { $copy['password'] = $parts.Secret }
  if (-not $copy['databases'] -and $parts.Database) { $copy['databases'] = @($parts.Database) }
  if (-not $copy['sslmode'] -and $parts.SslMode) { $copy['sslmode'] = $parts.SslMode }
  return [pscustomobject]$copy
}

# readOnly: false is for dev hosts only: any other host stops before a client runs.
function Assert-DevHostForWrite([string]$HostName, [string[]]$DevHosts) {
  if ($DevHosts -notcontains $HostName) {
    Stop-Wrapper "Refused: readOnly is false, and write access is only for dev hosts; '$HostName' is not one."
  }
}

# psql reads a database name holding '=' or starting with postgres:// as a connection string, which can name
# another host. Refused on every path; the message never repeats the name.
function Assert-PgDatabaseName([string]$Name) {
  if ($Name.Contains('=') -or $Name -match '^(?i:postgres(?:ql)?)://') {
    Stop-Wrapper 'Refused: a Postgres database name may not contain = or start with postgres:// (psql would read it as a connection string).'
  }
}

# The database names as the registry wrote them, ${NAME} unexpanded: a message must not carry a resolved value.
function Get-RawDatabaseList($Block, [string]$EngineName) {
  $raw = @(Get-Setting $Block 'databases' | Where-Object { $null -ne $_ } | ForEach-Object { [string]$_ })
  if ($raw.Count) { return $raw -join ', ' }
  if ($EngineName -eq 'redis') { return '0' }
  return '(the database named by the url)'
}

function Get-Setting($Target, [string]$Name) {
  $property = $Target.PSObject.Properties[$Name]
  if ($property) { return $property.Value }
  return $null
}

# ---- input filters ----------------------------------------------------------------------------

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

# psql reads a backslash anywhere outside a literal as a meta-command (\! runs a shell, \copy and \o
# write files, \c reconnects). Only a line that is exactly a describe command (\d*, \l) passes; any
# other backslash is refused, literals included, rather than parsing quotes psql's way. The backslash
# check always runs; the read-only-setting check is skipped only when $ReadOnly is false.
function Assert-PlainPgSql([string]$Sql, [bool]$ReadOnly = $true) {
  $number = 0
  foreach ($raw in ($Sql -split "`r`n|`n|`r")) {
    $number++
    $line = $raw.Trim().TrimStart([char]0xFEFF).Trim()
    if (-not $line.Contains('\')) { continue }
    if ($line -match '^\\(?:d[A-Za-z]*\+?|l\+?)(?:\s+[A-Za-z0-9_."*]+)?$') { continue }
    Stop-Wrapper "Input rejected: line $number carries a backslash. Only plain SQL and \d* / \l lines are allowed."
  }
  # The read-only default is a session setting the SQL could turn off; the grants stay the guarantee.
  if ($ReadOnly -and $Sql -match '(?i)transaction_read_only|\bread\s+write\b|\bset_config\b|\bset\s+(?:session\s+|local\s+)?role\b|\bsession\s+authorization\b|\breset\s+\w|\bdiscard\s+\w') {
    Stop-Wrapper 'Input rejected: the SQL changes the read-only setting or the role (SET, RESET, DISCARD).'
  }
}

# A credential that holds write grants. Without -AcceptWriteGrant nothing runs: exit 4 with every grant, for
# the caller to show the user. With it the run goes on, and the warning says the filter is all that is left.
function Confirm-WriteGrants([string]$Subject, [string[]]$Grants) {
  $list = ($Grants | Sort-Object -Unique) -join "`n"
  if (-not $AcceptWriteGrant) {
    Stop-Wrapper ("$Subject is not read-only. Grants beyond read:`n$list`n" +
      'Nothing ran. Show these grants to the user and ask once for this target; if they accept, re-run with ' +
      '-AcceptWriteGrant: the client-side filter is then the only layer, and no write statement will run.') 4
  }
  $script:WriteGrantsAccepted = $true
  return "write grants accepted, client-side filter only: $(($Grants | Sort-Object -Unique) -join '; ')"
}

# With write grants accepted, the statement filter is the only barrier: every statement of every batch
# must be a SELECT or WITH, with no write keyword anywhere (comments and literals removed first).
function Assert-ReadStatements([string]$Sql, [string]$Engine) {
  $text = [regex]::Replace($Sql, '(?s)/\*.*?\*/', ' ')
  $text = [regex]::Replace($text, '--[^\r\n]*', ' ')
  $text = [regex]::Replace($text, "'(?:[^']|'')*'", "''")
  $text = [regex]::Replace($text, '"[^"]*"', '"x"')
  if ($Engine -eq 'postgres') { $text = [regex]::Replace($text, '(?m)^\s*\\.*$', ' ') }   # \d* and \l lines, already vetted
  $banned = '\b(?:INSERT|UPDATE|DELETE|MERGE|TRUNCATE|DROP|ALTER|CREATE|GRANT|REVOKE|INTO|EXEC|EXECUTE|OPENROWSET|OPENQUERY|OPENDATASOURCE|BULK|COPY|CALL|DO|VACUUM|REINDEX|LOCK)\b|\bxp_\w+|\bpg_(?:read|write|ls)_\w*|\blo_(?:import|export)\b|\bdblink\w*|\bFOR\s+(?:NO\s+KEY\s+)?(?:UPDATE|SHARE)\b|\bKEY\s+SHARE\b'
  foreach ($batch in ($text -split '(?im)^\s*GO(?:\s+\d+)?\s*$')) {
    foreach ($piece in ($batch -split ';')) {
      $statement = $piece.Trim()
      if (-not $statement) { continue }
      if ($statement -notmatch '^(?i:SELECT|WITH)\b') {
        Stop-Wrapper "Input rejected: write grants were accepted, so only SELECT / WITH statements run; got '$($statement.Split([char[]]"`r`n")[0])'."
      }
      if ($statement -match "(?i)$banned") {
        Stop-Wrapper "Input rejected: write grants were accepted, and this statement carries '$($Matches[0])'. Only plain reads run."
      }
    }
  }
}

# What the header says about read-only: proven server-side, or only held by this script's filter.
function Get-ReadOnlyLabel {
  if ($script:WriteMode) { return 'NO(local)' }
  if ($script:WriteGrantsAccepted) { return 'NO(write-grants-accepted;client-side-filter-only)' }
  return 'verified'
}

# A redis command line -> its arguments (single or double quotes group). One command only. With $ReadOnly
# false the read allow-list is off, but the first word must still be a command name: a leading dash would
# be a redis-cli option (-h, -u, --rdb, --eval) that redirects the client or writes a file.
function ConvertTo-RedisArgs([string]$Text, [bool]$ReadOnly = $true) {
  if ($Text -match "[`r`n]") { Stop-Wrapper 'Input rejected: one Redis command per call.' }
  $tokens = [System.Collections.Generic.List[string]]::new()
  $current = [System.Text.StringBuilder]::new()
  $quote = $null
  $started = $false
  foreach ($c in $Text.ToCharArray()) {
    if ($quote) {
      if ($c -eq $quote) { $quote = $null } else { [void]$current.Append($c) }
    } elseif ($c -eq '"' -or $c -eq "'") {
      $quote = $c
      $started = $true
    } elseif ([char]::IsWhiteSpace($c)) {
      if ($started) { $tokens.Add($current.ToString()); [void]$current.Clear(); $started = $false }
    } else {
      [void]$current.Append($c)
      $started = $true
    }
  }
  if ($quote) { Stop-Wrapper 'Input rejected: unbalanced quote in the Redis command.' }
  if ($started) { $tokens.Add($current.ToString()) }
  if (-not $tokens.Count) { Stop-Wrapper 'The Redis command is empty.' }
  if (-not $ReadOnly) {
    if ($tokens[0] -notmatch '^[A-Za-z][A-Za-z0-9._]*$') { Stop-Wrapper 'Input rejected: the Redis command must start with a command name.' }
    return , $tokens.ToArray()
  }

  $name = $tokens[0].ToUpperInvariant()
  $command = if ($RedisSubcommandHosts -contains $name -and $tokens.Count -gt 1) { "$name $($tokens[1].ToUpperInvariant())" } else { $name }
  if ($RedisRefused -contains $name) {
    Stop-Wrapper "Input rejected: $name is not run here (KEYS blocks the server: use SCAN; MONITOR, CONFIG, DEBUG reach server internals)."
  }
  if ($RedisReadCommands -notcontains $command) {
    Stop-Wrapper "Input rejected: '$command' is not a read command. Allowed: $($RedisReadCommands -join ', ')."
  }
  return , $tokens.ToArray()
}

# ---- clients ----------------------------------------------------------------------------------

function New-TempSql([string]$Content) {
  $path = Join-Path ([System.IO.Path]::GetTempPath()) ("db-ro-$([guid]::NewGuid().ToString('N')).sql")
  [System.IO.File]::WriteAllText($path, $Content, [System.Text.UTF8Encoding]::new($false))
  $script:TempFiles.Add($path)
  return $path
}

function Get-LocalImage([string]$Repository) {
  if (-not (Get-Command docker -CommandType Application -ErrorAction SilentlyContinue)) { return $null }
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $images = & docker image ls $Repository --format '{{.Repository}}:{{.Tag}}' 2>$null
    return $images | Where-Object { $_ -and $_ -notmatch '<none>' } | Select-Object -First 1
  } finally {
    $ErrorActionPreference = $previous
  }
}

# The client to run: native, then WSL, then docker. $PassVars are the variables it must see.
function Resolve-Client([string]$Name, $Target, [string[]]$PassVars) {
  if (Get-Command $Name -CommandType Application -ErrorAction SilentlyContinue) {
    return @{ Exe = $Name; Prefix = @(); Label = 'native'; Docker = $false }
  }

  if (Get-Command wsl -CommandType Application -ErrorAction SilentlyContinue) {
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { & wsl -e which $Name *> $null; $inWsl = ($LASTEXITCODE -eq 0) } finally { $ErrorActionPreference = $previous }
    if ($inWsl) {
      $forward = ($PassVars | ForEach-Object { "$_/u" }) -join ':'
      $env:WSLENV = if ($script:PreviousWslEnv) { "$($script:PreviousWslEnv):$forward" } else { $forward }
      return @{ Exe = 'wsl'; Prefix = @('-e', $Name); Label = 'wsl'; Docker = $false }
    }
  }

  if (Get-Command docker -CommandType Application -ErrorAction SilentlyContinue) {
    $image = Get-Setting $Target 'clientImage'
    if (-not $image) { $image = Get-LocalImage ($DefaultImages[$Name].Split(':')[0]) }
    if (-not $image) { $image = $DefaultImages[$Name] }
    $prefix = @('run', '--rm', '-i')
    foreach ($var in $PassVars) { $prefix += @('-e', $var) }   # no value: docker reads it from this process
    return @{ Exe = 'docker'; Prefix = $prefix + @($image, $Name); Label = "docker($image)"; Docker = $true }
  }

  Stop-Wrapper "$Name not found natively, in WSL or through docker. Install it (psql: scoop install postgresql; redis-cli: WSL apt install redis-tools) or start docker."
}

# Runs a client, streaming each output line (scrubbed) to $OnLine. Returns the client's exit code.
function Invoke-Client($Client, [string[]]$ClientArgs, [string]$InputText, [scriptblock]$OnLine) {
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $all = @($Client.Prefix) + $ClientArgs
    if ($InputText) {
      $InputText | & $Client.Exe @all 2>&1 | ForEach-Object { & $OnLine (Hide-Secret ([string]$_)) }
    } else {
      & $Client.Exe @all 2>&1 | ForEach-Object { & $OnLine (Hide-Secret ([string]$_)) }
    }
    return $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previous
  }
}

function Invoke-Capture($Client, [string[]]$ClientArgs, [string]$InputText) {
  $lines = [System.Collections.Generic.List[string]]::new()
  $exit = Invoke-Client $Client $ClientArgs $InputText { param($l) $lines.Add($l) }
  return @{ Exit = $exit; Lines = $lines }
}

# Streams the user's result, capped at -MaxLines. Returns the exit code.
function Write-Result($Client, [string[]]$ClientArgs, [string]$InputText) {
  $state = @{ Total = 0; Error = $false }
  $exit = Invoke-Client $Client $ClientArgs $InputText {
    param($line)
    $state.Total++
    if ($line -match '^\(error\)') { $state.Error = $true }
    if ($state.Total -le $MaxLines) { [Console]::Out.WriteLine($line) }
  }
  if ($state.Total -gt $MaxLines) { [Console]::Out.WriteLine("# truncated: $MaxLines/$($state.Total) lines") }
  if ($exit -eq 0 -and $state.Error) { return 1 }
  return $exit
}

# ---- SQL Server -------------------------------------------------------------------------------

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

# The gate. Returns @{ Rcsi = <bool>; Warnings = <string[]> }; throws exit 3 when it cannot prove anything,
# exit 4 when the login holds write grants (see Confirm-WriteGrants).
function Test-ReadOnlyLogin($Client, [string[]]$CommonArgs, [string]$DbName) {
  $gateFile = New-TempSql $GateSql
  $result = Invoke-Capture $Client ($CommonArgs + @('-h', '-1', '-W', '-s', '|', '-i', $gateFile)) $null
  if ($result.Exit -ne 0) {
    Stop-Wrapper ("Permission gate could not run on '$DbName' (sqlcmd exit $($result.Exit)); refusing to continue.`n" +
      ($result.Lines -join "`n")) 3
  }

  $permissions = [System.Collections.Generic.List[string]]::new()
  $offending = [System.Collections.Generic.List[string]]::new()
  $roleHits = [System.Collections.Generic.List[string]]::new()
  $rcsi = $null
  $flagsSeen = 0
  foreach ($line in $result.Lines) {
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
  $warnings = [System.Collections.Generic.List[string]]::new()
  if ($offending.Count -or $roleHits.Count) {
    $grants = @($offending | ForEach-Object { "permission $_" }) + @($roleHits | ForEach-Object { "role membership $_" })
    $warnings.Add((Confirm-WriteGrants "This login on database '$DbName'" $grants))
  }
  if (-not ($permissions -contains 'SELECT' -or $permissions -contains 'SELECT ALL USER SECURABLES')) {
    $warnings.Add("login holds no SELECT on '$DbName': queries on user tables will fail")
  }
  if (-not ($permissions -contains 'VIEW DEFINITION' -or $permissions -contains 'VIEW ANY DEFINITION')) {
    $warnings.Add("login holds no VIEW DEFINITION on '$DbName': module bodies and some metadata will be hidden")
  }
  return @{ Rcsi = $rcsi; Warnings = $warnings }
}

function Invoke-SqlServer($Target, [string]$Server, [string]$DbName, [string]$Login, [string]$Sql) {
  if (-not (Get-Command sqlcmd -CommandType Application -ErrorAction SilentlyContinue)) {
    Stop-Wrapper 'sqlcmd not found. Install go-sqlcmd: winget install Microsoft.Sqlcmd'
  }
  $client = @{ Exe = 'sqlcmd'; Prefix = @(); Label = 'native'; Docker = $false }

  $encrypt = Get-Setting $Target 'encrypt'
  $trust = Get-Setting $Target 'trustServerCertificate'
  $intent = Get-Setting $Target 'applicationIntent'
  $readOnlyIntent = ($intent -ieq 'ReadOnly')

  $commonArgs = @('-S', $Server, '-d', $DbName, '-U', $Login, '-x', '-b', '-l', '15', '-t', '60')
  if ($null -ne $encrypt) { $commonArgs += @('-N', ([string]$encrypt).ToLowerInvariant()) }
  if ($trust -eq $true) { $commonArgs += '-C' }
  if ($readOnlyIntent) { $commonArgs += @('-K', 'ReadOnly') }

  foreach ($name in $ClearedSqlcmdVars) { [System.Environment]::SetEnvironmentVariable($name, $null) }
  Set-ProcessVar 'SQLCMDPASSWORD' $script:Secret

  if ($script:WriteMode) {
    $isolation = 'default'
    $warnings = @('readOnly is false: no permission probe, no read filter')
  } else {
    $gate = Test-ReadOnlyLogin $client $commonArgs $DbName
    $isolation = if ($gate.Rcsi) { 'READ COMMITTED' } else { 'READ UNCOMMITTED' }
    $warnings = $gate.Warnings
  }

  [Console]::Out.WriteLine("# env=$Env engine=sqlserver server=$Server db=$DbName login=$Login readonly=$(Get-ReadOnlyLabel) " +
    "isolation=$isolation intent=$(if ($readOnlyIntent) { 'ReadOnly' } else { 'default' })")
  foreach ($warning in $warnings) { [Console]::Out.WriteLine("# warn: $warning") }
  if ($Probe) { return 0 }
  if ($script:WriteGrantsAccepted) { Assert-ReadStatements $Sql 'sqlserver' }

  $isolationSql = if ($script:WriteMode) { '' } else { " SET TRANSACTION ISOLATION LEVEL $isolation;" }
  $prelude = "SET NOCOUNT ON; SET LOCK_TIMEOUT 5000;$isolationSql`r`nGO`r`n"
  $queryFile = New-TempSql ($prelude + $Sql)
  $format = if ($Wide) { @('-y', '0') } else { @('-W', '-s', '|') }
  return Write-Result $client ($commonArgs + $format + @('-i', $queryFile)) $null
}

# ---- Postgres ---------------------------------------------------------------------------------

# One statement, `kind|label|value` rows, so every psql version prints every row.
$PgGateSql = @'
WITH me AS (SELECT * FROM pg_roles WHERE rolname = current_user),
rel AS (
  SELECT c.oid, c.relkind, n.nspname || '.' || c.relname AS name
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE left(n.nspname, 3) <> 'pg_' AND n.nspname <> 'information_schema'
),
w AS (
  SELECT name FROM rel
  WHERE (relkind IN ('r', 'p', 'v', 'f') AND (has_table_privilege(oid, 'INSERT') OR has_table_privilege(oid, 'UPDATE')
         OR has_table_privilege(oid, 'DELETE') OR has_table_privilege(oid, 'TRUNCATE')))
     OR (relkind = 'S' AND has_sequence_privilege(oid, 'UPDATE'))
)
SELECT 'ATTR', 'superuser', rolsuper::text FROM me
UNION ALL SELECT 'ATTR', 'createdb', rolcreatedb::text FROM me
UNION ALL SELECT 'ATTR', 'createrole', rolcreaterole::text FROM me
UNION ALL SELECT 'MEMBER', g.rolname, 'true' FROM pg_roles g
  WHERE g.rolname <> current_user AND pg_has_role(current_user, g.oid, 'MEMBER')
    AND (g.rolsuper OR g.rolcreatedb OR g.rolcreaterole OR g.rolname IN ('pg_write_all_data',
         'pg_write_server_files', 'pg_execute_server_program', 'pg_maintain', 'pg_create_subscription',
         'pg_database_owner'))
UNION ALL SELECT 'CREATE', 'database ' || current_database(), has_database_privilege(current_database(), 'CREATE')::text
UNION ALL SELECT 'CREATE', 'schema ' || n.nspname, 'true' FROM pg_namespace n
  WHERE left(n.nspname, 3) <> 'pg_' AND n.nspname <> 'information_schema' AND has_schema_privilege(n.oid, 'CREATE')
UNION ALL SELECT 'WRITE', (SELECT count(*) FROM w)::text,
  coalesce((SELECT string_agg(name, ', ') FROM (SELECT name FROM w ORDER BY name LIMIT 5) s), '')
UNION ALL SELECT 'READ', 'relations', count(*)::text FROM rel
  WHERE relkind IN ('r', 'p', 'v', 'm', 'f') AND has_table_privilege(oid, 'SELECT')
UNION ALL SELECT 'END', 'end', 'end';
'@

# The gate for Postgres. Returns warnings; throws exit 3 when it cannot prove anything, exit 4 on write grants.
function Test-ReadOnlyPgRole($Client, [string[]]$CommonArgs, [string]$DbName) {
  $result = Invoke-Capture $Client ($CommonArgs + @('-t', '-A', '-F', '|', '-f', '-')) $PgGateSql
  if ($result.Exit -ne 0) {
    Stop-Wrapper ("Permission probe could not run on '$DbName' (psql exit $($result.Exit)); refusing to continue.`n" +
      ($result.Lines -join "`n")) 3
  }

  $offending = [System.Collections.Generic.List[string]]::new()
  $attrs = 0
  $ended = $false
  $readable = $null
  foreach ($line in $result.Lines) {
    $parts = $line.Split('|', 3)
    if ($parts.Count -lt 3) { continue }
    $kind = $parts[0].Trim()
    $label = $parts[1].Trim()
    $value = $parts[2].Trim()
    switch ($kind) {
      'ATTR' { $attrs++; if ($value -eq 'true') { $offending.Add("role attribute $label") } }
      'MEMBER' { $offending.Add("member of $label") }
      'CREATE' { if ($value -eq 'true') { $offending.Add("CREATE on $label") } }
      'WRITE' { if ($label -ne '0') { $offending.Add("write grants on $label relations ($value)") } }
      'READ' { $readable = [int]$value }
      'END' { $ended = $true }
    }
  }
  if ($attrs -ne 3 -or -not $ended -or $null -eq $readable) {
    Stop-Wrapper "Permission probe returned an unexpected result on '$DbName'; refusing to continue." 3
  }
  $warnings = [System.Collections.Generic.List[string]]::new()
  if ($offending.Count) { $warnings.Add((Confirm-WriteGrants "This role on database '$DbName'" $offending.ToArray())) }
  if ($readable -eq 0) { $warnings.Add("role can SELECT no relation in '$DbName': queries on user tables will fail") }
  return $warnings
}

function Invoke-Postgres($Target, [string]$Server, [string]$DbName, [string]$Login, [string]$Sql) {
  $endpoint = Split-Server 'postgres' $Server (Get-Setting $Target 'port')
  $passVars = @('PGPASSWORD', 'PGOPTIONS', 'PGCONNECT_TIMEOUT', 'PGAPPNAME', 'PGSSLMODE')
  $client = Resolve-Client 'psql' $Target $passVars
  $hostName = $endpoint.Host
  if ($client.Docker -and $hostName -in @('localhost', '127.0.0.1')) { $hostName = 'host.docker.internal' }

  foreach ($name in $ClearedPgVars) { [System.Environment]::SetEnvironmentVariable($name, $null) }
  Set-ProcessVar 'PGPASSWORD' $script:Secret
  Set-ProcessVar 'PGOPTIONS' $(if ($script:WriteMode) { $PgTimeouts } else { $PgOptions })
  Set-ProcessVar 'PGCONNECT_TIMEOUT' '15'
  Set-ProcessVar 'PGAPPNAME' 'db-ro'
  $sslMode = Get-Setting $Target 'sslmode'
  if ($sslMode) { Set-ProcessVar 'PGSSLMODE' ([string]$sslMode) }

  $commonArgs = @('-X', '-q', '-h', $hostName, '-p', $endpoint.Port, '-U', $Login, '-d', $DbName,
    '-v', 'ON_ERROR_STOP=1', '-P', 'pager=off')
  $warnings = if ($script:WriteMode) { @('readOnly is false: no permission probe, no read filter') } else { Test-ReadOnlyPgRole $client $commonArgs $DbName }
  $session = if ($script:WriteMode) { 'read-write' } else { 'default_transaction_read_only' }

  [Console]::Out.WriteLine("# env=$Env engine=postgres server=$($endpoint.Host):$($endpoint.Port) db=$DbName login=$Login " +
    "readonly=$(Get-ReadOnlyLabel) session=$session client=$($client.Label)")
  foreach ($warning in $warnings) { [Console]::Out.WriteLine("# warn: $warning") }
  if ($Probe) { return 0 }
  if ($script:WriteGrantsAccepted) { Assert-ReadStatements $Sql 'postgres' }

  $format = if ($Wide) { @() } else { @('-A', '-F', '|') }
  $exit = Write-Result $client ($commonArgs + $format + @('-f', '-')) $Sql
  if ($exit -eq 3) { return 1 }   # psql's 3 = a script error under ON_ERROR_STOP; 3 here means the probe
  return $exit
}

# ---- Redis ------------------------------------------------------------------------------------

# Every rule granting more than reads, from `ACL GETUSER` raw output; null when it carries no rules.
function Get-RedisWriteGrants([System.Collections.Generic.List[string]]$Lines) {
  $rules = [System.Collections.Generic.List[string]]::new()
  $offending = [System.Collections.Generic.List[string]]::new()
  for ($i = 0; $i -lt $Lines.Count; $i++) {
    $line = $Lines[$i].Trim()
    if ($line -ieq 'allcommands') { $offending.Add('allcommands') }
    if ($line -ieq 'commands' -and $i + 1 -lt $Lines.Count) { $rules.Add($Lines[$i + 1].Trim()) }
  }
  if (-not $rules.Count) { return $null }

  foreach ($token in ($rules -join ' ') -split '\s+') {
    if (-not $token -or $token.StartsWith('-')) { continue }
    if ($token.StartsWith('+@')) {
      if ($RedisSafeCategories -notcontains $token) { $offending.Add($token) }
      continue
    }
    if ($token.StartsWith('+')) {
      $command = $token.Substring(1).Replace('|', ' ').ToUpperInvariant()
      if ($RedisReadCommands -notcontains $command -and $RedisSafeCommands -notcontains $command) { $offending.Add($token) }
      continue
    }
    if ($token -ieq 'allcommands') { $offending.Add($token) }
  }
  return , $offending.ToArray()
}

# The probe for Redis. Returns 'verified', 'attested: ...' or 'NO ...' (write grants accepted); throws exit 3
# when it cannot prove anything, exit 4 on write grants without -AcceptWriteGrant.
function Test-ReadOnlyRedis($Client, [string[]]$CommonArgs, $Target, [string]$Login) {
  $unreachable = 'Could not connect|Connection refused|NOAUTH|WRONGPASS|invalid username-password|Name or service not known|timed out'
  $who = Invoke-Capture $Client ($CommonArgs + @('--raw', 'ACL', 'WHOAMI')) $null
  $whoText = $who.Lines -join "`n"
  if ($whoText -match $unreachable) { Stop-Wrapper "Permission probe could not run: $whoText" 3 }

  $inconclusive = $null
  $user = $Login
  if ($whoText -match '(?i)unknown command|unknown subcommand') {
    $inconclusive = 'the server exposes no ACL (Redis < 6, or a managed tier): a password there may grant every command'
  } elseif ($whoText -match 'NOPERM') {
    $inconclusive = 'this login may not run ACL WHOAMI'
  } else {
    $last = $who.Lines | Where-Object { $_.Trim() } | Select-Object -Last 1
    if ($last) { $user = $last.Trim() }
  }
  if (-not $user) { $user = 'default' }

  if (-not $inconclusive) {
    $get = Invoke-Capture $Client ($CommonArgs + @('--raw', 'ACL', 'GETUSER', $user)) $null
    $getText = $get.Lines -join "`n"
    if ($getText -match 'NOPERM') {
      $inconclusive = 'this login may not run ACL GETUSER'
    } else {
      $grants = Get-RedisWriteGrants $get.Lines
      if ($null -eq $grants) { Stop-Wrapper "Permission probe returned an unexpected result for user '$user'; refusing to continue.`n$getText" 3 }
      if ($grants.Count) {
        $null = Confirm-WriteGrants "Redis user '$user'" $grants
        return 'NO(write-grants-accepted;client-side-filter-only)'
      }
      return 'verified'
    }
  }

  $attested = Get-Setting $Target 'readOnlyAttested'
  if ($attested) { return "attested ($inconclusive; registry: $attested)" }
  Stop-Wrapper ("Permission probe inconclusive: $inconclusive. Read-only is not proven, refusing.`n" +
    'Give the login +acl|whoami +acl|getuser, or, where the ACL is managed elsewhere (a cloud access ' +
    "policy), record who verified it in the target's readOnlyAttested.") 3
}

function Invoke-Redis($Target, [string]$Server, [string]$DbIndex, [string]$Login, [string[]]$Arguments) {
  if ($DbIndex -notmatch '^\d+$') { Stop-Wrapper "Redis database must be an index, got '$DbIndex'." }
  $endpoint = Split-Server 'redis' $Server (Get-Setting $Target 'port')
  $client = Resolve-Client 'redis-cli' $Target @('REDISCLI_AUTH')
  $hostName = $endpoint.Host
  if ($client.Docker -and $hostName -in @('localhost', '127.0.0.1')) { $hostName = 'host.docker.internal' }

  if ($script:Secret) { Set-ProcessVar 'REDISCLI_AUTH' $script:Secret }
  $commonArgs = @('-h', $hostName, '-p', $endpoint.Port, '-n', $DbIndex, '--no-auth-warning')
  if ((Get-Setting $Target 'tls') -eq $true) { $commonArgs += '--tls' }
  if ($Login) { $commonArgs += @('--user', $Login) }

  $readOnly = if ($script:WriteMode) { Get-ReadOnlyLabel } else { Test-ReadOnlyRedis $client $commonArgs $Target $Login }
  [Console]::Out.WriteLine("# env=$Env engine=redis server=$($endpoint.Host):$($endpoint.Port) db=$DbIndex " +
    "login=$(if ($Login) { $Login } else { 'default' }) readonly=$readOnly client=$($client.Label)")
  if ($Probe) { return 0 }

  return Write-Result $client ($commonArgs + @('--no-raw') + $Arguments) $null
}

# ---- main -------------------------------------------------------------------------------------

$exitCode = 0
try {
  if (-not $Env) { Stop-Wrapper '-Env is mandatory (e.g. -Env prod).' }
  if (-not $Probe -and ([bool]$Query -eq [bool]$File)) { Stop-Wrapper 'Pass exactly one of -Query, -File or -Probe.' }
  if ($MaxLines -lt 1) { Stop-Wrapper '-MaxLines must be at least 1.' }

  # The registry sits one folder above the script and nowhere else: nothing the caller controls moves it, because
  # it alone says which hosts may be written to.
  $registryPath = Join-Path (Split-Path -Parent $PSScriptRoot) 'db-targets.json'
  $resolved = Resolve-Target $Env $Engine $Project $PWD.Path $registryPath
  $engineName = $resolved.Engine
  $script:WriteMode = -not $resolved.ReadOnly

  $envFileValues = @{}
  if ($resolved.EnvFile) {
    if (-not (Test-Path -LiteralPath $resolved.EnvFile -PathType Leaf)) {
      Stop-Wrapper "Registry: the envFile of project '$($resolved.Project)' does not exist: $($resolved.EnvFile)"
    }
    $envFileValues = Read-DotEnv $resolved.EnvFile
  }
  $target = Expand-Target $resolved.Target $envFileValues "$Env/$engineName"
  if ($engineName -eq 'postgres') { $target = Merge-PgUrl $target }

  $userInput = $Query
  if ($File) {
    if ($engineName -eq 'redis') { Stop-Wrapper 'Redis takes one command in -Query, not a file.' }
    if (-not (Test-Path -LiteralPath $File -PathType Leaf)) { Stop-Wrapper "Input file not found: $File" }
    $userInput = Get-Content -LiteralPath $File -Raw
  }
  $redisArgs = $null
  if (-not $Probe) {
    if (-not $userInput -or -not $userInput.Trim()) { Stop-Wrapper 'The input is empty.' }
    switch ($engineName) {
      'sqlserver' { Assert-PlainSql $userInput }
      'postgres' { Assert-PlainPgSql $userInput (-not $script:WriteMode) }
      'redis' { $redisArgs = ConvertTo-RedisArgs $userInput (-not $script:WriteMode) }
    }
  }

  $server = Get-Setting $target 'server'
  if (-not $server) { Stop-Wrapper "Registry: '$Env' has no server." }
  if ($script:WriteMode) {
    $serverHost = (Split-Server $engineName $server $null).Host
    Assert-DevHostForWrite $serverHost $resolved.DevHosts
  }

  $databases = @(Get-Setting $target 'databases' | Where-Object { $null -ne $_ } | ForEach-Object { [string]$_ })
  if (-not $databases.Count -and $engineName -eq 'redis') { $databases = @('0') }
  if (-not $databases.Count) { Stop-Wrapper "Registry: '$Env' lists no databases." }
  if (-not $Db) { $Db = $databases[0] }
  $dbName = $databases | Where-Object { $_ -ieq $Db } | Select-Object -First 1
  if (-not $dbName) {
    Stop-Wrapper "Database '$Db' is not allowed for '$Env'. Allowed: $(Get-RawDatabaseList $resolved.Target $engineName)"
  }
  if ($engineName -eq 'postgres') { Assert-PgDatabaseName $dbName }

  $login = Get-Setting $target 'user'
  $secret = Get-Setting $target 'password'
  $auth = Get-Setting $target 'auth'
  if ($auth) {
    $fragment = Read-AuthFragment $auth
    if (-not $login) { $login = $fragment.User }
    if (-not $secret) { $secret = $fragment.Secret }
  }
  if ($engineName -ne 'redis' -and (-not $login -or -not $secret)) {
    Stop-Wrapper "Registry: '$Env' needs a user and a password (auth, or user + password)."
  }
  $script:Secret = [string]$secret

  $exitCode = switch ($engineName) {
    'sqlserver' { Invoke-SqlServer $target $server $dbName $login $userInput }
    'postgres' { Invoke-Postgres $target $server $dbName $login $userInput }
    'redis' { Invoke-Redis $target $server $dbName $login $redisArgs }
  }
} catch [WrapperError] {
  [Console]::Error.WriteLine((Hide-Secret $_.Exception.Message))
  $exitCode = $_.Exception.Code
} catch {
  [Console]::Error.WriteLine((Hide-Secret "db-ro failed: $($_.Exception.Message)"))
  $exitCode = 2
} finally {
  foreach ($name in $script:SetVars) { [System.Environment]::SetEnvironmentVariable($name, $null) }
  $env:WSLENV = $script:PreviousWslEnv
  foreach ($path in $script:TempFiles) { Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue }
}
exit $exitCode
