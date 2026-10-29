---
name: logs
description: >-
  Use when a service's logs must be read or filtered: errors, a trace id, from compose, containers,
  Kubernetes, Aspire or Grafana; "guarda i log". Runs in ops-analyst.
argument-hint: "[service] [filter] [--since <dur>] [-n <lines>] [--errors] [--env <env>]"
context: fork
agent: ops-analyst
background: false
---

# logs — the matching lines of one service, read where the noise stays

**Contract.** Your agent's report on the matching lines · never follows a stream · prose in the chat language;
log lines, names and ids verbatim.

Arguments: `$ARGUMENTS`

Starting context: as in `db` (no conversation history; this text, the repository and your agent
instructions are everything you have).

## When

Not for: adding or changing logging (`dotnet-diagnostics`); investigating the cause behind the error
(`debug-systematic`, in the caller); a red CI run (its step log via `azdo-cli`, then `debug-systematic`).

## Decide

### Argument grammar — order free, every part optional

| Token | Meaning | Absent → |
| --- | --- | --- |
| `<service>` | compose service, container, pod or project name | your agent's Input row |
| `<filter>` | free text or regex, case-insensitive | none |
| `--errors` | your agent's error filter | — |
| `--since <dur>` | `15m`, `2h`, `1h30m` | `15m` |
| `-n <lines>` | line cap on the read | `200` |
| `--env <env>` | `local`, or a deployed environment name → Grafana/Loki | `local` when a stack runs here, else name the environments found and stop |
| `--follow` | refused here: a fork cannot stream. Return the exact follow command for the caller to run in the main thread | — |

Source, commands and report: your agent's Method and Output.

## Do

Follow command handed back, never run: `docker compose logs <service> -f --since 1m`.

## Traps

1. A follow started "just to see" → the fork never returns → hand the command back instead.
