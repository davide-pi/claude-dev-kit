# db-targets v2: project -> environment -> engine

Branch: `refactor/kit-v3` (PR #13) · Work item: none · Source: owner request, "a file where I configure
every project's databases in a standard format, `${VAR}` secrets, a `local` environment".

## Goal

`~/.claude/db-targets.json` lists projects by name; each project names its workspace root, an optional
dotenv file, and environments (`local`, `stg`, `prod`, any name) holding one block per engine (`sql`,
`postgres`, `redis`). Any string value may embed `${VAR}`, resolved from the project's `envFile`, then
the process environment, then the user environment. `db-ro.ps1 -Env prod -Engine postgres` reads a product's
cache database from a `url` already present in the project's `.env`. An environment may set
`"readOnly": false` only when every host is a dev host: db-ro then runs the statement without probe or
read filter. Every other target keeps today's guarantees (server-side probe, exit 3 / 4, client filters).

## Not in scope

- RabbitMQ (D-D): the `rabbit` engine key is reserved and refused with "not supported yet".
- The old registry shape (`targets`, `env:` / `envfile:`): not read any more; the owner's file is
  migrated once (task 7). An old-shape file stops with exit 2 pointing at the example.
- Making `local` hosts dev hosts for the `sql-target.js` hook: `devHosts` stays the only list the hook
  trusts, so a mistyped prod host under `local` can never unlock raw clients.
- P2 (`sqlcmd` / `psql` / `redis-cli` allow rules): separate change.

## Open questions

None. Decided with the owner: D-A (environment level, plus `local`), D-B (`${VAR}`), D-C (postgres `url`).

## Registry shape

```jsonc
{
  "devHosts": ["localhost", "127.0.0.1", "sqlserver", "postgres", "redis"],   // unchanged, read by sql-target.js
  "projects": {
    "<project>": {
      "root": "C:\\workspaces\\<product-root>",          // string or array; longest prefix of -Project / cwd wins
      "envFile": "~/<secrets-dir>/<product>.env",          // optional
      "prod": {
        "sql":      { "server": "${PROD_SQL_HOST},1433", "auth": "${PROD_SQL_RO_AUTH}", "databases": ["<Db>"],
                      "encrypt": true, "trustServerCertificate": false, "applicationIntent": "ReadOnly" },
        "postgres": { "url": "${PROD_PG_RO_URL}", "password": "${PROD_PG_RO_PWD}", "sslmode": "require" },
        "redis":    { "server": "<cache-host>:6380", "tls": true, "user": "<acl-user>", "password": "${PROD_REDIS_RO_PWD}" }
      },
      "local": {
        "readOnly": false,
        "sql": { "server": "localhost,1433", "user": "sa", "password": "${LOCAL_SA_PWD}", "databases": ["<Db>"] }
      }
    }
  }
}
```

Reserved project keys: `root`, `envFile`. Every other key of a project is an environment. `readOnly`
sits on the environment or the engine block (engine wins), default `true`. Engine `sql` (alias
`sqlserver`) keeps every key `db-ro.ps1` reads today; `postgres` adds `url`
(`postgres[ql]://user[:pwd]@host[:port]/db[?sslmode=...]`; explicit `server` / `user` / `password` /
`databases` / `sslmode` keys win over the URL's parts).

## Tasks

### 1. `${VAR}` expansion (done)

- files: `scripts/db-ro.ps1` (edit)
- change: string values expand every `${NAME}` from the envFile entries (parsed by the existing
  `Read-DotEnv`), then process env, then user env; an unknown name stops with exit 2 naming the
  variable and where it looked, never a value. `env:` / `envfile:` and `Resolve-Ref` are removed.
- interface: `function Expand-Value([string]$Text, [hashtable]$EnvFileValues, [string]$What)` -> string
- verify: `node --test tools/db-ro.test.mjs` -> new test "Expand-Value: envFile first, then
  environment; unknown name is exit 2" passes
- depends on: none

### 2. Registry resolution by project, environment, engine (done)

- files: `scripts/db-ro.ps1` (edit)
- change: new parameter `-Engine` (`sql|sqlserver|postgres|redis`; optional when the environment has
  one engine, else exit 2 listing them); `-Project` takes a project name or a path (path -> longest
  `root` prefix; default cwd). Missing `projects`, an old `targets` file, an unknown project /
  environment / engine, or engine `rabbit` -> exit 2 with the available names. The hard-coded refusal
  of `-Env dev` is removed (task 4 replaces it).
- interface: `function Resolve-Target([string]$EnvName, [string]$EngineName, [string]$ProjectArg, [string]$CurrentPath, [string]$RegistryPath)` -> `@{ Project; Root; EnvFile; Engine; Target; ReadOnly; DevHosts }`
- verify: `node --test tools/db-ro.test.mjs` -> new tests "Resolve-Target: by name, by longest root,
  single-engine default, ambiguous engine, rabbit refused, old shape refused" pass
- depends on: 1

### 3. Postgres `url` (done)

- files: `scripts/db-ro.ps1` (edit)
- change: a postgres block with `url` gets host, port, user, password, database and sslmode from it
  (percent-decoded); explicit keys win. The URL password counts as the secret (scrubbed from output).
- interface: `function ConvertFrom-PgUrl([string]$Url)` -> `@{ Host; Port; User; Secret; Database; SslMode }`
- verify: `node --test tools/db-ro.test.mjs` -> new test "ConvertFrom-PgUrl: user, encoded password,
  default port, query sslmode, IPv6 host; non-postgres scheme is exit 2" passes
- depends on: 2

### 4. `readOnly: false` on dev hosts only (done)

- files: `scripts/db-ro.ps1` (edit)
- change: the main block's "Refused: '<server>' is a dev host" (today `db-ro.ps1:832-834`) is replaced:
  dev host + `readOnly` false -> no probe, no `Assert-ReadStatements`, no Postgres read-only session
  (PGOPTIONS without `default_transaction_read_only`), header `readonly=NO(local)`; dev host + `readOnly`
  true -> the normal probe path; non-dev host + `readOnly` false -> exit 2 "write access is only for dev
  hosts", before connecting. Escape filters stay on EVERY path: `Assert-PlainSql` (`:!!`, `:r`, ...), the
  Redis one-command parsing, and the backslash-line check of `Assert-PlainPgSql` (`\!`, `\copy`, `\o`).
  `Assert-PlainPgSql` is split so only its read-only-setting regex (`transaction_read_only`, `SET ROLE`,
  `RESET`, `DISCARD`) is skipped when `readOnly` is false.
- interface: none new
- verify: `node --test tools/db-ro.test.mjs` -> new tests "readOnly false: allowed on dev hosts,
  exit 2 on any other host" and "readOnly false keeps the escape filters: `\! ls`, `:!! dir` rejected" pass
- depends on: 2, 3

### 5. Example and docs (done)

- files: `db-targets.example.json` (edit), `README.md` (edit, lines ~180-220), `skills/db/SKILL.md` (edit,
  `--env` row: `--env <env> [--engine <e>]`), `agents/db-analyst.md` (edit, the client table row that
  names `db-ro.ps1`), `scripts/db-ro.ps1` (edit, comment-based help), `hooks/lib/sql-target.js` (edit,
  comment only: devHosts location unchanged)
- change: the example shows the shape above with placeholders only; docs name `-Engine` and the new
  shape; no real hosts, names or credentials.
- verify: `node tools/validate.mjs` -> exit 0; `node --test tools/sql-target.test.mjs` -> 0 failed
- depends on: 4

### 6. Full suite (done)

- files: none
- change: every kit test.
- verify: `node --test "tools/*.test.mjs"` -> fail 0
- depends on: 5

### 7. Migrate the owner's registry (local-only, not committed)

- files: `~/.claude/db-targets.json` (edit, backup first to `~/.claude/backups/db-targets-<date>.json`)
- change: one project entry per product: root `<product-root>`, envFile `<secrets-dir>/<product>.env`, prod `sql` from
  the existing references, prod `postgres` `{ url: ${<ENV_VAR>}, password: ${<ENV_VAR>} }`; key names confirmed with
  the owner before writing.
- verify: `pwsh -NoProfile -File ~/.claude/scripts/db-ro.ps1 -Env prod -Engine sql -Probe -Project <project>`
  -> header `readonly=verified`; same with `-Engine postgres` -> `readonly=verified`
- depends on: 6. One owner step, in this order, because each half breaks the other (new script + old
  file -> "no 'projects'", old script + new file -> "no 'targets'"; the hook's `devHosts` survives both):
  backup -> `install.ps1 -Force` -> write the migrated file -> the two probes.

## Verification

`evidence-by-stack.md`, script/hook row: `node --test "tools/*.test.mjs"` fail 0, `node tools/validate.mjs`
exit 0, then the two live probes of task 7 (read-only on production, owner-installed script).

## Decisions taken

- One registry shape, no compatibility layer: one user, one file to migrate; two shapes would double
  the resolution code a security wrapper depends on.
- `readOnly: false` gated on dev hosts inside db-ro, not on the environment name: a `local` block that
  points at a shared server stays read-only.
- The registry path is derived from the script's own location only (`<script folder>/../db-targets.json`):
  no parameter, `$HOME`, `USERPROFILE` or variable moves it, because the file's `devHosts` and `readOnly`
  decide where a run may write. Every "Allowed" / available-names message lists the registry strings as
  written, never expanded values.
