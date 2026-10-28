---
name: pipeline
description: >-
  Use when a CI/CD file is created, edited or reviewed: Azure DevOps pipeline or template,
  GitVersion config, GitHub workflow, or the Ansible deploy's artifact contract.
paths: "**/.pipelines/**,**/azure-pipelines*.y*ml,**/GitVersion.yml,**/.github/workflows/*"
---

# pipeline — Azure DevOps YAML: shape, templates, versioning, the deploy contract

**Contract.** Pipeline YAML in the house shape, expanded and validated before it runs · never
queues a run, never edits YAML to chase a red run · explanations in Italian,
YAML keys and log lines verbatim.

## When

Not for: a red run (`debug-systematic`); YAML that is not a pipeline (compose, settings, manifests); branch
and PR policy (`branch-flow`, `pr-create`).

House facts: rule `pipelines`.

## Decide

### The shape — mirror it, never a second layout

| File | Role |
| --- | --- |
| `<tree>/.pipelines/build.yml` | CI entry: triggers, version, build, publish the artifact |
| `<tree>/.pipelines/deploy.yml` | deploy orchestrator: one stage per environment, nothing else |
| `<tree>/.pipelines/common/deploy-*.yml` | one template per deployable, plus one for the database |
| `<tree>/GitVersion.yml` | the semantic-version rules for that tree |

Beyond the rule file: a `displayName` on every step and job; an inline script over ~10 lines moves to
a `.ps1`; explicit `trigger:`/`pr:` with path filters; production deploys only from the default or a
release branch, behind an environment with approvals; NuGet cache keyed on the lock-file hash;
third-party tasks and actions pinned to an immutable version.

### Template boundary

| Content | Lives in |
| --- | --- |
| `trigger`, `pr`, path filters, the stage list | the pipeline — never a template |
| environment, resource and service-connection names | the pipeline, passed down as typed `parameters:` with no working default |
| the steps that build, test or deploy one thing; anything used twice | a template, immediately |
| approvals, gates, environment protection | the Azure DevOps environment, not YAML |

### Which mechanism carries a value

| Need | Mechanism | Note |
| --- | --- | --- |
| fixed for this pipeline | `variables:`, narrowest scope | visible in logs — never a secret |
| shared by several pipelines | variable group (`group:`) | the pipeline is authorized for it once |
| a secret | secret variable in a vault-backed group | not in a script's environment until mapped in that step's `env:` |
| chosen at queue time | typed runtime `parameters:` | validated, shown in the run dialog |
| computed in one job, read in another | output variable + `dependsOn` | a dependency expression reads it |
| decides the *shape* of the YAML | template `parameters:` | compile time: loops, conditional insertion |

Three syntaxes, three moments: `${{ }}` at compile time (before an agent exists), `$(var)` at run
time inside a step, `$[ ]` at run time as a job or stage is scheduled.

### Versioning and the deploy contract

| Topic | Rule |
| --- | --- |
| GitVersion | full history (`fetchDepth: 0`); the version step runs **once** and passes the value on; a git tag only on a release branch, after the deploy succeeded (`references/versioning.md`) |
| artifact | the artifact name and its inner zip names are a contract with the deploy repository's `group_vars` — renaming either breaks the deploy silently (`references/ansible-deploy.md`) |
| database | the build publishes `migration.sql` from `dotnet ef migrations script --idempotent`; the deploy runs it with `sqlcmd -b` before the services restart, so it stays compatible with the old version |
| cache vs artifact | a cache only speeds restore and a miss must stay correct; build output between stages is a named pipeline artifact (`references/caching-and-artifacts.md`) |
| GitHub Actions | rare here: raise it before adding a workflow (a second CI system); where one exists, same rules — reusable workflows, environment secrets, actions pinned to a commit SHA |

## Do

```powershell
$org = 'https://dev.azure.com/<org>'; $proj = '<project>'
az pipelines list --org $org -p $proj -o table

# Expand the YAML and validate template parameters WITHOUT queueing anything
'{ "previewRun": true }' | Set-Content .\preview.json
az devops invoke --org $org --area pipelines --resource preview --http-method POST `
  --route-parameters project=$proj pipelineId=<id> --in-file .\preview.json --api-version 7.1
```

`jq` is not assumed: shape output with `--query` (JMESPath) or `ConvertFrom-Json`.

## Traps

1. A value is empty although set → `${{ }}` used for a run-time value → `$(var)` in a step, `$[ ]`
   in a condition.
2. A variable group's values never appear → the pipeline is not authorized for it → grant it once.
3. The pipeline stops triggering after a path-filter change → `include`/`exclude` interact, or a
   template sits outside the filtered paths → verify with the preview call.
4. An artifact missing in the deploy stage → the implicit download covers only the default name →
   publish and download by explicit name.
5. `continue-on-error: true` → green with a failed step → never without a comment naming the reason.
6. Builds locally, fails on the agent → the image ships other tooling → install the needed SDK explicitly.

## References

- `references/templates.md` — extends vs includes, typed parameters, loops, conditional insertion.
- `references/versioning.md` — the version config, branch rules, build number, why it drifted.
- `references/caching-and-artifacts.md` — cache keys, what must not depend on a cache, artifacts.
- `references/ansible-deploy.md` — what the Ansible deploy consumes: artifact resolution, release
  folders, systemd activation, the `migration.sql` step, playbooks.
