# Caching and artifacts

| | Cache | Artifact |
| --- | --- | --- |
| Purpose | speed | handover, and keeping output |
| Correctness may depend on it | **never** | yes, that is what it is for |
| A miss means | slower | the pipeline is broken |

The test for a legitimate cache: delete the entry, run the pipeline, and it still passes, only
slower. If it fails, that was an artifact all along.

## Cache: key, path, restore keys

```yaml
variables:
  NUGET_PACKAGES: $(Pipeline.Workspace)/.nuget/packages

steps:
  - task: Cache@<major>
    displayName: Cache NuGet packages
    inputs:
      key: 'nuget | "$(Agent.OS)" | **/packages.lock.json,!**/bin/**'
      restoreKeys: |
        nuget | "$(Agent.OS)"
      path: $(NUGET_PACKAGES)

  - script: dotnet restore --locked-mode
    displayName: Restore
```

The task's major version is pinned and is part of its identity; take it from a pipeline already in
the tree.

- Key on the lock file, always: an entry is **immutable** (the first run to save a key wins), so a key
  not derived from content (a branch name, a date) goes stale and never refreshes.
- `"$(Agent.OS)"` belongs in the key for platform-specific content.
- The cache path must be the tool's real cache directory, usually redirected into the workspace with
  an environment variable (the default is outside it).
- `--locked-mode` on restore fails when the lock file does not match the project files instead of
  quietly resolving something different from what was cached; it requires the lock files committed.
- Node: cache the package manager's cache directory and run a clean install; never `node_modules`.

Never cache: build output the next job needs (an artifact), anything a later step assumes exists,
secrets or tokens (the cache is stored outside the run and shared), test results and coverage
(publish them), anything cheaper to rebuild than to transfer.

## Artifacts: publish and download

```yaml
  - publish: $(Build.ArtifactStagingDirectory)/api
    artifact: api                       # name it; the default name is how downloads go missing

  - download: current
    artifact: api                       # lands in $(Pipeline.Workspace)/api
```

- Name every artifact explicitly; one artifact per deployable; publish only what is deployed.
- A deployment job downloads its artifacts automatically; `download: none` when a job needs nothing.
- An artifact is immutable once published: a second publish under the same name in the same run
  fails. Two jobs that both produce output publish under two names.

## Passing values, not files, between stages

```yaml
  - stage: build
    jobs:
      - job: compute
        steps:
          - pwsh: echo "##vso[task.setvariable variable=imageTag;isOutput=true]$(version)"
            name: setTag

  - stage: deploy
    dependsOn: build
    variables:
      imageTag: $[ stageDependencies.build.compute.outputs['setTag.imageTag'] ]
```

Fails with: no `isOutput=true`, no `name:` on the step, or `${{ }}` instead of `$[ ]`. A secret output
variable is not passed at all: re-read it from its variable group in the consuming stage.

## Consuming another pipeline's artifact

A `resources.pipelines` entry with `download: <alias>`; it brings a trigger with it. Pin which
branch's runs are consumed, otherwise a deploy pipeline can pick up an artifact from a branch nobody
meant to release.

## Symptoms and causes

| Symptom                                                | Cause                                                      |
| ------------------------------------------------------ | ---------------------------------------------------------- |
| The cache never hits                                    | the key contains something that changes every run           |
| The cache always hits but the content is stale           | the key is not derived from content; entries are immutable  |
| Restore is still slow with a cache hit                   | the cache path is not the directory the tool actually uses  |
| "Artifact not found" in a later stage                    | name mismatch, or the publishing job was skipped            |
| The deploy stage deployed the previous run's output       | it consumed a pipeline resource, not this run's artifact    |
| An output variable is empty downstream                   | missing `isOutput=true`, missing step `name`, or `${{ }}` used |
