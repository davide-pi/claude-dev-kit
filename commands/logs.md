---
description: Tail and filter the current service's logs, whichever way this project produces them — compose, container, log files, Kubernetes or the Aspire dashboard.
argument-hint: "[service] [filter] [--since <dur>] [-n <lines>] [--follow] [--errors]"
---

Get this project's logs on screen without deciding where they live each time. Source discovery is
here; reading a .NET log's *meaning* — scopes, correlation ids, `EventId`, OpenTelemetry — belongs
to **`dotnet-diagnostics`**, and the stack itself to **`docker-dev-env`**.

## Argument grammar

- **`<service>`** — a compose service, container, pod or project name. Absent → resolve in step 1;
  exactly one candidate → use it and say so, several → ask.
- **`<filter>`** — free text or a regex; matched case-insensitively against the lines.
- **`--since <dur>`** — `15m`, `2h`, `1h30m`; default **`15m`**.
- **`-n <lines>`** — default **200**.
- **`--follow`** — stream. Only when the user asked to watch; state how to stop it.
- **`--errors`** — shorthand filter for `error|fail|exception|fatal|unhandled|critical|warn`.

## Steps

1. **Find the source**, first match wins:

   | Evidence in the repo | Source | Read it with |
   | --- | --- | --- |
   | `docker-compose*.yml` with the service | compose | `docker compose logs` |
   | a running container, no compose file | container | `docker logs` |
   | `*.AppHost` project (Aspire) | dashboard | the dashboard URL from the AppHost's console, plus `docker logs` on the resource containers |
   | `k8s`/`helm` manifests, a live context | Kubernetes | `kubectl logs` |
   | a file sink in `appsettings*.json` (`logs/`, `*.log`, rolling) | files | `Get-Content` |
   | the app running in this session's foreground | stdout | the console output already captured |

   ```powershell
   docker compose ps
   docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Status}}"
   ```
   Nothing found → say which sources were checked and stop. Do not start the app to produce logs;
   that is `/run`.

2. **Read it.** Window and line cap always applied:
   ```powershell
   docker compose logs <service> --since 15m -n 200 --timestamps --no-log-prefix
   docker logs <container> --since 15m -n 200 --timestamps
   kubectl logs <pod> -c <container> --since=15m --tail=200            # add -p for the crashed instance
   Get-Content .\logs\<file>.log -Tail 200
   ```

3. **Filter in PowerShell, not by re-reading.** One pass, with context:
   ```powershell
   docker compose logs <service> --since 15m -n 500 | Select-String -Pattern "<filter>" -Context 0,3
   Get-Content .\logs\<file>.log -Tail 2000 | Select-String -Pattern "error|exception" -Context 2,6
   ```
   A .NET exception is a block, not a line: keep the trailing frames (`-Context 0,N`) or the trace
   is useless. Widen `-n` before narrowing the filter — an empty result from too small a window
   looks exactly like a healthy service.

4. **Follow, only if asked**: add `-f` (`--follow` for `kubectl`, `-Wait` for `Get-Content`), keep
   the filter in the pipe, and say the stream is running and how to stop it. Never leave a follow
   running as the end of a turn.

5. **Report** — source and service, the window, the line count read and how many matched · the
   matching lines, oldest first, exceptions kept whole, the middle elided with the count when there
   are many · one line naming the first distinct error and how often it repeats. Nothing matched →
   say so with the window and filter used, and offer the wider window.

## Guardrails

- **Read-only.** No `docker compose up`/`down`/`restart`, no `docker rm`, no `kubectl delete`, no
  `--dry-run` side trips, no starting or stopping anything to make logs appear.
- Never truncate, rotate or delete a log file, and never redirect over one.
- Do not paste thousands of lines: cap, elide, state the counts.
- Never quote a log line containing a token, password, connection string or bearer header — redact
  the value and say it was redacted.
- Do not diagnose here beyond naming the error. A real investigation is `debug-systematic`; a red
  CI run is `/fix-ci`.
- No `--follow` unless the user asked, and never as the last action of a turn.
