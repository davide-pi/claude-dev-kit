# Diagnosing a failed run from the CLI

This is the manual path, for understanding a class of failure or reviewing a pipeline's history.
For "the pipeline is red right now and I need it green", use the `/fix-ci` command — it runs this
sequence, isolates the failing step and proposes the fix, without the reading.

## The first question: which layer failed

Answer it before opening a log, because it decides everything after.

| Evidence                                                        | Layer            | Where to look next          |
| --------------------------------------------------------------- | ---------------- | --------------------------- |
| The same commit passed yesterday and fails today, untouched      | environment      | agent image, feed, connection |
| It fails at the same step for every branch                       | the pipeline     | the YAML and its variables  |
| It fails only on this branch                                     | the code         | the diff                    |
| It failed once and passes on re-run                              | flaky            | the test or a timeout       |
| The run never started, or sat queued                             | the pool         | agents and parallelism      |
| Expansion failed before any step ran                             | the YAML         | the preview endpoint        |

The last row is worth its own check: a compile-time failure produces no timeline and no logs, only
an error on the run itself. If the timeline is empty, it never reached an agent.

## Walking a run

```powershell
$org = 'https://dev.azure.com/<org>'; $proj = '<project>'

# recent history for one definition — is this new, or has it always been red?
az pipelines runs list --org $org -p $proj --pipeline-ids <id> --top 20 `
  --query "[].{id:id, result:result, branch:sourceBranch, reason:reason, finished:finishTime}" -o table

# the run itself: why it was queued, which commit, which variables were overridden
az pipelines runs show --org $org -p $proj --id <runId> -o json

# the timeline: every stage, job, task, with result, issues and a log id
az devops invoke --org $org --area build --resource timeline `
  --route-parameters project=$proj buildId=<runId> --api-version 7.1 -o json |
  ConvertFrom-Json | ForEach-Object { $_.records } |
  Where-Object result -eq 'failed' |
  Select-Object type, name, @{n='log';e={$_.log.id}}, @{n='issue';e={$_.issues.message -join '; '}}

# the failing task's log
az devops invoke --org $org --area build --resource logs `
  --route-parameters project=$proj buildId=<runId> logId=<logId> --api-version 7.1 |
  Set-Content .\step.log

# artifacts the run produced, and one of them fetched
az pipelines runs artifact list --org $org -p $proj --run-id <runId> -o table
az pipelines runs artifact download --org $org -p $proj --run-id <runId> `
  --artifact-name <name> --path .\artifact
```

`jq` is not installed. Shape JSON with `--query` (JMESPath) inside `az`, or pipe into
`ConvertFrom-Json` and use PowerShell — the second is easier for anything nested, as above.

The timeline is the instrument that matters. It is a flat list of records with parent links, so one
query gives every failed record at every level, and `issues` usually carries the error message
without opening a log at all. Only fetch a log when the issue text is not enough.

## Reading a log without reading all of it

```powershell
Select-String -Path .\step.log -Pattern 'error|##\[error\]|FAILED|Unhandled' -Context 2,6
Select-String -Path .\step.log -Pattern '^##\[' | Select-Object -First 40   # the step's own sections
```

A build log's real error is almost never at the end — the end is the summary and the exit code. The
first `error` line is the cause; everything after it is consequence. For a test failure, the useful
part is the failed test's name and its assertion, not the runner's totals.

To see substitution and the resolved variables the run used, enable diagnostic logging for one run
(the system diagnostics variable, set at queue time) rather than permanently. It multiplies log
size, so use it deliberately and then turn it off.

## Failure classes, and what each one actually means

| Class                                   | Signature in the log                              | Fix belongs to         |
| --------------------------------------- | ------------------------------------------------- | ---------------------- |
| Compile error                            | a file and line from the compiler                  | the code               |
| Test failure                             | an assertion, a test name                          | the code, or the test  |
| Restore or feed authentication            | 401/403 on a package feed                          | the service connection or the feed permission |
| Missing SDK or tool                       | "command not found", or a wrong SDK resolved       | the pipeline: install and pin it explicitly |
| Service connection                        | authorization failed, subscription not found        | the connection, and whether the pipeline is authorized for it |
| Variable group not authorized              | a variable is empty, or the run fails at start      | grant the pipeline access once, in the UI |
| Agent capability                           | "no agent found matching the demands"              | the pool or the demands |
| Timeout                                    | the job is cancelled at a round number of minutes  | the job's timeout, or the work it does |
| Out of disk or memory                      | write failures, or a killed process                 | what the job caches and downloads |
| Deployment approval                        | the stage sits waiting, not failing                 | nobody — approve it     |

Two of these look like code failures and are not: a wrong SDK resolves and compiles different code,
and an empty secret produces an authentication error from whatever it was passed to.

## Reproducing the step locally

The point of preferring plain CLI calls over platform tasks is exactly this: the failing step can be
run on the machine. Take the command from the log — the tasks print theirs — and run it as-is:

```powershell
dotnet restore --locked-mode
dotnet build -c Release --no-restore
dotnet test -c Release --no-build --logger "trx;LogFileName=test.trx"
```

Two differences to close before trusting the result: the SDK the agent used (from the log's first
lines, against what the project files require) and the configuration, which is `Release` in CI and
`Debug` locally. A test that passes locally in `Debug` and fails in CI in `Release` is a real bug,
not an environment problem.

## Re-run, or do not

| Situation                                                | Action                                         |
| -------------------------------------------------------- | ---------------------------------------------- |
| A network or feed error, once                             | re-run the failed stage                        |
| A test that fails intermittently                          | do **not** re-run to green — record it and fix it |
| The same failure twice                                    | it is deterministic; stop re-running            |
| A deploy stage failed halfway                             | check what already changed before re-running    |

Re-running a deploy is not free: the first attempt may have applied a migration or half-updated a
resource. Read what the failing stage did before re-queueing it.

## When the CLI cannot reach it

`az devops invoke` covers the build and pipelines areas well and occasionally rejects a default API
version — pin `--api-version` to the one the endpoint documents. When an endpoint is not reachable
at all, the Azure DevOps MCP server is the documented fallback: it can read a run, its logs and its
definition. Note in chat that the fallback was used, and why.
