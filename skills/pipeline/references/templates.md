# Templates: extends, includes, and typed parameters

| Mechanism | Shape                                        | Use it when                                             |
| --------- | -------------------------------------------- | ------------------------------------------------------- |
| `extends` | the pipeline hands control to **one** template that owns the whole structure | the structure must be identical and enforceable across pipelines |
| include   | `- template: x.yml` at stage, job or step level | the pipeline owns the structure and reuses pieces of it |

These repositories use includes: `build.yml` and `deploy.yml` own their stages and pull in
`common/deploy-*.yml` for the steps. `extends` is right only when a template must be mandatory — an
organisation-wide required template a pipeline cannot opt out of.

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

```yaml
# common/deploy-api-service.yml — provides the jobs level
parameters:
  - name: environment
    type: string
    values: [test, staging, production]   # a typo fails at expansion, not at deploy time
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

The task's major version is pinned; take it from a pipeline already in the tree rather than inventing
one. Template paths are relative to **the file that contains the `- template:` line**, not to the
repository root: a template that moves breaks every caller silently until the next run.

**Give no default that would silently work.** A default is right for a genuine opt-in flag
(`runSmokeTest: false`) and wrong for anything environment-specific: a caller that forgot the
environment would deploy somewhere unintended. Omit the default so expansion fails instead.

## Parameters against variables

Parameters (`${{ }}`) resolve at compile time, are typed and can change the YAML's shape; variables
(`$(x)`) resolve on the agent, are strings, and can hold a step's output. A parameter cannot depend
on anything computed during the run, and a variable cannot decide whether a job exists.

Conditional **insertion** (`${{ if }}` on a list item) removes the step from the YAML; a step
`condition:` keeps it and shows it skipped in the timeline. Use insertion when the step should not
exist, a condition when its absence is worth seeing.

## Keeping a template callable from more than one pipeline

1. No hardcoded environment, resource, connection or branch name — all of it is a parameter.
2. No dependency on a variable the caller happens to define; declare a parameter for it.
3. No `trigger:` or `pr:` — those belong to the entry file only.
4. Anything the template writes goes to a path the caller passed, not a fixed one.
5. One responsibility per template: `deploy-database.yml` does not also restart the API.

## What a template is trusted with

A deploy template holds a service connection, so it decides the blast radius of a mistake:

| Rule                                                                 | Why                                                     |
| -------------------------------------------------------------------- | ------------------------------------------------------- |
| The connection is a parameter, never named inside the template        | one template, several environments, no accidental cross-deploy |
| Each connection is scoped to the least it needs                        | never an owner- or admin-level identity for a build job |
| Never echo a secret, and never write one to a file the run publishes   | masking catches exact matches, not a substring or a re-encoded form |
| Every third-party task or extension is pinned to an immutable version  | a floating version changes what runs with no commit     |
| Every step carries a real `displayName`                                | an auto-generated name makes the timeline unreadable when it fails |

Anything longer than a handful of lines belongs in a committed `.ps1` or `.sh` beside the template.
Start a PowerShell script with `$ErrorActionPreference = 'Stop'` and a bash one with
`set -euo pipefail`, or a failing command leaves the step green.

Cross-repository templates need a `resources.repositories` entry and a `@alias`; pin a tag or branch
deliberately, because `main` means every consumer changes when it changes.

The preview endpoint in the parent skill's `Do` block returns the fully expanded YAML without queueing
a run: the only reliable check of a loop, an insertion or a parameter default. Use it before pushing a
template change.
