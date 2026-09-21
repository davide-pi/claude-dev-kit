# Templates: extends, includes, and typed parameters

A template is a YAML file that another file pulls in. There are two entirely different ways to do
it, and choosing the wrong one is the reason a pipeline ends up unreviewable.

| Mechanism | Shape                                        | Use it when                                             |
| --------- | -------------------------------------------- | ------------------------------------------------------- |
| `extends` | the pipeline hands control to **one** template that owns the whole structure | the structure must be identical and enforceable across pipelines |
| include   | `- template: x.yml` at stage, job or step level | the pipeline owns the structure and reuses pieces of it |

These repositories use includes: `build.yml` and `deploy.yml` own their stages and pull in
`common/deploy-*.yml` for the steps. `extends` is the right answer only when a template must be
mandatory — an organisation-wide required template that a pipeline cannot opt out of.

## Include at the right level

```yaml
# deploy.yml — the pipeline owns the stages and what each one is called
stages:
  - stage: deploy_test
    jobs:
      - template: common/deploy-api-service.yml
        parameters:
          environment: test
          serviceConnection: <connection-name>
          appName: <resource-name>
```

A template file declares which level it provides, and it can only be included at that level:

```yaml
# common/deploy-api-service.yml
parameters:
  - name: environment
    type: string
  - name: serviceConnection
    type: string
  - name: appName
    type: string
  - name: runSmokeTest
    type: boolean
    default: false

jobs:
  - deployment: deploy_${{ parameters.environment }}
    environment: ${{ parameters.environment }}     # approvals live on the environment
    strategy:
      runOnce:
        deploy:
          steps:
            - download: current
              artifact: api
            - task: <deploy task>@<major>
              displayName: Deploy ${{ parameters.appName }}
              inputs:
                azureSubscription: ${{ parameters.serviceConnection }}
            - ${{ if parameters.runSmokeTest }}:
                - template: smoke-test.yml
                  parameters:
                    appName: ${{ parameters.appName }}
```

The task's major version is part of its identity and is pinned; take the value from a pipeline that
already exists in the tree rather than inventing one.

Template paths are relative to **the file that contains the `- template:` line**, not to the
repository root. A template that moves breaks every caller silently until the next run.

## Parameter types, and why typing them matters

| Type                        | Carries                                                     |
| --------------------------- | ----------------------------------------------------------- |
| `string`, `number`, `boolean` | a scalar; add `values:` to make it an enum the caller cannot get wrong |
| `object`                    | a map or list — a whole configuration block                  |
| `step`, `stepList`          | steps the caller injects into a hole the template leaves     |
| `job`, `jobList`            | jobs, for a template that owns a stage                       |
| `stage`, `stageList`        | stages, for an `extends` template                            |

```yaml
parameters:
  - name: environment
    type: string
    values: [test, staging, production]   # a typo now fails at expansion, not at deploy time
  - name: preDeploySteps
    type: stepList
    default: []
```

`values:` is the cheapest safety in the whole file type: it turns "prodution" from a failed deploy
into a compile-time error before an agent is even allocated.

**Give no default that would silently work.** A default is correct for a genuine opt-in flag
(`runSmokeTest: false`) and wrong for anything environment-specific: a defaulted environment name
means a caller that forgot to pass one deploys somewhere, and it will not be the right somewhere.
Omit the default so expansion fails instead.

## Parameters against variables

| | `parameters` | `variables` |
| --- | --- | --- |
| Resolved | compile time, before the run exists | run time, on the agent |
| Syntax | `${{ parameters.x }}` | `$(x)` |
| Typed | yes | no — everything is a string |
| Can change the YAML's shape | yes — insertion, loops, which jobs exist | no |
| Can hold a step's output | no | yes |
| Visible in the run dialog | runtime parameters, yes | no |

The consequence people trip over: a parameter cannot depend on anything computed during the run,
and a variable cannot decide whether a job exists. When a template needs to choose between two sets
of steps based on an environment, that is a parameter. When it needs a value a build step produced,
that is an output variable and a `dependsOn`.

## Loops and conditional insertion

```yaml
parameters:
  - name: services
    type: object
    default: []

jobs:
  - ${{ each svc in parameters.services }}:
      - template: common/deploy-api-service.yml
        parameters:
          appName: ${{ svc.name }}
          environment: ${{ svc.environment }}
```

```yaml
steps:
  - ${{ if eq(parameters.environment, 'production') }}:
      - template: common/deploy-database.yml
  - ${{ else }}:
      - script: echo "database deploy skipped outside production"
```

Conditional **insertion** (`${{ if }}` on a list item) removes the step from the YAML entirely. A
step `condition:` keeps the step and skips it at run time, which shows in the run as a skipped step.
Insertion is better when the step should not exist; a condition is better when its absence is worth
seeing in the timeline.

## Keeping a template callable from more than one pipeline

Five rules, and every one of them comes from a template that had to be copied:

1. No hardcoded environment, resource, connection or branch name — all of it is a parameter.
2. No dependency on a variable the caller happens to define; if the template needs a value, it
   declares a parameter for it.
3. No `trigger:` or `pr:` — those belong to the entry file only.
4. Anything the template writes goes to a path the caller passed, not a fixed one.
5. One responsibility per template. `deploy-database.yml` deploys the database and does not also
   restart the API, however convenient that was once.

## What a template is trusted with

A deploy template is the piece that holds a service connection, so it is also the piece that decides
the blast radius of a mistake:

| Rule                                                                 | Why                                                     |
| -------------------------------------------------------------------- | ------------------------------------------------------- |
| The connection is a parameter, never named inside the template        | one template, several environments, no accidental cross-deploy |
| Each connection is scoped to the least it needs                        | never an owner- or admin-level identity for a build job |
| Never echo a secret, and never write one to a file the run publishes   | masking catches exact matches, not a substring or a re-encoded form |
| Every third-party task or extension is pinned to an immutable version  | a floating version changes what runs with no commit     |
| Every step carries a real `displayName`                                | an auto-generated name makes the timeline unreadable when it fails |

Anything longer than a handful of lines belongs in a committed `.ps1` or `.sh` beside the template
rather than inline in YAML — it can then be linted, reviewed and run locally. Start a PowerShell
script with `$ErrorActionPreference = 'Stop'` and a bash one with `set -euo pipefail`, or a failing
command inside it leaves the step green.

Cross-repository templates need a `resources.repositories` entry and a `@alias` on the template
reference; that is the mechanism for sharing a template across trees, and it also pins which ref of
the template repository is used — pin a tag or a branch deliberately, because `main` means every
consumer changes when it changes.

## Seeing what a template actually expanded to

The preview endpoint in the parent skill's `Do` block returns the fully expanded YAML without
queueing a run. It is the only reliable way to check a loop, an insertion or a parameter default,
and it fails with the real error message when a required parameter is missing. Use it before
pushing a template change, not after the deploy pipeline goes red.
