# Caching and artifacts

Every job gets a clean agent. That single fact produces both of these mechanisms: a **cache** makes
a job faster by restoring something it could have rebuilt, and an **artifact** moves something from
one job to another because otherwise it would be gone.

| | Cache | Artifact |
| --- | --- | --- |
| Purpose | speed | handover, and keeping output |
| Correctness may depend on it | **never** | yes, that is what it is for |
| Keyed by | content you choose | a name you choose |
| Lifetime | evicted whenever the service decides | the run's retention policy |
| A miss means | slower | the pipeline is broken |

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
the tree. Four things in that block matter:

- **The key is the identity of the content.** A `|`-separated list where file globs are replaced by
  the hash of those files. Change the lock file, get a different key, get a fresh entry.
- **`"$(Agent.OS)"` belongs in the key** whenever the restored content is platform-specific, which
  package caches are.
- **`restoreKeys` is the fallback ladder.** On a key miss it tries the shorter prefixes, so a lock
  file change restores yesterday's cache and downloads only the delta instead of everything.
- **The cache path must be the tool's real cache directory**, which usually means redirecting it to
  somewhere inside the workspace with an environment variable, because the default is outside it.

A cache entry is **immutable**: the first run to save a given key wins, and later runs with the
same key never update it. So a key that is not derived from content — a branch name, a date — gives
a cache that goes stale and never refreshes. Key on the lock file, always.

`--locked-mode` on restore is what makes .NET caching honest: it fails when the lock file does not
match the project files, instead of quietly resolving something different from what was cached. It
requires the lock files to be committed.

For node, the same shape with the package lock file in the key and the package manager's cache
directory as the path. Note that caching the cache directory and running a clean install is right;
caching `node_modules` directly is not, because it is platform- and version-specific in ways the
key rarely captures.

## What must never be cached

| Content                                | Why not                                                        |
| -------------------------------------- | -------------------------------------------------------------- |
| Build output the next job needs         | that is an artifact; a cache miss would break the run          |
| Anything a later step assumes exists    | same reason — a cache is best-effort by contract               |
| Secrets, tokens, credentials            | the cache is stored outside the run and shared across runs     |
| Test results and coverage               | they belong to one run; publish them instead                   |
| Anything cheaper to rebuild than to transfer | the upload and download can cost more than the work       |

The test for a legitimate cache: delete the entry, run the pipeline, and it still passes — only
slower. If it fails, that was an artifact all along.

## Artifacts: publish and download

```yaml
  - publish: $(Build.ArtifactStagingDirectory)/api
    artifact: api                       # name it; the default name is how downloads go missing

  # in a later job or stage
  - download: current
    artifact: api                       # lands in $(Pipeline.Workspace)/api
```

| Rule                                                     | Consequence of ignoring it                                 |
| -------------------------------------------------------- | ---------------------------------------------------------- |
| Name every artifact explicitly                            | the implicit download picks the default name and finds nothing |
| One artifact per deployable                                | a monolithic artifact makes every deploy download everything |
| Publish only what is deployed                              | source, symbols and test output inflate every transfer      |
| A deployment job downloads its artifacts automatically      | an explicit `download` in a deployment job is redundant but harmless |
| `download: none` when a job needs nothing                   | otherwise the job waits on a download it never uses         |

An artifact is immutable once published: a second publish under the same name in the same run
fails. Two jobs that both produce output publish under two names, and the deploy stage downloads
both.

## Passing values, not files, between stages

An artifact moves files. A **variable** moves a value, and it needs both an explicit output and a
dependency:

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

Three ways this fails: no `isOutput=true` (the variable stays inside the job), no `name:` on the
step (there is nothing to reference), and `${{ }}` instead of `$[ ]` (a compile-time expression
cannot read a value the run has not produced yet). A secret output variable is not passed at all —
re-read the secret from its variable group in the consuming stage instead.

## Consuming another pipeline's artifact

A `resources.pipelines` entry makes another pipeline's output available, with `download: <alias>`
to fetch it. That is the right shape when one repository builds a component another deploys, and it
brings a trigger with it — the consumer can run automatically when the producer completes. Pin
which branch's runs are consumed; otherwise a deploy pipeline can pick up an artifact from a branch
nobody meant to release.

## Symptoms and causes

| Symptom                                                | Cause                                                      |
| ------------------------------------------------------ | ---------------------------------------------------------- |
| The cache never hits                                    | the key contains something that changes every run           |
| The cache always hits but the content is stale           | the key is not derived from content; entries are immutable  |
| Restore is still slow with a cache hit                   | the cache path is not the directory the tool actually uses  |
| "Artifact not found" in a later stage                    | name mismatch, or the publishing job was skipped            |
| The deploy stage deployed the previous run's output       | it consumed a pipeline resource, not this run's artifact    |
| An output variable is empty downstream                   | missing `isOutput=true`, missing step `name`, or `${{ }}` used |
| A stage that should have been skipped downloaded 2 GB     | no `download: none` on jobs that need nothing               |
