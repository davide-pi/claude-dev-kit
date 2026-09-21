# Pipelines — the command catalogue

Two families cover the same objects from different angles. `az pipelines` is the modern one and the
default choice; `az pipelines build` is the older build surface, still present and occasionally the
only one with the filter you need.

| Object | Modern | Older |
| --- | --- | --- |
| Definition | `az pipelines list` / `show` | `az pipelines build definition list` / `show` |
| Run | `az pipelines runs list` / `show` | `az pipelines build list` / `show` |
| Queue one | `az pipelines run` | `az pipelines build queue` |
| Cancel | — | `az pipelines build cancel` |

## Definitions

```powershell
az pipelines list --query "[].{id:id, name:name, folder:folderPath, type:configuration.type}" -o table
az pipelines list --name '<prefix>*' --query-order NameAsc -o table
az pipelines list --repository <repo> --repository-type tfsgit -o table
az pipelines show --id <definition-id> -o jsonc
az pipelines show --name '<pipeline-name>' --query "configuration.path" -o tsv     # the YAML file
```

`--repository-type` is mandatory when `--repository` is passed; for an Azure Repos Git repository it
is `tfsgit` (`github`, `githubenterprise`, `bitbucket`, `git`, `svn`, `tfsversioncontrol` are the
others). `--folder-path` narrows to one folder, `--top` and `--query-order` page and sort.

## Runs

```powershell
az pipelines runs list --top 10 --query-order FinishTimeDesc `
  --query "[].{id:id, pipeline:definition.name, status:status, result:result, branch:sourceBranch, finished:finishTime}" -o table

az pipelines runs list --pipeline-ids <id> --result failed --top 5 -o table
az pipelines runs list --branch <branch> --status completed -o table
az pipelines runs list --reason pullRequest --top 20 -o table
az pipelines runs show --id <run-id> -o jsonc
```

| Flag | Values |
| --- | --- |
| `--status` | `all`, `notStarted`, `inProgress`, `completed`, `cancelling`, `postponed`, `none` |
| `--result` | `succeeded`, `partiallySucceeded`, `failed`, `canceled`, `none` |
| `--reason` | `manual`, `individualCI`, `batchedCI`, `pullRequest`, `schedule`, `buildCompletion`, `triggered`, `userCreated`, `all`, … |
| `--query-order` | `FinishTimeDesc`/`Asc`, `QueueTimeDesc`/`Asc`, `StartTimeDesc`/`Asc` |
| `--pipeline-ids` | space-separated definition ids |
| `--branch`, `--tags`, `--requested-for`, `--top` | the remaining filters |

`--result failed` combined with `--top` is the whole of "what is red right now" and is the first
command `/fix-ci` should run.

## Queueing a run

```powershell
az pipelines run --name '<pipeline-name>' --branch <branch>
az pipelines run --id <definition-id> --branch refs/pull/<pr>/merge
az pipelines run --name '<pipeline-name>' --branch <branch> `
  --variables 'Key1=value1' 'Key2=value2' --parameters 'env=staging'
az pipelines run --id <definition-id> --commit-id <sha>
```

`--variables` sets queue-time variables (the definition must allow it) and `--parameters` sets
runtime template parameters; both take space-separated `name=value` pairs. `--branch` accepts a
short name, a `refs/heads/…`, a `refs/tags/…` or a `refs/pull/<n>/merge` ref. A queued run consumes
an agent and can deploy — it is a write. Say which pipeline, which branch and which parameters
before running it, and never queue a release-shaped pipeline to "see what happens".

`az pipelines build cancel --build-id <run-id>` stops a run that is in progress — note that this
verb spells the id flag `--build-id`, unlike every other run verb.

## Reading a failed run's logs — the gap

There is no log verb: `az pipelines runs` exposes only `list`, `show`, `artifact` and `tag`, and
`az pipelines build` only `list`, `show`, `queue`, `cancel`, `definition` and `tag`. `runs show`
returns the run's links, not the log text.

Work from the outside in, and stop as soon as the failing step is named:

```powershell
# 1. Which run failed, and what it says about itself.
az pipelines runs list --pipeline-ids <id> --result failed --top 1 --query "[0].{id:id, branch:sourceBranch, url:url}" -o jsonc

# 2. The run's timeline names every job and step with its own result — this is where the failing
#    step is identified, without reading a single line of log.
az devops invoke --area build --resource Timeline --route-parameters project=<project> buildId=<run-id> `
  --query "records[?result=='failed'].{name:name, type:type, log:log.id, issues:issues[].message}" -o jsonc

# 3. Only then pull that one step's log, by the id the timeline gave.
az devops invoke --area build --resource logs --route-parameters project=<project> buildId=<run-id> logId=<log-id> `
  --accept-media-type text/plain --out-file <scratch-path>\step.log
```

A run id and a build id are the same number, which is why the `build` area answers for a pipeline
run. If either call is rejected, confirm the route against the resource listing described in
`auth-and-config.md`; the MCP build-log tool is the documented fallback and takes the run id
directly.

Two habits that matter more than the command:

- **Never pull a whole run's logs.** A CI run's log set is tens of thousands of lines and most of it
  is restore and compilation noise. The timeline tells you which one step to read.
- **Read the `issues` array first.** Errors the agent already extracted are in the timeline record,
  so a large share of failures need no log at all.

## Artifacts and variables

```powershell
az pipelines runs artifact list --run-id <run-id> -o table
az pipelines runs artifact download --run-id <run-id> --artifact-name <name> --path <scratch-path>
az pipelines variable list --pipeline-name '<pipeline-name>' -o table
az pipelines variable-group list -p <project> --query "[].{id:id, name:name}" -o table
az pipelines variable-group show --group-id <id> -o jsonc
```

A variable group holding secrets returns them as `isSecret: true` with no value — that is correct
behaviour, not a failure. Never try to route around it: read the secret's *name* and stop there.
