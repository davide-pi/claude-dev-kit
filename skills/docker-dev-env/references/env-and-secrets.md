# Environment and secrets for local development

The rule has no exceptions: **a committed file never contains a credential.** Not a weak one, not a
"local only" one. The secret-scan hook and the validator both reject it.

## Where a value is allowed to live

| Value                                              | Belongs in                                        | Committed |
| -------------------------------------------------- | ------------------------------------------------- | --------- |
| Service names, container ports, volume names        | the compose file                                   | yes       |
| Image tags, published ports, database names         | `.env` — and the compose file references `${VAR}`  | no        |
| Local container passwords                           | `.env`                                             | no        |
| The same values, as a template with empty slots     | `.env.example`                                     | yes       |
| The application's own local connection strings       | .NET user secrets, or environment variables         | no        |
| Anything belonging to a shared or remote environment | a pipeline variable group, never a developer file   | no        |

`.env.example` is the only record of which variables the stack needs: keep it complete (keys present,
values empty or obviously fake) and update it in the same commit that introduces a variable.

```
# .env.example — copy to .env and fill in; .env is gitignored
MSSQL_TAG=
MSSQL_PORT=1433
MSSQL_SA_PASSWORD=
POSTGRES_TAG=
POSTGRES_PORT=5432
POSTGRES_USER=app
POSTGRES_DB=appdb
POSTGRES_PASSWORD=
```

Gitignore both `.env` and `compose.override.yaml`, and check it before the first commit — an `.env`
already tracked stays tracked no matter what the ignore file says later.

## How compose resolves a variable

Precedence: a variable set in the shell, then `--env-file`, then the `.env` next to the compose file.
A variable left set in a PowerShell profile silently overrides the file for every future session.

`docker compose config` **prints resolved values, secrets included.** Right for diagnosing
substitution, wrong to paste into chat, a work item, or a PR comment.

Write `${VAR}` with **no default**. A default (`${MSSQL_PORT:-1433}`) means a missing variable quietly
uses a value nobody chose and surfaces as a port collision or a connection to the wrong database.
`${VAR?message}` / `${VAR:?message}` are stricter (fail when unset / unset or empty).

## Environment inside the container

Prefer the explicit `environment:` list over `env_file`: with `env_file` the compose file no longer
shows what a service receives, and a variable meant for one service ends up in all.

`$$` inside a healthcheck or `command` leaves substitution to the shell in the container. A single
`$MSSQL_SA_PASSWORD` in a probe is resolved by compose on the host and baked into the inspect output.
Use the double form in probes.

## The application side

The .NET application never reads `.env`. Local configuration comes from user secrets
(`dotnet user-secrets set "ConnectionStrings:AppDatabase" $env:APP_DB_CONNECTION --project .\src\Api`)
or environment variables (`ConnectionStrings__AppDatabase`), set per invocation so they cannot leak
into an unrelated session.

A committed `appsettings.Development.json` may name a host, a port and a database, and must never
carry the password: omit the key or leave it empty. An Aspire app host injects the connection
information itself for the services it starts (see `aspire.md`).

## Compose secrets

The `secrets:` block fits production, not local: most database images read their password from an
environment variable and cannot be told to read a file. Use the `.env` route locally.

## Before committing

| Check                                            | Command                                                   |
| ------------------------------------------------ | --------------------------------------------------------- |
| Nothing secret in the staged diff                | read the diff for `Password`, `pwd`, `token`, `key`        |
| `.env` is ignored and not tracked                | `git check-ignore -v .env`                                 |
| `.env.example` lists every variable the file uses | compare its keys against `.env`                           |
| No resolved config committed by accident          | make sure no `config` output was saved to a file           |

The secret-scan hook and the validator are a backstop, not the control — the control is that the
value was never written into a tracked file.
