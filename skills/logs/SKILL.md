---
name: logs
description: >-
  Use when a service's logs must be read or filtered: errors, a trace id, from compose,
  containers, Kubernetes, Aspire or Grafana. Runs in ops-analyst.
argument-hint: "[service] [filter] [--since <dur>] [-n <lines>] [--errors] [--env <env>]"
context: fork
agent: ops-analyst
background: false
---

# logs — the matching lines of one service, read where the noise stays

**Contract.** The matching lines verbatim plus a five-line reading · never starts, stops, restarts or
deletes anything, never follows a stream · prose in Italian; log lines, names and ids verbatim.

Arguments: `$ARGUMENTS`

You start with no conversation history: this text, the repository and your agent instructions are
everything you have. You cannot ask the user — where a choice is needed, name the candidates and
stop; the caller asks.

## When

- Errors of a service in a window, the lines of one trace or business id, a crash's last lines.

Not for: adding or changing logging (`dotnet-diagnostics`); investigating the cause behind the error
(`debug-systematic`, in the caller); a red CI run (its step log via `azdo-cli`, then `debug-systematic`).

## Decide

### Argument grammar — order free, every part optional

| Token | Meaning | Absent → |
| --- | --- | --- |
| `<service>` | compose service, container, pod or project name | resolve from the repo: one candidate → use it and say so; several → name them and stop |
| `<filter>` | free text or regex, case-insensitive | none |
| `--errors` | filter `error\|fail\|exception\|fatal\|unhandled\|critical\|warn` | — |
| `--since <dur>` | `15m`, `2h`, `1h30m` | `15m` |
| `-n <lines>` | line cap on the read | `200` |
| `--env <env>` | `local`, or a deployed environment name → Grafana/Loki | `local` when a stack runs here, else name the environments found and stop |
| `--follow` | refused here: a fork cannot stream. Return the exact follow command for the caller to run in the main thread | — |

### Source — first match wins

| Evidence | Source |
| --- | --- |
| `--env` names a deployed environment | Grafana → Loki, house labels `service_name`, `deployment_environment` |
| `docker-compose*.yml` with the service, stack running | compose |
| a running container, no compose file | container |
| `*.AppHost` project | Aspire resource containers |
| `k8s` / `helm` manifests and a live context | Kubernetes |
| a file sink in `appsettings*.json` | log files |
| none of the above | list what was checked and stop; never start the app to produce logs |

### Report

Your agent's four sections, ≤ 50 lines. Nothing matched → the window and filter used, and the wider
window to try next.

## Do

```powershell
docker compose ps
docker compose logs <service> --since 15m -n 200 --timestamps --no-log-prefix |
  Select-String -Pattern "<filter>" -Context 0,6
kubectl logs <pod> -c <container> --since=15m --tail=200     # -p for the crashed instance
Get-Content <file> -Tail 2000 | Select-String -Pattern "error|exception" -Context 2,6
```

Follow command handed back, never run: `docker compose logs <service> -f --since 1m`.

## Traps

1. A .NET exception cut to its first line → `-Context 0,N` too small → keep the frames.
2. Empty result, missing Grafana tools, a secret in a line: the narrow-first, tools-absent and redact rules
   of your agent.
