# Environment and secrets for local development

The rule is short and has no exceptions: **a committed file never contains a credential.** Not a
weak one, not a "local only" one, not one behind a comment saying it is only local. A committed
password is a password in the history forever, it gets copied into the next repository, and the
secret-scan hook and the validator both reject it.

## Where a value is allowed to live

| Value                                              | Belongs in                                        | Committed |
| -------------------------------------------------- | ------------------------------------------------- | --------- |
| Service names, container ports, volume names        | the compose file                                   | yes       |
| Image tags, published ports, database names         | `.env` — and the compose file references `${VAR}`  | no        |
| Local container passwords                           | `.env`                                             | no        |
| The same values, as a template with empty slots     | `.env.example`                                     | yes       |
| The application's own local connection strings       | .NET user secrets, or environment variables         | no        |
| Anything belonging to a shared or remote environment | a pipeline variable group, never a developer file   | no        |

`.env.example` is the piece people skip and then regret: it is the only record of which variables
the stack needs. Keep it complete, with the keys present and the values empty or obviously fake, and
update it in the same commit that introduces a new variable.

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

For a `${VAR}` in the compose file, in order of precedence:

1. a variable already set in the shell that runs the command;
2. a `--env-file` given on the command line;
3. the `.env` file next to the compose file.

The shell winning over `.env` is the useful bit: `$env:POSTGRES_PORT = '5433'` for one session
overrides the file without editing it. It is also a trap, because a variable left set in a profile
silently overrides the file for every future session.

```powershell
docker compose config                 # the resolved truth: every ${VAR} substituted
docker compose config | Select-String 'ports:' -Context 0,2
```

`docker compose config` **prints resolved values, secrets included.** It is the right command for
diagnosing substitution and the wrong thing to paste into chat, a work item, or a PR comment.

Write `${VAR}` with **no default**. A default (`${MSSQL_PORT:-1433}`) means a missing variable never
fails — it just quietly uses a value nobody chose, and the mistake surfaces as a port collision or a
connection to the wrong database. With no default, compose warns that the variable is empty, which
is exactly the feedback wanted. Two forms make it stricter still: `${VAR?message}` fails when the
variable is unset, `${VAR:?message}` fails when it is unset or empty.

## Environment inside the container: the two forms

```yaml
    environment:
      POSTGRES_USER: ${POSTGRES_USER}       # explicit, and the one to use
    env_file:
      - ./postgres.env                      # a whole file handed to one service
```

Prefer the explicit list. `env_file` puts every key in that file into the container, which makes it
impossible to see from the compose file what a service actually receives — and it is how a variable
intended for one service ends up in all of them.

An escaped `$$` inside a healthcheck or a `command` means "leave this for the shell inside the
container", not "substitute now". `$MSSQL_SA_PASSWORD` in a probe is resolved by compose on the host
and baked into the inspect output; `$$MSSQL_SA_PASSWORD` is resolved inside the container, where the
value is already in the environment. Use the double form in probes.

## The application side

The .NET application never reads `.env`. It gets its local configuration from user secrets, which
live outside the repository per project, keyed by the project's user-secrets id:

```powershell
dotnet user-secrets init --project .\src\Api
dotnet user-secrets set "ConnectionStrings:AppDatabase" $env:APP_DB_CONNECTION --project .\src\Api
dotnet user-secrets list --project .\src\Api
```

Environment variables are the alternative and the one that works for any process, including a
container: the double underscore maps to a configuration section separator, so
`ConnectionStrings__AppDatabase` sets `ConnectionStrings:AppDatabase`. Set it per invocation, not
permanently, so it cannot leak into an unrelated session.

A committed `appsettings.Development.json` may name a host, a port and a database, and must never
carry the password — the password comes from user secrets or the environment, and the settings file
either omits the key entirely or leaves it empty. An Aspire app host removes the question for the
services it starts: it injects the connection information itself (see `aspire.md`).

## Compose secrets, and why they are usually not the answer

Compose supports a `secrets:` block that mounts a file into the container instead of exposing an
environment variable. It is the right shape for production and for anything Swarm-managed, and it
does not fit the local case: most database images read their password from an environment variable
and cannot be told to read a file, so the secret has to be reintroduced as a variable anyway. Use
the `.env` route locally, and keep the discussion about file-based secrets for deployment.

## Before committing

| Check                                            | Command                                                   |
| ------------------------------------------------ | --------------------------------------------------------- |
| Nothing secret in the staged diff                | read the diff for `Password`, `pwd`, `token`, `key`        |
| `.env` is ignored and not tracked                | `git check-ignore -v .env`                                 |
| `.env.example` lists every variable the file uses | compare its keys against `.env`                           |
| No resolved config committed by accident          | make sure no `config` output was saved to a file           |

The secret-scan hook blocks a write that introduces a password-bearing connection string, and the
validator rejects one in a skill or command. Both are a backstop, not the control — the control is
that the value was never written into a tracked file in the first place.
