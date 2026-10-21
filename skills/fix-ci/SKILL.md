---
name: fix-ci
description: >-
  Use when a pipeline, workflow or PR check is red: reads only the failing step's log, classifies
  the cause, proposes the fix. Runs forked.
argument-hint: "[run-id | url | branch] [--current]"
context: fork
agent: general-purpose
model: sonnet
background: false
---

# fix-ci — a red run turned into a diagnosis

**Contract.** The isolated error, its class with evidence, the minimal fix as a diff · never reruns,
cancels or re-queues a run, never edits code, YAML or variables, never pushes · report in Italian;
log lines, job, step, branch names and the fix verbatim.

Arguments: `$ARGUMENTS`

You start with no conversation history: this text and the repository are everything you have. You
cannot ask the user — where a choice is needed, name the candidates and stop; the caller asks.

## When

- A pipeline run, a GitHub workflow or a PR's checks failed and the cause is not yet named.

Not for: a test failing only locally (`debug-systematic`); authoring or restructuring pipeline YAML
(`pipeline`); retrying the run (a rerun is a guess, not a diagnosis).

## Decide

### Argument grammar

| Token | Run |
| --- | --- |
| empty | the newest failed run on the current branch, else the repo's newest failed run (say which) |
| `<run-id>` or a run URL | that run |
| `<branch>` | the newest failed run on that branch |
| `--current` | current branch only, no repo-wide fallback |

### Platform and coordinates — from `git remote get-url origin`

| Remote | Platform | Coordinates |
| --- | --- | --- |
| `dev.azure.com/<org>/<project>/_git/<repo>`, `ssh.dev.azure.com:v3/<org>/<project>/<repo>`, `<org>.visualstudio.com/<project>` | Azure Pipelines | `--org https://dev.azure.com/<org>`, `project=<project>` — passed on every call, never the configured default |
| `github.com` | GitHub Actions | `gh` resolves the repo |
| both or neither | — | name the remotes and stop |

### Classify — this is the answer, not the log

| Class (report it in Italian) | The log looks like | Fix goes to |
| --- | --- | --- |
| `il codice è sbagliato` | compiler error, failing assertion, null reference | the repo — reproduce it locally with the step's own command first |
| `la pipeline è sbagliata` | missing task input, bad variable or template parameter, trigger or path filter, service connection, permission | the YAML |
| `l'ambiente è diverso` | green locally, red on the agent: SDK or image, case-sensitive path, missing tool, culture, unreachable service | pin or provision it, or make the code environment-agnostic |
| `flake` | the same commit passed before; timeout, port in use, network reset | the test or step — and only with that earlier green run quoted |

A class never reproduced is labelled `ipotesi`.

### Report — returned to the caller, ≤ 40 lines

Run id, pipeline or workflow, branch, commit, failing job and step · the error, ≤ 10 lines quoted
with the step name · the class and its evidence · the minimal fix as a fenced diff or YAML snippet ·
one line on what else the same cause breaks · last line: `Applico il fix?` for the caller to ask.

## Do

```powershell
# Azure Pipelines: run → timeline (the failing record and its issues) → that one step's log
az pipelines runs list --org https://dev.azure.com/<org> --project <project> --branch <branch> `
  --result failed --top 5 --query-order FinishTimeDesc -o table
az devops invoke --org https://dev.azure.com/<org> --area build --resource Timeline `
  --route-parameters project=<project> buildId=<run-id> `
  --query "records[?result=='failed'].{name:name, type:type, log:log.id, issues:issues[].message}" -o jsonc
az devops invoke --org https://dev.azure.com/<org> --area build --resource logs `
  --route-parameters project=<project> buildId=<run-id> logId=<log-id> `
  --accept-media-type text/plain --out-file <scratch>\step.log

# GitHub Actions
gh run list --status failure --branch <branch> --limit 5
gh run view <run-id> --log-failed > <scratch>\step.log
gh pr checks <pr>
```

Read the `issues` array first: it often names the error without any log. Then search the saved log
for the **first** real failure (`error CS`, `error MSB`, a failed assertion and its test, a non-zero
`ExitCode`, `npm ERR!`, the innermost stack frame), never the last line, and read slices around it.
`az` auth failure → report it with the login command; never `az account set` or a configure default.

## Traps

1. The quoted error is the summary line → it repeats the count → go back to the first failure.
2. Restore warnings, `NU1701`, deprecations, a retried download quoted as the cause → noise → drop.
3. A whole run's logs paged in → tens of thousands of lines, no signal → the timeline names the one
   step to read.
4. `flake` without the earlier green run on the same commit → unproven → reproduce or call it `ipotesi`.
